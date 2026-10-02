export function CrtSectionTitle({ label, slot, detail }: { label: string; slot: string; detail: string }) {
  return <span className="dragon-terminal-heading matrix-section-title" data-crt-slot={slot}>
    <span className="matrix-title-readable">{label}</span>
    <span className="matrix-title-index" aria-hidden="true">{slot}</span>
    <span className="matrix-title-viewport" aria-hidden="true"><span className="matrix-title-track">
      {[0, 1].map(copy => <span key={copy}><b>{label}</b><i> / </i>{detail}<i> ▸ </i></span>)}
    </span></span>
  </span>
}
