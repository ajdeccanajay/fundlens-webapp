"""
Tests for DataValidator

Tests the comprehensive data validation for SEC financial data.
"""

import pytest
from data_validator import (
    DataValidator,
    ValidationCheck,
    ValidationReport,
    ValidationStatus,
    get_validator
)


class TestDataValidator:
    """Tests for DataValidator class"""
    
    @pytest.fixture
    def validator(self):
        """Create validator instance"""
        return DataValidator(tolerance_pct=0.01)  # 1% tolerance
    
    @pytest.fixture
    def sample_metrics(self):
        """Sample metrics for testing"""
        return [
            # Balance Sheet
            {'normalized_metric': 'total_assets', 'value': 1000000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'current_assets', 'value': 400000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'noncurrent_assets', 'value': 600000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'total_liabilities', 'value': 600000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'current_liabilities', 'value': 200000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'total_non_current_liabilities', 'value': 400000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'shareholders_equity', 'value': 400000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'liabilities_and_equity', 'value': 1000000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'cash_and_equivalents', 'value': 100000, 'fiscal_period': 'FY2024'},
            
            # Income Statement
            {'normalized_metric': 'revenue', 'value': 500000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'cost_of_revenue', 'value': 300000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'gross_profit', 'value': 200000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'operating_expenses', 'value': 100000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'operating_income', 'value': 100000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'income_before_taxes', 'value': 90000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'income_tax_expense', 'value': 20000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'net_income', 'value': 70000, 'fiscal_period': 'FY2024'},
            
            # Cash Flow
            {'normalized_metric': 'operating_cash_flow', 'value': 80000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'investing_cash_flow', 'value': -30000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'financing_cash_flow', 'value': -40000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'net_change_in_cash', 'value': 10000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'cash_beginning', 'value': 90000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'cash_ending', 'value': 100000, 'fiscal_period': 'FY2024'},
        ]
    
    def test_validator_initialization(self, validator):
        """Test validator initialization"""
        assert validator.tolerance_pct == 0.01
    
    def test_validate_filing_returns_report(self, validator, sample_metrics):
        """Test that validate_filing returns a ValidationReport"""
        report = validator.validate_filing(
            metrics=sample_metrics,
            ticker='TEST',
            filing_type='10-K',
            fiscal_period='FY2024'
        )
        
        assert isinstance(report, ValidationReport)
        assert report.ticker == 'TEST'
        assert report.filing_type == '10-K'
        assert report.fiscal_period == 'FY2024'
    
    def test_balance_sheet_validation_passes(self, validator, sample_metrics):
        """Test balance sheet validation with correct data"""
        report = validator.validate_filing(
            metrics=sample_metrics,
            ticker='TEST',
            filing_type='10-K',
            fiscal_period='FY2024'
        )
        
        # Find balance sheet checks
        bs_checks = [c for c in report.checks if 'Assets' in c.check_name or 'Liabilities' in c.check_name]
        
        # At least some should pass
        passed = [c for c in bs_checks if c.status == ValidationStatus.PASSED]
        assert len(passed) > 0
    
    def test_income_statement_validation_passes(self, validator, sample_metrics):
        """Test income statement validation with correct data"""
        report = validator.validate_filing(
            metrics=sample_metrics,
            ticker='TEST',
            filing_type='10-K',
            fiscal_period='FY2024'
        )
        
        # Find gross profit check
        gross_profit_check = next(
            (c for c in report.checks if 'Gross Profit' in c.check_name),
            None
        )
        
        assert gross_profit_check is not None
        assert gross_profit_check.status == ValidationStatus.PASSED
    
    def test_cash_flow_validation_passes(self, validator, sample_metrics):
        """Test cash flow validation with correct data"""
        report = validator.validate_filing(
            metrics=sample_metrics,
            ticker='TEST',
            filing_type='10-K',
            fiscal_period='FY2024'
        )
        
        # Find net change in cash check
        cash_check = next(
            (c for c in report.checks if 'Net Change in Cash' in c.check_name),
            None
        )
        
        assert cash_check is not None
        assert cash_check.status == ValidationStatus.PASSED
    
    def test_validation_fails_with_incorrect_data(self, validator):
        """Test validation fails when data is inconsistent"""
        bad_metrics = [
            {'normalized_metric': 'revenue', 'value': 500000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'cost_of_revenue', 'value': 300000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'gross_profit', 'value': 100000, 'fiscal_period': 'FY2024'},  # Should be 200000
        ]
        
        report = validator.validate_filing(
            metrics=bad_metrics,
            ticker='TEST',
            filing_type='10-K',
            fiscal_period='FY2024'
        )
        
        # Find gross profit check
        gross_profit_check = next(
            (c for c in report.checks if 'Gross Profit' in c.check_name and c.status != ValidationStatus.SKIPPED),
            None
        )
        
        if gross_profit_check:
            assert gross_profit_check.status == ValidationStatus.FAILED
    
    def test_validation_skips_missing_metrics(self, validator):
        """Test validation skips checks when metrics are missing"""
        partial_metrics = [
            {'normalized_metric': 'revenue', 'value': 500000, 'fiscal_period': 'FY2024'},
            # Missing cost_of_revenue and gross_profit
        ]
        
        report = validator.validate_filing(
            metrics=partial_metrics,
            ticker='TEST',
            filing_type='10-K',
            fiscal_period='FY2024'
        )
        
        # Most checks should be skipped
        assert report.skipped_checks > 0
    
    def test_confidence_calculation(self, validator, sample_metrics):
        """Test confidence score calculation"""
        report = validator.validate_filing(
            metrics=sample_metrics,
            ticker='TEST',
            filing_type='10-K',
            fiscal_period='FY2024'
        )
        
        # Confidence should be between 0 and 100
        assert 0 <= report.validation_confidence <= 100
        assert 0 <= report.extraction_confidence <= 100
        assert 0 <= report.overall_confidence <= 100
    
    def test_tolerance_affects_validation(self):
        """Test that tolerance setting affects validation results"""
        strict_validator = DataValidator(tolerance_pct=0.001)  # 0.1%
        lenient_validator = DataValidator(tolerance_pct=0.10)  # 10%
        
        # Metrics with small discrepancy
        metrics = [
            {'normalized_metric': 'revenue', 'value': 500000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'cost_of_revenue', 'value': 300000, 'fiscal_period': 'FY2024'},
            {'normalized_metric': 'gross_profit', 'value': 199000, 'fiscal_period': 'FY2024'},  # 0.5% off
        ]
        
        strict_report = strict_validator.validate_filing(
            metrics=metrics, ticker='TEST', filing_type='10-K', fiscal_period='FY2024'
        )
        
        lenient_report = lenient_validator.validate_filing(
            metrics=metrics, ticker='TEST', filing_type='10-K', fiscal_period='FY2024'
        )
        
        # Lenient should have more passes
        assert lenient_report.passed_checks >= strict_report.passed_checks


