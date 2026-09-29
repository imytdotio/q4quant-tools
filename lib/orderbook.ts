import scenarios from '@/data/practice/orderbook-scenarios.json'
export type Side = 'buy' | 'sell'
export type OrderKind = 'market' | 'limit'
export type Liquidity = 'thin' | 'normal' | 'deep'

export type Level = { price: number; quantity: number; yours?: number; ahead?: number }

export type Book = { bids: Level[]; asks: Level[] }

export type OrderInput = { side: Side; kind: OrderKind; quantity: number; limitPrice?: number }

export type Fill = { price: number; quantity: number }

export type Remainder = { quantity: number; disposition: 'none' | 'unfilled' | 'resting'; price?: number }

export type Execution = {
  fills: Fill[]
  filledQuantity: number
  averagePrice: number | null
  notional: number
  slippage: number | null
  remainder: Remainder
  book: Book
}

export type UserFill = { side: Side; quantity: number; price: number; notional: number }

export type MarketEvent = { book: Book; summary: string; userFill: UserFill | null; tradePrice: number | null; elapsedSeconds?: number }

export const STARTING_CASH = 10_000

const PRESETS: Record<Liquidity, Book> = {
  thin: {
    bids: [
      { price: 99.6, quantity: 4 },
      { price: 99.2, quantity: 8 },
      { price: 98.8, quantity: 12 },
    ],
    asks: [
      { price: 100.4, quantity: 4 },
      { price: 100.8, quantity: 8 },
      { price: 101.2, quantity: 20 },
    ],
  },
  normal: {
    bids: [
      { price: 99.9, quantity: 12 },
      { price: 99.8, quantity: 18 },
      { price: 99.7, quantity: 25 },
      { price: 99.6, quantity: 20 },
      { price: 99.5, quantity: 15 },
    ],
    asks: [
      { price: 100.1, quantity: 10 },
      { price: 100.2, quantity: 20 },
      { price: 100.3, quantity: 18 },
      { price: 100.4, quantity: 22 },
      { price: 100.5, quantity: 16 },
    ],
  },
  deep: {
    bids: [
      { price: 99.98, quantity: 80 },
      { price: 99.96, quantity: 90 },
      { price: 99.94, quantity: 100 },
      { price: 99.92, quantity: 80 },
      { price: 99.9, quantity: 70 },
      { price: 99.88, quantity: 60 },
    ],
    asks: [
      { price: 100.02, quantity: 80 },
      { price: 100.04, quantity: 90 },
      { price: 100.06, quantity: 100 },
      { price: 100.08, quantity: 80 },
      { price: 100.1, quantity: 70 },
      { price: 100.12, quantity: 60 },
    ],
  },
}

const cents = (price: number) => Math.round(price * 100)
const dollars = (amount: number) => amount / 100
const roundCents = (price: number) => dollars(cents(price))

export function createBook(liquidity: Liquidity): Book {
  return cloneBook(PRESETS[liquidity])
}

export function quote(book: Book) {
  const bestBid = book.bids[0]?.price ?? null
  const bestAsk = book.asks[0]?.price ?? null
  const spread = bestBid !== null && bestAsk !== null ? roundCents(bestAsk - bestBid) : null
  const mid = bestBid !== null && bestAsk !== null ? roundCents((bestBid + bestAsk) / 2) : bestBid ?? bestAsk
  return { bestBid, bestAsk, spread, mid }
}

export function executeOrder(book: Book, order: OrderInput): Execution {
  if (!Number.isSafeInteger(order.quantity) || order.quantity <= 0) throw new RangeError('Quantity must be a positive whole number of shares.')
  if (order.kind === 'limit' && (order.limitPrice === undefined || !Number.isFinite(order.limitPrice) || !(order.limitPrice > 0))) throw new RangeError('A limit order needs a price.')
  const limit = order.kind === 'limit' ? roundCents(order.limitPrice!) : null
  if (limit !== null && limit < .01) throw new RangeError('A limit price must be at least $0.01.')
  const next = cloneBook(book)
  const opposing = order.side === 'buy' ? next.asks : next.bids
  const { fills, yoursFilled } = consume(opposing, order.quantity, limit, order.side, true)
  if (yoursFilled) { /* the user's order never matches their own resting size */ }
  const filledQuantity = fills.reduce((sum, fill) => sum + fill.quantity, 0)
  const filledCents = fills.reduce((sum, fill) => sum + cents(fill.price) * fill.quantity, 0)
  const averagePrice = filledQuantity ? filledCents / filledQuantity / 100 : null
  const touch = order.side === 'buy' ? book.asks[0]?.price ?? null : book.bids[0]?.price ?? null
  const slippage = averagePrice !== null && touch !== null ? (order.side === 'buy' ? averagePrice - touch : touch - averagePrice) : null
  const resting = order.quantity - filledQuantity
  let remainder: Remainder = { quantity: 0, disposition: 'none' }
  if (resting > 0 && order.kind === 'limit') {
    addLevel(order.side === 'buy' ? next.bids : next.asks, limit!, resting, true, order.side)
    remainder = { quantity: resting, disposition: 'resting', price: limit! }
  } else if (resting > 0) remainder = { quantity: resting, disposition: 'unfilled' }
  sortBook(next)
  return { fills, filledQuantity, averagePrice, notional: dollars(filledCents), slippage, remainder, book: next }
}

