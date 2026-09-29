'use client'

import ToolSourceLink from './ToolSourceLink'
import { useEffect, useRef, useState } from 'react'
import { MARKET_SCENARIOS, validMarketScenario, cancelUserOrders, type MarketScenario, createBook, executeOrder, nextMarketEvent, quote, scorePrediction, settle, STARTING_CASH, type Book, type Execution, type Level, type Liquidity, type Side } from '@/lib/orderbook'

import { seededRandom } from '@/lib/poker'
import { reviewDecision, type DecisionReview } from '@/lib/orderbook-review'

const money = (n: number, digits = 2) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })
const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

type Print = { mid: number | null; trade: number | null }
type Score = { fillCorrect: boolean; priceError: number | null; predicted: number | null; average: number | null; remainder: Execution['remainder'] }

function clone(book: Book): Book {
  return { bids: book.bids.map(level => ({ ...level })), asks: book.asks.map(level => ({ ...level })) }
}

function reduceLevel(book: Book, side: Side, price: number, quantity: number) {
  const levels = side === 'buy' ? book.asks : book.bids
  const level = levels.find(item => item.price === price)
  if (!level) return book
  level.quantity = Math.max(0, level.quantity - quantity)
  if (level.yours) level.yours = Math.min(level.yours, level.quantity)
  if (!level.quantity) {
    if (side === 'buy') book.asks = book.asks.filter(item => item !== level)
    else book.bids = book.bids.filter(item => item !== level)
  }
  return book
}

