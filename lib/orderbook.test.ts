import { expect, it } from 'vitest'
import { createBook, executeOrder, nextMarketEvent, quote, settle, scorePrediction } from './orderbook'

const exampleAsks = [
  { price: 100.1, quantity: 10 },
  { price: 100.2, quantity: 20 },
]

it('walks a market buy through the offer and reports the average fill', () => {
  const book = { bids: [{ price: 99.9, quantity: 12 }], asks: exampleAsks }
  const result = executeOrder(book, { side: 'buy', kind: 'market', quantity: 25 })
  expect(result.fills).toEqual([
    { price: 100.1, quantity: 10 },
    { price: 100.2, quantity: 15 },
  ])
  expect(result.averagePrice).toBe(100.16)
  expect(result.filledQuantity).toBe(25)
  expect(result.remainder).toEqual({ quantity: 0, disposition: 'none' })
  expect(result.book.asks).toEqual([{ price: 100.2, quantity: 5 }])
  expect(result.slippage).toBeCloseTo(0.06, 10)
  expect(result.notional).toBeCloseTo(2504, 10)
})

it('leaves a market order unfilled when the book runs out', () => {
  const book = { bids: [{ price: 99.9, quantity: 12 }], asks: exampleAsks }
  const result = executeOrder(book, { side: 'buy', kind: 'market', quantity: 40 })
  expect(result.filledQuantity).toBe(30)
  expect(result.remainder).toEqual({ quantity: 10, disposition: 'unfilled' })
  expect(result.book.asks).toEqual([])
  expect(result.averagePrice).toBeCloseTo(3005 / 30, 10)
})

it('rests a limit buy that does not cross and fills one that does at the offer', () => {
  const book = { bids: [{ price: 99.9, quantity: 12 }], asks: exampleAsks }
  const resting = executeOrder(book, { side: 'buy', kind: 'limit', quantity: 8, limitPrice: 100 })
  expect(resting.filledQuantity).toBe(0)
  expect(resting.averagePrice).toBeNull()
  expect(resting.remainder).toEqual({ quantity: 8, disposition: 'resting', price: 100 })
  expect(resting.book.bids[0]).toMatchObject({ price: 100, quantity: 8, yours: 8 })

  const crossing = executeOrder(book, { side: 'buy', kind: 'limit', quantity: 25, limitPrice: 100.5 })
  expect(crossing.fills).toEqual([
    { price: 100.1, quantity: 10 },
    { price: 100.2, quantity: 15 },
  ])
  expect(crossing.averagePrice).toBe(100.16)
  expect(crossing.remainder).toEqual({ quantity: 0, disposition: 'none' })
})

it('sells into the bid and rests a limit above the market', () => {
  const book = {
    bids: [{ price: 99.9, quantity: 10 }, { price: 99.8, quantity: 20 }],
    asks: [{ price: 100.1, quantity: 10 }],
  }
  const sold = executeOrder(book, { side: 'sell', kind: 'market', quantity: 12 })
  expect(sold.fills).toEqual([
    { price: 99.9, quantity: 10 },
    { price: 99.8, quantity: 2 },
  ])
  expect(sold.averagePrice).toBeCloseTo((999 + 199.6) / 12, 10)
  expect(sold.slippage).toBeCloseTo(99.9 - sold.averagePrice!, 10)

  const offered = executeOrder(book, { side: 'sell', kind: 'limit', quantity: 6, limitPrice: 100.3 })
  expect(offered.filledQuantity).toBe(0)
  expect(offered.book.asks[1]).toMatchObject({ price: 100.3, quantity: 6, yours: 6 })
})

it('makes the same buy cheaper in a deeper book', () => {
  const order = { side: 'buy' as const, kind: 'market' as const, quantity: 25 }
  const thin = executeOrder(createBook('thin'), order)
  const normal = executeOrder(createBook('normal'), order)
  const deep = executeOrder(createBook('deep'), order)
  expect(normal.averagePrice).toBe(100.16)
  expect(thin.averagePrice!).toBeGreaterThan(normal.averagePrice!)
  expect(deep.averagePrice!).toBeLessThan(normal.averagePrice!)
  expect(quote(createBook('thin')).spread!).toBeGreaterThan(quote(createBook('normal')).spread!)
  expect(quote(createBook('deep')).spread!).toBeLessThan(quote(createBook('normal')).spread!)
})

it('rejects a non-positive quantity and a limit without a price', () => {
  const book = createBook('normal')
  expect(() => executeOrder(book, { side: 'buy', kind: 'market', quantity: 0 })).toThrow(RangeError)
  expect(() => executeOrder(book, { side: 'buy', kind: 'limit', quantity: 5 })).toThrow(RangeError)
})

it('moves the book one modest step and fills the user only after other size at that price', () => {
  const book = {
    bids: [{ price: 99.9, quantity: 10, yours: 4 }],
    asks: [{ price: 100.1, quantity: 10 }],
  }
  const joined = nextMarketEvent(book, () => 0.1)
  expect(joined.book.bids.length + joined.book.asks.length).toBeGreaterThan(2)
  expect(joined.userFill).toBeNull()
  expect(joined.summary.length).toBeGreaterThan(0)
  for (let i = 1; i < joined.book.bids.length; i++) expect(joined.book.bids[i].price).toBeLessThan(joined.book.bids[i - 1].price)
  for (let i = 1; i < joined.book.asks.length; i++) expect(joined.book.asks[i].price).toBeGreaterThan(joined.book.asks[i - 1].price)
  expect(joined.book.bids[0].price).toBeLessThan(joined.book.asks[0].price)

  const draws = [.9, .9, .99, .25, .5, .5]
  const hit = nextMarketEvent(book, () => draws.shift() ?? .5)
  expect(hit.userFill).toBeNull()
  expect(hit.book.bids[0].yours).toBe(4)
  expect(hit.book.bids[0].quantity).toBeLessThan(10)
})

it('settles cash and inventory and scores a fill prediction', () => {
  const book = { bids: [{ price: 99.9, quantity: 12 }], asks: exampleAsks }
  const result = executeOrder(book, { side: 'buy', kind: 'market', quantity: 25 })
  expect(settle(10_000, 0, result, 'buy')).toEqual({ cash: 10_000 - 2504, inventory: 25 })
  expect(scorePrediction(result, { expectsFill: true, averagePrice: 100.2 })).toEqual({ fillCorrect: true, priceError: 0.04 })
  expect(scorePrediction(result, { expectsFill: false, averagePrice: null }).fillCorrect).toBe(false)
})

it('settles user fills across multiple prices and respects external orders behind the user', () => {
  const book = { bids: [{ price: 100, quantity: 3, yours: 2, ahead: 1 }, { price: 99, quantity: 2, yours: 2, ahead: 0 }], asks: [{ price: 101, quantity: 10 }] }
  const draws = [.99, .99, .5, .25, .5, .5]
  const event = nextMarketEvent(book, () => draws.shift() ?? .5)
  expect(event.userFill).toMatchObject({ side: 'buy', quantity: 4, notional: 398, price: 99.5 })
  expect(book.bids[0].quantity).toBe(3)
})
