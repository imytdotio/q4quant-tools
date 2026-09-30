'use client'

import ToolSourceLink from './ToolSourceLink'
import { useEffect, useState, type CSSProperties } from 'react'
import type { ToolLock } from './catalog'
import { BAYES_ROUNDS, sampleBayesRounds, validBayesRound, type BayesRound, bayesPosterior, evidenceSplit, populationCells, type BayesCell } from '@/lib/bayes'

const percent = (n: number) => `${(n * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%`
type FollowCell = 'positive' | 'dropped-positive' | 'false' | 'dropped-false'

function useSettled(active: boolean, wait: number) {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!active) { setSettled(false); return }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSettled(true); return }
    const id = window.setTimeout(() => setSettled(true), wait)
    return () => window.clearTimeout(id)
  }, [active, wait])
  return settled
}

function cellsFrom(counts: number[], kinds: string[]) {
  return counts.flatMap((n, i) => Array(Math.round(n)).fill(kinds[i]))
}

export default function BayesTrainer({ lock }: { lock?: ToolLock } = {}) {
  const [pool, setPool] = useState<BayesRound[]>(BAYES_ROUNDS)
  const [rounds, setRounds] = useState<BayesRound[]>(BAYES_ROUNDS.slice(0, 6))
  const [loading, setLoading] = useState(true)
  const [fallback, setFallback] = useState(false)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 7000)
    fetch('/api/practice-content', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json() }).then(data => {
      if (!Array.isArray(data.bayes) || !data.bayes.length || !data.bayes.every(validBayesRound)) throw new Error()
      if (!active) return
      setPool(data.bayes); setRounds(sampleBayesRounds(data.bayes)); setFallback(data.unavailable.includes('bayes-scenarios'))
    }).catch(() => { if (!active) return; setRounds(sampleBayesRounds(BAYES_ROUNDS)); setFallback(true) }).finally(() => { window.clearTimeout(timer); if (active) setLoading(false) })
    return () => { active = false; window.clearTimeout(timer); controller.abort() }
  }, [])
  const [round, setRound] = useState(0)
  const [step, setStep] = useState(0)
  const [guess, setGuess] = useState(50)
  const [revealed, setRevealed] = useState(false)
  const [errors, setErrors] = useState<{ label: string; error: number }[]>([])
  const [finished, setFinished] = useState(false)
  const r = rounds[round]
  const likelihood = step === 0 ? r.evidence : r.followUp!
  const belief = step === 0 ? r.prior : bayesPosterior(r.prior, r.evidence.sensitivity, r.evidence.falsePositive)!
  const steps = step === 0 ? [r.evidence] : [r.evidence, r.followUp!]
  const answer = bayesPosterior(belief, likelihood.sensitivity, likelihood.falsePositive)! * 100
  const split = evidenceSplit(r.population, r.prior, steps)
  const positives = split.positives
  const falsePositives = split.falsePositives
  const error = Math.abs(guess - answer)
  const grid = step === 0 && r.visualization === 'population-grid' ? populationCells(r.population, r.prior, r.evidence.sensitivity, r.evidence.falsePositive) : null
  const followGrid = step === 1 && r.visualization === 'population-grid' ? followUpCells(r) : null
  const settled = useSettled(revealed, grid || followGrid ? 1100 : 600)
  const meanError = errors.length ? errors.reduce((sum, item) => sum + item.error, 0) / errors.length : 0
  const reset = () => { setRounds(sampleBayesRounds(pool)); setRound(0); setStep(0); setGuess(50); setRevealed(false); setErrors([]); setFinished(false) }
  // A host page can hold back answers from the second question on.
  const gated = !!lock?.locked && !revealed && errors.length >= 1
  const reveal = () => { if (revealed) return; if (gated) { lock!.onBlocked?.(); return } setRevealed(true); setErrors(old => [...old, { label: step === 0 ? r.title : `${r.title} · second observation`, error }]) }
  const next = () => {
    if (step === 0 && r.followUp) { setStep(1); setGuess(Math.round(answer)); setRevealed(false); return }
    if (round === rounds.length - 1) { setFinished(true); return }
    setRound(v => v + 1); setStep(0); setGuess(50); setRevealed(false)
  }
  if (loading) return <p role="status">Loading practice scenarios…</p>
  return <>
    {fallback && <p className="poker-training-note">Using bundled scenarios; published content is temporarily unavailable.</p>}
    <div className="tool-app-heading"><div><p className="tools-eyebrow">04 / PROBABILITY PRACTICE</p><h2>Bayes’ rule trainer</h2><p>Start with a belief. See the evidence. Update your estimate.</p></div><ToolSourceLink /></div>
    {finished ? <div className="bayes-complete"><p className="tools-eyebrow">{errors.length} UPDATES. A SHARPER INTUITION.</p><h3>How close were your estimates?</h3><strong>{meanError.toFixed(1)}<small> percentage points</small></strong><p>Average absolute error across every update. Lower is better.</p><div className="bayes-session-results">{errors.map((item, i) => <div key={i}><span>{item.label}</span><b>{item.error.toFixed(1)} pp</b></div>)}</div><button className="poker-deal" onClick={reset}>Practise again ↺</button></div> : <div className="bayes-layout">
      <div className="bayes-challenge" key={`${round}-${step}`}>
        <div className="bayes-round-top"><span className="tools-tag">{r.category.toUpperCase()}{step === 1 ? ' · UPDATE 2' : ''}</span><button className="surface-reset" onClick={reset}>Restart ↺</button></div>
        <h3>{r.title}</h3><p className="bayes-question">{step === 0 ? r.question : r.followUp!.question}</p>
        <div className="bayes-facts"><div><span>{step === 0 ? 'PRIOR' : 'CURRENT BELIEF'}</span><strong>{percent(belief)}</strong><p>{step === 0 ? <>of the population are {r.subject}.</> : <>after the first observation. You started at {percent(r.prior)}.</>}</p></div><div><span>TRUE-POSITIVE RATE</span><strong>{percent(likelihood.sensitivity)}</strong><p>of {r.subject} produce this evidence.</p></div><div><span>FALSE-POSITIVE RATE</span><strong>{percent(likelihood.falsePositive)}</strong><p>of {r.others} produce the same evidence.</p></div></div>
        <p className="bayes-evidence"><span>OBSERVED EVIDENCE</span>{likelihood.label}</p>
        {step === 1 && <p className="bayes-independence"><span>CONDITIONAL INDEPENDENCE</span>{r.followUp!.independence}</p>}
        <label className="bayes-guess">Your updated probability<output>{guess}%</output><input aria-label="Your probability estimate" type="range" min={0} max={100} step={1} disabled={revealed} value={guess} onChange={e => setGuess(Number(e.target.value))} /><small><span>0% · impossible</span><span>100% · certain</span></small></label>
        {gated && lock!.notice}
        <div className="bayes-buttons">{revealed ? <button className="poker-deal" onClick={next}>{step === 0 && r.followUp ? 'Another observation' : round === rounds.length - 1 ? 'See session results' : 'Next challenge'} →</button> : !(gated && lock!.notice) && <button className="poker-deal" onClick={reveal}>Reveal the answer →</button>}<span>{errors.length} answered{errors.length > 0 ? ` · ${meanError.toFixed(1)} pp average error` : ''}</span></div>
        <p className="poker-training-note">{r.note}</p>
      </div>
      <aside className="bayes-explanation" aria-live="polite">
        {!revealed ? <div className="bayes-prompt"><span aria-hidden="true">P(A | B)</span><h3>Evidence changes the odds.</h3><p>{step === 0 ? (grid ? 'Estimate first. Then watch the cases that did not produce the evidence drop away.' : r.visualization === 'frequency-bars' ? 'Estimate first. Then compare how many cases in each group match the evidence.' : 'Estimate first. Then follow the branches that match the evidence.') : 'The first answer is your new starting belief. Estimate again, then see which of those cases the next observation keeps.'}</p><div className="bayes-hint"><strong>A useful question</strong><p>Among all cases producing this evidence, how many belong to the group you are looking for?</p></div></div> : <div className="bayes-answer" key={`${round}-${step}`}>
          <span className="tools-eyebrow">UPDATED PROBABILITY</span><strong className="bayes-posterior">{answer.toFixed(1)}<small>%</small></strong><p className="bayes-error">Your estimate: {guess}% · <b>{error.toFixed(1)} pp {guess > answer ? 'too high' : guess < answer ? 'too low' : 'error'}</b></p>
          <h3>{grid || followGrid ? 'Watch the population shrink to the evidence.' : r.visualization === 'frequency-bars' ? 'Compare the groups that match the evidence.' : 'Follow the branches that match the evidence.'}</h3>
          <p>Start with {r.population.toLocaleString()} cases. Counts are expected frequencies; fractional cases are possible.{step === 1 ? ' Both observations are in.' : ''}</p>
          {grid && <PopulationGrid cells={grid} settled={settled} label={`${positives} ${r.subject} and ${falsePositives} ${r.others} still match the evidence.`} />}
          {followGrid && <PopulationGrid cells={followGrid} settled={settled} label={`${positives} ${r.subject} and ${falsePositives} ${r.others} match both observations. Dimmed cells matched only the first.`} />}
          {!grid && !followGrid && r.visualization !== 'frequency-bars' && <ProbabilityTree population={step === 0 ? r.population : evidenceSplit(r.population, r.prior, [r.evidence]).positives + evidenceSplit(r.population, r.prior, [r.evidence]).falsePositives} prior={belief} sensitivity={likelihood.sensitivity} falsePositive={likelihood.falsePositive} subject={r.subject} others={r.others} settled={settled} />}
          {r.visualization === 'frequency-bars' && <div aria-label="Expected cases matching the evidence"><p>Expected matching cases by group</p><label>{r.subject}<meter min={0} max={Math.max(positives, falsePositives, 1)} value={positives} /></label><label>{r.others}<meter min={0} max={Math.max(positives, falsePositives, 1)} value={falsePositives} /></label></div>}
          <div className="bayes-frequency"><div><i /><span>{r.subject}</span><strong>{positives.toLocaleString()}</strong></div><div><i /><span>{r.others}</span><strong>{falsePositives.toLocaleString()}</strong></div></div>
          <div className="bayes-ratio" role="img" aria-label={`${answer.toFixed(1)} percent of cases with the evidence belong to the target group`}><i style={{ '--portion': `${answer}%` } as CSSProperties} /></div>
          <p className="bayes-fraction"><b>{positives.toLocaleString()}</b> ÷ ({positives.toLocaleString()} + {falsePositives.toLocaleString()}) = <b>{answer.toFixed(1)}%</b></p>
          <p>The denominator includes <em>everyone</em> who produced the evidence, including false positives.</p>
          <details className="bayes-formula"><summary>See Bayes’ formula</summary><p>P(A | B) = P(B | A)P(A) / [P(B | A)P(A) + P(B | not A)P(not A)]</p><p>({likelihood.sensitivity} × {belief.toFixed(3)}) / [({likelihood.sensitivity} × {belief.toFixed(3)}) + ({likelihood.falsePositive} × {(1 - belief).toFixed(3)})]</p></details>
        </div>}
      </aside>
    </div>}
  </>
}

