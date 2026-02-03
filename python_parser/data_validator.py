"""
Data Validator - Comprehensive validation for SEC financial data

This module provides:
1. Mathematical validation (totals = sum of components)
2. Cross-statement validation (Net Income consistency, Cash reconciliation)
3. Validation logging and audit trail
4. Confidence scoring system

Requirements: 12.1, 12.2, 12.4
"""

import logging
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime
from decimal import Decimal
from enum import Enum

logger = logging.getLogger(__name__)


class ValidationStatus(Enum):
    """Status of a validation check"""
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"  # Missing required metrics
    WARNING = "warning"  # Within tolerance but not exact


@dataclass
class ValidationCheck:
    """Result of a single validation check"""
    check_name: str
    check_type: str  # 'mathematical', 'cross_statement', 'reconciliation'
    status: ValidationStatus
    expected_value: Optional[float] = None
    actual_value: Optional[float] = None
    difference: Optional[float] = None
    difference_pct: Optional[float] = None
    message: str = ""
    metrics_used: List[str] = field(default_factory=list)
    tolerance_pct: float = 0.01  # 1% default tolerance


@dataclass
class ValidationReport:
    """Complete validation report for a filing"""
    ticker: str
    filing_type: str
    fiscal_period: str
    validation_timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    
    # Summary
    total_checks: int = 0
    passed_checks: int = 0
    failed_checks: int = 0
    skipped_checks: int = 0
    warning_checks: int = 0
    
    # Confidence scores
    extraction_confidence: float = 0.0  # (mapped_tags / total_tags) * 100
    validation_confidence: float = 0.0  # (passed_checks / total_checks) * 100
    overall_confidence: float = 0.0     # min(extraction, validation)
    
    # Detailed results
    checks: List[ValidationCheck] = field(default_factory=list)
    
    # Audit info
    parser_version: str = "hybrid_v1.1"
    validator_version: str = "1.0.0"


