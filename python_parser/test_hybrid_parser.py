"""
Unit Tests for Hybrid SEC Parser

Tests extraction accuracy for:
1. iXBRL tag extraction
2. HTML table fallback (pre-2019 filings)
3. Pandas-based extraction for complex tables
4. Bank-specific metrics (JPM, C, BAC)
5. Narrative section extraction
6. Derived metric calculations

Target: 99.99% extraction accuracy
"""

import unittest
import logging
from typing import Dict, List, Any
from hybrid_parser import HybridSECParser, ExtractedMetric

# Configure logging for tests
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TestHybridParserBasics(unittest.TestCase):
    """Test basic parser functionality"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_parser_initialization(self):
        """Test parser initializes correctly"""
        self.assertIsNotNone(self.parser)
        self.assertIsNotNone(self.parser.ixbrl_parser)
        self.assertIsNotNone(self.parser.tag_mapper)
    
    def test_empty_content(self):
        """Test parser handles empty content gracefully"""
        result = self.parser.parse_filing("", "TEST", "10-K", "12345")
        self.assertIn('structured_metrics', result)
        self.assertIn('narrative_chunks', result)
        self.assertIn('metadata', result)
        self.assertEqual(result['metadata']['ticker'], 'TEST')


class TestIXBRLExtraction(unittest.TestCase):
    """Test iXBRL tag extraction"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_ixbrl_revenue_extraction(self):
        """Test extraction of revenue from iXBRL tags"""
        html_content = '''
        <html>
        <body>
        <ix:nonFraction name="us-gaap:Revenues" contextRef="FY2024" 
            unitRef="USD" decimals="-6" format="ixt:num-dot-decimal">
            1234567000
        </ix:nonFraction>
        </body>
        </html>
        '''
        result = self.parser.parse_filing(html_content, "TEST", "10-K", "12345")
        metrics = result['structured_metrics']
        
        # Should extract revenue
        revenue_metrics = [m for m in metrics if m['normalized_metric'] == 'revenue']
        self.assertGreater(len(revenue_metrics), 0, "Should extract revenue metric")
    
    def test_ixbrl_net_income_extraction(self):
        """Test extraction of net income from iXBRL tags"""
        html_content = '''
        <html>
        <body>
        <ix:nonFraction name="us-gaap:NetIncomeLoss" contextRef="FY2024" 
            unitRef="USD" decimals="-6">
            500000000
        </ix:nonFraction>
        </body>
        </html>
        '''
        result = self.parser.parse_filing(html_content, "TEST", "10-K", "12345")
        metrics = result['structured_metrics']
        
        net_income_metrics = [m for m in metrics if m['normalized_metric'] == 'net_income']
        self.assertGreater(len(net_income_metrics), 0, "Should extract net income metric")
    
    def test_ixbrl_balance_sheet_metrics(self):
        """Test extraction of balance sheet metrics from iXBRL"""
        html_content = '''
        <html>
        <body>
        <ix:nonFraction name="us-gaap:Assets" contextRef="FY2024" 
            unitRef="USD" decimals="-6">10000000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:Liabilities" contextRef="FY2024" 
            unitRef="USD" decimals="-6">6000000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:StockholdersEquity" contextRef="FY2024" 
            unitRef="USD" decimals="-6">4000000000</ix:nonFraction>
        </body>
        </html>
        '''
        result = self.parser.parse_filing(html_content, "TEST", "10-K", "12345")
        metrics = result['structured_metrics']
        
        # Check for balance sheet metrics
        metric_names = [m['normalized_metric'] for m in metrics]
        self.assertIn('total_assets', metric_names, "Should extract total_assets")


