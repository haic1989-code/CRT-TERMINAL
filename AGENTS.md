# CRT Terminal workflow

- User-authorized workflow: push every completed scoped fix to the connected repository. Preserve unrelated local changes.
- Every executable release must increment the app version consistently in package.json, package-lock.json, Cargo.toml, Cargo.lock and tauri.conf.json.
- GitHub Actions builds and publishes signed Windows releases and latest.json. Never replace a published version or commit signing keys; keep private keys only in ignored local storage and authorized GitHub Actions secrets.
- Updates require explicit user confirmation. Never silently install an update.
- Startup messages are typed Luna messages in the upper-left CRT log and must reflect actual operations, not artificial readiness timers.
- MT5 execution is DEMO-only. Do not send trading requests during development. Preserve the ownership, authentication, idempotency and execution guards.
- Do not run or add tests unless the user requests them. Report compilation separately from manual Windows/update acceptance.
