# Q4Quant Tools

The interactive tools from [q4quant.studio/tools](https://q4quant.studio/tools), open-sourced.

| Tool | Component | Logic |
| --- | --- | --- |
| Options pricing & volatility surface | `components/tools/ToolsWorkbench.tsx` | `lib/options-pricing.ts`, `lib/volatility-surface.ts` |
| Poker odds trainer | `components/tools/PokerTrainer.tsx` | `lib/poker.ts` |
| Bayes' rule trainer | `components/tools/BayesTrainer.tsx` | `lib/bayes.ts` |
| Order-book simulator | `components/tools/OrderBookSimulator.tsx` | `lib/orderbook.ts`, `lib/orderbook-review.ts` |
| Market-making game | `components/tools/MarketMakingGame.tsx` | `lib/market-making.ts` |

The components are React 19 client components. `@/` resolves to the repository root.

```bash
npm install
npm test          # unit tests for the pricing / game logic
npm run typecheck
```

> This repository is a read-only mirror, synced automatically from the Q4Quant Studio codebase.
> Issues are welcome; pull requests are ported back by hand.

## License

[MIT](LICENSE)
