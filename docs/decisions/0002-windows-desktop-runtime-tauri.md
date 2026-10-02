# ADR-0002 — Windows desktop runtime with Tauri 2

- Date: 2026-09-30
- Status: accepted planning baseline; implementation not started

## Context

SmartFlow X currently runs as a React, TypeScript and Vite application in a
browser. It uses a local read-only MT5 bridge. Local model advice was retired
on 2026-10-01 at the user's request. The goal is to launch it as its own Windows application, keep the
existing interface and trading tools, and add carefully controlled motion and
selective 3D effects.

## Decision

- Use **Tauri 2** as the Windows desktop shell. Keep the existing React/Vite
  frontend and chart; do not rewrite the UI for desktop.
- Run the packaged frontend in the Windows WebView2 runtime. The user launches a
  SmartFlow X window without browser tabs or address bar; WebView2 remains the
  rendering engine underneath.
- Keep the MT5 bridge as a local service for the first desktop milestone.
  The bridge remains read-only. Later, assess supervising or bundling
  the bridge as a Tauri sidecar.
- Use Tauri's default Windows `http://tauri.localhost` app origin so the app can
  call the existing local HTTP services. Add only this exact production origin
  and the exact development origin to the bridge CORS allowlist; do not use a
  wildcard. Keep the Tauri CSP limited to the packaged app and required local
  service endpoints.
- Use CSS and existing GSAP for tab, toggle and panel micro-interactions. Use
  the project's existing Three.js / React Three Fiber dependencies for selected
  decorative 3D elements, not for the chart controls or data labels.
- Keep the candle chart readable and responsive. Respect reduced-motion
  preferences, keep hover animation brief and subtle, and avoid continuous
  high-cost effects over the chart.
- Produce a Windows `.msi` or setup `.exe` after desktop smoke tests. Do not add
  code signing or public distribution work to the first personal-use milestone.

## Implementation sequence

1. Add Tauri to a separate feature branch and launch the existing Vite app in a
   desktop window in development mode.
2. Build the production frontend into the Tauri window and verify chart,
   localStorage-backed drawings/settings, MT5 bridge, and read-only connectivity.
3. Update the MT5 bridge CORS allowlist and Tauri CSP for the exact desktop
   origin. Decide whether existing browser settings should be imported into the
   desktop app; browser and Tauri storage are separate origins.
4. Add restrained CSS/GSAP hover, focus, pressed and loading states. Review
   chart performance before enabling any additional 3D scene.
5. Build and install the Windows package; test fresh launch, restart, bridge
   health, MT5 availability, and chart interactions.

## Windows prerequisites and packaging

Building Tauri on Windows requires Rust, Microsoft C++ Build Tools and WebView2.
The installer should account for WebView2 availability. Tauri provides `.msi`
and NSIS setup `.exe` output. The actual build and installation smoke test
should run on the user's Windows machine.

## References checked on 2026-09-30

- Tauri Windows prerequisites: https://tauri.app/start/prerequisites/
- Tauri project creation with Vite: https://tauri.app/start/create-project/
- Tauri Windows WebView and installer: https://v2.tauri.app/reference/webview-versions/ and https://v2.tauri.app/distribute/windows-installer/
- Tauri sidecars: https://v2.tauri.app/develop/sidecar/
- Electron comparison: https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites
