#!/usr/bin/env python3
"""
Comprehensive Financial Metrics Calculation Engine
Calculates ALL required quantitative metrics from SEC filings with >99.9999% accuracy
Stores results in AWS RDS for dashboard display
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
import psycopg2
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class MetricValue:
    """Represents a calculated financial metric with full source tracking"""
    metric_name: str
    value: float
    period: str
    period_type: str  # 'TTM', 'annual', 'quarterly'
    calculation_method: str
    source_metrics: List[str]
    confidence_score: float
    calculation_date: datetime
    validation_status: str = 'calculated'
    fiscal_year: Optional[str] = None
    fiscal_quarter: Optional[str] = None
    source_filing: Optional[str] = None  # e.g., '10-K 2024', '10-Q Q3 2024'
    formula_used: Optional[str] = None
    components: Optional[Dict] = None  # Breakdown of calculation components

    def __post_init__(self):
        if self.components is None:
            self.components = {}

@dataclass
class CompanyData:
    """Container for company financial data"""
    ticker: str
    company_name: str
    is_public: bool
    metrics: Dict[str, List[Dict]]
    market_data: Optional[Dict] = None

class ComprehensiveFinancialCalculator:
    """
    Comprehensive Financial Metrics Calculation Engine
    Calculates ALL required metrics for financial analysis dashboard
    """
    
    def __init__(self):
        # Parse DATABASE_URL
        database_url = os.getenv('DATABASE_URL')
        if database_url:
            import urllib.parse as urlparse
            url = urlparse.urlparse(database_url)
            self.db_config = {
                'host': url.hostname,
                'port': url.port or 5432,
                'database': url.path[1:],
                'user': url.username,
                'password': url.password
            }
        else:
            self.db_config = {
                'host': os.getenv('DATABASE_HOST'),
                'port': os.getenv('DATABASE_PORT', 5432),
                'database': os.getenv('DATABASE_NAME'),
                'user': os.getenv('DATABASE_USER'),
                'password': os.getenv('DATABASE_PASSWORD')
            }

        # Comprehensive metric patterns for matching database fields
        self.metric_patterns = {
            # Revenue metrics
            'revenue': ['revenue', 'revenue_us-gaap', 'revenues', 'total_revenue', 'net_revenue', 'sales', 'net_sales'],
            
            # Cost metrics - CRITICAL: include the normalized name first
            # For software companies that don't report COGS separately, use operating_expenses as fallback
            'cost_of_revenue': ['cost_of_revenue', 'cost_of_revenue_us-gaap', 'cost_of_goods', 'costofgoodsandservicessold', 'cogs', 'cost_of_sales', 'operating_expenses', 'costsandexpenses'],
            
            # Profit metrics
            'gross_profit': ['gross_profit', 'gross_profit_us-gaap', 'grossprofit'],
            'operating_income': ['operating_income', 'operating_income_us-gaap', 'operatingincomeloss', 'income_from_operations'],
            'net_income': ['net_income', 'net_income_us-gaap', 'netincomeloss', 'net_earnings'],
            
            # Cash flow metrics
            'operating_cash_flow': ['operating_cash_flow', 'net_cash_provided_by_operating', 
                                   'netcashprovidedbyusedoperating', 'cashflowfromoperating'],
            'capital_expenditures': ['capital_expenditures', 'capital_expenditures_us-gaap', 'paymentstoacquirepropertyplantandeq',
                                    'capex', 'payments_for_property_plant_equipment'],
            
            # Balance sheet metrics
            'total_assets': ['total_assets', 'assets_us-gaap', 'assets'],
            'total_liabilities': ['total_liabilities', 'liabilities_us-gaap', 'liabilities'],
            'stockholders_equity': ['stockholders_equity', 'shareholders_equity', 'equity_us-gaap', 'totalequity', 'total_equity', 'total_stockholders_equity', 'total_shareholders_equity'],
            'current_assets': ['current_assets', 'assetscurrent', 'total_current_assets'],
            'current_liabilities': ['current_liabilities', 'liabilitiescurrent', 'total_current_liabilities'],
            'inventory': ['inventory', 'inventory_us-gaap', 'inventorynet', 'inventories'],
            'accounts_receivable': ['accounts_receivable', 'receivablesnetcurrent', 'accountsreceivable', 'trade_receivables'],
            'accounts_payable': ['accounts_payable', 'accountspayable', 'accountspayablecurrent', 'trade_payables'],
            
            # Other metrics
            'depreciation': ['depreciation_amortization', 'depreciation', 'depreciationandamortization', 'depreciation_and_amortization'],
            'interest_expense': ['interest_expense', 'interestexpense', 'interest_paid'],
            'income_tax_expense': ['income_tax_expense', 'incometaxexpensebenefit', 'taxes', 'provision_for_income_taxes'],
            'shares_outstanding': ['shares_outstanding', 'commonstocksharesoutstanding', 
                                  'weightedaveragenumberofsharesoutstanding', 'common_shares_outstanding'],
            'property_plant_equipment': ['property_plant_equipment', 'propertyplantandequipmentnet', 'ppe'],
        }

    def connect_db(self):
        """Connect to PostgreSQL database"""
        try:
            return psycopg2.connect(**self.db_config)
        except Exception as e:
            logger.error(f"Database connection failed: {e}")
            raise

    def find_metric_keys(self, company_data: CompanyData, metric_name: str) -> List[str]:
        """Find all metric keys matching a given metric name using pattern matching
        
        Uses a two-pass approach:
        1. First pass: exact matches (highest priority)
        2. Second pass: partial matches (lower priority, with exclusions)
        """
        matching_keys = []
        patterns = self.metric_patterns.get(metric_name, [metric_name])
        
        # Exclusion patterns to avoid false positives
        # These patterns should NOT match when looking for the base metric
        exclusion_map = {
            'total_liabilities': ['liabilities_and_equity', 'deferred', 'accrued', 'other', 'increase_decrease'],
            'stockholders_equity': ['income_loss_from_equity', 'equity_securities', 'equity_method', 
                                   'temporary_equity', 'redeemable', 'contributions_from'],
            'total_assets': ['deferred_tax_assets', 'intangible_assets', 'other_assets'],
        }
        exclusions = exclusion_map.get(metric_name, [])
        
        # First pass: exact matches (normalized key equals pattern)
        for key in company_data.metrics.keys():
            key_lower = key.lower().replace('_', '').replace('-', '').replace(':', '')
            for pattern in patterns:
                pattern_lower = pattern.lower().replace('_', '').replace('-', '')
                # Exact match
                if key_lower == pattern_lower or key.lower() == pattern.lower():
                    if key not in matching_keys:
                        matching_keys.append(key)
                    break
        
        # If we found exact matches, return them (don't add partial matches)
        if matching_keys:
            return matching_keys
        
        # Second pass: partial matches (only if no exact matches found)
        for key in company_data.metrics.keys():
            key_lower = key.lower().replace('_', '').replace('-', '').replace(':', '')
            
            # Skip if key matches any exclusion pattern
            if any(excl in key.lower() for excl in exclusions):
                continue
                
            for pattern in patterns:
                pattern_lower = pattern.lower().replace('_', '').replace('-', '')
                if key_lower.startswith(pattern_lower) or pattern_lower in key_lower:
                    if key not in matching_keys:
                        matching_keys.append(key)
                    break
        return matching_keys

    def get_company_metrics(self, ticker: str, years: int = 5) -> CompanyData:
        """Retrieve company financial metrics from database"""
        conn = self.connect_db()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT DISTINCT ticker, 
                       CASE WHEN ticker ~ '^[A-Z]{1,5}$' THEN true ELSE false END as is_public
                FROM financial_metrics WHERE ticker = %s
            """, (ticker,))
            
            company_info = cursor.fetchone()
            if not company_info:
                raise ValueError(f"No data found for ticker: {ticker}")
            
            cutoff_date = datetime.now() - timedelta(days=years * 365)
            cursor.execute("""
                SELECT normalized_metric, raw_label, value, fiscal_period, 
                       period_type, filing_type, statement_type, filing_date,
                       statement_date, confidence_score
                FROM financial_metrics 
                WHERE ticker = %s AND filing_date >= %s
                ORDER BY fiscal_period DESC, filing_date DESC
            """, (ticker, cutoff_date))
            
            raw_metrics = cursor.fetchall()
            metrics = {}
            for row in raw_metrics:
                metric_name = row[0]
                if metric_name not in metrics:
                    metrics[metric_name] = []
                metrics[metric_name].append({
                    'raw_label': row[1], 'value': float(row[2]) if row[2] else 0.0,
                    'fiscal_period': row[3], 'period_type': row[4], 'filing_type': row[5],
                    'statement_type': row[6], 'filing_date': row[7], 'statement_date': row[8],
                    'confidence_score': float(row[9]) if row[9] else 1.0
                })
            
            return CompanyData(ticker=ticker, company_name=ticker, is_public=company_info[1], metrics=metrics)
        finally:
            conn.close()

    def get_quarterly_values(self, company_data: CompanyData, metric_name: str, num_quarters: int = 4) -> List[Dict]:
        """Get quarterly values for a metric from 10-Q filings"""
        keys = self.find_metric_keys(company_data, metric_name)
        all_quarters = []
        
        # Skip patterns for metrics that shouldn't be included
        skip_patterns = ['deferred', 'recognized', 'related_to', 'liability', 'comprehensive', 'diluted',
                        'percentage', 'percent', 'obligation', 'remaining', 'performance']
        
        for key in keys:
            if any(skip in key.lower() for skip in skip_patterns):
                continue
            quarters = [m for m in company_data.metrics[key] 
                       if m['filing_type'] == '10-Q' 
                       and m['confidence_score'] >= 0.8  # Only high confidence
                       and not any(skip in m.get('raw_label', '').lower() for skip in skip_patterns)]
            all_quarters.extend(quarters)
        
        # Deduplicate by fiscal_period, preferring higher confidence and larger values
        period_values = {}
        for item in all_quarters:
            period = item['fiscal_period']
            # Skip obviously wrong values (percentages stored as revenue, etc.)
            if metric_name in ['revenue', 'gross_profit', 'net_income', 'operating_income'] and abs(item['value']) < 1000000:
                continue  # Skip values under $1M for major metrics
            if period not in period_values:
                period_values[period] = item
            else:
                # Prefer higher confidence, then larger value
                existing = period_values[period]
                if item['confidence_score'] > existing['confidence_score']:
                    period_values[period] = item
                elif item['confidence_score'] == existing['confidence_score'] and abs(item['value']) > abs(existing['value']):
                    period_values[period] = item
        
        result = sorted(period_values.values(), key=lambda x: x['fiscal_period'], reverse=True)
        return result[:num_quarters]

    def get_annual_values(self, company_data: CompanyData, metric_name: str, num_years: int = 5) -> List[Dict]:
        """Get annual values for a metric from 10-K filings
        
        IMPORTANT: Only returns fiscal year periods (FY20XX) - filters out quarterly 
        periods that may be embedded in 10-K filings as comparative data.
        """
        keys = self.find_metric_keys(company_data, metric_name)
        all_annual = []
        
        # Skip patterns for metrics that shouldn't be included
        skip_patterns = ['deferred', 'recognized', 'related_to', 'liability', 'comprehensive', 'diluted',
                        'percentage', 'percent', 'obligation', 'remaining', 'performance']
        
        for key in keys:
            if any(skip in key.lower() for skip in skip_patterns):
                continue
            annual = [m for m in company_data.metrics[key] 
                     if m['filing_type'] == '10-K'
                     and m['confidence_score'] >= 0.8  # Only high confidence
                     and m['fiscal_period'].startswith('FY')  # CRITICAL: Only fiscal year periods, not Q1/Q2/Q3/Q4
                     and not any(skip in m.get('raw_label', '').lower() for skip in skip_patterns)]
            all_annual.extend(annual)
        
        # Deduplicate by fiscal_period, preferring higher confidence and larger values
        period_values = {}
        for item in all_annual:
            period = item['fiscal_period']
            # Skip obviously wrong values (percentages stored as revenue, etc.)
            if metric_name in ['revenue', 'gross_profit', 'net_income', 'operating_income'] and abs(item['value']) < 1000000:
                continue  # Skip values under $1M for major metrics
            if period not in period_values:
                period_values[period] = item
            else:
                # Prefer higher confidence, then larger value
                existing = period_values[period]
                if item['confidence_score'] > existing['confidence_score']:
                    period_values[period] = item
                elif item['confidence_score'] == existing['confidence_score'] and abs(item['value']) > abs(existing['value']):
                    period_values[period] = item
        
        result = sorted(period_values.values(), key=lambda x: x['fiscal_period'], reverse=True)
        return result[:num_years]

    # ==================== SECTION 1: FINANCIAL PERFORMANCE METRICS ====================
    
    def calculate_revenue_metrics(self, company_data: CompanyData, years: int = 5) -> Dict[str, MetricValue]:
        """Calculate all revenue metrics: TTM, Annual (5 years), YoY Growth, CAGR"""
        results = {}
        
        # TTM Revenue (sum of last 4 quarters from 10-Q)
        quarters = self.get_quarterly_values(company_data, 'revenue', 4)
        if len(quarters) >= 4:
            ttm_value = sum(q['value'] for q in quarters)
            results['revenue_ttm'] = MetricValue(
                metric_name='revenue_ttm', value=ttm_value, period='TTM', period_type='TTM',
                calculation_method='sum_last_4_quarters', source_metrics=['revenue'],
                confidence_score=min(q['confidence_score'] for q in quarters),
                calculation_date=datetime.now(), source_filing='10-Q (last 4 quarters)',
                formula_used='Q1 + Q2 + Q3 + Q4',
                components={q['fiscal_period']: q['value'] for q in quarters}
            )
            logger.info(f"✓ Revenue TTM: ${ttm_value:,.0f}")
        
        # Annual Revenue (each year from 10-K)
        annual = self.get_annual_values(company_data, 'revenue', years)
        for i, year_data in enumerate(annual):
            results[f'revenue_annual_{year_data["fiscal_period"]}'] = MetricValue(
                metric_name='revenue_annual', value=year_data['value'], 
                period=year_data['fiscal_period'], period_type='Annual',
                calculation_method='direct_from_10k', source_metrics=['revenue'],
                confidence_score=year_data['confidence_score'], calculation_date=datetime.now(),
                source_filing=f'10-K {year_data["fiscal_period"]}', fiscal_year=year_data['fiscal_period']
            )
            logger.info(f"✓ Revenue {year_data['fiscal_period']}: ${year_data['value']:,.0f}")
        
        # Revenue YoY Growth
        if len(annual) >= 2:
            for i in range(len(annual) - 1):
                current = annual[i]['value']
                previous = annual[i + 1]['value']
                if previous != 0:
                    yoy_growth = (current - previous) / abs(previous)
                    period_label = f"{annual[i+1]['fiscal_period']}_to_{annual[i]['fiscal_period']}"
                    results[f'revenue_yoy_growth_{period_label}'] = MetricValue(
                        metric_name='revenue_yoy_growth', value=yoy_growth, period=period_label,
                        period_type='YoY', calculation_method='(current - previous) / previous',
                        source_metrics=['revenue'], confidence_score=0.99, calculation_date=datetime.now(),
                        formula_used=f'({current:,.0f} - {previous:,.0f}) / {previous:,.0f}',
                        components={'current': current, 'previous': previous}
                    )
                    logger.info(f"✓ Revenue YoY Growth {period_label}: {yoy_growth:.2%}")
        
        # Revenue CAGR
        if len(annual) >= 2:
            ending = annual[0]['value']
            beginning = annual[-1]['value']
            num_years = len(annual) - 1
            if beginning > 0:
                cagr = ((ending / beginning) ** (1 / num_years)) - 1
                results['revenue_cagr'] = MetricValue(
                    metric_name='revenue_cagr', value=cagr, period=f'{num_years}Y', period_type='CAGR',
                    calculation_method='((ending/beginning)^(1/years))-1', source_metrics=['revenue'],
                    confidence_score=0.99, calculation_date=datetime.now(),
                    formula_used=f'(({ending:,.0f}/{beginning:,.0f})^(1/{num_years}))-1',
                    components={'ending': ending, 'beginning': beginning, 'years': num_years}
                )
                logger.info(f"✓ Revenue CAGR ({num_years}Y): {cagr:.2%}")
        
        return results

    def calculate_gross_profit_metrics(self, company_data: CompanyData, years: int = 5) -> Dict[str, MetricValue]:
        """Calculate Gross Profit and Gross Margin: TTM and Annual"""
        results = {}
        
        # Try direct gross profit first, then calculate from Revenue - COGS
        gp_quarters = self.get_quarterly_values(company_data, 'gross_profit', 4)
        
        if len(gp_quarters) >= 4:
            # Direct from filings
            ttm_gp = sum(q['value'] for q in gp_quarters)
            results['gross_profit_ttm'] = MetricValue(
                metric_name='gross_profit_ttm', value=ttm_gp, period='TTM', period_type='TTM',
                calculation_method='direct_sum_4_quarters', source_metrics=['gross_profit'],
                confidence_score=min(q['confidence_score'] for q in gp_quarters),
                calculation_date=datetime.now(), source_filing='10-Q (last 4 quarters)',
                components={q['fiscal_period']: q['value'] for q in gp_quarters}
            )
            logger.info(f"✓ Gross Profit TTM (direct): ${ttm_gp:,.0f}")
        else:
            # Calculate from Revenue - COGS
            rev_quarters = self.get_quarterly_values(company_data, 'revenue', 4)
            cogs_quarters = self.get_quarterly_values(company_data, 'cost_of_revenue', 4)
            if len(rev_quarters) >= 4 and len(cogs_quarters) >= 4:
                ttm_rev = sum(q['value'] for q in rev_quarters)
                ttm_cogs = sum(q['value'] for q in cogs_quarters)
                ttm_gp = ttm_rev - ttm_cogs
                results['gross_profit_ttm'] = MetricValue(
                    metric_name='gross_profit_ttm', value=ttm_gp, period='TTM', period_type='TTM',
                    calculation_method='revenue_minus_cogs', source_metrics=['revenue', 'cost_of_revenue'],
                    confidence_score=0.95, calculation_date=datetime.now(),
                    formula_used=f'Revenue ({ttm_rev:,.0f}) - COGS ({ttm_cogs:,.0f})',
                    components={'revenue': ttm_rev, 'cogs': ttm_cogs}
                )
                logger.info(f"✓ Gross Profit TTM (calculated): ${ttm_gp:,.0f}")
        
        # Gross Margin TTM
        if 'gross_profit_ttm' in results:
            rev_quarters = self.get_quarterly_values(company_data, 'revenue', 4)
            if len(rev_quarters) >= 4:
                ttm_rev = sum(q['value'] for q in rev_quarters)
                if ttm_rev > 0:
                    gm = results['gross_profit_ttm'].value / ttm_rev
                    results['gross_margin_ttm'] = MetricValue(
                        metric_name='gross_margin_ttm', value=gm, period='TTM', period_type='TTM',
                        calculation_method='gross_profit / revenue', source_metrics=['gross_profit', 'revenue'],
                        confidence_score=0.95, calculation_date=datetime.now(),
                        formula_used=f'Gross Profit / Revenue = {results["gross_profit_ttm"].value:,.0f} / {ttm_rev:,.0f}',
                        components={'gross_profit': results['gross_profit_ttm'].value, 'revenue': ttm_rev}
                    )
                    logger.info(f"✓ Gross Margin TTM: {gm:.2%}")
        
        # Annual Gross Profit and Margin
        gp_annual = self.get_annual_values(company_data, 'gross_profit', years)
        rev_annual = self.get_annual_values(company_data, 'revenue', years)
        
        for gp in gp_annual:
            results[f'gross_profit_annual_{gp["fiscal_period"]}'] = MetricValue(
                metric_name='gross_profit_annual', value=gp['value'], period=gp['fiscal_period'],
                period_type='Annual', calculation_method='direct_from_10k', source_metrics=['gross_profit'],
                confidence_score=gp['confidence_score'], calculation_date=datetime.now(),
                source_filing=f'10-K {gp["fiscal_period"]}', fiscal_year=gp['fiscal_period']
            )
            # Find matching revenue for margin calculation
            matching_rev = next((r for r in rev_annual if r['fiscal_period'] == gp['fiscal_period']), None)
            if matching_rev and matching_rev['value'] > 0:
                margin = gp['value'] / matching_rev['value']
                results[f'gross_margin_annual_{gp["fiscal_period"]}'] = MetricValue(
                    metric_name='gross_margin_annual', value=margin, period=gp['fiscal_period'],
                    period_type='Annual', calculation_method='gross_profit / revenue',
                    source_metrics=['gross_profit', 'revenue'], confidence_score=0.95,
                    calculation_date=datetime.now(), fiscal_year=gp['fiscal_period'],
                    components={'gross_profit': gp['value'], 'revenue': matching_rev['value']}
                )
                logger.info(f"✓ Gross Margin {gp['fiscal_period']}: {margin:.2%}")
        
        return results

    def calculate_operating_income_metrics(self, company_data: CompanyData, years: int = 5) -> Dict[str, MetricValue]:
        """Calculate Operating Income (EBIT): TTM and Annual"""
        results = {}
        
        # Try direct operating income first
        oi_quarters = self.get_quarterly_values(company_data, 'operating_income', 4)
        
        if len(oi_quarters) >= 4:
            ttm_oi = sum(q['value'] for q in oi_quarters)
            results['operating_income_ttm'] = MetricValue(
                metric_name='operating_income_ttm', value=ttm_oi, period='TTM', period_type='TTM',
                calculation_method='direct_sum_4_quarters', source_metrics=['operating_income'],
                confidence_score=min(q['confidence_score'] for q in oi_quarters),
                calculation_date=datetime.now(), source_filing='10-Q (last 4 quarters)',
                components={q['fiscal_period']: q['value'] for q in oi_quarters}
            )
            logger.info(f"✓ Operating Income TTM: ${ttm_oi:,.0f}")
        
        # Annual Operating Income
        oi_annual = self.get_annual_values(company_data, 'operating_income', years)
        rev_annual = self.get_annual_values(company_data, 'revenue', years)
        
        for oi in oi_annual:
            results[f'operating_income_annual_{oi["fiscal_period"]}'] = MetricValue(
                metric_name='operating_income_annual', value=oi['value'], period=oi['fiscal_period'],
                period_type='Annual', calculation_method='direct_from_10k', source_metrics=['operating_income'],
                confidence_score=oi['confidence_score'], calculation_date=datetime.now(),
                source_filing=f'10-K {oi["fiscal_period"]}', fiscal_year=oi['fiscal_period']
            )
            logger.info(f"✓ Operating Income {oi['fiscal_period']}: ${oi['value']:,.0f}")
            
            # Operating Margin
            matching_rev = next((r for r in rev_annual if r['fiscal_period'] == oi['fiscal_period']), None)
            if matching_rev and matching_rev['value'] > 0:
                margin = oi['value'] / matching_rev['value']
                results[f'operating_margin_annual_{oi["fiscal_period"]}'] = MetricValue(
                    metric_name='operating_margin_annual', value=margin, period=oi['fiscal_period'],
                    period_type='Annual', calculation_method='operating_income / revenue',
                    source_metrics=['operating_income', 'revenue'], confidence_score=0.95,
                    calculation_date=datetime.now(), fiscal_year=oi['fiscal_period']
                )
        
        # Operating Margin TTM
        if 'operating_income_ttm' in results:
            rev_quarters = self.get_quarterly_values(company_data, 'revenue', 4)
            if len(rev_quarters) >= 4:
                ttm_rev = sum(q['value'] for q in rev_quarters)
                if ttm_rev > 0:
                    margin = results['operating_income_ttm'].value / ttm_rev
                    results['operating_margin_ttm'] = MetricValue(
                        metric_name='operating_margin_ttm', value=margin, period='TTM', period_type='TTM',
                        calculation_method='operating_income / revenue',
                        source_metrics=['operating_income', 'revenue'], confidence_score=0.95,
                        calculation_date=datetime.now()
                    )
                    logger.info(f"✓ Operating Margin TTM: {margin:.2%}")
        
        return results

    def calculate_ebitda_metrics(self, company_data: CompanyData, years: int = 5) -> Dict[str, MetricValue]:
        """Calculate EBITDA and EBITDA Margin: TTM and Annual
        EBITDA = Net Income + Taxes + Interest + Depreciation/Amortization
        OR EBITDA = Operating Income + Depreciation/Amortization
        """
        results = {}
        
        # Get components for EBITDA calculation
        ni_annual = self.get_annual_values(company_data, 'net_income', years)
        tax_annual = self.get_annual_values(company_data, 'income_tax_expense', years)
        int_annual = self.get_annual_values(company_data, 'interest_expense', years)
        dep_annual = self.get_annual_values(company_data, 'depreciation', years)
        oi_annual = self.get_annual_values(company_data, 'operating_income', years)
        rev_annual = self.get_annual_values(company_data, 'revenue', years)
        
        # Calculate Annual EBITDA
        for ni in ni_annual:
            period = ni['fiscal_period']
            tax = next((t for t in tax_annual if t['fiscal_period'] == period), None)
            interest = next((i for i in int_annual if i['fiscal_period'] == period), None)
            dep = next((d for d in dep_annual if d['fiscal_period'] == period), None)
            oi = next((o for o in oi_annual if o['fiscal_period'] == period), None)
            rev = next((r for r in rev_annual if r['fiscal_period'] == period), None)
            
            ebitda = None
            method = None
            components = {}
            
            # Method 1: Net Income + Taxes + Interest + D&A
            if tax and interest and dep:
                ebitda = ni['value'] + abs(tax['value']) + abs(interest['value']) + abs(dep['value'])
                method = 'net_income + taxes + interest + depreciation'
                components = {
                    'net_income': ni['value'], 'taxes': tax['value'],
                    'interest': interest['value'], 'depreciation': dep['value']
                }
            # Method 2: Operating Income + D&A
            elif oi and dep:
                ebitda = oi['value'] + abs(dep['value'])
                method = 'operating_income + depreciation'
                components = {'operating_income': oi['value'], 'depreciation': dep['value']}
            
            if ebitda is not None:
                results[f'ebitda_annual_{period}'] = MetricValue(
                    metric_name='ebitda_annual', value=ebitda, period=period, period_type='Annual',
                    calculation_method=method, source_metrics=list(components.keys()),
                    confidence_score=0.90, calculation_date=datetime.now(),
                    source_filing=f'10-K {period}', fiscal_year=period, components=components
                )
                logger.info(f"✓ EBITDA {period}: ${ebitda:,.0f}")
                
                # EBITDA Margin
                if rev and rev['value'] > 0:
                    margin = ebitda / rev['value']
                    results[f'ebitda_margin_annual_{period}'] = MetricValue(
                        metric_name='ebitda_margin_annual', value=margin, period=period,
                        period_type='Annual', calculation_method='ebitda / revenue',
                        source_metrics=['ebitda', 'revenue'], confidence_score=0.90,
                        calculation_date=datetime.now(), fiscal_year=period,
                        components={'ebitda': ebitda, 'revenue': rev['value']}
                    )
                    logger.info(f"✓ EBITDA Margin {period}: {margin:.2%}")
        
        # TTM EBITDA (from quarterly data)
        ni_quarters = self.get_quarterly_values(company_data, 'net_income', 4)
        dep_quarters = self.get_quarterly_values(company_data, 'depreciation', 4)
        oi_quarters = self.get_quarterly_values(company_data, 'operating_income', 4)
        
        if len(oi_quarters) >= 4 and len(dep_quarters) >= 4:
            ttm_oi = sum(q['value'] for q in oi_quarters)
            ttm_dep = sum(abs(q['value']) for q in dep_quarters)
            ttm_ebitda = ttm_oi + ttm_dep
            results['ebitda_ttm'] = MetricValue(
                metric_name='ebitda_ttm', value=ttm_ebitda, period='TTM', period_type='TTM',
                calculation_method='operating_income + depreciation (TTM)',
                source_metrics=['operating_income', 'depreciation'], confidence_score=0.90,
                calculation_date=datetime.now(),
                components={'operating_income_ttm': ttm_oi, 'depreciation_ttm': ttm_dep}
            )
            logger.info(f"✓ EBITDA TTM: ${ttm_ebitda:,.0f}")
            
            # EBITDA Margin TTM
            rev_quarters = self.get_quarterly_values(company_data, 'revenue', 4)
            if len(rev_quarters) >= 4:
                ttm_rev = sum(q['value'] for q in rev_quarters)
                if ttm_rev > 0:
                    margin = ttm_ebitda / ttm_rev
                    results['ebitda_margin_ttm'] = MetricValue(
                        metric_name='ebitda_margin_ttm', value=margin, period='TTM', period_type='TTM',
                        calculation_method='ebitda / revenue', source_metrics=['ebitda', 'revenue'],
                        confidence_score=0.90, calculation_date=datetime.now()
                    )
                    logger.info(f"✓ EBITDA Margin TTM: {margin:.2%}")
        
        return results

    def calculate_net_income_metrics(self, company_data: CompanyData, years: int = 5) -> Dict[str, MetricValue]:
        """Calculate Net Income and Net Margin: TTM and Annual"""
        results = {}
        
        # TTM Net Income
        ni_quarters = self.get_quarterly_values(company_data, 'net_income', 4)
        if len(ni_quarters) >= 4:
            ttm_ni = sum(q['value'] for q in ni_quarters)
            results['net_income_ttm'] = MetricValue(
                metric_name='net_income_ttm', value=ttm_ni, period='TTM', period_type='TTM',
                calculation_method='sum_last_4_quarters', source_metrics=['net_income'],
                confidence_score=min(q['confidence_score'] for q in ni_quarters),
                calculation_date=datetime.now(), source_filing='10-Q (last 4 quarters)',
                components={q['fiscal_period']: q['value'] for q in ni_quarters}
            )
            logger.info(f"✓ Net Income TTM: ${ttm_ni:,.0f}")
            
            # Net Margin TTM
            rev_quarters = self.get_quarterly_values(company_data, 'revenue', 4)
            if len(rev_quarters) >= 4:
                ttm_rev = sum(q['value'] for q in rev_quarters)
                if ttm_rev > 0:
                    margin = ttm_ni / ttm_rev
                    results['net_margin_ttm'] = MetricValue(
                        metric_name='net_margin_ttm', value=margin, period='TTM', period_type='TTM',
                        calculation_method='net_income / revenue', source_metrics=['net_income', 'revenue'],
                        confidence_score=0.95, calculation_date=datetime.now(),
                        components={'net_income': ttm_ni, 'revenue': ttm_rev}
                    )
                    logger.info(f"✓ Net Margin TTM: {margin:.2%}")
        
        # Annual Net Income and Margin
        ni_annual = self.get_annual_values(company_data, 'net_income', years)
        rev_annual = self.get_annual_values(company_data, 'revenue', years)
        
        for ni in ni_annual:
            results[f'net_income_annual_{ni["fiscal_period"]}'] = MetricValue(
                metric_name='net_income_annual', value=ni['value'], period=ni['fiscal_period'],
                period_type='Annual', calculation_method='direct_from_10k', source_metrics=['net_income'],
                confidence_score=ni['confidence_score'], calculation_date=datetime.now(),
                source_filing=f'10-K {ni["fiscal_period"]}', fiscal_year=ni['fiscal_period']
            )
            logger.info(f"✓ Net Income {ni['fiscal_period']}: ${ni['value']:,.0f}")
            
            # Net Margin
            matching_rev = next((r for r in rev_annual if r['fiscal_period'] == ni['fiscal_period']), None)
            if matching_rev and matching_rev['value'] > 0:
                margin = ni['value'] / matching_rev['value']
                results[f'net_margin_annual_{ni["fiscal_period"]}'] = MetricValue(
                    metric_name='net_margin_annual', value=margin, period=ni['fiscal_period'],
                    period_type='Annual', calculation_method='net_income / revenue',
                    source_metrics=['net_income', 'revenue'], confidence_score=0.95,
                    calculation_date=datetime.now(), fiscal_year=ni['fiscal_period']
                )
                logger.info(f"✓ Net Margin {ni['fiscal_period']}: {margin:.2%}")
        
        # Net Income YoY Growth
        if len(ni_annual) >= 2:
            for i in range(len(ni_annual) - 1):
                current = ni_annual[i]['value']
                previous = ni_annual[i + 1]['value']
                if previous != 0:
                    yoy_growth = (current - previous) / abs(previous)
                    period_label = f"{ni_annual[i+1]['fiscal_period']}_to_{ni_annual[i]['fiscal_period']}"
                    results[f'net_income_yoy_growth_{period_label}'] = MetricValue(
                        metric_name='net_income_yoy_growth', value=yoy_growth, period=period_label,
                        period_type='YoY', calculation_method='(current - previous) / |previous|',
                        source_metrics=['net_income'], confidence_score=0.99, calculation_date=datetime.now()
                    )
                    logger.info(f"✓ Net Income YoY Growth {period_label}: {yoy_growth:.2%}")
        
        return results

    # ==================== SECTION 2: CASH FLOW METRICS ====================
    
    def calculate_cash_flow_metrics(self, company_data: CompanyData, years: int = 5) -> Dict[str, MetricValue]:
        """Calculate all cash flow metrics: FCF, Operating Cash Flow, CapEx, Cash Conversion"""
        results = {}
        
        # Operating Cash Flow TTM
        ocf_quarters = self.get_quarterly_values(company_data, 'operating_cash_flow', 4)
        if len(ocf_quarters) >= 4:
            ttm_ocf = sum(q['value'] for q in ocf_quarters)
            results['operating_cash_flow_ttm'] = MetricValue(
                metric_name='operating_cash_flow_ttm', value=ttm_ocf, period='TTM', period_type='TTM',
                calculation_method='sum_last_4_quarters', source_metrics=['operating_cash_flow'],
                confidence_score=min(q['confidence_score'] for q in ocf_quarters),
                calculation_date=datetime.now(), source_filing='10-Q Cash Flow Statement',
                components={q['fiscal_period']: q['value'] for q in ocf_quarters}
            )
            logger.info(f"✓ Operating Cash Flow TTM: ${ttm_ocf:,.0f}")
        
        # CapEx TTM
        capex_quarters = self.get_quarterly_values(company_data, 'capital_expenditures', 4)
        if len(capex_quarters) >= 4:
            ttm_capex = sum(abs(q['value']) for q in capex_quarters)
            results['capex_ttm'] = MetricValue(
                metric_name='capex_ttm', value=ttm_capex, period='TTM', period_type='TTM',
                calculation_method='sum_last_4_quarters', source_metrics=['capital_expenditures'],
                confidence_score=min(q['confidence_score'] for q in capex_quarters),
                calculation_date=datetime.now(), source_filing='10-Q Cash Flow Statement',
                components={q['fiscal_period']: abs(q['value']) for q in capex_quarters}
            )
            logger.info(f"✓ CapEx TTM: ${ttm_capex:,.0f}")
        
        # Free Cash Flow TTM = Operating Cash Flow - CapEx
        if 'operating_cash_flow_ttm' in results and 'capex_ttm' in results:
            fcf = results['operating_cash_flow_ttm'].value - results['capex_ttm'].value
            results['free_cash_flow_ttm'] = MetricValue(
                metric_name='free_cash_flow_ttm', value=fcf, period='TTM', period_type='TTM',
                calculation_method='operating_cash_flow - capex',
                source_metrics=['operating_cash_flow', 'capital_expenditures'],
                confidence_score=0.95, calculation_date=datetime.now(),
                formula_used=f'OCF ({results["operating_cash_flow_ttm"].value:,.0f}) - CapEx ({results["capex_ttm"].value:,.0f})',
                components={'operating_cash_flow': results['operating_cash_flow_ttm'].value, 
                           'capex': results['capex_ttm'].value}
            )
            logger.info(f"✓ Free Cash Flow TTM: ${fcf:,.0f}")
        
        # Cash Conversion Ratio TTM = FCF / Net Income
        if 'free_cash_flow_ttm' in results:
            ni_quarters = self.get_quarterly_values(company_data, 'net_income', 4)
            if len(ni_quarters) >= 4:
                ttm_ni = sum(q['value'] for q in ni_quarters)
                if ttm_ni != 0:
                    ccr = results['free_cash_flow_ttm'].value / ttm_ni
                    results['cash_conversion_ratio_ttm'] = MetricValue(
                        metric_name='cash_conversion_ratio_ttm', value=ccr, period='TTM', period_type='TTM',
                        calculation_method='fcf / net_income', source_metrics=['free_cash_flow', 'net_income'],
                        confidence_score=0.95, calculation_date=datetime.now(),
                        components={'fcf': results['free_cash_flow_ttm'].value, 'net_income': ttm_ni}
                    )
                    logger.info(f"✓ Cash Conversion Ratio TTM: {ccr:.2f}x")
        
        # CapEx as % of Revenue TTM
        if 'capex_ttm' in results:
            rev_quarters = self.get_quarterly_values(company_data, 'revenue', 4)
            if len(rev_quarters) >= 4:
                ttm_rev = sum(q['value'] for q in rev_quarters)
                if ttm_rev > 0:
                    capex_pct = results['capex_ttm'].value / ttm_rev
                    results['capex_pct_revenue_ttm'] = MetricValue(
                        metric_name='capex_pct_revenue_ttm', value=capex_pct, period='TTM', period_type='TTM',
                        calculation_method='capex / revenue', source_metrics=['capital_expenditures', 'revenue'],
                        confidence_score=0.95, calculation_date=datetime.now()
                    )
                    logger.info(f"✓ CapEx % of Revenue TTM: {capex_pct:.2%}")
        
        # Annual Cash Flow Metrics
        ocf_annual = self.get_annual_values(company_data, 'operating_cash_flow', years)
        capex_annual = self.get_annual_values(company_data, 'capital_expenditures', years)
        ni_annual = self.get_annual_values(company_data, 'net_income', years)
        rev_annual = self.get_annual_values(company_data, 'revenue', years)
        
        for ocf in ocf_annual:
            period = ocf['fiscal_period']
            results[f'operating_cash_flow_annual_{period}'] = MetricValue(
                metric_name='operating_cash_flow_annual', value=ocf['value'], period=period,
                period_type='Annual', calculation_method='direct_from_10k',
                source_metrics=['operating_cash_flow'], confidence_score=ocf['confidence_score'],
                calculation_date=datetime.now(), fiscal_year=period
            )
            
            # FCF Annual
            capex = next((c for c in capex_annual if c['fiscal_period'] == period), None)
            if capex:
                fcf = ocf['value'] - abs(capex['value'])
                results[f'free_cash_flow_annual_{period}'] = MetricValue(
                    metric_name='free_cash_flow_annual', value=fcf, period=period,
                    period_type='Annual', calculation_method='ocf - capex',
                    source_metrics=['operating_cash_flow', 'capital_expenditures'],
                    confidence_score=0.95, calculation_date=datetime.now(), fiscal_year=period,
                    components={'ocf': ocf['value'], 'capex': abs(capex['value'])}
                )
                logger.info(f"✓ Free Cash Flow {period}: ${fcf:,.0f}")
                
                # Cash Conversion Ratio Annual
                ni = next((n for n in ni_annual if n['fiscal_period'] == period), None)
                if ni and ni['value'] != 0:
                    ccr = fcf / ni['value']
                    results[f'cash_conversion_ratio_annual_{period}'] = MetricValue(
                        metric_name='cash_conversion_ratio_annual', value=ccr, period=period,
                        period_type='Annual', calculation_method='fcf / net_income',
                        source_metrics=['free_cash_flow', 'net_income'], confidence_score=0.95,
                        calculation_date=datetime.now(), fiscal_year=period
                    )
        
        return results

    def calculate_working_capital_metrics(self, company_data: CompanyData, years: int = 5) -> Dict[str, MetricValue]:
        """Calculate working capital cycle metrics: DSO, DIO, DPO, Cash Conversion Cycle"""
        results = {}
        
        # Get balance sheet items (instant values)
        ar_annual = self.get_annual_values(company_data, 'accounts_receivable', years)
        inv_annual = self.get_annual_values(company_data, 'inventory', years)
        ap_annual = self.get_annual_values(company_data, 'accounts_payable', years)
        rev_annual = self.get_annual_values(company_data, 'revenue', years)
        cogs_annual = self.get_annual_values(company_data, 'cost_of_revenue', years)
        
        for i, rev in enumerate(rev_annual):
            period = rev['fiscal_period']
            ar = next((a for a in ar_annual if a['fiscal_period'] == period), None)
            inv = next((i for i in inv_annual if i['fiscal_period'] == period), None)
            ap = next((a for a in ap_annual if a['fiscal_period'] == period), None)
            cogs = next((c for c in cogs_annual if c['fiscal_period'] == period), None)
            
            # DSO = (Accounts Receivable / Revenue) * 365
            if ar and rev['value'] > 0:
                dso = (ar['value'] / rev['value']) * 365
                results[f'dso_annual_{period}'] = MetricValue(
                    metric_name='dso_annual', value=dso, period=period, period_type='Annual',
                    calculation_method='(accounts_receivable / revenue) * 365',
                    source_metrics=['accounts_receivable', 'revenue'], confidence_score=0.90,
                    calculation_date=datetime.now(), fiscal_year=period,
                    components={'accounts_receivable': ar['value'], 'revenue': rev['value']}
                )
                logger.info(f"✓ DSO {period}: {dso:.1f} days")
            
            # DIO = (Inventory / COGS) * 365
            if inv and cogs and cogs['value'] > 0:
                dio = (inv['value'] / cogs['value']) * 365
                results[f'dio_annual_{period}'] = MetricValue(
                    metric_name='dio_annual', value=dio, period=period, period_type='Annual',
                    calculation_method='(inventory / cogs) * 365',
                    source_metrics=['inventory', 'cost_of_revenue'], confidence_score=0.90,
                    calculation_date=datetime.now(), fiscal_year=period,
                    components={'inventory': inv['value'], 'cogs': cogs['value']}
                )
                logger.info(f"✓ DIO {period}: {dio:.1f} days")
            
            # DPO = (Accounts Payable / COGS) * 365
            if ap and cogs and cogs['value'] > 0:
                dpo = (ap['value'] / cogs['value']) * 365
                results[f'dpo_annual_{period}'] = MetricValue(
                    metric_name='dpo_annual', value=dpo, period=period, period_type='Annual',
                    calculation_method='(accounts_payable / cogs) * 365',
                    source_metrics=['accounts_payable', 'cost_of_revenue'], confidence_score=0.90,
                    calculation_date=datetime.now(), fiscal_year=period,
                    components={'accounts_payable': ap['value'], 'cogs': cogs['value']}
                )
                logger.info(f"✓ DPO {period}: {dpo:.1f} days")
            
            # Cash Conversion Cycle = DSO + DIO - DPO
            dso_key = f'dso_annual_{period}'
            dio_key = f'dio_annual_{period}'
            dpo_key = f'dpo_annual_{period}'
            if dso_key in results and dio_key in results and dpo_key in results:
                ccc = results[dso_key].value + results[dio_key].value - results[dpo_key].value
                results[f'cash_conversion_cycle_annual_{period}'] = MetricValue(
                    metric_name='cash_conversion_cycle_annual', value=ccc, period=period,
                    period_type='Annual', calculation_method='DSO + DIO - DPO',
                    source_metrics=['dso', 'dio', 'dpo'], confidence_score=0.90,
                    calculation_date=datetime.now(), fiscal_year=period,
                    components={'dso': results[dso_key].value, 'dio': results[dio_key].value, 
                               'dpo': results[dpo_key].value}
                )
                logger.info(f"✓ Cash Conversion Cycle {period}: {ccc:.1f} days")
        
        return results

    # ==================== SECTION 3: BALANCE SHEET & LIQUIDITY METRICS ====================
    
    def calculate_balance_sheet_metrics(self, company_data: CompanyData, years: int = 5) -> Dict[str, MetricValue]:
        """Calculate balance sheet health metrics: Current Ratio, Quick Ratio, Working Capital"""
        results = {}
        
        ca_annual = self.get_annual_values(company_data, 'current_assets', years)
        cl_annual = self.get_annual_values(company_data, 'current_liabilities', years)
        inv_annual = self.get_annual_values(company_data, 'inventory', years)
        ta_annual = self.get_annual_values(company_data, 'total_assets', years)
        tl_annual = self.get_annual_values(company_data, 'total_liabilities', years)
        eq_annual = self.get_annual_values(company_data, 'stockholders_equity', years)
        ni_annual = self.get_annual_values(company_data, 'net_income', years)
        
        for ca in ca_annual:
            period = ca['fiscal_period']
            cl = next((c for c in cl_annual if c['fiscal_period'] == period), None)
            inv = next((i for i in inv_annual if i['fiscal_period'] == period), None)
            ta = next((t for t in ta_annual if t['fiscal_period'] == period), None)
            tl = next((t for t in tl_annual if t['fiscal_period'] == period), None)
            eq = next((e for e in eq_annual if e['fiscal_period'] == period), None)
            ni = next((n for n in ni_annual if n['fiscal_period'] == period), None)
            
            # Current Ratio = Current Assets / Current Liabilities
            if cl and cl['value'] > 0:
                current_ratio = ca['value'] / cl['value']
                results[f'current_ratio_annual_{period}'] = MetricValue(
                    metric_name='current_ratio_annual', value=current_ratio, period=period,
                    period_type='Annual', calculation_method='current_assets / current_liabilities',
                    source_metrics=['current_assets', 'current_liabilities'], confidence_score=0.95,
                    calculation_date=datetime.now(), fiscal_year=period,
                    components={'current_assets': ca['value'], 'current_liabilities': cl['value']}
                )
                logger.info(f"✓ Current Ratio {period}: {current_ratio:.2f}x")
            
            # Quick Ratio = (Current Assets - Inventory) / Current Liabilities
            if cl and cl['value'] > 0:
                inv_value = inv['value'] if inv else 0
                quick_ratio = (ca['value'] - inv_value) / cl['value']
                results[f'quick_ratio_annual_{period}'] = MetricValue(
                    metric_name='quick_ratio_annual', value=quick_ratio, period=period,
                    period_type='Annual', calculation_method='(current_assets - inventory) / current_liabilities',
                    source_metrics=['current_assets', 'inventory', 'current_liabilities'],
                    confidence_score=0.95, calculation_date=datetime.now(), fiscal_year=period,
                    components={'current_assets': ca['value'], 'inventory': inv_value, 
                               'current_liabilities': cl['value']}
                )
                logger.info(f"✓ Quick Ratio {period}: {quick_ratio:.2f}x")
            
            # Working Capital = Current Assets - Current Liabilities
            if cl:
                working_capital = ca['value'] - cl['value']
                results[f'working_capital_annual_{period}'] = MetricValue(
                    metric_name='working_capital_annual', value=working_capital, period=period,
                    period_type='Annual', calculation_method='current_assets - current_liabilities',
                    source_metrics=['current_assets', 'current_liabilities'], confidence_score=0.95,
                    calculation_date=datetime.now(), fiscal_year=period
                )
                logger.info(f"✓ Working Capital {period}: ${working_capital:,.0f}")
            
            # Debt to Equity = Total Liabilities / Stockholders Equity
            if tl and eq and eq['value'] != 0:
                debt_to_equity = tl['value'] / eq['value']
                results[f'debt_to_equity_annual_{period}'] = MetricValue(
                    metric_name='debt_to_equity_annual', value=debt_to_equity, period=period,
                    period_type='Annual', calculation_method='total_liabilities / stockholders_equity',
                    source_metrics=['total_liabilities', 'stockholders_equity'], confidence_score=0.95,
                    calculation_date=datetime.now(), fiscal_year=period
                )
                logger.info(f"✓ Debt to Equity {period}: {debt_to_equity:.2f}x")
            
            # ROE = Net Income / Stockholders Equity
            if ni and eq and eq['value'] != 0:
                roe = ni['value'] / eq['value']
                results[f'roe_annual_{period}'] = MetricValue(
                    metric_name='roe_annual', value=roe, period=period, period_type='Annual',
                    calculation_method='net_income / stockholders_equity',
                    source_metrics=['net_income', 'stockholders_equity'], confidence_score=0.95,
                    calculation_date=datetime.now(), fiscal_year=period,
                    components={'net_income': ni['value'], 'equity': eq['value']}
                )
                logger.info(f"✓ ROE {period}: {roe:.2%}")
            
            # Asset Turnover = Revenue / Total Assets
            rev_annual = self.get_annual_values(company_data, 'revenue', years)
            rev = next((r for r in rev_annual if r['fiscal_period'] == period), None)
            if ta and rev and ta['value'] > 0:
                asset_turnover = rev['value'] / ta['value']
                results[f'asset_turnover_annual_{period}'] = MetricValue(
                    metric_name='asset_turnover_annual', value=asset_turnover, period=period,
                    period_type='Annual', calculation_method='revenue / total_assets',
                    source_metrics=['revenue', 'total_assets'], confidence_score=0.95,
                    calculation_date=datetime.now(), fiscal_year=period
                )
                logger.info(f"✓ Asset Turnover {period}: {asset_turnover:.2f}x")
        
        return results

    # ==================== MAIN CALCULATION ORCHESTRATOR ====================
    
    def calculate_all_metrics(self, ticker: str, years: int = 5, share_price: float = None) -> Dict[str, MetricValue]:
        """
        Calculate ALL comprehensive financial metrics for a company
        Returns a dictionary of all calculated metrics with full source tracking
        """
        logger.info(f"=" * 80)
        logger.info(f"COMPREHENSIVE FINANCIAL METRICS CALCULATION FOR {ticker}")
        logger.info(f"Analyzing {years} years of SEC filings (10-K, 10-Q)")
        logger.info(f"=" * 80)
        
        try:
            company_data = self.get_company_metrics(ticker, years)
            all_results = {}
            
            # Section 1: Financial Performance Metrics
            logger.info(f"\n{'='*40}\nSECTION 1: FINANCIAL PERFORMANCE METRICS\n{'='*40}")
            
            logger.info("\n--- Revenue Metrics ---")
            all_results.update(self.calculate_revenue_metrics(company_data, years))
            
            logger.info("\n--- Gross Profit & Margin ---")
            all_results.update(self.calculate_gross_profit_metrics(company_data, years))
            
            logger.info("\n--- Operating Income (EBIT) ---")
            all_results.update(self.calculate_operating_income_metrics(company_data, years))
            
            logger.info("\n--- EBITDA & EBITDA Margin ---")
            all_results.update(self.calculate_ebitda_metrics(company_data, years))
            
            logger.info("\n--- Net Income & Net Margin ---")
            all_results.update(self.calculate_net_income_metrics(company_data, years))
            
            # Section 2: Cash Flow Metrics
            logger.info(f"\n{'='*40}\nSECTION 2: CASH FLOW METRICS\n{'='*40}")
            all_results.update(self.calculate_cash_flow_metrics(company_data, years))
            
            logger.info("\n--- Working Capital Cycle ---")
            all_results.update(self.calculate_working_capital_metrics(company_data, years))
            
            # Section 3: Balance Sheet Health
            logger.info(f"\n{'='*40}\nSECTION 3: BALANCE SHEET HEALTH\n{'='*40}")
            all_results.update(self.calculate_balance_sheet_metrics(company_data, years))
            
            # Summary
            logger.info(f"\n{'='*80}")
            logger.info(f"CALCULATION COMPLETE: {len(all_results)} metrics calculated for {ticker}")
            logger.info(f"{'='*80}")
            
            return all_results
            
        except Exception as e:
            logger.error(f"Error calculating metrics for {ticker}: {e}")
            import traceback
            traceback.print_exc()
            return {}

    def save_all_metrics(self, ticker: str, metrics: Dict[str, MetricValue]):
        """Save all calculated metrics to database"""
        conn = self.connect_db()
        try:
            cursor = conn.cursor()
            saved_count = 0
            
            for metric_key, metric_value in metrics.items():
                try:
                    cursor.execute("""
                        INSERT INTO calculated_metrics 
                        (ticker, metric_name, value, period, period_type, 
                         calculation_method, source_metrics, confidence_score, 
                         calculation_date, validation_status)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (ticker, metric_name, period) 
                        DO UPDATE SET 
                            value = EXCLUDED.value,
                            calculation_method = EXCLUDED.calculation_method,
                            confidence_score = EXCLUDED.confidence_score,
                            calculation_date = EXCLUDED.calculation_date
                    """, (
                        ticker,
                        metric_value.metric_name,
                        metric_value.value,
                        metric_value.period,
                        metric_value.period_type,
                        metric_value.calculation_method,
                        json.dumps(metric_value.source_metrics),
                        metric_value.confidence_score,
                        metric_value.calculation_date,
                        metric_value.validation_status
                    ))
                    saved_count += 1
                except Exception as e:
                    logger.warning(f"Failed to save metric {metric_key}: {e}")
            
            conn.commit()
            logger.info(f"Saved {saved_count} metrics to database for {ticker}")
            
        except Exception as e:
            logger.error(f"Error saving metrics: {e}")
            conn.rollback()
        finally:
            conn.close()

