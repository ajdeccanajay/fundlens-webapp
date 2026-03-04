"""
CUSIP Resolver — Maps CUSIP to ticker using SEC company_tickers.json.

No external API dependencies (no OpenFIGI, no Bloomberg).
Spec: KIRO_SPEC_FILING_EXPANSION_AND_AGENTIC_ACQUISITION §2.7

Strategy:
1. Load SEC company_tickers.json (same file SecService already uses)
2. Build reverse map: normalized_company_name → ticker
3. Match 13F issuerName against SEC company names
4. Strip common suffixes (Inc, Corp, Ltd, etc.) for fuzzy matching
5. Cache resolved mappings for reuse
6. If no match: ticker=NULL, preserve issuerName
   NEVER guess — wrong ticker is worse than no ticker
"""

import logging
import httpx
from typing import Optional

logger = logging.getLogger(__name__)

# Suffixes to strip for fuzzy matching (order matters — longest first)
COMPANY_SUFFIXES = [
    ' holdings inc', ' holdings corp', ' holdings co',
    ' international inc', ' international corp',
    ' technologies inc', ' technology inc',
    ' inc.', ' inc', ' corp.', ' corp', ' co.', ' co',
    ' ltd.', ' ltd', ' plc', ' llc', ' lp', ' l.p.',
    ' n.v.', ' n.v', ' sa', ' s.a.', ' ag', ' se',
    ' group', ' holdings', ' international',
    ' class a', ' class b', ' class c',
    ' com', ' common stock', ' common',
    ' ordinary shares', ' american depositary shares',
    ' ads', ' adr',
]


class CUSIPResolver:
    """Resolves CUSIP to ticker using SEC's own company_tickers.json."""

    def __init__(self):
        self.sec_tickers: dict[str, str] = {}  # name_lower → ticker
        self.cusip_cache: dict[str, Optional[str]] = {}  # cusip → ticker | None
        self._loaded = False

    async def ensure_loaded(self):
        """Load SEC tickers if not already loaded."""
        if not self._loaded:
            await self.load_sec_tickers()

    async def load_sec_tickers(self):
        """
        Fetch SEC company_tickers.json and build reverse lookup map.
        Returns: { "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc"}, ... }
        """
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    'https://www.sec.gov/files/company_tickers.json',
                    headers={'User-Agent': 'FundLens/1.0 support@fundlens.ai'},
                    timeout=30.0,
                )
                resp.raise_for_status()
                sec_data = resp.json()

            count = 0
            for entry in sec_data.values():
                ticker = entry.get('ticker', '').strip().upper()
                title = entry.get('title', '').strip()
                if not ticker or not title:
                    continue

                name_lower = title.lower().strip()
                self.sec_tickers[name_lower] = ticker
                count += 1

                # Also store suffix-stripped versions
                for suffix in COMPANY_SUFFIXES:
                    if name_lower.endswith(suffix):
                        stripped = name_lower[:-len(suffix)].strip()
                        if stripped and len(stripped) > 2:
                            # Don't overwrite existing exact matches
                            if stripped not in self.sec_tickers:
                                self.sec_tickers[stripped] = ticker

            self._loaded = True
            logger.info(f"Loaded {count} SEC company tickers ({len(self.sec_tickers)} lookup entries)")

        except Exception as e:
            logger.error(f"Failed to load SEC company tickers: {e}")
            self._loaded = True  # Mark loaded to avoid retry loops; will return None for all

    def resolve(self, cusip: str, issuer_name: str) -> Optional[str]:
        """
        Resolve a CUSIP + issuer name to a ticker symbol.
        Returns None if no confident match found. Never guesses.
        """
        if cusip in self.cusip_cache:
            return self.cusip_cache[cusip]

        name_lower = issuer_name.lower().strip().rstrip('.')

        # 1. Exact match
        if name_lower in self.sec_tickers:
            self.cusip_cache[cusip] = self.sec_tickers[name_lower]
            return self.cusip_cache[cusip]

        # 2. Suffix-stripped match
        for suffix in COMPANY_SUFFIXES:
            if name_lower.endswith(suffix):
                stripped = name_lower[:-len(suffix)].strip().rstrip('.')
                if stripped and stripped in self.sec_tickers:
                    self.cusip_cache[cusip] = self.sec_tickers[stripped]
                    return self.cusip_cache[cusip]

        # 3. No match — return None, cache the miss
        self.cusip_cache[cusip] = None
        logger.debug(f"CUSIP {cusip} ({issuer_name}): no ticker match found")
        return None


# Module-level singleton
_resolver: Optional[CUSIPResolver] = None


async def get_resolver() -> CUSIPResolver:
    """Get or create the singleton CUSIPResolver."""
    global _resolver
    if _resolver is None:
        _resolver = CUSIPResolver()
    await _resolver.ensure_loaded()
    return _resolver