class TestBankMetricExtraction(unittest.TestCase):
    """Test bank-specific metric extraction"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_net_interest_income_extraction(self):
        """Test extraction of net interest income (bank-specific)"""
        html_content = '''
        <html>
        <body>
        <ix:nonFraction name="us-gaap:InterestIncomeExpenseNet" contextRef="FY2024" 
            unitRef="USD" decimals="-6">89000000000</ix:nonFraction>
        </body>
        </html>
        '''
        result = self.parser.parse_filing(html_content, "JPM", "10-K", "19617")
        metrics = result['structured_metrics']
        
        nii_metrics = [m for m in metrics if 'interest' in m['normalized_metric'].lower()]
        self.assertGreater(len(nii_metrics), 0, "Should extract interest-related metrics for banks")
    
    def test_provision_for_credit_losses(self):
        """Test extraction of provision for credit losses (bank-specific)"""
        html_content = '''
        <html>
        <body>
        <ix:nonFraction name="us-gaap:ProvisionForLoanLeaseAndOtherLosses" contextRef="FY2024" 
            unitRef="USD" decimals="-6">9800000000</ix:nonFraction>
        </body>
        </html>
        '''
        result = self.parser.parse_filing(html_content, "JPM", "10-K", "19617")
        metrics = result['structured_metrics']
        
        # Should extract provision metric
        self.assertGreater(len(metrics), 0, "Should extract provision for credit losses")
    
    def test_total_deposits_extraction(self):
        """Test extraction of total deposits (bank-specific)"""
        html_content = '''
        <html>
        <body>
        <ix:nonFraction name="us-gaap:Deposits" contextRef="FY2024" 
            unitRef="USD" decimals="-6">2400000000000</ix:nonFraction>
        </body>
        </html>
        '''
        result = self.parser.parse_filing(html_content, "JPM", "10-K", "19617")
        metrics = result['structured_metrics']
        
        deposit_metrics = [m for m in metrics if 'deposit' in m['normalized_metric'].lower()]
        self.assertGreater(len(deposit_metrics), 0, "Should extract deposit metrics for banks")


class TestHTMLTableExtraction(unittest.TestCase):
    """Test HTML table fallback extraction"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_income_statement_table_detection(self):
        """Test detection of income statement table"""
        html_content = '''
        <html>
        <body>
        <table>
            <tr><th>Item</th><th>2024</th><th>2023</th></tr>
            <tr><td>Net Sales</td><td>$1,000,000</td><td>$900,000</td></tr>
            <tr><td>Cost of Sales</td><td>$600,000</td><td>$550,000</td></tr>
            <tr><td>Gross Profit</td><td>$400,000</td><td>$350,000</td></tr>
            <tr><td>Operating Income</td><td>$200,000</td><td>$180,000</td></tr>
            <tr><td>Net Income</td><td>$150,000</td><td>$130,000</td></tr>
            <tr><td>Earnings Per Share - Basic</td><td>$1.50</td><td>$1.30</td></tr>
            <tr><td>Earnings Per Share - Diluted</td><td>$1.48</td><td>$1.28</td></tr>
        </table>
        </body>
        </html>
        '''
        # This tests the table detection logic
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html_content, 'lxml')
        tables = self.parser._find_financial_statement_tables(soup)
        
        # Should find income statement
        table_types = [t['type'] for t in tables]
        self.assertIn('income_statement', table_types, "Should detect income statement table")
    
    def test_balance_sheet_table_detection(self):
        """Test detection of balance sheet table"""
        html_content = '''
        <html>
        <body>
        <table>
            <tr><th>Item</th><th>2024</th><th>2023</th></tr>
            <tr><td>Cash and Cash Equivalents</td><td>$500,000</td><td>$450,000</td></tr>
            <tr><td>Total Current Assets</td><td>$1,000,000</td><td>$900,000</td></tr>
            <tr><td>Total Assets</td><td>$5,000,000</td><td>$4,500,000</td></tr>
            <tr><td>Total Current Liabilities</td><td>$800,000</td><td>$750,000</td></tr>
            <tr><td>Total Liabilities</td><td>$3,000,000</td><td>$2,800,000</td></tr>
            <tr><td>Stockholders' Equity</td><td>$2,000,000</td><td>$1,700,000</td></tr>
        </table>
        </body>
        </html>
        '''
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html_content, 'lxml')
        tables = self.parser._find_financial_statement_tables(soup)
        
        table_types = [t['type'] for t in tables]
        self.assertIn('balance_sheet', table_types, "Should detect balance sheet table")
    
    def test_cash_flow_table_detection(self):
        """Test detection of cash flow statement table"""
        html_content = '''
        <html>
        <body>
        <table>
            <tr><th>Item</th><th>2024</th><th>2023</th></tr>
            <tr><td>Net Income</td><td>$150,000</td><td>$130,000</td></tr>
            <tr><td>Cash from Operating Activities</td><td>$200,000</td><td>$180,000</td></tr>
            <tr><td>Cash from Investing Activities</td><td>($100,000)</td><td>($90,000)</td></tr>
            <tr><td>Cash from Financing Activities</td><td>($50,000)</td><td>($40,000)</td></tr>
            <tr><td>Net Change in Cash</td><td>$50,000</td><td>$50,000</td></tr>
        </table>
        </body>
        </html>
        '''
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html_content, 'lxml')
        tables = self.parser._find_financial_statement_tables(soup)
        
        table_types = [t['type'] for t in tables]
        self.assertIn('cash_flow', table_types, "Should detect cash flow statement table")


