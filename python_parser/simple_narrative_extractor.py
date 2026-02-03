"""
Simple but effective narrative extractor for SEC filings
Extracts all meaningful text for LLM RAG
"""

from typing import List, Dict
from bs4 import BeautifulSoup
import re


class SimpleNarrativeExtractor:
    """
    Extract narrative text from SEC filings
    Strategy: Extract ALL text, chunk it, let LLM figure out what's relevant
    """
    
    def __init__(self, chunk_size: int = 1500, chunk_overlap: int = 200):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
    
    def extract_all_text(
        self,
        html_content: str,
        ticker: str,
        filing_type: str
    ) -> List[Dict]:
        """
        Extract all narrative text from filing
        Returns chunks with metadata for Bedrock KB
        """
        soup = BeautifulSoup(html_content, 'lxml')
        
        # Remove tables (we extract those separately)
        for table in soup.find_all('table'):
            table.decompose()
        
        # Remove scripts, styles, and other non-content
        for tag in soup.find_all(['script', 'style', 'meta', 'link']):
            tag.decompose()
        
        # Get all text
        full_text = soup.get_text(separator='\n')
        
        # Clean the text
        full_text = self._clean_text(full_text)
        
        # Chunk the text
        chunks = self._chunk_text(full_text)
        
        # Create metadata-rich chunks
        result = []
        for idx, chunk_text in enumerate(chunks):
            # Try to detect section type from content
            section_type = self._detect_section_type(chunk_text)
            
            result.append({
                'ticker': ticker,
                'filing_type': filing_type,
                'section_type': section_type,
                'chunk_index': idx,
                'total_chunks': len(chunks),
                'content': chunk_text,
                'word_count': len(chunk_text.split()),
            })
        
        return result
    
    def _clean_text(self, text: str) -> str:
        """Clean extracted text"""
        # Remove excessive whitespace
        text = re.sub(r'\n\s*\n\s*\n+', '\n\n', text)  # Max 2 newlines
        text = re.sub(r' +', ' ', text)  # Multiple spaces to single
        
        # Remove page numbers and common artifacts
        text = re.sub(r'\n\s*\d+\s*\n', '\n', text)  # Standalone page numbers
        text = re.sub(r'\xa0', ' ', text)  # Non-breaking space
        text = re.sub(r'\u200b', '', text)  # Zero-width space
        
        # Remove very short lines (likely artifacts)
        lines = text.split('\n')
        cleaned_lines = [line for line in lines if len(line.strip()) > 3 or line.strip() == '']
        
        return '\n'.join(cleaned_lines).strip()
    
    def _chunk_text(self, text: str) -> List[str]:
        """
        Chunk text with fixed size and overlap
        Strategy: 1500 words per chunk, 200 word overlap
        """
        words = text.split()
        chunks = []
        
        i = 0
        while i < len(words):
            # Get chunk
            chunk_words = words[i:i + self.chunk_size]
            chunk_text = ' '.join(chunk_words)
            
            if chunk_text and len(chunk_text) > 100:  # Minimum chunk size
                chunks.append(chunk_text)
            
            # Move forward with overlap
            i += self.chunk_size - self.chunk_overlap
        
        return chunks
    
    def _detect_section_type(self, text: str) -> str:
        """
        Detect section type from content keywords
        """
        text_lower = text.lower()
        
        # Check for section keywords
        if any(kw in text_lower for kw in ['risk factor', 'risks related', 'risk that']):
            return 'risk_factors'
        elif any(kw in text_lower for kw in ['management discussion', 'md&a', 'results of operations']):
            return 'mda'
        elif any(kw in text_lower for kw in ['business', 'products and services', 'our business']):
            return 'business'
        elif any(kw in text_lower for kw in ['legal proceedings', 'litigation']):
            return 'legal_proceedings'
        elif any(kw in text_lower for kw in ['properties', 'facilities']):
            return 'properties'
        elif any(kw in text_lower for kw in ['executive compensation', 'compensation discussion']):
            return 'executive_compensation'
        elif any(kw in text_lower for kw in ['directors', 'officers', 'governance']):
            return 'directors_officers'
        elif any(kw in text_lower for kw in ['controls and procedures', 'internal control']):
            return 'controls_procedures'
        else:
            return 'general'
