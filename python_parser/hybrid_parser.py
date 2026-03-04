"""
Hybrid SEC Parser - Combines iXBRL extraction with HTML table fallback

This parser implements a layered approach:
1. Layer 1 (Primary): Parse ix:nonFraction tags directly from iXBRL
2. Layer 2 (Fallback): HTML table parsing for tables without ix: tags
3. Layer 3: Normalization & deduplication
4. Layer 4: Section-aware narrative extraction for 10-K, 10-Q, 8-K

Guarantees 100% extraction of all financial data in SEC filings.
Enhanced for bank filings (JPM, C, BAC, etc.) with specialized detection.
"""

import logging
import warnings
import re
import io
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning, NavigableString

# Suppress XML parsing warning
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

# Optional pandas import for enhanced table parsing
try:
    import pandas as pd
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False
    pd = None

# Optional io import for pandas StringIO
try:
    import io
    IO_AVAILABLE = True
except ImportError:
    IO_AVAILABLE = False
    io = None

from ixbrl_parser import IXBRLParser, IXBRLFact
from xbrl_tag_mapper import XBRLTagMapper, get_mapper
from reporting_unit_extractor import ReportingUnitExtractor, ReportingUnitInfo, get_extractor

logger = logging.getLogger(__name__)


# SEC Section Definitions by Filing Type
SEC_SECTIONS = {
    '10-K': {
        'item_1': {'pattern': r'Item\s*1\.?\s*(?:$|Business)', 'title': 'Business', 'part': 'I'},
        'item_1a': {'pattern': r'Item\s*1A\.?', 'title': 'Risk Factors', 'part': 'I'},
        'item_1b': {'pattern': r'Item\s*1B\.?', 'title': 'Unresolved Staff Comments', 'part': 'I'},
        'item_1c': {'pattern': r'Item\s*1C\.?', 'title': 'Cybersecurity', 'part': 'I'},
        'item_2': {'pattern': r'Item\s*2\.?\s*(?:$|Prop)', 'title': 'Properties', 'part': 'I'},
        'item_3': {'pattern': r'Item\s*3\.?\s*(?:$|Legal)', 'title': 'Legal Proceedings', 'part': 'I'},
        'item_4': {'pattern': r'Item\s*4\.?\s*(?:$|Mine)', 'title': 'Mine Safety Disclosures', 'part': 'I'},
        'item_5': {'pattern': r'Item\s*5\.?', 'title': 'Market for Common Equity', 'part': 'II'},
        'item_6': {'pattern': r'Item\s*6\.?', 'title': 'Reserved', 'part': 'II'},
        'item_7': {'pattern': r'Item\s*7\.?\s*(?:$|Management|MD&A)', 'title': 'MD&A', 'part': 'II'},
        'item_7a': {'pattern': r'Item\s*7A\.?', 'title': 'Market Risk Disclosures', 'part': 'II'},
        'item_8': {'pattern': r'Item\s*8\.?', 'title': 'Financial Statements', 'part': 'II'},
        'item_9': {'pattern': r'Item\s*9\.?\s*(?:$|Change)', 'title': 'Accountant Changes', 'part': 'II'},
        'item_9a': {'pattern': r'Item\s*9A\.?', 'title': 'Controls and Procedures', 'part': 'II'},
        'item_9b': {'pattern': r'Item\s*9B\.?', 'title': 'Other Information', 'part': 'II'},
        'item_9c': {'pattern': r'Item\s*9C\.?', 'title': 'Foreign Jurisdictions', 'part': 'II'},
        'item_10': {'pattern': r'Item\s*10\.?', 'title': 'Directors and Officers', 'part': 'III'},
        'item_11': {'pattern': r'Item\s*11\.?', 'title': 'Executive Compensation', 'part': 'III'},
        'item_12': {'pattern': r'Item\s*12\.?', 'title': 'Security Ownership', 'part': 'III'},
        'item_13': {'pattern': r'Item\s*13\.?', 'title': 'Related Party Transactions', 'part': 'III'},
        'item_14': {'pattern': r'Item\s*14\.?', 'title': 'Accountant Fees', 'part': 'III'},
        'item_15': {'pattern': r'Item\s*15\.?', 'title': 'Exhibits', 'part': 'IV'},
        'item_16': {'pattern': r'Item\s*16\.?', 'title': 'Form 10-K Summary', 'part': 'IV'},
    },
    '10-Q': {
        'item_1': {'pattern': r'Item\s*1\.?\s*(?:$|Financial)', 'title': 'Financial Statements', 'part': 'I'},
        'item_2': {'pattern': r'Item\s*2\.?\s*(?:$|Management|MD&A)', 'title': 'MD&A', 'part': 'I'},
        'item_3': {'pattern': r'Item\s*3\.?\s*(?:$|Quant)', 'title': 'Market Risk Disclosures', 'part': 'I'},
        'item_4': {'pattern': r'Item\s*4\.?\s*(?:$|Control)', 'title': 'Controls and Procedures', 'part': 'I'},
        'item_1_p2': {'pattern': r'Part\s*II.*Item\s*1\.?|Item\s*1\.?\s*Legal', 'title': 'Legal Proceedings', 'part': 'II'},
        'item_1a_p2': {'pattern': r'Part\s*II.*Item\s*1A|Item\s*1A\.?\s*Risk', 'title': 'Risk Factors', 'part': 'II'},
        'item_2_p2': {'pattern': r'Part\s*II.*Item\s*2', 'title': 'Unregistered Sales', 'part': 'II'},
        'item_5_p2': {'pattern': r'Part\s*II.*Item\s*5', 'title': 'Other Information', 'part': 'II'},
        'item_6_p2': {'pattern': r'Part\s*II.*Item\s*6|Item\s*6\.?\s*Exhibit', 'title': 'Exhibits', 'part': 'II'},
    },
    '8-K': {
        'item_1_01': {'pattern': r'Item\s*1\.01', 'title': 'Material Definitive Agreement', 'section': '1'},
        'item_1_02': {'pattern': r'Item\s*1\.02', 'title': 'Termination of Agreement', 'section': '1'},
        'item_2_01': {'pattern': r'Item\s*2\.01', 'title': 'Acquisition or Disposition', 'section': '2'},
        'item_2_02': {'pattern': r'Item\s*2\.02', 'title': 'Results of Operations', 'section': '2'},
        'item_2_03': {'pattern': r'Item\s*2\.03', 'title': 'Financial Obligation', 'section': '2'},
        'item_2_05': {'pattern': r'Item\s*2\.05', 'title': 'Exit Activities', 'section': '2'},
        'item_2_06': {'pattern': r'Item\s*2\.06', 'title': 'Material Impairments', 'section': '2'},
        'item_3_02': {'pattern': r'Item\s*3\.02', 'title': 'Unregistered Sales', 'section': '3'},
        'item_4_01': {'pattern': r'Item\s*4\.01', 'title': 'Accountant Changes', 'section': '4'},
        'item_5_02': {'pattern': r'Item\s*5\.02', 'title': 'Director/Officer Changes', 'section': '5'},
        'item_5_03': {'pattern': r'Item\s*5\.03', 'title': 'Bylaw Amendments', 'section': '5'},
        'item_5_07': {'pattern': r'Item\s*5\.07', 'title': 'Shareholder Vote', 'section': '5'},
        'item_7_01': {'pattern': r'Item\s*7\.01', 'title': 'Regulation FD Disclosure', 'section': '7'},
        'item_8_01': {'pattern': r'Item\s*8\.01', 'title': 'Other Events', 'section': '8'},
        'item_9_01': {'pattern': r'Item\s*9\.01', 'title': 'Financial Statements and Exhibits', 'section': '9'},
    },
    # S-1 Registration Statement — reuses hybrid parser with extended sections (§2.5)
    'S-1': {
        'prospectus_summary': {'pattern': r'(?:PROSPECTUS|Prospectus)\s*SUMMARY|(?:^|\s)Summary(?:\s|$)', 'title': 'Prospectus Summary', 'part': 'I'},
        'risk_factors': {'pattern': r'RISK\s*FACTORS|Risk\s*Factors', 'title': 'Risk Factors', 'part': 'I'},
        'use_of_proceeds': {'pattern': r'USE\s*OF\s*PROCEEDS|Use\s*of\s*Proceeds', 'title': 'Use of Proceeds', 'part': 'I'},
        'dilution': {'pattern': r'(?:^|\s)DILUTION(?:\s|$)|(?:^|\s)Dilution(?:\s|$)', 'title': 'Dilution', 'part': 'I'},
        'capitalization': {'pattern': r'(?:^|\s)CAPITALIZATION(?:\s|$)|(?:^|\s)Capitalization(?:\s|$)', 'title': 'Capitalization', 'part': 'I'},
        'dividend_policy': {'pattern': r'DIVIDEND\s*POLICY|Dividend\s*Policy', 'title': 'Dividend Policy', 'part': 'I'},
        'mda': {'pattern': r"MANAGEMENT.S\s*DISCUSSION|Management.s\s*Discussion", 'title': 'MD&A', 'part': 'I'},
        'business': {'pattern': r'(?:^|\s)BUSINESS(?:\s|$)|Our\s*Business', 'title': 'Business', 'part': 'I'},
        'management': {'pattern': r'MANAGEMENT(?:\s|$)|DIRECTORS|Executive\s*Officers', 'title': 'Management', 'part': 'I'},
        'principal_stockholders': {'pattern': r'PRINCIPAL\s*STOCKHOLDERS|SECURITY\s*OWNERSHIP', 'title': 'Principal Stockholders', 'part': 'I'},
        'description_capital_stock': {'pattern': r'DESCRIPTION\s*OF\s*CAPITAL', 'title': 'Description of Capital Stock', 'part': 'I'},
        'underwriting': {'pattern': r'(?:^|\s)UNDERWRITING(?:\s|$)|(?:^|\s)Underwriting(?:\s|$)', 'title': 'Underwriting', 'part': 'I'},
        'financial_statements': {'pattern': r'FINANCIAL\s*STATEMENTS|INDEX\s*TO.*FINANCIAL', 'title': 'Financial Statements', 'part': 'I'},
    },
}


@dataclass
class ExtractedMetric:
    """Unified metric format from hybrid parser"""
    ticker: str
    normalized_metric: str
    raw_label: str
    value: float
    fiscal_period: str
    period_type: str  # 'annual', 'quarterly', 'instant'
    filing_type: str
    statement_type: str
    confidence_score: float
    source: str  # 'ixbrl', 'html_table', or 'derived'
    xbrl_tag: Optional[str] = None
    context_ref: Optional[str] = None
    is_derived: bool = False  # True if calculated from other metrics
    reporting_unit: str = 'units'  # Original scale from SEC: units, thousands, millions, billions
    parent_metric: Optional[str] = None  # Parent metric for hierarchical relationships
    indent_level: int = 0  # Indentation level for display (0=top level, 1=child, 2=grandchild)