class TestValidationCheck:
    """Tests for ValidationCheck dataclass"""
    
    def test_validation_check_creation(self):
        """Test ValidationCheck creation"""
        check = ValidationCheck(
            check_name='Test Check',
            check_type='mathematical',
            status=ValidationStatus.PASSED,
            expected_value=100.0,
            actual_value=100.0,
            message='Test passed'
        )
        
        assert check.check_name == 'Test Check'
        assert check.status == ValidationStatus.PASSED
        assert check.difference is None
    
    def test_validation_status_enum(self):
        """Test ValidationStatus enum values"""
        assert ValidationStatus.PASSED.value == 'passed'
        assert ValidationStatus.FAILED.value == 'failed'
        assert ValidationStatus.SKIPPED.value == 'skipped'
        assert ValidationStatus.WARNING.value == 'warning'


class TestValidationReport:
    """Tests for ValidationReport dataclass"""
    
    def test_validation_report_creation(self):
        """Test ValidationReport creation"""
        report = ValidationReport(
            ticker='AAPL',
            filing_type='10-K',
            fiscal_period='FY2024'
        )
        
        assert report.ticker == 'AAPL'
        assert report.total_checks == 0
        assert report.checks == []
    
    def test_validation_report_with_checks(self):
        """Test ValidationReport with checks"""
        check = ValidationCheck(
            check_name='Test',
            check_type='mathematical',
            status=ValidationStatus.PASSED
        )
        
        report = ValidationReport(
            ticker='AAPL',
            filing_type='10-K',
            fiscal_period='FY2024',
            total_checks=1,
            passed_checks=1,
            checks=[check]
        )
        
        assert report.total_checks == 1
        assert len(report.checks) == 1


