"""
Tests for ParsingAuditScript

Tests the audit functionality for SEC filing parsing completeness.
"""

import pytest
from audit_script import (
    ParsingAuditScript,
    AuditReport,
    GapAnalysisReport,
    get_audit_script
)


class TestParsingAuditScript:
    """Tests for ParsingAuditScript class"""
    
    @pytest.fixture
    def audit_script(self):
        """Create audit script instance"""
        return ParsingAuditScript()
    
    def test_detect_industry_media(self, audit_script):
        """Test media company detection"""
        assert audit_script.detect_industry('CMCSA') == 'media'
        assert audit_script.detect_industry('DIS') == 'media'
        assert audit_script.detect_industry('NFLX') == 'media'
    
    def test_detect_industry_bank(self, audit_script):
        """Test bank detection"""
        assert audit_script.detect_industry('JPM') == 'bank'
        assert audit_script.detect_industry('BAC') == 'bank'
        assert audit_script.detect_industry('GS') == 'bank'
    
    def test_detect_industry_insurance(self, audit_script):
        """Test insurance company detection"""
        assert audit_script.detect_industry('BRK.A') == 'insurance'
        assert audit_script.detect_industry('MET') == 'insurance'
    
    def test_detect_industry_reit(self, audit_script):
        """Test REIT detection"""
        assert audit_script.detect_industry('AMT') == 'reit'
        assert audit_script.detect_industry('PLD') == 'reit'
    
    def test_detect_industry_utility(self, audit_script):
        """Test utility company detection"""
        assert audit_script.detect_industry('NEE') == 'utility'
        assert audit_script.detect_industry('DUK') == 'utility'
    
    def test_detect_industry_telecom(self, audit_script):
        """Test telecom company detection"""
        assert audit_script.detect_industry('T') == 'telecom'
        assert audit_script.detect_industry('VZ') == 'telecom'
    
    def test_detect_industry_unknown(self, audit_script):
        """Test unknown ticker returns None"""
        assert audit_script.detect_industry('AAPL') is None
        assert audit_script.detect_industry('MSFT') is None
        assert audit_script.detect_industry('UNKNOWN') is None
    
    def test_get_expected_metrics_income_statement(self, audit_script):
        """Test expected income statement metrics"""
        metrics = audit_script.get_expected_metrics('AAPL', 'income_statement')
        
        assert 'revenue' in metrics
        assert 'net_income' in metrics
        assert 'operating_income' in metrics
        assert 'earnings_per_share_basic' in metrics
    
    def test_get_expected_metrics_balance_sheet(self, audit_script):
        """Test expected balance sheet metrics"""
        metrics = audit_script.get_expected_metrics('AAPL', 'balance_sheet')
        
        assert 'total_assets' in metrics
        assert 'total_liabilities' in metrics
        assert 'shareholders_equity' in metrics
        assert 'cash_and_equivalents' in metrics
    
    def test_get_expected_metrics_cash_flow(self, audit_script):
        """Test expected cash flow metrics"""
        metrics = audit_script.get_expected_metrics('AAPL', 'cash_flow')
        
        assert 'operating_cash_flow' in metrics
        assert 'investing_cash_flow' in metrics
        assert 'financing_cash_flow' in metrics
    
    def test_get_expected_metrics_media_industry(self, audit_script):
        """Test media industry-specific metrics are included"""
        metrics = audit_script.get_expected_metrics('CMCSA', 'income_statement')
        
        # Should include base metrics
        assert 'revenue' in metrics
        assert 'net_income' in metrics
        
        # Should include media-specific metrics
        assert 'programming_and_production' in metrics
        assert 'marketing_and_promotion' in metrics
    
    def test_get_expected_metrics_bank_industry(self, audit_script):
        """Test bank industry-specific metrics are included"""
        metrics = audit_script.get_expected_metrics('JPM', 'income_statement')
        
        # Should include base metrics
        assert 'revenue' in metrics
        
        # Should include bank-specific metrics
        assert 'net_interest_income' in metrics
        assert 'provision_credit_losses' in metrics
    
    def test_audit_filing_from_parse_result(self, audit_script):
        """Test auditing from pre-parsed results"""
        parse_result = {
            'structured_metrics': [
                {'normalized_metric': 'revenue', 'statement_type': 'income_statement', 'value': 100000},
                {'normalized_metric': 'net_income', 'statement_type': 'income_statement', 'value': 20000},
                {'normalized_metric': 'total_assets', 'statement_type': 'balance_sheet', 'value': 500000},
            ],
            'metadata': {
                'ixbrl_facts_raw': 100,
                'parser_version': 'hybrid_v1.1',
                'unmapped_tags': ['custom:SomeTag']
            }
        }
        
        report = audit_script.audit_filing_from_parse_result(
            ticker='AAPL',
            filing_type='10-K',
            fiscal_period='FY2024',
            parse_result=parse_result
        )
        
        assert report.ticker == 'AAPL'
        assert report.filing_type == '10-K'
        assert report.fiscal_period == 'FY2024'
        assert report.total_extracted == 3
        assert report.extraction_source == 'ixbrl'
        assert 'custom:SomeTag' in report.unmapped_tags
    
    def test_audit_report_dataclass(self):
        """Test AuditReport dataclass"""
        report = AuditReport(
            ticker='AAPL',
            filing_type='10-K',
            fiscal_period='FY2024'
        )
        
        assert report.ticker == 'AAPL'
        assert report.completeness_pct == 0.0
        assert report.missing_metrics == []
        assert report.unmapped_tags == []
    
    def test_gap_analysis_report_dataclass(self):
        """Test GapAnalysisReport dataclass"""
        gap_report = GapAnalysisReport()
        
        assert gap_report.total_filings_audited == 0
        assert gap_report.avg_completeness == 0.0
        assert gap_report.recommendations == []
        assert gap_report.ticker_reports == {}
    
    def test_format_report_text(self, audit_script):
        """Test text formatting of audit report"""
        report = AuditReport(
            ticker='AAPL',
            filing_type='10-K',
            fiscal_period='FY2024',
            total_available=50,
            total_extracted=45,
            completeness_pct=90.0,
            missing_metrics=['metric_a', 'metric_b'],
            unmapped_tags=['tag:A', 'tag:B']
        )
        
        text = audit_script.format_report_text(report)
        
        assert 'AAPL' in text
        assert '10-K' in text
        assert 'FY2024' in text
        assert '90.0%' in text
        assert 'metric_a' in text
        assert 'tag:A' in text
    
    def test_format_gap_report_text(self, audit_script):
        """Test text formatting of gap analysis report"""
        gap_report = GapAnalysisReport(
            total_filings_audited=10,
            avg_completeness=85.5,
            min_completeness=70.0,
            max_completeness=98.0,
            recommendations=['Add more mappings', 'Review bank filings']
        )
        
        text = audit_script.format_gap_report_text(gap_report)
        
        assert 'GAP ANALYSIS REPORT' in text
        assert '85.5%' in text
        assert '70.0%' in text
        assert '98.0%' in text
        assert 'Add more mappings' in text
    
    def test_generate_recommendations(self, audit_script):
        """Test recommendation generation"""
        reports = [
            AuditReport(
                ticker='AAPL',
                filing_type='10-K',
                fiscal_period='FY2024',
                completeness_pct=95.0,
                income_statement_completeness=90.0,
                balance_sheet_completeness=95.0,
                cash_flow_completeness=98.0
            ),
            AuditReport(
                ticker='MSFT',
                filing_type='10-K',
                fiscal_period='FY2024',
                completeness_pct=92.0,
                income_statement_completeness=88.0,
                balance_sheet_completeness=94.0,
                cash_flow_completeness=96.0
            )
        ]
        
        unmapped_tags = {'tag:A', 'tag:B', 'tag:C'}
        missing_metrics = {'metric_a': 5, 'metric_b': 3, 'metric_c': 2}
        
        recommendations = audit_script._generate_recommendations(
            reports, unmapped_tags, missing_metrics
        )
        
        assert len(recommendations) > 0
        # Should have recommendation about unmapped tags
        assert any('unmapped' in r.lower() for r in recommendations)
    
    def test_get_available_periods_10k(self, audit_script):
        """Test getting available periods for 10-K"""
        periods = audit_script._get_available_periods('AAPL', '10-K', 3)
        
        assert len(periods) <= 3
        assert all('FY' in p for p in periods)
    
    def test_get_available_periods_10q(self, audit_script):
        """Test getting available periods for 10-Q"""
        periods = audit_script._get_available_periods('AAPL', '10-Q', 4)
        
        assert len(periods) <= 4
        assert all('Q' in p for p in periods)
    
    def test_factory_function(self):
        """Test get_audit_script factory function"""
        audit = get_audit_script()
        
        assert isinstance(audit, ParsingAuditScript)
        assert audit.db is None
        assert audit.sec_api is None