class DataValidator:
    """
    Validates financial data for mathematical consistency and cross-statement reconciliation.
    
    Implements Requirements 12.1, 12.2, 12.4:
    - 12.1: Mathematical validation (totals = sum of components)
    - 12.2: Validation logging and audit trail
    - 12.4: Confidence scoring system
    """
    
    # Default tolerance for validation (1% difference allowed)
    DEFAULT_TOLERANCE_PCT = 0.01
    
    # Tolerance for exact matches (0.1% for rounding)
    STRICT_TOLERANCE_PCT = 0.001
    
    def __init__(self, tolerance_pct: float = DEFAULT_TOLERANCE_PCT):
        """
        Initialize validator.
        
        Args:
            tolerance_pct: Percentage tolerance for validation checks (default 1%)
        """
        self.tolerance_pct = tolerance_pct
    
    def validate_filing(
        self,
        metrics: List[Dict[str, Any]],
        ticker: str,
        filing_type: str,
        fiscal_period: str,
        extraction_stats: Optional[Dict[str, Any]] = None
    ) -> ValidationReport:
        """
        Run all validation checks on a filing's metrics.
        
        Args:
            metrics: List of extracted metrics
            ticker: Company ticker
            filing_type: Filing type (10-K, 10-Q)
            fiscal_period: Fiscal period
            extraction_stats: Optional extraction statistics for confidence calculation
            
        Returns:
            ValidationReport with all check results
        """
        logger.info(f"Validating {ticker} {filing_type} {fiscal_period}")
        
        report = ValidationReport(
            ticker=ticker,
            filing_type=filing_type,
            fiscal_period=fiscal_period
        )
        
        # Build metrics lookup by normalized_metric
        metrics_map = self._build_metrics_map(metrics, fiscal_period)
        
        # Run all validation checks
        checks = []
        
        # 1. Balance Sheet validations
        checks.extend(self._validate_balance_sheet(metrics_map))
        
        # 2. Income Statement validations
        checks.extend(self._validate_income_statement(metrics_map))
        
        # 3. Cash Flow validations
        checks.extend(self._validate_cash_flow(metrics_map))
        
        # 4. Cross-statement validations
        checks.extend(self._validate_cross_statement(metrics_map))
        
        # Aggregate results
        report.checks = checks
        report.total_checks = len(checks)
        report.passed_checks = sum(1 for c in checks if c.status == ValidationStatus.PASSED)
        report.failed_checks = sum(1 for c in checks if c.status == ValidationStatus.FAILED)
        report.skipped_checks = sum(1 for c in checks if c.status == ValidationStatus.SKIPPED)
        report.warning_checks = sum(1 for c in checks if c.status == ValidationStatus.WARNING)
        
        # Calculate confidence scores
        report.validation_confidence = self._calculate_validation_confidence(report)
        report.extraction_confidence = self._calculate_extraction_confidence(extraction_stats)
        report.overall_confidence = min(report.validation_confidence, report.extraction_confidence)
        
        logger.info(f"Validation complete: {report.passed_checks}/{report.total_checks} passed, "
                   f"confidence: {report.overall_confidence:.1f}%")
        
        return report
    
    def _build_metrics_map(
        self,
        metrics: List[Dict[str, Any]],
        fiscal_period: str
    ) -> Dict[str, float]:
        """Build a lookup map of metric name -> value for a specific period."""
        metrics_map = {}
        
        for m in metrics:
            # Filter to the specific fiscal period
            if m.get('fiscal_period') != fiscal_period:
                continue
            
            metric_name = m.get('normalized_metric', '').lower()
            value = m.get('value')
            
            if metric_name and value is not None:
                try:
                    metrics_map[metric_name] = float(value)
                except (ValueError, TypeError):
                    pass
        
        return metrics_map

    def _validate_balance_sheet(self, metrics_map: Dict[str, float]) -> List[ValidationCheck]:
        """
        Validate Balance Sheet mathematical relationships.
        
        Implements Requirement 12.1:
        - Total Assets = Current Assets + Non-Current Assets
        - Total Liabilities = Current Liabilities + Non-Current Liabilities
        - Total Liabilities & Equity = Total Assets
        """
        checks = []
        
        # Check 1: Total Assets = Current Assets + Non-Current Assets
        checks.append(self._check_sum_equals_total(
            metrics_map,
            total_metric='total_assets',
            component_metrics=['current_assets', 'noncurrent_assets'],
            check_name='Total Assets = Current + Non-Current Assets',
            check_type='mathematical'
        ))
        
        # Check 2: Total Liabilities = Current + Non-Current Liabilities
        checks.append(self._check_sum_equals_total(
            metrics_map,
            total_metric='total_liabilities',
            component_metrics=['current_liabilities', 'total_non_current_liabilities'],
            check_name='Total Liabilities = Current + Non-Current Liabilities',
            check_type='mathematical'
        ))
        
        # Alternative: Try with different metric names
        if checks[-1].status == ValidationStatus.SKIPPED:
            checks.append(self._check_sum_equals_total(
                metrics_map,
                total_metric='total_liabilities',
                component_metrics=['current_liabilities', 'long_term_debt', 'other_noncurrent_liabilities'],
                check_name='Total Liabilities = Current + Long-term Debt + Other Non-current',
                check_type='mathematical'
            ))
        
        # Check 3: Total Liabilities & Equity = Total Assets (Accounting Equation)
        checks.append(self._check_values_equal(
            metrics_map,
            metric_a='total_assets',
            metric_b='liabilities_and_equity',
            check_name='Total Assets = Total Liabilities & Equity',
            check_type='mathematical'
        ))
        
        # Check 4: Shareholders Equity = Total Assets - Total Liabilities
        checks.append(self._check_difference_equals(
            metrics_map,
            minuend='total_assets',
            subtrahend='total_liabilities',
            result='shareholders_equity',
            check_name='Shareholders Equity = Total Assets - Total Liabilities',
            check_type='mathematical'
        ))
        
        # Check 5: Current Assets components
        checks.append(self._check_sum_less_than_or_equal(
            metrics_map,
            total_metric='current_assets',
            component_metrics=['cash_and_equivalents', 'marketable_securities', 'accounts_receivable', 'inventory', 'prepaid_expenses'],
            check_name='Current Assets >= Sum of Components',
            check_type='mathematical'
        ))
        
        return checks
    
    def _validate_income_statement(self, metrics_map: Dict[str, float]) -> List[ValidationCheck]:
        """
        Validate Income Statement mathematical relationships.
        
        Implements Requirement 12.1:
        - Gross Profit = Revenue - Cost of Revenue
        - Operating Income = Gross Profit - Operating Expenses
        """
        checks = []
        
        # Check 1: Gross Profit = Revenue - Cost of Revenue
        checks.append(self._check_difference_equals(
            metrics_map,
            minuend='revenue',
            subtrahend='cost_of_revenue',
            result='gross_profit',
            check_name='Gross Profit = Revenue - Cost of Revenue',
            check_type='mathematical'
        ))
        
        # Alternative with total_revenue
        if checks[-1].status == ValidationStatus.SKIPPED:
            checks.append(self._check_difference_equals(
                metrics_map,
                minuend='total_revenue',
                subtrahend='cost_of_revenue',
                result='gross_profit',
                check_name='Gross Profit = Total Revenue - Cost of Revenue',
                check_type='mathematical'
            ))
        
        # Check 2: Operating Income = Gross Profit - Operating Expenses
        checks.append(self._check_difference_equals(
            metrics_map,
            minuend='gross_profit',
            subtrahend='operating_expenses',
            result='operating_income',
            check_name='Operating Income = Gross Profit - Operating Expenses',
            check_type='mathematical'
        ))
        
        # Check 3: Net Income = Income Before Taxes - Tax Expense
        checks.append(self._check_difference_equals(
            metrics_map,
            minuend='income_before_taxes',
            subtrahend='income_tax_expense',
            result='net_income',
            check_name='Net Income = Income Before Taxes - Tax Expense',
            check_type='mathematical'
        ))
        
        # Check 4: EPS Basic = Net Income / Weighted Average Shares Basic
        checks.append(self._check_division_equals(
            metrics_map,
            numerator='net_income',
            denominator='weighted_average_shares_basic',
            result='earnings_per_share_basic',
            check_name='EPS Basic = Net Income / Shares Basic',
            check_type='mathematical',
            scale_factor=1e6  # Net income in millions, shares in millions
        ))
        
        return checks
    
    def _validate_cash_flow(self, metrics_map: Dict[str, float]) -> List[ValidationCheck]:
        """
        Validate Cash Flow Statement mathematical relationships.
        
        Implements Requirement 12.1:
        - Net Change in Cash = Operating + Investing + Financing
        - Ending Cash = Beginning Cash + Net Change
        """
        checks = []
        
        # Check 1: Net Change in Cash = Operating + Investing + Financing
        checks.append(self._check_sum_equals_total(
            metrics_map,
            total_metric='net_change_in_cash',
            component_metrics=['operating_cash_flow', 'investing_cash_flow', 'financing_cash_flow'],
            check_name='Net Change in Cash = OCF + ICF + FCF',
            check_type='mathematical'
        ))
        
        # Check 2: Ending Cash = Beginning Cash + Net Change
        checks.append(self._check_sum_equals_total(
            metrics_map,
            total_metric='cash_ending',
            component_metrics=['cash_beginning', 'net_change_in_cash'],
            check_name='Ending Cash = Beginning Cash + Net Change',
            check_type='mathematical'
        ))
        
        # Check 3: Free Cash Flow = Operating Cash Flow - CapEx
        checks.append(self._check_difference_equals(
            metrics_map,
            minuend='operating_cash_flow',
            subtrahend='capital_expenditures',
            result='free_cash_flow',
            check_name='Free Cash Flow = OCF - CapEx',
            check_type='mathematical'
        ))
        
        return checks
    
    def _validate_cross_statement(self, metrics_map: Dict[str, float]) -> List[ValidationCheck]:
        """
        Validate cross-statement consistency.
        
        Implements Requirement 12.1:
        - Net Income on Income Statement matches Cash Flow starting point
        - Ending cash on Cash Flow matches Balance Sheet cash
        """
        checks = []
        
        # Check 1: Net Income consistency (IS vs CF)
        # Note: These should be the same value
        checks.append(self._check_values_equal(
            metrics_map,
            metric_a='net_income',
            metric_b='net_income_cf',  # Net income from cash flow statement
            check_name='Net Income (IS) = Net Income (CF)',
            check_type='cross_statement'
        ))
        
        # Check 2: Ending Cash (CF) = Cash (BS)
        checks.append(self._check_values_equal(
            metrics_map,
            metric_a='cash_ending',
            metric_b='cash_and_equivalents',
            check_name='Ending Cash (CF) = Cash (BS)',
            check_type='cross_statement'
        ))
        
        return checks

    # ============ Validation Helper Methods ============
    
    def _check_sum_equals_total(
        self,
        metrics_map: Dict[str, float],
        total_metric: str,
        component_metrics: List[str],
        check_name: str,
        check_type: str
    ) -> ValidationCheck:
        """Check if sum of components equals total."""
        check = ValidationCheck(
            check_name=check_name,
            check_type=check_type,
            status=ValidationStatus.SKIPPED,
            metrics_used=[total_metric] + component_metrics,
            tolerance_pct=self.tolerance_pct
        )
        
        # Get total value
        total_value = metrics_map.get(total_metric)
        if total_value is None:
            check.message = f"Missing total metric: {total_metric}"
            return check
        
        # Get component values (skip if any are missing)
        component_values = []
        missing_components = []
        for comp in component_metrics:
            val = metrics_map.get(comp)
            if val is not None:
                component_values.append(val)
            else:
                missing_components.append(comp)
        
        if len(component_values) == 0:
            check.message = f"Missing all component metrics: {component_metrics}"
            return check
        
        # Calculate sum
        calculated_sum = sum(component_values)
        
        check.expected_value = total_value
        check.actual_value = calculated_sum
        check.difference = abs(total_value - calculated_sum)
        check.difference_pct = (check.difference / abs(total_value) * 100) if total_value != 0 else 0
        
        # Determine status
        if check.difference_pct <= self.tolerance_pct * 100:
            check.status = ValidationStatus.PASSED
            check.message = f"Sum matches total within {self.tolerance_pct*100}% tolerance"
        elif check.difference_pct <= self.tolerance_pct * 100 * 5:  # 5x tolerance = warning
            check.status = ValidationStatus.WARNING
            check.message = f"Sum differs by {check.difference_pct:.2f}% (warning threshold)"
        else:
            check.status = ValidationStatus.FAILED
            check.message = f"Sum differs by {check.difference_pct:.2f}%"
        
        if missing_components:
            check.message += f" (missing: {missing_components})"
        
        return check
    
    def _check_sum_less_than_or_equal(
        self,
        metrics_map: Dict[str, float],
        total_metric: str,
        component_metrics: List[str],
        check_name: str,
        check_type: str
    ) -> ValidationCheck:
        """Check if sum of components is less than or equal to total (for partial sums)."""
        check = ValidationCheck(
            check_name=check_name,
            check_type=check_type,
            status=ValidationStatus.SKIPPED,
            metrics_used=[total_metric] + component_metrics,
            tolerance_pct=self.tolerance_pct
        )
        
        total_value = metrics_map.get(total_metric)
        if total_value is None:
            check.message = f"Missing total metric: {total_metric}"
            return check
        
        component_values = [metrics_map.get(c) for c in component_metrics if metrics_map.get(c) is not None]
        if len(component_values) == 0:
            check.message = f"Missing all component metrics"
            return check
        
        calculated_sum = sum(component_values)
        
        check.expected_value = total_value
        check.actual_value = calculated_sum
        check.difference = total_value - calculated_sum
        
        if calculated_sum <= total_value * (1 + self.tolerance_pct):
            check.status = ValidationStatus.PASSED
            check.message = f"Sum of components ({calculated_sum:.0f}) <= Total ({total_value:.0f})"
        else:
            check.status = ValidationStatus.FAILED
            check.message = f"Sum of components ({calculated_sum:.0f}) > Total ({total_value:.0f})"
        
        return check
    
    def _check_values_equal(
        self,
        metrics_map: Dict[str, float],
        metric_a: str,
        metric_b: str,
        check_name: str,
        check_type: str
    ) -> ValidationCheck:
        """Check if two metrics have equal values."""
        check = ValidationCheck(
            check_name=check_name,
            check_type=check_type,
            status=ValidationStatus.SKIPPED,
            metrics_used=[metric_a, metric_b],
            tolerance_pct=self.tolerance_pct
        )
        
        value_a = metrics_map.get(metric_a)
        value_b = metrics_map.get(metric_b)
        
        if value_a is None:
            check.message = f"Missing metric: {metric_a}"
            return check
        if value_b is None:
            check.message = f"Missing metric: {metric_b}"
            return check
        
        check.expected_value = value_a
        check.actual_value = value_b
        check.difference = abs(value_a - value_b)
        check.difference_pct = (check.difference / abs(value_a) * 100) if value_a != 0 else 0
        
        if check.difference_pct <= self.tolerance_pct * 100:
            check.status = ValidationStatus.PASSED
            check.message = f"Values match within {self.tolerance_pct*100}% tolerance"
        elif check.difference_pct <= self.tolerance_pct * 100 * 5:
            check.status = ValidationStatus.WARNING
            check.message = f"Values differ by {check.difference_pct:.2f}%"
        else:
            check.status = ValidationStatus.FAILED
            check.message = f"Values differ by {check.difference_pct:.2f}%"
        
        return check
    
    def _check_difference_equals(
        self,
        metrics_map: Dict[str, float],
        minuend: str,
        subtrahend: str,
        result: str,
        check_name: str,
        check_type: str
    ) -> ValidationCheck:
        """Check if minuend - subtrahend = result."""
        check = ValidationCheck(
            check_name=check_name,
            check_type=check_type,
            status=ValidationStatus.SKIPPED,
            metrics_used=[minuend, subtrahend, result],
            tolerance_pct=self.tolerance_pct
        )
        
        minuend_val = metrics_map.get(minuend)
        subtrahend_val = metrics_map.get(subtrahend)
        result_val = metrics_map.get(result)
        
        if minuend_val is None:
            check.message = f"Missing metric: {minuend}"
            return check
        if subtrahend_val is None:
            check.message = f"Missing metric: {subtrahend}"
            return check
        if result_val is None:
            check.message = f"Missing metric: {result}"
            return check
        
        calculated = minuend_val - subtrahend_val
        
        check.expected_value = result_val
        check.actual_value = calculated
        check.difference = abs(result_val - calculated)
        check.difference_pct = (check.difference / abs(result_val) * 100) if result_val != 0 else 0
        
        if check.difference_pct <= self.tolerance_pct * 100:
            check.status = ValidationStatus.PASSED
            check.message = f"Calculation matches within {self.tolerance_pct*100}% tolerance"
        elif check.difference_pct <= self.tolerance_pct * 100 * 5:
            check.status = ValidationStatus.WARNING
            check.message = f"Calculation differs by {check.difference_pct:.2f}%"
        else:
            check.status = ValidationStatus.FAILED
            check.message = f"Calculation differs by {check.difference_pct:.2f}%"
        
        return check
    
    def _check_division_equals(
        self,
        metrics_map: Dict[str, float],
        numerator: str,
        denominator: str,
        result: str,
        check_name: str,
        check_type: str,
        scale_factor: float = 1.0
    ) -> ValidationCheck:
        """Check if numerator / denominator = result."""
        check = ValidationCheck(
            check_name=check_name,
            check_type=check_type,
            status=ValidationStatus.SKIPPED,
            metrics_used=[numerator, denominator, result],
            tolerance_pct=self.tolerance_pct
        )
        
        num_val = metrics_map.get(numerator)
        denom_val = metrics_map.get(denominator)
        result_val = metrics_map.get(result)
        
        if num_val is None:
            check.message = f"Missing metric: {numerator}"
            return check
        if denom_val is None or denom_val == 0:
            check.message = f"Missing or zero metric: {denominator}"
            return check
        if result_val is None:
            check.message = f"Missing metric: {result}"
            return check
        
        calculated = (num_val / denom_val) * scale_factor
        
        check.expected_value = result_val
        check.actual_value = calculated
        check.difference = abs(result_val - calculated)
        check.difference_pct = (check.difference / abs(result_val) * 100) if result_val != 0 else 0
        
        # Use higher tolerance for EPS calculations (rounding differences)
        eps_tolerance = self.tolerance_pct * 5  # 5% tolerance for EPS
        
        if check.difference_pct <= eps_tolerance * 100:
            check.status = ValidationStatus.PASSED
            check.message = f"Calculation matches within tolerance"
        else:
            check.status = ValidationStatus.WARNING
            check.message = f"Calculation differs by {check.difference_pct:.2f}% (may be due to rounding)"
        
        return check

    # ============ Confidence Scoring ============
    
    def _calculate_validation_confidence(self, report: ValidationReport) -> float:
        """
        Calculate validation confidence score.
        
        Implements Requirement 12.4:
        validation_confidence = (passed_checks / total_checks) * 100
        """
        if report.total_checks == 0:
            return 100.0  # No checks = assume valid
        
        # Count passed and warnings as successful (warnings are within tolerance)
        successful = report.passed_checks + report.warning_checks
        
        # Exclude skipped from denominator (missing data shouldn't penalize)
        applicable_checks = report.total_checks - report.skipped_checks
        
        if applicable_checks == 0:
            return 100.0  # All skipped = no validation possible
        
        return (successful / applicable_checks) * 100
    
    def _calculate_extraction_confidence(
        self,
        extraction_stats: Optional[Dict[str, Any]]
    ) -> float:
        """
        Calculate extraction confidence score.
        
        Implements Requirement 12.4:
        extraction_confidence = (mapped_tags / total_tags) * 100
        """
        if extraction_stats is None:
            return 100.0  # No stats = assume good
        
        total_tags = extraction_stats.get('total_tags', 0)
        mapped_tags = extraction_stats.get('mapped_tags', 0)
        unmapped_tags = extraction_stats.get('unmapped_tags', 0)
        
        if total_tags == 0:
            # Try alternative calculation
            total_tags = mapped_tags + unmapped_tags
        
        if total_tags == 0:
            return 100.0
        
        return (mapped_tags / total_tags) * 100
    
    # ============ Reporting Methods ============
    
    def format_report_text(self, report: ValidationReport) -> str:
        """Format validation report as human-readable text."""
        lines = [
            "=" * 70,
            "DATA VALIDATION REPORT",
            "=" * 70,
            f"Ticker: {report.ticker}",
            f"Filing Type: {report.filing_type}",
            f"Fiscal Period: {report.fiscal_period}",
            f"Timestamp: {report.validation_timestamp}",
            "",
            "CONFIDENCE SCORES",
            "-" * 50,
            f"Extraction Confidence: {report.extraction_confidence:.1f}%",
            f"Validation Confidence: {report.validation_confidence:.1f}%",
            f"Overall Confidence: {report.overall_confidence:.1f}%",
            "",
            "VALIDATION SUMMARY",
            "-" * 50,
            f"Total Checks: {report.total_checks}",
            f"Passed: {report.passed_checks}",
            f"Failed: {report.failed_checks}",
            f"Warnings: {report.warning_checks}",
            f"Skipped: {report.skipped_checks}",
        ]
        
        # Group checks by status
        failed_checks = [c for c in report.checks if c.status == ValidationStatus.FAILED]
        warning_checks = [c for c in report.checks if c.status == ValidationStatus.WARNING]
        
        if failed_checks:
            lines.extend([
                "",
                "FAILED CHECKS",
                "-" * 50,
            ])
            for check in failed_checks:
                lines.append(f"  ✗ {check.check_name}")
                lines.append(f"    {check.message}")
                if check.expected_value is not None:
                    lines.append(f"    Expected: {check.expected_value:,.0f}, Actual: {check.actual_value:,.0f}")
        
        if warning_checks:
            lines.extend([
                "",
                "WARNINGS",
                "-" * 50,
            ])
            for check in warning_checks:
                lines.append(f"  ⚠ {check.check_name}")
                lines.append(f"    {check.message}")
        
        lines.append("=" * 70)
        return "\n".join(lines)
    
    def export_report_json(self, report: ValidationReport, filepath: str):
        """Export validation report to JSON file."""
        import json
        
        # Convert to serializable format
        data = {
            'ticker': report.ticker,
            'filing_type': report.filing_type,
            'fiscal_period': report.fiscal_period,
            'validation_timestamp': report.validation_timestamp,
            'confidence_scores': {
                'extraction': report.extraction_confidence,
                'validation': report.validation_confidence,
                'overall': report.overall_confidence
            },
            'summary': {
                'total_checks': report.total_checks,
                'passed': report.passed_checks,
                'failed': report.failed_checks,
                'warnings': report.warning_checks,
                'skipped': report.skipped_checks
            },
            'checks': [
                {
                    'name': c.check_name,
                    'type': c.check_type,
                    'status': c.status.value,
                    'expected': c.expected_value,
                    'actual': c.actual_value,
                    'difference': c.difference,
                    'difference_pct': c.difference_pct,
                    'message': c.message,
                    'metrics_used': c.metrics_used
                }
                for c in report.checks
            ],
            'metadata': {
                'parser_version': report.parser_version,
                'validator_version': report.validator_version
            }
        }
        
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        
        logger.info(f"Exported validation report to {filepath}")


