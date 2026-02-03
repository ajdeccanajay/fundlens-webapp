"""
Unit tests for ReportingUnitExtractor.

Tests the extraction of reporting units from SEC filing headers and table headers,
as well as the get_unit_for_metric() method for determining correct units per metric type.
"""

import unittest
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reporting_unit_extractor import (
    ReportingUnitExtractor,
    ReportingUnitInfo,
    get_extractor,
)


class TestReportingUnitInfo(unittest.TestCase):
    """Test the ReportingUnitInfo dataclass"""
    
    def test_default_values(self):
        """ReportingUnitInfo should have sensible defaults"""
        info = ReportingUnitInfo()
        self.assertEqual(info.default_unit, 'units')
        self.assertEqual(info.share_unit, 'units')
        self.assertEqual(info.per_share_unit, 'units')
        self.assertEqual(info.source, 'default')
    
    def test_custom_values(self):
        """ReportingUnitInfo should accept custom values"""
        info = ReportingUnitInfo(
            default_unit='millions',
            share_unit='thousands',
            per_share_unit='units',
            source='header',
        )
        self.assertEqual(info.default_unit, 'millions')
        self.assertEqual(info.share_unit, 'thousands')
        self.assertEqual(info.per_share_unit, 'units')
        self.assertEqual(info.source, 'header')


class TestNormalizeUnit(unittest.TestCase):
    """Test the _normalize_unit method"""
    
    def setUp(self):
        self.extractor = ReportingUnitExtractor()
    
    def test_normalize_millions(self):
        """Should normalize various forms of 'millions'"""
        self.assertEqual(self.extractor._normalize_unit('millions'), 'millions')
        self.assertEqual(self.extractor._normalize_unit('million'), 'millions')
        self.assertEqual(self.extractor._normalize_unit('Millions'), 'millions')
        self.assertEqual(self.extractor._normalize_unit('MILLIONS'), 'millions')
    
    def test_normalize_thousands(self):
        """Should normalize various forms of 'thousands'"""
        self.assertEqual(self.extractor._normalize_unit('thousands'), 'thousands')
        self.assertEqual(self.extractor._normalize_unit('thousand'), 'thousands')
        self.assertEqual(self.extractor._normalize_unit('Thousands'), 'thousands')
    
    def test_normalize_billions(self):
        """Should normalize various forms of 'billions'"""
        self.assertEqual(self.extractor._normalize_unit('billions'), 'billions')
        self.assertEqual(self.extractor._normalize_unit('billion'), 'billions')
        self.assertEqual(self.extractor._normalize_unit('Billions'), 'billions')
    
    def test_normalize_units(self):
        """Should normalize 'units' and handle empty/None"""
        self.assertEqual(self.extractor._normalize_unit('units'), 'units')
        self.assertEqual(self.extractor._normalize_unit('unit'), 'units')
        self.assertEqual(self.extractor._normalize_unit(''), 'units')
        self.assertEqual(self.extractor._normalize_unit(None), 'units')


class TestExtractFromFiling(unittest.TestCase):
    """Test the extract_from_filing method"""
    
    def setUp(self):
        self.extractor = ReportingUnitExtractor()
    
    def test_simple_millions_pattern(self):
        """Should extract 'millions' from simple pattern"""
        html = """
        <html>
        <body>
            <div>CONSOLIDATED STATEMENTS OF INCOME</div>
            <div>(In millions, except per-share amounts)</div>
            <table>
                <tr><td>Revenue</td><td>383,285</td></tr>
            </table>
        </body>
        </html>
        """
        result = self.extractor.extract_from_filing(html)
        self.assertEqual(result.default_unit, 'millions')
        self.assertEqual(result.per_share_unit, 'units')
    
    def test_millions_with_share_exception(self):
        """Should extract 'millions' with 'thousands' for shares"""
        html = """
        <html>
        <body>
            <div>CONSOLIDATED STATEMENTS OF INCOME</div>
            <div>(In millions, except number of shares, which are reflected in thousands, and per-share amounts)</div>
            <table>
                <tr><td>Revenue</td><td>383,285</td></tr>
            </table>
        </body>
        </html>
        """
        result = self.extractor.extract_from_filing(html)
        self.assertEqual(result.default_unit, 'millions')
        self.assertEqual(result.share_unit, 'thousands')
        self.assertEqual(result.per_share_unit, 'units')
    
    def test_dollars_in_millions(self):
        """Should extract from 'Dollars in millions' pattern"""
        html = """
        <html>
        <body>
            <div>(Dollars in millions)</div>
            <table>
                <tr><td>Revenue</td><td>100,000</td></tr>
            </table>
        </body>
        </html>
        """
        result = self.extractor.extract_from_filing(html)
        self.assertEqual(result.default_unit, 'millions')
    
    def test_table_header_pattern(self):
        """Should extract from table header '$in millions'"""
        html = """
        <html>
        <body>
            <table>
                <thead>
                    <tr><th>Item</th><th>$in millions</th></tr>
                </thead>
                <tr><td>Revenue</td><td>100,000</td></tr>
            </table>
        </body>
        </html>
        """
        result = self.extractor.extract_from_filing(html)
        self.assertEqual(result.default_unit, 'millions')
    
    def test_thousands_pattern(self):
        """Should extract 'thousands' from pattern"""
        html = """
        <html>
        <body>
            <div>(In thousands)</div>
            <table>
                <tr><td>Revenue</td><td>5,000</td></tr>
            </table>
        </body>
        </html>
        """
        result = self.extractor.extract_from_filing(html)
        self.assertEqual(result.default_unit, 'thousands')
    
    def test_billions_pattern(self):
        """Should extract 'billions' from pattern"""
        html = """
        <html>
        <body>
            <div>(In billions)</div>
            <table>
                <tr><td>Revenue</td><td>383</td></tr>
            </table>
        </body>
        </html>
        """
        result = self.extractor.extract_from_filing(html)
        self.assertEqual(result.default_unit, 'billions')
    
    def test_no_unit_found_defaults_to_units(self):
        """Should default to 'units' when no pattern found"""
        html = """
        <html>
        <body>
            <table>
                <tr><td>Revenue</td><td>383285000000</td></tr>
            </table>
        </body>
        </html>
        """
        result = self.extractor.extract_from_filing(html)
        self.assertEqual(result.default_unit, 'units')
        self.assertEqual(result.source, 'default')
    
    def test_empty_html_defaults_to_units(self):
        """Should default to 'units' for empty HTML"""
        result = self.extractor.extract_from_filing('')
        self.assertEqual(result.default_unit, 'units')
        self.assertEqual(result.source, 'default')
    
    def test_none_html_defaults_to_units(self):
        """Should default to 'units' for None HTML"""
        result = self.extractor.extract_from_filing(None)
        self.assertEqual(result.default_unit, 'units')
        self.assertEqual(result.source, 'default')


