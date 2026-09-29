'use client'

import ToolSourceLink from './ToolSourceLink'
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import {
  DICE_COUNT, DIE_MEAN, FLOW_PROFILES, MAX_SIZE, MAX_WIDTH, QUOTES_PER_REVEAL, TOTAL_QUOTES,
  createGame, noiseTradeProbability, playQuote, position, publicFair, revealedBefore, summarize, tradePnl, validateQuote,
  type FlowProfileId, type Game, type StepResult,
} from '@/lib/market-making'
import './market-making.css'

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (n: number) => `${n > 0.004 ? '+' : n < -0.004 ? '−' : ''}${money(Math.abs(n))}`
const cents = (n: number) => Math.round(n * 100) / 100
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }
type Stage = 'quote' | 'result' | 'settled'
type DieState = 'shown' | 'hidden' | 'insider'

function Die({ value, index, state }: { value: number; index: number; state: DieState }) {
  const insider = index === DICE_COUNT - 1
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

function describeInventory(n: number) {
  return n > 0 ? `Long ${n}` : n < 0 ? `Short ${-n}` : 'Flat'
}

function lesson(s: ReturnType<typeof summarize>, trades: number) {
  if (!trades) return 'Nobody traded with you. A market that never trades earns nothing: tighten up and let the noise flow pay you the spread.'
  if (s.spread < -1 && s.spread <= s.information) return `Your prices gave away ${money(-s.spread)} against public fair value. Before worrying about width, centre your market on what the revealed dice say the contract is worth, and move it every time a die lands.`
  if (s.informedTrades && s.information < -1) return `The insider took ${money(-s.information)} from you. A fill against you is evidence: after you are lifted, the insider die is more likely high, so move your market up. After you are hit, move it down.`
  if (s.spread <= 0) return 'Your fills gave up edge against public fair value. Centre your market on fair value first, then decide how wide to be.'
  if (!s.noiseTrades) return 'Only the insider traded with you. Your market was wide enough to scare off uninformed flow, so all that was left was the informed side.'
  return 'You collected the spread from noise flow without handing it back to the insider. That balance is the whole job of a market maker.'
}

export default function MarketMakingGame() {
  const [profileId, setProfileId] = useState<FlowProfileId>('standard')
  const [game, setGame] = useState<Game | null>(null)
  const [results, setResults] = useState<StepResult[]>([])
  const [stage, setStage] = useState<Stage>('quote')
  const [bid, setBid] = useState('12')
  const [ask, setAsk] = useState('16')
  const [size, setSize] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [showFair, setShowFair] = useState(false)

  const start = (id: FlowProfileId) => {
    setGame(createGame(newSeed(), FLOW_PROFILES.find(p => p.id === id)!))
    setResults([]); setStage('quote'); setBid('12'); setAsk('16'); setSize(1); setError(null)
  }
  // Deal on the client only, so server and client renders agree.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { start('standard') }, [])

  const profile = FLOW_PROFILES.find(p => p.id === profileId)!
  const latest = results[results.length - 1]
  const step = stage === 'quote' ? results.length : latest?.step ?? 0
  const revealed = stage === 'settled' ? DICE_COUNT : stage === 'result' && latest ? latest.revealed : revealedBefore(step)
  const publicRevealed = Math.min(revealed, DICE_COUNT - 1)
  const fairNow = game ? publicFair(game.dice, publicRevealed) : DIE_MEAN * DICE_COUNT
  const { inventory, cash } = position(results)
  const marked = cash + inventory * fairNow
  const trades = results.filter(r => r.trade)
  const bidValue = cents(Number(bid)), askValue = cents(Number(ask))
  const width = askValue - bidValue
  const widthValid = bid.trim() !== '' && ask.trim() !== '' && Number.isFinite(width) && width > 0
  const summary = game && stage === 'settled' ? summarize(game, results) : null
  const willReveal = latest && latest.step % QUOTES_PER_REVEAL === QUOTES_PER_REVEAL - 1 && latest.revealed < DICE_COUNT - 1

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!game || stage !== 'quote') return
    if (bid.trim() === '' || ask.trim() === '') { setError('Enter a number for both the bid and the ask.'); return }
    const quote = { bid: bidValue, ask: askValue, size }
    const problem = validateQuote(quote)
    if (problem) { setError(problem); return }
    setError(null)
    setResults(old => [...old, playQuote(game, old.length, quote)])
    setStage('result')
  }
  const next = () => setStage(results.length >= TOTAL_QUOTES ? 'settled' : 'quote')
  const chooseProfile = (id: FlowProfileId) => { if (id === profileId) return; setProfileId(id); start(id) }

  const dieState = (i: number): DieState => stage === 'settled' || (i < DICE_COUNT - 1 && i < revealed) ? 'shown' : i === DICE_COUNT - 1 ? 'insider' : 'hidden'

  return <>
    <div className="tool-app-heading"><div><p className="tools-eyebrow">06 / TRADING INTERVIEW</p><h2>Market-making game</h2><p>Quote a two-sided market. Get picked off. Learn from the flow.</p></div><ToolSourceLink /></div>
    <div className="mm-layout">
      <div className="mm-stage">
        <div className="mm-toolbar">
          <div className="smile-presets" role="group" aria-label="Order flow">{FLOW_PROFILES.map(p => <button key={p.id} type="button" aria-pressed={profileId === p.id} onClick={() => chooseProfile(p.id)}>{p.label} flow</button>)}</div>
          <span className="mm-progress">{stage === 'settled' ? 'SETTLED' : `QUOTE ${step + 1} / ${TOTAL_QUOTES}`}</span>
        </div>
        <p className="poker-training-note mm-profile-note">{profile.description} Changing the flow starts a new game.</p>

        <div className="mm-dice" aria-live="polite">{game ? game.dice.map((value, i) => <Die key={`${i}-${dieState(i)}`} value={value} index={i} state={dieState(i)} />) : <p role="status">Rolling the dice…</p>}</div>
        <p className="mm-contract">The contract settles at the sum of all four dice, <b>$4 to $24</b>. {stage === 'settled' ? '' : `${publicRevealed} of ${DICE_COUNT - 1} public dice revealed.`}</p>

        {stage === 'quote' && game && <form className="mm-ticket" onSubmit={submit} noValidate>
          <div className="mm-ticket-prices">
            <label>Bid<span>You buy at</span><input inputMode="decimal" type="number" step="0.25" min="0" value={bid} onChange={e => setBid(e.target.value)} aria-describedby="mm-width" /></label>
            <label>Ask<span>You sell at</span><input inputMode="decimal" type="number" step="0.25" min="0" value={ask} onChange={e => setAsk(e.target.value)} aria-describedby="mm-width" /></label>
            <div className="mm-size"><span>Size<small>contracts</small></span><div className="tool-segment" role="group" aria-label="Quote size">{Array.from({ length: MAX_SIZE }, (_, i) => i + 1).map(n => <button key={n} type="button" aria-pressed={size === n} onClick={() => setSize(n)}>{n}</button>)}</div></div>
          </div>
          <p className="mm-width" id="mm-width">{widthValid ? <>Width <b>{money(width)}</b> of {money(MAX_WIDTH)} max · an uninformed trader deals <b>{Math.round(noiseTradeProbability(width) * 100)}%</b> of the time at this width</> : <>Quote a bid below your ask, at most {money(MAX_WIDTH)} wide.</>}</p>
          {error && <p className="book-error" role="alert">{error}</p>}
          <button className="poker-deal" type="submit">Show your market <span aria-hidden="true">→</span></button>
        </form>}

        {stage === 'result' && latest && <div className="mm-result" aria-live="polite">
          <span className="tools-tag">{latest.trade ? 'TRADE' : 'NO TRADE'}</span>
          <h3>{!latest.trade ? 'The counterparty passed.' : latest.trade.makerSide === 'sell' ? `Lifted. You sold ${latest.trade.size} at ${money(latest.trade.price)}.` : `Hit. You bought ${latest.trade.size} at ${money(latest.trade.price)}.`}</h3>
          <p>Your market was {money(latest.quote.bid)} – {money(latest.quote.ask)} for {latest.quote.size}. {latest.trade ? 'Was that the insider, or noise? Every counterparty is unmasked at settlement.' : 'A pass is information too: the insider only passes when their value sits inside your market.'}</p>
          {showFair && <p className="mm-result-fair">Public fair value was <b>{money(latest.publicFair)}</b>. Your mid was {money((latest.quote.bid + latest.quote.ask) / 2)}, {(() => { const off = (latest.quote.bid + latest.quote.ask) / 2 - latest.publicFair; return Math.abs(off) < .005 ? 'right on fair' : `${money(Math.abs(off))} ${off > 0 ? 'above' : 'below'} fair` })()}.</p>}
          <button className="poker-deal" type="button" onClick={next} autoFocus>{results.length >= TOTAL_QUOTES ? 'Settle the game' : willReveal ? `Reveal die ${latest.revealed + 1}` : 'Next quote'} <span aria-hidden="true">→</span></button>
        </div>}

        {summary && game && <div className="mm-summary">
          <p className="tools-eyebrow">SETTLEMENT · {game.dice.join(' + ')} = {summary.settlement}</p>
          <strong className={`mm-pnl ${summary.pnl > 0 ? 'is-up' : summary.pnl < 0 ? 'is-down' : ''}`}>{signed(summary.pnl)}</strong>
          <p className="mm-summary-caption">Your P&amp;L on {trades.length} {trades.length === 1 ? 'trade' : 'trades'}, with your final position ({describeInventory(inventory).toLowerCase()}) settled at {money(summary.settlement)}.</p>
          <div className="mm-breakdown">
            <div><span>Spread captured<small>Your edge against public fair value when you traded</small></span><b>{signed(summary.spread)}</b></div>
            <div><span>Adverse selection<small>How the insider’s die moved against, or for, your fills</small></span><b>{signed(summary.information)}</b></div>
            <div><span>Luck<small>Dice nobody had seen yet when you traded</small></span><b>{signed(summary.luck)}</b></div>
          </div>
          <div className="mm-compare">
            <div><span>Benchmark</span><b>{signed(summary.benchmarkPnl)}</b><small>Public fair ± {money(1)} at your sizes, same counterparties</small></div>
            <div><span>Mid error</span><b>{money(summary.meanMidError)}</b><small>Average distance of your mid from public fair</small></div>
            <div><span>Counterparties</span><b>{summary.informedTrades} / {summary.noiseTrades}</b><small>Insider / noise trades · {signed(summary.informedPnl)} / {signed(summary.noisePnl)}</small></div>
          </div>
          <p className="mm-lesson">{lesson(summary, trades.length)}</p>
          <details className="mm-review" open>
            <summary>Quote-by-quote review</summary>
            <div className="mm-review-scroll"><table>
              <thead><tr><th scope="col">#</th><th scope="col">Your market</th><th scope="col">Fair then</th><th scope="col">Insider knew</th><th scope="col">Counterparty</th><th scope="col">Trade</th><th scope="col">P&amp;L</th></tr></thead>
              <tbody>{results.map(r => <tr key={r.step}><td>{r.step + 1}</td><td>{money(r.quote.bid)} – {money(r.quote.ask)} × {r.quote.size}</td><td>{money(r.publicFair)}</td><td>{money(r.insiderValue)}</td><td>{r.trader === 'informed' ? 'Insider' : 'Noise'}</td><td>{r.trade ? `${r.trade.makerSide === 'buy' ? 'Bought' : 'Sold'} ${r.trade.size} @ ${money(r.trade.price)}` : '—'}</td><td>{r.trade ? signed(tradePnl(r, summary.settlement)) : '—'}</td></tr>)}</tbody>
            </table></div>
          </details>
          <button className="poker-deal" type="button" onClick={() => start(profileId)}>Play again <span aria-hidden="true">↺</span></button>
        </div>}
      </div>

      <aside className="mm-aside">
        <div className="poker-odds-heading"><h3>Your book</h3><button type="button" onClick={() => setShowFair(v => !v)} aria-pressed={showFair}>{showFair ? 'Hide fair value' : 'Show fair value'}</button></div>
        <div className="mm-fair" aria-live="polite">{summary
          ? <><span className="poker-result-label">SETTLEMENT VALUE</span><strong>{money(summary.settlement)}</strong><p>The sum of all four dice, including the insider’s.</p></>
          : showFair
          ? <><span className="poker-result-label">PUBLIC FAIR VALUE</span><strong>{money(fairNow)}</strong><p>Revealed dice plus {money(DIE_MEAN)} for each die you have not seen.</p></>
          : <><span className="poker-result-label">FAIR VALUE HIDDEN</span><strong className="mm-fair-hidden" aria-hidden="true">?</strong><p>Work it out from the dice before you quote.</p></>}</div>
        <div className="mm-position">
          <div><span>Position</span><b>{describeInventory(inventory)}</b></div>
          <div><span>Cash</span><b>{signed(cash)}</b></div>
          <div><span>{summary ? 'Final P&L' : 'Marked at fair'}</span><b>{summary ? signed(summary.pnl) : showFair ? signed(marked) : '—'}</b></div>
        </div>
        <div className="mm-blotter"><span>BLOTTER</span>{trades.length ? <ol>{trades.map(r => <li key={r.step}><span>#{r.step + 1}</span>{r.trade!.makerSide === 'buy' ? 'Bought' : 'Sold'} {r.trade!.size} @ {money(r.trade!.price)}<i>{stage === 'settled' ? (r.trader === 'informed' ? 'Insider' : 'Noise') : '?'}</i></li>)}</ol> : <p>No trades yet.</p>}</div>
        <div className="poker-practice"><span>THE EXERCISE</span><ol><li>Work out fair value from the revealed dice.</li><li>Quote around it. Width protects you but scares off noise traders.</li><li>Read the flow. A fill against you hints at the insider’s die.</li><li>Lean against your inventory so you don’t get stuck with a big position.</li></ol></div>
      </aside>
    </div>
    <details className="tool-model-notes"><summary>How the game works <span>+</span></summary><p>Four fair six-sided dice are rolled. The contract settles at their sum, so its fair value before any information is {money(DIE_MEAN * DICE_COUNT)}. You make {TOTAL_QUOTES} markets; after every {QUOTES_PER_REVEAL} one more public die is revealed, up to three. The fourth die is seen only by an insider and is revealed at settlement. Each market meets one counterparty. With probability {Math.round(profile.informedShare * 100)}% ({profile.label.toLowerCase()} flow) it is the insider, who buys your ask if their expected value is above it, sells your bid if it is below, and otherwise passes. Otherwise it is a noise trader who buys or sells at random and deals less often as your market widens: always at $1 wide or less, falling to 25% at $4. Every trade is for your full quoted size. P&amp;L splits exactly into spread captured (your price against public fair value), adverse selection (the insider’s die against public fair value) and luck (dice not yet seen by anyone). This is a fictional practice game with made-up counterparties, loosely inspired by the Glosten–Milgrom model of trading against informed flow.</p></details>
  </>
}
