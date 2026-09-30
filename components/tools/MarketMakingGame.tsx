'use client'

import ToolSourceLink from './ToolSourceLink'
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import {
  FLOW_PROFILES, ITEM_COUNT, MAX_SIZE, QUOTES_PER_REVEAL, SOURCES, TOTAL_QUOTES,
  createGame, noiseTradeProbability, playQuote, position, publicFair, revealedBefore, summarize, tradePnl, validateQuote,
  type FlowProfileId, type Game, type Source, type SourceId, type StepResult,
} from '@/lib/market-making'
import { RANKS, SUITS, cardLabel } from '@/lib/poker'
import type { ToolLock } from './catalog'
import './market-making.css'

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (n: number) => `${n > 0.004 ? '+' : n < -0.004 ? '−' : ''}${money(Math.abs(n))}`
const cents = (n: number) => Math.round(n * 100) / 100
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }
type Stage = 'quote' | 'result' | 'settled'
type ItemState = 'shown' | 'hidden' | 'insider'
const capital = (word: string) => word[0].toUpperCase() + word.slice(1)
const defaultQuote = (source: Source) => {
  const mid = publicFair([], 0, source), half = source.maxWidth / 2
  return [String(mid - half), String(mid + half)]
}

function Die({ value, index, state }: { value: number; index: number; state: ItemState }) {
  const insider = index === ITEM_COUNT - 1
  const label = state === 'shown' ? `Die ${index + 1} shows ${value}` : state === 'insider' ? `Die ${index + 1}, seen only by the insider` : `Die ${index + 1}, not yet revealed`
  return <div className="mm-die">
    <div className={`mm-die-face mm-die-${state}`} role="img" aria-label={label} style={{ '--die-delay': `${index * 60}ms` } as CSSProperties}>
      {state === 'shown'
        ? <span className="mm-pips" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[value].includes(i) ? 'is-on' : ''} />)}</span>
        : <span className="mm-die-mark" aria-hidden="true">{state === 'insider' ? '◆' : '?'}</span>}
    </div>
    <small aria-hidden="true">{insider ? 'INSIDER DIE' : `DIE ${index + 1}`}</small>
  </div>
}

function Card({ card, index, state }: { card: number; index: number; state: ItemState }) {
  const insider = index === ITEM_COUNT - 1
  const label = state === 'shown' ? `Card ${index + 1} is the ${cardLabel(card)}` : state === 'insider' ? `Card ${index + 1}, seen only by the insider` : `Card ${index + 1}, not yet revealed`
  const suit = Math.floor(card / 13), rank = RANKS[card % 13]
  return <div className="mm-die mm-card">
    {state === 'shown'
      ? <div className={`poker-card poker-card-face ${suit === 1 || suit === 2 ? 'poker-card-red' : ''}`} role="img" aria-label={label} style={{ '--deal-delay': `${index * 45}ms` } as CSSProperties}><span className="poker-card-corner" aria-hidden="true">{rank}<small>{SUITS[suit]}</small></span><span className="poker-card-suit" aria-hidden="true">{SUITS[suit]}</span><span className="poker-card-corner poker-card-corner-bottom" aria-hidden="true">{rank}<small>{SUITS[suit]}</small></span></div>
      : <div className={`poker-card ${state === 'insider' ? 'poker-card-back' : 'poker-card-empty'}`} role="img" aria-label={label}><span className="mm-die-mark" aria-hidden="true">{state === 'insider' ? '◆' : '?'}</span></div>}
    <small aria-hidden="true">{insider ? 'INSIDER CARD' : `CARD ${index + 1}`}</small>
  </div>
}

function describeInventory(n: number) {
  return n > 0 ? `Long ${n}` : n < 0 ? `Short ${-n}` : 'Flat'
}