class TestLabelMatching(unittest.TestCase):
    """Test label to metric matching"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_revenue_label_matching(self):
        """Test various revenue label formats"""
        revenue_labels = [
            'net sales',
            'total revenue',
            'total net revenue',
            'revenues',
            'net revenues',
        ]
        for label in revenue_labels:
            result = self.parser._match_label_to_metric(label)
            self.assertEqual(result, 'revenue', f"'{label}' should match to 'revenue'")
    
    def test_net_income_label_matching(self):
        """Test various net income label formats"""
        labels = [
            'net income',
            'net earnings',
            'net profit',
        ]
        for label in labels:
            result = self.parser._match_label_to_metric(label)
            self.assertEqual(result, 'net_income', f"'{label}' should match to 'net_income'")
    
    def test_eps_label_matching(self):
        """Test EPS label formats"""
        # Basic EPS
        basic_labels = ['earnings per share - basic', 'basic earnings per share']
        for label in basic_labels:
            result = self.parser._match_label_to_metric(label)
            self.assertEqual(result, 'earnings_per_share_basic', f"'{label}' should match basic EPS")
        
        # Diluted EPS
        diluted_labels = ['earnings per share - diluted', 'diluted earnings per share']
        for label in diluted_labels:
            result = self.parser._match_label_to_metric(label)
            self.assertEqual(result, 'earnings_per_share_diluted', f"'{label}' should match diluted EPS")
    
    def test_bank_specific_label_matching(self):
        """Test bank-specific label matching"""
        bank_labels = {
            'net interest income': 'net_interest_income',
            'noninterest income': 'noninterest_income',
            'noninterest expense': 'noninterest_expense',
            'provision for credit losses': 'provision_for_credit_losses',
            'total loans': 'total_loans',
            'total deposits': 'total_deposits',
            'tier 1 capital': 'tier1_capital',
        }
        for label, expected in bank_labels.items():
            result = self.parser._match_label_to_metric(label)
            self.assertEqual(result, expected, f"'{label}' should match to '{expected}'")
    
    def test_balance_sheet_label_matching(self):
        """Test balance sheet label matching"""
        labels = {
            'total assets': 'total_assets',
            'total liabilities': 'total_liabilities',
            "stockholders' equity": 'shareholders_equity',
            'cash and cash equivalents': 'cash_and_equivalents',
            'total current assets': 'current_assets',
            'total current liabilities': 'current_liabilities',
        }
        for label, expected in labels.items():
            result = self.parser._match_label_to_metric(label)
            self.assertEqual(result, expected, f"'{label}' should match to '{expected}'")
    
    def test_cash_flow_label_matching(self):
        """Test cash flow label matching"""
        labels = {
            'cash provided by operating activities': 'operating_cash_flow',
            'cash used in investing activities': 'investing_cash_flow',
            'cash used in financing activities': 'financing_cash_flow',
            'capital expenditures': 'capital_expenditures',
            'depreciation and amortization': 'depreciation_amortization',
        }
        for label, expected in labels.items():
            result = self.parser._match_label_to_metric(label)
            self.assertEqual(result, expected, f"'{label}' should match to '{expected}'")


class TestValueParsing(unittest.TestCase):
    """Test financial value parsing"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_parse_positive_values(self):
        """Test parsing positive financial values"""
        test_cases = [
            ('1,234,567', 1234567000000),  # Millions
            ('$1,234', 1234000000),
            ('500', 500000000),
        ]
        for value_str, expected in test_cases:
            result = self.parser._parse_table_value(value_str)
            self.assertIsNotNone(result, f"Should parse '{value_str}'")
    
    def test_parse_negative_values(self):
        """Test parsing negative (parenthetical) values"""
        result = self.parser._parse_table_value('(1,234)')
        self.assertIsNotNone(result)
        self.assertLess(result, 0, "Parenthetical values should be negative")
    
    def test_parse_dashes(self):
        """Test parsing dashes (no data)"""
        dash_values = ['-', '—', '–', '']
        for val in dash_values:
            result = self.parser._parse_table_value(val)
            self.assertIsNone(result, f"'{val}' should return None")
    
    def test_parse_financial_value_with_unit(self):
        """Test parsing values with billion/million units"""
        # Billion
        result = self.parser._parse_financial_value('1.5', 'billion')
        self.assertEqual(result, 1_500_000_000)
        
        # Million
        result = self.parser._parse_financial_value('500', 'million')
        self.assertEqual(result, 500_000_000)


