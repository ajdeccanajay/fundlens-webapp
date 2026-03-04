"""
DEF 14A (Proxy Statement) Parser

Keyword-based section detection for proxy statements.
Phase 3 of Filing Expansion spec (§2.4, §3.4).

Proxy statements have NO standardized section numbering — the messiest SEC filing type.
We use keyword matching to identify sections, then chunk within each section.
"""

import re
import logging
from typing import Dict, List, Any, Optional
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Section keywords for proxy statement detection (§2.4)
PROXY_SECTIONS = {
    'executive_compensation': [
        'EXECUTIVE COMPENSATION', 'COMPENSATION DISCUSSION AND ANALYSIS',
        'CD&A', 'COMPENSATION OF EXECUTIVE', 'NAMED EXECUTIVE OFFICER',
        'SUMMARY COMPENSATION TABLE',
    ],
    'director_compensation': [
        'DIRECTOR COMPENSATION', 'COMPENSATION OF DIRECTORS',
        'NON-EMPLOYEE DIRECTOR', 'DIRECTOR FEE',
    ],
    'board_composition': [
        'BOARD OF DIRECTORS', 'ELECTION OF DIRECTORS', 'PROPOSAL 1',
        'NOMINEES FOR DIRECTOR', 'DIRECTOR NOMINEES',
        'CORPORATE GOVERNANCE', 'GOVERNANCE GUIDELINES',
    ],
    'shareholder_proposals': [
        'SHAREHOLDER PROPOSAL', 'STOCKHOLDER PROPOSAL',
        'PROPOSAL 4', 'PROPOSAL 5', 'PROPOSAL 6',
    ],
    'related_party_transactions': [
        'RELATED PARTY', 'RELATED PERSON', 'CERTAIN RELATIONSHIPS',
        'TRANSACTIONS WITH RELATED',
    ],
    'ceo_pay_ratio': ['CEO PAY RATIO', 'PAY RATIO'],
    'pay_vs_performance': ['PAY VERSUS PERFORMANCE', 'PAY VS. PERFORMANCE', 'PAY VS PERFORMANCE'],
    'audit_committee': [
        'AUDIT COMMITTEE', 'REPORT OF THE AUDIT',
        'RATIFICATION OF', 'INDEPENDENT REGISTERED PUBLIC ACCOUNTING',
    ],
    'stock_ownership': [
        'SECURITY OWNERSHIP', 'STOCK OWNERSHIP', 'BENEFICIAL OWNERSHIP',
        'PRINCIPAL STOCKHOLDERS', 'PRINCIPAL SHAREHOLDERS',
    ],
}

# Total number of defined section categories
TOTAL_SECTION_CATEGORIES = len(PROXY_SECTIONS)  # 9


def parse_proxy(
    content: str,
    ticker: str,
    filing_date: Optional[str] = None,
    accession_no: str = '',
) -> Dict[str, Any]:
    """
    Parse a DEF 14A proxy statement into narrative chunks by section.

    Args:
        content: Raw HTML content of the proxy filing
        ticker: Company ticker symbol
        filing_date: Filing date string
        accession_no: SEC accession number

    Returns:
        Unified response dict with narrative_chunks and metadata
    """
    logger.info(f"Parsing DEF 14A proxy for {ticker}")

    soup = BeautifulSoup(content, 'html.parser')

    # Remove script/style noise
    for tag in soup.find_all(['script', 'style', 'noscript']):
        tag.decompose()

    # Extract full text
    full_text = soup.get_text(separator='\n')
    full_text = re.sub(r'\n{3,}', '\n\n', full_text)
    full_text = re.sub(r'[ \t]+', ' ', full_text)

    # Detect sections by keyword scanning
    sections = _detect_sections(full_text)

    # Tier 1 structural verification (§3.4)
    verification = verify_proxy_structural(sections, len(full_text.split()))

    # If fewer than 3 sections detected, flag for review — do NOT mark as success
    status = 'success' if verification['passed'] else 'needs_review'

    # Chunk each section
    narrative_chunks = []
    for section in sections:
        chunks = _chunk_text(section['content'], max_words=500, overlap_words=50)
        for idx, chunk in enumerate(chunks):
            if len(chunk.split()) < 20:
                continue
            narrative_chunks.append({
                'ticker': ticker,
                'filing_type': 'DEF 14A',
                'section_type': section['section_type'],
                'section_title': section['section_title'],
                'chunk_index': idx,
                'content': chunk,
                'content_length': len(chunk),
            })

    logger.info(
        f"DEF 14A parse complete: {len(sections)} sections, "
        f"{len(narrative_chunks)} chunks, status={status}"
    )

    return {
        'structured_metrics': [],
        'narrative_chunks': narrative_chunks,
        'holdings': [],
        'transactions': [],
        'metadata': {
            'ticker': ticker,
            'filing_type': 'DEF 14A',
            'status': status,
            'parser_type': 'proxy',
            'total_metrics': 0,
            'total_chunks': len(narrative_chunks),
            'total_holdings': 0,
            'total_transactions': 0,
            'high_confidence_metrics': 0,
            'sections_found': len(sections),
            'section_types': [s['section_type'] for s in sections],
            'verification': verification,
        },
    }