export function settle(cash: number, inventory: number, execution: Pick<Execution, 'notional' | 'filledQuantity'>, side: Side) {
  return side === 'buy'
    ? { cash: roundCents(cash - execution.notional), inventory: inventory + execution.filledQuantity }
    : { cash: roundCents(cash + execution.notional), inventory: inventory - execution.filledQuantity }
}

export function scorePrediction(execution: Execution, prediction: { expectsFill: boolean; averagePrice: number | null }) {
  const filled = execution.filledQuantity > 0
  const priceError = filled && prediction.averagePrice !== null && execution.averagePrice !== null
    ? roundCents(prediction.averagePrice - execution.averagePrice)
    : null
  return { fillCorrect: prediction.expectsFill === filled, priceError }
}

export type MarketScenario = {
  id: string; title: string; description: string
  joinProbability: number; cancelProbability: number; buyProbability: number
  sizeMedian: number; sizeSigma: number; eventsPerSecond: number; tickSize: number
}
export const MARKET_SCENARIOS: MarketScenario[] = scenarios
export function validMarketScenario(value: unknown): value is MarketScenario {
  if (!value || typeof value !== 'object') return false
  const s = value as MarketScenario
  return [s.id, s.title, s.description].every(v => typeof v === 'string' && v.trim().length > 0)
    && [s.joinProbability, s.cancelProbability, s.buyProbability].every(v => Number.isFinite(v) && v >= 0 && v <= 1)
    && s.joinProbability + s.cancelProbability <= 1
    && Number.isFinite(s.sizeMedian) && s.sizeMedian >= 1 && s.sizeMedian <= 100
    && Number.isFinite(s.sizeSigma) && s.sizeSigma >= 0 && s.sizeSigma <= 2
    && Number.isFinite(s.eventsPerSecond) && s.eventsPerSecond > 0 && s.eventsPerSecond <= 100
    && s.tickSize === .01
}

export function nextMarketEvent(book: Book, random: () => number = Math.random, scenario: MarketScenario = MARKET_SCENARIOS[0]): MarketEvent {
  const next = cloneBook(book)
  sortBook(next)
  // Independent draws for type, side, size, placement and exponential arrival time.
  const roll = random(), side: Side = random() < scenario.buyProbability ? 'buy' : 'sell'
  const u = Math.max(1e-12, random())
  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
  const quantity = Math.min(200, Math.max(1, Math.round(scenario.sizeMedian * Math.exp(scenario.sizeSigma * normal))))
  const placement = random()
  const elapsedSeconds = -Math.log(Math.max(1e-12, 1 - random())) / scenario.eventsPerSecond
  const result = (summary: string, userFill: UserFill | null = null, tradePrice: number | null = null): MarketEvent => ({ book: next, summary, userFill, tradePrice, elapsedSeconds })
  const join = () => {
    const own = side === 'buy' ? next.bids : next.asks
    const opposite = side === 'buy' ? next.asks[0]?.price : next.bids[0]?.price
    const anchor = own[0]?.price ?? (opposite !== undefined ? opposite + (side === 'buy' ? -.02 : .02) : 100)
    // Geometric distance concentrates quotes near the touch; sometimes improve the spread.
    const distance = Math.min(12, Math.floor(-Math.log(Math.max(1e-12, 1 - placement)) / Math.log(2)))
    let price = roundCents(anchor + (side === 'buy' ? -1 : 1) * (distance - 1) * scenario.tickSize)
    if (opposite !== undefined) price = side === 'buy' ? Math.min(price, roundCents(opposite - scenario.tickSize)) : Math.max(price, roundCents(opposite + scenario.tickSize))
    price = Math.max(.01, price)
    if (side === 'sell' && opposite !== undefined && price <= opposite) return result('No valid offer tick available.')
    if (side === 'buy' && opposite !== undefined && price >= opposite) return result('No valid bid tick available.')
    addLevel(own, price, quantity, false, side)
    return result(`A ${side === 'buy' ? 'buyer' : 'seller'} adds ${quantity} shares at ${money(price)}.`)
  }
  if (roll < scenario.joinProbability) return join()
  if (roll < scenario.joinProbability + scenario.cancelProbability) {
    const levels = [...next.bids, ...next.asks].filter(l => l.quantity > (l.yours ?? 0))
    const total = levels.reduce((n, l) => n + l.quantity - (l.yours ?? 0), 0)
    let target = placement * total
    const level = levels.find(l => { target -= l.quantity - (l.yours ?? 0); return target < 0 })
    if (!level) return result('No external orders available to cancel.')
    const external = level.quantity - (level.yours ?? 0)
    const cut = Math.min(quantity, external)
    // Proportional cancellation approximation for the external queue ahead/behind.
    if (level.yours) level.ahead = Math.max(0, (level.ahead ?? external) - Math.round(cut * (level.ahead ?? external) / external))
    level.quantity -= cut
    next.bids = next.bids.filter(l => l.quantity > 0); next.asks = next.asks.filter(l => l.quantity > 0)
    return result(`${cut} external shares cancelled at ${money(level.price)}.`)
  }
  const opposing = side === 'buy' ? next.asks : next.bids
  const { fills, yoursFilled, yoursNotional } = consume(opposing, quantity, null, side, false)
  const traded = fills.reduce((n, f) => n + f.quantity, 0)
  const notional = fills.reduce((n, f) => n + f.quantity * f.price, 0)
  const userFill = yoursFilled ? { side: (side === 'buy' ? 'sell' : 'buy') as Side, quantity: yoursFilled, price: yoursNotional / yoursFilled, notional: roundCents(yoursNotional) } : null
  return result(traded ? `A ${side === 'buy' ? 'buyer' : 'seller'} trades ${traded} shares across ${fills.length} level(s).` : 'No opposing liquidity to trade.', userFill, traded ? notional / traded : null)
}

