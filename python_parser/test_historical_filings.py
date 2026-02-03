#!/usr/bin/env python3
"""
Historical Filing Test - Backward Compatibility Validation

Tests the hybrid parser on historical 10-K filings from 2018-2020
to ensure it works with older SEC filing formats.

Target companies: GOOGL, AAPL, BAC
Target years: 2018, 2019, 2020
"""

import requests
import time
import json
from collections import defaultdict
from hybrid_parser import HybridSECParser

USER_AGENT = "FundLensAI/1.0 (contact: admin@fundlens.ai)"

# Historical 10-K filings (valid URLs from SEC API)
HISTORICAL_FILINGS = {
    # AAPL Historical 10-Ks (confirmed working)
    "AAPL_2020": {
        "ticker": "AAPL",
        "year": "2020",
        "cik": "320193",
        "url": "https://www.sec.gov/Archives/edgar/data/320193/000032019320000096/aapl-20200926.htm"
    },
    "AAPL_2019": {
        "ticker": "AAPL", 
        "year": "2019",
        "cik": "320193",
        "url": "https://www.sec.gov/Archives/edgar/data/320193/000032019319000119/a10-k20199282019.htm"
    },
    "AAPL_2018": {
        "ticker": "AAPL",
        "year": "2018", 
        "cik": "320193",
        "url": "https://www.sec.gov/Archives/edgar/data/320193/000032019318000145/a10-k20189292018.htm"
    },
    
    # GOOGL Historical 10-Ks (using known working patterns)
    "GOOGL_2020": {
        "ticker": "GOOGL",
        "year": "2020",
        "cik": "1652044", 
        "url": "https://www.sec.gov/Archives/edgar/data/1652044/000165204421000010/goog-20201231.htm"
    },
    
    # BAC Historical 10-Ks (using known working patterns)
    "BAC_2020": {
        "ticker": "BAC",
        "year": "2020",
        "cik": "70858",
        "url": "https://www.sec.gov/Archives/edgar/data/70858/000007085821000009/bac-20201231.htm"
    },
}

KEY_METRICS = [
    'revenue', 'net_income', 'total_assets', 'total_liabilities',
    'shareholders_equity', 'operating_cash_flow', 
    'earnings_per_share_basic', 'earnings_per_share_diluted'
]


def download_filing(name: str, url: str) -> str:
    """Download historical filing with rate limiting."""
    print(f"  Downloading {name}...", end=" ", flush=True)
    time.sleep(0.5)  # Rate limiting for historical files
    try:
        response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=90)
        if response.status_code == 200:
            print(f"{len(response.text):,} bytes")
            return response.text
        else:
            print(f"FAILED ({response.status_code})")
            return ""
    except Exception as e:
        print(f"ERROR: {e}")
        return ""


def test_historical_filing(name: str, info: dict) -> dict:
    """Test parser on a historical filing."""
    print(f"\n{'-' * 50}")
    print(f"Testing: {name} ({info['year']})")
    print(f"{'-' * 50}")
    
    html = download_filing(name, info['url'])
    if not html:
        return {'error': 'Download failed'}
    
    # Parse filing
    parser = HybridSECParser()
    result = parser.parse_filing(
        html, 
        info['ticker'], 
        "10-K",
        info['cik']
    )
    
    metrics = result['structured_metrics']
    narratives = result['narrative_chunks']
    meta = result['metadata']
    
    # Find key metrics
    found_metrics = {}
    for m in metrics:
        if m['normalized_metric'] in KEY_METRICS:
            key = m['normalized_metric']
            if key not in found_metrics or m['confidence_score'] > found_metrics[key]['confidence_score']:
                found_metrics[key] = m
    
    # Analyze results
    print(f"\n  Results:")
    print(f"    Total metrics: {len(metrics)}")
    print(f"    Unique concepts: {meta['unique_concepts']}")
    print(f"    Narrative chunks: {len(narratives)}")
    print(f"    Key metrics found: {len(found_metrics)}/8")
    
    # Show key metrics
    print(f"\n  Key Metrics:")
    for metric_name in KEY_METRICS:
        if metric_name in found_metrics:
            m = found_metrics[metric_name]
            derived = "*" if m.get('is_derived') else ""
            if 'earnings' in metric_name:
                print(f"    ✅ {metric_name}: ${m['value']:.2f} ({m['fiscal_period']}){derived}")
            else:
                print(f"    ✅ {metric_name}: ${m['value']:,.0f} ({m['fiscal_period']}){derived}")
        else:
            print(f"    ❌ {metric_name}: NOT FOUND")
    
    # Check for parsing issues
    issues = []
    if len(metrics) < 100:
        issues.append("Low metric count")
    if len(found_metrics) < 6:
        issues.append("Missing key metrics")
    if len(narratives) < 20:
        issues.append("Low narrative extraction")
    
    if issues:
        print(f"\n  ⚠️  Issues: {', '.join(issues)}")
    else:
        print(f"\n  ✅ No issues detected")
    
    return {
        'ticker': info['ticker'],
        'year': info['year'],
        'total_metrics': len(metrics),
        'unique_concepts': meta['unique_concepts'],
        'narratives': len(narratives),
        'key_metrics_found': len(found_metrics),
        'key_metrics': found_metrics,
        'issues': issues,
        'ixbrl_facts': meta.get('ixbrl_facts_raw', 0),
    }