def _detect_sections(full_text: str) -> List[Dict[str, Any]]:
    """
    Scan text for proxy section keywords. When a keyword is found,
    start a new section; end the previous section.

    Returns list of {section_type, section_title, content, start_pos}.
    """
    text_upper = full_text.upper()
    markers: List[Dict[str, Any]] = []

    for section_type, keywords in PROXY_SECTIONS.items():
        for keyword in keywords:
            # Find all occurrences of this keyword
            pos = 0
            while True:
                idx = text_upper.find(keyword, pos)
                if idx == -1:
                    break

                # Check this is likely a heading (near start of line, not mid-sentence)
                # Look back to find the start of the line
                line_start = full_text.rfind('\n', max(0, idx - 200), idx)
                if line_start == -1:
                    line_start = max(0, idx - 200)
                prefix = full_text[line_start:idx].strip()

                # Accept if prefix is short (heading-like) or empty
                if len(prefix) < 60:
                    markers.append({
                        'section_type': section_type,
                        'section_title': _humanize_section(section_type),
                        'position': idx,
                        'keyword': keyword,
                    })
                    break  # One match per keyword is enough

                pos = idx + len(keyword)

    # Deduplicate: keep only the first marker per section_type
    seen = set()
    unique_markers = []
    for m in sorted(markers, key=lambda x: x['position']):
        if m['section_type'] not in seen:
            seen.add(m['section_type'])
            unique_markers.append(m)

    # Sort by position
    unique_markers.sort(key=lambda x: x['position'])

    # Extract content between markers
    sections = []
    for i, marker in enumerate(unique_markers):
        start = marker['position']
        end = unique_markers[i + 1]['position'] if i + 1 < len(unique_markers) else len(full_text)
        content = full_text[start:end].strip()

        # Clean up: remove the keyword header itself from content start
        # (it's already captured in section_title)
        content = _clean_section_content(content)

        if len(content.split()) >= 30:  # Skip trivially short sections
            sections.append({
                'section_type': marker['section_type'],
                'section_title': marker['section_title'],
                'content': content,
                'start_pos': start,
            })

    return sections


def _clean_section_content(content: str) -> str:
    """Remove excessive whitespace and normalize."""
    content = re.sub(r'\n{3,}', '\n\n', content)
    content = re.sub(r'[ \t]+', ' ', content)
    return content.strip()


def _humanize_section(section_type: str) -> str:
    """Convert section_type key to human-readable title."""
    titles = {
        'executive_compensation': 'Executive Compensation',
        'director_compensation': 'Director Compensation',
        'board_composition': 'Board of Directors',
        'shareholder_proposals': 'Shareholder Proposals',
        'related_party_transactions': 'Related Party Transactions',
        'ceo_pay_ratio': 'CEO Pay Ratio',
        'pay_vs_performance': 'Pay vs. Performance',
        'audit_committee': 'Audit Committee',
        'stock_ownership': 'Stock Ownership',
    }
    return titles.get(section_type, section_type.replace('_', ' ').title())


def _chunk_text(text: str, max_words: int = 500, overlap_words: int = 50) -> List[str]:
    """Split text into chunks at ~max_words boundaries with overlap."""
    words = text.split()
    if len(words) <= max_words:
        return [text]

    chunks = []
    start = 0
    while start < len(words):
        end = min(start + max_words, len(words))
        chunk = ' '.join(words[start:end])
        chunks.append(chunk)
        start = end - overlap_words if end < len(words) else end

    return chunks


def verify_proxy_structural(
    extracted_sections: List[Dict[str, Any]],
    raw_word_count: int,
) -> Dict[str, Any]:
    """
    Tier 1 structural verification (§3.4).
    Checks section count, word counts, and keyword presence.
    """
    issues = []

    if len(extracted_sections) < 3:
        issues.append(f"Only {len(extracted_sections)}/{TOTAL_SECTION_CATEGORIES} sections found")

    for section in extracted_sections:
        word_count = len(section['content'].split())
        if word_count < 100:
            issues.append(f"{section['section_type']}: only {word_count} words")

        # Check that at least one keyword from the section's keyword list
        # appears in the content
        keywords = PROXY_SECTIONS.get(section['section_type'], [])
        keyword_found = any(
            kw.lower() in section['content'].lower() for kw in keywords[:3]
        )
        if not keyword_found:
            issues.append(f"{section['section_type']}: no keywords in content")

    return {
        'passed': len(issues) == 0,
        'sections_found': len(extracted_sections),
        'total_possible': TOTAL_SECTION_CATEGORIES,
        'issues': issues,
        'confidence': max(0.0, 1.0 - len(issues) * 0.15),
        'tier': 1,
    }