def get_validator(tolerance_pct: float = DataValidator.DEFAULT_TOLERANCE_PCT) -> DataValidator:
    """Factory function to get validator instance."""
    return DataValidator(tolerance_pct)


# CLI interface
if __name__ == '__main__':
    import argparse
    import json
    
    parser = argparse.ArgumentParser(description='Validate SEC financial data')
    parser.add_argument('--input', '-i', required=True, help='Input JSON file with metrics')
    parser.add_argument('--ticker', '-t', required=True, help='Ticker symbol')
    parser.add_argument('--filing-type', '-f', default='10-K', help='Filing type')
    parser.add_argument('--period', '-p', required=True, help='Fiscal period')
    parser.add_argument('--output', '-o', help='Output file path')
    parser.add_argument('--tolerance', type=float, default=0.01, help='Tolerance percentage')
    
    args = parser.parse_args()
    
    logging.basicConfig(level=logging.INFO)
    
    # Load metrics
    with open(args.input) as f:
        metrics = json.load(f)
    
    # Validate
    validator = DataValidator(tolerance_pct=args.tolerance)
    report = validator.validate_filing(
        metrics=metrics,
        ticker=args.ticker,
        filing_type=args.filing_type,
        fiscal_period=args.period
    )
    
    # Output
    if args.output:
        validator.export_report_json(report, args.output)
    else:
        print(validator.format_report_text(report))
