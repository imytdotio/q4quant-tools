import { describe, expect, it } from 'vitest'
import { BAYES_ROUNDS, validBayesRound, sampleBayesRounds } from './bayes'
import { MARKET_SCENARIOS, validMarketScenario, createBook, nextMarketEvent, executeOrder, cancelUserOrders } from './orderbook'
import { reviewDecision } from './orderbook-review'
import { seededRandom } from './poker'

describe('published practice banks', () => {
  it('validates every scenario and samples without replacement', () => {
    expect(BAYES_ROUNDS.length).toBeGreaterThanOrEqual(24)
    expect(BAYES_ROUNDS.every(validBayesRound)).toBe(true)
    expect(MARKET_SCENARIOS.every(validMarketScenario)).toBe(true)
    const sample = sampleBayesRounds(BAYES_ROUNDS, seededRandom(3))
    expect(new Set(sample.map(r => r.id)).size).toBe(6)
    expect(sample).toEqual(sampleBayesRounds(BAYES_ROUNDS, seededRandom(3)))
    expect(sample).not.toEqual(sampleBayesRounds(BAYES_ROUNDS, seededRandom(4)))
  })
  it('rejects malformed probabilities, unsupported visualizers and impossible evidence', () => {
    expect(validBayesRound({ ...BAYES_ROUNDS[0], prior: NaN })).toBe(false)
    expect(validBayesRound({ ...BAYES_ROUNDS[0], visualization: 'unknown' })).toBe(false)
    expect(validBayesRound({ ...BAYES_ROUNDS[0], evidence: { label: 'impossible', sensitivity: 0, falsePositive: 0 } })).toBe(false)
    expect(validMarketScenario({ ...MARKET_SCENARIOS[0], joinProbability: 1, cancelProbability: 1 })).toBe(false)
  })
})

it('replays seeds and preserves uncrossed, positive books through varied flow', () => {
  for (const scenario of MARKET_SCENARIOS) {
    const a = seededRandom(42), b = seededRandom(42)
    let book = createBook('normal')
    for (let i = 0; i < 500; i++) {
      const event = nextMarketEvent(book, a, scenario)
      expect(event).toEqual(nextMarketEvent(book, b, scenario))
      book = event.book
      if (book.bids.length && book.asks.length) expect(book.bids[0].price).toBeLessThan(book.asks[0].price)
      for (const level of [...book.bids, ...book.asks]) {
        expect(level.price).toBeGreaterThan(0)
        expect(level.quantity).toBeGreaterThan(0)
        expect(Number.isInteger(level.quantity)).toBe(true)
        expect(level.yours ?? 0).toBeLessThanOrEqual(level.quantity)
      }
      expect(event.elapsedSeconds).toBeGreaterThanOrEqual(0)
    }
  }
})

it('reviews the current book without mutating it or reading the live random stream', () => {
  const book = createBook('thin'), before = structuredClone(book)
  const order = { side: 'buy' as const, kind: 'market' as const, quantity: 20 }
  const review = reviewDecision(book, 'buy', 20, MARKET_SCENARIOS[0], { label: 'Chosen', order }, 40)
  expect(book).toEqual(before)
  expect(review).toEqual(reviewDecision(book, 'buy', 20, MARKET_SCENARIOS[0], { label: 'Chosen', order }, 40))
  expect(review.estimates.find(e => e.label === 'Chosen')?.cost).toBe(review.estimates.find(e => e.label === 'Trade now')?.cost)
  expect(review.estimates.every(e => Number.isFinite(e.cost) && e.filledPercent >= 0 && e.filledPercent <= 100)).toBe(true)
  const resting = executeOrder(book, { ...order, kind: 'limit', limitPrice: 99.7 }).book
  expect(cancelUserOrders(resting)).toEqual(book)
  const kept = reviewDecision(resting, 'buy', 20, MARKET_SCENARIOS[0], { label: 'Keep', order: null, keepResting: true }, 40)
  expect(kept.estimates.every(e => e.filledPercent <= 100)).toBe(true)
})