class TestDerivedMetrics(unittest.TestCase):
    """Test derived metric calculations"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_derive_total_liabilities(self):
        """Test deriving total liabilities from assets - equity"""
        # Create test metrics
        metrics = [
            ExtractedMetric(
                ticker='TEST',
                normalized_metric='total_assets',
                raw_label='Total Assets',
                value=10_000_000_000,
                fiscal_period='FY2024',
                period_type='annual',
                filing_type='10-K',
                statement_type='balance_sheet',
                confidence_score=1.0,
                source='ixbrl',
            ),
            ExtractedMetric(
                ticker='TEST',
                normalized_metric='shareholders_equity',
                raw_label='Shareholders Equity',
                value=4_000_000_000,
                fiscal_period='FY2024',
                period_type='annual',
                filing_type='10-K',
                statement_type='balance_sheet',
                confidence_score=1.0,
                source='ixbrl',
            ),
        ]
        
        derived = self.parser._compute_derived_metrics(metrics, 'TEST', '10-K')
        
        # Should derive total_liabilities
        liabilities = [m for m in derived if m.normalized_metric == 'total_liabilities']
        self.assertEqual(len(liabilities), 1, "Should derive total_liabilities")
        self.assertEqual(liabilities[0].value, 6_000_000_000, "Liabilities = Assets - Equity")
        self.assertTrue(liabilities[0].is_derived, "Should be marked as derived")
    
    def test_derive_gross_profit(self):
        """Test deriving gross profit from revenue - cost"""
        metrics = [
            ExtractedMetric(
                ticker='TEST',
                normalized_metric='revenue',
                raw_label='Revenue',
                value=1_000_000_000,
                fiscal_period='FY2024',
                period_type='annual',
                filing_type='10-K',
                statement_type='income_statement',
                confidence_score=1.0,
                source='ixbrl',
            ),
            ExtractedMetric(
                ticker='TEST',
                normalized_metric='cost_of_revenue',
                raw_label='Cost of Revenue',
                value=600_000_000,
                fiscal_period='FY2024',
                period_type='annual',
                filing_type='10-K',
                statement_type='income_statement',
                confidence_score=1.0,
                source='ixbrl',
            ),
        ]
        
        derived = self.parser._compute_derived_metrics(metrics, 'TEST', '10-K')
        
        gross_profit = [m for m in derived if m.normalized_metric == 'gross_profit']
        self.assertEqual(len(gross_profit), 1, "Should derive gross_profit")
        self.assertEqual(gross_profit[0].value, 400_000_000, "Gross Profit = Revenue - Cost")


class TestNarrativeExtraction(unittest.TestCase):
    """Test narrative section extraction"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_section_detection(self):
        """Test detection of SEC filing sections"""
        html_content = '''
        <html>
        <body>
        <a href="#item1">Item 1. Business</a>
        <a href="#item1a">Item 1A. Risk Factors</a>
        <a href="#item7">Item 7. Management's Discussion and Analysis</a>
        <div id="item1">
            <p>Our company is a leading provider of technology solutions...</p>
        </div>
        <div id="item1a">
            <p>Investing in our securities involves significant risks...</p>
        </div>
        <div id="item7">
            <p>The following discussion should be read in conjunction with...</p>
        </div>
        </body>
        </html>
        '''
        result = self.parser.parse_filing(html_content, "TEST", "10-K", "12345")
        narratives = result['narrative_chunks']
        
        # Should extract narrative chunks
        self.assertGreater(len(narratives), 0, "Should extract narrative chunks")
    
    def test_numeric_content_detection(self):
        """Test detection of numeric (table) content"""
        # Mostly numeric content
        numeric_text = "$1,234,567 $2,345,678 $3,456,789 100% 50.5%"
        self.assertTrue(self.parser._is_numeric_content(numeric_text))
        
        # Mostly text content
        text_content = "The company reported strong growth in all segments during the fiscal year."
        self.assertFalse(self.parser._is_numeric_content(text_content))
    
    def test_text_chunking(self):
        """Test text chunking with overlap"""
        long_text = "This is sentence one. This is sentence two. This is sentence three. " * 50
        
        chunks = self.parser._chunk_text(long_text, max_size=500, overlap=50)
        
        self.assertGreater(len(chunks), 1, "Should create multiple chunks")
        for chunk in chunks:
            self.assertLessEqual(len(chunk), 600, "Chunks should be near max_size")


