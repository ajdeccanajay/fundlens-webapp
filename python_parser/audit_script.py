"""
Parsing Audit Script - Audits parsing completeness for SEC filings

This module provides tools to:
1. Compare extracted metrics against original SEC filing content
2. Identify gaps in extraction (missing line items)
3. Track unmapped XBRL tags
4. Generate completeness reports per statement type
5. Produce recommendations for improving extraction coverage

Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
"""

import logging
import json
import re
from typing import Dict, List, Optional, Any, Set, Tuple
from dataclasses import dataclass, asdict, field
from datetime import datetime
from collections import defaultdict

logger = logging.getLogger(__name__)


@dataclass
class AuditReport:
    """Audit report for a single filing"""
    ticker: str
    filing_type: str
    fiscal_period: str
    audit_timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    
    # Extraction statistics
    total_available: int = 0
    total_extracted: int = 0
    completeness_pct: float = 0.0
    
    # Gap analysis
    missing_metrics: List[str] = field(default_factory=list)
    extra_metrics: List[str] = field(default_factory=list)  # Derived metrics
    unmapped_tags: List[str] = field(default_factory=list)
    
    # Per-statement breakdown
    income_statement_completeness: float = 0.0
    balance_sheet_completeness: float = 0.0
    cash_flow_completeness: float = 0.0
    
    # Details
    income_statement_missing: List[str] = field(default_factory=list)
    balance_sheet_missing: List[str] = field(default_factory=list)
    cash_flow_missing: List[str] = field(default_factory=list)
    
    # Source info
    extraction_source: str = 'ixbrl'  # 'ixbrl', 'html_table', 'mixed'
    parser_version: str = 'hybrid_v1.1'


@dataclass
class GapAnalysisReport:
    """Comprehensive gap analysis across multiple filings"""
    report_timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    
    # Summary statistics
    total_filings_audited: int = 0
    avg_completeness: float = 0.0
    min_completeness: float = 100.0
    max_completeness: float = 0.0
    
    # Aggregated gaps
    total_unmapped_tags: List[str] = field(default_factory=list)
    most_common_missing_metrics: List[Tuple[str, int]] = field(default_factory=list)
    
    # Per-ticker breakdown
    ticker_reports: Dict[str, List[AuditReport]] = field(default_factory=dict)
    
    # Recommendations
    recommendations: List[str] = field(default_factory=list)
    
    # Industry breakdown
    industry_completeness: Dict[str, float] = field(default_factory=dict)


