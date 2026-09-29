export type OptionInputs = { spot: number; strike: number; days: number; volatility: number; rate: number; yield: number }
export type OptionKind = 'call' | 'put'
export const DEFAULT_OPTION: OptionInputs = { spot: 100, strike: 100, days: 365, volatility: 20, rate: 5, yield: 0 }

// Abramowitz–Stegun normal CDF approximation (absolute error < 7.5e-8).
function normalCDF(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t *
    (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - tail : tail
}

/** European options; continuously compounded rate/yield, annual volatility, ACT/365. */
export function optionPrice(input: OptionInputs, kind: OptionKind): number {
  const { spot, strike, days, volatility, rate, yield: dividend } = input
  if (!Object.values(input).every(Number.isFinite) || spot <= 0 || strike <= 0 || days < 0 || volatility < 0) {
    throw new RangeError('Prices must be positive; time and volatility must be nonnegative and inputs finite.')
  }
  const sign = kind === 'call' ? 1 : -1
  if (days === 0) return Math.max(sign * (spot - strike), 0)
  const t = days / 365, sigma = volatility / 100
  const s = spot * Math.exp(-dividend / 100 * t), k = strike * Math.exp(-rate / 100 * t)
  if (sigma === 0) return Math.max(sign * (s - k), 0)
  const d1 = (Math.log(spot / strike) + ((rate - dividend) / 100 + sigma * sigma / 2) * t) / (sigma * Math.sqrt(t))
  const d2 = d1 - sigma * Math.sqrt(t)
  return Math.max(0, sign * (s * normalCDF(sign * d1) - k * normalCDF(sign * d2)))
}