function followUpCells(r: typeof BAYES_ROUNDS[number]): FollowCell[] | null {
  const follow = r.followUp
  if (!follow) return null
  const first = evidenceSplit(r.population, r.prior, [r.evidence])
  const keepPositive = first.positives * follow.sensitivity
  const keepFalse = first.falsePositives * follow.falsePositive
  const counts = [keepPositive, first.positives - keepPositive, keepFalse, first.falsePositives - keepFalse]
  if (counts.some(n => Math.abs(n - Math.round(n)) > 1e-9 || n < 0) || counts.reduce((a, b) => a + b, 0) > 100) return null
  return cellsFrom(counts, ['positive', 'dropped-positive', 'false', 'dropped-false']) as FollowCell[]
}

function PopulationGrid({ cells, settled, label }: { cells: (BayesCell | FollowCell)[]; settled: boolean; label: string }) {
  return <div className={`bayes-grid${settled ? ' is-filtered' : ''}`} role="img" aria-label={label}>
    {cells.map((kind, i) => <i key={i} className={`is-${kind}`} style={{ '--i': i } as CSSProperties} />)}
  </div>
}

function ProbabilityTree({ population, prior, sensitivity, falsePositive, subject, others, settled }: { population: number; prior: number; sensitivity: number; falsePositive: number; subject: string; others: string; settled: boolean }) {
  const inGroup = population * prior
  const outGroup = population - inGroup
  const leaves = [
    { n: inGroup * sensitivity, label: subject, keep: true },
    { n: inGroup * (1 - sensitivity), label: `no evidence`, keep: false },
    { n: outGroup * falsePositive, label: others, keep: true },
    { n: outGroup * (1 - falsePositive), label: `no evidence`, keep: false },
  ]
  return <div className={`bayes-tree${settled ? ' is-filtered' : ''}`}>
    <div className="bayes-tree-root"><b>{population.toLocaleString()}</b><span>cases</span></div>
    <div className="bayes-tree-split">
      <div><b>{inGroup.toLocaleString()}</b><span>{subject}</span><div className="bayes-tree-leaves">{leaves.slice(0, 2).map(leaf => <div key={leaf.label + leaf.n} className={leaf.keep ? 'is-keep' : 'is-drop'}><b>{leaf.n.toLocaleString()}</b><span>{leaf.keep ? 'evidence observed' : leaf.label}</span></div>)}</div></div>
      <div><b>{outGroup.toLocaleString()}</b><span>{others}</span><div className="bayes-tree-leaves">{leaves.slice(2).map(leaf => <div key={leaf.label + String(leaf.keep)} className={leaf.keep ? 'is-keep' : 'is-drop'}><b>{leaf.n.toLocaleString()}</b><span>{leaf.keep ? 'evidence observed' : leaf.label}</span></div>)}</div></div>
    </div>
  </div>
}