class ParsingAuditScript:
    """
    Audits parsing completeness by comparing extracted metrics
    against original SEC filing content.
    
    Implements Requirements 10.1-10.5:
    - 10.1: Compare extracted metrics against original filing
    - 10.2: Identify line items in SEC filing but missing from database
    - 10.3: Identify unmapped XBRL tags
    - 10.4: Calculate completeness percentage per statement type
    - 10.5: Generate recommendations for missing mappings
    """
    
    # Expected metrics by statement type (core metrics that should always be present)
    EXPECTED_INCOME_STATEMENT_METRICS = {
        'revenue', 'total_revenue', 'cost_of_revenue', 'gross_profit',
        'operating_expenses', 'operating_income', 'income_before_taxes',
        'income_tax_expense', 'net_income', 'earnings_per_share_basic',
        'earnings_per_share_diluted', 'weighted_average_shares_basic',
        'weighted_average_shares_diluted'
    }
    
    EXPECTED_BALANCE_SHEET_METRICS = {
        'cash_and_equivalents', 'accounts_receivable', 'inventory',
        'current_assets', 'property_plant_equipment', 'goodwill',
        'intangible_assets', 'total_assets', 'accounts_payable',
        'current_liabilities', 'long_term_debt', 'total_liabilities',
        'shareholders_equity', 'liabilities_and_equity'
    }
    
    EXPECTED_CASH_FLOW_METRICS = {
        'net_income', 'depreciation_amortization', 'operating_cash_flow',
        'capital_expenditures', 'investing_cash_flow', 'dividends_paid',
        'financing_cash_flow', 'net_change_in_cash', 'cash_beginning',
        'cash_ending'
    }
    
    # Industry-specific expected metrics
    MEDIA_EXPECTED_METRICS = {
        'programming_and_production', 'marketing_and_promotion',
        'other_operating_and_administrative', 'depreciation', 'amortization'
    }
    
    BANK_EXPECTED_METRICS = {
        'net_interest_income', 'interest_income', 'interest_expense',
        'provision_credit_losses', 'noninterest_income', 'noninterest_expense',
        'total_loans', 'deposits', 'allowance_credit_losses'
    }
    
    INSURANCE_EXPECTED_METRICS = {
        'premiums_earned', 'net_investment_income', 'claims_losses',
        'policy_acquisition_costs', 'underwriting_income'
    }
    
    REIT_EXPECTED_METRICS = {
        'rental_revenue', 'funds_from_operations', 'adjusted_ffo',
        'net_operating_income', 'same_store_noi'
    }
    
    # Industry detection by ticker
    INDUSTRY_TICKERS = {
        'media': {'CMCSA', 'DIS', 'NFLX', 'WBD', 'PARA', 'FOX', 'FOXA'},
        'bank': {'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'USB', 'PNC', 'TFC', 'COF'},
        'insurance': {'BRK.A', 'BRK.B', 'MET', 'PRU', 'AIG', 'ALL', 'TRV', 'PGR'},
        'reit': {'AMT', 'PLD', 'CCI', 'EQIX', 'PSA', 'SPG', 'O', 'WELL', 'DLR'},
        'utility': {'NEE', 'DUK', 'SO', 'D', 'AEP', 'XEL', 'SRE', 'ED', 'EXC'},
        'telecom': {'T', 'VZ', 'TMUS'},
    }
    
    def __init__(self, db_connection=None, sec_api_client=None):
        """
        Initialize audit script.
        
        Args:
            db_connection: Database connection for querying extracted metrics
            sec_api_client: SEC API client for fetching original filings
        """
        self.db = db_connection
        self.sec_api = sec_api_client
        
    def detect_industry(self, ticker: str) -> Optional[str]:
        """Detect industry based on ticker symbol."""
        ticker_upper = ticker.upper()
        for industry, tickers in self.INDUSTRY_TICKERS.items():
            if ticker_upper in tickers:
                return industry
        return None
    
    def get_expected_metrics(self, ticker: str, statement_type: str) -> Set[str]:
        """Get expected metrics for a ticker and statement type."""
        base_metrics = set()
        
        if statement_type == 'income_statement':
            base_metrics = self.EXPECTED_INCOME_STATEMENT_METRICS.copy()
        elif statement_type == 'balance_sheet':
            base_metrics = self.EXPECTED_BALANCE_SHEET_METRICS.copy()
        elif statement_type == 'cash_flow':
            base_metrics = self.EXPECTED_CASH_FLOW_METRICS.copy()
        
        # Add industry-specific metrics
        industry = self.detect_industry(ticker)
        if industry == 'media':
            base_metrics.update(self.MEDIA_EXPECTED_METRICS)
        elif industry == 'bank':
            base_metrics.update(self.BANK_EXPECTED_METRICS)
        elif industry == 'insurance':
            base_metrics.update(self.INSURANCE_EXPECTED_METRICS)
        elif industry == 'reit':
            base_metrics.update(self.REIT_EXPECTED_METRICS)
        
        return base_metrics

    def audit_filing(
        self,
        ticker: str,
        filing_type: str,
        fiscal_period: str,
        extracted_metrics: Optional[List[Dict]] = None,
        filing_html: Optional[str] = None
    ) -> AuditReport:
        """
        Audit a single filing for completeness.
        
        Implements Requirement 10.1: Compare extracted metrics against original filing.
        
        Args:
            ticker: Company ticker symbol
            filing_type: Filing type (10-K, 10-Q)
            fiscal_period: Fiscal period (e.g., FY2024, Q1-2024)
            extracted_metrics: Pre-loaded extracted metrics (optional)
            filing_html: Pre-loaded filing HTML (optional)
            
        Returns:
            AuditReport with extraction statistics and gaps
        """
        logger.info(f"Auditing {ticker} {filing_type} {fiscal_period}")
        
        report = AuditReport(
            ticker=ticker,
            filing_type=filing_type,
            fiscal_period=fiscal_period
        )
        
        # Get extracted metrics from database or use provided
        if extracted_metrics is None and self.db:
            extracted_metrics = self._query_metrics_from_db(ticker, filing_type, fiscal_period)
        elif extracted_metrics is None:
            extracted_metrics = []
        
        # Get original filing from SEC or use provided
        if filing_html is None and self.sec_api:
            filing_html = self._fetch_filing_from_sec(ticker, filing_type, fiscal_period)
        
        # Parse filing to get all available line items
        all_available = []
        unmapped_tags = []
        
        if filing_html:
            from hybrid_parser import HybridSECParser
            parser = HybridSECParser()
            parse_result = parser.parse_filing(filing_html, ticker, filing_type, '')
            all_available = parse_result.get('structured_metrics', [])
            unmapped_tags = parse_result.get('metadata', {}).get('unmapped_tags', [])
            report.extraction_source = 'ixbrl' if len(all_available) > 0 else 'html_table'
        
        # Build sets for comparison
        extracted_set = set(m.get('normalized_metric', '').lower() for m in extracted_metrics if m.get('normalized_metric'))
        available_set = set(m.get('normalized_metric', '').lower() for m in all_available if m.get('normalized_metric'))
        
        # Calculate gaps
        missing = available_set - extracted_set
        extra = extracted_set - available_set  # Derived metrics
        
        report.total_available = len(available_set)
        report.total_extracted = len(extracted_set)
        report.missing_metrics = sorted(list(missing))
        report.extra_metrics = sorted(list(extra))
        report.unmapped_tags = unmapped_tags
        report.completeness_pct = (len(extracted_set) / len(available_set) * 100) if available_set else 100.0
        
        # Calculate per-statement completeness
        self._calculate_statement_completeness(report, extracted_metrics, all_available, ticker)
        
        logger.info(f"Audit complete: {report.completeness_pct:.1f}% completeness, "
                   f"{len(missing)} missing, {len(unmapped_tags)} unmapped tags")
        
        return report
    
    def _calculate_statement_completeness(
        self,
        report: AuditReport,
        extracted_metrics: List[Dict],
        all_available: List[Dict],
        ticker: str
    ):
        """Calculate completeness per statement type."""
        # Group metrics by statement type
        extracted_by_type = defaultdict(set)
        available_by_type = defaultdict(set)
        
        for m in extracted_metrics:
            stmt_type = m.get('statement_type', 'unknown')
            metric_name = m.get('normalized_metric', '').lower()
            if metric_name:
                extracted_by_type[stmt_type].add(metric_name)
        
        for m in all_available:
            stmt_type = m.get('statement_type', 'unknown')
            metric_name = m.get('normalized_metric', '').lower()
            if metric_name:
                available_by_type[stmt_type].add(metric_name)
        
        # Calculate completeness for each statement type
        for stmt_type, expected_set in [
            ('income_statement', self.get_expected_metrics(ticker, 'income_statement')),
            ('balance_sheet', self.get_expected_metrics(ticker, 'balance_sheet')),
            ('cash_flow', self.get_expected_metrics(ticker, 'cash_flow'))
        ]:
            extracted = extracted_by_type.get(stmt_type, set())
            available = available_by_type.get(stmt_type, set())
            
            # Use expected metrics as baseline, but also include what's available
            baseline = expected_set.union(available)
            
            if baseline:
                completeness = len(extracted.intersection(baseline)) / len(baseline) * 100
                missing = baseline - extracted
            else:
                completeness = 100.0
                missing = set()
            
            if stmt_type == 'income_statement':
                report.income_statement_completeness = completeness
                report.income_statement_missing = sorted(list(missing))
            elif stmt_type == 'balance_sheet':
                report.balance_sheet_completeness = completeness
                report.balance_sheet_missing = sorted(list(missing))
            elif stmt_type == 'cash_flow':
                report.cash_flow_completeness = completeness
                report.cash_flow_missing = sorted(list(missing))
    
    def _query_metrics_from_db(
        self,
        ticker: str,
        filing_type: str,
        fiscal_period: str
    ) -> List[Dict]:
        """Query extracted metrics from database."""
        if not self.db:
            return []
        
        # This would be implemented based on actual database schema
        # For now, return empty list
        logger.warning("Database query not implemented - returning empty metrics")
        return []
    
    def _fetch_filing_from_sec(
        self,
        ticker: str,
        filing_type: str,
        fiscal_period: str
    ) -> Optional[str]:
        """Fetch original filing from SEC."""
        if not self.sec_api:
            return None
        
        # This would be implemented based on actual SEC API client
        # For now, return None
        logger.warning("SEC API fetch not implemented - returning None")
        return None

    def audit_filing_from_parse_result(
        self,
        ticker: str,
        filing_type: str,
        fiscal_period: str,
        parse_result: Dict[str, Any],
        expected_line_items: Optional[List[str]] = None
    ) -> AuditReport:
        """
        Audit a filing using pre-parsed results.
        
        This is useful for auditing immediately after parsing without
        needing database or SEC API access.
        
        Args:
            ticker: Company ticker symbol
            filing_type: Filing type (10-K, 10-Q)
            fiscal_period: Fiscal period
            parse_result: Result from HybridSECParser.parse_filing()
            expected_line_items: Optional list of expected line items to check
            
        Returns:
            AuditReport with extraction statistics
        """
        report = AuditReport(
            ticker=ticker,
            filing_type=filing_type,
            fiscal_period=fiscal_period
        )
        
        metrics = parse_result.get('structured_metrics', [])
        metadata = parse_result.get('metadata', {})
        
        # Extract metric names
        extracted_set = set(m.get('normalized_metric', '').lower() for m in metrics if m.get('normalized_metric'))
        
        # Get expected metrics for this ticker
        expected_income = self.get_expected_metrics(ticker, 'income_statement')
        expected_balance = self.get_expected_metrics(ticker, 'balance_sheet')
        expected_cash = self.get_expected_metrics(ticker, 'cash_flow')
        
        all_expected = expected_income.union(expected_balance).union(expected_cash)
        
        # Add any custom expected items
        if expected_line_items:
            all_expected.update(item.lower() for item in expected_line_items)
        
        # Calculate gaps
        missing = all_expected - extracted_set
        
        report.total_available = len(all_expected)
        report.total_extracted = len(extracted_set)
        report.missing_metrics = sorted(list(missing))
        report.unmapped_tags = metadata.get('unmapped_tags', [])
        report.completeness_pct = (len(extracted_set.intersection(all_expected)) / len(all_expected) * 100) if all_expected else 100.0
        report.extraction_source = 'ixbrl' if metadata.get('ixbrl_facts_raw', 0) > 0 else 'html_table'
        report.parser_version = metadata.get('parser_version', 'unknown')
        
        # Calculate per-statement completeness
        self._calculate_statement_completeness_from_metrics(report, metrics, ticker)
        
        return report
    
    def _calculate_statement_completeness_from_metrics(
        self,
        report: AuditReport,
        metrics: List[Dict],
        ticker: str
    ):
        """Calculate per-statement completeness from parsed metrics."""
        # Group extracted metrics by statement type
        extracted_by_type = defaultdict(set)
        for m in metrics:
            stmt_type = m.get('statement_type', 'unknown')
            metric_name = m.get('normalized_metric', '').lower()
            if metric_name:
                extracted_by_type[stmt_type].add(metric_name)
        
        # Calculate completeness for each statement type
        for stmt_type, expected_set in [
            ('income_statement', self.get_expected_metrics(ticker, 'income_statement')),
            ('balance_sheet', self.get_expected_metrics(ticker, 'balance_sheet')),
            ('cash_flow', self.get_expected_metrics(ticker, 'cash_flow'))
        ]:
            extracted = extracted_by_type.get(stmt_type, set())
            
            if expected_set:
                completeness = len(extracted.intersection(expected_set)) / len(expected_set) * 100
                missing = expected_set - extracted
            else:
                completeness = 100.0
                missing = set()
            
            if stmt_type == 'income_statement':
                report.income_statement_completeness = completeness
                report.income_statement_missing = sorted(list(missing))
            elif stmt_type == 'balance_sheet':
                report.balance_sheet_completeness = completeness
                report.balance_sheet_missing = sorted(list(missing))
            elif stmt_type == 'cash_flow':
                report.cash_flow_completeness = completeness
                report.cash_flow_missing = sorted(list(missing))

    def generate_gap_report(
        self,
        tickers: List[str],
        filing_types: Optional[List[str]] = None,
        max_periods: int = 3
    ) -> GapAnalysisReport:
        """
        Generate comprehensive gap analysis across multiple tickers.
        
        Implements Requirement 10.5: Aggregate results and generate recommendations.
        
        Args:
            tickers: List of ticker symbols to audit
            filing_types: Filing types to audit (default: ['10-K', '10-Q'])
            max_periods: Maximum number of periods to audit per ticker/filing type
            
        Returns:
            GapAnalysisReport with aggregated statistics and recommendations
        """
        if filing_types is None:
            filing_types = ['10-K', '10-Q']
        
        logger.info(f"Generating gap report for {len(tickers)} tickers")
        
        gap_report = GapAnalysisReport()
        all_reports: List[AuditReport] = []
        unmapped_tags_all: Set[str] = set()
        missing_metrics_count: Dict[str, int] = defaultdict(int)
        industry_completeness: Dict[str, List[float]] = defaultdict(list)
        
        for ticker in tickers:
            ticker_reports = []
            industry = self.detect_industry(ticker)
            
            for filing_type in filing_types:
                # Get available periods (would query from database)
                periods = self._get_available_periods(ticker, filing_type, max_periods)
                
                for period in periods:
                    try:
                        report = self.audit_filing(ticker, filing_type, period)
                        ticker_reports.append(report)
                        all_reports.append(report)
                        
                        # Aggregate unmapped tags
                        unmapped_tags_all.update(report.unmapped_tags)
                        
                        # Count missing metrics
                        for metric in report.missing_metrics:
                            missing_metrics_count[metric] += 1
                        
                        # Track industry completeness
                        if industry:
                            industry_completeness[industry].append(report.completeness_pct)
                        
                    except Exception as e:
                        logger.error(f"Error auditing {ticker} {filing_type} {period}: {e}")
            
            if ticker_reports:
                gap_report.ticker_reports[ticker] = ticker_reports
        
        # Calculate summary statistics
        if all_reports:
            completeness_values = [r.completeness_pct for r in all_reports]
            gap_report.total_filings_audited = len(all_reports)
            gap_report.avg_completeness = sum(completeness_values) / len(completeness_values)
            gap_report.min_completeness = min(completeness_values)
            gap_report.max_completeness = max(completeness_values)
        
        # Sort missing metrics by frequency
        gap_report.most_common_missing_metrics = sorted(
            missing_metrics_count.items(),
            key=lambda x: x[1],
            reverse=True
        )[:20]  # Top 20 most common missing metrics
        
        gap_report.total_unmapped_tags = sorted(list(unmapped_tags_all))
        
        # Calculate industry completeness averages
        for industry, values in industry_completeness.items():
            gap_report.industry_completeness[industry] = sum(values) / len(values) if values else 0.0
        
        # Generate recommendations
        gap_report.recommendations = self._generate_recommendations(
            all_reports, unmapped_tags_all, missing_metrics_count
        )
        
        logger.info(f"Gap report complete: {gap_report.total_filings_audited} filings, "
                   f"{gap_report.avg_completeness:.1f}% avg completeness")
        
        return gap_report
    
    def _get_available_periods(
        self,
        ticker: str,
        filing_type: str,
        max_periods: int
    ) -> List[str]:
        """Get available fiscal periods for a ticker/filing type."""
        if self.db:
            # Would query from database
            pass
        
        # Default: return recent periods
        if filing_type == '10-K':
            return [f'FY202{i}' for i in range(4, 4 - max_periods, -1) if i >= 0]
        else:
            periods = []
            for year in range(2024, 2024 - max_periods, -1):
                for q in range(4, 0, -1):
                    periods.append(f'Q{q}-{year}')
                    if len(periods) >= max_periods:
                        break
                if len(periods) >= max_periods:
                    break
            return periods[:max_periods]
    
    def _generate_recommendations(
        self,
        reports: List[AuditReport],
        unmapped_tags: Set[str],
        missing_metrics_count: Dict[str, int]
    ) -> List[str]:
        """
        Generate actionable recommendations based on audit results.
        
        Implements Requirement 10.5: Generate recommendations for missing mappings.
        """
        recommendations = []
        
        # Recommendation 1: Add mappings for frequently unmapped tags
        if unmapped_tags:
            top_unmapped = sorted(unmapped_tags)[:10]
            recommendations.append(
                f"Add XBRL tag mappings for {len(unmapped_tags)} unmapped tags. "
                f"Top tags: {', '.join(top_unmapped)}"
            )
        
        # Recommendation 2: Address most common missing metrics
        if missing_metrics_count:
            top_missing = [m for m, _ in sorted(missing_metrics_count.items(), key=lambda x: x[1], reverse=True)[:5]]
            recommendations.append(
                f"Prioritize extraction of frequently missing metrics: {', '.join(top_missing)}"
            )
        
        # Recommendation 3: Industry-specific improvements
        industry_issues = defaultdict(list)
        for report in reports:
            industry = self.detect_industry(report.ticker)
            if industry and report.completeness_pct < 90:
                industry_issues[industry].append(report.ticker)
        
        for industry, tickers in industry_issues.items():
            if len(tickers) >= 2:
                recommendations.append(
                    f"Review {industry} industry mappings - multiple tickers have low completeness: "
                    f"{', '.join(set(tickers)[:3])}"
                )
        
        # Recommendation 4: Statement-specific issues
        low_income_stmt = [r for r in reports if r.income_statement_completeness < 80]
        low_balance_sheet = [r for r in reports if r.balance_sheet_completeness < 80]
        low_cash_flow = [r for r in reports if r.cash_flow_completeness < 80]
        
        if len(low_income_stmt) > len(reports) * 0.2:
            recommendations.append(
                "Income Statement extraction needs improvement - "
                f"{len(low_income_stmt)}/{len(reports)} filings below 80% completeness"
            )
        
        if len(low_balance_sheet) > len(reports) * 0.2:
            recommendations.append(
                "Balance Sheet extraction needs improvement - "
                f"{len(low_balance_sheet)}/{len(reports)} filings below 80% completeness"
            )
        
        if len(low_cash_flow) > len(reports) * 0.2:
            recommendations.append(
                "Cash Flow Statement extraction needs improvement - "
                f"{len(low_cash_flow)}/{len(reports)} filings below 80% completeness"
            )
        
        # Recommendation 5: Overall assessment
        avg_completeness = sum(r.completeness_pct for r in reports) / len(reports) if reports else 0
        if avg_completeness >= 95:
            recommendations.append(
                f"Excellent extraction coverage ({avg_completeness:.1f}%). "
                "Focus on edge cases and company-specific tags."
            )
        elif avg_completeness >= 85:
            recommendations.append(
                f"Good extraction coverage ({avg_completeness:.1f}%). "
                "Address the most common missing metrics to reach 95%+ target."
            )
        else:
            recommendations.append(
                f"Extraction coverage needs significant improvement ({avg_completeness:.1f}%). "
                "Review tag mappings and HTML fallback parser."
            )
        
        return recommendations

    def export_report_json(self, report: AuditReport, filepath: str):
        """Export audit report to JSON file."""
        with open(filepath, 'w') as f:
            json.dump(asdict(report), f, indent=2)
        logger.info(f"Exported audit report to {filepath}")
    
    def export_gap_report_json(self, gap_report: GapAnalysisReport, filepath: str):
        """Export gap analysis report to JSON file."""
        # Convert to serializable format
        data = {
            'report_timestamp': gap_report.report_timestamp,
            'total_filings_audited': gap_report.total_filings_audited,
            'avg_completeness': gap_report.avg_completeness,
            'min_completeness': gap_report.min_completeness,
            'max_completeness': gap_report.max_completeness,
            'total_unmapped_tags': gap_report.total_unmapped_tags,
            'most_common_missing_metrics': [
                {'metric': m, 'count': c} for m, c in gap_report.most_common_missing_metrics
            ],
            'industry_completeness': gap_report.industry_completeness,
            'recommendations': gap_report.recommendations,
            'ticker_reports': {
                ticker: [asdict(r) for r in reports]
                for ticker, reports in gap_report.ticker_reports.items()
            }
        }
        
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        logger.info(f"Exported gap report to {filepath}")
    
    def format_report_text(self, report: AuditReport) -> str:
        """Format audit report as human-readable text."""
        lines = [
            "=" * 60,
            f"PARSING AUDIT REPORT",
            "=" * 60,
            f"Ticker: {report.ticker}",
            f"Filing Type: {report.filing_type}",
            f"Fiscal Period: {report.fiscal_period}",
            f"Audit Timestamp: {report.audit_timestamp}",
            "",
            "EXTRACTION SUMMARY",
            "-" * 40,
            f"Total Available Metrics: {report.total_available}",
            f"Total Extracted Metrics: {report.total_extracted}",
            f"Overall Completeness: {report.completeness_pct:.1f}%",
            f"Extraction Source: {report.extraction_source}",
            "",
            "PER-STATEMENT COMPLETENESS",
            "-" * 40,
            f"Income Statement: {report.income_statement_completeness:.1f}%",
            f"Balance Sheet: {report.balance_sheet_completeness:.1f}%",
            f"Cash Flow Statement: {report.cash_flow_completeness:.1f}%",
        ]
        
        if report.missing_metrics:
            lines.extend([
                "",
                f"MISSING METRICS ({len(report.missing_metrics)})",
                "-" * 40,
            ])
            for metric in report.missing_metrics[:20]:
                lines.append(f"  - {metric}")
            if len(report.missing_metrics) > 20:
                lines.append(f"  ... and {len(report.missing_metrics) - 20} more")
        
        if report.unmapped_tags:
            lines.extend([
                "",
                f"UNMAPPED XBRL TAGS ({len(report.unmapped_tags)})",
                "-" * 40,
            ])
            for tag in report.unmapped_tags[:10]:
                lines.append(f"  - {tag}")
            if len(report.unmapped_tags) > 10:
                lines.append(f"  ... and {len(report.unmapped_tags) - 10} more")
        
        lines.append("=" * 60)
        return "\n".join(lines)
    
    def format_gap_report_text(self, gap_report: GapAnalysisReport) -> str:
        """Format gap analysis report as human-readable text."""
        lines = [
            "=" * 70,
            "GAP ANALYSIS REPORT",
            "=" * 70,
            f"Report Timestamp: {gap_report.report_timestamp}",
            f"Total Filings Audited: {gap_report.total_filings_audited}",
            "",
            "COMPLETENESS SUMMARY",
            "-" * 50,
            f"Average Completeness: {gap_report.avg_completeness:.1f}%",
            f"Minimum Completeness: {gap_report.min_completeness:.1f}%",
            f"Maximum Completeness: {gap_report.max_completeness:.1f}%",
        ]
        
        if gap_report.industry_completeness:
            lines.extend([
                "",
                "COMPLETENESS BY INDUSTRY",
                "-" * 50,
            ])
            for industry, completeness in sorted(gap_report.industry_completeness.items()):
                lines.append(f"  {industry.capitalize()}: {completeness:.1f}%")
        
        if gap_report.most_common_missing_metrics:
            lines.extend([
                "",
                "MOST COMMON MISSING METRICS",
                "-" * 50,
            ])
            for metric, count in gap_report.most_common_missing_metrics[:10]:
                lines.append(f"  {metric}: {count} occurrences")
        
        if gap_report.total_unmapped_tags:
            lines.extend([
                "",
                f"UNMAPPED XBRL TAGS ({len(gap_report.total_unmapped_tags)} total)",
                "-" * 50,
            ])
            for tag in gap_report.total_unmapped_tags[:15]:
                lines.append(f"  - {tag}")
            if len(gap_report.total_unmapped_tags) > 15:
                lines.append(f"  ... and {len(gap_report.total_unmapped_tags) - 15} more")
        
        if gap_report.recommendations:
            lines.extend([
                "",
                "RECOMMENDATIONS",
                "-" * 50,
            ])
            for i, rec in enumerate(gap_report.recommendations, 1):
                lines.append(f"  {i}. {rec}")
        
        # Per-ticker summary
        if gap_report.ticker_reports:
            lines.extend([
                "",
                "PER-TICKER SUMMARY",
                "-" * 50,
            ])
            for ticker, reports in sorted(gap_report.ticker_reports.items()):
                avg = sum(r.completeness_pct for r in reports) / len(reports) if reports else 0
                lines.append(f"  {ticker}: {avg:.1f}% avg ({len(reports)} filings)")
        
        lines.append("=" * 70)
        return "\n".join(lines)


def get_audit_script(db_connection=None, sec_api_client=None) -> ParsingAuditScript:
    """Factory function to get audit script instance."""
    return ParsingAuditScript(db_connection, sec_api_client)


# CLI interface for running audits
if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Audit SEC filing parsing completeness')
    parser.add_argument('--ticker', '-t', help='Ticker symbol to audit')
    parser.add_argument('--tickers', '-T', nargs='+', help='Multiple ticker symbols')
    parser.add_argument('--filing-type', '-f', default='10-K', help='Filing type (10-K, 10-Q)')
    parser.add_argument('--period', '-p', help='Fiscal period (e.g., FY2024)')
    parser.add_argument('--output', '-o', help='Output file path')
    parser.add_argument('--format', choices=['json', 'text'], default='text', help='Output format')
    parser.add_argument('--gap-report', '-g', action='store_true', help='Generate gap analysis report')
    
    args = parser.parse_args()
    
    logging.basicConfig(level=logging.INFO)
    
    audit = ParsingAuditScript()
    
    if args.gap_report:
        tickers = args.tickers or [args.ticker] if args.ticker else ['AAPL', 'MSFT', 'CMCSA']
        gap_report = audit.generate_gap_report(tickers)
        
        if args.format == 'json' and args.output:
            audit.export_gap_report_json(gap_report, args.output)
        else:
            print(audit.format_gap_report_text(gap_report))
    
    elif args.ticker:
        report = audit.audit_filing(
            args.ticker,
            args.filing_type,
            args.period or 'FY2024'
        )
        
        if args.format == 'json' and args.output:
            audit.export_report_json(report, args.output)
        else:
            print(audit.format_report_text(report))
    
    else:
        parser.print_help()
