"""
FundLens.ai SEC Filing Preprocessor
Extracts and normalizes financial tables from 10-K, 10-Q, 8-K filings
"""

import pandas as pd
import re
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
from bs4 import BeautifulSoup
import json


@dataclass
class FinancialMetric:
    """Represents a single financial metric with full provenance"""
    ticker: str
    normalized_metric: str  # From mini_MVP_metrics.xlsx
    raw_label: str  # As appears in filing
    value: float
    unit: str
    scale: str  # 'thousands', 'millions', 'billions'
    fiscal_period: str  # 'FY2024', 'Q3 2024'
    period_type: str  # 'quarterly', 'annual'
    statement_type: str  # 'balance_sheet', 'income_statement', etc.
    filing_type: str  # '10-K', '10-Q', '8-K'
    filing_date: str
    statement_date: str
    source_page: Optional[int]
    xbrl_tag: Optional[str]
    table_id: str


class MetricNormalizer:
    """Maps raw financial labels to normalized metric IDs using mini_MVP_metrics.xlsx"""
    
    def __init__(self, normalization_file: str):
        """
        Load normalization mappings from Excel file
        
        Args:
            normalization_file: Path to mini_MVP_metrics.xlsx
        """
        # Load the detailed synonym mapping
        self.detailed_df = pd.read_excel(
            normalization_file, 
            sheet_name='IS+BS+CF+SE-Condensed'
        )
        
        # Build reverse lookup: synonym -> normalized_metric
        self.synonym_to_metric = {}
        
        for _, row in self.detailed_df.iterrows():
            metric_id = row['Direct Metric']
            synonyms_str = row['Synonyms']
            
            if pd.notna(synonyms_str):
                # Split on semicolon and clean
                synonyms = [s.strip() for s in str(synonyms_str).split(';')]
                
                for synonym in synonyms:
                    # Store in lowercase for matching
                    self.synonym_to_metric[synonym.lower()] = metric_id
        
        print(f"Loaded {len(self.synonym_to_metric)} metric synonyms")
    
    def normalize_label(self, raw_label: str) -> Tuple[Optional[str], List[str]]:
        """
        Convert raw label from SEC filing to normalized metric ID
        
        Args:
            raw_label: e.g., "Accounts Payable", "Trade Payables", "Net Sales"
        
        Returns:
            Tuple of (normalized_metric_id, list_of_matched_synonyms)
        """
        raw_lower = raw_label.lower().strip()
        
        # Direct match
        if raw_lower in self.synonym_to_metric:
            return self.synonym_to_metric[raw_lower], [raw_label]
        
        # Fuzzy match: check if any synonym is contained in raw_label
        matches = []
        for synonym, metric_id in self.synonym_to_metric.items():
            if synonym in raw_lower or raw_lower in synonym:
                matches.append((metric_id, synonym))
        
        if matches:
            # Return the longest match (most specific)
            best_match = max(matches, key=lambda x: len(x[1]))
            return best_match[0], [best_match[1]]
        
        return None, []
    
    def get_statement_type(self, metric_id: str) -> str:
        """Determine which financial statement contains this metric"""
        row = self.detailed_df[self.detailed_df['Direct Metric'] == metric_id]
        if not row.empty:
            return row.iloc[0]['Statement'].lower().replace(' ', '_')
        return 'unknown'


