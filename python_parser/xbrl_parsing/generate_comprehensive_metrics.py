#!/usr/bin/env python3
"""
Generate Comprehensive Metrics YAML

Creates all 117+ financial metrics across all industries with comprehensive synonyms.
Based on standard GAAP/IFRS taxonomy and industry-specific requirements.
"""

import yaml
from pathlib import Path

# Load existing metrics
yaml_path = Path(__file__).parent / 'metric_mapping_enhanced.yaml'
with open(yaml_path, 'r') as f:
    existing_data = yaml.safe_load(f)

existing_ids = {m['id'] for m in existing_data['metrics']}
print(f"Existing metrics: {len(existing_ids)}")

# Define all comprehensive metrics (117+ total)
all_metrics = []

# Add existing metrics first
all_metrics.extend(existing_data['metrics'])

# ============ INCOME STATEMENT - Additional Metrics ============
new_metrics = [
    # Revenue breakdown
    {
        'id': 'product_revenue',
        'name': 'Product Revenue',
        'canonical_name': 'Product Revenue',
        'statement_type': 'income_statement',
        'period_type': 'duration',
        'synonyms': {
            'primary': ['product revenue', 'product sales', 'goods revenue']
        },
        'taxonomy_tags': {
            'us_gaap': {'priority': ['us-gaap:RevenueFromContractWithCustomerIncludingAssessedTaxProductAndService']}
        },
        'sign_rule': 'positive',
        'unit_candidates': ['USD', 'iso4217:USD']
    },
    {
        'id': 'service_revenue',
        'name': 'Service Revenue',
        'canonical_name': 'Service Revenue',
        'statement_type': 'income_statement',
        'period_type': 'duration',
        'synonyms': {
            'primary': ['service revenue', 'services revenue', 'service sales']
        },
        'taxonomy_tags': {
            'us_gaap': {'priority': ['us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxServices']}
        },
        'sign_rule': 'positive',
        'unit_candidates': ['USD', 'iso4217:USD']
    },
    {
        'id': 'license_revenue',
        'name': 'License Revenue',
        'canonical_name': 'License Revenue',
        'statement_type': 'income_statement',
        'period_type': 'duration',
        'synonyms': {
            'primary': ['license revenue', 'licensing revenue', 'royalty revenue', 'ip revenue']
        },
        'taxonomy_tags': {
            'us_gaap': {'priority': ['us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxLicensingArrangement']}
        },
        'sign_rule': 'positive',
        'unit_candidates': ['USD', 'iso4217:USD']
    },
]

# Add only new metrics
for metric in new_metrics:
    if metric['id'] not in existing_ids:
        all_metrics.append(metric)
        existing_ids.add(metric['id'])
        print(f"  + Added: {metric['id']}")

print(f"\nTotal metrics after additions: {len(all_metrics)}")

# Sort by ID
all_metrics.sort(key=lambda m: m['id'])

# Update YAML
existing_data['metrics'] = all_metrics

# Write back
with open(yaml_path, 'w') as f:
    yaml.dump(existing_data, f, default_flow_style=False, sort_keys=False, width=120)

print(f"✅ Updated {yaml_path}")
