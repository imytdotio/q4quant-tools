import scenarios from '@/data/practice/bayes-scenarios.json'
export type BayesLikelihood = { sensitivity: number; falsePositive: number }
export type BayesCell = 'positive' | 'missed' | 'false' | 'clear'
export type BayesEvidence = BayesLikelihood & { label: string }
export type BayesRound = {
  id: string
  visualization: 'population-grid' | 'probability-tree' | 'frequency-bars'
  title: string
  category: string
  prior: number
  population: number
  subject: string
  others: string
  question: string
  note: string
  evidence: BayesEvidence
  followUp?: BayesEvidence & { question: string; independence: string }
}

export function bayesPosterior(prior: number, sensitivity: number, falsePositive: number) {
  if ([prior, sensitivity, falsePositive].some(p => !Number.isFinite(p) || p < 0 || p > 1)) throw new RangeError('Probabilities must be between zero and one')
  const positive = prior * sensitivity, other = (1 - prior) * falsePositive
  if (positive + other === 0) return null
  return positive / (positive + other)
}

export function sequentialPosterior(prior: number, steps: BayesLikelihood[]) {
  return steps.reduce<number | null>((p, step) => p === null ? null : bayesPosterior(p, step.sensitivity, step.falsePositive), prior)
}

export function evidenceSplit(population: number, prior: number, steps: BayesLikelihood[]) {
  return {
    positives: steps.reduce((n, step) => n * step.sensitivity, population * prior),
    falsePositives: steps.reduce((n, step) => n * step.falsePositive, population * (1 - prior)),
  }
}

function whole(n: number) {
  return Math.abs(n - Math.round(n)) < 1e-9
}

export function populationCells(population: number, prior: number, sensitivity: number, falsePositive: number): BayesCell[] | null {
  if (population !== 100) return null
  const subject = population * prior
  const positives = subject * sensitivity
  const missed = subject - positives
  const falsePositives = (population - subject) * falsePositive
  const clear = population - subject - falsePositives
  const counts = [positives, missed, falsePositives, clear]
  if (counts.some(n => !whole(n) || n < 0)) return null
  const kinds: BayesCell[] = ['positive', 'missed', 'false', 'clear']
  return counts.flatMap((n, i) => Array<BayesCell>(Math.round(n)).fill(kinds[i]))
}

export const BAYES_ROUNDS: BayesRound[] = scenarios as BayesRound[]

export function validBayesRound(value: unknown): value is BayesRound {
  if (!value || typeof value !== 'object') return false
  const r = value as BayesRound
  const text = (s: unknown) => typeof s === 'string' && s.trim().length > 0
  const probability = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1
  const evidence = (e: BayesEvidence) => e && text(e.label) && probability(e.sensitivity) && probability(e.falsePositive)
  if (![r.id, r.title, r.category, r.subject, r.others, r.question, r.note].every(text) || !probability(r.prior) || !Number.isSafeInteger(r.population) || r.population < 1 || r.population > 1e7 || !evidence(r.evidence)) return false
  if (!['population-grid', 'probability-tree', 'frequency-bars'].includes(r.visualization)) return false
  if (r.followUp && (!evidence(r.followUp) || !text(r.followUp.question) || !text(r.followUp.independence))) return false
  if (sequentialPosterior(r.prior, [r.evidence, ...(r.followUp ? [r.followUp] : [])]) === null) return false
  return r.visualization !== 'population-grid' || populationCells(r.population, r.prior, r.evidence.sensitivity, r.evidence.falsePositive) !== null
}

export function sampleBayesRounds(rounds: BayesRound[], random: () => number = Math.random, count = 6) {
  const shuffled = [...rounds]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, count)
}
