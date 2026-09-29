import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTION, optionPrice } from './options-pricing'

describe('European option pricing', () => {
  it('matches the standard Black–Scholes benchmark', () => {
    expect(optionPrice(DEFAULT_OPTION, 'call')).toBeCloseTo(10.4506, 4)
    expect(optionPrice(DEFAULT_OPTION, 'put')).toBeCloseTo(5.5735, 4)
  })
  it('satisfies dividend-adjusted put-call parity including negative rates', () => {
    for (const rate of [-2, 0, 5]) {
      const p = { ...DEFAULT_OPTION, yield: 3, rate, days: 180 }
      expect(optionPrice(p, 'call') - optionPrice(p, 'put')).toBeCloseTo(p.spot * Math.exp(-.03 * p.days / 365) - p.strike * Math.exp(-rate / 100 * p.days / 365), 8)
    }
  })
  it('handles expiry and deterministic terminal prices', () => {
    expect(optionPrice({ ...DEFAULT_OPTION, spot: 120, days: 0 }, 'call')).toBe(20)
    expect(optionPrice({ ...DEFAULT_OPTION, spot: 80, days: 0 }, 'put')).toBe(20)
    expect(optionPrice({ ...DEFAULT_OPTION, volatility: 0 }, 'call')).toBeCloseTo(100 - 100 * Math.exp(-.05), 8)
  })
  it('rejects invalid inputs and increases with volatility', () => {
    expect(() => optionPrice({ ...DEFAULT_OPTION, spot: 0 }, 'call')).toThrow(RangeError)
    expect(optionPrice({ ...DEFAULT_OPTION, volatility: 40 }, 'call')).toBeGreaterThan(optionPrice(DEFAULT_OPTION, 'call'))
  })
})
