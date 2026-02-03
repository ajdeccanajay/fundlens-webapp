"""
Improved SEC Parser with Better Table Detection
Combines the best of enhanced_parser.py and unified_sec_parser
Uses RobustTableParser for accurate table extraction
Uses EnhancedNarrativeExtractor for comprehensive text extraction
"""

from typing import Dict, List, Optional, Tuple
from bs4 import BeautifulSoup
import pandas as pd
from decimal import Decimal
import re
from dataclasses import dataclass
import logging

# Import the robust table parser
from unified_sec_parser.robust_table_parser import RobustTableParser

# Import the simple narrative extractor (more robust for real SEC filings)
from simple_narrative_extractor import SimpleNarrativeExtractor

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


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


class ImprovedSECParser:
    """
    Enhanced SEC filing parser with better table detection
    """
    
    # Financial statement keywords (more comprehensive)
    FINANCIAL_KEYWORDS = {
        'balance_sheet': [
            'consolidated balance sheet',
            'condensed consolidated balance sheet',
            'balance sheet',
            'statement of financial position',
            'statements of financial position',
        ],
        'income_statement': [
            'consolidated statement of operations',
            'consolidated statements of operations',
            'consolidated statement of income',
            'consolidated statements of income',
            'statement of operations',
            'statements of operations',
            'statement of income',
            'statements of income',
            'statement of earnings',
            'statements of earnings',
        ],
        'cash_flow': [
            'consolidated statement of cash flows',
            'consolidated statements of cash flows',
            'statement of cash flows',
            'statements of cash flows',
        ],
    }
    
    # Metric patterns for better detection
    METRIC_PATTERNS = {
        'revenue': [
            'revenue', 'revenues', 'net sales', 'total net sales', 'total revenue',
            'total revenues', 'sales', 'net revenue'
        ],
        'cost_of_revenue': [
            'cost of revenue', 'cost of sales', 'cost of goods sold', 'cogs',
            'cost of products sold', 'cost of services'
        ],
        'gross_profit': [
            'gross profit', 'gross margin', 'gross income'
        ],
        'operating_expenses': [
            'operating expenses', 'total operating expenses', 'operating costs'
        ],
        'operating_income': [
            'operating income', 'income from operations', 'operating profit'
        ],
        'net_income': [
            'net income', 'net earnings', 'net profit', 'net loss',
            'net income (loss)', 'net earnings (loss)'
        ],
        'total_assets': [
            'total assets', 'total current assets', 'assets'
        ],
        'total_liabilities': [
            'total liabilities', 'total current liabilities', 'liabilities'
        ],
        'shareholders_equity': [
            "shareholders' equity", "stockholders' equity", 'total equity',
            "shareholders equity", "stockholders equity"
        ],
    }
    
    def __init__(self, synonym_map: Dict[str, str] = None):
        """
        Initialize parser with optional synonym mapping
        
        Args:
            synonym_map: Dict mapping raw labels to normalized metric names
        """
        self.synonym_map = synonym_map or self._build_default_synonyms()
        self.table_parser = RobustTableParser()
        self.narrative_extractor = SimpleNarrativeExtractor(
            chunk_size=1500,  # From strategy document
            chunk_overlap=200  # From strategy document
        )
    
    def _build_default_synonyms(self) -> Dict[str, str]:
        """Build default synonym mapping from METRIC_PATTERNS"""
        synonyms = {}
        for metric_id, patterns in self.METRIC_PATTERNS.items():
            for pattern in patterns:
                synonyms[pattern.lower()] = metric_id
        return synonyms
    
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
                'structured_metrics': List[dict],
                'narrative_chunks': List[dict],
                'metadata': {...}
            }
        """
        soup = BeautifulSoup(html_content, 'lxml')
        
        # Path A: Extract tables with RobustTableParser
        structured_metrics = self._extract_all_tables(soup, ticker, filing_type)
        
        # Path B: Extract narratives with SimpleNarrativeExtractor
        narrative_chunks = self.narrative_extractor.extract_all_text(
            html_content, ticker, filing_type
        )
        
        logger.info(f"Extracted {len(structured_metrics)} metrics and {len(narrative_chunks)} narrative chunks")
        
        return {
            'structured_metrics': [self._metric_to_dict(m) for m in structured_metrics],
            'narrative_chunks': narrative_chunks,  # Already in dict format from EnhancedNarrativeExtractor
            'metadata': {
                'ticker': ticker,
                'filing_type': filing_type,
                'cik': cik,
                'total_metrics': len(structured_metrics),
                'total_chunks': len(narrative_chunks),
                'high_confidence_metrics': sum(1 for m in structured_metrics if m.confidence_score >= 0.9)
            }
        }
    
    def _extract_all_tables(
        self,
        soup: BeautifulSoup,
        ticker: str,
        filing_type: str
    ) -> List[StructuredMetric]:
        """Extract financial tables using RobustTableParser"""
        metrics = []
        
        # Use RobustTableParser to extract all tables
        html_content = str(soup)
        parsed_tables = self.table_parser.extract_tables_from_html(html_content)
        
        logger.info(f"RobustTableParser found {len(parsed_tables)} tables")
        
        for idx, table_data in enumerate(parsed_tables):
            try:
                # Get the DataFrame
                df = table_data.get('dataframe')
                if df is None or df.empty:
                    continue
                
                # Use content-based classification (more accurate than context-based)
                section_type, classification_confidence = self._classify_table_by_content(df)
                
                # Skip if confidence is too low
                if classification_confidence < 0.3:
                    logger.debug(f"Skipping table {idx+1}: low classification confidence ({classification_confidence:.2f})")
                    continue
                
                logger.info(f"Classified as {section_type} (confidence: {classification_confidence:.2f})")
                
                # Get unit context
                unit_context = table_data.get('unit_context', {})
                unit_factor = unit_context.get('unit_factor', 1.0)
                
                logger.info(f"Processing table {idx+1}: {section_type}, unit_factor={unit_factor}")
                logger.info(f"  Shape: {df.shape}, Columns: {list(df.columns)[:5]}")
                
                # Extract metrics from table
                table_metrics = self._extract_metrics_from_robust_table(
                    df, ticker, filing_type, section_type, unit_factor
                )
                
                metrics.extend(table_metrics)
                logger.info(f"  Extracted {len(table_metrics)} metrics")
                
            except Exception as e:
                logger.warning(f"Error processing table {idx+1}: {e}", exc_info=True)
                continue
        
        logger.info(f"Total extracted: {len(metrics)} metrics from {len(parsed_tables)} tables")
        return metrics
    
    def _identify_table_section(self, table) -> Tuple[Optional[str], float]:
        """
        Identify which financial statement this table belongs to
        Returns: (section_type, confidence)
        """
        # Look at preceding text (up to 1000 chars before table)
        context_text = []
        
        # Check previous siblings
        for sibling in table.find_previous_siblings(limit=10):
            text = sibling.get_text().strip()
            if text:
                context_text.append(text)
        
        # Check parent elements
        parent = table.parent
        for _ in range(5):
            if parent:
                text = parent.get_text(strip=True)
                if text and len(text) < 500:  # Avoid huge blocks
                    context_text.append(text)
                parent = parent.parent
        
        context = ' '.join(context_text).lower()
        
        # Match against financial statement keywords
        best_match = None
        best_confidence = 0.0
        
        for section_type, keywords in self.FINANCIAL_KEYWORDS.items():
            for keyword in keywords:
                if keyword.lower() in context:
                    # Higher confidence for exact matches
                    confidence = 1.0 if keyword.lower() == context[:len(keyword)].lower() else 0.9
                    if confidence > best_confidence:
                        best_match = section_type
                        best_confidence = confidence
        
        return best_match, best_confidence
    
    def _parse_table_to_df(self, table) -> Optional[pd.DataFrame]:
        """Parse HTML table to DataFrame with error handling"""
        try:
            # Try pandas read_html first
            dfs = pd.read_html(str(table), header=0)
            if dfs and len(dfs) > 0:
                return dfs[0]
        except Exception as e:
            logger.debug(f"pandas read_html failed: {e}")
        
        # Fallback: manual parsing
        try:
            rows = []
            for tr in table.find_all('tr'):
                cells = []
                for cell in tr.find_all(['td', 'th']):
                    cells.append(cell.get_text(strip=True))
                if cells:
                    rows.append(cells)
            
            if rows:
                return pd.DataFrame(rows[1:], columns=rows[0] if rows else None)
        except Exception as e:
            logger.debug(f"Manual table parsing failed: {e}")
        
        return None
    
    def _classify_table_by_content(self, df: pd.DataFrame) -> Tuple[str, float]:
        """
        Classify table based on actual content (row labels)
        More reliable than context-based classification
        
        Returns: (statement_type, confidence)
        """
        if df.empty or df.shape[0] < 2:
            return 'income_statement', 0.0
        
        # Get all row labels (first column)
        row_labels = df.iloc[:, 0].astype(str).str.lower()
        row_text = ' '.join(row_labels).lower()
        
        # Balance Sheet indicators (very specific)
        bs_keywords = {
            'strong': [  # These are definitive Balance Sheet indicators
                'total assets',
                'total liabilities and shareholders',
                'total liabilities and stockholders',
                'total shareholders equity',
                'total stockholders equity',
                'current assets:',
                'noncurrent assets:',
                'current liabilities:',
                'noncurrent liabilities:',
            ],
            'medium': [  # These strongly suggest Balance Sheet
                'accounts receivable',
                'accounts payable',
                'marketable securities',
                'property plant and equipment',
                'retained earnings',
                'accumulated other comprehensive',
                'common stock',
                'deferred revenue',
                'commercial paper',
            ]
        }
        
        # Income Statement indicators
        is_keywords = {
            'strong': [
                'net sales',
                'total net sales',
                'cost of sales',
                'cost of revenue',
                'gross profit',
                'gross margin',
                'operating income',
                'income before provision',
                'provision for income taxes',
                'net income',
                'earnings per share',
                'basic earnings per share',
                'diluted earnings per share',
            ],
            'medium': [
                'research and development',
                'selling general and administrative',
                'operating expenses',
                'other income',
                'interest expense',
                'interest income',
            ]
        }
        
        # Cash Flow indicators
        cf_keywords = {
            'strong': [
                'cash flows from operating activities',
                'cash flows from investing activities',
                'cash flows from financing activities',
                'net cash provided by operating',
                'net cash used in investing',
                'net cash used in financing',
                'cash cash equivalents and restricted cash',
            ],
            'medium': [
                'depreciation and amortization',
                'adjustments to reconcile',
                'changes in operating assets',
                'payments for acquisition',
                'proceeds from issuance',
                'payments of dividends',
                'repurchases of common stock',
            ]
        }
        
        # Shareholders' Equity indicators
        se_keywords = {
            'strong': [
                'beginning balances',
                'ending balances',
                'common stock and additional paid',
                'changes in shareholders equity',
            ],
            'medium': [
                'stock-based compensation',
                'common stock issued',
                'common stock withheld',
            ]
        }
        
        # Calculate scores
        def calculate_score(keywords_dict):
            score = 0
            for keyword in keywords_dict.get('strong', []):
                if keyword in row_text:
                    score += 10  # Strong match
            for keyword in keywords_dict.get('medium', []):
                if keyword in row_text:
                    score += 3  # Medium match
            return score
        
        bs_score = calculate_score(bs_keywords)
        is_score = calculate_score(is_keywords)
        cf_score = calculate_score(cf_keywords)
        se_score = calculate_score(se_keywords)
        
        scores = {
            'balance_sheet': bs_score,
            'income_statement': is_score,
            'cash_flow': cf_score,
            'shareholders_equity': se_score,
        }
        
        max_score = max(scores.values())
        
        if max_score == 0:
            # No clear indicators, return default with low confidence
            return 'income_statement', 0.3
        
        # Get statement type with highest score
        statement_type = max(scores, key=scores.get)
        
        # Calculate confidence based on score difference
        sorted_scores = sorted(scores.values(), reverse=True)
        if len(sorted_scores) > 1 and sorted_scores[0] > 0:
            # Confidence is higher if there's a clear winner
            confidence = min(0.95, 0.5 + (sorted_scores[0] - sorted_scores[1]) / sorted_scores[0] * 0.5)
        else:
            confidence = 0.5
        
        return statement_type, confidence
    
    def _is_financial_table(self, df: pd.DataFrame, section_type: str) -> bool:
        """Check if DataFrame is a real financial statement table"""
        if df.empty or df.shape[0] < 3 or df.shape[1] < 2:
            return False
        
        # Check for numeric content
        numeric_count = 0
        total_cells = 0
        
        for col in df.columns[1:]:  # Skip first column (labels)
            try:
                numeric_series = pd.to_numeric(df[col], errors='coerce')
                numeric_count += numeric_series.notna().sum()
                total_cells += len(df[col])
            except:
                continue
        
        if total_cells == 0:
            return False
        
        numeric_ratio = numeric_count / total_cells
        
        # Must have at least 30% numeric content
        if numeric_ratio < 0.3:
            return False
        
        # Check for year/period indicators in headers
        header_text = ' '.join(str(x) for x in df.columns).lower()
        has_periods = any(pattern in header_text for pattern in [
            '2024', '2023', '2022', '2021', '2020',
            'fiscal', 'september', 'december', 'march', 'june',
            'year ended', 'months ended', 'quarter'
        ])
        
        # Check for financial metric keywords in first column
        first_col_text = ' '.join(df.iloc[:, 0].astype(str)).lower()
        has_metrics = any(
            keyword in first_col_text
            for patterns in self.METRIC_PATTERNS.values()
            for keyword in patterns
        )
        
        return has_periods or has_metrics
    
    def _extract_metrics_from_robust_table(
        self,
        df: pd.DataFrame,
        ticker: str,
        filing_type: str,
        section_type: str,
        unit_factor: float = 1.0
    ) -> List[StructuredMetric]:
        """Extract metrics from RobustTableParser output"""
        metrics = []
        
        # Parse fiscal periods from column headers
        period_columns = self._parse_period_columns(df.columns, filing_type)
        
        if not period_columns:
            logger.debug("No period columns found in table")
            return metrics
        
        logger.info(f"Found {len(period_columns)} period columns")
        
        # Iterate through rows
        skipped_count = 0
        extracted_count = 0
        
        for idx, row in df.iterrows():
            try:
                # Get the label from first column
                raw_label = str(row.iloc[0]).strip()
                
                # Skip empty or invalid labels
                if not raw_label or raw_label.lower() in ['nan', 'none', '', 'null', 'label']:
                    skipped_count += 1
                    continue
                
                # Skip header-like rows (be more specific - only skip if it's JUST a date/header)
                raw_label_lower = raw_label.lower().strip()
                if raw_label_lower in ['year ended', 'months ended', 'as of', 'fiscal year', 'quarter ended'] or \
                   re.match(r'^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}$', raw_label_lower):
                    logger.debug(f"Skipping header row: {raw_label}")
                    skipped_count += 1
                    continue
                
                # Skip rows that are just numbers (likely subtotals without labels)
                if raw_label.replace(',', '').replace('.', '').replace('-', '').isdigit():
                    logger.debug(f"Skipping numeric-only row: {raw_label}")
                    skipped_count += 1
                    continue
                
                # Normalize the label
                normalized_metric, label_confidence = self._normalize_label(raw_label)
                
                if not normalized_metric:
                    logger.warning(f"Could not normalize label (too short?): '{raw_label}'")
                    skipped_count += 1
                    continue
                
                # Extract values for each period
                for col_name, period_info in period_columns.items():
                    try:
                        # Get the value
                        cell_value = row[col_name]
                        value = self._parse_numeric_value(cell_value)
                        
                        if value is None:
                            continue
                        
                        # Apply unit factor (thousands, millions, billions)
                        final_value = float(value) * unit_factor
                        
                        # Confidence score (high for robust parser)
                        confidence = min(0.95, label_confidence)
                        
                        metric = StructuredMetric(
                            ticker=ticker,
                            normalized_metric=normalized_metric,
                            raw_label=raw_label,
                            value=final_value,
                            fiscal_period=period_info['period'],
                            period_type=period_info['type'],
                            filing_type=filing_type,
                            statement_type=section_type,
                            confidence_score=confidence
                        )
                        
                        metrics.append(metric)
                        
                    except Exception as e:
                        logger.debug(f"Error extracting value for {raw_label}, column {col_name}: {e}")
                        continue
                        
            except Exception as e:
                logger.debug(f"Error processing row {idx}: {e}")
                continue
        
        return metrics
    
    def _extract_metrics_from_table(
        self,
        df: pd.DataFrame,
        ticker: str,
        filing_type: str,
        section_type: str,
        base_confidence: float
    ) -> List[StructuredMetric]:
        """Extract individual metrics from a financial table"""
        metrics = []
        
        # Parse fiscal periods from column headers
        period_columns = self._parse_period_columns(df.columns, filing_type)
        
        if not period_columns:
            logger.debug("No period columns found in table")
            return metrics
        
        logger.info(f"Found {len(period_columns)} period columns: {list(period_columns.keys())}")
        
        # Iterate through rows
        for idx, row in df.iterrows():
            try:
                raw_label = str(row.iloc[0]).strip()
                
                # Skip empty or invalid labels
                if not raw_label or raw_label.lower() in ['nan', 'none', '', 'null']:
                    continue
                
                # Skip header-like rows
                if any(x in raw_label.lower() for x in ['year ended', 'months ended', 'as of']):
                    continue
                
                # Normalize the label
                normalized_metric, label_confidence = self._normalize_label(raw_label)
                
                if not normalized_metric:
                    continue
                
                # Extract values for each period
                for col_idx, (col_name, period_info) in enumerate(period_columns.items()):
                    try:
                        value = self._parse_numeric_value(row[col_name])
                        
                        if value is None:
                            continue
                        
                        # Combined confidence score
                        confidence = min(base_confidence, label_confidence)
                        
                        metric = StructuredMetric(
                            ticker=ticker,
                            normalized_metric=normalized_metric,
                            raw_label=raw_label,
                            value=float(value),
                            fiscal_period=period_info['period'],
                            period_type=period_info['type'],
                            filing_type=filing_type,
                            statement_type=section_type,
                            confidence_score=confidence
                        )
                        
                        metrics.append(metric)
                        
                    except Exception as e:
                        logger.debug(f"Error extracting value for {raw_label}, column {col_name}: {e}")
                        continue
                        
            except Exception as e:
                logger.debug(f"Error processing row {idx}: {e}")
                continue
        
        return metrics
    
    def _parse_period_columns(self, columns, filing_type: str) -> Dict[str, Dict]:
        """Parse fiscal periods from column headers"""
        period_mapping = {}
        
        for col in columns[1:]:  # Skip first column (labels)
            col_str = str(col).lower()
            
            # Match year patterns (2024, FY2024, etc.) - but only valid years (2000-2099)
            match = re.search(r'(?:fy\s*|fiscal\s*year\s*)?(20\d{2})', col_str)
            if match:
                year = match.group(1)
                period_mapping[col] = {
                    'period': f'FY{year}',
                    'type': 'annual'
                }
                continue
            
            # Match quarterly patterns (Q1 2024, 1Q24, etc.)
            match = re.search(r'(?:q|quarter\s*)([1-4])\s*(?:fy\s*)?(\d{2,4})', col_str)
            if match:
                quarter = match.group(1)
                year = match.group(2)
                if len(year) == 2:
                    year = '20' + year
                period_mapping[col] = {
                    'period': f'Q{quarter} {year}',
                    'type': 'quarterly'
                }
                continue
            
            # Match date patterns (September 30, 2024) - only valid years
            match = re.search(r'(\w+)\s+(\d{1,2}),?\s*(20\d{2})', col_str)
            if match:
                month = match.group(1)
                year = match.group(3)
                
                # Infer type from filing_type
                period_type = 'annual' if filing_type == '10-K' else 'quarterly'
                
                period_mapping[col] = {
                    'period': f'FY{year}',  # Standardize to FY format
                    'type': period_type
                }
                continue
            
            # Match "Year Ended" patterns - only valid years
            if 'year' in col_str:
                match = re.search(r'(20\d{2})', col_str)
                if match:
                    year = match.group(1)
                    period_mapping[col] = {
                        'period': f'FY{year}',
                        'type': 'annual'
                    }
                    continue
        
        return period_mapping
    
    def _normalize_label(self, raw_label: str) -> Tuple[Optional[str], float]:
        """
        Normalize a raw label to standard metric ID
        Returns: (normalized_metric, confidence_score)
        
        NEW: If no match found, create a slugified version of the raw label
        This ensures ALL line items are captured, not just normalized ones
        """
        raw_lower = raw_label.lower().strip()
        
        # Remove common prefixes/suffixes
        raw_lower = re.sub(r'^\s*[\d\.\)]+\s*', '', raw_lower)  # Remove numbering
        raw_lower = re.sub(r'\s*\(.*?\)\s*$', '', raw_lower)  # Remove trailing parentheses
        raw_lower = raw_lower.strip()
        
        # Skip if too short or invalid (allow 2-char for abbreviations like "R&D")
        if len(raw_lower) < 2:
            return None, 0.0
        
        # Direct match
        if raw_lower in self.synonym_map:
            return self.synonym_map[raw_lower], 1.0
        
        # Fuzzy match (contains)
        for synonym, metric_id in self.synonym_map.items():
            if synonym in raw_lower:
                return metric_id, 0.9
            if raw_lower in synonym and len(raw_lower) > 5:
                return metric_id, 0.85
        
        # Partial word match
        raw_words = set(raw_lower.split())
        for synonym, metric_id in self.synonym_map.items():
            synonym_words = set(synonym.split())
            if len(raw_words.intersection(synonym_words)) >= 2:
                return metric_id, 0.8
        
        # NEW: If no match, create slugified version
        # This captures ALL line items from financial statements
        slugified = self._slugify(raw_label)
        return slugified, 0.5  # Lower confidence for non-normalized metrics
    
    def _slugify(self, text: str) -> str:
        """
        Convert text to a valid metric identifier
        Example: "Total net sales" -> "total_net_sales"
        """
        # Convert to lowercase
        text = text.lower()
        
        # Remove special characters and extra spaces
        text = re.sub(r'[^\w\s-]', '', text)
        text = re.sub(r'[-\s]+', '_', text)
        
        # Remove leading/trailing underscores
        text = text.strip('_')
        
        # Limit length
        if len(text) > 100:
            text = text[:100]
        
        return text
    
    def _parse_numeric_value(self, cell) -> Optional[Decimal]:
        """Parse numeric value from table cell"""
        if pd.isna(cell):
            return None
        
        value_str = str(cell)
        
        # Remove common formatting
        value_str = value_str.replace(',', '')
        value_str = value_str.replace('$', '')
        value_str = value_str.replace('€', '')
        value_str = value_str.replace('£', '')
        value_str = value_str.strip()
        
        # Handle parentheses as negative
        if value_str.startswith('(') and value_str.endswith(')'):
            value_str = '-' + value_str[1:-1]
        
        # Handle dashes as zero
        if value_str in ['-', '—', '–', 'n/a', 'N/A', '']:
            return None
        
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
        """Extract narrative sections for RAG/context"""
        narratives = []
        
        NARRATIVE_SECTIONS = {
            'mda': ["Management's Discussion and Analysis", 'MD&A', "MANAGEMENT'S DISCUSSION"],
            'risk_factors': ['Risk Factors', 'RISK FACTORS'],
            'business': ['Business', 'Description of Business', 'ITEM 1. BUSINESS'],
        }
        
        for section_type, keywords in NARRATIVE_SECTIONS.items():
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
                
                # Extract text until next major section
                for _ in range(100):
                    if not current:
                        break
                    
                    text = current.get_text().strip()
                    if text and len(text) > 50:
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
            if chunk:
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