export default function OrderBookSimulator() {
  const [scenarios, setScenarios] = useState<MarketScenario[]>(MARKET_SCENARIOS)
  const [scenario, setScenario] = useState(MARKET_SCENARIOS[0])
  const [seed, setSeed] = useState(1)
  const random = useRef(seededRandom(1))
  const [elapsed, setElapsed] = useState(0)
  const [reviews, setReviews] = useState<DecisionReview[]>([])
  const [fallback, setFallback] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const freshSeed = crypto.getRandomValues(new Uint32Array(1))[0]
    setSeed(freshSeed); random.current = seededRandom(freshSeed)
    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 7000)
    fetch('/api/practice-content', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json() }).then(data => {
      if (!Array.isArray(data.market) || !data.market.length || !data.market.every(validMarketScenario)) throw new Error()
      if (!active) return
      setScenarios(data.market); setScenario(data.market[0]); setFallback(data.unavailable.includes('orderbook-scenarios'))
    }).catch(() => { if (active) setFallback(true) }).finally(() => { window.clearTimeout(timer); if (active) setLoading(false) })
    return () => { active = false; controller.abort(); window.clearTimeout(timer) }
  }, [])
  const [liquidity, setLiquidity] = useState<Liquidity>('normal')
  const [book, setBook] = useState<Book>(() => createBook('normal'))
  const [shown, setShown] = useState<Book | null>(null)
  const [cash, setCash] = useState(STARTING_CASH)
  const [inventory, setInventory] = useState(0)
  const [side, setSide] = useState<Side>('buy')
  const [kind, setKind] = useState<'market' | 'limit'>('market')
  const [quantity, setQuantity] = useState('25')
  const [limitPrice, setLimitPrice] = useState('100.15')
  const [expectsFill, setExpectsFill] = useState<boolean | null>(null)
  const [predicted, setPredicted] = useState('')
  const [hit, setHit] = useState<{ price: number; side: Side } | null>(null)
  const [resting, setResting] = useState<number | null>(null)
  const [last, setLast] = useState<Execution | null>(null)
  const [score, setScore] = useState<Score | null>(null)
  const [note, setNote] = useState('Sellers offer 10 at $100.10 and 20 at $100.20. A market buy of 25 should average $100.16.')
  const [prints, setPrints] = useState<Print[]>(() => [{ mid: quote(createBook('normal')).mid, trade: null }])
  const [busy, setBusy] = useState<'order' | 'market' | null>(null)
  const [error, setError] = useState('')
  const run = useRef(0)
  const view = shown ?? book
  const market = quote(view)
  const depth = Math.max(...view.bids.map(level => level.quantity), ...view.asks.map(level => level.quantity), 1)

  const reset = (next: Liquidity, replay = false) => {
    const nextSeed = replay ? seed : crypto.getRandomValues(new Uint32Array(1))[0]
    setSeed(nextSeed); random.current = seededRandom(nextSeed)
    setElapsed(0); setReviews([]); setExpectsFill(null); setPredicted('')
    run.current += 1
    const fresh = createBook(next)
    setLiquidity(next)
    setBook(fresh)
    setShown(null)
    setCash(STARTING_CASH)
    setInventory(0)
    setHit(null)
    setResting(null)
    setLast(null)
    setScore(null)
    setPrints([{ mid: quote(fresh).mid, trade: null }])
    setBusy(null)
    setError('')
    setNote(next === 'normal' ? 'Sellers offer 10 at $100.10 and 20 at $100.20. A market buy of 25 should average $100.16.' : `The book is ${next}. The same order now walks a different set of prices.`)
  }

  const motion = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const playFills = async (token: number, start: Book, fills: Execution['fills'], orderSide: Side) => {
    let frame = clone(start)
    setShown(frame)
    for (const fill of fills) {
      if (run.current !== token) return false
      setHit({ price: fill.price, side: orderSide })
      if (motion()) await wait(280)
      if (run.current !== token) return false
      frame = reduceLevel(frame, orderSide, fill.price, fill.quantity)
      setShown(clone(frame))
      if (motion()) await wait(320)
    }
    return run.current === token
  }

  const submit = async () => {
    if (busy) return
    const shares = Number(quantity)
    if (!Number.isInteger(shares) || shares < 1 || shares > 200) { setError('Use 1–200 shares for this practice session.'); return }
    const price = Number(limitPrice)
    if (expectsFill === null || (expectsFill && predicted.trim() === '')) { setError('Predict the fill before you send the order.'); return }
    const order = { side, kind, quantity: shares, ...(kind === 'limit' ? { limitPrice: price } : {}) }
    let result: Execution
    try { result = executeOrder(cancelUserOrders(book), order) } catch (cause) { setError(cause instanceof Error ? cause.message : 'That order cannot be sent.'); return }
    const guess = predicted.trim() === '' ? null : Number(predicted)
    if (expectsFill && !Number.isFinite(guess)) { setError('Enter the average price you expect.'); return }
    const review = reviewDecision(book, side, shares, scenario, { label: 'Your order', order })
    setError('')
    setScore(null)
    setBusy('order')
    const token = ++run.current
    const continued = await playFills(token, cancelUserOrders(book), result.fills, side)
    if (!continued) return
    setShown(result.book)
    setResting(result.remainder.disposition === 'resting' ? result.remainder.price ?? null : null)
    if (motion() && result.remainder.quantity) await wait(420)
    if (run.current !== token) return
    const account = settle(cash, inventory, result, side)
    setReviews(old => [...old, review])
    setBook(result.book)
    setShown(null)
    setCash(account.cash)
    setInventory(account.inventory)
    setLast(result)
    setHit(null)
    setScore({ ...scorePrediction(result, { expectsFill, averagePrice: guess }), predicted: guess, average: result.averagePrice, remainder: result.remainder })
    setPrints(old => [...old, { mid: quote(result.book).mid, trade: result.averagePrice }].slice(-28))
    const verb = side === 'buy' ? 'Bought' : 'Sold'
    setNote(result.filledQuantity ? `${verb} ${result.filledQuantity} shares${result.averagePrice ? ` at ${money(result.averagePrice)}` : ''}.` : 'Nothing traded.')
    setBusy(null)
  }

  const stepMarket = async () => {
    if (busy) return
    const shares = Number(quantity)
    if (!Number.isInteger(shares) || shares < 1 || shares > 200) { setError('Set a target of 1–200 shares before reviewing a wait.'); return }
    const restingBids = book.bids.filter(l => l.yours)
    const restingAsks = book.asks.filter(l => l.yours)
    const restingQuantity = [...restingBids, ...restingAsks].reduce((n, l) => n + (l.yours ?? 0), 0)
    const review = restingQuantity
      ? reviewDecision(book, restingBids.length ? 'buy' : 'sell', restingQuantity, scenario, { label: 'Keep resting order', order: null, keepResting: true })
      : reviewDecision(book, side, shares, scenario, { label: 'Your wait: one event then trade', order: null, tradeAfter: 1 })
    setBusy('market')
    setScore(null)
    const token = ++run.current
    const event = nextMarketEvent(book, random.current, scenario)
    const touched = event.tradePrice
    if (touched !== null) {
      const before = book.bids.find(level => level.price === touched)?.quantity ?? 0
      const after = event.book.bids.find(level => level.price === touched)?.quantity ?? 0
      setHit({ price: touched, side: after < before ? 'sell' : 'buy' })
      if (motion()) await wait(380)
    }
    if (run.current !== token) return
    let nextCash = cash
    let nextInventory = inventory
    if (event.userFill) {
      const account = settle(cash, inventory, { notional: event.userFill.notional, filledQuantity: event.userFill.quantity }, event.userFill.side)
      nextCash = account.cash
      nextInventory = account.inventory
    }
    if (review) setReviews(old => [...old, review])
    setElapsed(t => t + (event.elapsedSeconds ?? 0))
    setBook(event.book)
    setShown(null)
    setCash(nextCash)
    setInventory(nextInventory)
    setHit(null)
    setResting(null)
    setNote(event.summary)
    setPrints(old => [...old, { mid: quote(event.book).mid, trade: event.tradePrice }].slice(-28))
    setBusy(null)
  }

  if (loading) return <p role="status">Loading market scenarios…</p>
  return <>
    {fallback && <p className="poker-training-note">Using bundled market scenarios; published content is temporarily unavailable.</p>}
    <div className="tool-app-heading"><div><p className="tools-eyebrow">05 / MARKET MICROSTRUCTURE</p><h2>Order-book simulator</h2><p>Read the book. Predict the fill. Watch the shares trade.</p></div><ToolSourceLink /></div>
    <div className="book-toolbar book-scenario-toolbar">
      <label>Market scenario <select aria-label="Market scenario" disabled={busy !== null} value={scenario.id} onChange={e => { setScenario(scenarios.find(s => s.id === e.target.value)!); reset(liquidity) }}>{scenarios.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      <button disabled={busy !== null} onClick={() => reset(liquidity)}>New random session</button>
      <button disabled={busy !== null} onClick={() => reset(liquidity, true)}>Replay seed {seed}</button>
    </div>
    <p className="poker-training-note book-scenario-note">{scenario.description} Simulated time: {elapsed.toFixed(2)}s. Replay reproduces events when you repeat the same actions.</p>
    <div className="book-layout">
      <div className="book-stage">
        <div className="book-toolbar">
          <div className="smile-presets" aria-label="Liquidity">{(['thin', 'normal', 'deep'] as const).map(item => <button key={item} aria-pressed={liquidity === item} disabled={busy !== null} onClick={() => reset(item)}>{item}</button>)}</div>
          <button className="surface-reset" disabled={busy !== null} onClick={stepMarket}>Next market event →</button>
        </div>
        <div className="pricing-metrics book-metrics">
          <div><span>Average execution</span><strong>{last?.averagePrice ? money(last.averagePrice) : '—'}</strong><small>{last ? `${last.filledQuantity} shares filled` : 'No trade yet'}</small></div>
          <div><span>Spread</span><strong>{market.spread === null ? '—' : money(market.spread)}</strong><small>{market.bestBid === null || market.bestAsk === null ? 'One side is empty' : `${money(market.bestBid)} / ${money(market.bestAsk)}`}</small></div>
          <div><span>Slippage</span><strong>{last?.slippage === null || last?.slippage === undefined ? '—' : money(last.slippage)}</strong><small>Versus the touch before the trade</small></div>
          <div><span>Cash</span><strong>{money(cash)}</strong><small>Started at {money(STARTING_CASH, 0)}</small></div>
          <div><span>Inventory</span><strong>{inventory}</strong><small>HLS shares</small></div>
        </div>
        <div className="book-ladder" aria-label="Order book">
          <LevelColumn title="Bids" hint="Buy orders" levels={view.bids} depth={depth} tone="bid" hit={hit} resting={resting} />
          <LevelColumn title="Offers" hint="Sell orders" levels={view.asks} depth={depth} tone="ask" hit={hit} resting={resting} />
        </div>
        <p className="book-note" aria-live="polite">{note}{score?.remainder.disposition === 'unfilled' ? ` ${score.remainder.quantity} shares did not trade.` : ''}{score?.remainder.disposition === 'resting' ? ` ${score.remainder.quantity} shares rest at ${money(score.remainder.price!)}.` : ''}</p>
        <form className="book-ticket" onSubmit={event => { event.preventDefault(); void submit() }}>
          <fieldset disabled={busy !== null} style={{ display: 'contents' }}><div className="tool-segment" aria-label="Order side">{(['buy', 'sell'] as const).map(item => <button type="button" key={item} aria-pressed={side === item} onClick={() => setSide(item)}>{item}</button>)}</div>
          <div className="tool-segment" aria-label="Order type">{(['market', 'limit'] as const).map(item => <button type="button" key={item} aria-pressed={kind === item} onClick={() => setKind(item)}>{item}</button>)}</div>
          <label>Quantity<input inputMode="numeric" aria-label="Quantity" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
          {kind === 'limit' && <label>Limit price<input inputMode="decimal" aria-label="Limit price" value={limitPrice} onChange={event => setLimitPrice(event.target.value)} /></label>}
          <div className="book-predict">
            <span>Before you send it</span>
            <div className="tool-segment" aria-label="Will the order trade">{([['Trades now', true], ['Rests unfilled', false]] as const).map(([label, value]) => <button type="button" key={label} aria-pressed={expectsFill === value} onClick={() => setExpectsFill(value)}>{label}</button>)}</div>
            <label>Predicted average fill<input inputMode="decimal" aria-label="Predicted average fill" placeholder="100.16" disabled={expectsFill === false} value={predicted} onChange={event => setPredicted(event.target.value)} /></label>
          </div>
          <button className="poker-deal" type="submit" disabled={busy !== null}>{busy === 'order' ? 'Working the book…' : 'Submit order'} <span aria-hidden="true">→</span></button>
        </fieldset></form>
        <p className="poker-training-note">Each submission replaces your outstanding orders. This paper account permits borrowing and short selling; fees and margin are omitted.</p>
        <button className="book-cancel" disabled={busy !== null || ![...book.bids, ...book.asks].some(l => l.yours)} onClick={() => { setBook(cancelUserOrders(book)); setResting(null); setNote('Your outstanding orders were cancelled.') }}>Cancel outstanding orders</button>
        {error && <p className="book-error" role="alert">{error}</p>}
        {score && <p className="book-score" aria-live="polite">{score.fillCorrect ? 'Your fill call was right.' : 'Your fill call was off.'}{score.average !== null && score.predicted !== null ? ` You predicted ${money(score.predicted)}. The average was ${money(score.average)}${score.priceError ? `, ${money(Math.abs(score.priceError))} ${score.priceError > 0 ? 'high' : 'low'}` : ', exactly'}.` : score.average === null ? ' Nothing traded, so there is no average.' : ''}</p>}
      </div>
      <aside className="book-chart-panel">
        <div className="chart-toolbar"><div><h3>Price</h3><p>Mid in blue. Your fills and market prints as dots.</p></div></div>
        <PriceChart prints={prints} />
        <section className="book-review" aria-label="Decision review" aria-live="polite">
          <h3>Execution review</h3>
          <p>Objective: execute the selected side and size within 8 market events at lowest expected cost. Compare trade now, join the queue, or wait until the deadline. Alternatives replace outstanding orders; “keep resting order” preserves your current queue position.</p>
          <p>At the deadline, remaining shares trade at available prices; any still unfilled incur a $1/share penalty. Costs are versus the starting mid. This estimates execution quality, not future trading profit.</p>
          {!reviews.length && <p>Submit an order or advance the market to review a decision.</p>}
          {reviews.map((review, i) => <details key={i} open={i === reviews.length - 1}>
            <summary>Decision {i + 1}: {review.side} {review.quantity} · {review.chosen}</summary>
            <p>{review.uncertain ? 'Your choice is within simulation uncertainty of the lowest estimated cost.' : `${review.best} had the lowest estimated cost, ${money(review.difference)} below your choice.`}</p>
            <table><caption>{review.paths} simulated futures · {review.horizon} events</caption><thead><tr><th>Action</th><th>Cost ± 2 SE</th><th>Filled by deadline</th></tr></thead><tbody>{review.estimates.map((e, j) => <tr key={j}><td>{e.label}</td><td>{money(e.cost)} ± {money(2 * e.standardError)}</td><td>{e.filledPercent.toFixed(1)}%</td></tr>)}</tbody></table>
            <p>Queueing can save the spread but risks non-execution; trading now pays the spread and may walk depth. Waiting exposes the whole order to later liquidity. Rankings are model-dependent, with no knowledge of upcoming live events. A one-event wait assumes you trade on the next event; you can reconsider at the next step.</p>
          </details>)}
          {[...book.bids, ...book.asks].some(l => l.yours) && <p>A resting order is active. Every market step reviews keeping it versus replacing it or waiting.</p>}
        </section>
        <p className="poker-training-note">Thin books charge more for the same size because the order has to reach higher offers. Deep books fill near the touch. Events use independent draws, lognormal sizes capped at 200, near-touch quote placement, size-weighted cancellations and exponential waiting times. These are illustrative distributions, not a fit to a particular exchange.</p>
      </aside>
    </div>
  </>
}

