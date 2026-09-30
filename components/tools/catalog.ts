import type { ReactNode } from 'react'

/** Every interactive tool, in display and keyboard-shortcut order. */
export const TOOLS = [
  { id: 'options', number: '01', title: 'Options pricing', glyph: '▦', slug: 'options-pricing', summary: 'Black–Scholes prices across spot and volatility, as a heatmap or payoff curve.' },
  { id: 'surface', number: '02', title: 'Volatility surface', glyph: '▱', slug: 'volatility-surface', summary: 'Shape an implied-volatility surface with skew, curvature and term slope.' },
  { id: 'poker', number: '03', title: 'Texas Hold’em', glyph: '♠', slug: 'texas-holdem', summary: 'Estimate your winning probability as the board is dealt card by card.' },
  { id: 'bayes', number: '04', title: 'Bayes’ rule', glyph: 'P', slug: 'bayes-rule', summary: 'Guess the posterior, then watch the population shrink to the evidence.' },
  { id: 'book', number: '05', title: 'Order book', glyph: '⇅', slug: 'order-book', summary: 'Walk a limit order book and see what a market order really costs.' },
  { id: 'market', number: '06', title: 'Market making', glyph: '⇄', slug: 'market-making', summary: 'Quote a two-sided market against noise traders and an insider.' },
] as const

export type ToolId = typeof TOOLS[number]['id']
export type ToolSlug = typeof TOOLS[number]['slug']

/**
 * Optional gate a host page can put on a tool's later steps.
 * When `locked` is true, the tool shows `notice` in place of the gated action;
 * without a notice it keeps the action and calls `onBlocked` instead of taking it.
 */
export type ToolLock = { locked: boolean; notice?: ReactNode; onBlocked?: () => void }
