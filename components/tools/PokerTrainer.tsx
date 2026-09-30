'use client'

import ToolSourceLink from './ToolSourceLink'
import { useEffect, useState, type CSSProperties } from 'react'
import { ThinkingOrb } from 'thinking-orbs'
import type { ToolLock } from './catalog'
import { calculatePokerOdds, cardLabel, handName, RANKS, SUITS, seededRandom, shuffledDeck, type PokerOdds } from '@/lib/poker'

function newDeck() {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]
  return shuffledDeck(seededRandom(seed))
}
function PlayingCard({ card, index = 0, hidden = false }: { card?: number; index?: number; hidden?: boolean }) {
  if (card === undefined) return <div className={`poker-card ${hidden ? 'poker-card-back' : 'poker-card-empty'}`} aria-label={hidden ? 'Unknown opponent card' : `Community card ${index + 1}, not revealed`}><span aria-hidden="true">{hidden ? 'QS' : String(index + 1).padStart(2, '0')}</span></div>
  const suit = Math.floor(card / 13), rank = RANKS[card % 13]
  return <div className={`poker-card poker-card-face ${suit === 1 || suit === 2 ? 'poker-card-red' : ''}`} aria-label={cardLabel(card)} style={{ '--deal-delay': `${index * 45}ms` } as CSSProperties}><span className="poker-card-corner" aria-hidden="true">{rank}<small>{SUITS[suit]}</small></span><span className="poker-card-suit" aria-hidden="true">{SUITS[suit]}</span><span className="poker-card-corner poker-card-corner-bottom" aria-hidden="true">{rank}<small>{SUITS[suit]}</small></span></div>
}

