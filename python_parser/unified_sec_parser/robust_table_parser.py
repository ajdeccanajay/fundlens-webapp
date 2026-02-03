\
# robust_table_parser.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from bs4 import BeautifulSoup

# Optional: if sec_parser is installed, we can try its TableParser first.
try:
    from sec_parser.semantic_elements.table_element.table_parser import TableParser as _SecTableParser
    _HAS_SEC_TABLE = True
except Exception:
    _HAS_SEC_TABLE = False

# Enhanced regex patterns for better detection
YEAR_COL_RE = re.compile(r'\b(20\d{2})(?:\s*[-/]\s*(20\d{2}))?\b')
UNIT_RE = re.compile(
    r'\((?:\$|USD|US\s*dollars?)?\s*in\s*(thousands|millions|billions)'
    r'(?:,\s*except\s+per\s+share\s+(?:data|amounts))?\)|'
    r'in\s+(thousands|millions|billions)', re.I
)
EXCEPT_PER_SHARE_RE = re.compile(r'except\s+per\s+share', re.I)
CURRENCY_PAT = re.compile(r'\b(USD|US\s*dollars?)\b|\$', re.I)
DATE_ROW_PAT = re.compile(r'(year|three|six|nine|months|ended|as of|\b20\d{2}\b)', re.I)
NONNUM_PAT = re.compile(r'[A-Za-z]{3,}')

# Financial statement classification signals
_FIN_INCOME_SIGNALS = [
    "revenue", "net sales", "gross margin", "operating income", "net income",
    "earnings", "profit", "loss", "consolidated statements of operations",
    "income statement", "statement of operations"
]
_FIN_BALANCE_SIGNALS = [
    "assets", "liabilities", "equity", "shareholders' equity", "stockholders' equity",
    "consolidated balance sheets", "balance sheet", "current assets", "current liabilities"
]
_FIN_CASHFLOW_SIGNALS = [
    "cash flows", "operating activities", "investing activities", "financing activities",
    "consolidated statements of cash flows", "cash flow statement"
]

# Helper function to check if table is meaningful
def _is_meaningful(df: pd.DataFrame) -> bool:
    if df is None or df.empty: 
        return False
    # at least 2 columns and some digits anywhere
    if df.shape[1] < 2:
        return False
    has_digit = (df.astype(str).apply(lambda s: s.str.contains(r'\d')).any(axis=1)).any()
    return bool(has_digit)


# ----------------------------- grid building functions -----------------------------

def _build_grid(table_tag) -> List[List[str]]:
    """Return a 2D grid of strings with colspan/rowspan expanded."""
    rows = []
    # First pass: count columns to size grid per row
    for tr in table_tag.find_all("tr", recursive=False):
        rows.append([cell for cell in tr.find_all(["td", "th"], recursive=False)])
    # Compute max columns considering colspans
    max_cols = 0
    for row in rows:
        count = 0
        for c in row:
            cs = int(c.get("colspan", 1))
            count += cs
        max_cols = max(max_cols, count)

    # Fill grid with None
    grid: List[List[Optional[str]]] = []
    # Track rowspans that carry over
    carry = {}  # (r,c) -> remaining_rows

    for r_idx, row in enumerate(rows):
        grid.append([None] * max_cols)
        c_idx = 0
        # advance over carried rowspans
        while c_idx < max_cols:
            if carry.get((r_idx, c_idx), 0) > 0:
                c_idx += 1
            else:
                break

        for cell in row:
            # find first free slot in this row
            while c_idx < max_cols and carry.get((r_idx, c_idx), 0) > 0 or grid[r_idx][c_idx] is not None:
                c_idx += 1
            text = cell.get_text(" ", strip=True)
            rs = int(cell.get("rowspan", 1))
            cs = int(cell.get("colspan", 1))
            # place text in [r_idx ... r_idx+rs-1, c_idx ... c_idx+cs-1]
            for rr in range(r_idx, r_idx + rs):
                # ensure grid has enough rows
                while rr >= len(grid):
                    grid.append([None] * max_cols)
                for cc in range(c_idx, c_idx + cs):
                    if rr == r_idx and cc == c_idx:
                        grid[rr][cc] = text
                    else:
                        grid[rr][cc] = ""  # mark as spanned
                    # mark carry for next rows
                    if rs > 1 and rr < r_idx + rs - 1:
                        carry[(rr + 1, cc)] = carry.get((rr + 1, cc), 0) + 1
            c_idx += cs

    # Convert None -> "" and strip
    out = []
    for r in grid:
        out.append([("" if v is None else v).strip() for v in r])
    return out