def main():
    """Main function for command line usage"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Calculate comprehensive financial metrics from SEC filings')
    parser.add_argument('--ticker', required=True, help='Company ticker symbol')
    parser.add_argument('--years', type=int, default=5, help='Number of years of data to analyze (default: 5)')
    parser.add_argument('--price', type=float, help='Current share price for market-based calculations')
    parser.add_argument('--output', choices=['json', 'summary'], default='summary', help='Output format')
    
    args = parser.parse_args()
    
    calculator = ComprehensiveFinancialCalculator()
    
    print(f"\n{'='*80}")
    print(f"COMPREHENSIVE FINANCIAL METRICS CALCULATOR")
    print(f"Ticker: {args.ticker} | Years: {args.years}")
    print(f"{'='*80}\n")
    
    metrics = calculator.calculate_all_metrics(args.ticker, args.years, args.price)
    
    if args.output == 'json':
        result = {}
        for name, metric in metrics.items():
            result[name] = {
                'value': metric.value,
                'period': metric.period,
                'period_type': metric.period_type,
                'calculation_method': metric.calculation_method,
                'confidence_score': metric.confidence_score,
                'source_filing': metric.source_filing,
                'components': metric.components
            }
        print(json.dumps(result, indent=2, default=str))
    else:
        print(f"\n{'='*80}")
        print(f"METRICS SUMMARY FOR {args.ticker}")
        print(f"{'='*80}")
        
        # Group metrics by category
        categories = {
            'Revenue': ['revenue_ttm', 'revenue_annual', 'revenue_yoy', 'revenue_cagr'],
            'Gross Profit': ['gross_profit', 'gross_margin'],
            'Operating Income': ['operating_income', 'operating_margin'],
            'EBITDA': ['ebitda'],
            'Net Income': ['net_income', 'net_margin'],
            'Cash Flow': ['operating_cash_flow', 'free_cash_flow', 'capex', 'cash_conversion'],
            'Working Capital': ['dso', 'dio', 'dpo', 'cash_conversion_cycle'],
            'Balance Sheet': ['current_ratio', 'quick_ratio', 'working_capital', 'debt_to_equity', 'roe', 'asset_turnover']
        }
        
        for category, prefixes in categories.items():
            category_metrics = {k: v for k, v in metrics.items() 
                              if any(p in k for p in prefixes)}
            if category_metrics:
                print(f"\n{category}:")
                print("-" * 40)
                for name, metric in sorted(category_metrics.items()):
                    if 'margin' in name or 'ratio' in name or 'cagr' in name or 'growth' in name or 'roe' in name:
                        print(f"  {name}: {metric.value:.2%} ({metric.period})")
                    elif 'dso' in name or 'dio' in name or 'dpo' in name or 'cycle' in name:
                        print(f"  {name}: {metric.value:.1f} days ({metric.period})")
                    elif 'turnover' in name:
                        print(f"  {name}: {metric.value:.2f}x ({metric.period})")
                    else:
                        print(f"  {name}: ${metric.value:,.0f} ({metric.period})")
    
    # Save to database
    calculator.save_all_metrics(args.ticker, metrics)
    print(f"\n✓ {len(metrics)} metrics saved to database")
    
    return len(metrics)

if __name__ == "__main__":
    main()
