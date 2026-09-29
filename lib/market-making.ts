import { RANKS, seededRandom, shuffledDeck } from './poker'

// A classic trading-interview game: make a two-sided market on the sum of four dice or four cards.
// Items 1-3 are revealed publicly as play goes on. Item 4 is seen only by an insider,
// and every arrival is either that insider or an uninformed (noise) trader.

export const ITEM_COUNT = 4
export const QUOTES_PER_REVEAL = 2
export const TOTAL_QUOTES = 8
export const MAX_SIZE = 5
/** Dice-game widths; each source scales them by how much one hidden item can move the sum. */
const BASE_MAX_WIDTH = 4
const BASE_BENCHMARK_HALF_WIDTH = 1

export type SourceId = 'dice' | 'cards'
export type Source = {
  id: SourceId
  label: string
  noun: string
  nounPlural: string
  /** Multiplies the dice-game widths: a card's rank is about twice as uncertain as a die. */
  scale: number
  maxWidth: number
  benchmarkHalfWidth: number
  min: number
  max: number
  /** Raw items: die faces 1-6, or card indices 0-51 as in lib/poker. */
  deal: (random: () => number) => number[]
  value: (item: number) => number
  /** Expected value of one unseen item, given the values of the items already known. */
  unseenMean: (known: number[]) => number
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)
const cents = (n: number) => Math.round(n * 100) / 100

export const DIE_MEAN = 3.5
/** Card values: ace 1, two to ten at face value, jack 11, queen 12, king 13. */
export const cardValue = (card: number) => card % 13 === RANKS.length - 1 ? 1 : card % 13 + 2
const DECK_SIZE = 52
const DECK_TOTAL = 4 * 91

const source = (s: Omit<Source, 'maxWidth' | 'benchmarkHalfWidth'>): Source =>
  ({ ...s, maxWidth: BASE_MAX_WIDTH * s.scale, benchmarkHalfWidth: BASE_BENCHMARK_HALF_WIDTH * s.scale })

export const SOURCES: Source[] = [
  source({
    id: 'dice', label: 'Dice', noun: 'die', nounPlural: 'dice', scale: 1, min: ITEM_COUNT, max: 6 * ITEM_COUNT,
    deal: random => Array.from({ length: ITEM_COUNT }, () => 1 + Math.floor(random() * 6)),
    value: die => die,
    unseenMean: () => DIE_MEAN,
  }),
  source({
    id: 'cards', label: 'Cards', noun: 'card', nounPlural: 'cards', scale: 2, min: ITEM_COUNT, max: 13 * ITEM_COUNT,
    deal: random => shuffledDeck(random).slice(0, ITEM_COUNT),
    value: cardValue,
    // Cards are dealt without replacement, so every known card shifts the average of what is left.
    unseenMean: known => (DECK_TOTAL - sum(known)) / (DECK_SIZE - known.length),
  }),
]
export const DICE = SOURCES[0]
export const CARDS = SOURCES[1]

export type FlowProfileId = 'calm' | 'standard' | 'toxic'
export type FlowProfile = { id: FlowProfileId; label: string; informedShare: number; description: string }
export const FLOW_PROFILES: FlowProfile[] = [
  { id: 'calm', label: 'Calm', informedShare: .25, description: 'About one arrival in four is the insider.' },
  { id: 'standard', label: 'Standard', informedShare: .4, description: 'About two arrivals in five are the insider.' },
  { id: 'toxic', label: 'Toxic', informedShare: .6, description: 'Most arrivals are the insider. Tight markets get picked off.' },
]

export type Quote = { bid: number; ask: number; size: number }
export type Arrival = { informed: boolean; noiseSide: 'buy' | 'sell'; noiseDraw: number }
export type Game = { source: Source; items: number[]; values: number[]; arrivals: Arrival[]; profile: FlowProfile }
/** Sides are from the market maker's point of view: 'buy' means the counterparty hit your bid. */
export type Trade = { makerSide: 'buy' | 'sell'; price: number; size: number }
export type StepResult = {
  step: number
  quote: Quote
  trader: 'informed' | 'noise'
  trade: Trade | null
  /** Dice publicly revealed while this quote was live. */
  revealed: number
  publicFair: number
  insiderValue: number
}

export function createGame(seed: number, profile: FlowProfile, source: Source = DICE): Game {
  const random = seededRandom(seed)
  const items = source.deal(random)
  const arrivals = Array.from({ length: TOTAL_QUOTES }, (): Arrival => ({
    informed: random() < profile.informedShare,
    noiseSide: random() < .5 ? 'buy' : 'sell',
    noiseDraw: random(),
  }))
  return { source, items, values: items.map(source.value), arrivals, profile }
}

/** Public items revealed before quote `step` (0-based). The insider's item is never revealed before settlement. */
export const revealedBefore = (step: number) => Math.min(ITEM_COUNT - 1, Math.floor(step / QUOTES_PER_REVEAL))

/** Expected sum given only the publicly revealed items. */
export function publicFair(values: number[], revealed: number, source: Source = DICE) {
  const known = values.slice(0, revealed)
  return sum(known) + source.unseenMean(known) * (ITEM_COUNT - revealed)
}

