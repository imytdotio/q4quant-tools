import { expect, it } from 'vitest'
import { BAYES_ROUNDS, bayesPosterior, evidenceSplit, populationCells, sequentialPosterior } from './bayes'
it('updates the prior using both true and false positives', () => {
  expect(bayesPosterior(.2,.8,.1)).toBeCloseTo(2/3,12)
  expect(bayesPosterior(.01,.9,.05)).toBeCloseTo(.009/.0585,12)
})
it('handles uninformative evidence and impossible observations', () => {
  expect(bayesPosterior(.3,.5,.5)).toBeCloseTo(.3,12)
  expect(bayesPosterior(.3,1,0)).toBe(1)
  expect(bayesPosterior(0,1,.1)).toBe(0)
  expect(bayesPosterior(.3,0,0)).toBeNull()
  expect(()=>bayesPosterior(-.1,.5,.1)).toThrow(RangeError)
})
it('all rounds support consistent whole-number frequency explanations', () => {
  for (const r of BAYES_ROUNDS) {
    const steps = [r.evidence, ...(r.followUp ? [r.followUp] : [])]
    const split = evidenceSplit(r.population, r.prior, steps)
    expect(split.positives).toBe(Math.round(split.positives))
    expect(split.falsePositives).toBe(Math.round(split.falsePositives))
    expect(sequentialPosterior(r.prior, steps)).toBeCloseTo(split.positives / (split.positives + split.falsePositives), 12)
  }
})
it('starts with coloured balls, then a noisy signal, then a second observation', () => {
  expect(BAYES_ROUNDS[0].category).toBe('Coloured balls')
  expect(BAYES_ROUNDS[0].followUp?.independence).toMatch(/given which bag/i)
  const signal = BAYES_ROUNDS.find(r => r.prior === .2 && r.evidence.sensitivity === .8 && r.evidence.falsePositive === .1)
  expect(signal?.followUp).toMatchObject({ sensitivity: .75, falsePositive: .25 })
  expect(signal?.followUp?.independence).toMatch(/given whether the asset is undervalued/i)
})
it('updates a second conditionally independent signal from the posterior', () => {
  const first = bayesPosterior(.2, .8, .1)!
  expect(bayesPosterior(first, .75, .25)).toBeCloseTo(12 / 14, 12)
  expect(sequentialPosterior(.2, [
    { sensitivity: .8, falsePositive: .1 },
    { sensitivity: .75, falsePositive: .25 },
  ])).toBeCloseTo(12 / 14, 12)
  expect(evidenceSplit(100, .2, [
    { sensitivity: .8, falsePositive: .1 },
    { sensitivity: .75, falsePositive: .25 },
  ])).toEqual({ positives: 12, falsePositives: 2 })
})
it('lays out a 100-case grid and refuses a grid that cannot show whole cases', () => {
  const cells = populationCells(100, .2, .8, .1)!
  expect(cells.filter(c => c === 'positive')).toHaveLength(16)
  expect(cells.filter(c => c === 'false')).toHaveLength(8)
  expect(cells.filter(c => c === 'missed')).toHaveLength(4)
  expect(cells.filter(c => c === 'clear')).toHaveLength(72)
  expect(populationCells(10000, .01, .9, .05)).toBeNull()
})