function lesson(s: ReturnType<typeof summarize>, trades: number, source: Source) {
  if (!trades) return 'Nobody traded with you. A market that never trades earns nothing: tighten up and let the noise flow pay you the spread.'
  if (s.spread < -1 && s.spread <= s.information) return `Your prices gave away ${money(-s.spread)} against public fair value. Before worrying about width, centre your market on what the revealed ${source.nounPlural} say the contract is worth, and move it every time a ${source.noun} lands.${source.id === 'cards' ? ' Remember that each revealed card changes the average of the cards still in the deck.' : ''}`
  if (s.informedTrades && s.information < -1) return `The insider took ${money(-s.information)} from you. A fill against you is evidence: after you are lifted, the insider ${source.noun} is more likely high, so move your market up. After you are hit, move it down.`
  if (s.spread <= 0) return 'Your fills gave up edge against public fair value. Centre your market on fair value first, then decide how wide to be.'
  if (!s.noiseTrades) return 'Only the insider traded with you. Your market was wide enough to scare off uninformed flow, so all that was left was the informed side.'
  return 'You collected the spread from noise flow without handing it back to the insider. That balance is the whole job of a market maker.'
}

export default function MarketMakingGame({ lock }: { lock?: ToolLock } = {}) {
  const [profileId, setProfileId] = useState<FlowProfileId>('standard')
  const [sourceId, setSourceId] = useState<SourceId>('dice')
  const [game, setGame] = useState<Game | null>(null)
  const [results, setResults] = useState<StepResult[]>([])
  const [stage, setStage] = useState<Stage>('quote')
  const [bid, setBid] = useState('12')
  const [ask, setAsk] = useState('16')
  const [size, setSize] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [showFair, setShowFair] = useState(false)

  const start = (id: FlowProfileId, src: SourceId) => {
    const nextSource = SOURCES.find(s => s.id === src)!
    const [nextBid, nextAsk] = defaultQuote(nextSource)
    setGame(createGame(newSeed(), FLOW_PROFILES.find(p => p.id === id)!, nextSource))
    setResults([]); setStage('quote'); setBid(nextBid); setAsk(nextAsk); setSize(1); setError(null)
  }
  // Deal on the client only, so server and client renders agree.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { start('standard', 'dice') }, [])

  const profile = FLOW_PROFILES.find(p => p.id === profileId)!
  const source = game?.source ?? SOURCES.find(s => s.id === sourceId)!
  const nouns = source.nounPlural, Noun = capital(source.noun)
  const latest = results[results.length - 1]
  const step = stage === 'quote' ? results.length : latest?.step ?? 0
  const revealed = stage === 'settled' ? ITEM_COUNT : stage === 'result' && latest ? latest.revealed : revealedBefore(step)
  const publicRevealed = Math.min(revealed, ITEM_COUNT - 1)
  const fairNow = publicFair(game?.values ?? [], game ? publicRevealed : 0, source)
  const unseenNow = source.unseenMean(game?.values.slice(0, publicRevealed) ?? [])
  const { inventory, cash } = position(results)
  const marked = cash + inventory * fairNow
  const trades = results.filter(r => r.trade)
  const bidValue = cents(Number(bid)), askValue = cents(Number(ask))
  const width = askValue - bidValue
  const widthValid = bid.trim() !== '' && ask.trim() !== '' && Number.isFinite(width) && width > 0
  const summary = game && stage === 'settled' ? summarize(game, results) : null
  const willReveal = latest && latest.step % QUOTES_PER_REVEAL === QUOTES_PER_REVEAL - 1 && latest.revealed < ITEM_COUNT - 1
  // A host page can hold back the second public die or card.
  const gated = !!lock?.locked && !!willReveal && latest.revealed + 1 >= 2

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!game || stage !== 'quote') return
    if (bid.trim() === '' || ask.trim() === '') { setError('Enter a number for both the bid and the ask.'); return }
    const quote = { bid: bidValue, ask: askValue, size }
    const problem = validateQuote(quote, source)
    if (problem) { setError(problem); return }
    setError(null)
    setResults(old => [...old, playQuote(game, old.length, quote)])
    setStage('result')
  }
  const next = () => setStage(results.length >= TOTAL_QUOTES ? 'settled' : 'quote')
  const chooseProfile = (id: FlowProfileId) => { if (id === profileId) return; setProfileId(id); start(id, sourceId) }
  const chooseSource = (id: SourceId) => { if (id === sourceId) return; setSourceId(id); start(profileId, id) }

  const itemState = (i: number): ItemState => stage === 'settled' || (i < ITEM_COUNT - 1 && i < revealed) ? 'shown' : i === ITEM_COUNT - 1 ? 'insider' : 'hidden'

  return <>
    <div className="tool-app-heading"><div><p className="tools-eyebrow">06 / TRADING INTERVIEW</p><h2>Market-making game</h2><p>Quote a two-sided market. Get picked off. Learn from the flow.</p></div><ToolSourceLink /></div>
    <div className="mm-layout">
      <div className="mm-stage">
        <div className="mm-toolbar">
          <div className="mm-toolbar-groups">
            <div className="tool-segment" role="group" aria-label="Game">{SOURCES.map(s => <button key={s.id} type="button" aria-pressed={sourceId === s.id} onClick={() => chooseSource(s.id)}>{s.label}</button>)}</div>
            <div className="smile-presets" role="group" aria-label="Order flow">{FLOW_PROFILES.map(p => <button key={p.id} type="button" aria-pressed={profileId === p.id} onClick={() => chooseProfile(p.id)}>{p.label} flow</button>)}</div>
          </div>
          <span className="mm-progress">{stage === 'settled' ? 'SETTLED' : `QUOTE ${step + 1} / ${TOTAL_QUOTES}`}</span>
        </div>
        <p className="poker-training-note mm-profile-note">{profile.description} Changing the game or the flow starts a new game.</p>

        <div className={`mm-dice ${source.id === 'cards' ? 'mm-cards' : ''}`} aria-live="polite">{game ? game.items.map((item, i) => source.id === 'cards'
          ? <Card key={`${game.items.join()}-${i}-${itemState(i)}`} card={item} index={i} state={itemState(i)} />
          : <Die key={`${i}-${itemState(i)}`} value={item} index={i} state={itemState(i)} />) : <p role="status">Dealing…</p>}</div>
        <p className="mm-contract">The contract settles at the sum of all four {nouns}, <b>${source.min} to ${source.max}</b>.{source.id === 'cards' && <> Aces count 1, jacks 11, queens 12, kings 13.</>} {stage === 'settled' ? '' : `${publicRevealed} of ${ITEM_COUNT - 1} public ${nouns} revealed.`}</p>

        {stage === 'quote' && game && <form className="mm-ticket" onSubmit={submit} noValidate>
          <div className="mm-ticket-prices">
            <label>Bid<span>You buy at</span><input inputMode="decimal" type="number" step="0.25" min="0" value={bid} onChange={e => setBid(e.target.value)} aria-describedby="mm-width" /></label>
            <label>Ask<span>You sell at</span><input inputMode="decimal" type="number" step="0.25" min="0" value={ask} onChange={e => setAsk(e.target.value)} aria-describedby="mm-width" /></label>
            <div className="mm-size"><span>Size<small>contracts</small></span><div className="tool-segment" role="group" aria-label="Quote size">{Array.from({ length: MAX_SIZE }, (_, i) => i + 1).map(n => <button key={n} type="button" aria-pressed={size === n} onClick={() => setSize(n)}>{n}</button>)}</div></div>
          </div>
          <p className="mm-width" id="mm-width">{widthValid ? <>Width <b>{money(width)}</b> of {money(source.maxWidth)} max · an uninformed trader deals <b>{Math.round(noiseTradeProbability(width, source) * 100)}%</b> of the time at this width</> : <>Quote a bid below your ask, at most {money(source.maxWidth)} wide.</>}</p>
          {error && <p className="book-error" role="alert">{error}</p>}
          <button className="poker-deal" type="submit">Show your market <span aria-hidden="true">→</span></button>
        </form>}

        {stage === 'result' && latest && <div className="mm-result" aria-live="polite">
          <span className="tools-tag">{latest.trade ? 'TRADE' : 'NO TRADE'}</span>
          <h3>{!latest.trade ? 'The counterparty passed.' : latest.trade.makerSide === 'sell' ? `Lifted. You sold ${latest.trade.size} at ${money(latest.trade.price)}.` : `Hit. You bought ${latest.trade.size} at ${money(latest.trade.price)}.`}</h3>
          <p>Your market was {money(latest.quote.bid)} – {money(latest.quote.ask)} for {latest.quote.size}. {latest.trade ? 'Was that the insider, or noise? Every counterparty is unmasked at settlement.' : 'A pass is information too: the insider only passes when their value sits inside your market.'}</p>
          {showFair && <p className="mm-result-fair">Public fair value was <b>{money(latest.publicFair)}</b>. Your mid was {money((latest.quote.bid + latest.quote.ask) / 2)}, {(() => { const off = (latest.quote.bid + latest.quote.ask) / 2 - latest.publicFair; return Math.abs(off) < .005 ? 'right on fair' : `${money(Math.abs(off))} ${off > 0 ? 'above' : 'below'} fair` })()}.</p>}
          {gated && lock!.notice ? <>{lock!.notice}<button className="poker-reset" type="button" onClick={() => start(profileId, sourceId)}>Start a new game ↺</button></> : <button className="poker-deal" type="button" onClick={gated ? lock!.onBlocked : next} autoFocus>{results.length >= TOTAL_QUOTES ? 'Settle the game' : willReveal ? `Reveal ${source.noun} ${latest.revealed + 1}` : 'Next quote'} <span aria-hidden="true">→</span></button>}
        </div>}

        {summary && game && <div className="mm-summary">
          <p className="tools-eyebrow">SETTLEMENT · {game.values.join(' + ')} = {summary.settlement}</p>
          <strong className={`mm-pnl ${summary.pnl > 0 ? 'is-up' : summary.pnl < 0 ? 'is-down' : ''}`}>{signed(summary.pnl)}</strong>
          <p className="mm-summary-caption">Your P&amp;L on {trades.length} {trades.length === 1 ? 'trade' : 'trades'}, with your final position ({describeInventory(inventory).toLowerCase()}) settled at {money(summary.settlement)}.</p>
          <div className="mm-breakdown">
            <div><span>Spread captured<small>Your edge against public fair value when you traded</small></span><b>{signed(summary.spread)}</b></div>
            <div><span>Adverse selection<small>How the insider’s {source.noun} moved against, or for, your fills</small></span><b>{signed(summary.information)}</b></div>
            <div><span>Luck<small>{capital(nouns)} nobody had seen yet when you traded</small></span><b>{signed(summary.luck)}</b></div>
          </div>
          <div className="mm-compare">
            <div><span>Benchmark</span><b>{signed(summary.benchmarkPnl)}</b><small>Public fair ± {money(source.benchmarkHalfWidth)} at your sizes, same counterparties</small></div>
            <div><span>Mid error</span><b>{money(summary.meanMidError)}</b><small>Average distance of your mid from public fair</small></div>
            <div><span>Counterparties</span><b>{summary.informedTrades} / {summary.noiseTrades}</b><small>Insider / noise trades · {signed(summary.informedPnl)} / {signed(summary.noisePnl)}</small></div>
          </div>
          <p className="mm-lesson">{lesson(summary, trades.length, source)}</p>
          <details className="mm-review" open>
            <summary>Quote-by-quote review</summary>
            <div className="mm-review-scroll"><table>
              <thead><tr><th scope="col">#</th><th scope="col">Your market</th><th scope="col">Fair then</th><th scope="col">Insider knew</th><th scope="col">Counterparty</th><th scope="col">Trade</th><th scope="col">P&amp;L</th></tr></thead>
              <tbody>{results.map(r => <tr key={r.step}><td>{r.step + 1}</td><td>{money(r.quote.bid)} – {money(r.quote.ask)} × {r.quote.size}</td><td>{money(r.publicFair)}</td><td>{money(r.insiderValue)}</td><td>{r.trader === 'informed' ? 'Insider' : 'Noise'}</td><td>{r.trade ? `${r.trade.makerSide === 'buy' ? 'Bought' : 'Sold'} ${r.trade.size} @ ${money(r.trade.price)}` : '—'}</td><td>{r.trade ? signed(tradePnl(r, summary.settlement)) : '—'}</td></tr>)}</tbody>
            </table></div>
          </details>
          <button className="poker-deal" type="button" onClick={() => start(profileId, sourceId)}>Play again <span aria-hidden="true">↺</span></button>
        </div>}
      </div>

      <aside className="mm-aside">
        <div className="poker-odds-heading"><h3>Your book</h3><button type="button" onClick={() => setShowFair(v => !v)} aria-pressed={showFair}>{showFair ? 'Hide fair value' : 'Show fair value'}</button></div>
        <div className="mm-fair" aria-live="polite">{summary
          ? <><span className="poker-result-label">SETTLEMENT VALUE</span><strong>{money(summary.settlement)}</strong><p>The sum of all four {nouns}, including the insider’s.</p></>
          : showFair
          ? <><span className="poker-result-label">PUBLIC FAIR VALUE</span><strong>{money(fairNow)}</strong><p>{source.id === 'cards' ? <>Revealed cards plus {money(unseenNow)}, the average card left in the deck, for each card you have not seen.</> : <>Revealed dice plus {money(unseenNow)} for each die you have not seen.</>}</p></>
          : <><span className="poker-result-label">FAIR VALUE HIDDEN</span><strong className="mm-fair-hidden" aria-hidden="true">?</strong><p>Work it out from the {nouns} before you quote.</p></>}</div>
        <div className="mm-position">
          <div><span>Position</span><b>{describeInventory(inventory)}</b></div>
          <div><span>Cash</span><b>{signed(cash)}</b></div>
          <div><span>{summary ? 'Final P&L' : 'Marked at fair'}</span><b>{summary ? signed(summary.pnl) : showFair ? signed(marked) : '—'}</b></div>
        </div>
        <div className="mm-blotter"><span>BLOTTER</span>{trades.length ? <ol>{trades.map(r => <li key={r.step}><span>#{r.step + 1}</span>{r.trade!.makerSide === 'buy' ? 'Bought' : 'Sold'} {r.trade!.size} @ {money(r.trade!.price)}<i>{stage === 'settled' ? (r.trader === 'informed' ? 'Insider' : 'Noise') : '?'}</i></li>)}</ol> : <p>No trades yet.</p>}</div>
        <div className="poker-practice"><span>THE EXERCISE</span><ol><li>Work out fair value from the revealed {nouns}.</li><li>Quote around it. Width protects you but scares off noise traders.</li><li>Read the flow. A fill against you hints at the insider’s {source.noun}.</li><li>Lean against your inventory so you don’t get stuck with a big position.</li></ol></div>
      </aside>
    </div>
    <details className="tool-model-notes"><summary>How the game works <span>+</span></summary><p>{source.id === 'cards'
      ? <>Four cards are dealt from one shuffled 52-card deck. The contract settles at the sum of their values, with aces 1, jacks 11, queens 12 and kings 13, so its fair value before any information is {money(publicFair([], 0, source))}. Cards are dealt without replacement, so an unseen card is worth the average of the cards still in the deck: a revealed king makes every other unseen card slightly cheaper, and the insider’s card shifts the rest in the same way.</>
      : <>Four fair six-sided dice are rolled. The contract settles at their sum, so its fair value before any information is {money(publicFair([], 0, source))}.</>} You make {TOTAL_QUOTES} markets; after every {QUOTES_PER_REVEAL} one more public {source.noun} is revealed, up to three. The fourth {source.noun} is seen only by an insider and is revealed at settlement. Each market meets one counterparty. With probability {Math.round(profile.informedShare * 100)}% ({profile.label.toLowerCase()} flow) it is the insider, who buys your ask if their expected value is above it, sells your bid if it is below, and otherwise passes. Otherwise it is a noise trader who buys or sells at random and deals less often as your market widens: always at {money(source.maxWidth / 4)} wide or less, falling to 25% at {money(source.maxWidth)}. Every trade is for your full quoted size. P&amp;L splits exactly into spread captured (your price against public fair value), adverse selection (the insider’s {source.noun} against public fair value) and luck ({nouns} not yet seen by anyone). This is a fictional practice game with made-up counterparties, loosely inspired by the Glosten–Milgrom model of trading against informed flow.</p></details>
  </>
}
