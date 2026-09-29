import { expect, it } from 'vitest'
import { surfaceVolatility, projectSurface } from './volatility-surface'
const shape = { atm: 20, skew: -.6, curvature: 3, term: .1 }
it('anchors one-year ATM and produces a flat surface with zero shape parameters', () => {
  expect(surfaceVolatility(1, 1, shape)).toBe(20)
  for (const t of [.083333, 1, 2]) for (const k of [.6, 1, 1.4]) {
    expect(surfaceVolatility(k, t, { atm: 20, skew: 0, curvature: 0, term: 0 })).toBe(20)
  }
})
it('keeps the surface positive with a steeper short-dated smile', () => {
  expect(surfaceVolatility(.6, .083333, shape)).toBeGreaterThan(surfaceVolatility(.6, 2, shape))
  expect(surfaceVolatility(1.4, 2, shape)).toBeGreaterThan(0)
})
it('rotates all three dimensions into finite screen coordinates', () => {
  const p = projectSurface(1, 1, .5, .65, .55)
  expect(Object.values(p).every(Number.isFinite)).toBe(true)
  expect(projectSurface(1, 1, .5, 1, .55).x).not.toBe(p.x)
  expect(projectSurface(1, 1, 1, .65, .55).y).toBeLessThan(p.y)
})
