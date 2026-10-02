# ADR-003 — Market Canvas chart engine candidate

Status: CANDIDATE / EXPERIMENT

Date: 2026-09-26

## Decision under test

Use TradingView Lightweight Charts 5.2.x as the first Market Canvas chart engine candidate for the SmartFlow X visual vertical slice.

This is not yet an ACCEPTED architecture decision. The candidate must pass visual integration, trading UX and performance review before promotion.

## Why this candidate

- Purpose-built interactive financial charting with HTML5 canvas.
- Official React integration guidance.
- Current 5.2.1 release at the time of this checkpoint.
- Apache-2.0 licensed.
- Supports candlestick series, price/time scales, crosshair and extension through plugins.
- The chart can use a transparent background, allowing SmartFlow X to preserve its render-backed environment.
- TradingView attribution remains enabled in the experiment.

## Checkpoint scope

- XAUUSD
- M15
- deterministic TEST DATA only
- candlesticks
- price/time scales
- crosshair
- pan/zoom
- no MT5
- no live market feed
- no order execution
- no AI/Luna
- no Position Planner yet

## Safety / truthfulness rule

Until a read-only broker/data adapter is connected, the UI must explicitly label the series as DANE TESTOWE and must not imply LIVE status.

## Sources checked

- https://github.com/tradingview/lightweight-charts/releases
- https://tradingview.github.io/lightweight-charts/tutorials/react/simple
- https://github.com/tradingview/lightweight-charts
- https://tradingview.github.io/lightweight-charts/docs/

## Promotion gate

Promote to ACCEPTED only if:
1. chart readability over the render-backed environment passes human visual review,
2. interaction remains smooth at QHD target,
3. transparent integration does not force destructive background blur,
4. the API remains suitable for drawings, planner overlays and data adapter integration.