class TestExtractFromTableHeader(unittest.TestCase):
    """Test the extract_from_table_header method"""
    
    def setUp(self):
        self.extractor = ReportingUnitExtractor()
    
    def test_extract_from_caption(self):
        """Should extract from table caption - returns unit string"""
        from bs4 import BeautifulSoup
        html = """
        <table>
            <caption>(In millions)</caption>
            <tr><td>Revenue</td><td>100</td></tr>
        </table>
        """
        soup = BeautifulSoup(html, 'lxml')
        table = soup.find('table')
        
        result = self.extractor.extract_from_table_header(table)
        self.assertIsNotNone(result)
        self.assertEqual(result, 'millions')
    
    def test_extract_from_thead(self):
        """Should extract from thead - returns unit string"""
        from bs4 import BeautifulSoup
        html = """
        <table>
            <thead>
                <tr><th>Item</th><th>($ in thousands)</th></tr>
            </thead>
            <tr><td>Revenue</td><td>100</td></tr>
        </table>
        """
        soup = BeautifulSoup(html, 'lxml')
        table = soup.find('table')
        
        result = self.extractor.extract_from_table_header(table)
        self.assertIsNotNone(result)
        self.assertEqual(result, 'thousands')
    
    def test_none_table_returns_none(self):
        """Should return None for None table"""
        result = self.extractor.extract_from_table_header(None)
        self.assertIsNone(result)


class TestGetUnitForMetric(unittest.TestCase):
    """Test the get_unit_for_metric method"""
    
    def setUp(self):
        self.extractor = ReportingUnitExtractor()
        self.unit_info = ReportingUnitInfo(
            default_unit='millions',
            share_unit='thousands',
            per_share_unit='units',
            source='header',
        )
    
    def test_revenue_uses_default_unit(self):
        """Revenue should use default unit (millions)"""
        result = self.extractor.get_unit_for_metric('revenue', self.unit_info)
        self.assertEqual(result, 'millions')
    
    def test_net_income_uses_default_unit(self):
        """Net income should use default unit (millions)"""
        result = self.extractor.get_unit_for_metric('net_income', self.unit_info)
        self.assertEqual(result, 'millions')
    
    def test_total_assets_uses_default_unit(self):
        """Total assets should use default unit (millions)"""
        result = self.extractor.get_unit_for_metric('total_assets', self.unit_info)
        self.assertEqual(result, 'millions')
    
    def test_eps_uses_per_share_unit(self):
        """EPS should use per-share unit (units)"""
        result = self.extractor.get_unit_for_metric('earnings_per_share_basic', self.unit_info)
        self.assertEqual(result, 'units')
    
    def test_diluted_eps_uses_per_share_unit(self):
        """Diluted EPS should use per-share unit (units)"""
        result = self.extractor.get_unit_for_metric('earnings_per_share_diluted', self.unit_info)
        self.assertEqual(result, 'units')
    
    def test_dividend_per_share_uses_per_share_unit(self):
        """Dividend per share should use per-share unit (units)"""
        result = self.extractor.get_unit_for_metric('dividend_per_share', self.unit_info)
        self.assertEqual(result, 'units')
    
    def test_weighted_average_shares_uses_share_unit(self):
        """Weighted average shares should use share unit (thousands)"""
        result = self.extractor.get_unit_for_metric('weighted_average_shares_basic', self.unit_info)
        self.assertEqual(result, 'thousands')
    
    def test_diluted_shares_uses_share_unit(self):
        """Diluted shares should use share unit (thousands)"""
        result = self.extractor.get_unit_for_metric('weighted_average_shares_diluted', self.unit_info)
        self.assertEqual(result, 'thousands')
    
    def test_shares_outstanding_uses_share_unit(self):
        """Shares outstanding should use share unit (thousands)"""
        result = self.extractor.get_unit_for_metric('shares_outstanding', self.unit_info)
        self.assertEqual(result, 'thousands')
    
    def test_common_shares_uses_share_unit(self):
        """Common shares should use share unit (thousands)"""
        result = self.extractor.get_unit_for_metric('common_shares', self.unit_info)
        self.assertEqual(result, 'thousands')
    
    def test_empty_metric_uses_default_unit(self):
        """Empty metric name should use default unit"""
        result = self.extractor.get_unit_for_metric('', self.unit_info)
        self.assertEqual(result, 'millions')
    
    def test_none_metric_uses_default_unit(self):
        """None metric name should use default unit"""
        result = self.extractor.get_unit_for_metric(None, self.unit_info)
        self.assertEqual(result, 'millions')


