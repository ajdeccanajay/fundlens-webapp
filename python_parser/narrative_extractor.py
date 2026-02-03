"""
Enhanced Narrative Extractor for SEC Filings
Extracts comprehensive text sections for LLM RAG
"""

from typing import List, Dict, Optional, Tuple
from bs4 import BeautifulSoup, NavigableString
import re
from dataclasses import dataclass


@dataclass
class NarrativeSection:
    """Represents a narrative section with metadata"""
    section_type: str
    section_title: str
    content: str
    start_page: Optional[int] = None
    item_number: Optional[str] = None
    word_count: int = 0


class EnhancedNarrativeExtractor:
    """
    Comprehensive narrative extraction for SEC filings
    Following sec_preprocessing_strategy.md requirements
    """
    
    # Comprehensive section patterns from strategy document
    SECTION_PATTERNS = {
        'business': {
            'keywords': [
                'ITEM 1. BUSINESS',
                'ITEM 1 BUSINESS',
                'Item 1. Business',
                'Description of Business',
                'THE BUSINESS',
            ],
            'item_number': '1',
            'priority': 1
        },
        'risk_factors': {
            'keywords': [
                'ITEM 1A. RISK FACTORS',
                'ITEM 1A RISK FACTORS',
                'Item 1A. Risk Factors',
                'RISK FACTORS',
                'Risk Factors',
            ],
            'item_number': '1A',
            'priority': 2
        },
        'unresolved_staff_comments': {
            'keywords': [
                'ITEM 1B. UNRESOLVED STAFF COMMENTS',
                'ITEM 1B UNRESOLVED STAFF COMMENTS',
                'Unresolved Staff Comments',
            ],
            'item_number': '1B',
            'priority': 3
        },
        'properties': {
            'keywords': [
                'ITEM 2. PROPERTIES',
                'ITEM 2 PROPERTIES',
                'Item 2. Properties',
            ],
            'item_number': '2',
            'priority': 4
        },
        'legal_proceedings': {
            'keywords': [
                'ITEM 3. LEGAL PROCEEDINGS',
                'ITEM 3 LEGAL PROCEEDINGS',
                'Item 3. Legal Proceedings',
            ],
            'item_number': '3',
            'priority': 5
        },
        'mda': {
            'keywords': [
                'ITEM 7. MANAGEMENT\'S DISCUSSION AND ANALYSIS',
                'ITEM 7 MANAGEMENT\'S DISCUSSION AND ANALYSIS',
                'Item 7. Management\'s Discussion and Analysis',
                'MANAGEMENT\'S DISCUSSION AND ANALYSIS',
                'MD&A',
                'MANAGEMENT DISCUSSION',
            ],
            'item_number': '7',
            'priority': 6
        },
        'financial_statements': {
            'keywords': [
                'ITEM 8. FINANCIAL STATEMENTS',
                'ITEM 8 FINANCIAL STATEMENTS',
                'Item 8. Financial Statements and Supplementary Data',
                'CONSOLIDATED FINANCIAL STATEMENTS',
            ],
            'item_number': '8',
            'priority': 7
        },
        'accounting_disagreements': {
            'keywords': [
                'ITEM 9. CHANGES IN AND DISAGREEMENTS',
                'ITEM 9 CHANGES IN AND DISAGREEMENTS',
                'Disagreements With Accountants',
            ],
            'item_number': '9',
            'priority': 8
        },
        'controls_procedures': {
            'keywords': [
                'ITEM 9A. CONTROLS AND PROCEDURES',
                'ITEM 9A CONTROLS AND PROCEDURES',
                'Item 9A. Controls and Procedures',
                'Internal Control Over Financial Reporting',
            ],
            'item_number': '9A',
            'priority': 9
        },
        'directors_officers': {
            'keywords': [
                'ITEM 10. DIRECTORS',
                'ITEM 10 DIRECTORS',
                'Item 10. Directors, Executive Officers',
                'DIRECTORS AND EXECUTIVE OFFICERS',
            ],
            'item_number': '10',
            'priority': 10
        },
        'executive_compensation': {
            'keywords': [
                'ITEM 11. EXECUTIVE COMPENSATION',
                'ITEM 11 EXECUTIVE COMPENSATION',
                'Item 11. Executive Compensation',
            ],
            'item_number': '11',
            'priority': 11
        },
        'security_ownership': {
            'keywords': [
                'ITEM 12. SECURITY OWNERSHIP',
                'ITEM 12 SECURITY OWNERSHIP',
                'Item 12. Security Ownership of Certain Beneficial Owners',
            ],
            'item_number': '12',
            'priority': 12
        },
        'related_transactions': {
            'keywords': [
                'ITEM 13. CERTAIN RELATIONSHIPS',
                'ITEM 13 CERTAIN RELATIONSHIPS',
                'Item 13. Certain Relationships and Related Transactions',
            ],
            'item_number': '13',
            'priority': 13
        },
        'principal_accountant': {
            'keywords': [
                'ITEM 14. PRINCIPAL ACCOUNTANT',
                'ITEM 14 PRINCIPAL ACCOUNTANT',
                'Item 14. Principal Accountant Fees and Services',
            ],
            'item_number': '14',
            'priority': 14
        },
        'exhibits': {
            'keywords': [
                'ITEM 15. EXHIBITS',
                'ITEM 15 EXHIBITS',
                'Item 15. Exhibits and Financial Statement Schedules',
            ],
            'item_number': '15',
            'priority': 15
        },
    }
    
    # Stop patterns to detect section boundaries
    STOP_PATTERNS = [
        r'ITEM\s+\d+[A-Z]?\.',
        r'Item\s+\d+[A-Z]?\.',
        r'PART\s+[IVX]+',
        r'Part\s+[IVX]+',
        r'SIGNATURES',
        r'INDEX TO EXHIBITS',
    ]
    
    def __init__(self, chunk_size: int = 1500, chunk_overlap: int = 200):
        """
        Initialize extractor
        
        Args:
            chunk_size: Number of words per chunk (strategy recommends 1500)
            chunk_overlap: Number of words to overlap (strategy recommends 200)
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
    
    def extract_all_sections(
        self,
        html_content: str,
        ticker: str,
        filing_type: str
    ) -> List[Dict]:
        """
        Extract all narrative sections from SEC filing
        
        Returns list of chunks with metadata for Bedrock KB
        """
        soup = BeautifulSoup(html_content, 'lxml')
        
        all_chunks = []
        
        # Extract each section type
        for section_type, config in self.SECTION_PATTERNS.items():
            sections = self._extract_section(soup, section_type, config)
            
            for section in sections:
                # Chunk the section text
                chunks = self._chunk_text(section.content)
                
                # Create metadata-rich chunks
                for idx, chunk_text in enumerate(chunks):
                    chunk_data = {
                        'ticker': ticker,
                        'filing_type': filing_type,
                        'section_type': section_type,
                        'section_title': section.section_title,
                        'item_number': section.item_number,
                        'chunk_index': idx,
                        'total_chunks': len(chunks),
                        'content': chunk_text,
                        'word_count': len(chunk_text.split()),
                        'start_page': section.start_page,
                    }
                    all_chunks.append(chunk_data)
        
        return all_chunks
    
    def _extract_section(
        self,
        soup: BeautifulSoup,
        section_type: str,
        config: Dict
    ) -> List[NarrativeSection]:
        """Extract a specific section type"""
        sections = []
        
        for keyword in config['keywords']:
            # Find section header
            header = self._find_section_header(soup, keyword)
            
            if header:
                # Extract text until next section
                content = self._extract_until_next_section(header)
                
                if content and len(content) > 200:  # Minimum content length
                    section = NarrativeSection(
                        section_type=section_type,
                        section_title=keyword,
                        content=content,
                        item_number=config.get('item_number'),
                        word_count=len(content.split())
                    )
                    sections.append(section)
                    break  # Found this section, move to next
        
        return sections
    
    def _find_section_header(self, soup: BeautifulSoup, keyword: str) -> Optional[any]:
        """Find section header with various strategies"""
        # Strategy 1: Exact text match
        header = soup.find(text=re.compile(re.escape(keyword), re.I))
        if header:
            return header.parent
        
        # Strategy 2: Look in common header tags
        for tag in ['h1', 'h2', 'h3', 'h4', 'b', 'strong', 'span', 'div', 'p']:
            elements = soup.find_all(tag)
            for elem in elements:
                text = elem.get_text().strip()
                if keyword.lower() in text.lower():
                    return elem
        
        return None
    
    def _extract_until_next_section(self, start_element) -> str:
        """Extract text from start element until next major section"""
        text_parts = []
        current = start_element
        
        # Skip the header itself
        current = current.find_next_sibling()
        
        max_iterations = 500  # Prevent infinite loops
        iteration = 0
        
        while current and iteration < max_iterations:
            iteration += 1
            
            # Check if we hit a stop pattern (next section)
            text = current.get_text().strip()
            
            if self._is_section_boundary(text):
                break
            
            # Skip tables (we extract those separately)
            if current.name == 'table':
                current = current.find_next_sibling()
                continue
            
            # Collect meaningful text
            if text and len(text) > 20:  # Skip very short fragments
                # Clean the text
                cleaned = self._clean_text(text)
                if cleaned:
                    text_parts.append(cleaned)
            
            current = current.find_next_sibling()
        
        return '\n\n'.join(text_parts)
    
    def _is_section_boundary(self, text: str) -> bool:
        """Check if text indicates a new section"""
        if not text:
            return False
        
        # Check against stop patterns
        for pattern in self.STOP_PATTERNS:
            if re.match(pattern, text.strip(), re.I):
                return True
        
        return False
    
    def _clean_text(self, text: str) -> str:
        """Clean extracted text"""
        # Remove excessive whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Remove page numbers (common pattern)
        text = re.sub(r'\b\d+\s*$', '', text)
        
        # Remove common artifacts
        text = re.sub(r'\xa0', ' ', text)  # Non-breaking space
        text = re.sub(r'\u200b', '', text)  # Zero-width space
        
        return text.strip()
    
    def _chunk_text(self, text: str) -> List[str]:
        """
        Chunk text with fixed size and overlap
        Following strategy: 1500 words per chunk, 200 word overlap
        """
        words = text.split()
        chunks = []
        
        i = 0
        while i < len(words):
            # Get chunk
            chunk_words = words[i:i + self.chunk_size]
            chunk_text = ' '.join(chunk_words)
            
            if chunk_text:
                chunks.append(chunk_text)
            
            # Move forward with overlap
            i += self.chunk_size - self.chunk_overlap
        
        return chunks
    
    def extract_full_document_text(self, html_content: str) -> str:
        """
        Extract ALL text from document (for full-text search)
        Removes tables but keeps all narrative content
        """
        soup = BeautifulSoup(html_content, 'lxml')
        
        # Remove tables (we extract those separately)
        for table in soup.find_all('table'):
            table.decompose()
        
        # Remove scripts and styles
        for script in soup.find_all(['script', 'style']):
            script.decompose()
        
        # Get all text
        text = soup.get_text(separator='\n')
        
        # Clean
        text = self._clean_text(text)
        
        return text
