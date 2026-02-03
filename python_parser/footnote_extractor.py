"""
Footnote Extractor for SEC Filings
Extracts footnotes and links them to financial metrics
Integrates with FootnoteLinkingService
"""

from typing import List, Dict, Optional, Tuple
from bs4 import BeautifulSoup, NavigableString
import re
from dataclasses import dataclass, asdict


@dataclass
class ExtractedFootnote:
    """Represents an extracted footnote"""
    footnote_number: str
    section_title: str
    content: str
    html_content: str
    tables: List[Dict] = None
    lists: List[str] = None
    
    def __post_init__(self):
        if self.tables is None:
            self.tables = []
        if self.lists is None:
            self.lists = []


class FootnoteExtractor:
    """
    Extract footnotes from SEC filings
    Designed to work with FootnoteLinkingService
    """
    
    # Footnote section patterns
    FOOTNOTE_SECTION_PATTERNS = [
        r'NOTES?\s+TO\s+(?:CONSOLIDATED\s+)?FINANCIAL\s+STATEMENTS',
        r'NOTES?\s+TO\s+(?:THE\s+)?(?:CONSOLIDATED\s+)?STATEMENTS',
        r'FINANCIAL\s+STATEMENT\s+NOTES?',
    ]
    
    # Individual footnote patterns
    FOOTNOTE_PATTERNS = [
        r'(?:^|\n)\s*(?:Note|NOTE)\s+(\d+)[:\.\-\s]+([^\n]+)',  # Note 1: Title
        r'(?:^|\n)\s*(\d+)\.\s+([A-Z][^\n]+)',  # 1. Title
        r'(?:^|\n)\s*\((\d+)\)\s+([A-Z][^\n]+)',  # (1) Title
    ]
    
    def __init__(self):
        self.footnotes: List[ExtractedFootnote] = []
    
    def extract_footnotes(self, html_content: str) -> List[ExtractedFootnote]:
        """
        Extract all footnotes from HTML content
        
        Args:
            html_content: Raw HTML from SEC filing
            
        Returns:
            List of ExtractedFootnote objects
        """
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Find footnote section
        footnote_section = self._find_footnote_section(soup)
        if not footnote_section:
            return []
        
        # Extract individual footnotes
        footnotes = self._extract_individual_footnotes(footnote_section)
        
        self.footnotes = footnotes
        return footnotes
    
    def _find_footnote_section(self, soup: BeautifulSoup) -> Optional[BeautifulSoup]:
        """Find the footnote section in the document"""
        
        for pattern in self.FOOTNOTE_SECTION_PATTERNS:
            # Search in text content
            for element in soup.find_all(['div', 'section', 'p', 'span']):
                text = element.get_text()
                if re.search(pattern, text, re.IGNORECASE):
                    # Found footnote section, return parent container
                    parent = element.find_parent(['div', 'section', 'body'])
                    if parent:
                        return parent
                    return element
        
        return None
    
    def _extract_individual_footnotes(
        self, 
        section: BeautifulSoup
    ) -> List[ExtractedFootnote]:
        """Extract individual footnotes from section"""
        
        footnotes = []
        text = section.get_text()
        
        # Try each pattern
        for pattern in self.FOOTNOTE_PATTERNS:
            matches = re.finditer(pattern, text, re.MULTILINE)
            
            for match in matches:
                footnote_num = match.group(1)
                title = match.group(2).strip()
                
                # Extract content for this footnote
                content, html_content = self._extract_footnote_content(
                    section, 
                    footnote_num,
                    match.end()
                )
                
                if content:
                    # Extract structured data
                    tables = self._extract_tables_from_html(html_content)
                    lists = self._extract_lists_from_text(content)
                    
                    footnote = ExtractedFootnote(
                        footnote_number=footnote_num,
                        section_title=title,
                        content=content,
                        html_content=html_content,
                        tables=tables,
                        lists=lists
                    )
                    
                    footnotes.append(footnote)
        
        # Remove duplicates (same footnote number)
        seen = set()
        unique_footnotes = []
        for fn in footnotes:
            if fn.footnote_number not in seen:
                seen.add(fn.footnote_number)
                unique_footnotes.append(fn)
        
        return sorted(unique_footnotes, key=lambda x: int(x.footnote_number))
    
    def _extract_footnote_content(
        self,
        section: BeautifulSoup,
        footnote_num: str,
        start_pos: int
    ) -> Tuple[str, str]:
        """Extract content for a specific footnote"""
        
        text = section.get_text()
        
        # Find next footnote to determine end
        next_footnote_pattern = r'(?:^|\n)\s*(?:Note|NOTE|\d+\.|\(\d+\))\s+(?:\d+|[A-Z])'
        next_match = re.search(next_footnote_pattern, text[start_pos:], re.MULTILINE)
        
        if next_match:
            end_pos = start_pos + next_match.start()
        else:
            end_pos = len(text)
        
        content = text[start_pos:end_pos].strip()
        
        # Limit to 5000 characters
        if len(content) > 5000:
            content = content[:5000]
        
        # Get HTML content (simplified)
        html_content = str(section)[:10000]  # Limit HTML size
        
        return content, html_content
    
    def _extract_tables_from_html(self, html_content: str) -> List[Dict]:
        """Extract tables from HTML"""
        
        soup = BeautifulSoup(html_content, 'html.parser')
        tables = []
        
        for table in soup.find_all('table'):
            # Extract headers
            headers = []
            for th in table.find_all('th'):
                headers.append(th.get_text().strip())
            
            # Extract rows
            rows = []
            for tr in table.find_all('tr'):
                cells = []
                for td in tr.find_all('td'):
                    cells.append(td.get_text().strip())
                if cells:
                    rows.append(cells)
            
            if rows:
                tables.append({
                    'headers': headers,
                    'rows': rows
                })
        
        return tables
    
    def _extract_lists_from_text(self, text: str) -> List[str]:
        """Extract bullet points and numbered lists"""
        
        items = []
        
        # Bullet points
        bullet_pattern = r'^[\s]*[•\-\*]\s+(.+)$'
        for match in re.finditer(bullet_pattern, text, re.MULTILINE):
            items.append(match.group(1).strip())
        
        # Numbered lists
        numbered_pattern = r'^[\s]*\d+\.\s+(.+)$'
        for match in re.finditer(numbered_pattern, text, re.MULTILINE):
            items.append(match.group(1).strip())
        
        return items
    
    def to_dict(self) -> List[Dict]:
        """Convert footnotes to dictionary format"""
        return [asdict(fn) for fn in self.footnotes]


def extract_footnotes_from_filing(html_content: str) -> List[Dict]:
    """
    Convenience function to extract footnotes from filing
    
    Args:
        html_content: Raw HTML from SEC filing
        
    Returns:
        List of footnote dictionaries
    """
    extractor = FootnoteExtractor()
    footnotes = extractor.extract_footnotes(html_content)
    return extractor.to_dict()


# Singleton instance
_extractor_instance = None


def get_footnote_extractor() -> FootnoteExtractor:
    """Get singleton footnote extractor instance"""
    global _extractor_instance
    if _extractor_instance is None:
        _extractor_instance = FootnoteExtractor()
    return _extractor_instance