def _promote_headers(grid: List[List[str]]) -> Tuple[List[str], List[List[str]]]:
    """Choose 1–2 header rows intelligently; merge to single header line."""
    # heuristics: prefer rows with many non-empty cells, years, or th presence (already flattened)
    candidates = []
    for i, row in enumerate(grid[:4]):  # inspect first 4 rows
        filled = sum(1 for x in row if x)
        year_hits = sum(1 for x in row if YEAR_COL_RE.search(x or ""))
        candidates.append((i, filled + year_hits * 2))
    # take top-1 or top-2
    candidates.sort(key=lambda x: x[1], reverse=True)
    header_rows = sorted([candidates[0][0]])  # start with best
    if len(grid) > 1 and candidates[1][1] >= max(2, candidates[0][1] - 1):
        header_rows.append(candidates[1][0])

    # build final header by concatenating cells across chosen rows
    header = ["" for _ in grid[0]]
    for hr in header_rows:
        for j, val in enumerate(grid[hr]):
            if val and val != "":
                header[j] = (header[j] + " " + val).strip() if header[j] else val

    # fallbacks: de-duplicate duplicate year labels like "2024 2024" and empty headers
    seen = {}
    clean_header = []
    for h in header:
        key = h or "col"
        if key in seen:
            seen[key] += 1
            clean_header.append(f"{key}_{seen[key]}")
        else:
            seen[key] = 0
            clean_header.append(key)

    # body = grid excluding header rows
    body = [r[:] for idx, r in enumerate(grid) if idx not in header_rows]
    return clean_header, body

def _looks_like_index_table(grid: List[List[str]]) -> bool:
    """Detect the 'Index to Consolidated Financial Statements' / exhibit indices."""
    flat = " ".join(" ".join(r) for r in grid[:5]).lower()
    if "index to consolidated" in flat or "exhibit" in flat:
        return True
    if re.search(r'\bpage\b', flat) and re.search(r'#', " ".join(" ".join(r) for r in grid[:2])):
        return True
    return False

def _detect_unit_context(table_tag) -> Dict[str, Any]:
    """Scan caption and nearby preceding siblings for unit hints."""
    texts = []
    cap = table_tag.find("caption")
    if cap:
        texts.append(cap.get_text(" ", strip=True))
    # walk up to 5 previous non-empty siblings
    sib = table_tag.previous_sibling
    hops = 0
    while sib is not None and hops < 5:
        if getattr(sib, "get_text", None):
            t = sib.get_text(" ", strip=True)
            if 0 < len(t) < 180:
                texts.append(t)
        sib = sib.previous_sibling
        hops += 1
    hint = " | ".join(texts)
    m = UNIT_RE.search(hint or "")
    unit_factor = 1
    unit_text = None
    if m:
        unit = next(g for g in m.groups() if g)
        unit_text = m.group(0)
        unit = unit.lower()
        unit_factor = {"thousands": 1_000, "millions": 1_000_000, "billions": 1_000_000_000}[unit]
    return {
        "unit_text": unit_text,
        "unit_factor": unit_factor,
        "except_per_share": bool(EXCEPT_PER_SHARE_RE.search(hint or "")),
        "hint_context": hint or ""
    }