class TestScaleToUnit(unittest.TestCase):
    """Test the scale_to_unit utility method"""
    
    def setUp(self):
        self.extractor = ReportingUnitExtractor()
    
    def test_scale_0_returns_units(self):
        """Scale 0 should return 'units'"""
        self.assertEqual(self.extractor.scale_to_unit(0), 'units')
    
    def test_scale_3_returns_thousands(self):
        """Scale 3 should return 'thousands'"""
        self.assertEqual(self.extractor.scale_to_unit(3), 'thousands')
    
    def test_scale_6_returns_millions(self):
        """Scale 6 should return 'millions'"""
        self.assertEqual(self.extractor.scale_to_unit(6), 'millions')
    
    def test_scale_9_returns_billions(self):
        """Scale 9 should return 'billions'"""
        self.assertEqual(self.extractor.scale_to_unit(9), 'billions')
    
    def test_scale_12_returns_trillions(self):
        """Scale 12 should return 'trillions'"""
        self.assertEqual(self.extractor.scale_to_unit(12), 'trillions')
    
    def test_unknown_scale_returns_units(self):
        """Unknown scale should return 'units'"""
        self.assertEqual(self.extractor.scale_to_unit(99), 'units')


class TestGetExtractor(unittest.TestCase):
    """Test the singleton get_extractor function"""
    
    def test_returns_extractor_instance(self):
        """Should return a ReportingUnitExtractor instance"""
        extractor = get_extractor()
        self.assertIsInstance(extractor, ReportingUnitExtractor)
    
    def test_returns_same_instance(self):
        """Should return the same instance on multiple calls"""
        extractor1 = get_extractor()
        extractor2 = get_extractor()
        self.assertIs(extractor1, extractor2)


class TestRealWorldPatterns(unittest.TestCase):
    """Test with real-world SEC filing patterns"""
    
    def setUp(self):
        self.extractor = ReportingUnitExtractor()
    
    def test_apple_pattern(self):
        """Test Apple-style unit header"""
        html = """
        <html>
        <body>
            <div>APPLE INC.</div>
            <div>CONSOLIDATED STATEMENTS OF OPERATIONS</div>
            <div>(In millions, except number of shares which are reflected in thousands and per share amounts)</div>
        </body>
        </html>
        """
        result = self.extractor.extract_from_filing(html)
        self.assertEqual(result.default_unit, 'millions')
        self.assertEqual(result.share_unit, 'thousands')
        self.assertEqual(result.per_share_unit, 'units')
    
    def test_comcast_pattern(self):
        """Test Comcast-style unit header"""
        html = """
        <html>
        <body>
            <div>COMCAST CORPORATION</div>
            <div>CONSOLIDATED STATEMENT OF INCOME</div>
            <div>(in millions, except per share data)</div>
        </body>
        </html>
        """
        result = self.extractor.extract_from_filing(html)
        self.assertEqual(result.default_unit, 'millions')
        self.assertEqual(result.per_share_unit, 'units')
    
    def test_jpmorgan_pattern(self):
        """Test JPMorgan-style unit header"""
        html = """
        <html>
        <body>
            <div>JPMORGAN CHASE & CO.</div>
            <div>CONSOLIDATED STATEMENTS OF INCOME</div>
            <div>(in millions, except per share and ratio data)</div>
        </body>
        </html>
        """
        result = self.extractor.extract_from_filing(html)
        self.assertEqual(result.default_unit, 'millions')
    
    def test_small_company_thousands(self):
        """Test small company with thousands"""
        html = """
        <html>
        <body>
            <div>SMALL COMPANY INC.</div>
            <div>CONSOLIDATED BALANCE SHEET</div>
            <div>(Amounts in thousands)</div>
        </body>
        </html>
        """
        result = self.extractor.extract_from_filing(html)
        self.assertEqual(result.default_unit, 'thousands')


if __name__ == '__main__':
    unittest.main()
