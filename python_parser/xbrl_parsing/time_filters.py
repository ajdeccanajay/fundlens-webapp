# xbrl_time_filters.py
from __future__ import annotations
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple

# Helpers --------------------------------------------------------

def _to_date(s: str) -> date:
    return datetime.fromisoformat(s.replace("Z","")).date()

def _duration_days(f: Dict[str, Any]) -> Optional[int]:
    try:
        return (_to_date(f["end"]) - _to_date(f["start"])).days + 1
    except Exception:
        return None

def _is_annual(days: int) -> bool:
    return 330 <= days <= 370

def _is_quarter(days: int) -> bool:
    return 80 <= days <= 100

def _unit_ok(f: Dict[str, Any], expected_units: List[str]) -> bool:
    u = (f.get("u") or f.get("unit") or "").upper()
    return u in {x.upper() for x in expected_units}

def _no_dims(f: Dict[str, Any]) -> bool:
    # Accept only consolidated, non-dimensional facts by default
    dims = f.get("dims") or f.get("dimensions") or {}
    return not dims

# Configuration --------------------------------------------------

@dataclass
class TimeWindow:
    start: date
    end: date
    basis: str = "FY"  # "FY" | "Q" | "TTM" | "AS_OF"
    as_of: Optional[date] = None
    prefer_frames: bool = False
    # tolerances
    fy_min: int = 330
    fy_max: int = 370
    q_min: int = 80
    q_max: int = 100

    @staticmethod
    def from_strings(start: str, end: str, basis: str = "FY", as_of: Optional[str] = None, prefer_frames=False):
        return TimeWindow(
            start=_to_date(start),
            end=_to_date(end),
            basis=basis.upper(),
            as_of=_to_date(as_of) if as_of else None,
            prefer_frames=prefer_frames,
        )

# Filters --------------------------------------------------------

def filter_facts_by_window(
    facts: List[Dict[str, Any]],
    tw: TimeWindow,
    expected_units: List[str],
    allow_dims: bool = False
) -> List[Dict[str, Any]]:
    out = []
    for f in facts:
        try:
            e = _to_date(f["end"])
            d = _duration_days(f)
        except Exception:
            continue
        if not _unit_ok(f, expected_units):
            continue
        if not allow_dims and not _no_dims(f):
            continue
        if tw.start <= e <= tw.end:
            f = dict(f)
            f["_duration_days"] = d
            out.append(f)
    return out

def pick_annual_facts(facts: List[Dict[str, Any]], tw: TimeWindow) -> List[Dict[str, Any]]:
    out = []
    for f in facts:
        d = f.get("_duration_days") or _duration_days(f)
        if d is None: 
            continue
        if tw.fy_min <= d <= tw.fy_max:
            out.append(f)
    # latest first
    out.sort(key=lambda x: _to_date(x["end"]), reverse=True)
    return out

def pick_quarter_facts(facts: List[Dict[str, Any]], tw: TimeWindow) -> List[Dict[str, Any]]:
    out = []
    for f in facts:
        d = f.get("_duration_days") or _duration_days(f)
        if d is None:
            continue
        if tw.q_min <= d <= tw.q_max:
            out.append(f)
    out.sort(key=lambda x: _to_date(x["end"]), reverse=True)
    return out

def chain_last_4_quarters(q_facts: List[Dict[str, Any]], as_of: date) -> Optional[List[Dict[str, Any]]]:
    """
    Build 4-quarter chain ending on/before as_of with ~90-day spacing.
    """
    q_facts = [f for f in q_facts if _to_date(f["end"]) <= as_of]
    q_facts.sort(key=lambda x: _to_date(x["end"]), reverse=True)
    if not q_facts:
        return None

    chain = []
    prev_end = None
    for f in q_facts:
        e = _to_date(f["end"])
        if prev_end is None:
            chain.append(f)
            prev_end = e
        else:
            gap = (prev_end - e).days
            # accept gaps ~ 80–110 to be resilient
            if 80 <= gap <= 110:
                chain.append(f)
                prev_end = e
        if len(chain) == 4:
            break

    return chain if len(chain) == 4 else None

def compute_ttm(
    facts: List[Dict[str, Any]],
    tw: TimeWindow,
    expected_units: List[str],
    allow_dims: bool = False,
) -> Tuple[Optional[float], Dict[str, Any]]:
    """
    TTM = sum of last 4 fiscal quarters ending <= as_of (or tw.end).
    Fallback: FY + YTD(current) - YTD(prior), if available and aligned.
    """
    as_of = tw.as_of or tw.end
    scoped = filter_facts_by_window(facts, TimeWindow(tw.start - timedelta(days=450), as_of, "Q"), expected_units, allow_dims)
    qfacts = pick_quarter_facts(scoped, tw)
    chain = chain_last_4_quarters(qfacts, as_of)

    if chain:
        val = sum(float(f["val"]) for f in chain if f.get("val") is not None)
        return val, {
            "method": "ttm_4q_chain",
            "quarters_used": [{"start": f["start"], "end": f["end"], "u": f.get("u")} for f in chain],
            "as_of": as_of.isoformat(),
        }

    # Fallback (optional): FY + YTD - YTD(prior)
    # Implement if your YAML allows it; otherwise return None with rationale.
    return None, {"method": "ttm_fallback_unavailable"}

def pick_fy_value(
    facts: List[Dict[str, Any]],
    tw: TimeWindow,
    expected_units: List[str],
    allow_dims: bool = False,
) -> Tuple[Optional[float], Optional[Dict[str, Any]]]:
    scoped = filter_facts_by_window(facts, tw, expected_units, allow_dims)
    fy = pick_annual_facts(scoped, tw)
    if not fy:
        return None, None
    top = fy[0]
    return float(top["val"]), {
        "method": "annual_duration",
        "start": top["start"],
        "end": top["end"],
        "duration_days": top.get("_duration_days"),
        "u": top.get("u"),
    }