export default function PokerTrainer({ lock }: { lock?: ToolLock } = {}) {
  const [deck, setDeck] = useState<number[]>([])
  const [count, setCount] = useState(0)
  const [hidden, setHidden] = useState(false)
  const [calculation, setCalculation] = useState<{ key: string; odds: PokerOdds } | null>(null)
  useEffect(() => { setDeck(newDeck()) }, [])
  const hole = deck.slice(0, 2), board = deck.slice(2, 2 + count)
  const key = [...hole, -1, ...board].join(',')
  useEffect(() => {
    if (hole.length !== 2) return
    let cancelled = false
    const iterator = calculatePokerOdds(hole, board)
    let latest: PokerOdds | undefined
    let timer: ReturnType<typeof setTimeout>
    const step = () => {
      if (cancelled) return
      const next = iterator.next()
      if (next.done) { if (latest) setCalculation({ key, odds: latest }); return }
      latest = next.value
      timer = setTimeout(step, 0)
    }
    timer = setTimeout(step, 0)
    return () => { cancelled = true; clearTimeout(timer); iterator.return(undefined) }
    // The key contains every visible card, in order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const odds = calculation?.key === key ? calculation.odds : null
  const ready = deck.length === 52
  const stage = ['Pre-flop', 'First community card', 'Second community card', 'Flop complete', 'Turn', 'River'][count]
  const reset = () => { setCount(0); setDeck(newDeck()) }
  // A host page can hold back the second community card.
  const gated = !!lock?.locked && count === 1
  const win = odds ? 100 * odds.wins / odds.total : 0
  const tie = odds ? 100 * odds.ties / odds.total : 0
  const loss = odds ? 100 * odds.losses / odds.total : 0
  const label = board.length >= 3 ? handName([...hole, ...board]) : hole.length === 2 && hole[0] % 13 === hole[1] % 13 ? 'Pocket pair' : 'Two hole cards'
  return <>
    <div className="tool-app-heading"><div><p className="tools-eyebrow">03 / PROBABILITY PRACTICE</p><h2>Texas Hold’em trainer</h2><p>Read the cards. Estimate your edge. Test your intuition.</p></div><ToolSourceLink /></div>
    <div className="poker-layout">
      <div className="poker-table">
        <div className="poker-table-top"><span className="tools-tag">{stage.toUpperCase()}</span><span>{count} / 5 COMMUNITY CARDS</span></div>
        <div className="poker-opponent"><div className="poker-mini-cards"><PlayingCard hidden /><PlayingCard hidden /></div><div><h3>One random opponent</h3><p>Two unknown cards. No betting information.</p></div></div>
        <div className="poker-community"><div className="poker-section-label"><span>THE BOARD</span><span>Shared by both players</span></div><div className="poker-board">{Array.from({ length: 5 }, (_, i) => <PlayingCard key={board[i] === undefined ? `empty-${i}` : `card-${board[i]}`} card={board[i]} index={i} />)}</div></div>
        <div className="poker-player"><div className="poker-hole">{[0,1].map(i => <PlayingCard key={hole[i] ?? i} card={hole[i]} index={i} />)}</div><div><p className="tools-eyebrow">YOUR HAND</p><h3>{ready ? label : 'Dealing your hand…'}</h3><p>{count < 5 ? 'What changes when the next card lands?' : 'All five cards are out. Review your odds, then deal again.'}</p></div></div>
        {gated && lock!.notice}
        <div className="poker-actions">{!(gated && lock!.notice) && <button className="poker-deal" disabled={!ready} onClick={gated ? lock!.onBlocked : count === 5 ? reset : () => setCount(n => Math.min(5, n + 1))}>{count === 5 ? 'Deal a new hand' : 'Reveal next card'} <span aria-hidden="true">{count === 5 ? '↺' : '→'}</span></button>}{count < 5 && <button className="poker-reset" onClick={reset} disabled={!ready}>Reset hand ↺</button>}</div>
        <p className="poker-training-note">Training mode reveals the board one card at a time. In a normal game, the first three community cards are dealt together.</p>
      </div>
      <aside className="poker-analysis">
        <div className="poker-odds-heading"><h3>Winning probability</h3><button onClick={() => setHidden(v => !v)} aria-pressed={hidden}>{hidden ? 'Show odds' : 'Hide odds'}</button></div>
        <div className="poker-odds-panel" aria-live="polite" aria-busy={!hidden && !odds}>
          {hidden ? <div className="poker-hidden"><span aria-hidden="true">?</span><h4>Trust your calculation.</h4><p>Estimate the chance of winning before you reveal the answer.</p><small>Odds stay hidden as you deal and reset.</small></div> : !odds ? <div className="poker-calculating"><ThinkingOrb state="solving" size={64} theme="light" aria-label="Calculating winning probability" /><span className="tools-tag">CALCULATING</span><p>Exploring the remaining cards…</p></div> : <>
            <span className="poker-result-label">{odds.exact ? 'EXACT WIN RATE' : 'ESTIMATED WIN RATE'}</span><strong className="poker-win">{win.toFixed(1)}<small>%</small></strong><p className="poker-win-caption">Chance your best five-card hand wins outright.</p>
            <div className="poker-probability-bar" aria-hidden="true"><i style={{width:`${win}%`}} /><i style={{width:`${tie}%`}} /><i style={{width:`${loss}%`}} /></div>
            <div className="poker-breakdown"><div><span>Win</span><b>{win.toFixed(1)}%</b></div><div><span>Tie</span><b>{tie.toFixed(1)}%</b></div><div><span>Lose</span><b>{loss.toFixed(1)}%</b></div></div>
            <div className="poker-equity"><span>Pot equity <small>Win + half of ties</small></span><strong>{(win + tie / 2).toFixed(1)}%</strong></div>
            <p className="poker-sample">{odds.exact ? `All ${odds.total.toLocaleString()} possible opponent hands evaluated.` : `${odds.total.toLocaleString()} simulated deals. Approximate 95% sampling margin: at most ±0.9 percentage points.`}</p>
          </>}
        </div>
        <div className="poker-practice"><span>THE EXERCISE</span><ol><li>Hide the odds and read your two cards.</li><li>Estimate your winning probability.</li><li>Reveal a card. Update your estimate.</li><li>Show the odds and compare.</li></ol></div>
      </aside>
    </div>
    <details className="tool-model-notes"><summary>How the probabilities work <span>+</span></summary><p>Heads-up Texas Hold’em with one uniformly random opponent, no folds, no betting ranges and no rake. Both players make their best five-card hand from two hole cards and five community cards. Before the river, 12,000 simulated deals sample unknown opponent cards and board runouts without replacement. On the river, every possible opponent pair is evaluated exactly. Ties split the pot equally. Only visible cards enter the calculation; unrevealed cards in this practice hand do not influence the estimate. Rounded percentages may not sum to exactly 100%.</p></details>
  </>
}