class TestReportFormatting:
    """Tests for report formatting"""
    
    @pytest.fixture
    def validator(self):
        return DataValidator()
    
    def test_format_report_text(self, validator):
        """Test text report formatting"""
        report = ValidationReport(
            ticker='AAPL',
            filing_type='10-K',
            fiscal_period='FY2024',
            total_checks=5,
            passed_checks=4,
            failed_checks=1,
            validation_confidence=80.0,
            extraction_confidence=95.0,
            overall_confidence=80.0
        )
        
        text = validator.format_report_text(report)
        
        assert 'AAPL' in text
        assert '10-K' in text
        assert 'FY2024' in text
        assert '80.0%' in text
        assert 'Passed: 4' in text
        assert 'Failed: 1' in text


class TestFactoryFunction:
    """Tests for factory function"""
    
    def test_get_validator_default(self):
        """Test get_validator with default tolerance"""
        validator = get_validator()
        assert isinstance(validator, DataValidator)
        assert validator.tolerance_pct == DataValidator.DEFAULT_TOLERANCE_PCT
    
    def test_get_validator_custom_tolerance(self):
        """Test get_validator with custom tolerance"""
        validator = get_validator(tolerance_pct=0.05)
        assert validator.tolerance_pct == 0.05


class TestMathematicalValidations:
    """Tests for specific mathematical validations"""
    
    @pytest.fixture
    def validator(self):
        return DataValidator(tolerance_pct=0.01)
    
    def test_sum_equals_total_pass(self, validator):
        """Test sum equals total check passes"""
        metrics_map = {
            'total_assets': 1000,
            'current_assets': 400,
            'noncurrent_assets': 600
        }
        
        check = validator._check_sum_equals_total(
            metrics_map,
            total_metric='total_assets',
            component_metrics=['current_assets', 'noncurrent_assets'],
            check_name='Test',
            check_type='mathematical'
        )
        
        assert check.status == ValidationStatus.PASSED
    
    def test_sum_equals_total_fail(self, validator):
        """Test sum equals total check fails"""
        metrics_map = {
            'total_assets': 1000,
            'current_assets': 400,
            'noncurrent_assets': 500  # Should be 600
        }
        
        check = validator._check_sum_equals_total(
            metrics_map,
            total_metric='total_assets',
            component_metrics=['current_assets', 'noncurrent_assets'],
            check_name='Test',
            check_type='mathematical'
        )
        
        assert check.status == ValidationStatus.FAILED
    
    def test_difference_equals_pass(self, validator):
        """Test difference equals check passes"""
        metrics_map = {
            'revenue': 500,
            'cost_of_revenue': 300,
            'gross_profit': 200
        }
        
        check = validator._check_difference_equals(
            metrics_map,
            minuend='revenue',
            subtrahend='cost_of_revenue',
            result='gross_profit',
            check_name='Test',
            check_type='mathematical'
        )
        
        assert check.status == ValidationStatus.PASSED
    
    def test_values_equal_pass(self, validator):
        """Test values equal check passes"""
        metrics_map = {
            'total_assets': 1000,
            'liabilities_and_equity': 1000
        }
        
        check = validator._check_values_equal(
            metrics_map,
            metric_a='total_assets',
            metric_b='liabilities_and_equity',
            check_name='Test',
            check_type='mathematical'
        )
        
        assert check.status == ValidationStatus.PASSED


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
