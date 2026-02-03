"""
iXBRL Parser - Extract financial data from inline XBRL tags in SEC filings

This parser extracts data from ix:nonFraction and ix:nonNumeric tags embedded
in SEC HTML filings. These tags contain semantic XBRL information that maps
directly to us-gaap taxonomy concepts.

Layer 1 of the Hybrid Parser approach.
"""

import re
import logging
import warnings
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from decimal import Decimal, InvalidOperation

# Suppress XML parsing warning - we handle both HTML and XML content
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

logger = logging.getLogger(__name__)


@dataclass
class IXBRLFact:
    """Represents a single iXBRL fact extracted from the filing"""
    name: str                    # Full XBRL tag name (e.g., us-gaap:Revenues)
    value: float                 # Numeric value
    raw_value: str              # Original text value
    context_ref: str            # Reference to context element
    unit_ref: Optional[str]     # Reference to unit element
    decimals: Optional[int]     # Decimal precision
    scale: int                  # Scale factor (0=units, 3=thousands, 6=millions, 9=billions)
    sign: int                   # 1 or -1 (for negated values)
    format: Optional[str]       # iXBRL format attribute
    # Parsed context info (populated later)
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    instant: Optional[str] = None
    period_type: str = "unknown"  # 'instant', 'duration', 'unknown'
    fiscal_period: str = ""       # Normalized: FY2024, Q1 2024, etc.
    dimensions: Dict[str, str] = field(default_factory=dict)


@dataclass 
class IXBRLContext:
    """Represents an XBRL context element"""
    id: str
    entity: Optional[str] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    instant: Optional[str] = None
    dimensions: Dict[str, str] = field(default_factory=dict)