/** Expected sum given the public items plus the insider's private one. */
export function insiderValue(values: number[], revealed: number, source: Source = DICE) {
  const known = [...values.slice(0, revealed), values[ITEM_COUNT - 1]]
  return sum(known) + source.unseenMean(known) * (ITEM_COUNT - 1 - revealed)
}

export const settlementValue = (values: number[]) => sum(values)

/** Uninformed traders are price-sensitive: the wider the market, the less often they trade. */
export function noiseTradeProbability(width: number, source: Source = DICE) {
  return Math.min(1, Math.max(.25, 1.25 - width / source.maxWidth))
}

export function validateQuote(quote: Quote, source: Source = DICE): string | null {
  const { bid, ask, size } = quote
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return 'Enter a number for both the bid and the ask.'
  if (bid < 0) return 'The bid cannot be negative.'
  if (bid >= ask) return 'Your bid must be below your ask.'
  if (ask - bid > source.maxWidth + 1e-9) return `Your market can be at most $${source.maxWidth} wide.`
  if (!Number.isInteger(size) || size < 1 || size > MAX_SIZE) return `Size must be a whole number from 1 to ${MAX_SIZE}.`
  return null
}

export function counterpartyTrade(arrival: Arrival, quote: Quote, insider: number, source: Source = DICE): { trader: StepResult['trader']; trade: Trade | null } {
  const sell: Trade = { makerSide: 'sell', price: quote.ask, size: quote.size }
  const buy: Trade = { makerSide: 'buy', price: quote.bid, size: quote.size }
  if (arrival.informed) return { trader: 'informed', trade: insider > quote.ask ? sell : insider < quote.bid ? buy : null }
  if (arrival.noiseDraw >= noiseTradeProbability(quote.ask - quote.bid, source)) return { trader: 'noise', trade: null }
  return { trader: 'noise', trade: arrival.noiseSide === 'buy' ? sell : buy }
}

export function playQuote(game: Game, step: number, rawQuote: Quote): StepResult {
  if (step < 0 || step >= TOTAL_QUOTES) throw new RangeError(`Quote ${step} is outside the game.`)
  const quote = { bid: cents(rawQuote.bid), ask: cents(rawQuote.ask), size: rawQuote.size }
  const error = validateQuote(quote, game.source)
  if (error) throw new Error(error)
  const revealed = revealedBefore(step)
  const insider = insiderValue(game.values, revealed, game.source)
  const { trader, trade } = counterpartyTrade(game.arrivals[step], quote, insider, game.source)
  return { step, quote, trader, trade, revealed, publicFair: publicFair(game.values, revealed, game.source), insiderValue: insider }
}

export const signedSize = (trade: Trade) => trade.makerSide === 'buy' ? trade.size : -trade.size

export function position(results: StepResult[]) {
  let inventory = 0, cash = 0
  for (const { trade } of results) {
    if (!trade) continue
    inventory += signedSize(trade)
    cash -= signedSize(trade) * trade.price
  }
  return { inventory, cash: cents(cash) }
}

export function tradePnl(result: StepResult, settlement: number) {
  return result.trade ? signedSize(result.trade) * (settlement - result.trade.price) : 0
}

export type GameSummary = {
  settlement: number
  pnl: number
  /** Edge versus public fair value at the moment of each trade. */
  spread: number
  /** What the insider's private item was worth against you. */
  information: number
  /** Items that nobody knew yet when you traded. */
  luck: number
  informedTrades: number
  noiseTrades: number
  informedPnl: number
  noisePnl: number
  benchmarkPnl: number
  meanMidError: number
}

export function summarize(game: Game, results: StepResult[]): GameSummary {
  const settlement = settlementValue(game.values)
  const half = game.source.benchmarkHalfWidth
  let spread = 0, information = 0, luck = 0, informedTrades = 0, noiseTrades = 0, informedPnl = 0, noisePnl = 0, benchmarkPnl = 0
  for (const r of results) {
    const benchmark = counterpartyTrade(game.arrivals[r.step], { bid: r.publicFair - half, ask: r.publicFair + half, size: r.quote.size }, r.insiderValue, game.source)
    if (benchmark.trade) benchmarkPnl += signedSize(benchmark.trade) * (settlement - benchmark.trade.price)
    if (!r.trade) continue
    const q = signedSize(r.trade), pnl = q * (settlement - r.trade.price)
    spread += q * (r.publicFair - r.trade.price)
    information += q * (r.insiderValue - r.publicFair)
    luck += q * (settlement - r.insiderValue)
    if (r.trader === 'informed') { informedTrades++; informedPnl += pnl } else { noiseTrades++; noisePnl += pnl }
  }
  const pnl = cents(spread + information + luck)
  const meanMidError = results.length ? sum(results.map(r => Math.abs((r.quote.bid + r.quote.ask) / 2 - r.publicFair))) / results.length : 0
  return {
    settlement,
    pnl,
    // Luck absorbs the rounding so the three buckets always add up to the P&L shown.
    spread: cents(spread), information: cents(information), luck: cents(pnl - cents(spread) - cents(information)),
    informedTrades, noiseTrades, informedPnl: cents(informedPnl), noisePnl: cents(noisePnl),
    benchmarkPnl: cents(benchmarkPnl), meanMidError: cents(meanMidError),
  }
}
