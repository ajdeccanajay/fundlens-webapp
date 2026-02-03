\
# section_parser.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from typing import Any, Dict, List
from lxml import etree

# We rely on sec_parsers for structure; make sure to install it.
# pip install sec-parsers
try:
    from sec_parsers import Filing
except Exception as e:
    raise ImportError("sec-parsers is required: pip install sec-parsers") from e


ITEM_RE_10KQ = re.compile(r'\bitem\s+(\d+[A-Z]?)\b', re.I)
ITEM_RE_8K  = re.compile(r'\bitem\s+(\d+\.\d{2})\b', re.I)


class SectionParser:
    """
    Thin wrapper around sec_parsers.Filing to:
      - parse HTML into an XML structure (<document>, <part>, <item>, etc.)
      - walk sections and build hierarchical paths
      - produce chunked text records with metadata
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
            
            # Compute approximate offset for this section
            from .unified_10k_parser import _approx_offset
            section_offset = _approx_offset(html, title, full_text)
            
            for i, chunk in enumerate(self._chunk_text(full_text)):
                sections.append({
                    "section_id": f"section_{section_count}_{i}",
                    "section_path": path,
                    "section_title": title,
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
