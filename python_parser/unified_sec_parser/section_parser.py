\
# section_parser.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple
from lxml import etree

# We rely on sec_parsers for structure; make sure to install it.
# pip install sec-parsers
try:
    from sec_parsers import Filing
except Exception as e:
    raise ImportError("sec-parsers is required: pip install sec-parsers") from e


ITEM_RE_10KQ = re.compile(r'\bitem\s+(\d+[A-Z]?)\b', re.I)
ITEM_RE_8K  = re.compile(r'\bitem\s+(\d+\.\d{2})\b', re.I)

# Subsection patterns for Item 1 (Business)
ITEM_1_SUBSECTIONS = {
    'Competition': re.compile(r'\b(competition|competitive\s+landscape|competitive\s+position|competitors)\b', re.I),
    'Products': re.compile(r'\b(products|product\s+lines|product\s+offerings|services)\b', re.I),
    'Customers': re.compile(r'\b(customers|customer\s+base|client\s+relationships)\b', re.I),
    'Markets': re.compile(r'\b(markets|market\s+segments|geographic\s+markets|target\s+markets)\b', re.I),
    'Operations': re.compile(r'\b(operations|business\s+operations|operational\s+structure)\b', re.I),
    'Strategy': re.compile(r'\b(strategy|business\s+strategy|strategic\s+initiatives|growth\s+strategy)\b', re.I),
    'Intellectual Property': re.compile(r'\b(intellectual\s+property|patents|trademarks|copyrights|ip\s+rights)\b', re.I),
    'Human Capital': re.compile(r'\b(human\s+capital|employees|workforce|talent|human\s+resources)\b', re.I),
}

# Subsection patterns for Item 7 (MD&A)
ITEM_7_SUBSECTIONS = {
    'Results of Operations': re.compile(r'\b(results\s+of\s+operations|operating\s+results|financial\s+results)\b', re.I),
    'Liquidity and Capital Resources': re.compile(r'\b(liquidity|capital\s+resources|cash\s+flows|financing\s+activities)\b', re.I),
    'Critical Accounting Policies': re.compile(r'\b(critical\s+accounting|accounting\s+policies|accounting\s+estimates)\b', re.I),
    'Market Risk': re.compile(r'\b(market\s+risk|interest\s+rate\s+risk|foreign\s+exchange\s+risk|commodity\s+risk)\b', re.I),
    'Contractual Obligations': re.compile(r'\b(contractual\s+obligations|commitments|off-balance\s+sheet)\b', re.I),
}

# Subsection patterns for Item 8 (Financial Statements)
ITEM_8_SUBSECTIONS = {
    'Revenue Recognition': re.compile(r'\b(revenue\s+recognition|revenue\s+policy)\b', re.I),
    'Leases': re.compile(r'\b(leases|lease\s+accounting|operating\s+leases|finance\s+leases)\b', re.I),
    'Stock-Based Compensation': re.compile(r'\b(stock-based\s+compensation|share-based\s+compensation|equity\s+compensation)\b', re.I),
    'Income Taxes': re.compile(r'\b(income\s+taxes|tax\s+provision|deferred\s+taxes)\b', re.I),
    'Debt': re.compile(r'\b(debt|borrowings|credit\s+facilities|notes\s+payable)\b', re.I),
    'Fair Value': re.compile(r'\b(fair\s+value|fair\s+value\s+measurements)\b', re.I),
}

# Subsection patterns for Item 1A (Risk Factors)
ITEM_1A_SUBSECTIONS = {
    'Operational Risks': re.compile(r'\b(operational\s+risk|business\s+risk|execution\s+risk)\b', re.I),
    'Financial Risks': re.compile(r'\b(financial\s+risk|credit\s+risk|liquidity\s+risk)\b', re.I),
    'Market Risks': re.compile(r'\b(market\s+risk|economic\s+risk|demand\s+risk)\b', re.I),
    'Regulatory Risks': re.compile(r'\b(regulatory\s+risk|compliance\s+risk|legal\s+risk)\b', re.I),
    'Technology Risks': re.compile(r'\b(technology\s+risk|cybersecurity\s+risk|data\s+security)\b', re.I),
}


