export type SurfaceShape = { atm: number; skew: number; curvature: number; term: number }

/** Illustrative annualised volatility in percent; not an arbitrage-free calibration. */
export function surfaceVolatility(strikeRatio: number, years: number, shape: SurfaceShape) {
  const m = strikeRatio - 1
  return shape.atm * Math.exp(shape.term * (years - 1) +
    (shape.skew * m + shape.curvature * m * m) / Math.sqrt(years + .25))
}

export function projectSurface(x: number, t: number, z: number, yaw: number, tilt: number) {
  const a = x * 175, b = t * 130
  const depth = a * Math.sin(yaw) + b * Math.cos(yaw)
  return { x: 380 + a * Math.cos(yaw) - b * Math.sin(yaw), y: 300 + depth * Math.sin(tilt) - z * 210 * Math.cos(tilt), depth }
}
