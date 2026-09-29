import { seededRandom } from './poker'

// A classic trading-interview game: make a two-sided market on the sum of four dice.
// Dice 1-3 are revealed publicly as play goes on. Die 4 is seen only by an insider,
// and every arrival is either that insider or an uninformed (noise) trader.

export const DICE_COUNT = 4
export const DIE_MEAN = 3.5
export const QUOTES_PER_REVEAL = 2
export const TOTAL_QUOTES = 8
export const MAX_WIDTH = 4
export const MAX_SIZE = 5
export const BENCHMARK_HALF_WIDTH = 1

export type FlowProfileId = 'calm' | 'standard' | 'toxic'
export type FlowProfile = { id: FlowProfileId; label: string; informedShare: number; description: string }
export const FLOW_PROFILES: FlowProfile[] = [
  { id: 'calm', label: 'Calm', informedShare: .25, description: 'About one arrival in four is the insider.' },
  { id: 'standard', label: 'Standard', informedShare: .4, description: 'About two arrivals in five are the insider.' },
  { id: 'toxic', label: 'Toxic', informedShare: .6, description: 'Most arrivals are the insider. Tight markets get picked off.' },
]

export type Quote = { bid: number; ask: number; size: number }
export type Arrival = { informed: boolean; noiseSide: 'buy' | 'sell'; noiseDraw: number }
export type Game = { dice: number[]; arrivals: Arrival[]; profile: FlowProfile }
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

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)
const cents = (n: number) => Math.round(n * 100) / 100

export function createGame(seed: number, profile: FlowProfile): Game {
  const random = seededRandom(seed)
  const dice = Array.from({ length: DICE_COUNT }, () => 1 + Math.floor(random() * 6))
  const arrivals = Array.from({ length: TOTAL_QUOTES }, (): Arrival => ({
    informed: random() < profile.informedShare,
    noiseSide: random() < .5 ? 'buy' : 'sell',
    noiseDraw: random(),
  }))
  return { dice, arrivals, profile }
}

/** Public dice revealed before quote `step` (0-based). The insider's die is never revealed before settlement. */
export const revealedBefore = (step: number) => Math.min(DICE_COUNT - 1, Math.floor(step / QUOTES_PER_REVEAL))

/** Expected sum given only the publicly revealed dice. */
export function publicFair(dice: number[], revealed: number) {
  return sum(dice.slice(0, revealed)) + DIE_MEAN * (DICE_COUNT - revealed)
}

/** Expected sum given the public dice plus the insider's private die. */
export function insiderValue(dice: number[], revealed: number) {
  return sum(dice.slice(0, revealed)) + dice[DICE_COUNT - 1] + DIE_MEAN * (DICE_COUNT - 1 - revealed)
}

export const settlementValue = (dice: number[]) => sum(dice)

/** Uninformed traders are price-sensitive: the wider the market, the less often they trade. */
export function noiseTradeProbability(width: number) {
  return Math.min(1, Math.max(.25, 1.25 - width / 4))
}

export function validateQuote(quote: Quote): string | null {
  const { bid, ask, size } = quote
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return 'Enter a number for both the bid and the ask.'
  if (bid < 0) return 'The bid cannot be negative.'
  if (bid >= ask) return 'Your bid must be below your ask.'
  if (ask - bid > MAX_WIDTH + 1e-9) return `Your market can be at most $${MAX_WIDTH} wide.`
  if (!Number.isInteger(size) || size < 1 || size > MAX_SIZE) return `Size must be a whole number from 1 to ${MAX_SIZE}.`
  return null
}

export function counterpartyTrade(arrival: Arrival, quote: Quote, insider: number): { trader: StepResult['trader']; trade: Trade | null } {
  const sell: Trade = { makerSide: 'sell', price: quote.ask, size: quote.size }
  const buy: Trade = { makerSide: 'buy', price: quote.bid, size: quote.size }
  if (arrival.informed) return { trader: 'informed', trade: insider > quote.ask ? sell : insider < quote.bid ? buy : null }
  if (arrival.noiseDraw >= noiseTradeProbability(quote.ask - quote.bid)) return { trader: 'noise', trade: null }
  return { trader: 'noise', trade: arrival.noiseSide === 'buy' ? sell : buy }
}

export function playQuote(game: Game, step: number, rawQuote: Quote): StepResult {
  if (step < 0 || step >= TOTAL_QUOTES) throw new RangeError(`Quote ${step} is outside the game.`)
  const quote = { bid: cents(rawQuote.bid), ask: cents(rawQuote.ask), size: rawQuote.size }
  const error = validateQuote(quote)
  if (error) throw new Error(error)
  const revealed = revealedBefore(step)
  const insider = insiderValue(game.dice, revealed)
  const { trader, trade } = counterpartyTrade(game.arrivals[step], quote, insider)
  return { step, quote, trader, trade, revealed, publicFair: publicFair(game.dice, revealed), insiderValue: insider }
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
  /** What the insider's private die was worth against you. */
  information: number
  /** Dice that nobody knew yet when you traded. */
  luck: number
  informedTrades: number
  noiseTrades: number
  informedPnl: number
  noisePnl: number
  benchmarkPnl: number
  meanMidError: number
}

export function summarize(game: Game, results: StepResult[]): GameSummary {
  const settlement = settlementValue(game.dice)
  let spread = 0, information = 0, luck = 0, informedTrades = 0, noiseTrades = 0, informedPnl = 0, noisePnl = 0, benchmarkPnl = 0
  for (const r of results) {
    const benchmark = counterpartyTrade(game.arrivals[r.step], { bid: r.publicFair - BENCHMARK_HALF_WIDTH, ask: r.publicFair + BENCHMARK_HALF_WIDTH, size: r.quote.size }, r.insiderValue)
    if (benchmark.trade) benchmarkPnl += signedSize(benchmark.trade) * (settlement - benchmark.trade.price)
    if (!r.trade) continue
    const q = signedSize(r.trade), pnl = q * (settlement - r.trade.price)
    spread += q * (r.publicFair - r.trade.price)
    information += q * (r.insiderValue - r.publicFair)
    luck += q * (settlement - r.insiderValue)
    if (r.trader === 'informed') { informedTrades++; informedPnl += pnl } else { noiseTrades++; noisePnl += pnl }
  }
  const meanMidError = results.length ? sum(results.map(r => Math.abs((r.quote.bid + r.quote.ask) / 2 - r.publicFair))) / results.length : 0
  return {
    settlement,
    pnl: cents(spread + information + luck),
    spread: cents(spread), information: cents(information), luck: cents(luck),
    informedTrades, noiseTrades, informedPnl: cents(informedPnl), noisePnl: cents(noisePnl),
    benchmarkPnl: cents(benchmarkPnl), meanMidError: cents(meanMidError),
  }
}