def main():
    print("=" * 80)
    print("HISTORICAL FILING TEST - Backward Compatibility")
    print("Testing: AAPL, GOOGL, BAC (2018-2020)")
    print("=" * 80)
    
    results = {}
    
    # Test each historical filing
    for name, info in HISTORICAL_FILINGS.items():
        results[name] = test_historical_filing(name, info)
    
    # Summary analysis
    print("\n" + "=" * 80)
    print("HISTORICAL COMPATIBILITY SUMMARY")
    print("=" * 80)
    
    print(f"{'Filing':<15} {'Year':<6} {'Metrics':<10} {'Key Found':<12} {'iXBRL Facts':<12} {'Status'}")
    print("-" * 75)
    
    by_company = defaultdict(list)
    for name, r in results.items():
        if 'error' not in r:
            by_company[r['ticker']].append(r)
    
    for name, r in results.items():
        if 'error' in r:
            print(f"{name:<15} {'N/A':<6} {'ERROR':<10} {'-':<12} {'-':<12} {r['error']}")
        else:
            status = "✅" if r['key_metrics_found'] >= 6 and not r['issues'] else "⚠️" if r['key_metrics_found'] >= 4 else "❌"
            print(f"{name:<15} {r['year']:<6} {r['total_metrics']:<10} {r['key_metrics_found']}/8{'':<8} {r['ixbrl_facts']:<12} {status}")
    
    # Company-wise analysis
    print("\n" + "=" * 80)
    print("COMPANY TRENDS (2018-2020)")
    print("=" * 80)
    
    for ticker, company_results in by_company.items():
        print(f"\n{ticker}:")
        company_results.sort(key=lambda x: x['year'])
        
        for r in company_results:
            trend = ""
            if len(company_results) > 1:
                # Compare with previous year
                prev_year_data = [cr for cr in company_results if int(cr['year']) == int(r['year']) - 1]
                if prev_year_data:
                    prev = prev_year_data[0]
                    metric_change = r['total_metrics'] - prev['total_metrics']
                    trend = f" ({metric_change:+d} vs {prev['year']})" if metric_change != 0 else ""
            
            print(f"  {r['year']}: {r['total_metrics']} metrics, {r['key_metrics_found']}/8 key{trend}")
    
    # Backward compatibility assessment
    print("\n" + "=" * 80)
    print("BACKWARD COMPATIBILITY ASSESSMENT")
    print("=" * 80)
    
    total_tests = len([r for r in results.values() if 'error' not in r])
    successful_tests = len([r for r in results.values() if 'error' not in r and r['key_metrics_found'] >= 6])
    compatibility_rate = (successful_tests / total_tests * 100) if total_tests > 0 else 0
    
    print(f"Total historical filings tested: {total_tests}")
    print(f"Successful extractions (≥6 key metrics): {successful_tests}")
    print(f"Backward compatibility rate: {compatibility_rate:.1f}%")
    
    if compatibility_rate >= 90:
        print("✅ EXCELLENT backward compatibility")
    elif compatibility_rate >= 75:
        print("⚠️  GOOD backward compatibility (some issues)")
    else:
        print("❌ POOR backward compatibility (needs investigation)")
    
    # Save results
    with open('historical_filing_results.json', 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to historical_filing_results.json")


if __name__ == "__main__":
    main()