class SECTableExtractor:
    """Extract and structure financial tables from SEC HTML filings"""
    
    def __init__(self, normalizer: MetricNormalizer):
        self.normalizer = normalizer
        
        # Section identifiers
        self.SECTION_HEADERS = {
            'balance_sheet': [
                'consolidated balance sheet',
                'condensed balance sheet',
                'balance sheet',
                'statement of financial position'
            ],
            'income_statement': [
                'consolidated statement of operations',
                'consolidated statement of income',
                'statement of operations',
                'statement of income',
                'profit and loss'
            ],
            'cash_flow': [
                'consolidated statement of cash flows',
                'statement of cash flows',
                'cash flow statement'
            ],
            'shareholders_equity': [
                'statement of shareholders\' equity',
                'statement of changes in equity'
            ]
        }
    
    def extract_tables(
        self, 
        html_content: str, 
        ticker: str, 
        filing_type: str,
        filing_date: str
    ) -> List[FinancialMetric]:
        """
        Extract all financial metrics from SEC filing HTML
        
        Args:
            html_content: Raw HTML from SEC EDGAR
            ticker: Company ticker symbol
            filing_type: '10-K', '10-Q', or '8-K'
            filing_date: Filing date (YYYY-MM-DD)
        
        Returns:
            List of FinancialMetric objects
        """
        soup = BeautifulSoup(html_content, 'lxml')
        metrics = []
        
        # Find all tables
        tables = soup.find_all('table')
        
        for i, table in enumerate(tables):
            # Get context (headers above table)
            context = self._extract_table_context(table)
            section_type = self._identify_section(context)
            
            # Convert to DataFrame
            try:
                df = pd.read_html(str(table))[0]
            except Exception as e:
                print(f"Failed to parse table {i}: {e}")
                continue
            
            # Check if it's a financial table
            if not self._is_financial_table(df):
                continue
            
            # Extract metrics from this table
            table_metrics = self._extract_metrics_from_df(
                df=df,
                ticker=ticker,
                filing_type=filing_type,
                filing_date=filing_date,
                section_type=section_type,
                table_id=f"{ticker}_{filing_type}_{filing_date}_table_{i}"
            )
            
            metrics.extend(table_metrics)
        
        return metrics
    
    def _extract_table_context(self, table) -> str:
        """Get text before table (usually section title)"""
        context_text = []
        
        # Look at previous siblings
        for sibling in table.find_previous_siblings():
            text = sibling.get_text().strip()
            if text:
                context_text.append(text)
            
            # Stop after finding 3 non-empty elements
            if len(context_text) >= 3:
                break
        
        return ' '.join(reversed(context_text)).lower()
    
    def _identify_section(self, context: str) -> str:
        """Identify which financial statement section"""
        for section_type, keywords in self.SECTION_HEADERS.items():
            if any(kw in context for kw in keywords):
                return section_type
        return 'unknown'
    
    def _is_financial_table(self, df: pd.DataFrame) -> bool:
        """Heuristic: Is this a financial statement table?"""
        if df.empty or df.shape[0] < 3:
            return False
        
        # Check if >50% of cells are numeric
        numeric_count = 0
        total_count = 0
        
        for col in df.columns[1:]:  # Skip first column (labels)
            numeric_series = pd.to_numeric(df[col], errors='coerce')
            numeric_count += numeric_series.notna().sum()
            total_count += len(df[col])
        
        if total_count == 0:
            return False
        
        numeric_ratio = numeric_count / total_count
        
        # Check if header contains fiscal periods
        header_text = ' '.join(str(x) for x in df.columns).lower()
        has_periods = any(pattern in header_text for pattern in [
            '2024', '2023', '2022', 'fiscal', 'september', 'december'
        ])
        
        return numeric_ratio > 0.4 and has_periods
    
    def _extract_metrics_from_df(
        self,
        df: pd.DataFrame,
        ticker: str,
        filing_type: str,
        filing_date: str,
        section_type: str,
        table_id: str
    ) -> List[FinancialMetric]:
        """Extract individual metrics from a table DataFrame"""
        metrics = []
        
        # Parse fiscal periods from column headers
        period_columns = self._parse_periods(df.columns)
        
        if not period_columns:
            return metrics
        
        # Iterate through rows
        for idx, row in df.iterrows():
            # First column is usually the label
            raw_label = str(row[0]).strip()
            
            if not raw_label or raw_label.lower() in ['nan', 'none', '']:
                continue
            
            # Normalize the label
            normalized_metric, matched_synonyms = self.normalizer.normalize_label(raw_label)
            
            if not normalized_metric:
                continue  # Skip unrecognized metrics
            
            # Extract values for each period
            for col_name, period_info in period_columns.items():
                value_raw = row[col_name]
                
                # Parse numeric value
                value = self._parse_value(value_raw)
                
                if value is None:
                    continue
                
                # Create metric object
                metric = FinancialMetric(
                    ticker=ticker,
                    normalized_metric=normalized_metric,
                    raw_label=raw_label,
                    value=value,
                    unit='USD',  # TODO: Extract from filing
                    scale='thousands',  # TODO: Extract from table header
                    fiscal_period=period_info['period'],
                    period_type=period_info['type'],
                    statement_type=section_type,
                    filing_type=filing_type,
                    filing_date=filing_date,
                    statement_date=period_info.get('date', filing_date),
                    source_page=None,  # TODO: Extract page number
                    xbrl_tag=None,  # TODO: Parse XBRL if available
                    table_id=table_id
                )
                
                metrics.append(metric)
        
        return metrics
    
    def _parse_periods(self, columns) -> Dict[str, Dict]:
        """
        Parse fiscal periods from column headers
        
        Returns:
            Dict mapping column_name -> {'period': 'FY2024', 'type': 'annual', 'date': '2024-09-28'}
        """
        period_mapping = {}
        
        for col in columns[1:]:  # Skip first column (labels)
            col_str = str(col).lower()
            
            # Match patterns like "September 28, 2024", "FY 2024", "Q3 2024"
            # Annual patterns
            fy_match = re.search(r'(fy\s*|fiscal\s*year\s*)?(\d{4})', col_str)
            if fy_match:
                year = fy_match.group(2)
                period_mapping[col] = {
                    'period': f'FY{year}',
                    'type': 'annual',
                    'date': f'{year}-12-31'  # Default, should parse actual date
                }
                continue
            
            # Quarterly patterns
            q_match = re.search(r'q([1-4])\s*(\d{4})', col_str)
            if q_match:
                quarter = q_match.group(1)
                year = q_match.group(2)
                period_mapping[col] = {
                    'period': f'Q{quarter} {year}',
                    'type': 'quarterly',
                    'date': f'{year}-{int(quarter)*3:02d}-01'  # Approximate
                }
                continue
            
            # Date patterns (most common in balance sheets)
            date_match = re.search(r'(\w+)\s+(\d{1,2}),?\s*(\d{4})', col_str)
            if date_match:
                month_name = date_match.group(1)
                day = date_match.group(2)
                year = date_match.group(3)
                
                # Determine if quarterly or annual based on filing_type context
                period_mapping[col] = {
                    'period': f'{month_name} {day}, {year}',
                    'type': 'unknown',  # Will be inferred from filing_type
                    'date': f'{year}-01-01'  # TODO: Parse month properly
                }
        
        return period_mapping
    
    def _parse_value(self, value_raw) -> Optional[float]:
        """Parse numeric value from table cell"""
        if pd.isna(value_raw):
            return None
        
        # Convert to string and clean
        value_str = str(value_raw).strip()
        
        # Remove common formatting
        value_str = value_str.replace(',', '').replace('$', '').replace('(', '-').replace(')', '')
        
        try:
            return float(value_str)
        except ValueError:
            return None


