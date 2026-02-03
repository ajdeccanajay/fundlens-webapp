#!/usr/bin/env python3
"""
Multi-Company Validation for Hybrid iXBRL Parser
Tests extraction across all 10 target companies.
"""

import requests
import time
import json
from hybrid_parser import HybridSECParser
from xbrl_tag_mapper import get_mapper

USER_AGENT = "FundLensAI/1.0 (contact: admin@fundlens.ai)"

# All 10 target companies with their latest 10-K filing URLs
# CIK lookup: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=
COMPANIES = {
    "AAPL": {"cik": "320193", "url": "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm"},
    "MSFT": {"cik": "789019", "url": "https://www.sec.gov/Archives/edgar/data/789019/000095017024087843/msft-20240630.htm"},
    "GOOGL": {"cik": "1652044", "url": "https://www.sec.gov/Archives/edgar/data/1652044/000165204425000014/goog-20241231.htm"},
    "AMZN": {"cik": "1018724", "url": "https://www.sec.gov/Archives/edgar/data/1018724/000101872425000004/amzn-20241231.htm"},
    "TSLA": {"cik": "1318605", "url": "https://www.sec.gov/Archives/edgar/data/1318605/000162828025003063/tsla-20241231.htm"},
    "META": {"cik": "1326801", "url": "https://www.sec.gov/Archives/edgar/data/1326801/000132680125000017/meta-20241231.htm"},
    "NVDA": {"cik": "1045810", "url": "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000023/nvda-20250126.htm"},
    "JPM": {"cik": "19617", "url": "https://www.sec.gov/Archives/edgar/data/19617/000001961725000270/jpm-20241231.htm"},
    "BAC": {"cik": "70858", "url": "https://www.sec.gov/Archives/edgar/data/70858/000007085825000139/bac-20241231.htm"},
    "WMT": {"cik": "104169", "url": "https://www.sec.gov/Archives/edgar/data/104169/000010416925000021/wmt-20250131.htm"},
}

KEY_METRICS = [
    'revenue', 'net_income', 'total_assets', 'total_liabilities',
    'shareholders_equity', 'operating_cash_flow', 
    'earnings_per_share_basic', 'earnings_per_share_diluted'
]

def download_filing(ticker: str, url: str) -> str:
    print(f"  Downloading {ticker}...", end=" ", flush=True)
    time.sleep(0.3)
    try:
        response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60)
        if response.status_code == 200:
            print(f"{len(response.text):,} bytes")
            return response.text
        else:
            print(f"FAILED ({response.status_code})")
            return ""
    except Exception as e:
        print(f"ERROR: {e}")
        return ""


def validate_company(ticker: str, html: str) -> dict:
    """Validate parser on a single company"""
    parser = HybridSECParser()
    result = parser.parse_filing(html, ticker, "10-K", "unknown")
    
    meta = result['metadata']
    metrics = result['structured_metrics']
    
    # Check key metrics
    found_metrics = {}
    for metric in metrics:
        norm = metric['normalized_metric']
        if norm in KEY_METRICS:
            if norm not in found_metrics:
                found_metrics[norm] = []
            found_metrics[norm].append({
                'value': metric['value'],
                'period': metric['fiscal_period'],
                'confidence': metric['confidence_score'],
                'is_derived': metric.get('is_derived', False),
                'source': metric.get('source', 'ixbrl'),
            })
    
    # Get latest value for each key metric
    key_metric_values = {}
    for km in KEY_METRICS:
        if km in found_metrics:
            latest = sorted(found_metrics[km], key=lambda x: x['period'], reverse=True)[0]
            key_metric_values[km] = latest
        else:
            key_metric_values[km] = None
    
    return {
        'ticker': ticker,
        'total_metrics': meta['total_metrics'],
        'mvp_metrics': meta['mvp_metrics'],
        'unique_concepts': meta['unique_concepts'],
        'ixbrl_facts': meta['ixbrl_facts_raw'],
        'key_metrics': key_metric_values,
        'key_metrics_found': sum(1 for v in key_metric_values.values() if v is not None),
    }


def main():
    print("=" * 80)
    print("Multi-Company Validation - Hybrid iXBRL Parser")
    print("=" * 80)
    
    mapper = get_mapper()
    print(f"Tag Mapper: {len(mapper.tag_to_metric)} XBRL tags mapped\n")
    
    results = {}
    
    for ticker, info in COMPANIES.items():
        html = download_filing(ticker, info['url'])
        if html:
            results[ticker] = validate_company(ticker, html)
        else:
            results[ticker] = {'ticker': ticker, 'error': 'Download failed'}
    
    # Print summary table
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"{'Ticker':<8} {'Total':<8} {'MVP':<6} {'Concepts':<10} {'Key Found':<10} {'Status'}")
    print("-" * 80)
    
    for ticker, r in results.items():
        if 'error' in r:
            print(f"{ticker:<8} {'ERROR':<8} {'-':<6} {'-':<10} {'-':<10} {r['error']}")
        else:
            status = "✅" if r['key_metrics_found'] >= 6 else "⚠️" if r['key_metrics_found'] >= 4 else "❌"
            print(f"{ticker:<8} {r['total_metrics']:<8} {r['mvp_metrics']:<6} {r['unique_concepts']:<10} {r['key_metrics_found']}/8{'':<6} {status}")
    
    # Print key metrics detail
    print("\n" + "=" * 80)
    print("KEY METRICS BY COMPANY")
    print("=" * 80)
    
    for ticker, r in results.items():
        if 'error' in r:
            continue
        print(f"\n{ticker}:")
        for km in KEY_METRICS:
            val = r['key_metrics'].get(km)
            if val:
                # Add asterisk for derived metrics
                derived_marker = "*" if val.get('is_derived', False) else ""
                if km.startswith('earnings'):
                    print(f"  {'✅'} {km:<30} = ${val['value']:>12.2f} ({val['period']}){derived_marker}")
                else:
                    print(f"  {'✅'} {km:<30} = ${val['value']:>15,.0f} ({val['period']}){derived_marker}")
            else:
                print(f"  {'❌'} {km:<30} = NOT FOUND")
    
    # Print legend for derived metrics
    print("\n* = Derived metric (calculated from other extracted values)")
    
    # Save results to JSON
    with open('validation_results.json', 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to validation_results.json")


if __name__ == "__main__":
    main()
