"""
Accuracy Validator for SEC Parser
Ensures >99.999% extraction accuracy from financial statements
"""

import pandas as pd
from typing import Dict, List, Tuple
from bs4 import BeautifulSoup
import logging

logger = logging.getLogger(__name__)


class AccuracyValidator:
    """
    Validates that ALL line items from financial statements are extracted
    with >99.999% accuracy
    """
    
    def __init__(self):
        self.validation_results = []
    
    def validate_extraction(
        self,
        html_content: str,
        extracted_metrics: List[Dict],
        ticker: str
    ) -> Dict:
        """
        Validate that all financial statement line items were extracted
        
        Returns:
            {
                'total_line_items': int,
                'extracted_line_items': int,
                'accuracy': float,
                'missing_items': List[str],
                'passed': bool
            }
        """
        soup = BeautifulSoup(html_content, 'lxml')
        
        # Find all financial statement tables
        financial_tables = self._find_financial_tables(soup)
        
        # Extract all line items from tables
        all_line_items = self._extract_all_line_items(financial_tables)
        
        # Get extracted labels
        extracted_labels = set(m['raw_label'].lower().strip() for m in extracted_metrics)
        
        # Find missing items
        missing_items = []
        for line_item in all_line_items:
            if line_item.lower().strip() not in extracted_labels:
                missing_items.append(line_item)
        
        # Calculate accuracy
        total_items = len(all_line_items)
        extracted_items = total_items - len(missing_items)
        accuracy = (extracted_items / total_items * 100) if total_items > 0 else 0
        
        result = {
            'ticker': ticker,
            'total_line_items': total_items,
            'extracted_line_items': extracted_items,
            'accuracy': accuracy,
            'missing_items': missing_items[:20],  # Show first 20
            'passed': accuracy >= 99.999
        }
        
        self.validation_results.append(result)
        
        return result
    
    def _find_financial_tables(self, soup: BeautifulSoup) -> List:
        """Find all tables that are financial statements"""
        financial_tables = []
        
        # Keywords that indicate financial statements
        fs_keywords = [
            'consolidated balance sheet',
            'consolidated statement of operations',
            'consolidated statement of income',
            'consolidated statement of cash flows',
            'consolidated statement of comprehensive income',
            'consolidated statement of shareholders',
            'balance sheet',
            'statement of operations',
            'statement of income',
            'statement of cash flows',
        ]
        
        for table in soup.find_all('table'):
            # Check context before table
            context = []
            for sibling in table.find_previous_siblings(limit=5):
                text = sibling.get_text().strip().lower()
                if text:
                    context.append(text)
            
            context_text = ' '.join(context)
            
            # Check if this is a financial statement
            if any(kw in context_text for kw in fs_keywords):
                financial_tables.append(table)
        
        return financial_tables
    
    def _extract_all_line_items(self, tables: List) -> List[str]:
        """Extract all line item labels from financial tables"""
        line_items = []
        
        for table in tables:
            try:
                # Parse table to DataFrame
                dfs = pd.read_html(str(table))
                if not dfs:
                    continue
                
                df = dfs[0]
                
                # Get first column (labels)
                if df.empty or df.shape[1] < 2:
                    continue
                
                # Extract all labels
                for label in df.iloc[:, 0]:
                    label_str = str(label).strip()
                    
                    # Skip empty, NaN, or header-like labels
                    if not label_str or label_str.lower() in ['nan', 'none', '']:
                        continue
                    
                    # Skip pure date headers
                    if any(x in label_str.lower() for x in ['year ended', 'months ended', 'as of']):
                        continue
                    
                    # Skip if it's just a number
                    if label_str.replace(',', '').replace('.', '').isdigit():
                        continue
                    
                    line_items.append(label_str)
            
            except Exception as e:
                logger.debug(f"Error extracting line items from table: {e}")
                continue
        
        return line_items
    
    def generate_report(self) -> str:
        """Generate accuracy validation report"""
        if not self.validation_results:
            return "No validation results available"
        
        report = []
        report.append("=" * 80)
        report.append("ACCURACY VALIDATION REPORT")
        report.append("=" * 80)
        report.append("")
        
        for result in self.validation_results:
            report.append(f"Ticker: {result['ticker']}")
            report.append(f"  Total Line Items: {result['total_line_items']}")
            report.append(f"  Extracted: {result['extracted_line_items']}")
            report.append(f"  Accuracy: {result['accuracy']:.4f}%")
            report.append(f"  Status: {'✅ PASSED' if result['passed'] else '❌ FAILED'}")
            
            if result['missing_items']:
                report.append(f"  Missing Items ({len(result['missing_items'])} shown):")
                for item in result['missing_items']:
                    report.append(f"    - {item}")
            
            report.append("")
        
        # Overall statistics
        total_items = sum(r['total_line_items'] for r in self.validation_results)
        total_extracted = sum(r['extracted_line_items'] for r in self.validation_results)
        overall_accuracy = (total_extracted / total_items * 100) if total_items > 0 else 0
        
        report.append("=" * 80)
        report.append("OVERALL STATISTICS")
        report.append("=" * 80)
        report.append(f"Total Line Items Across All Companies: {total_items}")
        report.append(f"Total Extracted: {total_extracted}")
        report.append(f"Overall Accuracy: {overall_accuracy:.4f}%")
        report.append(f"Target: 99.999%")
        report.append(f"Status: {'✅ PASSED' if overall_accuracy >= 99.999 else '❌ FAILED'}")
        report.append("")
        
        return "\n".join(report)
