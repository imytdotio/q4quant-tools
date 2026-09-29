import { cancelUserOrders, executeOrder, nextMarketEvent, quote, type Book, type MarketScenario, type OrderInput, type Side } from './orderbook'
import { seededRandom } from './poker'

export type ReviewChoice = { label: string; order: OrderInput | null; keepResting?: boolean; tradeAfter?: number }
export type ReviewEstimate = { label: string; cost: number; standardError: number; filledPercent: number }
export type DecisionReview = { side: Side; quantity: number; horizon: number; paths: number; estimates: ReviewEstimate[]; chosen: string; best: string; uncertain: boolean; difference: number }

/** Expected execution cost only: same target and initial state for every alternative.
 * Fixed, independent review seeds never inspect or consume the live event RNG.
 * Positive cost = worse than the decision-time mid. Deadline leftovers cost $1/share.
 */
export function reviewDecision(book: Book, side: Side, quantity: number, scenario: MarketScenario, chosen: ReviewChoice, paths = 160, horizon = 8): DecisionReview {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) throw new RangeError('Review quantity must be 1–200 shares.')
  const clean = cancelUserOrders(book)
  const benchmark = quote(clean).mid ?? 100
  const touch = side === 'buy' ? clean.bids[0]?.price : clean.asks[0]?.price
  const choices: ReviewChoice[] = [
    { label: 'Trade now', order: { side, kind: 'market', quantity } },
    ...(touch ? [{ label: 'Join the queue', order: { side, kind: 'limit' as const, quantity, limitPrice: touch } }] : []),
    { label: 'Wait one event, then trade', order: null, tradeAfter: 1 },
    { label: 'Wait until deadline', order: null },
    chosen,
  ]
  const estimates = choices.map(choice => {
    let sum = 0, squares = 0, filled = 0
    for (let trial = 0; trial < paths; trial++) {
      let current = choice.keepResting ? book : clean, done = 0, notional = 0
      if (choice.order) {
        const execution = executeOrder(current, choice.order)
        current = execution.book; done = execution.filledQuantity; notional = execution.notional
      }
      const random = seededRandom(0x51A7 + trial * 7919)
      for (let step = 0; step < horizon; step++) {
        const event = nextMarketEvent(current, random, scenario)
        current = event.book
        if (event.userFill) { done += event.userFill.quantity; notional += event.userFill.notional }
        if (choice.tradeAfter === step + 1 && done < quantity) {
          const execution = executeOrder(cancelUserOrders(current), { side, kind: 'market', quantity: quantity - done })
          current = execution.book; done += execution.filledQuantity; notional += execution.notional
        }
      }
      current = cancelUserOrders(current)
      if (done < quantity) {
        const final = executeOrder(current, { side, kind: 'market', quantity: quantity - done })
        done += final.filledQuantity; notional += final.notional
      }
      const cost = (side === 'buy' ? notional - benchmark * done : benchmark * done - notional) + (quantity - done)
      sum += cost; squares += cost * cost; filled += done / quantity
    }
    const cost = sum / paths
    return { label: choice.label, cost, standardError: Math.sqrt(Math.max(0, squares / paths - cost * cost) / paths), filledPercent: 100 * filled / paths }
  }).sort((a, b) => a.cost - b.cost)
  const selected = estimates.find(e => e.label === chosen.label)!
  const best = estimates[0]
  return { side, quantity, horizon, paths, estimates, chosen: chosen.label, best: best.label, uncertain: selected.cost - best.cost <= 2 * Math.hypot(selected.standardError, best.standardError), difference: selected.cost - best.cost }
}