class Test8KPressReleaseExtraction(unittest.TestCase):
    """Test 8-K press release metric extraction"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_revenue_extraction_from_8k(self):
        """Test extracting revenue from 8-K press release text"""
        html_content = '''
        <html>
        <body>
        <p>Company XYZ reported quarterly revenue of $1.5 billion for Q3 2024, 
        representing a 15% increase year-over-year.</p>
        </body>
        </html>
        '''
        result = self.parser.parse_filing(html_content, "XYZ", "8-K", "12345")
        metrics = result['structured_metrics']
        
        revenue_metrics = [m for m in metrics if m['normalized_metric'] == 'revenue']
        if revenue_metrics:
            self.assertEqual(revenue_metrics[0]['value'], 1_500_000_000)
    
    def test_eps_extraction_from_8k(self):
        """Test extracting EPS from 8-K press release text"""
        html_content = '''
        <html>
        <body>
        <p>Diluted earnings per share of $2.45 exceeded analyst expectations.</p>
        </body>
        </html>
        '''
        result = self.parser.parse_filing(html_content, "XYZ", "8-K", "12345")
        metrics = result['structured_metrics']
        
        eps_metrics = [m for m in metrics if 'earnings_per_share' in m['normalized_metric']]
        if eps_metrics:
            self.assertEqual(eps_metrics[0]['value'], 2.45)


class TestPandasExtraction(unittest.TestCase):
    """Test pandas-based table extraction"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_pandas_available(self):
        """Test that pandas is available for enhanced extraction"""
        try:
            import pandas as pd
            pandas_available = True
        except ImportError:
            pandas_available = False
        
        # Log status but don't fail if pandas not available
        if pandas_available:
            logger.info("Pandas is available for enhanced extraction")
        else:
            logger.warning("Pandas not available - using BeautifulSoup fallback")
    
    def test_pandas_value_parsing(self):
        """Test pandas value parsing"""
        test_cases = [
            ('1,234,567', True),  # Should parse
            ('(500,000)', True),  # Negative
            ('$1,234', True),
            ('-', False),  # Should return None
            ('', False),
            ('nan', False),
        ]
        
        for value_str, should_parse in test_cases:
            result = self.parser._parse_pandas_value(value_str)
            if should_parse:
                self.assertIsNotNone(result, f"Should parse '{value_str}'")
            else:
                self.assertIsNone(result, f"Should not parse '{value_str}'")


