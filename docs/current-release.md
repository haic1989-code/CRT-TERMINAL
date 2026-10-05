# CRT Terminal 0.1.35

- FX Replay adapts MT5 tick-import ranges to the observed tick density, reducing hourly bridge calls while keeping every returned real tick.
- Tick rows are validated and written in bounded SQLite batches within a single transaction per range, avoiding a second full-range copy in Python memory.
- Archive SHA-256 finalization uses a versioned binary encoding and the UI reports the finalization phase explicitly.
- Signed Windows installer and updater manifest are published by the GitHub Actions release workflow.