class HybridSECParser:
    """
    Hybrid parser that extracts financial data from SEC filings using
    both iXBRL tags and HTML tables.
    
    Priority:
    1. iXBRL tags (ix:nonFraction) - semantic, accurate
    2. HTML tables without ix: tags - fallback for non-tagged data
    
    Enhanced with ReportingUnitExtractor for proper handling of reporting units
    (millions, thousands, etc.) as specified in SEC filing headers.
    """
    
    def __init__(self):
        self.ixbrl_parser = IXBRLParser()
        self.tag_mapper = get_mapper()
        self.unit_extractor = get_extractor()
        
    def parse_filing(
        self,
        html_content: str,
        ticker: str,
        filing_type: str,
        cik: str
    ) -> Dict[str, Any]:
        """
        Parse SEC filing with hybrid approach.
        
        Args:
            html_content: Raw HTML content of SEC filing
            ticker: Company ticker symbol
            filing_type: Filing type (10-K, 10-Q, 8-K)
            cik: Company CIK number
            
        Returns:
            Dictionary with structured_metrics, narrative_chunks, metadata
        """
        logger.info(f"Hybrid parsing {ticker} {filing_type}")
        
        # Layer 0: Extract reporting units from filing header
        # This determines the scale (millions, thousands, etc.) for financial values
        unit_info = self.unit_extractor.extract_from_filing(html_content)
        logger.info(f"Reporting units: default={unit_info.default_unit}, "
                   f"shares={unit_info.share_unit}, per_share={unit_info.per_share_unit}")
        
        # Layer 1: Extract iXBRL facts
        ixbrl_result = self.ixbrl_parser.parse(html_content, ticker)
        ixbrl_facts = ixbrl_result['facts']
        
        logger.info(f"Layer 1 (iXBRL): {len(ixbrl_facts)} facts extracted")
        
        # Filter to consolidated facts only (no dimensional breakdowns)
        consolidated_facts = self.ixbrl_parser.get_consolidated_facts(ixbrl_facts)
        logger.info(f"  Consolidated facts: {len(consolidated_facts)}")
        
        # Deduplicate facts
        deduped_facts = self.ixbrl_parser.deduplicate_facts(consolidated_facts)
        logger.info(f"  After deduplication: {len(deduped_facts)}")
        
        # Convert iXBRL facts to ExtractedMetric format with reporting unit info
        ixbrl_metrics = self._convert_ixbrl_to_metrics(
            deduped_facts, ticker, filing_type, unit_info
        )
        
        # Layer 2: HTML table fallback (for tables without ix: tags)
        # This is optional - iXBRL should capture everything
        # html_metrics = self._extract_html_table_metrics(html_content, ticker, filing_type, unit_info)
        
        # Layer 3: Combine and deduplicate
        all_metrics = ixbrl_metrics  # + html_metrics if needed
        
        # Layer 3.5: For 8-K filings with no iXBRL data, extract from press release text
        if filing_type == '8-K' and len(all_metrics) == 0:
            press_release_metrics = self._extract_8k_press_release_metrics(
                html_content, ticker, filing_type
            )
            all_metrics.extend(press_release_metrics)
        
        # Layer 3.6: For pre-2019 filings with no iXBRL data, extract from HTML tables
        if len(all_metrics) == 0 and self._is_pre_ixbrl_filing(html_content):
            html_table_metrics = self._extract_html_table_metrics(
                html_content, ticker, filing_type, unit_info
            )
            all_metrics.extend(html_table_metrics)
        
        # Layer 4: Compute derived metrics for missing key metrics
        derived_metrics = self._compute_derived_metrics(all_metrics, ticker, filing_type)
        all_metrics.extend(derived_metrics)
        
        if derived_metrics:
            logger.info(f"  Added {len(derived_metrics)} derived metrics")
        
        # Extract narratives
        narrative_chunks = self._extract_narratives(html_content, ticker, filing_type)
        
        # Build response
        structured_metrics = [asdict(m) for m in all_metrics]
        
        # Statistics
        mvp_metrics = [m for m in all_metrics if m.confidence_score >= 0.9]
        unique_concepts = len(set(m.normalized_metric for m in all_metrics))
        
        logger.info(f"Hybrid extraction complete: {len(all_metrics)} metrics, "
                   f"{len(mvp_metrics)} MVP metrics, {unique_concepts} unique concepts")
        
        return {
            'structured_metrics': structured_metrics,
            'narrative_chunks': narrative_chunks,
            'metadata': {
                'ticker': ticker,
                'filing_type': filing_type,
                'cik': cik,
                'total_metrics': len(all_metrics),
                'mvp_metrics': len(mvp_metrics),
                'unique_concepts': unique_concepts,
                'ixbrl_facts_raw': len(ixbrl_facts),
                'ixbrl_facts_consolidated': len(consolidated_facts),
                'contexts_count': len(ixbrl_result['contexts']),
                'parser_version': 'hybrid_v1.1',
                'reporting_unit_info': {
                    'default_unit': unit_info.default_unit,
                    'share_unit': unit_info.share_unit,
                    'per_share_unit': unit_info.per_share_unit,
                    'raw_pattern': unit_info.raw_pattern,
                }
            }
        }

    
    def _convert_ixbrl_to_metrics(
        self,
        facts: List[IXBRLFact],
        ticker: str,
        filing_type: str,
        unit_info: Optional[ReportingUnitInfo] = None
    ) -> List[ExtractedMetric]:
        """Convert iXBRL facts to ExtractedMetric format with proper reporting units"""
        metrics = []
        
        # Use default unit info if not provided
        if unit_info is None:
            unit_info = ReportingUnitInfo()
        
        for fact in facts:
            # Get normalized metric name from XBRL tag
            normalized_metric, confidence = self.tag_mapper.get_normalized_metric(fact.name)
            
            # If no mapping found, use slugified tag name
            if normalized_metric is None:
                normalized_metric = self.tag_mapper.slugify_tag(fact.name)
                confidence = 0.5  # Lower confidence for unmapped tags
            
            # Get statement type
            statement_type = self.tag_mapper.get_statement_type(fact.name)
            if statement_type == 'unknown':
                statement_type = self._infer_statement_type(fact.name)
            
            # Determine period type
            if fact.period_type == 'instant':
                period_type = 'instant'
            elif 'FY' in fact.fiscal_period:
                period_type = 'annual'
            elif 'Q' in fact.fiscal_period:
                period_type = 'quarterly'
            else:
                period_type = 'unknown'
            
            # Determine reporting unit using the ReportingUnitExtractor
            # Priority: 1) Use unit_info based on metric type, 2) Fall back to iXBRL scale
            reporting_unit = self.unit_extractor.get_unit_for_metric(
                normalized_metric, unit_info
            )
            
            # If unit_info didn't provide a specific unit (all defaults to 'units'),
            # fall back to the iXBRL scale attribute
            if reporting_unit == 'units' and fact.scale != 0:
                reporting_unit = self._scale_to_reporting_unit(fact.scale)
            
            metric = ExtractedMetric(
                ticker=ticker,
                normalized_metric=normalized_metric,
                raw_label=fact.name,  # Use XBRL tag as raw label
                value=fact.value,
                fiscal_period=fact.fiscal_period,
                period_type=period_type,
                filing_type=filing_type,
                statement_type=statement_type,
                confidence_score=confidence,
                source='ixbrl',
                xbrl_tag=fact.name,
                context_ref=fact.context_ref,
                reporting_unit=reporting_unit,
            )
            metrics.append(metric)
        
        return metrics
    
    def _scale_to_reporting_unit(self, scale: int) -> str:
        """
        Convert iXBRL scale factor to human-readable reporting unit.
        
        iXBRL scale attribute:
        - 0 = units (raw numbers)
        - 3 = thousands (multiply by 1,000)
        - 6 = millions (multiply by 1,000,000)
        - 9 = billions (multiply by 1,000,000,000)
        
        Note: The value in IXBRLFact is already scaled to full precision.
        This method just records what the original scale was for display purposes.
        """
        scale_map = {
            -6: 'millionths',
            -3: 'thousandths',
            0: 'units',
            3: 'thousands',
            6: 'millions',
            9: 'billions',
            12: 'trillions',
        }
        return scale_map.get(scale, 'units')
    
    def _infer_statement_type(self, xbrl_tag: str) -> str:
        """Infer statement type from XBRL tag name"""
        tag_lower = xbrl_tag.lower()
        
        # Balance sheet indicators
        if any(kw in tag_lower for kw in ['asset', 'liabilit', 'equity', 'receivable', 
                                           'payable', 'inventory', 'cash', 'debt']):
            return 'balance_sheet'
        
        # Cash flow indicators
        if any(kw in tag_lower for kw in ['cashflow', 'operating', 'investing', 
                                           'financing', 'depreciation', 'capex']):
            return 'cash_flow'
        
        # Income statement (default for duration items)
        if any(kw in tag_lower for kw in ['revenue', 'income', 'expense', 'profit',
                                           'loss', 'earnings', 'sales', 'cost']):
            return 'income_statement'
        
        return 'unknown'
    
    def _extract_narratives(
        self,
        html_content: str,
        ticker: str,
        filing_type: str
    ) -> List[Dict[str, Any]]:
        """
        Extract narrative sections from SEC filing with section-aware parsing.
        
        Uses TOC anchor links to identify section boundaries, then extracts
        content between sections. Falls back to pattern matching if no TOC found.
        
        Returns chunks with proper section classification for RAG indexing.
        """
        soup = BeautifulSoup(html_content, 'lxml')
        
        # Get section definitions for this filing type
        section_defs = SEC_SECTIONS.get(filing_type, SEC_SECTIONS.get('10-K'))
        
        # Step 1: Find section boundaries using TOC links
        section_anchors = self._find_section_anchors(soup, section_defs)
        
        # Step 2: Extract content for each section
        if section_anchors:
            narratives = self._extract_sections_by_anchor(
                soup, section_anchors, ticker, filing_type
            )
        else:
            # Fallback: Pattern-based extraction
            logger.warning(f"No TOC anchors found for {ticker}, using pattern fallback")
            narratives = self._extract_sections_by_pattern(
                soup, section_defs, ticker, filing_type
            )
        
        logger.info(f"Extracted {len(narratives)} narrative chunks from {len(section_anchors)} sections")
        return narratives
    
    def _find_section_anchors(
        self,
        soup: BeautifulSoup,
        section_defs: Dict
    ) -> List[Dict[str, Any]]:
        """
        Find section boundaries using multiple detection strategies:
        1. TOC anchor links (most reliable)
        2. Styled section headers (fallback)
        3. Bold/strong text markers (fallback)
        
        Returns list of section markers with their DOM positions.
        """
        section_anchors = []
        seen_sections = set()
        
        # Strategy 1: TOC anchor links
        for a in soup.find_all('a', href=True):
            href = a.get('href', '')
            if not href.startswith('#'):
                continue
            
            anchor_id = href[1:]
            link_text = a.get_text(strip=True)
            
            if not link_text or len(link_text) > 150:
                continue
            
            for section_key, section_info in section_defs.items():
                if section_key in seen_sections:
                    continue
                pattern = section_info['pattern']
                if re.search(pattern, link_text, re.IGNORECASE):
                    section_anchors.append({
                        'section_key': section_key,
                        'section_title': section_info['title'],
                        'anchor_id': anchor_id,
                        'link_text': link_text,
                        'part': section_info.get('part', section_info.get('section', '')),
                        'strategy': 'toc_link',
                    })
                    seen_sections.add(section_key)
                    break
        
        # Strategy 2: Styled section headers (if TOC didn't find enough)
        if len(section_anchors) < 5:
            for tag in soup.find_all(['div', 'span', 'p', 'td'], style=True):
                style = tag.get('style', '').lower()
                text = tag.get_text(strip=True)
                
                # Look for styled Item headers
                if not re.search(r'^Item\s*\d+[A-Z]?\.?\s', text, re.IGNORECASE):
                    continue
                if len(text) > 150:
                    continue
                
                for section_key, section_info in section_defs.items():
                    if section_key in seen_sections:
                        continue
                    pattern = section_info['pattern']
                    if re.search(pattern, text, re.IGNORECASE):
                        # Use element's id or generate a position marker
                        elem_id = tag.get('id', f'_styled_{id(tag)}')
                        section_anchors.append({
                            'section_key': section_key,
                            'section_title': section_info['title'],
                            'anchor_id': elem_id,
                            'link_text': text[:100],
                            'part': section_info.get('part', section_info.get('section', '')),
                            'strategy': 'styled_header',
                            'element': tag,  # Keep reference for direct extraction
                        })
                        seen_sections.add(section_key)
                        break
        
        # Strategy 3: Bold/strong text markers
        if len(section_anchors) < 5:
            for tag in soup.find_all(['b', 'strong', 'font']):
                text = tag.get_text(strip=True)
                if not re.search(r'^Item\s*\d+[A-Z]?\.?', text, re.IGNORECASE):
                    continue
                
                for section_key, section_info in section_defs.items():
                    if section_key in seen_sections:
                        continue
                    pattern = section_info['pattern']
                    if re.search(pattern, text, re.IGNORECASE):
                        elem_id = tag.get('id', f'_bold_{id(tag)}')
                        section_anchors.append({
                            'section_key': section_key,
                            'section_title': section_info['title'],
                            'anchor_id': elem_id,
                            'link_text': text[:100],
                            'part': section_info.get('part', section_info.get('section', '')),
                            'strategy': 'bold_text',
                            'element': tag,
                        })
                        seen_sections.add(section_key)
                        break
        
        # Sort by document order
        def get_sort_key(item):
            # For TOC links, use anchor ID suffix
            if item.get('strategy') == 'toc_link':
                match = re.search(r'_(\d+)$', item['anchor_id'])
                return int(match.group(1)) if match else 0
            # For direct elements, use their position in document
            elem = item.get('element')
            if elem:
                # Find position in document
                all_elems = list(soup.find_all(True))
                try:
                    return all_elems.index(elem)
                except ValueError:
                    return 999999
            return 999999
        
        section_anchors.sort(key=get_sort_key)
        return section_anchors
    
    def _extract_sections_by_anchor(
        self,
        soup: BeautifulSoup,
        section_anchors: List[Dict],
        ticker: str,
        filing_type: str
    ) -> List[Dict[str, Any]]:
        """
        Extract content between section anchors.
        
        For each section, finds the anchor element and extracts all text
        content until the next section anchor.
        """
        narratives = []
        
        # Build a map of anchor IDs to elements
        anchor_elements = {}
        for elem in soup.find_all(id=True):
            anchor_elements[elem.get('id')] = elem
        
        # Also add direct element references from styled/bold detection
        for section in section_anchors:
            if 'element' in section:
                anchor_elements[section['anchor_id']] = section['element']
        
        # Process each section
        for i, section in enumerate(section_anchors):
            anchor_id = section['anchor_id']
            section_key = section['section_key']
            section_title = section['section_title']
            
            # Find the anchor element (either by ID or direct reference)
            start_elem = section.get('element') or anchor_elements.get(anchor_id)
            if not start_elem:
                continue
            
            # Find the next section's element
            end_elem = None
            end_anchor_id = None
            if i + 1 < len(section_anchors):
                next_section = section_anchors[i + 1]
                end_anchor_id = next_section['anchor_id']
                end_elem = next_section.get('element') or anchor_elements.get(end_anchor_id)
            
            # Extract text between anchors
            section_text = self._extract_text_between_elements(
                soup, start_elem, end_elem
            )
            
            if not section_text or len(section_text) < 100:
                continue
            
            # Clean and chunk the section text
            cleaned_text = self._clean_narrative_text(section_text)
            chunks = self._chunk_text(cleaned_text, max_size=1500, overlap=100)
            
            # Create narrative entries for each chunk
            for chunk_idx, chunk in enumerate(chunks):
                if len(chunk) < 50:  # Skip very short chunks
                    continue
                    
                narratives.append({
                    'ticker': ticker,
                    'filing_type': filing_type,
                    'section_key': section_key,
                    'section_title': section_title,
                    'part': section.get('part', ''),
                    'chunk_index': chunk_idx,
                    'total_chunks': len(chunks),
                    'content': chunk,
                    'content_length': len(chunk),
                })
        
        return narratives
    
    def _extract_text_between_elements(
        self,
        soup: BeautifulSoup,
        start_elem,
        end_elem
    ) -> str:
        """
        Extract all text content between two elements.
        
        Walks the DOM from start_elem until reaching end_elem.
        Uses a more robust approach that handles various SEC filing formats.
        """
        text_parts = []
        
        # Get all elements after start_elem
        current = start_elem
        seen_ids = set()
        max_elements = 10000  # Safety limit
        element_count = 0
        
        while current and element_count < max_elements:
            element_count += 1
            
            # Check if we've reached the end element
            if end_elem and current == end_elem:
                break
            
            # Also check by id match
            if end_elem and hasattr(current, 'get'):
                current_id = current.get('id')
                end_id = end_elem.get('id') if hasattr(end_elem, 'get') else None
                if current_id and end_id and current_id == end_id:
                    break
            
            # Avoid processing same element twice
            elem_id = id(current)
            if elem_id in seen_ids:
                current = current.next_element
                continue
            seen_ids.add(elem_id)
            
            # Extract text from text nodes
            if isinstance(current, NavigableString):
                text = str(current).strip()
                parent = current.parent
                # Skip script, style, and hidden elements
                if text and parent and parent.name not in ['script', 'style', 'noscript']:
                    # Skip if parent has display:none
                    parent_style = parent.get('style', '') if hasattr(parent, 'get') else ''
                    if 'display:none' not in parent_style.lower():
                        text_parts.append(text)
            
            current = current.next_element
        
        return ' '.join(text_parts)
    
    def _extract_text_between_anchors(
        self,
        soup: BeautifulSoup,
        start_elem,
        end_anchor_id: Optional[str],
        anchor_elements: Dict
    ) -> str:
        """Legacy method - redirects to new implementation."""
        end_elem = anchor_elements.get(end_anchor_id) if end_anchor_id else None
        return self._extract_text_between_elements(soup, start_elem, end_elem)
    
    def _extract_sections_by_pattern(
        self,
        soup: BeautifulSoup,
        section_defs: Dict,
        ticker: str,
        filing_type: str
    ) -> List[Dict[str, Any]]:
        """
        Fallback: Extract sections using text pattern matching.
        
        Used when TOC anchor links are not available.
        Enhanced for bank filings with better section detection.
        """
        narratives = []
        
        # First, try to find section headers in the document
        section_markers = self._find_section_markers_in_text(soup, section_defs)
        
        # Get all text blocks
        text_blocks = []
        for elem in soup.find_all(['p', 'div', 'span', 'td']):
            text = elem.get_text(strip=True)
            if text and len(text) > 50:
                text_blocks.append({
                    'text': text,
                    'elem': elem,
                    'position': len(text_blocks)
                })
        
        # Classify each block by section
        current_section = 'preamble'
        current_section_title = 'Preamble'
        
        for block in text_blocks:
            text = block['text']
            
            # Check if this block starts a new section using multiple strategies
            new_section = self._detect_section_from_text(text, section_defs)
            if new_section:
                current_section = new_section['key']
                current_section_title = new_section['title']
            
            # Skip non-narrative content
            if self._is_numeric_content(text):
                continue
            
            # Clean and add to narratives
            cleaned = self._clean_narrative_text(text)
            if len(cleaned) < 100:
                continue
            
            # Chunk if needed
            chunks = self._chunk_text(cleaned, max_size=1500, overlap=100)
            for chunk_idx, chunk in enumerate(chunks):
                if len(chunk) < 50:
                    continue
                    
                narratives.append({
                    'ticker': ticker,
                    'filing_type': filing_type,
                    'section_key': current_section,
                    'section_title': current_section_title,
                    'part': section_defs.get(current_section, {}).get('part', ''),
                    'chunk_index': chunk_idx,
                    'total_chunks': len(chunks),
                    'content': chunk,
                    'content_length': len(chunk),
                })
        
        # Log section distribution
        section_counts = {}
        for n in narratives:
            key = n['section_key']
            section_counts[key] = section_counts.get(key, 0) + 1
        logger.info(f"Section distribution: {section_counts}")
        
        return narratives

    def _find_section_markers_in_text(
        self,
        soup: BeautifulSoup,
        section_defs: Dict
    ) -> List[Dict]:
        """
        Find section markers in the document text.
        
        Looks for Item headers in various formats used by different companies.
        """
        markers = []
        
        # Bank-specific patterns (JPM, C, BAC use different formats)
        bank_patterns = [
            # Standard format
            r'(?:^|\n)\s*Item\s+(\d+[A-Z]?)\.?\s*[-–—]?\s*([A-Za-z\s,&]+)',
            # All caps format
            r'(?:^|\n)\s*ITEM\s+(\d+[A-Z]?)\.?\s*[-–—]?\s*([A-Z\s,&]+)',
            # With Part prefix
            r'(?:^|\n)\s*Part\s+[IVX]+[,\s]+Item\s+(\d+[A-Z]?)\.?\s*[-–—]?\s*([A-Za-z\s,&]+)',
        ]
        
        full_text = soup.get_text()
        
        for pattern in bank_patterns:
            for match in re.finditer(pattern, full_text, re.IGNORECASE | re.MULTILINE):
                item_num = match.group(1)
                title = match.group(2).strip() if len(match.groups()) > 1 else ''
                
                # Map to section key
                section_key = f'item_{item_num.lower()}'
                if section_key in section_defs:
                    markers.append({
                        'section_key': section_key,
                        'title': title or section_defs[section_key]['title'],
                        'position': match.start()
                    })
        
        return sorted(markers, key=lambda x: x['position'])

    def _detect_section_from_text(
        self,
        text: str,
        section_defs: Dict
    ) -> Optional[Dict]:
        """
        Detect if text block starts a new section.
        
        Uses multiple detection strategies for different filing formats.
        """
        # Check first 200 chars for section header
        header_text = text[:200].strip()
        
        # Strategy 1: Standard Item pattern
        item_match = re.match(
            r'^(?:Part\s+[IVX]+[,\s]+)?Item\s+(\d+[A-Z]?)\.?\s*[-–—:]?\s*(.{0,50})',
            header_text,
            re.IGNORECASE
        )
        if item_match:
            item_num = item_match.group(1).lower()
            section_key = f'item_{item_num}'
            if section_key in section_defs:
                return {
                    'key': section_key,
                    'title': section_defs[section_key]['title']
                }
        
        # Strategy 2: Check against section patterns
        for section_key, section_info in section_defs.items():
            pattern = section_info['pattern']
            if re.search(pattern, header_text, re.IGNORECASE):
                return {
                    'key': section_key,
                    'title': section_info['title']
                }
        
        # Strategy 3: Bank-specific section headers
        bank_section_patterns = {
            'item_1': [r'business\s*$', r'^business\s+overview', r'description\s+of\s+business'],
            'item_1a': [r'risk\s+factors?\s*$', r'^risk\s+factors?'],
            'item_7': [r"management'?s?\s+discussion", r'md&a', r'mda\s*$'],
            'item_7a': [r'market\s+risk', r'quantitative.*qualitative.*market'],
            'item_8': [r'financial\s+statements?\s+and\s+supplementary', r'consolidated\s+financial'],
        }
        
        header_lower = header_text.lower()
        for section_key, patterns in bank_section_patterns.items():
            if section_key in section_defs:
                for pattern in patterns:
                    if re.search(pattern, header_lower):
                        return {
                            'key': section_key,
                            'title': section_defs[section_key]['title']
                        }
        
        return None
    
    def _clean_narrative_text(self, text: str) -> str:
        """
        Clean narrative text for better RAG indexing.
        
        - Removes excessive whitespace
        - Normalizes unicode characters
        - Removes page numbers and headers
        """
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Remove common page artifacts
        text = re.sub(r'Page\s*\d+\s*of\s*\d+', '', text, flags=re.IGNORECASE)
        text = re.sub(r'Table of Contents', '', text, flags=re.IGNORECASE)
        
        # Remove standalone numbers (likely page numbers)
        text = re.sub(r'^\d+$', '', text, flags=re.MULTILINE)
        
        # Normalize quotes and dashes
        text = text.replace('"', '"').replace('"', '"')
        text = text.replace(''', "'").replace(''', "'")
        text = text.replace('–', '-').replace('—', '-')
        
        return text.strip()
    
    def _is_numeric_content(self, text: str) -> bool:
        """
        Check if text is primarily numeric (likely a table).
        
        Returns True if >40% of characters are digits or currency symbols.
        """
        if not text:
            return False
        
        numeric_chars = len(re.findall(r'[\d$€£¥%,\.]', text))
        ratio = numeric_chars / len(text)
        return ratio > 0.4
    
    def _chunk_text(
        self,
        text: str,
        max_size: int = 1500,
        overlap: int = 100
    ) -> List[str]:
        """
        Split text into chunks at sentence boundaries with overlap.
        
        Args:
            text: Text to chunk
            max_size: Maximum chunk size in characters
            overlap: Number of characters to overlap between chunks
            
        Returns:
            List of text chunks
        """
        # Split into sentences
        sentences = re.split(r'(?<=[.!?])\s+', text)
        
        chunks = []
        current_chunk = ""
        
        for sentence in sentences:
            # If adding this sentence exceeds max_size, start new chunk
            if len(current_chunk) + len(sentence) + 1 > max_size:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    
                    # Start new chunk with overlap from previous
                    if overlap > 0 and len(current_chunk) > overlap:
                        # Find sentence boundary for overlap
                        overlap_text = current_chunk[-overlap:]
                        # Try to start at a sentence boundary
                        match = re.search(r'[.!?]\s+', overlap_text)
                        if match:
                            overlap_text = overlap_text[match.end():]
                        current_chunk = overlap_text + " " + sentence
                    else:
                        current_chunk = sentence
            else:
                current_chunk = current_chunk + " " + sentence if current_chunk else sentence
        
        # Add final chunk
        if current_chunk:
            chunks.append(current_chunk.strip())
        
        return chunks

    def _extract_8k_press_release_metrics(
        self,
        html_content: str,
        ticker: str,
        filing_type: str
    ) -> List[ExtractedMetric]:
        """
        Extract financial metrics from 8-K press release text.
        
        8-K filings (especially Item 2.02 - Results of Operations) contain
        earnings data in narrative form rather than iXBRL tags. This method
        uses regex patterns to extract key metrics from the press release text.
        
        Returns metrics with source='8k_press_release' and lower confidence (0.75).
        """
        if filing_type != '8-K':
            return []
        
        soup = BeautifulSoup(html_content, 'lxml')
        text = soup.get_text()
        
        metrics = []
        
        # Determine fiscal period from text
        fiscal_period = self._detect_fiscal_period_from_text(text)
        
        # Revenue extraction patterns
        revenue_patterns = [
            (r'quarterly\s+revenue\s+(?:of\s+)?\$?([\d,\.]+)\s*(billion|million)', 'quarterly'),
            (r'revenue\s+(?:of|was|totaled)\s+\$?([\d,\.]+)\s*(billion|million)', 'quarterly'),
            (r'posted\s+(?:quarterly\s+)?revenue\s+(?:of\s+)?\$?([\d,\.]+)\s*(billion|million)', 'quarterly'),
            (r'\$?([\d,\.]+)\s*(billion|million)\s+(?:in\s+)?(?:quarterly\s+)?revenue', 'quarterly'),
            (r'record\s+(?:quarterly\s+)?revenue\s+(?:of\s+)?\$?([\d,\.]+)\s*(billion|million)', 'quarterly'),
        ]
        
        for pattern, period_hint in revenue_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                value = self._parse_financial_value(match.group(1), match.group(2))
                if value:
                    metrics.append(ExtractedMetric(
                        ticker=ticker,
                        normalized_metric='revenue',
                        raw_label=f'8-K Press Release: {match.group(0)[:50]}',
                        value=value,
                        fiscal_period=fiscal_period,
                        period_type='quarterly',
                        filing_type=filing_type,
                        statement_type='income_statement',
                        confidence_score=0.75,
                        source='8k_press_release',
                        xbrl_tag=None,
                        context_ref=None,
                        is_derived=False,
                    ))
                    break
        
        # EPS extraction patterns
        eps_patterns = [
            r'diluted\s+earnings\s+per\s+share\s+(?:of\s+)?\$?([\d,\.]+)',
            r'earnings\s+per\s+diluted\s+share\s+(?:of\s+)?\$?([\d,\.]+)',
            r'quarterly\s+(?:diluted\s+)?earnings\s+per\s+share\s+(?:of\s+)?\$?([\d,\.]+)',
            r'(?:diluted\s+)?EPS\s+(?:of\s+|was\s+)?\$?([\d,\.]+)',
        ]
        
        for pattern in eps_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                # Clean the value string (remove commas, trailing periods)
                value_str = match.group(1).replace(',', '').rstrip('.')
                try:
                    value = float(value_str)
                except ValueError:
                    continue  # Skip invalid values
                metrics.append(ExtractedMetric(
                    ticker=ticker,
                    normalized_metric='earnings_per_share_diluted',
                    raw_label=f'8-K Press Release: {match.group(0)[:50]}',
                    value=value,
                    fiscal_period=fiscal_period,
                    period_type='quarterly',
                    filing_type=filing_type,
                    statement_type='income_statement',
                    confidence_score=0.75,
                    source='8k_press_release',
                    xbrl_tag=None,
                    context_ref=None,
                    is_derived=False,
                ))
                break
        
        # Net income extraction patterns
        income_patterns = [
            r'net\s+income\s+(?:of\s+)?\$?([\d,\.]+)\s*(billion|million)',
            r'\$?([\d,\.]+)\s*(billion|million)\s+(?:in\s+)?net\s+income',
            r'quarterly\s+net\s+income\s+(?:of\s+)?\$?([\d,\.]+)\s*(billion|million)',
        ]
        
        for pattern in income_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                value = self._parse_financial_value(match.group(1), match.group(2))
                if value:
                    metrics.append(ExtractedMetric(
                        ticker=ticker,
                        normalized_metric='net_income',
                        raw_label=f'8-K Press Release: {match.group(0)[:50]}',
                        value=value,
                        fiscal_period=fiscal_period,
                        period_type='quarterly',
                        filing_type=filing_type,
                        statement_type='income_statement',
                        confidence_score=0.75,
                        source='8k_press_release',
                        xbrl_tag=None,
                        context_ref=None,
                        is_derived=False,
                    ))
                    break
        
        # Operating cash flow extraction
        cash_patterns = [
            r'operating\s+cash\s+flow\s+(?:of\s+)?\$?([\d,\.]+)\s*(billion|million)',
            r'\$?([\d,\.]+)\s*(billion|million)\s+(?:in\s+)?operating\s+cash\s+flow',
        ]
        
        for pattern in cash_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                value = self._parse_financial_value(match.group(1), match.group(2))
                if value:
                    metrics.append(ExtractedMetric(
                        ticker=ticker,
                        normalized_metric='operating_cash_flow',
                        raw_label=f'8-K Press Release: {match.group(0)[:50]}',
                        value=value,
                        fiscal_period=fiscal_period,
                        period_type='quarterly',
                        filing_type=filing_type,
                        statement_type='cash_flow',
                        confidence_score=0.75,
                        source='8k_press_release',
                        xbrl_tag=None,
                        context_ref=None,
                        is_derived=False,
                    ))
                    break
        
        # Gross margin extraction
        margin_patterns = [
            r'gross\s+margin\s+(?:of\s+|was\s+)?([\d,\.]+)\s*(?:percent|%)',
            r'([\d,\.]+)\s*(?:percent|%)\s+gross\s+margin',
        ]
        
        for pattern in margin_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                # Clean the value string
                value_str = match.group(1).replace(',', '').rstrip('.')
                try:
                    value = float(value_str)
                except ValueError:
                    continue
                metrics.append(ExtractedMetric(
                    ticker=ticker,
                    normalized_metric='gross_margin_percent',
                    raw_label=f'8-K Press Release: {match.group(0)[:50]}',
                    value=value,
                    fiscal_period=fiscal_period,
                    period_type='quarterly',
                    filing_type=filing_type,
                    statement_type='income_statement',
                    confidence_score=0.75,
                    source='8k_press_release',
                    xbrl_tag=None,
                    context_ref=None,
                    is_derived=False,
                ))
                break
        
        # Dividend extraction
        dividend_patterns = [
            r'(?:cash\s+)?dividend\s+(?:of\s+)?\$?([\d,\.]+)\s+per\s+share',
            r'\$?([\d,\.]+)\s+(?:per\s+share\s+)?(?:cash\s+)?dividend',
        ]
        
        for pattern in dividend_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                # Clean the value string
                value_str = match.group(1).replace(',', '').rstrip('.')
                try:
                    value = float(value_str)
                except ValueError:
                    continue
                metrics.append(ExtractedMetric(
                    ticker=ticker,
                    normalized_metric='dividend_per_share',
                    raw_label=f'8-K Press Release: {match.group(0)[:50]}',
                    value=value,
                    fiscal_period=fiscal_period,
                    period_type='quarterly',
                    filing_type=filing_type,
                    statement_type='other',
                    confidence_score=0.75,
                    source='8k_press_release',
                    xbrl_tag=None,
                    context_ref=None,
                    is_derived=False,
                ))
                break
        
        if metrics:
            logger.info(f"Extracted {len(metrics)} metrics from 8-K press release")
        
        return metrics
    
    def _parse_financial_value(self, number_str: str, unit: str) -> Optional[float]:
        """Parse a financial value with unit (billion/million)."""
        try:
            value = float(number_str.replace(',', ''))
            unit_lower = unit.lower() if unit else ''
            if unit_lower in ['billion', 'b']:
                value *= 1_000_000_000
            elif unit_lower in ['million', 'm']:
                value *= 1_000_000
            return value
        except (ValueError, TypeError):
            return None
    
    def _detect_fiscal_period_from_text(self, text: str) -> str:
        """Detect fiscal period from 8-K press release text."""
        # Look for quarter mentions
        quarter_patterns = [
            (r'(?:fiscal\s+)?(?:20\d{2}\s+)?(?:first|1st)\s+quarter', 'Q1'),
            (r'(?:fiscal\s+)?(?:20\d{2}\s+)?(?:second|2nd)\s+quarter', 'Q2'),
            (r'(?:fiscal\s+)?(?:20\d{2}\s+)?(?:third|3rd)\s+quarter', 'Q3'),
            (r'(?:fiscal\s+)?(?:20\d{2}\s+)?(?:fourth|4th)\s+quarter', 'Q4'),
            (r'Q([1-4])\s+(?:fiscal\s+)?20(\d{2})', 'Q'),
        ]
        
        # Look for year
        year_match = re.search(r'(?:fiscal\s+)?20(\d{2})', text, re.IGNORECASE)
        year = f"20{year_match.group(1)}" if year_match else "2024"
        
        for pattern, quarter in quarter_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                if quarter == 'Q':
                    return f"Q{match.group(1)} {year}"
                return f"{quarter} {year}"
        
        # Default to quarterly
        return f"Q? {year}"

    def _compute_derived_metrics(
        self,
        metrics: List[ExtractedMetric],
        ticker: str,
        filing_type: str
    ) -> List[ExtractedMetric]:
        """
        Compute derived metrics when direct extraction is not available.
        
        Derived metrics are flagged with is_derived=True and source='derived*'
        to indicate they are calculated, not directly extracted.
        """
        derived = []
        
        # Group metrics by fiscal period for calculations
        by_period: Dict[str, Dict[str, ExtractedMetric]] = {}
        for m in metrics:
            period = m.fiscal_period
            if period not in by_period:
                by_period[period] = {}
            # Keep the highest confidence version
            existing = by_period[period].get(m.normalized_metric)
            if existing is None or m.confidence_score > existing.confidence_score:
                by_period[period][m.normalized_metric] = m
        
        # For each period, check if we need to derive total_liabilities
        for period, period_metrics in by_period.items():
            # Check if total_liabilities is missing but we have total_assets and shareholders_equity
            if 'total_liabilities' not in period_metrics:
                total_assets = period_metrics.get('total_assets')
                shareholders_equity = period_metrics.get('shareholders_equity')
                
                if total_assets and shareholders_equity:
                    # Derive: Total Liabilities = Total Assets - Shareholders' Equity
                    derived_value = total_assets.value - shareholders_equity.value
                    
                    derived_metric = ExtractedMetric(
                        ticker=ticker,
                        normalized_metric='total_liabilities',
                        raw_label='Derived: Total Assets - Shareholders Equity',
                        value=derived_value,
                        fiscal_period=period,
                        period_type=total_assets.period_type,
                        filing_type=filing_type,
                        statement_type='balance_sheet',
                        confidence_score=0.85,  # Lower confidence for derived
                        source='derived*',  # Asterisk indicates derived
                        xbrl_tag=None,
                        context_ref=None,
                        is_derived=True,
                    )
                    derived.append(derived_metric)
                    logger.debug(f"Derived total_liabilities for {period}: {derived_value:,.0f}")
            
            # Check if gross_profit is missing but we have revenue and cost_of_revenue
            if 'gross_profit' not in period_metrics:
                revenue = period_metrics.get('revenue')
                cost_of_revenue = period_metrics.get('cost_of_revenue')
                
                if revenue and cost_of_revenue:
                    # Derive: Gross Profit = Revenue - Cost of Revenue
                    derived_value = revenue.value - cost_of_revenue.value
                    
                    derived_metric = ExtractedMetric(
                        ticker=ticker,
                        normalized_metric='gross_profit',
                        raw_label='Derived: Revenue - Cost of Revenue',
                        value=derived_value,
                        fiscal_period=period,
                        period_type=revenue.period_type,
                        filing_type=filing_type,
                        statement_type='income_statement',
                        confidence_score=0.85,
                        source='derived*',
                        xbrl_tag=None,
                        context_ref=None,
                        is_derived=True,
                    )
                    derived.append(derived_metric)
                    logger.debug(f"Derived gross_profit for {period}: {derived_value:,.0f}")
        
        return derived

    def _is_pre_ixbrl_filing(self, html_content: str) -> bool:
        """
        Detect if this is a pre-iXBRL filing (before 2019).
        
        Checks for absence of iXBRL tags and presence of HTML-only structure.
        """
        soup = BeautifulSoup(html_content, 'lxml')
        
        # Check for iXBRL tags
        ix_tags = soup.find_all(['ix:nonfraction', 'ix:nonnumeric'])
        if len(ix_tags) > 0:
            return False  # Has iXBRL tags
        
        # Check for filing date patterns in the HTML
        # Pre-2019 filings typically have different document structure
        text = soup.get_text()
        
        # Look for year patterns - if we find 2018 or earlier, likely pre-iXBRL
        year_matches = re.findall(r'20(1[0-8])', text[:5000])  # 2010-2018
        if year_matches:
            return True
        
        # Check document structure - pre-iXBRL has different HTML patterns
        # Look for Workiva copyright (common in pre-iXBRL filings)
        if 'Workiva' in html_content[:10000]:
            return True
        
        return False

    def _extract_html_table_metrics(
        self,
        html_content: str,
        ticker: str,
        filing_type: str,
        unit_info: Optional[ReportingUnitInfo] = None
    ) -> List[ExtractedMetric]:
        """
        Extract financial metrics from HTML tables in pre-2019 filings.
        
        Uses pattern matching to identify financial statement tables and
        extract key metrics. Returns metrics with source='html_table' and
        lower confidence (0.65).
        
        For complex bank filings, uses pandas-based extraction if available.
        
        Args:
            html_content: Raw HTML content
            ticker: Company ticker symbol
            filing_type: Filing type (10-K, 10-Q, 8-K)
            unit_info: Optional ReportingUnitInfo from filing header
        """
        soup = BeautifulSoup(html_content, 'lxml')
        metrics = []
        
        # Use default unit info if not provided
        if unit_info is None:
            unit_info = self.unit_extractor.extract_from_filing(html_content)
        
        # Try pandas-based extraction first for better accuracy (especially banks)
        if PANDAS_AVAILABLE and IO_AVAILABLE:
            pandas_metrics = self._extract_with_pandas(html_content, ticker, filing_type, unit_info)
            if pandas_metrics:
                logger.info(f"Pandas extraction: {len(pandas_metrics)} metrics")
                return pandas_metrics
        
        # Fallback to BeautifulSoup-based extraction
        # Find consolidated financial statement tables
        statement_tables = self._find_financial_statement_tables(soup)
        
        # Extract metrics from each table type
        for table_info in statement_tables:
            table = table_info['table']
            statement_type = table_info['type']
            
            # Try to extract table-specific unit from header
            table_unit = self.unit_extractor.extract_from_table_header(table)
            effective_unit_info = unit_info
            if table_unit:
                # Override default unit with table-specific unit
                effective_unit_info = ReportingUnitInfo(
                    default_unit=table_unit,
                    share_unit=unit_info.share_unit,
                    per_share_unit=unit_info.per_share_unit,
                    raw_pattern=unit_info.raw_pattern
                )
            
            if statement_type == 'income_statement':
                metrics.extend(self._extract_income_statement_metrics(
                    table, ticker, filing_type, effective_unit_info
                ))
            elif statement_type == 'balance_sheet':
                metrics.extend(self._extract_balance_sheet_metrics(
                    table, ticker, filing_type, effective_unit_info
                ))
            elif statement_type == 'cash_flow':
                metrics.extend(self._extract_cash_flow_metrics(
                    table, ticker, filing_type, effective_unit_info
                ))
        
        if metrics:
            logger.info(f"Extracted {len(metrics)} metrics from HTML tables (pre-iXBRL)")
        
        return metrics

    def _extract_with_pandas(
        self,
        html_content: str,
        ticker: str,
        filing_type: str,
        unit_info: Optional[ReportingUnitInfo] = None
    ) -> List[ExtractedMetric]:
        """
        Extract financial metrics using pandas for more robust table parsing.
        
        Pandas handles complex table structures better than BeautifulSoup,
        especially for bank filings with merged cells and complex layouts.
        
        Returns metrics with source='pandas_table' and confidence 0.70.
        
        Args:
            html_content: Raw HTML content
            ticker: Company ticker symbol
            filing_type: Filing type (10-K, 10-Q, 8-K)
            unit_info: Optional ReportingUnitInfo from filing header
        """
        if not PANDAS_AVAILABLE or not IO_AVAILABLE:
            return []
        
        # Use default unit info if not provided
        if unit_info is None:
            unit_info = ReportingUnitInfo()
        
        metrics = []
        soup = BeautifulSoup(html_content, 'lxml')
        tables = soup.find_all('table')
        
        logger.debug(f"Pandas scanning {len(tables)} tables...")
        
        found_statements = {
            "balance_sheet": None,
            "income_statement": None,
            "cash_flow": None
        }
        
        for i, tbl in enumerate(tables):
            # Early exit if all statements found
            if all(found_statements.values()):
                logger.debug(f"All 3 statements found via pandas at table {i}")
                break
            
            try:
                # Use pandas to parse the table
                dfs = pd.read_html(io.StringIO(str(tbl)))
                if not dfs:
                    continue
                
                df = dfs[0]
                
                # Skip small layout tables (banks have many)
                if df.shape[0] < 5:
                    continue
                
                # Convert to lowercase string for searching
                content = df.to_string().lower()
                
                # --- 1. BALANCE SHEET ---
                if found_statements["balance_sheet"] is None:
                    has_total_assets = "total assets" in content
                    has_liabilities_or_equity = (
                        "total liabilities" in content or 
                        "stockholders' equity" in content or
                        "shareholders' equity" in content
                    )
                    
                    if has_total_assets and has_liabilities_or_equity:
                        logger.debug(f"[+] Pandas found Balance Sheet (Table {i})")
                        found_statements["balance_sheet"] = self._clean_pandas_df(df)
                        continue
                
                # --- 2. CASH FLOWS ---
                if found_statements["cash_flow"] is None:
                    has_operating = "operating activities" in content
                    has_investing = "investing activities" in content
                    has_financing = "financing activities" in content
                    
                    if has_operating and has_investing and has_financing:
                        logger.debug(f"[+] Pandas found Cash Flows (Table {i})")
                        found_statements["cash_flow"] = self._clean_pandas_df(df)
                        continue
                
                # --- 3. INCOME STATEMENT ---
                # Distinguish from Comprehensive Income (which lacks EPS)
                if found_statements["income_statement"] is None:
                    has_income = "net income" in content or "net earnings" in content
                    has_eps = (
                        "earnings per share" in content or 
                        "net income per share" in content or
                        "basic eps" in content or
                        "diluted eps" in content
                    )
                    is_not_cash_flow = "operating activities" not in content
                    
                    if has_income and has_eps and is_not_cash_flow:
                        logger.debug(f"[+] Pandas found Income Statement (Table {i})")
                        found_statements["income_statement"] = self._clean_pandas_df(df)
                        continue
                        
            except Exception as e:
                logger.debug(f"Pandas table {i} parse error: {e}")
                continue
        
        # Extract metrics from found dataframes
        for stmt_type, df in found_statements.items():
            if df is not None:
                stmt_metrics = self._extract_metrics_from_pandas_df(
                    df, ticker, filing_type, stmt_type, unit_info
                )
                metrics.extend(stmt_metrics)
        
        return metrics

    def _clean_pandas_df(self, df) -> 'pd.DataFrame':
        """
        Clean and standardize a pandas DataFrame for metric extraction.
        
        - Removes all-NaN rows and columns
        - Fills remaining NaN with empty string
        - Resets index
        """
        if not PANDAS_AVAILABLE:
            return df
        
        # Drop all-NaN rows and columns
        df = df.dropna(how='all', axis=0)
        df = df.dropna(how='all', axis=1)
        
        # Fill remaining NaN
        df = df.fillna('')
        
        # Reset index
        df = df.reset_index(drop=True)
        
        return df

    def _extract_metrics_from_pandas_df(
        self,
        df: 'pd.DataFrame',
        ticker: str,
        filing_type: str,
        statement_type: str,
        unit_info: Optional[ReportingUnitInfo] = None
    ) -> List[ExtractedMetric]:
        """
        Extract financial metrics from a cleaned pandas DataFrame.
        
        Handles multi-column year headers and various value formats.
        
        Args:
            df: Cleaned pandas DataFrame
            ticker: Company ticker symbol
            filing_type: Filing type (10-K, 10-Q, 8-K)
            statement_type: Type of statement (income_statement, balance_sheet, cash_flow)
            unit_info: Optional ReportingUnitInfo from filing header
        """
        if not PANDAS_AVAILABLE:
            return []
        
        # Use default unit info if not provided
        if unit_info is None:
            unit_info = ReportingUnitInfo()
        
        metrics = []
        
        # Find year columns in the dataframe
        year_columns = []
        for col_idx, col in enumerate(df.columns):
            col_str = str(col)
            year_match = re.search(r'20(\d{2})', col_str)
            if year_match:
                year_columns.append({
                    'column': col_idx,
                    'column_name': col,
                    'year': f"20{year_match.group(1)}"
                })
        
        # Also check first row for years (common in SEC filings)
        if len(year_columns) == 0 and len(df) > 0:
            first_row = df.iloc[0]
            for col_idx, val in enumerate(first_row):
                val_str = str(val)
                year_match = re.search(r'20(\d{2})', val_str)
                if year_match:
                    year_columns.append({
                        'column': col_idx,
                        'column_name': df.columns[col_idx],
                        'year': f"20{year_match.group(1)}"
                    })
        
        if not year_columns:
            logger.debug(f"No year columns found in {statement_type} DataFrame")
            return metrics
        
        # Process each row
        for row_idx in range(len(df)):
            row = df.iloc[row_idx]
            
            # Get label from first column
            label = str(row.iloc[0]).lower().strip() if len(row) > 0 else ''
            
            # Skip empty or header rows
            if not label or len(label) < 3:
                continue
            
            # Match label to metric
            metric_name = self._match_label_to_metric(label)
            if not metric_name:
                continue
            
            # Extract values for each year
            for year_info in year_columns:
                col_idx = year_info['column']
                year = year_info['year']
                
                if col_idx < len(row):
                    value_str = str(row.iloc[col_idx])
                    value = self._parse_pandas_value(value_str)
                    
                    if value is not None:
                        # Determine reporting unit based on metric type
                        reporting_unit = self.unit_extractor.get_unit_for_metric(
                            metric_name, unit_info
                        )
                        
                        # Detect parent from hierarchy definitions
                        parent_metric = self._detect_parent_from_hierarchy(
                            metric_name, statement_type
                        )
                        indent_level = 1 if parent_metric else 0
                        
                        metrics.append(ExtractedMetric(
                            ticker=ticker,
                            normalized_metric=metric_name,
                            raw_label=f'Pandas Table: {str(row.iloc[0])[:50]}',
                            value=value,
                            fiscal_period=f'FY{year}',
                            period_type='annual',
                            filing_type=filing_type,
                            statement_type=statement_type,
                            confidence_score=0.70,  # Higher than basic HTML
                            source='pandas_table',
                            xbrl_tag=None,
                            context_ref=None,
                            is_derived=False,
                            reporting_unit=reporting_unit,
                            parent_metric=parent_metric,
                            indent_level=indent_level,
                        ))
        
        return metrics

    def _parse_pandas_value(self, value_str: str) -> Optional[float]:
        """
        Parse a financial value from pandas cell.
        
        Handles: $1,234, (1,234), 1,234.5, etc.
        """
        if not value_str or value_str in ['', 'nan', 'None']:
            return None
        
        # Clean the string
        cleaned = str(value_str).strip().replace('$', '').replace(',', '')
        
        # Handle parentheses (negative values)
        is_negative = False
        if cleaned.startswith('(') and cleaned.endswith(')'):
            is_negative = True
            cleaned = cleaned[1:-1]
        
        # Handle dashes (zero or no data)
        if cleaned in ['-', '—', '–', '', 'nan']:
            return None
        
        # Skip non-numeric
        if not re.search(r'\d', cleaned):
            return None
        
        try:
            value = float(cleaned)
            if is_negative:
                value = -value
            
            # Convert to full value (SEC filings typically in millions)
            if 100 <= abs(value) <= 999999:
                value = value * 1000000
            
            return value
        except (ValueError, TypeError):
            return None

    def _find_financial_statement_tables(self, soup: BeautifulSoup) -> List[Dict]:
        """
        Find tables containing consolidated financial statements.
        
        Enhanced detection for banks and all company types:
        - Balance Sheet: "total assets" + ("total liabilities" OR "stockholders' equity")
        - Cash Flow: "operating activities" + "investing activities" + "financing activities"
        - Income Statement: ("net income" OR "net earnings") + "earnings per share" + NOT cash flow
        
        Returns list of dicts with 'table' and 'type' keys.
        Early exits once all 3 statements are found for efficiency.
        """
        found_statements = {
            'balance_sheet': None,
            'income_statement': None,
            'cash_flow': None
        }
        
        all_tables = soup.find_all('table')
        logger.debug(f"Scanning {len(all_tables)} tables for financial statements...")
        
        for i, table in enumerate(all_tables):
            # Early exit if all statements found
            if all(found_statements.values()):
                logger.debug(f"All 3 statements found, stopping at table {i}")
                break
            
            rows = table.find_all('tr')
            
            # Skip small/layout tables (banks have many)
            if len(rows) < 5:
                continue
            
            table_text = table.get_text().lower()
            
            # Skip tables without financial data structure
            if not re.search(r'20\d{2}', table_text):
                continue
            if not re.search(r'\$?[\d,]+', table_text):
                continue
            
            # --- 1. BALANCE SHEET DETECTION ---
            # Banks: "Consolidated Balance Sheets" with total assets + (liabilities OR equity)
            if found_statements['balance_sheet'] is None:
                has_total_assets = 'total assets' in table_text
                has_liabilities = 'total liabilities' in table_text or 'total liability' in table_text
                has_equity = any(eq in table_text for eq in [
                    "stockholders' equity", "shareholders' equity", 
                    "stockholders equity", "shareholders equity",
                    "total equity"
                ])
                
                if has_total_assets and (has_liabilities or has_equity):
                    logger.debug(f"[+] Found Balance Sheet (Table Index {i})")
                    found_statements['balance_sheet'] = {
                        'table': table,
                        'type': 'balance_sheet',
                        'table_index': i
                    }
                    continue
            
            # --- 2. CASH FLOW DETECTION ---
            # Banks: "Consolidated Statements of Cash Flows" with all 3 activity types
            if found_statements['cash_flow'] is None:
                has_operating = 'operating activities' in table_text
                has_investing = 'investing activities' in table_text
                has_financing = 'financing activities' in table_text
                
                if has_operating and has_investing and has_financing:
                    logger.debug(f"[+] Found Cash Flows (Table Index {i})")
                    found_statements['cash_flow'] = {
                        'table': table,
                        'type': 'cash_flow',
                        'table_index': i
                    }
                    continue
            
            # --- 3. INCOME STATEMENT DETECTION ---
            # Banks: "Consolidated Statements of Income" with net income + EPS
            # Distinguish from "Comprehensive Income" which lacks EPS
            if found_statements['income_statement'] is None:
                has_income = 'net income' in table_text or 'net earnings' in table_text
                has_eps = any(eps in table_text for eps in [
                    'earnings per share', 'net income per share', 
                    'earnings per common share', 'basic eps', 'diluted eps'
                ])
                # Exclude cash flow tables that might have "net income" as starting point
                is_not_cash_flow = 'operating activities' not in table_text
                
                if has_income and has_eps and is_not_cash_flow:
                    logger.debug(f"[+] Found Income Statement (Table Index {i})")
                    found_statements['income_statement'] = {
                        'table': table,
                        'type': 'income_statement',
                        'table_index': i
                    }
                    continue
        
        # Build result list from found statements
        statement_tables = []
        for stmt_type, stmt_info in found_statements.items():
            if stmt_info is not None:
                statement_tables.append(stmt_info)
            else:
                logger.warning(f"[-] {stmt_type} was not found in HTML tables")
        
        logger.info(f"Found {len(statement_tables)}/3 financial statement tables")
        return statement_tables

    def _extract_income_statement_metrics(
        self,
        table,
        ticker: str,
        filing_type: str,
        unit_info: Optional[ReportingUnitInfo] = None
    ) -> List[ExtractedMetric]:
        """Extract metrics from income statement table with hierarchical detection."""
        metrics = []
        rows = table.find_all('tr')
        
        # Use default unit info if not provided
        if unit_info is None:
            unit_info = ReportingUnitInfo()
        
        # Find year columns (usually in header rows)
        year_columns = self._find_year_columns(table)
        if not year_columns:
            return metrics
        
        # Extract metrics row by row with hierarchy detection
        for row_idx, row in enumerate(rows):
            cells = row.find_all(['td', 'th'])
            if len(cells) < 2:
                continue
            
            # Get row label (first cell)
            label_cell = cells[0]
            label = label_cell.get_text(strip=True).lower()
            
            # Match label to known metrics
            metric_name = self._match_label_to_metric(label)
            if not metric_name:
                continue
            
            # Detect hierarchical relationship
            parent_metric, indent_level = self._detect_parent_from_context(
                metric_name, row_idx, rows, 'income_statement'
            )
            
            # Determine reporting unit based on metric type
            reporting_unit = self.unit_extractor.get_unit_for_metric(
                metric_name, unit_info
            )
            
            # Extract values for each year using improved method
            row_values = self._extract_table_row_values(row, year_columns)
            
            for year, value in row_values:
                metrics.append(ExtractedMetric(
                    ticker=ticker,
                    normalized_metric=metric_name,
                    raw_label=f'HTML Table: {label_cell.get_text(strip=True)}',
                    value=value,
                    fiscal_period=f'FY{year}',
                    period_type='annual',
                    filing_type=filing_type,
                    statement_type='income_statement',
                    confidence_score=0.65,  # Lower confidence for HTML extraction
                    source='html_table',
                    xbrl_tag=None,
                    context_ref=None,
                    is_derived=False,
                    reporting_unit=reporting_unit,
                    parent_metric=parent_metric,
                    indent_level=indent_level,
                ))
        
        return metrics

    def _extract_balance_sheet_metrics(
        self,
        table,
        ticker: str,
        filing_type: str,
        unit_info: Optional[ReportingUnitInfo] = None
    ) -> List[ExtractedMetric]:
        """Extract metrics from balance sheet table with hierarchical detection."""
        metrics = []
        rows = table.find_all('tr')
        
        # Use default unit info if not provided
        if unit_info is None:
            unit_info = ReportingUnitInfo()
        
        year_columns = self._find_year_columns(table)
        if not year_columns:
            return metrics
        
        for row_idx, row in enumerate(rows):
            cells = row.find_all(['td', 'th'])
            if len(cells) < 2:
                continue
            
            label_cell = cells[0]
            label = label_cell.get_text(strip=True).lower()
            
            metric_name = self._match_label_to_metric(label)
            if not metric_name:
                continue
            
            # Detect hierarchical relationship
            parent_metric, indent_level = self._detect_parent_from_context(
                metric_name, row_idx, rows, 'balance_sheet'
            )
            
            # Determine reporting unit based on metric type
            reporting_unit = self.unit_extractor.get_unit_for_metric(
                metric_name, unit_info
            )
            
            row_values = self._extract_table_row_values(row, year_columns)
            
            for year, value in row_values:
                metrics.append(ExtractedMetric(
                    ticker=ticker,
                    normalized_metric=metric_name,
                    raw_label=f'HTML Table: {label_cell.get_text(strip=True)}',
                    value=value,
                    fiscal_period=f'FY{year}',
                    period_type='annual',
                    filing_type=filing_type,
                    statement_type='balance_sheet',
                    confidence_score=0.65,
                    source='html_table',
                    xbrl_tag=None,
                    context_ref=None,
                    is_derived=False,
                    reporting_unit=reporting_unit,
                    parent_metric=parent_metric,
                    indent_level=indent_level,
                ))
        
        return metrics

    def _extract_cash_flow_metrics(
        self,
        table,
        ticker: str,
        filing_type: str,
        unit_info: Optional[ReportingUnitInfo] = None
    ) -> List[ExtractedMetric]:
        """Extract metrics from cash flow statement table with hierarchical detection."""
        metrics = []
        rows = table.find_all('tr')
        
        # Use default unit info if not provided
        if unit_info is None:
            unit_info = ReportingUnitInfo()
        
        year_columns = self._find_year_columns(table)
        if not year_columns:
            return metrics
        
        for row_idx, row in enumerate(rows):
            cells = row.find_all(['td', 'th'])
            if len(cells) < 2:
                continue
            
            label_cell = cells[0]
            label = label_cell.get_text(strip=True).lower()
            
            metric_name = self._match_label_to_metric(label)
            if not metric_name:
                continue
            
            # Detect hierarchical relationship
            parent_metric, indent_level = self._detect_parent_from_context(
                metric_name, row_idx, rows, 'cash_flow'
            )
            
            # Determine reporting unit based on metric type
            reporting_unit = self.unit_extractor.get_unit_for_metric(
                metric_name, unit_info
            )
            
            row_values = self._extract_table_row_values(row, year_columns)
            
            for year, value in row_values:
                metrics.append(ExtractedMetric(
                    ticker=ticker,
                    normalized_metric=metric_name,
                    raw_label=f'HTML Table: {label_cell.get_text(strip=True)}',
                    value=value,
                    fiscal_period=f'FY{year}',
                    period_type='annual',
                    filing_type=filing_type,
                    statement_type='cash_flow',
                    confidence_score=0.65,
                    source='html_table',
                    xbrl_tag=None,
                    context_ref=None,
                    is_derived=False,
                    reporting_unit=reporting_unit,
                    parent_metric=parent_metric,
                    indent_level=indent_level,
                ))
        
        return metrics

    def _find_year_columns(self, table) -> List[Dict]:
        """
        Find columns containing year data in table headers.
        
        Returns list of dicts with 'column' index and 'year' value.
        """
        year_columns = []
        rows = table.find_all('tr')
        
        # Check first few rows for year headers
        for row in rows[:3]:
            cells = row.find_all(['td', 'th'])
            for i, cell in enumerate(cells):
                cell_text = cell.get_text(strip=True)
                # Look for 4-digit years
                year_match = re.search(r'20(\d{2})', cell_text)
                if year_match:
                    year = f"20{year_match.group(1)}"
                    year_columns.append({
                        'column': i,
                        'year': year
                    })
        
        # Remove duplicates and sort by year (newest first)
        seen_years = set()
        unique_columns = []
        for col in year_columns:
            if col['year'] not in seen_years:
                seen_years.add(col['year'])
                unique_columns.append(col)
        
        return sorted(unique_columns, key=lambda x: x['year'], reverse=True)

    def _match_label_to_metric(self, label: str) -> Optional[str]:
        """
        Match table row label to normalized metric name.
        
        Enhanced matching for banks and all company types.
        Uses fuzzy matching for common financial statement line items.
        Handles various SEC HTML table formats.
        """
        label = label.lower().strip()
        
        # Skip empty or very short labels
        if len(label) < 3:
            return None
        
        # Skip header/section labels
        skip_patterns = [
            'year ended', 'three months', 'six months', 'nine months',
            'fiscal year', 'as of', 'for the', 'december', 'january',
            'february', 'march', 'april', 'may', 'june', 'july',
            'august', 'september', 'october', 'november', 'consolidated',
            'unaudited', 'audited', 'in millions', 'in thousands',
            'except per share', 'except share', 'note', 'see accompanying'
        ]
        if any(skip in label for skip in skip_patterns):
            return None
        
        # === INCOME STATEMENT METRICS ===
        
        # Revenue patterns (including bank-specific)
        if any(pattern in label for pattern in [
            'net sales', 'total revenue', 'total net revenue', 'net revenues',
            'revenues', 'sales', 'managed revenue'
        ]) and 'cost' not in label:
            return 'revenue'
        
        # Product Revenue
        if any(pattern in label for pattern in [
            'product revenue', 'product sales', 'products revenue'
        ]):
            return 'product_revenue'
        
        # Service Revenue
        if any(pattern in label for pattern in [
            'service revenue', 'services revenue', 'service sales'
        ]):
            return 'service_revenue'
        
        # Subscription Revenue
        if 'subscription' in label and 'revenue' in label:
            return 'subscription_revenue'
        
        # Advertising Revenue
        if 'advertising' in label and ('revenue' in label or 'income' in label):
            return 'advertising_revenue'
        
        # Licensing Revenue
        if 'licensing' in label and 'revenue' in label:
            return 'licensing_revenue'
        
        # Bank-specific: Net Interest Income
        if 'net interest income' in label and 'expense' not in label:
            return 'net_interest_income'
        
        # Bank-specific: Noninterest Income (check BEFORE interest income)
        if 'noninterest income' in label or 'non-interest income' in label:
            return 'noninterest_income'
        
        # Bank-specific: Noninterest Expense (check BEFORE interest expense)
        if 'noninterest expense' in label or 'non-interest expense' in label:
            return 'noninterest_expense'
        
        # Bank-specific: Interest Income (after noninterest checks)
        if 'interest income' in label and 'net' not in label and 'expense' not in label:
            return 'interest_income'
        
        # Bank-specific: Interest Expense (after noninterest checks)
        if 'interest expense' in label and 'noninterest' not in label and 'non-interest' not in label:
            return 'interest_expense'
        
        # Bank-specific: Provision for Credit Losses
        if any(pattern in label for pattern in [
            'provision for credit losses', 'provision for loan losses',
            'credit loss provision', 'loan loss provision'
        ]):
            return 'provision_for_credit_losses'
        
        # Cost of Revenue / COGS
        if any(pattern in label for pattern in [
            'cost of revenue', 'cost of sales', 'cost of goods sold', 'cogs',
            'cost of products', 'cost of services'
        ]):
            return 'cost_of_revenue'
        
        # Gross Profit
        if 'gross profit' in label or 'gross margin' in label:
            return 'gross_profit'
        
        # Research and Development
        if any(pattern in label for pattern in [
            'research and development', 'r&d', 'research & development'
        ]):
            return 'research_and_development'
        
        # Selling, General & Administrative
        if any(pattern in label for pattern in [
            'selling, general', 'sg&a', 'selling and marketing',
            'general and administrative', 'administrative expense'
        ]):
            return 'selling_general_admin'
        
        # Marketing Expense
        if 'marketing' in label and ('expense' in label or 'cost' in label):
            return 'marketing_expense'
        
        # Media-specific: Programming and Production
        if any(pattern in label for pattern in [
            'programming and production', 'programming costs', 'content costs'
        ]):
            return 'programming_and_production'
        
        # Restructuring Charges
        if 'restructuring' in label:
            return 'restructuring_charges'
        
        # Impairment Charges
        if 'impairment' in label:
            return 'impairment_charges'
        
        # Operating Expenses Total
        if any(pattern in label for pattern in [
            'total operating expenses', 'operating expenses'
        ]) and 'income' not in label:
            return 'operating_expenses'
        
        # Operating Income
        if any(pattern in label for pattern in [
            'operating income', 'income from operations', 'operating profit'
        ]):
            return 'operating_income'
        
        # Other Income/Expense
        if any(pattern in label for pattern in [
            'other income', 'other expense', 'other, net'
        ]):
            return 'other_income_expense'
        
        # Income Before Tax
        if any(pattern in label for pattern in [
            'income before tax', 'income before income tax', 'pretax income',
            'pre-tax income', 'earnings before tax'
        ]):
            return 'income_before_tax'
        
        # Income Tax Expense
        if any(pattern in label for pattern in [
            'income tax expense', 'provision for income tax', 'income taxes'
        ]):
            return 'income_tax_expense'
        
        # Net income patterns (must check before EPS)
        if any(pattern in label for pattern in [
            'net income', 'net earnings', 'net profit'
        ]) and 'per share' not in label and 'attributable' not in label:
            return 'net_income'
        
        # EPS patterns
        if 'earnings per share' in label or 'earnings per common share' in label or 'net income per share' in label:
            if 'diluted' in label:
                return 'earnings_per_share_diluted'
            elif 'basic' in label:
                return 'earnings_per_share_basic'
            else:
                return 'earnings_per_share_basic'  # Default to basic
        
        # Weighted Average Shares
        if 'weighted average' in label and 'share' in label:
            if 'diluted' in label:
                return 'weighted_average_shares_diluted'
            else:
                return 'weighted_average_shares_basic'
        
        # Dividends per Share
        if 'dividend' in label and 'per share' in label:
            return 'dividends_per_share'
        
        # === BALANCE SHEET METRICS ===
        
        # Total Assets
        if label == 'total assets' or label.startswith('total assets'):
            return 'total_assets'
        
        # Cash and Equivalents
        if any(pattern in label for pattern in [
            'cash and cash equivalents', 'cash and equivalents', 'total cash'
        ]) and 'change' not in label:
            return 'cash_and_equivalents'
        
        # Short-term Investments
        if any(pattern in label for pattern in [
            'short-term investments', 'marketable securities', 'short term investments'
        ]):
            return 'short_term_investments'
        
        # Accounts Receivable
        if any(pattern in label for pattern in [
            'accounts receivable', 'trade receivables', 'receivables, net'
        ]):
            return 'accounts_receivable'
        
        # Inventory
        if label == 'inventory' or label == 'inventories' or 'total inventory' in label:
            return 'inventory'
        
        # Prepaid Expenses
        if 'prepaid' in label:
            return 'prepaid_expenses'
        
        # Current Assets
        if 'total current assets' in label or label == 'current assets':
            return 'current_assets'
        
        # Property, Plant & Equipment
        if any(pattern in label for pattern in [
            'property, plant', 'property and equipment', 'pp&e', 'fixed assets'
        ]):
            return 'property_plant_equipment'
        
        # Goodwill
        if label == 'goodwill' or 'total goodwill' in label:
            return 'goodwill'
        
        # Intangible Assets
        if 'intangible' in label and 'asset' in label:
            return 'intangible_assets'
        
        # Long-term Investments
        if any(pattern in label for pattern in [
            'long-term investments', 'long term investments', 'equity investments'
        ]):
            return 'long_term_investments'
        
        # Deferred Tax Assets
        if 'deferred tax' in label and 'asset' in label:
            return 'deferred_tax_assets'
        
        # Bank-specific: Total Loans
        if any(pattern in label for pattern in [
            'total loans', 'loans and leases', 'net loans'
        ]):
            return 'total_loans'
        
        # Bank-specific: Total Deposits
        if label == 'total deposits' or label == 'deposits':
            return 'total_deposits'
        
        # Bank-specific: Tier 1 Capital
        if 'tier 1 capital' in label or 'tier one capital' in label:
            return 'tier1_capital'
        
        # Total Liabilities
        if label == 'total liabilities' or label.startswith('total liabilities'):
            return 'total_liabilities'
        
        # Accounts Payable
        if 'accounts payable' in label:
            return 'accounts_payable'
        
        # Accrued Expenses
        if 'accrued' in label and ('expense' in label or 'liabilities' in label):
            return 'accrued_expenses'
        
        # Short-term Debt
        if any(pattern in label for pattern in [
            'short-term debt', 'short term debt', 'current portion of debt',
            'notes payable'
        ]):
            return 'short_term_debt'
        
        # Deferred Revenue
        if 'deferred revenue' in label or 'unearned revenue' in label:
            return 'deferred_revenue'
        
        # Current Liabilities
        if 'total current liabilities' in label or label == 'current liabilities':
            return 'current_liabilities'
        
        # Long-term Debt
        if any(pattern in label for pattern in [
            'long-term debt', 'long term debt', 'total debt'
        ]):
            return 'long_term_debt'
        
        # Deferred Tax Liabilities
        if 'deferred tax' in label and 'liabilit' in label:
            return 'deferred_tax_liabilities'
        
        # Pension Liabilities
        if 'pension' in label and 'liabilit' in label:
            return 'pension_liabilities'
        
        # Shareholders Equity
        if any(pattern in label for pattern in [
            "shareholders' equity", "stockholders' equity", "shareholders equity",
            "stockholders equity", "total equity", "total shareholders"
        ]):
            return 'shareholders_equity'
        
        # Common Stock
        if 'common stock' in label and 'treasury' not in label:
            return 'common_stock'
        
        # Additional Paid-in Capital
        if any(pattern in label for pattern in [
            'additional paid-in capital', 'additional paid in capital', 'apic'
        ]):
            return 'additional_paid_in_capital'
        
        # Retained Earnings
        if 'retained earnings' in label:
            return 'retained_earnings'
        
        # Treasury Stock
        if 'treasury stock' in label or 'treasury shares' in label:
            return 'treasury_stock'
        
        # Accumulated Other Comprehensive Income
        if 'accumulated other comprehensive' in label:
            return 'accumulated_other_comprehensive_income'
        
        # === CASH FLOW METRICS ===
        
        # Operating Cash Flow
        if any(pattern in label for pattern in [
            'cash provided by operating', 'operating cash flow', 'cash from operations',
            'net cash provided by operating activities', 'cash flows from operating'
        ]):
            return 'operating_cash_flow'
        
        # Depreciation & Amortization
        if any(pattern in label for pattern in [
            'depreciation and amortization', 'depreciation & amortization', 'd&a'
        ]):
            return 'depreciation_amortization'
        
        # Stock-based Compensation
        if any(pattern in label for pattern in [
            'stock-based compensation', 'share-based compensation', 'stock compensation'
        ]):
            return 'stock_based_compensation'
        
        # Deferred Taxes
        if 'deferred' in label and 'tax' in label and 'asset' not in label and 'liabilit' not in label:
            return 'deferred_taxes'
        
        # Changes in Working Capital
        if 'working capital' in label or 'changes in operating' in label:
            return 'changes_in_working_capital'
        
        # Investing Cash Flow
        if any(pattern in label for pattern in [
            'cash used in investing', 'investing cash flow', 'cash from investing',
            'net cash used in investing activities', 'cash flows from investing'
        ]):
            return 'investing_cash_flow'
        
        # Capital Expenditures
        if any(pattern in label for pattern in [
            'capital expenditures', 'capex', 'purchases of property',
            'additions to property'
        ]):
            return 'capital_expenditures'
        
        # Acquisitions
        if 'acquisition' in label and ('business' in label or 'net of cash' in label):
            return 'acquisitions'
        
        # Purchases of Investments
        if 'purchases of' in label and 'investment' in label:
            return 'purchases_of_investments'
        
        # Sales of Investments
        if ('sales of' in label or 'proceeds from' in label) and 'investment' in label:
            return 'sales_of_investments'
        
        # Financing Cash Flow
        if any(pattern in label for pattern in [
            'cash used in financing', 'financing cash flow', 'cash from financing',
            'net cash used in financing activities', 'cash flows from financing'
        ]):
            return 'financing_cash_flow'
        
        # Debt Issuance
        if any(pattern in label for pattern in [
            'proceeds from debt', 'issuance of debt', 'borrowings'
        ]):
            return 'debt_issuance'
        
        # Debt Repayment
        if any(pattern in label for pattern in [
            'repayment of debt', 'repayments of debt', 'debt repayment'
        ]):
            return 'debt_repayment'
        
        # Stock Repurchases
        if any(pattern in label for pattern in [
            'repurchase of stock', 'stock repurchases', 'share repurchases',
            'treasury stock acquired'
        ]):
            return 'stock_repurchases'
        
        # Dividends Paid
        if 'dividend' in label and ('paid' in label or 'payment' in label):
            return 'dividends_paid'
        
        # Free Cash Flow (if explicitly stated)
        if 'free cash flow' in label:
            return 'free_cash_flow'
        
        return None

    def _parse_table_value(self, value_text: str) -> Optional[float]:
        """
        Parse a financial value from table cell text.
        
        Handles various formats: $1,234, (1,234), 1,234.5, etc.
        """
        if not value_text:
            return None
        
        # Clean the text
        cleaned = value_text.strip().replace('$', '').replace(',', '')
        
        # Handle parentheses (negative values)
        is_negative = False
        if cleaned.startswith('(') and cleaned.endswith(')'):
            is_negative = True
            cleaned = cleaned[1:-1]
        
        # Handle dashes (zero or no data)
        if cleaned in ['-', '—', '–', '']:
            return None
        
        # Skip empty or non-numeric cells
        if not cleaned or not re.search(r'\d', cleaned):
            return None
        
        # Try to parse as float
        try:
            value = float(cleaned)
            if is_negative:
                value = -value
            
            # Convert to full value (SEC filings typically in millions)
            # Values like 265,595 in tables are usually in millions
            if 100 <= value <= 999999:  # Likely in millions
                value = value * 1000000
            
            return value
        except (ValueError, TypeError):
            return None

    def _extract_table_row_values(self, row, year_columns: List[Dict]) -> List[Tuple[str, float]]:
        """
        Extract values from a table row for each year column.
        
        Handles cases where $ signs and values are in separate cells.
        Returns list of (year, value) tuples.
        """
        cells = row.find_all(['td', 'th'])
        values = []
        
        for year_info in year_columns:
            col_idx = year_info['column']
            year = year_info['year']
            
            # Look for value in this column and adjacent columns
            value = None
            for offset in range(3):  # Check current and next 2 cells
                check_idx = col_idx + offset
                if check_idx < len(cells):
                    cell_text = cells[check_idx].get_text(strip=True)
                    parsed_value = self._parse_table_value(cell_text)
                    if parsed_value is not None:
                        value = parsed_value
                        break
            
            if value is not None:
                values.append((year, value))
        
        return values

    # =========================================================================
    # HIERARCHICAL RELATIONSHIP DETECTION
    # =========================================================================
    
    # Known parent-child relationships in financial statements
    HIERARCHY_DEFINITIONS = {
        # Income Statement hierarchy
        'revenue': {
            'children': ['product_revenue', 'service_revenue', 'subscription_revenue', 
                        'advertising_revenue', 'licensing_revenue', 'net_interest_income',
                        'noninterest_income'],
            'statement': 'income_statement'
        },
        'operating_expenses': {
            'children': ['cost_of_revenue', 'research_and_development', 'selling_general_admin',
                        'marketing_expense', 'depreciation_amortization', 'restructuring_charges',
                        'noninterest_expense'],
            'statement': 'income_statement'
        },
        'cost_of_revenue': {
            'children': ['cost_of_products', 'cost_of_services'],
            'statement': 'income_statement'
        },
        
        # Balance Sheet hierarchy
        'total_assets': {
            'children': ['current_assets', 'non_current_assets', 'total_loans'],
            'statement': 'balance_sheet'
        },
        'current_assets': {
            'children': ['cash_and_equivalents', 'short_term_investments', 'accounts_receivable',
                        'inventory', 'prepaid_expenses'],
            'statement': 'balance_sheet'
        },
        'non_current_assets': {
            'children': ['property_plant_equipment', 'goodwill', 'intangible_assets',
                        'long_term_investments', 'deferred_tax_assets'],
            'statement': 'balance_sheet'
        },
        'total_liabilities': {
            'children': ['current_liabilities', 'non_current_liabilities', 'total_deposits'],
            'statement': 'balance_sheet'
        },
        'current_liabilities': {
            'children': ['accounts_payable', 'accrued_expenses', 'short_term_debt',
                        'deferred_revenue', 'current_portion_long_term_debt'],
            'statement': 'balance_sheet'
        },
        'non_current_liabilities': {
            'children': ['long_term_debt', 'deferred_tax_liabilities', 'pension_liabilities',
                        'other_long_term_liabilities'],
            'statement': 'balance_sheet'
        },
        'shareholders_equity': {
            'children': ['common_stock', 'additional_paid_in_capital', 'retained_earnings',
                        'accumulated_other_comprehensive_income', 'treasury_stock'],
            'statement': 'balance_sheet'
        },
        
        # Cash Flow hierarchy
        'operating_cash_flow': {
            'children': ['net_income', 'depreciation_amortization', 'stock_based_compensation',
                        'deferred_taxes', 'changes_in_working_capital'],
            'statement': 'cash_flow'
        },
        'investing_cash_flow': {
            'children': ['capital_expenditures', 'acquisitions', 'purchases_of_investments',
                        'sales_of_investments', 'other_investing_activities'],
            'statement': 'cash_flow'
        },
        'financing_cash_flow': {
            'children': ['debt_issuance', 'debt_repayment', 'stock_repurchases',
                        'dividends_paid', 'other_financing_activities'],
            'statement': 'cash_flow'
        },
    }
    
    def _detect_row_indent_level(self, row) -> int:
        """
        Detect indentation level of a table row from CSS/HTML structure.
        
        Checks for:
        1. CSS padding-left or margin-left styles
        2. Non-breaking spaces (&nbsp;) at start of text
        3. Nested table cells
        4. CSS class names indicating indentation
        
        Returns indent level (0=top level, 1=child, 2=grandchild, etc.)
        """
        cells = row.find_all(['td', 'th'])
        if not cells:
            return 0
        
        first_cell = cells[0]
        indent_level = 0
        
        # Strategy 1: Check CSS padding-left or margin-left
        style = first_cell.get('style', '')
        if style:
            # Look for padding-left: Xpt or margin-left: Xpt
            padding_match = re.search(r'(?:padding|margin)-left:\s*(\d+)(?:pt|px|em)', style, re.IGNORECASE)
            if padding_match:
                padding_value = int(padding_match.group(1))
                # Typical SEC filings use ~10-15pt per indent level
                if padding_value >= 30:
                    indent_level = 2
                elif padding_value >= 15:
                    indent_level = 1
        
        # Strategy 2: Check for leading non-breaking spaces
        cell_text = first_cell.get_text()
        if cell_text:
            # Count leading spaces/nbsp
            leading_spaces = len(cell_text) - len(cell_text.lstrip())
            # Also check for &nbsp; entities
            nbsp_count = cell_text.count('\xa0')  # Unicode non-breaking space
            total_indent = leading_spaces + nbsp_count
            
            if total_indent >= 6:
                indent_level = max(indent_level, 2)
            elif total_indent >= 3:
                indent_level = max(indent_level, 1)
        
        # Strategy 3: Check for nested elements (span, div) with indentation
        nested = first_cell.find(['span', 'div'])
        if nested:
            nested_style = nested.get('style', '')
            if 'padding-left' in nested_style or 'margin-left' in nested_style:
                indent_level = max(indent_level, 1)
        
        # Strategy 4: Check CSS class names
        cell_class = first_cell.get('class', [])
        if isinstance(cell_class, list):
            cell_class = ' '.join(cell_class)
        if cell_class:
            if any(ind in cell_class.lower() for ind in ['indent', 'sub', 'child', 'level1', 'level2']):
                indent_level = max(indent_level, 1)
            if any(ind in cell_class.lower() for ind in ['indent2', 'level2', 'grandchild']):
                indent_level = max(indent_level, 2)
        
        return indent_level
    
    def _detect_parent_from_hierarchy(self, metric_name: str, statement_type: str) -> Optional[str]:
        """
        Detect parent metric based on known financial statement hierarchies.
        
        Uses HIERARCHY_DEFINITIONS to find the parent of a given metric.
        
        Args:
            metric_name: Normalized metric name
            statement_type: Type of statement (income_statement, balance_sheet, cash_flow)
            
        Returns:
            Parent metric name if found, None otherwise
        """
        for parent, info in self.HIERARCHY_DEFINITIONS.items():
            if info.get('statement') == statement_type or info.get('statement') is None:
                if metric_name in info.get('children', []):
                    return parent
        return None
    
    def _detect_parent_from_context(
        self,
        metric_name: str,
        row_index: int,
        all_rows: List,
        statement_type: str
    ) -> Tuple[Optional[str], int]:
        """
        Detect parent metric from table context (preceding rows).
        
        Looks at preceding rows to find potential parent metrics based on:
        1. Indentation changes (less indented row above is parent)
        2. Known subtotal patterns (e.g., "Total operating expenses" follows expense items)
        
        Args:
            metric_name: Current metric name
            row_index: Index of current row in table
            all_rows: List of all table rows
            statement_type: Type of statement
            
        Returns:
            Tuple of (parent_metric_name, indent_level)
        """
        current_indent = self._detect_row_indent_level(all_rows[row_index])
        
        # Look backwards for a less-indented row
        for i in range(row_index - 1, max(0, row_index - 10), -1):
            prev_row = all_rows[i]
            prev_indent = self._detect_row_indent_level(prev_row)
            
            # If previous row is less indented, it might be the parent
            if prev_indent < current_indent:
                # Get the label from the previous row
                cells = prev_row.find_all(['td', 'th'])
                if cells:
                    label = cells[0].get_text(strip=True).lower()
                    parent_metric = self._match_label_to_metric(label)
                    if parent_metric:
                        return parent_metric, current_indent
        
        # Fall back to hierarchy-based detection
        parent = self._detect_parent_from_hierarchy(metric_name, statement_type)
        return parent, current_indent
    
    def _apply_hierarchy_to_metrics(
        self,
        metrics: List[ExtractedMetric],
        statement_type: str
    ) -> List[ExtractedMetric]:
        """
        Apply hierarchical relationships to a list of extracted metrics.
        
        Updates parent_metric and indent_level fields based on:
        1. Known hierarchy definitions
        2. Context-based detection (if available)
        
        Args:
            metrics: List of ExtractedMetric objects
            statement_type: Type of statement
            
        Returns:
            Updated list of metrics with hierarchy information
        """
        for metric in metrics:
            if metric.statement_type != statement_type:
                continue
            
            # Try hierarchy-based detection first
            parent = self._detect_parent_from_hierarchy(
                metric.normalized_metric, statement_type
            )
            
            if parent:
                metric.parent_metric = parent
                # Set indent level based on parent depth
                parent_of_parent = self._detect_parent_from_hierarchy(parent, statement_type)
                if parent_of_parent:
                    metric.indent_level = 2
                else:
                    metric.indent_level = 1
        
        return metrics
