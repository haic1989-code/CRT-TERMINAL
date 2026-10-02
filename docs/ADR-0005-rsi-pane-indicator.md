# ADR-0005 — Native RSI pane indicator

Status: Accepted for Indicators Completion Pass  
Date: 2026-09-27

## Decision

Add only RSI as a pane indicator in this pass. Keep SMA 20, EMA 50, VWAP, and Bollinger Bands as overlays. Do not add MACD or a broader guessed catalog.

The RSI calculation is SmartFlow-owned TypeScript. It uses close prices, a configurable period, initial average gains/losses over the first complete period, and Wilder smoothing for later values. Values are constrained to the conventional 0–100 scale; reference levels are 30 and 70. The chart places RSI in its own pane with a right-side scale fixed to 0–100.

## Source audit

- Blueprint FINAL v1.0, section 3, requires search, available/active, enable/disable, settings, remove, and permits a separate pane for indicators that need one.
- Source Implementation Map, section 10, selects a SmartFlow-native browser over registered engines and no external browser UI. Individual indicator engines may receive their own audit when introduced.
- MetaQuotes MQL5 Reference `iRSI` documents one RSI value buffer, an averaging period, and an applied-price input. MetaQuotes' RSI CodeBase entry describes the 0–100 output and the ratio of average positive and negative price changes.
- The reference implementation and external UI are not copied. The RSI is independently implemented from the documented mathematical contract. No third-party source code or visual styling was incorporated, so no third-party license notice is required.

## Limits

The display uses MT5 bar close values supplied to the browser and does not call the MT5 indicator handle. RSI history shorter than its configured period is shown without values. A flat series is defined as 50 for stable display.