def _classify_table(header: List[str], grid: List[List[str]]) -> Dict[str, Any]:
    """Light classifier for core financial statements."""
    first_col = [r[0].lower() for r in grid if r and r[0]]
    head_txt = " ".join(header).lower()
    col_txt = " ".join(first_col[:20])

    def has_any(s: str, *keys) -> bool:
        s = s.lower()
        return any(k in s for k in keys)

    if has_any(head_txt, "consolidated statements of operations", "income statement"):
        return {"type": "income_statement", "potential_financial": True}
    if has_any(head_txt, "consolidated balance sheets"):
        return {"type": "balance_sheet", "potential_financial": True}
    if has_any(head_txt, "consolidated statements of cash flows"):
        return {"type": "cash_flow", "potential_financial": True}

    # content-based fallbacks
    if has_any(col_txt, "net sales", "revenue", "gross margin"):
        return {"type": "income_statement", "potential_financial": True}
    if has_any(col_txt, "assets", "liabilities", "shareholders' equity", "shareholders' equity"):
        return {"type": "balance_sheet", "potential_financial": True}
    if has_any(col_txt, "operating activities", "investing activities", "financing activities"):
        return {"type": "cash_flow", "potential_financial": True}

    return {"type": "other", "potential_financial": False}

def _clean_numbers(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize numeric-looking cells (parentheses as negatives, dashes to 0/NaN)."""
    def parse(x):
        s = str(x).strip()
        if not s or s.lower() in {"nan", "—", "–", "-", "— —"}:
            return None
        s = re.sub(r'[\u2013\u2014\u2212]', '-', s)  # various dashes
        s = re.sub(r'[\$,]', '', s)
        s = re.sub(r'\(([^)]+)\)', r'-\1', s)  # (123) -> -123
        # strip footnotes like (1), [1], †, *
        s = re.sub(r'(\[\d+\]|\(\d+\)|[†*]+)$', '', s).strip()
        try:
            return float(s)
        except:
            return x
    return df.applymap(parse)

# ----------------------------- dataclasses ----------------------------------

@dataclass
class TableContext:
    unit_text: str = ""
    unit_factor: float = 1.0
    currency_hint: Optional[str] = None
    negative_format: str = "parentheses|minus"  # informational; not applied here


# ----------------------------- core class -----------------------------------

class RobustTableParser:
    """
    DOM-first table parser for SEC filings.

    - Finds all <table> elements with BeautifulSoup (lxml backend).
    - Reads to pandas.DataFrame (prefers sec_parser.TableParser if available).
    - Promotes header rows, flattens MultiIndex, drops empty cols/rows.
    - Extracts unit context from caption & nearby text.
    - Classifies likely statement type (income/balance/cashflow/other).
    - Returns a list of dicts ready for JSON (DataFrame is left as-is for caller to serialize).
    """

    def __init__(self,
                 min_rows: int = 1,
                 min_cols: int = 2,
                 sniff_prev_siblings: int = 8,
                 max_header_scan_rows: int = 8):
        self.min_rows = min_rows
        self.min_cols = min_cols
        self.sniff_prev_siblings = sniff_prev_siblings
        self.max_header_scan_rows = max_header_scan_rows

    # --------------------------- public API ---------------------------------

    def extract_tables_from_html(self, html: str) -> List[Dict[str, Any]]:
        soup = BeautifulSoup(html, "lxml")
        out: List[Dict[str, Any]] = []

        for tbl in soup.find_all("table"):
            # 1) Try sec_parser.TableParser -> pandas
            df = self._read_table_df(tbl)

            # 2) If still empty, do manual grid fallback
            if (df is None) or df.empty:
                grid = _build_grid(tbl)
                if grid and len(grid) >= 2 and max(len(r) for r in grid) >= 2:
                    hdr, body = _promote_headers(grid)
                    try:
                        df = pd.DataFrame(body, columns=hdr)
                        df = self._normalize_df(df)
                    except Exception:
                        df = pd.DataFrame()

            # 3) Final minimal shape + meaning check
            if not _is_meaningful(df):
                continue

            # ---- unit context (use header too) ----
            headers_for_unit = list(map(str, df.columns.tolist()))[:2]
            unit_ctx = self._unit_hint_and_factor(tbl, header_lines=headers_for_unit)

            # ---- classification ----
            table_type, signals = self._classify_table(df)

            # ---- HTML bits ----
            html_src = str(tbl)
            text_src = tbl.get_text(" ", strip=True)
            # byte offset (for section mapping)
            # use a short prefix to avoid finding repeated footers
            prefix = html_src[:400]
            doc_offset = html.find(prefix)

            out.append({
                "type": table_type,
                "dataframe": df,
                "headers": list(map(str, df.columns.tolist())),
                "rows": df.head(5).astype(str).to_dict("records"),
                "raw_lines": self._raw_lines(tbl),
                "structure": {"n_rows": int(df.shape[0]), "n_cols": int(df.shape[1])},
                "table_info": {
                    "shape": [int(df.shape[0]), int(df.shape[1])],
                    "n_numeric_cells": int(self._count_numeric_cells(df)),
                    "n_text_cells": int(self._count_text_cells(df)),
                    "potential_financial": table_type in {"income_statement","balance_sheet","cash_flow"},
                    "signals": signals,
                },
                "unit_context": unit_ctx,
                "html_source": html_src[:2000],
                "text_source": text_src[:4000],
                "doc_offset": None if doc_offset < 0 else int(doc_offset),
            })

        return out

    # --------------------------- internals ----------------------------------

    def _read_table_df(self, table_tag) -> pd.DataFrame:
        html_tbl = str(table_tag)

        # 1) Prefer sec_parser's TableParser if present (often yields better grids)
        if _HAS_SEC_TABLE:
            try:
                df = _SecTableParser(html_tbl).parse_as_df()
                df = self._normalize_df(df)
                if not df.empty:
                    return df
            except Exception:
                pass

        # 2) Fallback to pandas.read_html
        try:
            # header=None forces us to handle headers ourselves (more consistent across issuers)
            dfs = pd.read_html(html_tbl, flavor="lxml", header=None)
            df = dfs[0] if dfs else pd.DataFrame()
        except Exception:
            df = pd.DataFrame()

        if df.empty:
            return df

        df = self._normalize_df(df)
        return df

    def _normalize_df(self, df: pd.DataFrame) -> pd.DataFrame:
        if df is None or df.empty:
            return pd.DataFrame()

        # Replace NBSP and trim
        df = df.replace("\u00a0", " ", regex=True)

        # Drop fully-empty columns
        df = df.loc[:, ~df.apply(lambda c: c.astype(str).str.strip().replace("", pd.NA).isna().all())]
        if df.empty:
            return df

        # Flatten MultiIndex columns if any
        if isinstance(df.columns, pd.MultiIndex):
            flat = []
            for tup in df.columns:
                parts = [str(x).strip() for x in tup if pd.notna(x) and str(x).strip()]
                flat.append(" ".join(parts) if parts else "")
            df.columns = flat

        # Promote header row(s)
        df = self._promote_headers(df)

        # Drop fully-empty rows after header promotion
        df = df.loc[~df.apply(lambda r: r.astype(str).str.strip().replace("", pd.NA).isna().all(), axis=1)]
        df = df.reset_index(drop=True)

        # Ensure first column has a sane name
        if df.shape[1] > 0:
            first = str(df.columns[0])
            if (not first) or first.lower().startswith("unnamed") or first.lower().startswith("col"):
                df.rename(columns={df.columns[0]: "label"}, inplace=True)

        return df

    def _promote_headers(self, df: pd.DataFrame) -> pd.DataFrame:
        if df.empty: 
            return df

        top = min(self.max_header_scan_rows, len(df))
        header_idx = 0  # default to first row if no better signal

        for i in range(top):
            row = df.iloc[i].astype(str).str.strip()
            line = " ".join(row.tolist())
            # prefer a row with many words (not just numbers) or clear date words
            words = sum(1 for s in row if NONNUM_PAT.search(s))
            if words >= max(2, df.shape[1] // 3) or DATE_ROW_PAT.search(line):
                header_idx = i
                break

        hdr1 = df.iloc[header_idx].fillna("").astype(str).str.strip().tolist()
        drop = [header_idx]

        # optional second header line with period labels
        if header_idx + 1 < len(df):
            row2 = df.iloc[header_idx + 1].astype(str).str.strip()
            if DATE_ROW_PAT.search(" ".join(row2.tolist())):
                hdr2 = row2.tolist()
                hdr = [(" ".join([a, b]).strip() if (a or b) else "") for a, b in zip(hdr1, hdr2)]
                drop.append(header_idx + 1)
            else:
                hdr = hdr1
        else:
            hdr = hdr1

        # drop chosen header rows
        df = df.drop(index=drop).reset_index(drop=True)

        # de-dup / empty headers
        seen, cols = set(), []
        for j, name in enumerate(hdr):
            base = name or f"col{j+1}"
            cand = base
            k = 1
            while cand in seen:
                k += 1
                cand = f"{base}_{k}"
            seen.add(cand)
            cols.append(cand)
        df.columns = cols

        # drop fully-empty rows
        empty_row = df.apply(lambda r: r.astype(str).str.strip().replace("", pd.NA).isna().all(), axis=1)
        df = df.loc[~empty_row].reset_index(drop=True)

        # ensure first column label is not generic
        if df.shape[1] and (not df.columns[0] or df.columns[0].lower().startswith(("unnamed","col"))):
            df.rename(columns={df.columns[0]: "label"}, inplace=True)

        return df

    def _unit_hint_and_factor(self, table_tag, header_lines: Optional[List[str]] = None) -> Dict[str, Any]:
        texts: List[str] = []

        # caption
        cap = table_tag.find("caption")
        if cap:
            texts.append(cap.get_text(" ", strip=True))

        # header lines (promoted)
        if header_lines:
            texts.extend([h for h in header_lines if h])

        # previous siblings (short notes)
        sib = table_tag.previous_sibling
        hops = 0
        while sib is not None and hops < self.sniff_prev_siblings:
            if getattr(sib, "get_text", None):
                t = sib.get_text(" ", strip=True)
                if 0 < len(t) < 240:
                    texts.append(t)
            sib = sib.previous_sibling
            hops += 1

        # ancestors' preceding siblings
        anc = table_tag.parent
        for _ in range(2):
            if not anc: break
            ps = anc.previous_sibling
            ahops = 0
            while ps is not None and ahops < 4:
                if getattr(ps, "get_text", None):
                    t = ps.get_text(" ", strip=True)
                    if 0 < len(t) < 240:
                        texts.append(t)
                ps = ps.previous_sibling
                ahops += 1
            anc = anc.parent

        # first two TRs
        tr1 = table_tag.find("tr")
        if tr1:
            texts.append(tr1.get_text(" ", strip=True))
            tr2 = tr1.find_next("tr")
            if tr2:
                texts.append(tr2.get_text(" ", strip=True))

        context = " | ".join([t for t in texts if t])
        m = UNIT_RE.search(context)
        unit_factor = 1.0
        unit_text = None
        if m:
            unit = next((g for g in m.groups() if g), None)
            if unit:
                k = unit.lower()
                unit_text = m.group(0)
                unit_factor = {"thousands": 1_000, "millions": 1_000_000, "billions": 1_000_000_000}[k]

        return {
            "unit_text": unit_text,
            "unit_factor": float(unit_factor),
            "currency_hint": ("USD" if CURRENCY_PAT.search(context) else None),
            "negative_format": "parentheses|minus",
            "hint_context": context
        }

    def _classify_table(self, df: pd.DataFrame) -> Tuple[str, List[str]]:
        """Heuristically classify the table type."""
        joined = " ".join(" ".join(map(str, df[col].astype(str).tolist())).lower() for col in df.columns[:2])
        signals_used: List[str] = []

        def _hit(tokens: List[str]) -> bool:
            for tok in tokens:
                if tok in joined:
                    signals_used.append(tok)
                    return True
            return False

        if _hit(_FIN_INCOME_SIGNALS):
            return "income_statement", signals_used
        if _hit(_FIN_BALANCE_SIGNALS):
            return "balance_sheet", signals_used
        if _hit(_FIN_CASHFLOW_SIGNALS):
            return "cash_flow", signals_used
        return "other", signals_used

    def _raw_lines(self, table_tag) -> List[str]:
        lines = []
        for tr in table_tag.find_all("tr"):
            txt = tr.get_text(" ", strip=True)
            if txt:
                lines.append(txt)
        return lines

    def _count_numeric_cells(self, df: pd.DataFrame) -> int:
        cnt = 0
        for col in df.columns:
            s = df[col].astype(str)
            cnt += int(s.str.contains(r"[0-9]").sum())
        return cnt

    def _count_text_cells(self, df: pd.DataFrame) -> int:
        cnt = 0
        for col in df.columns:
            s = df[col].astype(str)
            cnt += int((~s.str.contains(r"[0-9]")).sum())
        return cnt
