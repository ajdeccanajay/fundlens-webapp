"""
Time-aware XBRL parser that aligns with HTML parser time windows
"""
import math
import time
import datetime as dt
import requests
import pandas as pd
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from .time_filters import TimeWindow, compute_ttm, pick_fy_value, filter_facts_by_window

SEC_BASE = "https://data.sec.gov/api"
HEADERS = {
    "User-Agent": "FundLensAI/1.0 (contact: fundlens.aws@fundlens.ai)",
    "Accept-Encoding": "gzip, deflate",
    "Host": "data.sec.gov"
}

# Global cache for API responses
_CACHE = {}

def _get_json(url: str) -> Dict[str, Any]:
    """Cached API calls with rate limiting."""
    if url in _CACHE: 
        return _CACHE[url]
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()
    _CACHE[url] = data
    time.sleep(0.2)  # SEC-friendly rate limiting
    return data

def companyfacts(cik: str) -> Dict[str, Any]:
    cik10 = str(cik).zfill(10)
    url = f"{SEC_BASE}/xbrl/companyfacts/CIK{cik10}.json"
    return _get_json(url)

def _normalize_val(val: Any) -> Optional[float]:
    try:
        return float(val)
    except Exception:
        return None

def _normalize_sign(value: float, sign_rule: str) -> float:
    """Normalize sign based on accounting rules."""
    if value is None: 
        return None
    if sign_rule == 'negative': 
        return -abs(value)
    if sign_rule == 'positive': 
        return abs(value)
    return value

def get_metric_time_aware(
    cik: str, 
    metric: str, 
    time_window: TimeWindow,
    desired_unit: str = "USD"
) -> Tuple[Optional[float], Dict[str, Any]]:
    """
    Time-aware metric getter that aligns with HTML parser time windows.
    """
    import yaml, os
    
    # Load metric mapping
    mapping_path = os.path.join(os.path.dirname(__file__), "metric_mapping.yaml")
    with open(mapping_path, "r") as f:
        mapping = yaml.safe_load(f)
    
    # Find metric configuration
    meta = None
    for m in mapping["metrics"]:
        if m.get("id") == metric or m.get("name").lower().startswith(metric.replace("_"," ").lower()):
            meta = m
            break
    
    if not meta:
        raise ValueError(f"Unknown metric: {metric}")
    
    # Get company facts
    facts_data = companyfacts(cik)
    
    # Extract facts for the metric
    tags = (meta.get('taxonomy_tags') or {}).get('priority', []) or (meta.get('taxonomy_tags') or [])
    unit_cands = meta.get('unit_candidates') or ['USD']
    
    prov = {"attempts": [], "time_window": {
        "start": time_window.start.isoformat(),
        "end": time_window.end.isoformat(),
        "basis": time_window.basis
    }}
    
    for fqname in tags:
        tax, tag = fqname.split(':',1) if ':' in fqname else (None, None)
        concept = facts_data.get('facts', {}).get(tax, {}).get(tag) if tax else None
        if not concept: 
            prov["attempts"].append({"tag": fqname, "found": False})
            continue
            
        # Get facts for the concept
        facts = []
        for unit, unit_facts in concept.get('units', {}).items():
            if unit.upper() in [u.upper() for u in unit_cands]:
                for fact in unit_facts:
                    fact_copy = dict(fact)
                    fact_copy['u'] = unit  # normalize unit field
                    facts.append(fact_copy)
        
        if not facts:
            prov["attempts"].append({"tag": fqname, "found": True, "unit": None})
            continue
        
        # Apply time-aware filtering based on metric type
        ptype = meta.get('period_type')
        
        if ptype == 'duration_ttm':
            # Use TTM calculation
            val, ttm_prov = compute_ttm(facts, time_window, unit_cands)
            if val is not None:
                val = _normalize_sign(val, meta.get('sign_rule','positive'))
                prov["attempts"].append({
                    "tag": fqname, 
                    "unit": ttm_prov.get("quarters_used", [{}])[0].get("u"),
                    "method": ttm_prov.get("method"),
                    "quarters_used": len(ttm_prov.get("quarters_used", [])),
                    "as_of": ttm_prov.get("as_of")
                })
                return val, prov
        else:
            # Use annual value for other metrics
            val, fy_prov = pick_fy_value(facts, time_window, unit_cands)
            if val is not None:
                val = _normalize_sign(val, meta.get('sign_rule','positive'))
                prov["attempts"].append({
                    "tag": fqname,
                    "unit": fy_prov.get("u"),
                    "method": fy_prov.get("method"),
                    "start": fy_prov.get("start"),
                    "end": fy_prov.get("end"),
                    "duration_days": fy_prov.get("duration_days")
                })
                return val, prov
        
        prov["attempts"].append({"tag": fqname, "unit": unit_cands[0], "resolved": False})
    
    return None, {"error": "no_fact_found", "provenance": prov}

def get_metrics_for_time_window(
    cik: str,
    metrics: List[str],
    time_window: TimeWindow,
    desired_unit: str = "USD"
) -> Dict[str, Dict[str, Any]]:
    """
    Get multiple metrics for a specific time window.
    """
    results = {}
    
    for metric in metrics:
        try:
            value, prov = get_metric_time_aware(cik, metric, time_window, desired_unit)
            results[metric] = {
                "value": value,
                "unit": desired_unit,
                "provenance": prov,
                "success": value is not None
            }
        except Exception as e:
            results[metric] = {
                "value": None,
                "error": str(e),
                "success": False
            }
    
    return results

# Example usage and testing
if __name__ == "__main__":
    # Test with Apple's 2024 fiscal year (matching HTML parser)
    cik = "0000320193"
    
    # Create time window for Apple's 2024 fiscal year (Sept 2023 - Sept 2024)
    time_window = TimeWindow.from_strings(
        start="2023-09-30",  # Start of FY 2024
        end="2024-09-28",    # End of FY 2024
        basis="FY"
    )
    
    # Test key metrics
    test_metrics = ['rev_ttm', 'gross_profit', 'ebit', 'net_income']
    
    print(f"=== Time-Aware XBRL Parser Test ===")
    print(f"Company: Apple (CIK: {cik})")
    print(f"Time Window: {time_window.start} to {time_window.end} ({time_window.basis})")
    print("=" * 60)
    
    results = get_metrics_for_time_window(cik, test_metrics, time_window)
    
    for metric, data in results.items():
        if data["success"]:
            print(f"✅ {metric:15} ${data['value']:>15,.0f}")
            print(f"   Method: {data['provenance']['attempts'][0].get('method', 'Unknown')}")
        else:
            print(f"❌ {metric:15} Not found")
            print(f"   Error: {data.get('error', 'Unknown')}")
        print()
