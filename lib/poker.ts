// Cards 0–51: thirteen ranks (2 through ace) in each suit.
export const SUITS = ['♠', '♥', '♦', '♣']
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
export const HANDS = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush']
const BASE = 15 ** 5
const rank = (card: number) => card % 13 + 2
const suit = (card: number) => Math.floor(card / 13)
export const cardLabel = (card: number) => `${RANKS[card % 13]}${SUITS[suit(card)]}`
function straight(ranks: number[]) {
  const set = new Set(ranks)
  if (set.has(14)) set.add(1)
  for (let high = 14; high >= 5; high--) if ([0, 1, 2, 3, 4].every(n => set.has(high - n))) return high
  return 0
}
function score(category: number, ranks: number[]) {
  return category * BASE + Array.from({ length: 5 }, (_, i) => (ranks[i] ?? 0) * 15 ** (4 - i)).reduce((a, b) => a + b, 0)
}
/** Best five-card score from five to seven distinct cards; higher wins. */
export function evaluateHand(cards: number[]) {
  const ranks = cards.map(rank).sort((a, b) => b - a)
  const counts = new Map<number, number>()
  ranks.forEach(r => counts.set(r, (counts.get(r) ?? 0) + 1))
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const flush = [0, 1, 2, 3].map(s => cards.filter(c => suit(c) === s).map(rank).sort((a, b) => b - a)).find(rs => rs.length >= 5)
  if (flush && straight(flush)) return score(8, [straight(flush)])
  if (groups[0][1] === 4) return score(7, [groups[0][0], ...ranks.filter(r => r !== groups[0][0]).slice(0, 1)])
  const trips = groups.filter(g => g[1] >= 3).map(g => g[0])
  const pair = groups.filter(g => g[1] >= 2 && g[0] !== trips[0]).map(g => g[0]).sort((a, b) => b - a)
  if (trips.length && pair.length) return score(6, [trips[0], pair[0]])
  if (flush) return score(5, flush.slice(0, 5))
  const high = straight(ranks)
  if (high) return score(4, [high])
  if (trips.length) return score(3, [trips[0], ...ranks.filter(r => r !== trips[0]).slice(0, 2)])
  const pairs = groups.filter(g => g[1] === 2).map(g => g[0]).sort((a, b) => b - a)
  if (pairs.length >= 2) return score(2, [pairs[0], pairs[1], ...ranks.filter(r => r !== pairs[0] && r !== pairs[1]).slice(0, 1)])
  if (pairs.length) return score(1, [pairs[0], ...ranks.filter(r => r !== pairs[0]).slice(0, 3)])
  return score(0, ranks.slice(0, 5))
}
export const handName = (cards: number[]) => HANDS[Math.floor(evaluateHand(cards) / BASE)]
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
export function shuffledDeck(random: () => number) {
  const cards = Array.from({ length: 52 }, (_, i) => i)
  for (let i = 51; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]] }
  return cards
}
export type PokerOdds = { wins: number; ties: number; losses: number; total: number; exact: boolean }
/** Only visible cards enter this calculation; future dealt cards cannot influence odds. */
export function* calculatePokerOdds(hole: number[], board: number[], trials = 12000, seed = 42): Generator<PokerOdds> {
  const known = [...hole, ...board]
  if (hole.length !== 2 || board.length > 5 || new Set(known).size !== known.length || known.some(c => !Number.isInteger(c) || c < 0 || c > 51) || !Number.isInteger(trials) || trials < 1) throw new RangeError('Invalid cards or sample count')
  const remaining = Array.from({ length: 52 }, (_, i) => i).filter(c => !known.includes(c))
  const result: PokerOdds = { wins: 0, ties: 0, losses: 0, total: 0, exact: board.length === 5 }
  const compare = (community: number[], opponent: number[]) => {
    const hero = evaluateHand([...hole, ...community]), other = evaluateHand([...opponent, ...community])
    if (hero > other) result.wins++; else if (hero === other) result.ties++; else result.losses++
    result.total++
  }
  if (result.exact) {
    for (let i = 0; i < remaining.length; i++) for (let j = i + 1; j < remaining.length; j++) {
      compare(board, [remaining[i], remaining[j]])
      if (result.total % 250 === 0) yield { ...result }
    }
  } else {
    const random = seededRandom(seed)
    for (let n = 0; n < trials; n++) {
      const pool = [...remaining]
      const draw: number[] = []
      for (let d = 0; d < 7 - board.length; d++) { const j = Math.floor(random() * pool.length); draw.push(pool[j]); pool[j] = pool[pool.length - 1]; pool.pop() }
      compare([...board, ...draw.slice(2)], draw.slice(0, 2))
      if (result.total % 250 === 0) yield { ...result }
    }
  }
  yield { ...result }
}
