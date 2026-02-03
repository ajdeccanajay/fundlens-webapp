"""
Enhanced SEC Parser with Dual-Path Processing
- Path A: Extract tables as structured metrics
- Path B: Extract narratives for Bedrock KB
"""

from typing import Dict, List, Optional, Tuple
from bs4 import BeautifulSoup
import pandas as pd
from decimal import Decimal
import re
from dataclasses import dataclass
import openpyxl


@dataclass
class StructuredMetric:
    """Represents a single financial metric"""
    ticker: str
    normalized_metric: str
    raw_label: str
    value: float
    fiscal_period: str
    period_type: str  # 'quarterly' | 'annual'
    filing_type: str
    statement_type: str
    confidence_score: float


@dataclass
class NarrativeChunk:
    """Represents a narrative text chunk"""
    ticker: str
    filing_type: str
    section_type: str  # 'mda' | 'risk_factors' | 'business'
    chunk_index: int
    content: str


class MetricNormalizer:
    """Normalizes financial metric labels using mini_MVP_metrics.xlsx"""
    
    def __init__(self, excel_path: str):
        self.synonym_map = {}
        self._load_mappings(excel_path)
    
    def _load_mappings(self, excel_path: str):
        """Load synonym mappings from Excel"""
        try:
            df = pd.read_excel(excel_path, sheet_name='IS+BS+CF+SE-Condensed')
            
            for _, row in df.iterrows():
                metric_id = row['Direct Metric']
                synonyms_str = row.get('Synonyms', '')
                
                if pd.notna(synonyms_str):
                    synonyms = [s.strip() for s in str(synonyms_str).split(';')]
                    
                    for synonym in synonyms:
                        self.synonym_map[synonym.lower()] = metric_id
            
            print(f"✅ Loaded {len(self.synonym_map)} metric synonyms")
        except Exception as e:
            print(f"⚠️  Warning: Could not load mini_MVP_metrics.xlsx: {e}")
            # Add some basic mappings as fallback
            self.synonym_map = {
                'accounts payable': 'accounts_payable',
                'trade payables': 'accounts_payable',
                'revenue': 'revenue',
                'revenues': 'revenue',
                'net sales': 'revenue',
                'total revenue': 'revenue',
                'net income': 'net_income',
                'net earnings': 'net_income',
            }
    
    def normalize(self, raw_label: str) -> Tuple[Optional[str], float]:
        """
        Normalize a raw label to standard metric ID
        
        Returns:
            (normalized_metric, confidence_score)
        """
        raw_lower = raw_label.lower().strip()
        
        # Direct match
        if raw_lower in self.synonym_map:
            return self.synonym_map[raw_lower], 1.0
        
        # Fuzzy match (contains)
        for synonym, metric_id in self.synonym_map.items():
            if synonym in raw_lower or raw_lower in synonym:
                return metric_id, 0.9  # Lower confidence for fuzzy match
        
        return None, 0.0


