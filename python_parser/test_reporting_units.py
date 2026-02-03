"""
Unit tests for reporting_unit functionality in the hybrid parser.

Tests the conversion of iXBRL scale factors to human-readable reporting units.
"""

import unittest
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hybrid_parser import HybridSECParser, ExtractedMetric
from ixbrl_parser import IXBRLFact


class TestScaleToReportingUnit(unittest.TestCase):
    """Test the _scale_to_reporting_unit method"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_scale_0_returns_units(self):
        """Scale 0 should return 'units' (raw numbers)"""
        result = self.parser._scale_to_reporting_unit(0)
        self.assertEqual(result, 'units')
    
    def test_scale_3_returns_thousands(self):
        """Scale 3 should return 'thousands'"""
        result = self.parser._scale_to_reporting_unit(3)
        self.assertEqual(result, 'thousands')
    
    def test_scale_6_returns_millions(self):
        """Scale 6 should return 'millions' (most common for large companies)"""
        result = self.parser._scale_to_reporting_unit(6)
        self.assertEqual(result, 'millions')
    
    def test_scale_9_returns_billions(self):
        """Scale 9 should return 'billions'"""
        result = self.parser._scale_to_reporting_unit(9)
        self.assertEqual(result, 'billions')
    
    def test_scale_12_returns_trillions(self):
        """Scale 12 should return 'trillions'"""
        result = self.parser._scale_to_reporting_unit(12)
        self.assertEqual(result, 'trillions')
    
    def test_scale_negative_3_returns_thousandths(self):
        """Scale -3 should return 'thousandths'"""
        result = self.parser._scale_to_reporting_unit(-3)
        self.assertEqual(result, 'thousandths')
    
    def test_scale_negative_6_returns_millionths(self):
        """Scale -6 should return 'millionths'"""
        result = self.parser._scale_to_reporting_unit(-6)
        self.assertEqual(result, 'millionths')
    
    def test_unknown_scale_returns_units(self):
        """Unknown scale values should default to 'units'"""
        result = self.parser._scale_to_reporting_unit(99)
        self.assertEqual(result, 'units')
        
        result = self.parser._scale_to_reporting_unit(-99)
        self.assertEqual(result, 'units')


class TestExtractedMetricReportingUnit(unittest.TestCase):
    """Test that ExtractedMetric includes reporting_unit field"""
    
    def test_extracted_metric_has_reporting_unit_field(self):
        """ExtractedMetric should have reporting_unit field with default 'units'"""
        metric = ExtractedMetric(
            ticker='AAPL',
            normalized_metric='revenue',
            raw_label='us-gaap:Revenues',
            value=383285000000.0,
            fiscal_period='FY2023',
            period_type='annual',
            filing_type='10-K',
            statement_type='income_statement',
            confidence_score=0.95,
            source='ixbrl',
        )
        self.assertEqual(metric.reporting_unit, 'units')
    
    def test_extracted_metric_with_custom_reporting_unit(self):
        """ExtractedMetric should accept custom reporting_unit"""
        metric = ExtractedMetric(
            ticker='AAPL',
            normalized_metric='revenue',
            raw_label='us-gaap:Revenues',
            value=383285000000.0,
            fiscal_period='FY2023',
            period_type='annual',
            filing_type='10-K',
            statement_type='income_statement',
            confidence_score=0.95,
            source='ixbrl',
            reporting_unit='millions',
        )
        self.assertEqual(metric.reporting_unit, 'millions')


class TestConvertIxbrlToMetrics(unittest.TestCase):
    """Test that _convert_ixbrl_to_metrics properly sets reporting_unit"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_converts_scale_6_to_millions(self):
        """Facts with scale=6 should have reporting_unit='millions'"""
        fact = IXBRLFact(
            name='us-gaap:Revenues',
            value=383285000000.0,  # Already scaled to full precision
            raw_value='383,285',
            context_ref='FY2023',
            unit_ref='USD',
            decimals=-6,
            scale=6,  # Original scale was millions
            sign=1,
            format=None,
            fiscal_period='FY2023',
            period_type='duration',
        )
        
        metrics = self.parser._convert_ixbrl_to_metrics([fact], 'AAPL', '10-K')
        
        self.assertEqual(len(metrics), 1)
        self.assertEqual(metrics[0].reporting_unit, 'millions')
        self.assertEqual(metrics[0].value, 383285000000.0)
    
    def test_converts_scale_3_to_thousands(self):
        """Facts with scale=3 should have reporting_unit='thousands'"""
        fact = IXBRLFact(
            name='us-gaap:Revenues',
            value=5000000.0,  # Already scaled
            raw_value='5,000',
            context_ref='FY2023',
            unit_ref='USD',
            decimals=-3,
            scale=3,  # Original scale was thousands
            sign=1,
            format=None,
            fiscal_period='FY2023',
            period_type='duration',
        )
        
        metrics = self.parser._convert_ixbrl_to_metrics([fact], 'SMALL', '10-K')
        
        self.assertEqual(len(metrics), 1)
        self.assertEqual(metrics[0].reporting_unit, 'thousands')
    
    def test_converts_scale_0_to_units(self):
        """Facts with scale=0 should have reporting_unit='units'"""
        fact = IXBRLFact(
            name='us-gaap:EarningsPerShareBasic',
            value=6.13,  # EPS is always in units
            raw_value='6.13',
            context_ref='FY2023',
            unit_ref='USD/shares',
            decimals=2,
            scale=0,  # No scaling
            sign=1,
            format=None,
            fiscal_period='FY2023',
            period_type='duration',
        )
        
        metrics = self.parser._convert_ixbrl_to_metrics([fact], 'AAPL', '10-K')
        
        self.assertEqual(len(metrics), 1)
        self.assertEqual(metrics[0].reporting_unit, 'units')
        self.assertEqual(metrics[0].value, 6.13)


class TestReportingUnitInAsdict(unittest.TestCase):
    """Test that reporting_unit is included when converting to dict"""
    
    def test_asdict_includes_reporting_unit(self):
        """asdict() should include reporting_unit field"""
        from dataclasses import asdict
        
        metric = ExtractedMetric(
            ticker='AAPL',
            normalized_metric='revenue',
            raw_label='us-gaap:Revenues',
            value=383285000000.0,
            fiscal_period='FY2023',
            period_type='annual',
            filing_type='10-K',
            statement_type='income_statement',
            confidence_score=0.95,
            source='ixbrl',
            reporting_unit='millions',
        )
        
        result = asdict(metric)
        
        self.assertIn('reporting_unit', result)
        self.assertEqual(result['reporting_unit'], 'millions')


if __name__ == '__main__':
    unittest.main()
