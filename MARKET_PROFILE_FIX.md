# Market Profile TPO correction

## Method

SmartFlow's existing profile is a bar-range TPO profile (`bar_range_tpo`), not a Volume Profile. Each chart bar contributes one TPO to every price row crossed by its high-low range. The value area uses 70% of total TPO counts, expands outward from POC, and resolves equal adjacent rows by distance to POC, then to the upper row.

## Corrections

- Wide profiles now coalesce ticks into contiguous rows, capped at 1,000 rows. The previous implementation sampled every Nth tick and left price gaps that could stop value-area expansion early.
- Equal adjacent TPO counts now choose the row nearer POC, then the higher row when distances are equal.
- POC ties resolve deterministically by proximity to profile midpoint, then lower price.
- Empty TPO rows remain available to keep value-area boundaries continuous but are not drawn as phantom histogram bars.
- Removed the unused per-price `volume` field. MT5 bar tick volume cannot be claimed as market-by-price volume in this TPO engine.

## Verification

`npm test`: 89 tests passed.
`npm run build`: passed.

## References

- TradingView, TPO indicator methodology: https://www.tradingview.com/support/solutions/43000713306-time-price-opportunity-tpo-indicator/
- TradingView, Volume Profile methodology and tick-volume notes for FX/CFDs: https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/
