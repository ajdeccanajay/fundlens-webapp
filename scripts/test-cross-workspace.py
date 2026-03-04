#!/usr/bin/env python3
"""Test AMZN queries from AAPL workspace context (RC5 regression test)"""
import json, urllib.request, ssl

BASE = "https://fundlens-production-alb-931926615.us-east-1.elb.amazonaws.com"
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def query_rag(query_text, tickers, ticker=None):
    payload = {"query": query_text, "tickers": tickers}
    if ticker:
        payload["ticker"] = ticker
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE}/api/rag/query",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, context=ctx) as resp:
        return json.loads(resp.read())

def print_result(label, result):
    print(f"\n{'='*70}")
    print(f"TEST: {label}")
    print(f"{'='*70}")
    intent = result.get("intent", {})
    print(f"Intent ticker: {intent.get('ticker')}")
    print(f"Intent metrics: {intent.get('metrics')}")
    
    metrics = result.get("metrics", [])
    print(f"\nMetrics ({len(metrics)} total):")
    for m in metrics:
        v = m.get("value", 0)
        vstr = f"${v/1e9:.1f}B" if v and v > 1e6 else str(v)
        print(f"  {m.get('ticker')} | {m.get('normalizedMetric')} | {m.get('fiscalPeriod')} | {vstr}")
    
    amzn = [m for m in metrics if m.get("ticker") == "AMZN"]
    aapl = [m for m in metrics if m.get("ticker") == "AAPL"]
    print(f"\nAMZN metrics: {len(amzn)}, AAPL metrics: {len(aapl)}")
    
    citations = result.get("citations", [])
    print(f"\nCitations ({len(citations)} total):")
    for c in citations:
        print(f"  [{c.get('number')}] {c.get('sourceType')} | {c.get('ticker')} | {c.get('filingType')} | {c.get('fiscalPeriod')}")
    
    answer = result.get("answer", "")
    print(f"\nAnswer (first 300 chars):\n{answer[:300]}")

# Test 1: AMZN revenue from AAPL workspace (RC5 scenario)
r1 = query_rag("What is the revenue for AMZN?", ["AMZN", "AAPL"], ticker="AMZN")
print_result("AMZN Revenue from AAPL workspace (tickers=[AMZN, AAPL])", r1)

# Test 2: AMZN net income from AAPL workspace
r2 = query_rag("What is the net income for AMZN?", ["AMZN", "AAPL"], ticker="AMZN")
print_result("AMZN Net Income from AAPL workspace (tickers=[AMZN, AAPL])", r2)

# Test 3: Compare AMZN and AAPL revenue (cross-workspace comparison)
r3 = query_rag("Compare revenue for AMZN and AAPL", ["AMZN", "AAPL"])
print_result("Compare AMZN vs AAPL Revenue", r3)

print("\n" + "="*70)
print("SUMMARY")
print("="*70)

# Validate RC5 fix
r1_amzn = [m for m in r1.get("metrics", []) if m.get("ticker") == "AMZN"]
r2_amzn = [m for m in r2.get("metrics", []) if m.get("ticker") == "AMZN"]
r3_amzn = [m for m in r3.get("metrics", []) if m.get("ticker") == "AMZN"]
r3_aapl = [m for m in r3.get("metrics", []) if m.get("ticker") == "AAPL"]

print(f"Test 1 (AMZN revenue from AAPL ws): {'PASS' if len(r1_amzn) > 0 else 'FAIL'} — {len(r1_amzn)} AMZN metrics")
print(f"Test 2 (AMZN net income from AAPL ws): {'PASS' if len(r2_amzn) > 0 else 'FAIL'} — {len(r2_amzn)} AMZN metrics")
print(f"Test 3 (AMZN vs AAPL comparison): {'PASS' if len(r3_amzn) > 0 and len(r3_aapl) > 0 else 'FAIL'} — {len(r3_amzn)} AMZN, {len(r3_aapl)} AAPL")
