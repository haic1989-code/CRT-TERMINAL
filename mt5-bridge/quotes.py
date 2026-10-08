"""One MT5 Bid/Ask freshness policy for display telemetry and DEMO preflight."""
from __future__ import annotations

import math
import time

MAX_QUOTE_AGE_MS = 15000


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def quote_metadata(tick, now_ms=None):
    observed = time.time() * 1000 if now_ms is None else now_ms
    milliseconds = getattr(tick, "time_msc", None)
    seconds = getattr(tick, "time", None)
    timestamp = seconds * 1000 if milliseconds in (None, 0) and finite_number(seconds) else milliseconds
    valid_time = finite_number(timestamp) and timestamp > 0 and finite_number(observed)
    # A broker clock ahead of Windows does not make a just-read tick old.
    # Keep the 15-second past-age limit; never derive execution age in the UI.
    age = max(0, observed - timestamp) if valid_time else None
    bid, ask = getattr(tick, "bid", None), getattr(tick, "ask", None)
    valid_prices = finite_number(bid) and finite_number(ask) and bid > 0 and ask >= bid
    error = "QUOTE_UNAVAILABLE" if tick is None or not valid_time else "QUOTE_INVALID" if not valid_prices else "STALE_QUOTE" if age > MAX_QUOTE_AGE_MS else None
    return {"observed_at": int(observed), "quote_age_ms": age,
            "freshness": "fresh" if error is None else "stale", "error": error}