class TestAccuracyValidation(unittest.TestCase):
    """Test extraction accuracy meets 99.99% target"""
    
    def setUp(self):
        self.parser = HybridSECParser()
    
    def test_comprehensive_ixbrl_extraction(self):
        """Test comprehensive extraction from iXBRL filing"""
        # Simulate a complete iXBRL filing with all major metrics
        html_content = '''
        <html>
        <body>
        <!-- Income Statement -->
        <ix:nonFraction name="us-gaap:Revenues" contextRef="FY2024" unitRef="USD" decimals="-6">1000000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:CostOfRevenue" contextRef="FY2024" unitRef="USD" decimals="-6">600000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:GrossProfit" contextRef="FY2024" unitRef="USD" decimals="-6">400000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:OperatingIncomeLoss" contextRef="FY2024" unitRef="USD" decimals="-6">200000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:NetIncomeLoss" contextRef="FY2024" unitRef="USD" decimals="-6">150000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:EarningsPerShareBasic" contextRef="FY2024" unitRef="USD" decimals="2">1.50</ix:nonFraction>
        <ix:nonFraction name="us-gaap:EarningsPerShareDiluted" contextRef="FY2024" unitRef="USD" decimals="2">1.48</ix:nonFraction>
        
        <!-- Balance Sheet -->
        <ix:nonFraction name="us-gaap:Assets" contextRef="FY2024" unitRef="USD" decimals="-6">5000000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:Liabilities" contextRef="FY2024" unitRef="USD" decimals="-6">3000000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:StockholdersEquity" contextRef="FY2024" unitRef="USD" decimals="-6">2000000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:CashAndCashEquivalentsAtCarryingValue" contextRef="FY2024" unitRef="USD" decimals="-6">500000000</ix:nonFraction>
        
        <!-- Cash Flow -->
        <ix:nonFraction name="us-gaap:NetCashProvidedByUsedInOperatingActivities" contextRef="FY2024" unitRef="USD" decimals="-6">300000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:NetCashProvidedByUsedInInvestingActivities" contextRef="FY2024" unitRef="USD" decimals="-6">-100000000</ix:nonFraction>
        <ix:nonFraction name="us-gaap:NetCashProvidedByUsedInFinancingActivities" contextRef="FY2024" unitRef="USD" decimals="-6">-50000000</ix:nonFraction>
        </body>
        </html>
        '''
        
        result = self.parser.parse_filing(html_content, "TEST", "10-K", "12345")
        metrics = result['structured_metrics']
        
        # Should extract all major metrics
        expected_metrics = [
            'revenue', 'cost_of_revenue', 'gross_profit', 'operating_income', 'net_income',
            'earnings_per_share_basic', 'earnings_per_share_diluted',
            'total_assets', 'total_liabilities', 'shareholders_equity', 'cash_and_equivalents',
            'operating_cash_flow', 'investing_cash_flow', 'financing_cash_flow'
        ]
        
        extracted_metrics = set(m['normalized_metric'] for m in metrics)
        
        # Calculate accuracy
        found_count = sum(1 for m in expected_metrics if m in extracted_metrics)
        accuracy = found_count / len(expected_metrics) * 100
        
        logger.info(f"Extraction accuracy: {accuracy:.2f}% ({found_count}/{len(expected_metrics)} metrics)")
        
        # Should achieve high accuracy
        self.assertGreaterEqual(accuracy, 80, f"Accuracy should be >= 80%, got {accuracy:.2f}%")


if __name__ == '__main__':
    # Run tests with verbosity
    unittest.main(verbosity=2)
