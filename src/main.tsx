import React from 'react'
import { createRoot } from 'react-dom/client'
import { loadTerminal } from './bootModules'
const SmartFlowShell = React.lazy(() => loadTerminal().then(module => ({ default: module.SmartFlowShell })))
import { StartupGate } from './StartupGate'
import { TerminalLifecycle } from './TerminalLifecycle'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('The Visual Lab root element is missing.')
}

createRoot(rootElement).render(
  React.createElement(StartupGate, null, React.createElement(TerminalLifecycle, null, React.createElement(React.Suspense, { fallback: null }, React.createElement(SmartFlowShell))))
)