export function cancelUserOrders(book: Book): Book {
  return { bids: book.bids.map(({ price, quantity, yours = 0 }) => ({ price, quantity: quantity - yours })).filter(l => l.quantity > 0), asks: book.asks.map(({ price, quantity, yours = 0 }) => ({ price, quantity: quantity - yours })).filter(l => l.quantity > 0) }
}

function consume(levels: Level[], quantity: number, limit: number | null, side: Side, protectYours: boolean) {
  const fills: Fill[] = []
  let left = quantity
  let yoursFilled = 0
  let yoursNotional = 0
  for (const level of levels) {
    if (!left) break
    if (limit !== null && (side === 'buy' ? level.price > limit : level.price < limit)) break
    const marketQty = level.quantity - (level.yours ?? 0)
    const offered = protectYours ? marketQty : level.quantity
    const take = Math.min(left, Math.max(0, offered))
    if (!take) continue
    const ahead = Math.min(marketQty, level.ahead ?? marketQty)
    const fromYours = protectYours ? 0 : Math.min(level.yours ?? 0, Math.max(0, take - ahead))
    if (level.yours) level.ahead = Math.max(0, ahead - Math.min(take, ahead))
    level.quantity -= take
    if (level.yours) level.yours = Math.max(0, level.yours - fromYours)
    if (!level.yours) { delete level.yours; delete level.ahead }
    yoursFilled += fromYours
    yoursNotional += fromYours * level.price
    left -= take
    const previous = fills[fills.length - 1]
    if (previous?.price === level.price) previous.quantity += take
    else fills.push({ price: level.price, quantity: take })
  }
  const kept = levels.filter(level => level.quantity > 0)
  levels.splice(0, levels.length, ...kept)
  return { fills, yoursFilled, yoursNotional }
}

function addLevel(levels: Level[], price: number, quantity: number, yours: boolean, side: Side) {
  const priceCents = cents(price)
  const existing = levels.find(level => cents(level.price) === priceCents)
  if (existing) {
    if (yours) existing.ahead = existing.quantity - (existing.yours ?? 0)
    existing.quantity += quantity
    if (yours) existing.yours = (existing.yours ?? 0) + quantity
    return
  }
  levels.push({ price: dollars(priceCents), quantity, ...(yours ? { yours: quantity, ahead: 0 } : {}) })
  levels.sort((a, b) => side === 'buy' ? b.price - a.price : a.price - b.price)
}

function sortBook(book: Book) {
  book.bids.sort((a, b) => b.price - a.price)
  book.asks.sort((a, b) => a.price - b.price)
}

function cloneBook(book: Book): Book {
  return { bids: book.bids.map(level => ({ ...level })), asks: book.asks.map(level => ({ ...level })) }
}

function money(price: number) {
  return price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
