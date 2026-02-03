"""
Reporting Unit Extractor - Extracts reporting units from SEC filings

This module extracts reporting units (millions, thousands, billions, etc.) from
SEC filing headers and table headers. It handles complex patterns like:
- "(In millions, except number of shares, which are reflected in thousands, and per-share amounts)"
- "(Dollars in millions)"
- "(In thousands)"

The extracted units are used to properly format values in Excel exports to match
the original SEC filing presentation.
"""

import re
import logging
from typing import Optional, List, Tuple
from dataclasses import dataclass
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


@dataclass
class ReportingUnitInfo:
    """
    Extracted reporting unit information from SEC filing.
    
    Attributes:
        default_unit: The primary unit for most values ('units', 'thousands', 'millions', 'billions')
        share_unit: Unit for share-related metrics (may differ from default_unit)
        per_share_unit: Unit for per-share amounts (usually 'units' for actual dollar amounts)
        source: Where the unit was extracted from ('header', 'table_header', 'ixbrl_scale', 'default')
        raw_pattern: The raw text pattern that was matched (for debugging/audit)
    """
    default_unit: str = 'units'
    share_unit: str = 'units'
    per_share_unit: str = 'units'
    source: str = 'default'
    raw_pattern: Optional[str] = None


class ReportingUnitExtractor:
    """
    Extracts reporting units from SEC filings.
    
    Handles patterns like:
    - "(In millions, except number of shares, which are reflected in thousands, and per-share amounts)"
    - "(Dollars in millions)"
    - "(In thousands)"
    - "$in millions"
    - "Amounts in thousands"
    
    The extractor searches filing headers and table headers to find unit specifications,
    then provides methods to determine the correct unit for each metric type.
    """
    
    # Supported unit values
    VALID_UNITS = {'units', 'thousands', 'millions', 'billions'}
    
    # Unit name normalization
    UNIT_ALIASES = {
        'million': 'millions',
        'thousand': 'thousands',
        'billion': 'billions',
        'unit': 'units',
    }
    
    # Common patterns for reporting unit extraction (ordered by specificity)
    UNIT_PATTERNS = [
        # Full pattern with share and per-share exceptions
        # "(In millions, except number of shares, which are reflected in thousands, and per-share amounts)"
        re.compile(
            r'\(?\s*(?:In|Dollars?\s+in|Amounts?\s+in)\s+'
            r'(millions?|thousands?|billions?)'
            r'(?:,?\s*except\s+(?:number\s+of\s+)?shares?,?\s*'
            r'which\s+are\s+(?:reflected\s+)?in\s+(millions?|thousands?|billions?))?'
            r'(?:,?\s*and\s+per[- ]?share\s+amounts?)?'
            r'\s*\)?',
            re.IGNORECASE
        ),
        
        # Pattern with share exception only
        # "(In millions, except shares in thousands)"
        re.compile(
            r'\(?\s*(?:In|Dollars?\s+in|Amounts?\s+in)\s+'
            r'(millions?|thousands?|billions?)'
            r'(?:,?\s*except\s+(?:for\s+)?(?:number\s+of\s+)?shares?\s+'
            r'(?:which\s+are\s+)?(?:in\s+)?(millions?|thousands?|billions?))?'
            r'\s*\)?',
            re.IGNORECASE
        ),
        
        # Simple parenthetical pattern
        # "(In millions)" or "(Dollars in thousands)"
        re.compile(
            r'\(\s*(?:In|Dollars?\s+in|Amounts?\s+in|USD\s+in)\s+'
            r'(millions?|thousands?|billions?)\s*\)',
            re.IGNORECASE
        ),
        
        # Table header pattern with dollar sign
        # "$in millions" or "$ in thousands"
        re.compile(
            r'\$\s*in\s+(millions?|thousands?|billions?)',
            re.IGNORECASE
        ),
        
        # Pattern for "Dollars in millions" without parentheses
        re.compile(
            r'Dollars?\s+in\s+(millions?|thousands?|billions?)',
            re.IGNORECASE
        ),
        
        # Pattern for "Amounts in thousands" without parentheses
        re.compile(
            r'Amounts?\s+in\s+(millions?|thousands?|billions?)',
            re.IGNORECASE
        ),
        
        # Pattern for "($ in millions)" with dollar sign inside parens
        re.compile(
            r'\(\s*\$\s*in\s+(millions?|thousands?|billions?)\s*\)',
            re.IGNORECASE
        ),
        
        # Pattern for "expressed in millions"
        re.compile(
            r'expressed\s+in\s+(millions?|thousands?|billions?)',
            re.IGNORECASE
        ),
        
        # Pattern for "stated in millions"
        re.compile(
            r'stated\s+in\s+(millions?|thousands?|billions?)',
            re.IGNORECASE
        ),
        
        # Pattern for "reported in millions"
        re.compile(
            r'reported\s+in\s+(millions?|thousands?|billions?)',
            re.IGNORECASE
        ),
        
        # Pattern for "figures in millions"
        re.compile(
            r'figures?\s+in\s+(millions?|thousands?|billions?)',
            re.IGNORECASE
        ),
        
        # Pattern for "values in millions"
        re.compile(
            r'values?\s+in\s+(millions?|thousands?|billions?)',
            re.IGNORECASE
        ),
        
        # Pattern for "data in millions"
        re.compile(
            r'data\s+in\s+(millions?|thousands?|billions?)',
            re.IGNORECASE
        ),
        
        # Pattern for "(000s)" or "(000's)" indicating thousands
        re.compile(
            r"\(\s*000'?s?\s*\)",
            re.IGNORECASE
        ),
        
        # Pattern for "(000,000s)" indicating millions
        re.compile(
            r"\(\s*000,?000'?s?\s*\)",
            re.IGNORECASE
        ),
        
        # Standalone pattern (less specific) - must be last
        # "in millions" or "amounts in thousands"
        re.compile(
            r'(?:amounts?\s+)?in\s+(millions?|thousands?|billions?)',
            re.IGNORECASE
        ),
    ]
    
    # Patterns to identify share-related metrics
    SHARE_METRIC_PATTERNS = [
        re.compile(r'shares?\s*outstanding', re.IGNORECASE),
        re.compile(r'weighted\s*average\s*shares?', re.IGNORECASE),
        re.compile(r'number\s*of\s*shares?', re.IGNORECASE),
        re.compile(r'common\s*shares?', re.IGNORECASE),
        re.compile(r'diluted\s*shares?', re.IGNORECASE),
        re.compile(r'basic\s*shares?', re.IGNORECASE),
    ]
    
    # Patterns to identify per-share metrics
    PER_SHARE_METRIC_PATTERNS = [
        re.compile(r'per\s*share', re.IGNORECASE),
        re.compile(r'earnings\s*per', re.IGNORECASE),
        re.compile(r'eps', re.IGNORECASE),
        re.compile(r'dividend.*per', re.IGNORECASE),
    ]
    
    def __init__(self):
        """Initialize the ReportingUnitExtractor."""
        pass
    
    def _normalize_unit(self, unit_str: str) -> str:
        """
        Normalize unit string to standard format.
        
        Args:
            unit_str: Raw unit string (e.g., 'million', 'Millions', 'THOUSANDS', '000s')
            
        Returns:
            Normalized unit string ('millions', 'thousands', 'billions', or 'units')
        """
        if not unit_str:
            return 'units'
        
        unit_lower = unit_str.lower().strip()
        
        # Handle special numeric patterns
        if unit_lower in ["000's", "000s", "(000s)", "(000's)"]:
            return 'thousands'
        if unit_lower in ["000,000's", "000,000s", "(000,000s)", "(000,000's)"]:
            return 'millions'
        
        # Check aliases first
        if unit_lower in self.UNIT_ALIASES:
            return self.UNIT_ALIASES[unit_lower]
        
        # Check if already valid
        if unit_lower in self.VALID_UNITS:
            return unit_lower
        
        # Default to units
        return 'units'
    
    def extract_from_filing(self, html_content: str) -> ReportingUnitInfo:
        """
        Extract reporting unit from filing header or table headers.
        
        Searches the filing in this order:
        1. Document header/title area (first 5000 chars)
        2. Table headers in financial statement tables
        3. Any parenthetical unit specifications
        
        Args:
            html_content: Raw HTML content of SEC filing
            
        Returns:
            ReportingUnitInfo with extracted unit information
        """
        if not html_content:
            return ReportingUnitInfo(source='default')
        
        soup = BeautifulSoup(html_content, 'lxml')
        
        # Strategy 1: Search document header area
        header_result = self._extract_from_header_area(soup, html_content)
        if header_result and header_result.source != 'default':
            logger.info(f"Found reporting unit in header: {header_result.default_unit}")
            return header_result
        
        # Strategy 2: Search table headers
        table_result = self._extract_from_table_headers(soup)
        if table_result and table_result.source != 'default':
            logger.info(f"Found reporting unit in table header: {table_result.default_unit}")
            return table_result
        
        # Strategy 3: Search entire document for unit patterns
        full_result = self._extract_from_full_text(html_content)
        if full_result and full_result.source != 'default':
            logger.info(f"Found reporting unit in document text: {full_result.default_unit}")
            return full_result
        
        # Default: no unit found
        logger.debug("No reporting unit found, defaulting to 'units'")
        return ReportingUnitInfo(source='default')
    
    def _extract_from_header_area(
        self, 
        soup: BeautifulSoup, 
        html_content: str
    ) -> Optional[ReportingUnitInfo]:
        """
        Extract reporting unit from document header area.
        
        Searches the first portion of the document where unit specifications
        typically appear (near the company name and filing title).
        """
        # Search first 10000 characters of raw HTML
        header_text = html_content[:10000]
        
        for pattern in self.UNIT_PATTERNS:
            match = pattern.search(header_text)
            if match:
                return self._parse_unit_match(match, 'header')
        
        # Also search title and header elements
        for elem in soup.find_all(['title', 'h1', 'h2', 'h3', 'div', 'span', 'p'])[:50]:
            text = elem.get_text(strip=True)
            if len(text) > 500:  # Skip very long text blocks
                continue
            
            for pattern in self.UNIT_PATTERNS:
                match = pattern.search(text)
                if match:
                    return self._parse_unit_match(match, 'header')
        
        return None
    
    def _extract_from_table_headers(self, soup: BeautifulSoup) -> Optional[ReportingUnitInfo]:
        """
        Extract reporting unit from table headers.
        
        Searches table caption, thead, and first few rows for unit specifications.
        """
        # Find all tables
        tables = soup.find_all('table')
        
        for table in tables[:20]:  # Check first 20 tables
            # Check table caption
            caption = table.find('caption')
            if caption:
                text = caption.get_text(strip=True)
                for pattern in self.UNIT_PATTERNS:
                    match = pattern.search(text)
                    if match:
                        return self._parse_unit_match(match, 'table_header')
            
            # Check thead
            thead = table.find('thead')
            if thead:
                text = thead.get_text(strip=True)
                for pattern in self.UNIT_PATTERNS:
                    match = pattern.search(text)
                    if match:
                        return self._parse_unit_match(match, 'table_header')
            
            # Check first few rows
            rows = table.find_all('tr')[:5]
            for row in rows:
                text = row.get_text(strip=True)
                if len(text) > 500:  # Skip data rows
                    continue
                
                for pattern in self.UNIT_PATTERNS:
                    match = pattern.search(text)
                    if match:
                        return self._parse_unit_match(match, 'table_header')
        
        return None
    
    def extract_from_table_header(self, table_element) -> Optional[str]:
        """
        Extract reporting unit from a specific table's header.
        
        This method is designed for use during HTML table parsing to detect
        table-specific units that may override the filing-level default.
        
        Searches for unit patterns in:
        1. Table caption
        2. Table thead
        3. First few rows (header rows)
        4. Cells with unit indicators
        
        Args:
            table_element: BeautifulSoup table element
            
        Returns:
            Unit string ('millions', 'thousands', etc.) if found, None otherwise
        """
        if not table_element:
            return None
        
        # Check caption
        caption = table_element.find('caption')
        if caption:
            text = caption.get_text(strip=True)
            unit = self._extract_unit_from_text(text)
            if unit:
                return unit
        
        # Check thead
        thead = table_element.find('thead')
        if thead:
            text = thead.get_text(strip=True)
            unit = self._extract_unit_from_text(text)
            if unit:
                return unit
        
        # Check first few rows (often contain unit info)
        rows = table_element.find_all('tr')[:5]
        for row in rows:
            # Check full row text
            text = row.get_text(strip=True)
            if len(text) < 500:  # Skip data rows
                unit = self._extract_unit_from_text(text)
                if unit:
                    return unit
            
            # Check individual cells for unit indicators
            cells = row.find_all(['th', 'td'])
            for cell in cells:
                cell_text = cell.get_text(strip=True)
                if len(cell_text) < 200:
                    unit = self._extract_unit_from_text(cell_text)
                    if unit:
                        return unit
        
        # Check for unit in table title (div/span before table)
        prev_sibling = table_element.find_previous_sibling(['div', 'span', 'p'])
        if prev_sibling:
            text = prev_sibling.get_text(strip=True)
            if len(text) < 300:
                unit = self._extract_unit_from_text(text)
                if unit:
                    return unit
        
        return None
    
    def _extract_unit_from_text(self, text: str) -> Optional[str]:
        """
        Extract unit from a text string using all patterns.
        
        Args:
            text: Text to search for unit patterns
            
        Returns:
            Normalized unit string if found, None otherwise
        """
        if not text:
            return None
        
        # Check for special numeric patterns first
        if re.search(r"\(\s*000,?000'?s?\s*\)", text, re.IGNORECASE):
            return 'millions'
        if re.search(r"\(\s*000'?s?\s*\)", text, re.IGNORECASE):
            return 'thousands'
        
        for pattern in self.UNIT_PATTERNS:
            match = pattern.search(text)
            if match:
                groups = match.groups()
                if groups and groups[0]:
                    return self._normalize_unit(groups[0])
        
        return None
        
        return None
    
    def _extract_from_full_text(self, html_content: str) -> Optional[ReportingUnitInfo]:
        """
        Extract reporting unit from full document text.
        
        Last resort - searches entire document for unit patterns.
        """
        # Remove HTML tags for cleaner search
        text = re.sub(r'<[^>]+>', ' ', html_content)
        text = re.sub(r'\s+', ' ', text)
        
        # Search first 50000 characters
        search_text = text[:50000]
        
        for pattern in self.UNIT_PATTERNS:
            match = pattern.search(search_text)
            if match:
                return self._parse_unit_match(match, 'document_text')
        
        return None
    
    def _parse_unit_match(self, match: re.Match, source: str) -> ReportingUnitInfo:
        """
        Parse a regex match into ReportingUnitInfo.
        
        Handles patterns with optional share unit exceptions.
        """
        groups = match.groups()
        
        # First group is always the default unit
        default_unit = self._normalize_unit(groups[0]) if groups[0] else 'units'
        
        # Second group (if present) is the share unit exception
        share_unit = default_unit  # Default to same as main unit
        if len(groups) > 1 and groups[1]:
            share_unit = self._normalize_unit(groups[1])
        
        # Per-share amounts are always in actual units (dollars, not millions)
        per_share_unit = 'units'
        
        # Capture the raw matched text for debugging/audit
        raw_pattern = match.group(0) if match else None
        
        return ReportingUnitInfo(
            default_unit=default_unit,
            share_unit=share_unit,
            per_share_unit=per_share_unit,
            source=source,
            raw_pattern=raw_pattern,
        )
    
    def get_unit_for_metric(
        self, 
        metric_name: str, 
        unit_info: ReportingUnitInfo
    ) -> str:
        """
        Determine the correct unit for a specific metric type.
        
        Different metrics may have different units within the same filing:
        - Most financial values: default_unit (e.g., millions)
        - Share counts: share_unit (e.g., thousands)
        - Per-share amounts (EPS, DPS): per_share_unit (always 'units')
        
        Args:
            metric_name: Normalized metric name (e.g., 'revenue', 'weighted_average_shares_basic')
            unit_info: ReportingUnitInfo from extract_from_filing()
            
        Returns:
            Appropriate unit string for this metric
        """
        if not metric_name:
            return unit_info.default_unit
        
        metric_lower = metric_name.lower()
        
        # Check for per-share metrics first (highest priority)
        for pattern in self.PER_SHARE_METRIC_PATTERNS:
            if pattern.search(metric_lower):
                return unit_info.per_share_unit
        
        # Check for per-share by common metric names
        per_share_metrics = [
            'earnings_per_share',
            'eps',
            'diluted_eps',
            'basic_eps',
            'dividend_per_share',
            'dividends_per_share',
            'book_value_per_share',
        ]
        if any(ps in metric_lower for ps in per_share_metrics):
            return unit_info.per_share_unit
        
        # Check for share-related metrics
        for pattern in self.SHARE_METRIC_PATTERNS:
            if pattern.search(metric_lower):
                return unit_info.share_unit
        
        # Check for share metrics by common names
        share_metrics = [
            'weighted_average_shares',
            'shares_outstanding',
            'common_shares',
            'diluted_shares',
            'basic_shares',
            'share_count',
            'number_of_shares',
        ]
        if any(sm in metric_lower for sm in share_metrics):
            return unit_info.share_unit
        
        # Default to the main unit
        return unit_info.default_unit
    
    def scale_to_unit(self, scale: int) -> str:
        """
        Convert iXBRL scale factor to reporting unit string.
        
        This is a utility method for converting iXBRL scale attributes
        to human-readable unit strings.
        
        Args:
            scale: iXBRL scale factor (0=units, 3=thousands, 6=millions, 9=billions)
            
        Returns:
            Reporting unit string
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


# Singleton instance for convenience
_extractor_instance: Optional[ReportingUnitExtractor] = None


def get_extractor() -> ReportingUnitExtractor:
    """Get singleton ReportingUnitExtractor instance."""
    global _extractor_instance
    if _extractor_instance is None:
        _extractor_instance = ReportingUnitExtractor()
    return _extractor_instance
