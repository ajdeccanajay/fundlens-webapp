\
# unified_10k_parser.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import time
import re
from typing import Any, Dict, List

from .section_parser import SectionParser
from .robust_table_parser import RobustTableParser


# ----------------------------- offset-based section mapping -----------------------------

def _index_spans_in_html(html: str, needles: List[str]) -> Dict[str, int]:
    """Return first-match byte offset for each needle in the html (fallback to -1)."""
    out = {}
    for n in needles:
        if not n:
            out[n] = -1
            continue
        m = re.search(re.escape(n[:80]), html)  # use a short stable prefix
        out[n] = m.start() if m else -1
    return out

def _section_offsets_from_sec_parsers(html: str, sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Attach an approximate start offset to each section by searching its title or first 80 chars of text."""
    titles = [s.get("section_title") or "" for s in sections]
    title_pos = _index_spans_in_html(html, titles)
    enriched = []
    for s in sections:
        pos = title_pos.get(s.get("section_title") or "", -1)
        # fallback: use first 80 chars of chunk text
        if pos < 0 and s.get("text"):
            tpos = _index_spans_in_html(html, [s["text"][:80]])[s["text"][:80]]
            pos = tpos if tpos >= 0 else -1
        enriched.append({**s, "start_offset": pos})
    # keep only those that matched somewhere (or keep all; unmatched will sort last)
    return sorted(enriched, key=lambda x: (x["start_offset"] if x["start_offset"] >= 0 else 10**12))

def _table_offset(html: str, html_fragment: str) -> int:
    m = re.search(re.escape(html_fragment[:120]), html)  # prefix search
    return m.start() if m else -1

def _approx_offset(html: str, title: str, text: str) -> Optional[int]:
    """Compute approximate byte offset for a section by searching for title or text."""
    # try title first
    if title:
        m = re.search(re.escape(title[:80]), html, re.I)
        if m:
            return m.start()
    # fallback: first non-empty line of text
    first = (text or "").strip().splitlines()[0:3]
    for line in first:
        s = line.strip()
        if len(s) >= 20:
            m = re.search(re.escape(s[:80]), html)
            if m:
                return m.start()
    return None

def map_table_to_section_by_offset(html: str, table_html_prefix: str, sections: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Find the closest preceding section for the table based on byte offsets."""
    tpos = _table_offset(html, table_html_prefix)
    best = None
    for s in sections:
        spos = s.get("start_offset", -1)
        if spos >= 0 and spos <= tpos:
            best = s
        if spos > tpos:
            break
    if best:
        return {
            "section_path": best.get("section_path", []),
            "section_title": best.get("section_title", ""),
            "section_id": best.get("section_id", ""),
            "confidence": "high",
            "match_reason": "offset_precedent"
        }
    return {"section_path": [], "section_title": "", "section_id": "", "confidence": "low", "match_reason": "no_match"}

def is_real_financial_table(tbl: Dict[str, Any]) -> bool:
    """Filter to keep only real financial tables, excluding index/exhibit tables."""
    if tbl["table_info"].get("is_index"):
        return False
    t = tbl["table_info"].get("type")
    return t in {"income_statement", "balance_sheet", "cash_flow"}  # extend as needed


class Unified10KParser:
    """
    Orchestrates section parsing (sec_parsers) and table extraction (DOM),
    then maps tables to sections and produces a unified structure.
    """

    def __init__(self,
                 section_chunk_tokens: int = 400,
                 section_chunk_overlap: int = 40):
        self.sections = SectionParser(max_tokens=section_chunk_tokens,
                                      overlap=section_chunk_overlap)
        self.tables = RobustTableParser()

    # --------------------------- public API ---------------------------------

    def parse_10k_html(self, html_content: str) -> Dict[str, Any]:
        """
        Parse 10-K/10-Q/8-K HTML content using both approaches.
        Returns unified structure with sections and tables.
        """
        t0 = time.time()

        # 1) sections
        sections_data = self.sections.parse_sections(html_content)

        # 2) tables
        tables_data = self.tables.extract_tables_from_html(html_content)

        # 3) enhanced section mapping with offsets
        sections_with_offsets = _section_offsets_from_sec_parsers(html_content, sections_data["sections"])
        enriched_tables = self._map_tables_to_sections_by_offset(html_content, tables_data, sections_with_offsets)

        # 4) filter to keep only real financial tables (optional)
        # enriched_tables = [t for t in enriched_tables if is_real_financial_table(t)]

        # 5) unified JSON-like structure
        result = self._create_unified_structure(sections_data, enriched_tables)
        result["export_info"]["parse_time_seconds"] = time.time() - t0
        return result

    # --------------------------- mapping logic ------------------------------

    def _map_tables_to_sections_by_offset(self, html_content: str, tables: List[Dict[str, Any]], sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Map tables to sections using byte offsets for more accurate placement."""
        out = []
        for table in tables:
            # Use the new offset-based mapping
            toff = table.get("doc_offset")
            if isinstance(toff, int) and toff >= 0:
                # Find nearest preceding section by offset
                prev = [s for s in sections if isinstance(s.get("section_offset"), int) and s["section_offset"] <= toff]
                if prev:
                    prev.sort(key=lambda s: toff - s["section_offset"])
                    s = prev[0]
                    best = {
                        "section_path": s.get("section_path", []),
                        "section_title": s.get("section_title", ""),
                        "section_id": s.get("section_id", ""),
                        "confidence": "high",
                        "match_reason": "nearest_preceding_section_by_offset"
                    }
                else:
                    best = {"section_path": [], "section_title": "", "section_id": "", "confidence": "low", "match_reason": "no_preceding_section"}
            else:
                # Fallback to original method
                html_prefix = table.get("html_source", "")
                best = map_table_to_section_by_offset(html_content, html_prefix, sections)
            
            enriched = {**table, "section_context": best}
            out.append(enriched)
        return out

    def _map_tables_to_sections(self, tables: List[Dict[str, Any]], sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = []
        for table in tables:
            best = self._find_best_section_match(table, sections)
            enriched = {**table, "section_context": best}
            out.append(enriched)
        return out

    def _find_best_section_match(self, table: Dict[str, Any], sections: List[Dict[str, Any]]) -> Dict[str, Any]:
        best_match = {
            "section_path": [],
            "section_title": "",
            "section_id": "",
            "confidence": "low",
            "match_reason": "default"
        }

        try:
            # Strategy 1: financial keyword hit
            if table.get('table_info', {}).get('potential_financial', False):
                financial_keywords = ['balance sheet', 'income statement', 'cash flow', 'financial']
                for sec in sections:
                    stxt = sec.get('text', '').lower()
                    for kw in financial_keywords:
                        if kw in stxt:
                            return {
                                "section_path": sec.get('section_path', []),
                                "section_title": sec.get('section_title', ''),
                                "section_id": sec.get('section_id', ''),
                                "confidence": "high",
                                "match_reason": f"financial keyword '{kw}'"
                            }

            # Strategy 2: generic indicators
            table_indicators = ['table', 'schedule', 'exhibit', 'financial data', 'consolidated']
            for sec in sections:
                stxt = sec.get('text', '').lower()
                for ind in table_indicators:
                    if ind in stxt:
                        return {
                            "section_path": sec.get('section_path', []),
                            "section_title": sec.get('section_title', ''),
                            "section_id": sec.get('section_id', ''),
                            "confidence": "medium",
                            "match_reason": f"indicator '{ind}'"
                        }

            # Strategy 3: simple content similarity
            ttext = ""
            df = table.get("dataframe")
            if df is not None and getattr(df, "empty", True) is False:
                ttext = " ".join(df.astype(str).values.flatten())
            else:
                raw_lines = table.get("raw_lines", [])
                ttext = " ".join(raw_lines) if raw_lines else ""

            if ttext:
                tset = set(ttext.lower().split())
                best_score = 0.0
                best_sec = None
                for sec in sections:
                    stxt = sec.get('text', '')
                    if not stxt:
                        continue
                    sset = set(stxt.lower().split())
                    if not sset:
                        continue
                    inter = tset.intersection(sset)
                    union = tset.union(sset)
                    score = (len(inter) / len(union)) if union else 0.0
                    if score > best_score:
                        best_score = score
                        best_sec = sec
                if best_sec:
                    return {
                        "section_path": best_sec.get('section_path', []),
                        "section_title": best_sec.get('section_title', ''),
                        "section_id": best_sec.get('section_id', ''),
                        "confidence": "low",
                        "match_reason": f"content similarity {best_score:.2f}"
                    }

        except Exception as e:
            # Be conservative: return default match info
            pass

        return best_match

    # --------------------------- unify/export --------------------------------

    def _create_unified_structure(self, sections_data: Dict[str, Any], enriched_tables: List[Dict[str, Any]]) -> Dict[str, Any]:
        total_text_length = sum(s.get('text_length', 0) for s in sections_data["sections"])

        # simple summary
        table_summary: Dict[str, Dict[str, int]] = {}
        for t in enriched_tables:
            ttype = t.get('type', 'unknown')
            unit_text = t.get('unit_context', {}).get('unit_text', 'no_unit')
            if ttype not in table_summary:
                table_summary[ttype] = {}
            table_summary[ttype][unit_text] = table_summary[ttype].get(unit_text, 0) + 1

        # Make DataFrames JSON-friendly here? The caller may do it; we keep raw objects.
        return {
            "export_info": {
                "parser": "unified_10k_parser",
                "version": "1.0",
                "parse_time_seconds": None,
                "total_sections": sections_data["section_count"],
                "total_text_chunks": sections_data["total_chunks"],
                "total_tables": len(enriched_tables),
                "total_text_length": total_text_length
            },
            "document_structure": {
                "title_tree": sections_data.get("title_tree", {}),
                "section_hierarchy": self._extract_section_hierarchy(sections_data["sections"])
            },
            "content_analysis": {
                "sections": sections_data["sections"],
                "tables": enriched_tables,
                "table_summary": table_summary
            },
            "metadata": {
                "parser_components": ["sec_parsers", "robust_table_parser"],
                "features": [
                    "sectional_mapping",
                    "table_extraction",
                    "unit_context_extraction",
                    "section_table_mapping",
                    "financial_detection"
                ]
            }
        }

    def _extract_section_hierarchy(self, sections: List[Dict[str, Any]]) -> Dict[str, Any]:
        hierarchy: Dict[str, Any] = {}
        for s in sections:
            path = s.get("section_path", [])
            current = hierarchy
            for i, node in enumerate(path):
                if node not in current:
                    current[node] = {"level": i, "children": {}, "section_count": 0, "text_chunks": []}
                current[node]["section_count"] += 1
                current[node]["text_chunks"].append(s.get("section_id",""))
                if i < len(path) - 1:
                    current = current[node]["children"]
        return hierarchy
