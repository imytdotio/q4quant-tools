import { describe, expect, it } from 'vitest'
import { calculatePokerOdds, evaluateHand, handName, seededRandom, shuffledDeck } from './poker'
const c = (s: string) => s.split(' ').map(v => 'shdc'.indexOf(v.slice(-1)) * 13 + ['2','3','4','5','6','7','8','9','T','J','Q','K','A'].indexOf(v.slice(0,-1)))
const result = (hole: string, board: string, n = 12000) => [...calculatePokerOdds(c(hole), c(board).filter(x => x >= 0), n)].at(-1)!
describe('holdem hands', () => {
  it('orders all nine hand categories', () => {
    const hands = ['As Kd 9c 7h 3s','As Ad 9c 7h 3s','As Ad 9c 9h 3s','As Ad Ac 7h 3s','2s 3d 4c 5h 6s','As Js 9s 7s 3s','As Ad Ac 7h 7s','As Ad Ac Ah 3s','Ts Js Qs Ks As'].map(c)
    hands.forEach((h,i) => { if (i) expect(evaluateHand(h)).toBeGreaterThan(evaluateHand(hands[i-1])) })
  })
  it('handles wheels, two triples, flush kickers and playing the board', () => {
    expect(evaluateHand(c('As 2d 3c 4h 5s'))).toBeLessThan(evaluateHand(c('2s 3d 4c 5h 6s')))
    expect(handName(c('As Ad Ac Ks Kd Kc 2s'))).toBe('Full house')
    expect(evaluateHand(c('As Js 9s 7s 3s'))).toBeGreaterThan(evaluateHand(c('Ks Js 9s 7s 3s')))
    expect(result('2d 3c','Ts Js Qs Ks As')).toMatchObject({ wins:0,ties:990,losses:0,total:990,exact:true })
  })
  it('recognises an unbeatable river hand', () => { expect(result('As Ks','Qs Js Ts 2d 3c').wins).toBe(990) })
  it('estimates pocket aces versus one random opponent and accounts for every outcome', () => {
    const r = result('As Ah','',4000)
    expect(r.wins / r.total).toBeGreaterThan(.82); expect(r.wins / r.total).toBeLessThan(.88)
    expect(r.wins+r.ties+r.losses).toBe(r.total)
  })
  it('deals unique cards reproducibly and rejects duplicated cards', () => {
    expect(new Set(shuffledDeck(seededRandom(1))).size).toBe(52)
    expect(shuffledDeck(seededRandom(1))).toEqual(shuffledDeck(seededRandom(1)))
    expect(() => [...calculatePokerOdds(c('As As'),[])]).toThrow(RangeError)
  })
})
