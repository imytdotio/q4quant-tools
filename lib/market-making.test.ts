import { describe, expect, it } from 'vitest'
import {
  FLOW_PROFILES, TOTAL_QUOTES, counterpartyTrade, createGame, insiderValue, noiseTradeProbability, playQuote,
  position, publicFair, revealedBefore, settlementValue, summarize, tradePnl, validateQuote, type Game, type StepResult,
} from './market-making'

const standard = FLOW_PROFILES.find(p => p.id === 'standard')!
const fixedGame = (informed: boolean[], dice = [6, 1, 3, 5]): Game => ({
  dice,
  profile: standard,
  arrivals: informed.map((flag, i) => ({ informed: flag, noiseSide: i % 2 ? 'sell' : 'buy', noiseDraw: 0 })),
})

describe('market-making game', () => {
  it('deals the same game for the same seed', () => {
    const a = createGame(42, standard), b = createGame(42, standard)
    expect(a).toEqual(b)
    expect(a.dice).toHaveLength(4)
    expect(a.dice.every(d => Number.isInteger(d) && d >= 1 && d <= 6)).toBe(true)
    expect(a.arrivals).toHaveLength(TOTAL_QUOTES)
  })

  it('reveals one public die every two quotes and never the insider die', () => {
    expect(Array.from({ length: TOTAL_QUOTES }, (_, i) => revealedBefore(i))).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  })

  it('computes public and insider expectations', () => {
    const dice = [6, 1, 3, 5]
    expect(publicFair(dice, 0)).toBe(14)
    expect(publicFair(dice, 2)).toBe(14)
    expect(publicFair(dice, 3)).toBe(13.5)
    expect(insiderValue(dice, 0)).toBe(15.5)
    expect(insiderValue(dice, 3)).toBe(15)
    expect(settlementValue(dice)).toBe(15)
  })

  it('lets the insider trade only against a mispriced market', () => {
    const insider = { informed: true, noiseSide: 'buy' as const, noiseDraw: 0 }
    expect(counterpartyTrade(insider, { bid: 13, ask: 15, size: 2 }, 15.5).trade).toEqual({ makerSide: 'sell', price: 15, size: 2 })
    expect(counterpartyTrade(insider, { bid: 16, ask: 18, size: 1 }, 15.5).trade).toEqual({ makerSide: 'buy', price: 16, size: 1 })
    expect(counterpartyTrade(insider, { bid: 14, ask: 16, size: 1 }, 15.5).trade).toBeNull()
  })

  it('makes noise traders less active as the market widens', () => {
    expect(noiseTradeProbability(.5)).toBe(1)
    expect(noiseTradeProbability(2)).toBe(.75)
    expect(noiseTradeProbability(4)).toBe(.25)
    const wide = { informed: false, noiseSide: 'buy' as const, noiseDraw: .5 }
    expect(counterpartyTrade(wide, { bid: 12, ask: 16, size: 1 }, 14).trade).toBeNull()
    expect(counterpartyTrade(wide, { bid: 13, ask: 15, size: 1 }, 14).trade).toEqual({ makerSide: 'sell', price: 15, size: 1 })
  })

  it('rejects invalid quotes', () => {
    expect(validateQuote({ bid: 15, ask: 14, size: 1 })).toMatch(/below/)
    expect(validateQuote({ bid: 10, ask: 14.5, size: 1 })).toMatch(/at most/)
    expect(validateQuote({ bid: 12, ask: 16, size: 6 })).toMatch(/Size/)
    expect(validateQuote({ bid: Number.NaN, ask: 16, size: 1 })).toMatch(/number/)
    expect(validateQuote({ bid: 12, ask: 16, size: 5 })).toBeNull()
    expect(() => playQuote(fixedGame([true]), 0, { bid: 15, ask: 14, size: 1 })).toThrow()
  })

  it('decomposes P&L exactly into spread, information and luck', () => {
    const game = fixedGame([true, false, true, false, true, false, true, false])
    const quotes = [[13, 15], [13, 15], [12, 14], [13.5, 15.5], [11, 13], [14, 16], [12.5, 14.5], [13, 14]]
    const results: StepResult[] = quotes.map(([bid, ask], step) => playQuote(game, step, { bid, ask, size: 1 + (step % 3) }))
    const summary = summarize(game, results)
    const direct = results.reduce((total, r) => total + tradePnl(r, summary.settlement), 0)
    expect(summary.pnl).toBeCloseTo(direct, 10)
    expect(summary.spread + summary.information + summary.luck).toBeCloseTo(summary.pnl, 10)
    expect(summary.informedPnl + summary.noisePnl).toBeCloseTo(summary.pnl, 10)
    const { inventory, cash } = position(results)
    expect(cash + inventory * summary.settlement).toBeCloseTo(summary.pnl, 10)
  })

  it('charges the insider edge to the information bucket', () => {
    // Insider holds a 6: every quote centred on public fair gets lifted.
    const game = fixedGame([true], [2, 2, 2, 6])
    const result = playQuote(game, 0, { bid: 13, ask: 15, size: 1 })
    expect(result.trade).toEqual({ makerSide: 'sell', price: 15, size: 1 })
    const summary = summarize(game, [result])
    expect(summary.spread).toBe(1)
    expect(summary.information).toBe(-2.5)
    // Sold at 15, settled at 12: +3 = +1 spread − 2.5 information + 4.5 luck.
    expect(summary.luck).toBe(4.5)
    expect(summary.pnl).toBe(3)
  })

  it('scores a fair-value ±1 benchmark on the same arrivals', () => {
    const game = fixedGame([false], [1, 1, 1, 1])
    const result = playQuote(game, 0, { bid: 10, ask: 11, size: 2 })
    // Noise buyer lifts the benchmark ask of 15 at size 2; the dice settle at 4, so selling at 15 makes 2 × 11.
    expect(summarize(game, [result]).benchmarkPnl).toBe(22)
  })
})