class IXBRLParser:
    """
    Parser for inline XBRL (iXBRL) content in SEC filings.
    
    Extracts all ix:nonFraction tags which contain numeric financial data
    with semantic XBRL tagging.
    """
    
    # Scale mapping from iXBRL scale attribute
    SCALE_MAP = {
        '-6': -6,  # millionths
        '-3': -3,  # thousandths  
        '0': 0,    # units
        '3': 3,    # thousands
        '6': 6,    # millions
        '9': 9,    # billions
        '12': 12,  # trillions
    }
    
    def __init__(self):
        self.contexts: Dict[str, IXBRLContext] = {}
        self.units: Dict[str, str] = {}
        
    def parse(self, html_content: str, ticker: str = "") -> Dict[str, Any]:
        """
        Parse iXBRL content and extract all facts.
        
        Args:
            html_content: Raw HTML content of SEC filing
            ticker: Company ticker symbol
            
        Returns:
            Dictionary with:
            - facts: List of IXBRLFact objects
            - contexts: Dict of context definitions
            - units: Dict of unit definitions
            - metadata: Parsing statistics
        """
        soup = BeautifulSoup(html_content, 'lxml')
        
        # Step 1: Parse all context definitions
        self._parse_contexts(soup)
        logger.info(f"Parsed {len(self.contexts)} context definitions")
        
        # Step 2: Parse all unit definitions
        self._parse_units(soup)
        logger.info(f"Parsed {len(self.units)} unit definitions")
        
        # Step 3: Extract all ix:nonFraction facts (numeric data)
        numeric_facts = self._extract_numeric_facts(soup)
        logger.info(f"Extracted {len(numeric_facts)} numeric facts (ix:nonFraction)")
        
        # Step 4: Enrich facts with context information
        enriched_facts = self._enrich_facts_with_context(numeric_facts)
        
        # Step 5: Compute fiscal periods
        self._compute_fiscal_periods(enriched_facts, ticker)
        
        return {
            'facts': enriched_facts,
            'contexts': self.contexts,
            'units': self.units,
            'metadata': {
                'ticker': ticker,
                'total_facts': len(enriched_facts),
                'unique_concepts': len(set(f.name for f in enriched_facts)),
                'contexts_count': len(self.contexts),
                'units_count': len(self.units),
            }
        }
    
    def _parse_contexts(self, soup: BeautifulSoup) -> None:
        """Parse all xbrli:context elements"""
        self.contexts = {}
        
        # Find context elements (case-insensitive)
        context_tags = soup.find_all(re.compile(r'^xbrli?:context$', re.I))
        if not context_tags:
            # Try without namespace
            context_tags = soup.find_all('context')
        
        for ctx in context_tags:
            ctx_id = ctx.get('id', '')
            if not ctx_id:
                continue
                
            context = IXBRLContext(id=ctx_id)
            
            # Parse entity
            entity = ctx.find(re.compile(r'entity$', re.I))
            if entity:
                identifier = entity.find(re.compile(r'identifier$', re.I))
                if identifier:
                    context.entity = identifier.get_text(strip=True)
            
            # Parse period
            period = ctx.find(re.compile(r'period$', re.I))
            if period:
                # Check for instant
                instant = period.find(re.compile(r'instant$', re.I))
                if instant:
                    context.instant = instant.get_text(strip=True)
                else:
                    # Check for duration (startDate/endDate)
                    start = period.find(re.compile(r'startdate$', re.I))
                    end = period.find(re.compile(r'enddate$', re.I))
                    if start:
                        context.period_start = start.get_text(strip=True)
                    if end:
                        context.period_end = end.get_text(strip=True)
            
            # Parse dimensions (segment/scenario)
            segment = ctx.find(re.compile(r'segment$', re.I))
            if segment:
                for member in segment.find_all(re.compile(r'explicitmember$', re.I)):
                    dim = member.get('dimension', '')
                    val = member.get_text(strip=True)
                    if dim:
                        context.dimensions[dim] = val
            
            self.contexts[ctx_id] = context
    
    def _parse_units(self, soup: BeautifulSoup) -> None:
        """Parse all xbrli:unit elements"""
        self.units = {}
        
        unit_tags = soup.find_all(re.compile(r'^xbrli?:unit$', re.I))
        if not unit_tags:
            unit_tags = soup.find_all('unit')
        
        for unit in unit_tags:
            unit_id = unit.get('id', '')
            if not unit_id:
                continue
            
            # Get measure (e.g., iso4217:USD)
            measure = unit.find(re.compile(r'measure$', re.I))
            if measure:
                self.units[unit_id] = measure.get_text(strip=True)
            else:
                # Could be divide (for per-share, etc.)
                self.units[unit_id] = unit.get_text(strip=True)
    
    def _extract_numeric_facts(self, soup: BeautifulSoup) -> List[IXBRLFact]:
        """Extract all ix:nonFraction elements (numeric facts)"""
        facts = []
        
        # Find all ix:nonFraction tags (case-insensitive)
        nonfraction_tags = soup.find_all(re.compile(r'^ix:nonfraction$', re.I))
        
        for tag in nonfraction_tags:
            try:
                fact = self._parse_nonfraction_tag(tag)
                if fact:
                    facts.append(fact)
            except Exception as e:
                logger.debug(f"Error parsing ix:nonFraction tag: {e}")
                continue
        
        return facts
    
    def _parse_nonfraction_tag(self, tag) -> Optional[IXBRLFact]:
        """Parse a single ix:nonFraction tag into an IXBRLFact"""
        name = tag.get('name', '')
        if not name:
            return None
        
        # Get raw text value
        raw_value = tag.get_text(strip=True)
        
        # Get attributes
        context_ref = tag.get('contextref', '')
        unit_ref = tag.get('unitref', '')
        decimals_str = tag.get('decimals', '')
        scale_str = tag.get('scale', '0')
        format_attr = tag.get('format', '')
        sign_attr = tag.get('sign', '')
        
        # Parse decimals
        decimals = None
        if decimals_str and decimals_str.lower() != 'inf':
            try:
                decimals = int(decimals_str)
            except ValueError:
                pass
        
        # Parse scale
        scale = self.SCALE_MAP.get(scale_str, 0)
        
        # Determine sign (negative if sign="-" or wrapped in parentheses)
        sign = 1
        if sign_attr == '-':
            sign = -1
        elif raw_value.startswith('(') and raw_value.endswith(')'):
            sign = -1
        
        # Parse numeric value
        value = self._parse_numeric_value(raw_value, scale, sign, format_attr)
        if value is None:
            return None
        
        return IXBRLFact(
            name=name,
            value=value,
            raw_value=raw_value,
            context_ref=context_ref,
            unit_ref=unit_ref,
            decimals=decimals,
            scale=scale,
            sign=sign,
            format=format_attr,
        )
    
    def _parse_numeric_value(
        self, 
        raw_value: str, 
        scale: int, 
        sign: int,
        format_attr: str
    ) -> Optional[float]:
        """Parse numeric value from raw text, applying scale and sign"""
        if not raw_value:
            return None
        
        # Clean the value
        cleaned = raw_value.strip()
        
        # Remove parentheses (already handled sign)
        cleaned = cleaned.strip('()')
        
        # Remove currency symbols and commas
        cleaned = re.sub(r'[$€£¥,]', '', cleaned)
        
        # Remove spaces
        cleaned = cleaned.replace(' ', '')
        
        # Handle special formats
        if cleaned == '—' or cleaned == '-' or cleaned == '–':
            return 0.0
        
        # Handle percentage format
        if '%' in cleaned:
            cleaned = cleaned.replace('%', '')
            try:
                value = float(cleaned) / 100
                return value * sign
            except ValueError:
                return None
        
        # Parse the number
        try:
            value = float(cleaned)
        except ValueError:
            # Try handling European format (1.234,56)
            try:
                cleaned = cleaned.replace('.', '').replace(',', '.')
                value = float(cleaned)
            except ValueError:
                return None
        
        # Apply scale (e.g., scale=6 means millions, so multiply by 10^6)
        if scale != 0:
            value = value * (10 ** scale)
        
        # Apply sign
        value = value * sign
        
        return value
    
    def _enrich_facts_with_context(self, facts: List[IXBRLFact]) -> List[IXBRLFact]:
        """Add context information to each fact"""
        for fact in facts:
            ctx = self.contexts.get(fact.context_ref)
            if ctx:
                fact.period_start = ctx.period_start
                fact.period_end = ctx.period_end
                fact.instant = ctx.instant
                fact.dimensions = ctx.dimensions.copy()
                
                # Determine period type
                if ctx.instant:
                    fact.period_type = 'instant'
                elif ctx.period_start and ctx.period_end:
                    fact.period_type = 'duration'
        
        return facts
    
    def _compute_fiscal_periods(self, facts: List[IXBRLFact], ticker: str) -> None:
        """Compute normalized fiscal period labels for each fact"""
        for fact in facts:
            fact.fiscal_period = self._determine_fiscal_period(fact, ticker)
    
    def _determine_fiscal_period(self, fact: IXBRLFact, ticker: str) -> str:
        """Determine fiscal period label (FY2024, Q1 2024, etc.)"""
        if fact.period_type == 'instant':
            # For instant (balance sheet items), use the instant date
            if fact.instant:
                return self._date_to_fiscal_period(fact.instant, ticker, is_instant=True)
        elif fact.period_type == 'duration':
            # For duration (income/cash flow), use end date and duration
            if fact.period_end and fact.period_start:
                return self._date_to_fiscal_period(
                    fact.period_end, 
                    ticker, 
                    is_instant=False,
                    start_date=fact.period_start
                )
        return "Unknown"
    
    def _date_to_fiscal_period(
        self, 
        end_date: str, 
        ticker: str,
        is_instant: bool = False,
        start_date: Optional[str] = None
    ) -> str:
        """Convert date to fiscal period label"""
        try:
            from datetime import datetime, timedelta
            
            # Parse end date
            end_dt = datetime.fromisoformat(end_date.replace('Z', ''))
            year = end_dt.year
            month = end_dt.month
            
            if is_instant:
                # For balance sheet items, just use the year
                return f"FY{year}"
            
            # For duration items, calculate duration
            if start_date:
                start_dt = datetime.fromisoformat(start_date.replace('Z', ''))
                duration_days = (end_dt - start_dt).days
                
                # Annual: 330-380 days
                if 330 <= duration_days <= 380:
                    return f"FY{year}"
                
                # Quarterly: 80-100 days
                if 80 <= duration_days <= 100:
                    # Determine quarter based on end month
                    if month in [1, 2, 3]:
                        return f"Q1 {year}"
                    elif month in [4, 5, 6]:
                        return f"Q2 {year}"
                    elif month in [7, 8, 9]:
                        return f"Q3 {year}"
                    else:
                        return f"Q4 {year}"
                
                # 9-month period (YTD)
                if 260 <= duration_days <= 290:
                    return f"9M {year}"
                
                # 6-month period
                if 170 <= duration_days <= 200:
                    return f"6M {year}"
            
            # Fallback: use year
            return f"FY{year}"
            
        except Exception as e:
            logger.debug(f"Error parsing date {end_date}: {e}")
            return "Unknown"
    
    def get_facts_by_concept(self, facts: List[IXBRLFact], concept: str) -> List[IXBRLFact]:
        """Filter facts by XBRL concept name (partial match)"""
        concept_lower = concept.lower()
        return [f for f in facts if concept_lower in f.name.lower()]
    
    def get_consolidated_facts(self, facts: List[IXBRLFact]) -> List[IXBRLFact]:
        """Filter to only consolidated (non-dimensional) facts"""
        return [f for f in facts if not f.dimensions]
    
    def deduplicate_facts(self, facts: List[IXBRLFact]) -> List[IXBRLFact]:
        """Remove duplicate facts, keeping the most specific one"""
        # Group by (name, fiscal_period)
        groups: Dict[Tuple[str, str], List[IXBRLFact]] = {}
        
        for fact in facts:
            key = (fact.name, fact.fiscal_period)
            if key not in groups:
                groups[key] = []
            groups[key].append(fact)
        
        # For each group, prefer non-dimensional facts
        result = []
        for key, group in groups.items():
            # Sort: non-dimensional first, then by context_ref length (shorter = more general)
            group.sort(key=lambda f: (len(f.dimensions), len(f.context_ref)))
            result.append(group[0])
        
        return result