class BedrockMetadataFormatter:
    """Format extracted metrics for Bedrock Knowledge Base ingestion"""
    
    @staticmethod
    def format_as_markdown(metrics: List[FinancialMetric], ticker: str) -> str:
        """
        Convert metrics to markdown format for Bedrock KB
        
        Organizes by statement type and preserves all metadata
        """
        # Group by statement type and period
        grouped = {}
        for metric in metrics:
            key = (metric.statement_type, metric.fiscal_period)
            if key not in grouped:
                grouped[key] = []
            grouped[key].append(metric)
        
        # Build markdown
        md_lines = [f"# Financial Metrics: {ticker}\n"]
        
        for (statement_type, period), metrics_list in sorted(grouped.items()):
            md_lines.append(f"\n## {statement_type.replace('_', ' ').title()} - {period}\n")
            md_lines.append(f"**Filing:** {metrics_list[0].filing_type} | **Date:** {metrics_list[0].filing_date}\n")
            md_lines.append("\n| Normalized Metric | Raw Label | Value | Unit | Scale |")
            md_lines.append("|-------------------|-----------|-------|------|-------|")
            
            for metric in sorted(metrics_list, key=lambda x: x.normalized_metric):
                md_lines.append(
                    f"| {metric.normalized_metric} | {metric.raw_label} | "
                    f"{metric.value:,.0f} | {metric.unit} | {metric.scale} |"
                )
        
        return '\n'.join(md_lines)
    
    @staticmethod
    def format_as_json(metrics: List[FinancialMetric]) -> str:
        """Convert to JSON for structured storage"""
        metrics_dict = [
            {
                'ticker': m.ticker,
                'normalized_metric': m.normalized_metric,
                'raw_label': m.raw_label,
                'value': m.value,
                'unit': m.unit,
                'scale': m.scale,
                'fiscal_period': m.fiscal_period,
                'period_type': m.period_type,
                'statement_type': m.statement_type,
                'filing_type': m.filing_type,
                'filing_date': m.filing_date,
                'statement_date': m.statement_date,
                'source_page': m.source_page,
                'xbrl_tag': m.xbrl_tag,
                'table_id': m.table_id
            }
            for m in metrics
        ]
        return json.dumps(metrics_dict, indent=2)


# Example Usage
if __name__ == "__main__":
    # Initialize normalizer with your mapping file
    normalizer = MetricNormalizer('/mnt/user-data/uploads/mini_MVP_metrics.xlsx')
    
    # Initialize extractor
    extractor = SECTableExtractor(normalizer)
    
    # Example: Process a filing
    # with open('AAPL_10K_2024.html', 'r') as f:
    #     html_content = f.read()
    
    # metrics = extractor.extract_tables(
    #     html_content=html_content,
    #     ticker='AAPL',
    #     filing_type='10-K',
    #     filing_date='2024-11-01'
    # )
    
    # # Format for Bedrock
    # formatter = BedrockMetadataFormatter()
    # markdown = formatter.format_as_markdown(metrics, 'AAPL')
    # 
    # print(markdown)
    
    print("Normalizer loaded successfully!")
    print(f"Sample mappings: {list(normalizer.synonym_to_metric.items())[:5]}")