class SectionParser:
    """
    Thin wrapper around sec_parsers.Filing to:
      - parse HTML into an XML structure (<document>, <part>, <item>, etc.)
      - walk sections and build hierarchical paths
      - produce chunked text records with metadata
      - identify subsections within major sections (Item 1, 7, 8, 1A)
    """

    def __init__(self, max_tokens: int = 400, overlap: int = 40):
        self.max_tokens = max_tokens
        self.overlap = overlap

    # --------------------------- public API ---------------------------------

    def parse_sections(self, html: str) -> Dict[str, Any]:
        filing = Filing(html)
        filing.parse()

        title_tree = filing.get_title_tree()
        root = filing.xml
        if isinstance(root, (bytes, str)):
            root = etree.fromstring(root)

        sections = []
        section_count = 0

        for elem in root.iter("part", "item", "introduction", "document"):
            section_count += 1
            path = self._build_section_path(elem)
            title = elem.get("title", "") or elem.get("name", "")
            full_text = "".join(elem.itertext()).strip()
            if not full_text:
                continue
            
            # Identify subsections based on section type
            section_type = self._extract_section_type(title, path)
            subsections = self._identify_subsections(full_text, section_type, title)
            
            # Compute approximate offset for this section
            from .unified_10k_parser import _approx_offset
            section_offset = _approx_offset(html, title, full_text)
            
            # If subsections are identified, chunk by subsection
            if subsections:
                for subsection_name, subsection_text in subsections:
                    for i, chunk in enumerate(self._chunk_text(subsection_text)):
                        sections.append({
                            "section_id": f"section_{section_count}_{subsection_name}_{i}",
                            "section_path": path,
                            "section_title": title,
                            "subsection_name": subsection_name,
                            "chunk_index": i,
                            "text": chunk,
                            "kind": "text",
                            "element_type": elem.tag,
                            "text_length": len(chunk),
                            "section_offset": section_offset
                        })
            else:
                # No subsections identified, chunk the entire section
                for i, chunk in enumerate(self._chunk_text(full_text)):
                    sections.append({
                        "section_id": f"section_{section_count}_{i}",
                        "section_path": path,
                        "section_title": title,
                        "subsection_name": None,
                        "chunk_index": i,
                        "text": chunk,
                        "kind": "text",
                        "element_type": elem.tag,
                        "text_length": len(chunk),
                        "section_offset": section_offset
                    })

        return {
            "title_tree": title_tree,
            "sections": sections,
            "section_count": section_count,
            "total_chunks": len(sections)
        }

    # --------------------------- subsection identification ------------------

    def _extract_section_type(self, title: str, path: List[str]) -> Optional[str]:
        """
        Extract section type from title or path.
        Returns: 'item_1', 'item_7', 'item_8', 'item_1a', or None
        """
        # Check title for item numbers
        title_lower = title.lower()
        if 'item 1a' in title_lower or 'item 1.a' in title_lower:
            return 'item_1a'
        elif 'item 1' in title_lower:
            return 'item_1'
        elif 'item 7' in title_lower:
            return 'item_7'
        elif 'item 8' in title_lower:
            return 'item_8'
        
        # Check path for item numbers
        for p in path:
            p_lower = p.lower()
            if 'item 1a' in p_lower or 'item 1.a' in p_lower:
                return 'item_1a'
            elif 'item 1' in p_lower:
                return 'item_1'
            elif 'item 7' in p_lower:
                return 'item_7'
            elif 'item 8' in p_lower:
                return 'item_8'
        
        return None

    def _identify_subsections(
        self, 
        text: str, 
        section_type: Optional[str],
        section_title: str
    ) -> List[Tuple[str, str]]:
        """
        Identify subsections within a section based on section type.
        Returns list of (subsection_name, subsection_text) tuples.
        
        Requirements: 1.2, 1.3, 1.4, 1.5, 1.10
        """
        if not section_type:
            return []
        
        # Select subsection patterns based on section type
        if section_type == 'item_1':
            patterns = ITEM_1_SUBSECTIONS
        elif section_type == 'item_7':
            patterns = ITEM_7_SUBSECTIONS
        elif section_type == 'item_8':
            patterns = ITEM_8_SUBSECTIONS
        elif section_type == 'item_1a':
            patterns = ITEM_1A_SUBSECTIONS
        else:
            return []
        
        # Find all subsection matches
        subsections = []
        for subsection_name, pattern in patterns.items():
            matches = list(pattern.finditer(text))
            if matches:
                # Use first match position as subsection start
                start_pos = matches[0].start()
                subsections.append((subsection_name, start_pos))
        
        # Sort by position
        subsections.sort(key=lambda x: x[1])
        
        # Extract text for each subsection
        result = []
        for i, (subsection_name, start_pos) in enumerate(subsections):
            # Determine end position (start of next subsection or end of text)
            if i + 1 < len(subsections):
                end_pos = subsections[i + 1][1]
            else:
                end_pos = len(text)
            
            subsection_text = text[start_pos:end_pos].strip()
            
            # Only include subsections with substantial content (>200 chars)
            if len(subsection_text) > 200:
                result.append((subsection_name, subsection_text))
        
        return result

    # --------------------------- internals ----------------------------------

    def _build_section_path(self, elem) -> List[str]:
        path = []
        while elem is not None:
            if elem.tag in ["part", "item", "introduction", "document"]:
                t = elem.get("title") or elem.get("name") or ""
                if t:
                    path.append(t.strip())
            elem = elem.getparent()
        return list(reversed(path))

    def _chunk_text(self, text: str):
        words = text.split()
        max_tokens = max(1, self.max_tokens)
        step = max(1, max_tokens - self.overlap)
        for i in range(0, len(words), step):
            chunk = " ".join(words[i:i+max_tokens])
            if chunk.strip():
                yield chunk