function LevelColumn({ title, hint, levels, depth, tone, hit, resting }: { title: string; hint: string; levels: Level[]; depth: number; tone: 'bid' | 'ask'; hit: { price: number; side: Side } | null; resting: number | null }) {
  return <div className={`book-side book-side-${tone}`}>
    <div className="poker-section-label"><span>{title.toUpperCase()}</span><span>{hint}</span></div>
    <ol>
      {levels.length === 0 && <li className="book-empty">No resting orders</li>}
      {levels.map(level => {
        const active = hit?.price === level.price && ((tone === 'ask' && hit.side === 'buy') || (tone === 'bid' && hit.side === 'sell'))
        const owned = resting === level.price || (level.yours ?? 0) > 0
        return <li key={level.price} className={`${active ? 'is-hit' : ''} ${owned ? 'is-yours' : ''}`}>
          <i style={{ width: `${Math.max(8, level.quantity / depth * 100)}%` }} />
          <b>{money(level.price)}</b>
          <span>{level.quantity}{level.yours ? <small> · {level.yours} yours</small> : ''}</span>
        </li>
      })}
    </ol>
  </div>
}

function PriceChart({ prints }: { prints: Print[] }) {
  const prices = prints.flatMap(point => [point.mid, point.trade].filter((value): value is number => value !== null))
  const low = Math.min(...prices, 99) - 0.15
  const high = Math.max(...prices, 101) + 0.15
  const x = (index: number) => prints.length === 1 ? 160 : 16 + index / (prints.length - 1) * 288
  const y = (price: number) => 16 + (high - price) / Math.max(high - low, 0.01) * 150
  const mid = prints.map((point, index) => point.mid === null ? null : `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.mid).toFixed(1)}`).filter(Boolean).join(' ')
  return <svg className="book-chart" viewBox="0 0 320 190" role="img" aria-label="Mid price and trade prints">
    {[0, 1, 2, 3].map(index => <line key={index} x1="16" x2="304" y1={16 + index * 50} y2={16 + index * 50} />)}
    <text x="16" y="12">{money(high)}</text>
    <text x="16" y="184">{money(low)}</text>
    <path d={mid} />
    {prints.map((point, index) => point.trade === null ? null : <circle key={index} cx={x(index)} cy={y(point.trade)} r="3.5" />)}
  </svg>
}