class TestAuditReportCompleteness:
    """Tests for completeness calculation"""
    
    @pytest.fixture
    def audit_script(self):
        return ParsingAuditScript()
    
    def test_completeness_calculation_full(self, audit_script):
        """Test completeness when all expected metrics are present"""
        parse_result = {
            'structured_metrics': [
                {'normalized_metric': 'revenue', 'statement_type': 'income_statement', 'value': 100000},
                {'normalized_metric': 'cost_of_revenue', 'statement_type': 'income_statement', 'value': 60000},
                {'normalized_metric': 'gross_profit', 'statement_type': 'income_statement', 'value': 40000},
                {'normalized_metric': 'operating_expenses', 'statement_type': 'income_statement', 'value': 20000},
                {'normalized_metric': 'operating_income', 'statement_type': 'income_statement', 'value': 20000},
                {'normalized_metric': 'income_before_taxes', 'statement_type': 'income_statement', 'value': 18000},
                {'normalized_metric': 'income_tax_expense', 'statement_type': 'income_statement', 'value': 4000},
                {'normalized_metric': 'net_income', 'statement_type': 'income_statement', 'value': 14000},
                {'normalized_metric': 'earnings_per_share_basic', 'statement_type': 'income_statement', 'value': 1.50},
                {'normalized_metric': 'earnings_per_share_diluted', 'statement_type': 'income_statement', 'value': 1.48},
                {'normalized_metric': 'weighted_average_shares_basic', 'statement_type': 'income_statement', 'value': 9000000},
                {'normalized_metric': 'weighted_average_shares_diluted', 'statement_type': 'income_statement', 'value': 9500000},
                {'normalized_metric': 'total_revenue', 'statement_type': 'income_statement', 'value': 100000},
            ],
            'metadata': {'ixbrl_facts_raw': 50}
        }
        
        report = audit_script.audit_filing_from_parse_result(
            ticker='AAPL',
            filing_type='10-K',
            fiscal_period='FY2024',
            parse_result=parse_result
        )
        
        # Should have high income statement completeness
        assert report.income_statement_completeness > 80
    
    def test_completeness_calculation_partial(self, audit_script):
        """Test completeness when some metrics are missing"""
        parse_result = {
            'structured_metrics': [
                {'normalized_metric': 'revenue', 'statement_type': 'income_statement', 'value': 100000},
                {'normalized_metric': 'net_income', 'statement_type': 'income_statement', 'value': 14000},
            ],
            'metadata': {'ixbrl_facts_raw': 10}
        }
        
        report = audit_script.audit_filing_from_parse_result(
            ticker='AAPL',
            filing_type='10-K',
            fiscal_period='FY2024',
            parse_result=parse_result
        )
        
        # Should have lower completeness
        assert report.income_statement_completeness < 50
        assert len(report.income_statement_missing) > 0


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