class EnhancedSECParser:
    """
    Dual-path SEC filing parser
    """
    
    SECTION_KEYWORDS = {
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
    }
    
    NARRATIVE_SECTIONS = {
        'mda': ["Management's Discussion and Analysis", 'MD&A', "MANAGEMENT'S DISCUSSION"],
        'risk_factors': ['Risk Factors', 'RISK FACTORS'],
        'business': ['Business', 'Description of Business', 'ITEM 1. BUSINESS'],
    }
    
    def __init__(self, normalizer: MetricNormalizer):
        self.normalizer = normalizer
    
    def parse_filing(
        self,
        html_content: str,
        ticker: str,
        filing_type: str,
        cik: str
    ) -> Dict:
        """
        Parse SEC filing into structured metrics + narrative chunks
        
        Returns:
            {
                'structured_metrics': List[StructuredMetric],
                'narrative_chunks': List[NarrativeChunk],
                'metadata': {...}
            }
        """
        soup = BeautifulSoup(html_content, 'lxml')
        
        # Path A: Extract tables
        structured_metrics = self._extract_tables(soup, ticker, filing_type)
        
        # Path B: Extract narratives
        narrative_chunks = self._extract_narratives(soup, ticker, filing_type)
        
        return {
            'structured_metrics': [self._metric_to_dict(m) for m in structured_metrics],
            'narrative_chunks': [self._chunk_to_dict(c) for c in narrative_chunks],
            'metadata': {
                'ticker': ticker,
                'filing_type': filing_type,
                'cik': cik,
                'total_metrics': len(structured_metrics),
                'total_chunks': len(narrative_chunks),
                'high_confidence_metrics': sum(1 for m in structured_metrics if m.confidence_score >= 0.9)
            }
        }
    
    def _extract_tables(
        self,
        soup: BeautifulSoup,
        ticker: str,
        filing_type: str
    ) -> List[StructuredMetric]:
        """Extract financial tables as structured data"""
        metrics = []
        
        for table in soup.find_all('table'):
            # Identify section
            section = self._identify_section(table)
            if not section:
                continue
            
            # Parse table to DataFrame
            try:
                df = pd.read_html(str(table))[0]
            except:
                continue
            
            # Check if it's a financial table
            if not self._is_financial_table(df):
                continue
            
            # Extract metrics from each row
            table_metrics = self._extract_metrics_from_df(
                df, ticker, filing_type, section
            )
            metrics.extend(table_metrics)
        
        return metrics
    
    def _identify_section(self, table) -> Optional[str]:
        """Identify which financial statement this table belongs to"""
        context = []
        for sibling in table.find_previous_siblings():
            text = sibling.get_text().strip().lower()
            if text:
                context.append(text)
            if len(context) >= 5:
                break
        
        context_text = ' '.join(context)
        
        for section_type, keywords in self.SECTION_KEYWORDS.items():
            if any(kw.lower() in context_text for kw in keywords):
                return section_type
        
        return None
    
    def _is_financial_table(self, df: pd.DataFrame) -> bool:
        """Check if DataFrame is a financial statement table"""
        if df.empty or df.shape[0] < 3:
            return False
        
        # Check if >40% of cells are numeric
        numeric_count = 0
        total_count = 0
        
        for col in df.columns[1:]:
            numeric_series = pd.to_numeric(df[col], errors='coerce')
            numeric_count += numeric_series.notna().sum()
            total_count += len(df[col])
        
        if total_count == 0:
            return False
        
        numeric_ratio = numeric_count / total_count
        
        # Check if header contains fiscal periods
        header_text = ' '.join(str(x) for x in df.columns).lower()
        has_periods = any(pattern in header_text for pattern in [
            '2024', '2023', '2022', 'fiscal', 'september', 'december', 'march', 'june'
        ])
        
        return numeric_ratio > 0.4 and has_periods
    
    def _extract_metrics_from_df(
        self,
        df: pd.DataFrame,
        ticker: str,
        filing_type: str,
        section: str
    ) -> List[StructuredMetric]:
        """Extract individual metrics from a table DataFrame"""
        metrics = []
        
        # Parse fiscal periods from column headers
        period_columns = self._parse_periods(df.columns, filing_type)
        
        if not period_columns:
            return metrics
        
        # Iterate through rows
        for idx, row in df.iterrows():
            raw_label = str(row.iloc[0]).strip()
            
            if not raw_label or raw_label.lower() in ['nan', 'none', '']:
                continue
            
            # Normalize the label
            normalized_metric, confidence = self.normalizer.normalize(raw_label)
            
            if not normalized_metric:
                continue
            
            # Extract values for each period
            for col_name, period_info in period_columns.items():
                value = self._parse_value(row[col_name])
                
                if value is None:
                    continue
                
                metric = StructuredMetric(
                    ticker=ticker,
                    normalized_metric=normalized_metric,
                    raw_label=raw_label,
                    value=float(value),
                    fiscal_period=period_info['period'],
                    period_type=period_info['type'],
                    filing_type=filing_type,
                    statement_type=section,
                    confidence_score=confidence
                )
                
                metrics.append(metric)
        
        return metrics
    
    def _parse_periods(self, columns, filing_type: str) -> Dict[str, Dict]:
        """Parse fiscal periods from column headers"""
        period_mapping = {}
        
        for col in columns[1:]:
            col_str = str(col).lower()
            
            # Match FY patterns
            if match := re.search(r'(?:fy\s*|fiscal\s*year\s*)?(\d{4})', col_str):
                year = match.group(1)
                period_mapping[col] = {
                    'period': f'FY{year}',
                    'type': 'annual'
                }
                continue
            
            # Match quarterly patterns
            if match := re.search(r'q([1-4])\s*(\d{4})', col_str):
                quarter = match.group(1)
                year = match.group(2)
                period_mapping[col] = {
                    'period': f'Q{quarter} {year}',
                    'type': 'quarterly'
                }
                continue
            
            # Match date patterns
            if match := re.search(r'(\w+)\s+(\d{1,2}),?\s*(\d{4})', col_str):
                month = match.group(1)
                year = match.group(3)
                
                # Infer type from filing_type
                period_type = 'annual' if filing_type == '10-K' else 'quarterly'
                
                period_mapping[col] = {
                    'period': f'{month} {year}',
                    'type': period_type
                }
        
        return period_mapping
    
    def _parse_value(self, cell) -> Optional[Decimal]:
        """Parse numeric value from table cell"""
        if pd.isna(cell):
            return None
        
        value_str = str(cell).replace(',', '').replace('$', '').replace('(', '-').replace(')', '').strip()
        
        try:
            return Decimal(value_str)
        except:
            return None
    
    def _extract_narratives(
        self,
        soup: BeautifulSoup,
        ticker: str,
        filing_type: str
    ) -> List[NarrativeChunk]:
        """Extract narrative sections for Bedrock KB"""
        narratives = []
        
        for section_type, keywords in self.NARRATIVE_SECTIONS.items():
            text = self._extract_section_text(soup, keywords)
            
            if text:
                chunks = self._chunk_text(text, chunk_size=1500, overlap=200)
                
                for i, chunk in enumerate(chunks):
                    narratives.append(NarrativeChunk(
                        ticker=ticker,
                        filing_type=filing_type,
                        section_type=section_type,
                        chunk_index=i,
                        content=chunk
                    ))
        
        return narratives
    
    def _extract_section_text(self, soup: BeautifulSoup, keywords: List[str]) -> Optional[str]:
        """Extract text from a specific section"""
        for keyword in keywords:
            # Find section header
            header = soup.find(text=re.compile(keyword, re.I))
            if header:
                text_parts = []
                current = header.parent
                
                # Extract text until next major section (limit to prevent runaway)
                for _ in range(100):
                    if not current:
                        break
                    
                    text = current.get_text().strip()
                    if text and len(text) > 50:  # Skip short fragments
                        text_parts.append(text)
                    
                    current = current.find_next_sibling()
                
                if text_parts:
                    return '\n\n'.join(text_parts)
        
        return None
    
    def _chunk_text(self, text: str, chunk_size: int = 1500, overlap: int = 200) -> List[str]:
        """Chunk text into fixed-size pieces with overlap"""
        words = text.split()
        chunks = []
        
        i = 0
        while i < len(words):
            chunk = ' '.join(words[i:i + chunk_size])
            if chunk:  # Only add non-empty chunks
                chunks.append(chunk)
            i += chunk_size - overlap
        
        return chunks
    
    def _metric_to_dict(self, metric: StructuredMetric) -> Dict:
        """Convert StructuredMetric to dict"""
        return {
            'ticker': metric.ticker,
            'normalized_metric': metric.normalized_metric,
            'raw_label': metric.raw_label,
            'value': float(metric.value),
            'fiscal_period': metric.fiscal_period,
            'period_type': metric.period_type,
            'filing_type': metric.filing_type,
            'statement_type': metric.statement_type,
            'confidence_score': metric.confidence_score
        }
    
    def _chunk_to_dict(self, chunk: NarrativeChunk) -> Dict:
        """Convert NarrativeChunk to dict"""
        return {
            'ticker': chunk.ticker,
            'filing_type': chunk.filing_type,
            'section_type': chunk.section_type,
            'chunk_index': chunk.chunk_index,
            'content': chunk.content
        }
