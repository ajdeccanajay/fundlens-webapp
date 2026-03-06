# KIRO SPEC: FundLens Filing Expansion & Agentic Acquisition

**Date**: March 4, 2026
**Status**: DEFINITIVE. Supersedes all prior specs (v1, v2, v3, AGENTIC_FILING_ACQUISITION.md)
**Companion to**: FUNDLENS_UNIFIED_SPEC_v3.md (RAG pipeline fixes — deploy that FIRST)
**Prerequisite**: pgvector serialization fix must be verified before starting this spec

---

## HOW TO READ THIS SPEC

This spec is organized for sequential execution across 6 phases over ~13 weeks.

| Part | What It Covers | When Kiro Needs It |
|---|---|---|
| Part 1 | Pipeline Audit (read-only context) | Before starting anything |
| Part 2 | Filing Type Analysis + Parser Specs | Reference during Phases 2-4 |
| Part 3 | Accuracy & Verification Framework | Reference during Phases 2-4 |
| Part 4 | Database Schema Changes | Phase 1 (migration), Phase 2-3 (populate) |
| Part 5 | Python Parser Dispatcher | Phase 1 (dispatcher), Phases 2-4 (new modules) |
| Part 6 | Agentic Architecture | Phase 4-5 |
| Part 7 | Trigger Mechanisms | Phase 1 (auto-trigger), Phase 5 (query-triggered) |
| Part 8 | Frontend Transparency | Phase 1 (labels), Phase 2+ (coverage display) |
| Part 9 | Deployment Phases (THE EXECUTION PLAN) | Start here after reading Part 1 |
| Part 10 | Comprehensive Test Matrix | Run tests for each phase |

**CRITICAL RULES FOR KIRO:**
1. READ existing code before modifying. ASSESS if existing is better. PRESERVE working functionality.
2. Only ADD/MODIFY where demonstrably broken or missing.
3. Run ALL existing tests before and after each phase. Zero regressions.
4. If a verification check fails, STOP and report. Do not proceed to next phase.
5. Every new parser must have its verification layer BEFORE being deployed.

---

## Part 1: Pipeline Audit — Current State (READ-ONLY CONTEXT)

### 1.1 Ingestion Paths

Two paths converge on the same Python parser:

**Path A — Cron-triggered (daily at 6 AM ET)**
```
filing-detection-scheduler.service.ts
  → @Cron('0 6 * * *') → runDailyDetection()
  → Uses pg_advisory_lock for single-instance across ECS containers
  → Gets tickers from: Deal table (all deals with non-null ticker)
  → filing-detector.service.ts → detectNewFilings(ticker, ['10-K', '10-Q', '8-K'])
  → Downloads filing → POST /sec-parser
  → Saves: filing_metadata, financial_metrics, narrative_chunks
```

**Path B — User-triggered (/analyze endpoint)**
```
deal.controller.ts → POST /api/deals/:id/analyze
  → pipeline-orchestration.service.ts → startPipeline(dealId, ticker, years)
  → Step A: secPipeline.processCompanyComprehensive(ticker, {
      filingTypes: ['10-K', '10-Q', '8-K']  // HARDCODED
    })
  → Step B: Parse & store metrics
  → Step C: Chunk & store narratives
  → Step D: Sync to Bedrock KB
  → Step E: Verify RAG flow
  → Step G: Build metric hierarchy
  → Step H: Link footnotes
```

### 1.2 Python Parser — Filing Type Support

`hybrid_parser.py` has `SEC_SECTIONS` for exactly 3 filing types:
- 10-K: 17 sections
- 10-Q: 9 sections
- 8-K: 14 sections

If you pass a 13F, DEF 14A, Form 4, or S-1 today:
- iXBRL extraction runs but finds nothing useful
- Narrative extraction falls back to `SEC_SECTIONS.get(filing_type, SEC_SECTIONS.get('10-K'))` — **defaults to 10-K patterns**
- Parser returns `metricsCount: 0, chunksCount: 0`
- Pipeline marks filing as "processed" — **silently succeeding with no data**

### 1.3 Database Schema Gaps

| Filing Type | `financial_metrics` fits? | `narrative_chunks` fits? | Needs New Table? |
|---|---|---|---|
| 10-K/10-Q/8-K | ✅ | ✅ | No |
| 13F-HR | ❌ (holdings ≠ metrics) | ❌ (no narrative) | `institutional_holdings` |
| Form 4 | ❌ (transactions ≠ metrics) | ❌ (no narrative) | `insider_transactions` |
| DEF 14A | ⚠️ Phase 2 | ✅ (narrative sections) | No (Phase 1) |
| S-1 | ✅ (same as 10-K) | ✅ (narrative sections) | No |
| Earnings | N/A | ✅ (transcript sections) | `ir_page_mappings` (for agent) |

### 1.4 Section Humanization — Two Competing Maps (Out of Sync)

- `section-exporter.service.ts` → `getSectionTitle()`: 37 entries
- `rag.service.ts` → `formatSectionName()`: 10 entries

Must consolidate into single shared module.

### 1.5 Filing Detection State

`FilingDetectionState` model tracks per-ticker: `lastCheckDate`, `lastFilingDate`, `checkCount`, `consecutiveFailures`. The cron uses this for forward-looking detection.

### 1.6 Distributed Lock

`DistributedLockService` uses `pg_try_advisory_lock()` — non-blocking. If another ECS instance holds the lock, cron skips. Lock auto-releases on disconnect. Hash function is DJB2.

---

## Part 2: Filing Type Analysis & Parser Specifications

### 2.1 Deterministic vs Agentic Split

| Component | Type | Why |
|---|---|---|
| EDGAR filing search/download | Deterministic | SEC has stable API, well-defined endpoints |
| 10-K/10-Q/8-K parsing | Deterministic | Existing Python parser with defined rules |
| 13F XML parsing | Deterministic | Standardized SEC XML schema |
| Form 4 XML parsing | Deterministic | Standardized SEC XML schema |
| DEF 14A section extraction | Deterministic | Keyword-based with LLM fallback |
| S-1 parsing | Deterministic | Reuses 10-K parser with extended sections |
| Finding a company's IR page | **Agentic** | Every company has different URLs |
| Navigating IR to find transcripts | **Agentic** | Layout varies per company, changes yearly |
| Downloading transcript content | **Agentic** | PDF, HTML, audio, embedded player formats |
| Determining what's missing | **Agentic** | Cross-references DB state with available data |
| Recovering from failures | **Agentic** | LLM tries alternative approaches |

### 2.2 Form 13F-HR — Institutional Holdings

**What**: Quarterly report of holdings by institutional managers (>$100M AUM). XML data inside HTML wrapper on EDGAR. Contains `informationTable.xml` attachment with positions.

**Parsing**: Pure deterministic XML. Parser must:
1. Locate `informationTable.xml` reference in the 13F-HR HTML filing
2. Fetch the XML from the same EDGAR accession number folder
3. Parse XML using lxml/ElementTree
4. Extract each holding: CUSIP, issuerName, shareClass, sharesHeld, marketValue, investmentDiscretion, votingAuthority
5. Resolve CUSIP to ticker using `CUSIPResolver` (see §2.7)

**Output**:
```json
{
  "structured_metrics": [],
  "narrative_chunks": [],
  "holdings": [
    {
      "cusip": "037833100",
      "issuer_name": "APPLE INC",
      "share_class": "COM",
      "shares_held": 895136266,
      "market_value": 174312000,
      "investment_discretion": "SOLE",
      "voting_sole": 895136266,
      "voting_shared": 0,
      "voting_none": 0,
      "resolved_ticker": "AAPL"
    }
  ],
  "transactions": [],
  "metadata": { "status": "success", "parser_type": "form_13f", "verification": {} }
}
```

### 2.3 Form 4 — Insider Transactions

**What**: Real-time disclosure of insider buying/selling within 2 business days. Strictly XML.

**Parsing**: Pure deterministic XML. Parser must:
1. Parse Form 4 XML (SEC-defined schema)
2. Extract reporting person (name, relationship: officer/director/10%+ owner)
3. Extract issuer (ticker, CIK)
4. Extract non-derivative transactions (date, code P/S/A/D/M, shares, price, shares_owned_after)
5. Extract derivative transactions (options, warrants — exercise price, expiration, underlying shares)

**Output**:
```json
{
  "structured_metrics": [],
  "narrative_chunks": [],
  "holdings": [],
  "transactions": [
    {
      "insider_name": "Jensen Huang",
      "insider_title": "Chief Executive Officer",
      "relationship": "Officer",
      "transaction_date": "2025-03-01",
      "transaction_code": "S",
      "shares_transacted": 50000,
      "price_per_share": 875.50,
      "shares_owned_after": 3200000,
      "is_derivative": false,
      "derivative_title": null,
      "exercise_price": null,
      "expiration_date": null
    }
  ],
  "metadata": { "status": "success", "parser_type": "form_4", "verification": {} }
}
```

### 2.4 DEF 14A — Proxy Statement

**What**: Annual proxy statement for shareholder meeting. Complex HTML. No standardized section numbering — the messiest SEC filing type.

**Parsing**: Keyword-based section detection. Phase 1 is narrative extraction only (no structured compensation tables).

**Section Keywords**:
```python
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
```

Parser approach:
1. Extract all text from HTML
2. Scan for section keywords (case-insensitive)
3. When keyword found, start new section; end previous section
4. Chunk within each identified section at ~500 word boundaries
5. If fewer than 3 of 9 sections detected, flag filing for review — do NOT mark as successfully processed

**Output**: Narrative chunks with `section_type` values from the PROXY_SECTIONS keys. No structured metrics in Phase 1.

### 2.5 S-1 — Registration Statement

**What**: Registration statement for IPO. Essentially a super-charged 10-K.

**Parsing**: Reuse existing `hybrid_parser.py` with extended `SEC_SECTIONS`. Add S-1 specific section definitions:

```python
'S-1': {
    'prospectus_summary': r'(?:PROSPECTUS|Prospectus)\s*SUMMARY|Summary',
    'risk_factors': r'RISK\s*FACTORS|Risk\s*Factors',
    'use_of_proceeds': r'USE\s*OF\s*PROCEEDS|Use\s*of\s*Proceeds',
    'dilution': r'DILUTION|Dilution',
    'capitalization': r'CAPITALIZATION|Capitalization',
    'dividend_policy': r'DIVIDEND\s*POLICY|Dividend\s*Policy',
    'mda': r"MANAGEMENT.S\s*DISCUSSION|Management.s\s*Discussion",
    'business': r'(?:^|\s)BUSINESS(?:\s|$)|Our\s*Business',
    'management': r'MANAGEMENT(?:\s|$)|DIRECTORS|Executive\s*Officers',
    'principal_stockholders': r'PRINCIPAL\s*STOCKHOLDERS|SECURITY\s*OWNERSHIP',
    'description_capital_stock': r'DESCRIPTION\s*OF\s*CAPITAL',
    'underwriting': r'UNDERWRITING|Underwriting',
    'financial_statements': r'FINANCIAL\s*STATEMENTS|INDEX\s*TO.*FINANCIAL',
}
```

### 2.6 Earnings Call Transcripts

**What**: Text transcription of quarterly earnings calls. NOT an SEC filing — sourced from company IR pages.

**Parsing**: Structured section extraction with confidence-scored speaker diarization.

**Speaker Diarization Patterns** (ordered by confidence):
```python
SPEAKER_PATTERNS = [
    (r'^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*[—–-]\s*(.+)$', 0.95),  # Name — Title
    (r'^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*\((.+)\)$', 0.90),       # Name (Title)
    (r'^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*:$', 0.75),              # Name:
    (r'^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*(.+)$', 0.70),          # Name, Title
]

QA_DIVIDER_PATTERNS = [
    (r'question.and.answer\s*session', 0.99),
    (r'q\s*&\s*a\s*session', 0.95),
    (r'operator\s*instructions', 0.90),
    (r'we.(?:ll|will)\s*now\s*(?:open|take)\s*(?:the\s*)?(?:line|floor|questions)', 0.95),
    (r'open\s*(?:it|the\s*line)\s*(?:up\s*)?for\s*questions', 0.90),
]
```

**CRITICAL RULE**: If Q&A divider confidence < 0.7, fall back to `earnings_full_transcript` (single section). If speaker diarization confidence < 0.7 for a speaker boundary, set `subsection_name = null`. **Never guess. Unattributed is better than mis-attributed.**

**Output**: Narrative chunks with `section_type` = `earnings_participants` | `earnings_prepared_remarks` | `earnings_qa` | `earnings_full_transcript`. `subsection_name` = speaker name (e.g., "Jensen Huang, CEO").

**subsectionName usage note**: This field is semantically overloaded (filing subsections vs speaker names) but pragmatically fine for Phase 1. The semantic retriever filters by `sectionType` first, so `subsectionName='Jensen Huang, CEO'` won't collide with `subsectionName='Revenue Recognition'` because they have different sectionTypes.

### 2.7 CUSIP Resolution — Without External APIs

The 13F `informationTable.xml` includes `issuerName` alongside each CUSIP. We resolve to tickers using SEC's own data:

```python
class CUSIPResolver:
    """
    Resolves CUSIP to ticker using SEC company_tickers.json.
    No external API dependencies (no OpenFIGI, no Bloomberg).
    
    Strategy:
    1. Load SEC company_tickers.json (same file SecService already uses)
    2. Build reverse map: normalized_company_name → ticker
    3. Match 13F issuerName against SEC company names
    4. Strip common suffixes (Inc, Corp, Ltd, etc.) for fuzzy matching
    5. Cache resolved mappings in DB for reuse
    6. If no match: ticker=NULL, preserve issuerName
       NEVER guess — wrong ticker is worse than no ticker
    """
    
    def __init__(self):
        self.sec_tickers = {}       # name_lower → ticker
        self.cusip_cache = {}       # cusip → ticker | None
    
    async def load_sec_tickers(self):
        # GET https://www.sec.gov/files/company_tickers.json
        # Returns: { "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc"}, ... }
        for entry in sec_data.values():
            name_lower = entry['title'].lower().strip()
            self.sec_tickers[name_lower] = entry['ticker']
            # Also store stripped versions
            for suffix in [' inc', ' inc.', ' corp', ' corp.', ' co', ' co.', 
                          ' ltd', ' ltd.', ' plc', ' llc', ' lp', ' n.v.', 
                          ' sa', ' ag', ' se', ' group', ' holdings']:
                if name_lower.endswith(suffix):
                    stripped = name_lower[:-len(suffix)].strip()
                    if stripped and len(stripped) > 2:
                        self.sec_tickers[stripped] = entry['ticker']
    
    def resolve(self, cusip: str, issuer_name: str) -> str | None:
        if cusip in self.cusip_cache:
            return self.cusip_cache[cusip]
        
        name_lower = issuer_name.lower().strip()
        
        # Exact match
        if name_lower in self.sec_tickers:
            self.cusip_cache[cusip] = self.sec_tickers[name_lower]
            return self.cusip_cache[cusip]
        
        # Suffix-stripped match
        for suffix in [' inc', ' inc.', ' corp', ' corp.', ' co', ' co.',
                      ' ltd', ' plc', ' llc', ' lp', ' class a',
                      ' class b', ' class c', ' com', ' common stock']:
            stripped = name_lower.rstrip('.').strip()
            if stripped.endswith(suffix):
                stripped = stripped[:-len(suffix)].strip()
                if stripped in self.sec_tickers:
                    self.cusip_cache[cusip] = self.sec_tickers[stripped]
                    return self.cusip_cache[cusip]
        
        # No match — return None, store None in cache
        self.cusip_cache[cusip] = None
        return None
```

---

## Part 3: Accuracy & Verification Framework

### 3.1 Verification Strategies by Filing Type

| Filing Type | Verification | Automated? | Target | When It Runs |
|---|---|---|---|---|
| 10-K/10-Q metrics | Mathematical reconciliation (totals = sum of components) | Yes | 99.99% | Every parse |
| 8-K metrics | Cross-reference with iXBRL tags | Yes | 99.99% | Every parse |
| 13F holdings | Count + value match against cover page | Yes | 100% | Every parse |
| Form 4 transactions | Element count match against XML tables | Yes | 100% | Every parse |
| DEF 14A narratives | Structural (Tier 1) + Semantic (Tier 2) | T1: Yes, T2: 10% sampled | 95%+ sections | Every parse / sampled |
| S-1 narratives | Same as 10-K section extraction | Yes | 99%+ | Every parse |
| Earnings transcripts | Word preservation + attribution rate | Yes | 99%+ content, 90%+ attribution | Every parse |

### 3.2 13F Verification

```python
def verify_13f(extracted_holdings, filing_html):
    """
    13F cover page includes:
    - <tableEntryTotal>147</tableEntryTotal>
    - <tableValueTotal>45234567</tableValueTotal>
    
    Verify extracted count and total value match.
    """
    cover = parse_13f_cover(filing_html)
    
    count_match = len(extracted_holdings) == cover.table_entry_total
    
    extracted_total = sum(h['market_value'] for h in extracted_holdings)
    value_match = abs(extracted_total - cover.table_value_total) < 1000
    
    return {
        'passed': count_match and value_match,
        'expected_count': cover.table_entry_total,
        'actual_count': len(extracted_holdings),
        'expected_value': cover.table_value_total,
        'actual_value': extracted_total,
    }
```

### 3.3 Form 4 Verification

```python
def verify_form4(extracted_transactions, xml_content):
    """Count entries in <nonDerivativeTable> and <derivativeTable>."""
    tree = ET.parse(xml_content)
    non_deriv_count = len(tree.findall('.//nonDerivativeTransaction'))
    deriv_count = len(tree.findall('.//derivativeTransaction'))
    
    extracted_non_deriv = [t for t in extracted_transactions if not t['is_derivative']]
    extracted_deriv = [t for t in extracted_transactions if t['is_derivative']]
    
    return {
        'passed': (len(extracted_non_deriv) == non_deriv_count and 
                   len(extracted_deriv) == deriv_count),
        'expected_non_derivative': non_deriv_count,
        'actual_non_derivative': len(extracted_non_deriv),
        'expected_derivative': deriv_count,
        'actual_derivative': len(extracted_deriv),
    }
```

### 3.4 DEF 14A Verification — Two Tiers

**Tier 1 (automated, every parse)**:
```python
def verify_proxy_structural(extracted_sections, raw_html_word_count):
    issues = []
    
    if len(extracted_sections) < 3:
        issues.append(f"Only {len(extracted_sections)}/9 sections found")
    
    for section in extracted_sections:
        word_count = len(section['content'].split())
        if word_count < 100:
            issues.append(f"{section['section_type']}: only {word_count} words")
        
        keywords = PROXY_SECTIONS.get(section['section_type'], [])
        keyword_found = any(kw.lower() in section['content'].lower() for kw in keywords[:3])
        if not keyword_found:
            issues.append(f"{section['section_type']}: no keywords in content")
    
    return {
        'passed': len(issues) == 0,
        'sections_found': len(extracted_sections),
        'issues': issues,
        'confidence': max(0, 1.0 - len(issues) * 0.15)
    }
```

**Tier 2 (sampled, 10% of parses)**:
```python
async def verify_proxy_semantic(extracted_sections, ticker):
    """Send first 200 words of each section to Haiku for classification."""
    for section in extracted_sections:
        snippet = ' '.join(section['content'].split()[:200])
        response = await haiku.classify(
            f"Does this text discuss {section['section_type'].replace('_', ' ')}? "
            f"Answer YES, NO, or UNCLEAR.\n\nText: {snippet}"
        )
        if response == 'NO':
            flag_for_review(ticker, section['section_type'])
```

### 3.5 Transcript Verification

```python
def verify_transcript(original_text, chunks):
    original_words = len(original_text.split())
    extracted_words = sum(len(c['content'].split()) for c in chunks)
    word_ratio = extracted_words / original_words if original_words > 0 else 0
    
    attributed = sum(1 for c in chunks if c.get('subsection_name'))
    attribution_rate = attributed / len(chunks) if chunks else 0
    
    has_prepared = any(c['section_type'] == 'earnings_prepared_remarks' for c in chunks)
    has_qa = any(c['section_type'] == 'earnings_qa' for c in chunks)
    
    return {
        'word_preservation': word_ratio,
        'word_preservation_ok': 0.95 <= word_ratio <= 1.05,
        'attribution_rate': attribution_rate,
        'chunk_count': len(chunks),
        'has_prepared': has_prepared,
        'has_qa': has_qa,
        'passed': (0.95 <= word_ratio <= 1.05) and attribution_rate >= 0.5,
    }
```

---

## Part 4: Database Schema Changes

### 4.1 New Tables (Prisma migration — Phase 1)

```prisma
model InstitutionalHolding {
  id                    String    @id @default(uuid())
  ticker                String?   @db.VarChar(10)           // Resolved (NULL if unresolved)
  holderCik             String    @map("holder_cik")
  holderName            String    @map("holder_name")
  cusip                 String    @db.VarChar(9)
  issuerName            String    @map("issuer_name")       // Always from 13F
  shareClass            String?   @map("share_class")
  sharesHeld            BigInt    @map("shares_held")
  marketValue           Decimal   @db.Decimal(20,2) @map("market_value")
  investmentDiscretion  String?   @map("investment_discretion")
  votingSole            BigInt?   @map("voting_sole")
  votingShared          BigInt?   @map("voting_shared")
  votingNone            BigInt?   @map("voting_none")
  reportDate            DateTime  @map("report_date")
  filingDate            DateTime  @map("filing_date")
  accessionNo           String    @map("accession_no")
  quarter               String    @db.VarChar(10)
  createdAt             DateTime  @default(now()) @map("created_at")

  @@unique([holderCik, cusip, reportDate, accessionNo])
  @@index([ticker])
  @@index([holderCik])
  @@index([cusip])
  @@index([reportDate])
  @@map("institutional_holdings")
}

model InsiderTransaction {
  id                   String    @id @default(uuid())
  ticker               String    @db.VarChar(10)
  insiderName          String    @map("insider_name")
  insiderTitle         String?   @map("insider_title")
  insiderRelationship  String    @map("insider_relationship")
  transactionDate      DateTime  @map("transaction_date")
  transactionCode      String    @map("transaction_code") @db.VarChar(5)
  equitySwap           Boolean   @default(false) @map("equity_swap")
  sharesTransacted     Decimal   @db.Decimal(20,4) @map("shares_transacted")
  pricePerShare        Decimal?  @db.Decimal(20,4) @map("price_per_share")
  sharesOwnedAfter     Decimal?  @db.Decimal(20,4) @map("shares_owned_after")
  isDerivative         Boolean   @default(false) @map("is_derivative")
  derivativeTitle      String?   @map("derivative_title")
  exercisePrice        Decimal?  @db.Decimal(20,4) @map("exercise_price")
  expirationDate       DateTime? @map("expiration_date")
  underlyingShares     Decimal?  @db.Decimal(20,4) @map("underlying_shares")
  filingDate           DateTime  @map("filing_date")
  accessionNo          String    @map("accession_no")
  createdAt            DateTime  @default(now()) @map("created_at")

  @@unique([ticker, accessionNo, insiderName, transactionDate, transactionCode, isDerivative])
  @@index([ticker])
  @@index([insiderName])
  @@index([transactionDate])
  @@index([ticker, transactionDate])
  @@map("insider_transactions")
}

model IrPageMapping {
  id                    String    @id @default(uuid())
  ticker                String    @unique @db.VarChar(10)
  companyName           String    @map("company_name")
  irBaseUrl             String    @map("ir_base_url")
  earningsPageUrl       String?   @map("earnings_page_url")
  transcriptsPageUrl    String?   @map("transcripts_page_url")
  secFilingsPageUrl     String?   @map("sec_filings_page_url")
  pressReleasesUrl      String?   @map("press_releases_url")
  webcastsUrl           String?   @map("webcasts_url")
  confidence            Decimal?  @db.Decimal(3,2)
  lastVerified          DateTime  @map("last_verified")
  lastSuccessful        DateTime? @map("last_successful")
  verificationFailures  Int       @default(0) @map("verification_failures")
  notes                 String?
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @default(now()) @updatedAt @map("updated_at")

  @@map("ir_page_mappings")
}
```

### 4.2 Unique Key Design Rationale

- **InstitutionalHolding**: `[holderCik, cusip, reportDate, accessionNo]` — handles amended 13F filings (same holder + CUSIP + date, different accession number)
- **InsiderTransaction**: `[ticker, accessionNo, insiderName, transactionDate, transactionCode, isDerivative]` — handles same-day derivative + equity transactions, and amended filings

---

## Part 5: Python Parser Dispatcher

### 5.1 Dispatcher in api_server.py

```python
FILING_PARSERS = {
    '10-K': 'hybrid',      '10-K/A': 'hybrid',
    '10-Q': 'hybrid',      '10-Q/A': 'hybrid',
    '8-K': 'hybrid',
    'S-1': 'hybrid_s1',    'S-1/A': 'hybrid_s1',
    '13F-HR': 'form_13f',  '13F-HR/A': 'form_13f',
    'DEF 14A': 'proxy',    'DEFA14A': 'proxy',
    '4': 'form_4',         '4/A': 'form_4',
    'EARNINGS': 'transcript',
}

@app.post("/sec-parser")
async def sec_parser_dispatch(request: dict):
    filing_type = request.get("filing_type", "10-K")
    parser_key = FILING_PARSERS.get(filing_type)
    
    if parser_key is None:
        # NEVER silently fall through to hybrid parser
        return {
            "structured_metrics": [], "narrative_chunks": [],
            "holdings": [], "transactions": [],
            "metadata": {
                "ticker": request.get("ticker", "UNKNOWN"),
                "filing_type": filing_type,
                "status": "unsupported_filing_type",
                "message": f"Parser not implemented for: {filing_type}"
            }
        }
    
    # Dispatch to appropriate parser
    dispatch = {
        'hybrid': parse_with_hybrid,
        'hybrid_s1': parse_with_hybrid_s1,
        'form_13f': parse_13f,
        'proxy': parse_proxy,
        'form_4': parse_form4,
        'transcript': parse_transcript,
    }
    return await dispatch[parser_key](request)
```

### 5.2 Unified Response Schema

ALL parsers return:
```json
{
  "structured_metrics": [...],
  "narrative_chunks": [...],
  "holdings": [...],
  "transactions": [...],
  "metadata": {
    "ticker": "NVDA",
    "filing_type": "DEF 14A",
    "total_metrics": 0,
    "total_chunks": 23,
    "total_holdings": 0,
    "total_transactions": 0,
    "parser_type": "proxy",
    "status": "success",
    "verification": { "passed": true, "sections_found": 7, "issues": [] }
  }
}
```

### 5.3 IngestionService — Updated Routing

```typescript
// ingestion.service.ts — updated ingestFiling()
async ingestFiling(ticker, cik, filingUrl, filingType, filingDate) {
  const parsedData = await this.parseWithPythonRetry(htmlContent, ticker, filingType, cik);
  
  // Reject unsupported filing types cleanly
  if (parsedData.metadata?.status === 'unsupported_filing_type') {
    this.logger.warn(`Unsupported: ${filingType} for ${ticker}`);
    return { status: 'skipped', reason: 'unsupported_filing_type' };
  }
  
  // Route by what the parser produced
  if (parsedData.holdings?.length > 0) await this.storeHoldings(ticker, parsedData);
  if (parsedData.transactions?.length > 0) await this.storeInsiderTransactions(ticker, parsedData);
  if (parsedData.structured_metrics?.length > 0) await this.storeMetrics(ticker, parsedData);
  if (parsedData.narrative_chunks?.length > 0) await this.storeNarrativeChunks(ticker, parsedData);
  
  // Flag failed verification
  if (parsedData.metadata?.verification && !parsedData.metadata.verification.passed) {
    this.logger.warn(`⚠️ Verification FAILED: ${ticker} ${filingType}`);
    await this.flagFilingForReview(ticker, filingType, filingDate, parsedData.metadata.verification);
  }
}
```

---

## Part 6: Agentic Architecture

### 6.1 Why Agentic (for Transcripts)

A hardcoded pipeline breaks when:
- A company redesigns their IR page (happens yearly)
- Transcript links use unexpected formats (PDF vs HTML vs embedded player)
- A company calls their earnings page "Quarterly Results" instead of "Earnings"
- Companies move IR platforms (from custom to Shareholder.com to Q4 Inc)

An LLM agent reads the page like a human. It understands that "Q4 FY2025 Financial Results" is an earnings call page even without a prior rule.

SEC filings (13F, Form 4, DEF 14A, S-1) do NOT need agentic acquisition — EDGAR has a stable API. Only transcript acquisition is agentic.

### 6.2 Orchestrator Agent

```typescript
class OrchestratorAgent {
  constructor(
    private secProcessingService: SecProcessingService,  // EXISTING pipeline
    private llm: BedrockClient,
    private webBrowse: WebBrowseTool,
  ) {}

  private tools: AgentTool[] = [
    new EdgarSearchTool(),          // Deterministic: search EDGAR index
    new IrPageFinderTool(),         // Agentic: finds IR page
    new WebBrowseTool(),            // Agentic: navigates web pages
    new TranscriptDownloadTool(),   // Agentic: downloads raw transcript
    new DatabaseQueryTool(),        // Checks what we already have
  ];

  async execute(task: AcquisitionTask): Promise<AcquisitionReport> {
    const report: AcquisitionReport = { ticker: task.ticker, startedAt: new Date(), actions: [], errors: [] };

    // Step 1: Assess current coverage
    const existing = await this.assessCurrentCoverage(task.ticker);

    // Step 2: Plan acquisition (LLM reasoning)
    const plan = await this.planAcquisition(task, existing);

    // Step 3: Execute plan
    for (const step of plan.steps) {
      try {
        const result = await this.executeStep(step);
        report.actions.push(result);
      } catch (error) {
        report.errors.push({ step: step.description, error: error.message, recoveryAttempted: true });
        const recovery = await this.planRecovery(step, error);
        if (recovery) {
          try { report.actions.push(await this.executeStep(recovery)); }
          catch (e) { report.errors.push({ step: `Recovery: ${recovery.description}`, error: e.message, recoveryAttempted: false }); }
        }
      }
    }

    report.completedAt = new Date();
    return report;
  }

  /**
   * Dispatch discovered SEC filing to EXISTING pipeline.
   * Agent's job ends here — pipeline handles download, parse, store.
   */
  private async dispatchToExistingPipeline(filing: DiscoveredFiling): Promise<void> {
    await this.secProcessingService.processSecFiling({
      ticker: filing.ticker,
      filingType: filing.filingType,
      filingUrl: filing.filingUrl,
      accessionNumber: filing.accessionNumber,
      filingDate: filing.filingDate,
    });
  }

  /**
   * Dispatch transcript to pipeline via NEW method.
   */
  private async dispatchTranscriptToPipeline(transcript: DownloadedTranscript): Promise<void> {
    await this.secProcessingService.processEarningsTranscript({
      ticker: transcript.ticker,
      quarter: transcript.quarter,
      year: transcript.year,
      rawText: transcript.content,
      source: transcript.source,
      callDate: transcript.callDate,
    });
  }

  private async planAcquisition(task: AcquisitionTask, existing: CoverageAssessment): Promise<AcquisitionPlan> {
    const prompt = `You are a financial data acquisition agent for FundLens.
Plan what filings and transcripts to acquire for ${task.ticker}.

CURRENT COVERAGE:
${JSON.stringify(existing, null, 2)}

TASK: ${task.type}
${task.type === 'full_acquisition' ? 'Acquire all available filings and transcripts.' :
  task.type === 'freshness_check' ? 'Check for new filings since last check.' :
  `Specific: ${task.description}`}

AVAILABLE TOOLS:
1. edgar_filing_search — Search EDGAR for filings by CIK and type
2. edgar_filing_download — Download a specific filing
3. ir_page_finder — Find company IR page URL
4. web_browse — Navigate to URL and read page content
5. transcript_download — Download transcript (HTML, PDF, text)
6. database_query — Check what we already have
7. filing_dispatch — Send to parsing pipeline

RULES:
- EDGAR first for SEC filings (10-K, 10-Q, 8-K, 13F, DEF 14A, Form 4, S-1)
- For transcripts, find IR page first, then navigate to earnings section
- Skip filings we already have
- If transcript is audio-only, note it but do not download
- Most recent filings first, then backward
- For new workspaces: ≥3 years 10-K, ≥4 quarters 10-Q

Produce step-by-step plan as JSON array:
[{ "tool": "tool_name", "params": { ... }, "description": "What this step does" }]`;

    const response = await this.llm.invoke(prompt);
    return this.parsePlan(response);
  }
}
```

### 6.3 IR Page Finder Agent

```typescript
class IrPageFinderAgent {
  async findIrPage(ticker: string, companyName: string): Promise<IrPageMapping> {
    // Check cache
    const cached = await this.getFromCache(ticker);
    if (cached && !this.isStale(cached)) return cached;

    // Search for IR page
    const searchResults = await this.webSearch(
      `${companyName} investor relations earnings transcripts`
    );

    // LLM identifies correct IR page from search results
    const irUrl = await this.identifyIrPage(searchResults, companyName, ticker);

    // Navigate and map structure
    const mapping = await this.mapIrPageStructure(irUrl, ticker, companyName);

    // Cache
    await this.cacheMapping(mapping);
    return mapping;
  }

  private async mapIrPageStructure(irUrl: string, ticker: string, companyName: string): Promise<IrPageMapping> {
    const page = await this.webBrowse(irUrl);
    const prompt = `You are navigating the investor relations website for ${companyName} (${ticker}).

PAGE URL: ${irUrl}
PAGE CONTENT: ${page.text.substring(0, 10000)}
LINKS: ${page.links.map(l => `${l.text} -> ${l.href}`).join('\n').substring(0, 5000)}

Identify URLs for each section. Set null if not found.
Respond as JSON:
{
  "earningsPage": "URL to quarterly earnings page",
  "transcriptsPage": "URL to transcripts (may be same as earnings)",
  "secFilingsPage": "URL to SEC filings page",
  "pressReleasesPage": "URL to press releases",
  "webcasts": "URL to webcasts/events",
  "confidence": 0.0-1.0,
  "notes": "observations"
}`;
    const structure = JSON.parse(await this.llm.invoke(prompt));
    return { ticker, companyName, irBaseUrl: irUrl, ...structure, lastVerified: new Date() };
  }

  private isStale(mapping: IrPageMapping): boolean {
    const days = this.daysSince(mapping.lastVerified);
    if (days > 30) return true;
    if (mapping.verificationFailures > 0 && days > 7) return true;
    if (mapping.confidence < 0.7 && days > 14) return true;
    return false;
  }
}
```

### 6.4 Transcript Acquisition Agent

```typescript
class TranscriptAcquisitionAgent {
  async acquireTranscripts(
    irMapping: IrPageMapping, ticker: string, existingQuarters: string[]
  ): Promise<TranscriptResult[]> {
    const earningsUrl = irMapping.transcriptsPageUrl || irMapping.earningsPageUrl;
    if (!earningsUrl) return [];

    const page = await this.webBrowse(earningsUrl);

    // LLM identifies available transcripts
    const available = await this.identifyAvailableTranscripts(page, ticker, existingQuarters);

    const results: TranscriptResult[] = [];
    for (const transcript of available) {
      if (existingQuarters.includes(transcript.quarterIdentifier)) continue;
      try {
        const content = await this.downloadTranscript(transcript);
        await this.dispatchToParser(content, transcript, ticker);
        results.push({ ticker, quarter: transcript.quarterIdentifier, status: 'success' });
      } catch (error) {
        results.push({ ticker, quarter: transcript.quarterIdentifier, status: 'failed', error: error.message });
      }
    }
    return results;
  }

  private async downloadTranscript(transcript: AvailableTranscript): Promise<string> {
    if (transcript.format === 'html') {
      const page = await this.webBrowse(transcript.downloadUrl);
      return await this.extractTranscriptText(page);  // LLM separates transcript from page chrome
    } else if (transcript.format === 'pdf') {
      const buffer = await this.downloadFile(transcript.downloadUrl);
      return this.extractPdfText(buffer);
    } else {
      throw new Error('Audio-only — requires Whisper transcription (future phase)');
    }
  }
}
```

### 6.5 Web Browse Tool

```typescript
class WebBrowseTool implements AgentTool {
  name = 'web_browse';

  async execute(params: { url: string }): Promise<BrowseResult> {
    // Respect robots.txt
    if (!await this.checkRobotsTxt(params.url))
      throw new Error(`Blocked by robots.txt: ${params.url}`);

    // Rate limit: 1 req/2s per domain
    await this.rateLimiter.acquire(this.getDomain(params.url));

    const response = await fetch(params.url, {
      headers: {
        'User-Agent': 'FundLens/1.0 (financial-research; support@fundlens.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${params.url}`);

    const $ = cheerio.load(await response.text());
    $('script, style, nav, footer, header, aside, .cookie-banner').remove();

    const text = $('body').text().replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const links: PageLink[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const linkText = $(el).text().trim();
      if (href && linkText) links.push({ text: linkText.substring(0, 200), href: this.resolveUrl(href, params.url) });
    });

    return { text: text.substring(0, 50000), links, url: params.url };
  }
}
```

### 6.6 Error Handling & Observability

```typescript
interface RetryConfig {
  maxRetries: 3;
  backoffMs: [5000, 30000, 300000];  // 5s, 30s, 5min
  retryableErrors: ['TIMEOUT', 'RATE_LIMITED', 'TEMPORARY_UNAVAILABLE', 'DNS_FAILURE'];
  nonRetryableErrors: ['ROBOTS_TXT_BLOCKED', 'NOT_FOUND', 'AUTHENTICATION_REQUIRED'];
}

interface AcquisitionReport {
  ticker: string;
  triggeredBy: 'scheduled' | 'deal_creation' | 'query_triggered' | 'manual';
  startedAt: Date;
  completedAt: Date;
  actions: { description: string; tool: string; status: 'success'|'failed'|'skipped'; duration_ms: number }[];
  coverage: { filingTypes: Record<string, { count: number; latest: string }>; transcriptQuarters: string[] };
  errors: { step: string; error: string; recoveryAttempted: boolean }[];
  llmCalls: number;
  totalTokens: number;
}
```

### 6.7 Cost Estimates

Per ticker acquisition: ~5-8 LLM calls, ~15K tokens. Using Haiku: ~$0.004/ticker.
500 tracked tickers daily freshness: ~$2/day, ~40 minutes runtime.
EDGAR rate: 8 req/s → 3,000 checks in ~6 minutes.
Web browsing: 1 req/2s per domain → ~33 minutes for 500 tickers.

---

## Part 7: Trigger Mechanisms

### 7.1 Existing Trigger: Cron — Expanded

```typescript
// filing-detection-scheduler.service.ts — CHANGES

// CHANGE 1: Expand filing types
// In detectAndProcessForTicker(), change:
const detectionResult = await this.detectorService.detectNewFilings(
  ticker, ['10-K', '10-Q', '8-K', '13F-HR', 'DEF 14A', '4', 'S-1']
);

// CHANGE 2: Weekly transcript check (Mondays only)
if (new Date().getDay() === 1) {  // Monday
  await this.transcriptAgent.checkForNewTranscripts(ticker);
}

// CHANGE 3: Add cron health check
@Cron('0 8 * * *', { timeZone: 'America/New_York' })
async checkCronHealth(): Promise<void> {
  const states = await this.prisma.filingDetectionState.findMany({
    orderBy: { lastCheckDate: 'desc' }, take: 1,
  });
  if (states.length === 0) return;
  const hoursSince = (Date.now() - states[0].lastCheckDate.getTime()) / 3600000;
  if (hoursSince > 26) {
    this.logger.error(`⚠️ CRON MISSED: ${hoursSince.toFixed(1)}h since last run. Catch-up.`);
    await this.runDailyDetection();
  }
}

// CHANGE 4: In getNewFilingsForDownload(), expand loop:
for (const filingType of ['10-K', '10-Q', '8-K', '13F-HR', 'DEF 14A', '4', 'S-1']) {
  // ... existing logic ...
}
```

### 7.2 New Trigger: Auto-Acquisition on Deal Creation

```typescript
// deal.service.ts — CHANGE in createDeal()

if (createDealDto.dealType === 'public' && createDealDto.ticker) {
  // Auto-start pipeline — don't wait for user to click "Start Analysis"
  setImmediate(async () => {
    try {
      await this.pipelineService.startPipeline(
        createdDeal.id, createDealDto.ticker, createDealDto.years || 5,
      );
    } catch (error) {
      this.logger.error(`Auto-pipeline failed: ${error.message}`);
      await this.updateDealStatus(createdDeal.id, 'failed',
        `Auto-processing failed: ${error.message}. Click "Retry" to try again.`);
    }
  });
}
```

### 7.3 Expanded Pipeline Steps

```typescript
// pipeline-orchestration.service.ts — CHANGES

// CHANGE 1: Expand filingTypes in Step A
filingTypes: ['10-K', '10-Q', '8-K', '13F-HR', 'DEF 14A', '4', 'S-1'],

// CHANGE 2: Add Step A2
private initializePipelineSteps(): PipelineStep[] {
  return [
    { id: 'A', name: 'Download SEC Filings', status: 'pending', message: 'Waiting...' },
    { id: 'A2', name: 'Acquire Earnings Transcripts', status: 'pending', message: 'Waiting...' },
    { id: 'B', name: 'Parse & Store Metrics', status: 'pending', message: 'Waiting...' },
    { id: 'C', name: 'Chunk & Store Narratives', status: 'pending', message: 'Waiting...' },
    { id: 'D', name: 'Sync to Bedrock KB', status: 'pending', message: 'Waiting...' },
    { id: 'E', name: 'Verify RAG Flow', status: 'pending', message: 'Waiting...' },
    { id: 'G', name: 'Build Metric Hierarchy', status: 'pending', message: 'Waiting...' },
    { id: 'H', name: 'Link Footnotes', status: 'pending', message: 'Waiting...' },
  ];
}
```

### 7.4 Query-Triggered Acquisition (Phase 5)

```typescript
// rag.service.ts — addition
if (queryReferencesInsiderData && !hasForm4Data(ticker)) {
  this.acquisitionQueue.enqueue({ ticker, filingTypes: ['4'], priority: 'medium' });
  responseMetadata.note = 'Insider transaction data is being acquired. Available shortly.';
}
```

---

## Part 8: Frontend Transparency

### 8.1 Consolidated Section Labels

Create `src/common/section-labels.ts`:

```typescript
export const SECTION_LABELS: Record<string, string> = {
  // 10-K
  'item_1': 'Business', 'item_1a': 'Risk Factors', 'item_1b': 'Unresolved Staff Comments',
  'item_1c': 'Cybersecurity', 'item_2': 'Properties', 'item_3': 'Legal Proceedings',
  'item_4': 'Mine Safety', 'item_5': 'Market for Common Equity', 'item_6': 'Reserved',
  'item_7': 'MD&A', 'item_7a': 'Market Risk', 'item_8': 'Financial Statements',
  'item_9': 'Accountant Changes', 'item_9a': 'Controls & Procedures',
  'item_9b': 'Other Information', 'item_9c': 'Foreign Jurisdictions',
  'item_10': 'Directors & Officers', 'item_11': 'Executive Compensation',
  'item_12': 'Security Ownership', 'item_13': 'Related Party Transactions',
  'item_14': 'Accountant Fees', 'item_15': 'Exhibits', 'item_16': 'Form 10-K Summary',
  // 8-K
  'item_1_01': 'Material Definitive Agreement', 'item_2_02': 'Results of Operations',
  'item_5_02': 'Director/Officer Changes', 'item_7_01': 'Regulation FD',
  'item_8_01': 'Other Events', 'item_9_01': 'Financial Statements & Exhibits',
  // DEF 14A
  'executive_compensation': 'Executive Compensation', 'director_compensation': 'Director Compensation',
  'board_composition': 'Board of Directors', 'shareholder_proposals': 'Shareholder Proposals',
  'corporate_governance': 'Corporate Governance', 'related_party_transactions': 'Related Party Transactions',
  'ceo_pay_ratio': 'CEO Pay Ratio', 'pay_vs_performance': 'Pay vs. Performance',
  'audit_committee': 'Audit Committee', 'stock_ownership': 'Stock Ownership',
  // S-1
  'prospectus_summary': 'Prospectus Summary', 'use_of_proceeds': 'Use of Proceeds',
  'dilution': 'Dilution', 'capitalization': 'Capitalization', 'dividend_policy': 'Dividend Policy',
  'principal_stockholders': 'Principal Stockholders', 'description_capital_stock': 'Capital Stock',
  'underwriting': 'Underwriting',
  // Earnings
  'earnings_participants': 'Call Participants', 'earnings_prepared_remarks': 'Prepared Remarks',
  'earnings_qa': 'Q&A Session', 'earnings_full_transcript': 'Earnings Call Transcript',
  // Common
  'risk_factors': 'Risk Factors', 'business': 'Business Overview',
  'mda': 'MD&A', 'management': 'Management', 'financial_statements': 'Financial Statements',
  'general': 'General', 'preamble': 'Filing Preamble', 'uploaded_document': 'Uploaded Document',
};

export const FILING_TYPE_LABELS: Record<string, string> = {
  '10-K': 'Annual Report (10-K)', '10-Q': 'Quarterly Report (10-Q)', '8-K': 'Current Report (8-K)',
  '13F-HR': 'Institutional Holdings (13F)', 'DEF 14A': 'Proxy Statement', 'DEFA14A': 'Proxy Statement',
  '4': 'Insider Transaction (Form 4)', 'S-1': 'Registration Statement (S-1)',
  'EARNINGS': 'Earnings Call Transcript',
  '10-K/A': 'Annual Report Amendment', '10-Q/A': 'Quarterly Report Amendment',
  '13F-HR/A': 'Holdings Amendment', '4/A': 'Form 4 Amendment', 'S-1/A': 'Registration Amendment',
};

export function humanizeSectionType(s: string): string {
  return SECTION_LABELS[s] || s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
export function humanizeFilingType(f: string): string {
  return FILING_TYPE_LABELS[f] || f;
}
```

### 8.2 Replace Both Existing Maps

```typescript
// section-exporter.service.ts — replace getSectionTitle() with import from section-labels
// rag.service.ts — replace formatSectionName() with import from section-labels
```

### 8.3 Citation Display Enhancement

| Filing Type | Citation Format |
|---|---|
| 10-K | "Annual Report (10-K) — Risk Factors — Q3 2025" |
| DEF 14A | "Proxy Statement — Executive Compensation — 2025" |
| Earnings | "Earnings Call Transcript — Prepared Remarks — Jensen Huang, CEO — Q3 2025" |
| 13F | "Institutional Holdings (13F) — Q3 2025" |
| Form 4 | "Insider Transaction (Form 4) — Mar 15, 2025" |

### 8.4 Data Coverage Endpoint (NEW)

`GET /api/deals/:id/data-coverage` — shows what data is available per deal:
```
📊 Data Sources for NVDA
├── Annual Reports (10-K): 5 filings (2020-2024) ✅
├── Quarterly Reports (10-Q): 16 filings ✅
├── Current Reports (8-K): 23 filings ✅
├── Proxy Statements (DEF 14A): 4 filings ✅
├── Insider Transactions (Form 4): 87 filings ✅
├── Institutional Holdings (13F): 12 quarters ✅
├── Earnings Transcripts: 8 calls ✅
└── Last updated: March 4, 2026 at 6:02 AM ET
```

---

## Part 9: Deployment Phases — THE EXECUTION PLAN

### Phase 1: Foundation — Dispatcher + Auto-Trigger + Schema (Week 1-2)

**DO:**
1. Create `src/common/section-labels.ts` with all labels (§8.1)
2. Replace `getSectionTitle()` in section-exporter.service.ts with import
3. Replace `formatSectionName()` in rag.service.ts with import
4. Run Prisma migration: add `InstitutionalHolding`, `InsiderTransaction`, `IrPageMapping` tables
5. Add dispatcher to `api_server.py` (§5.1) — unknown types return `unsupported_filing_type`
6. Expand filingTypes in:
   - `filing-detector.service.ts` default parameter (line ~59)
   - `filing-detection-scheduler.service.ts` `getNewFilingsForDownload()` loop (line ~324)
   - `pipeline-orchestration.service.ts` Step A config (line ~403)
7. Add auto-trigger in `deal.service.ts` `createDeal()` (§7.2)
8. Add cron health check at 8 AM (§7.1, Change 3)
9. Update `initializePipelineSteps()` to include Step A2 (§7.3)

**DON'T:**
- Don't implement any new parsers yet
- Don't modify existing hybrid_parser.py
- Don't modify existing financial_metrics schema

**VERIFY (Phase 1 Tests):**
| ID | Test | Expected |
|---|---|---|
| P1-T1 | Create public deal with NVDA ticker | Pipeline auto-starts (no manual click needed) |
| P1-T2 | Run cron detection for NVDA | Detects 13F, DEF 14A, Form 4 filings on EDGAR |
| P1-T3 | Cron processes detected 13F filing | Returns `status: 'unsupported_filing_type'`, NOT empty success |
| P1-T4 | Existing 10-K processing | Unchanged — all existing test cases pass |
| P1-T5 | Section label consistency | `humanizeSectionType('item_7')` returns 'MD&A' in both exporter and RAG |
| P1-T6 | Database migration | All 3 new tables created, no impact on existing tables |
| P1-T7 | Cron health check | If lastCheckDate > 26h ago, triggers catch-up run |

### Phase 2: Form 4 + 13F Parsers (Week 3-5)

**DO:**
1. Implement `python_parser/parse_form4.py` — XML parser + verification (§2.3, §3.3)
2. Implement `python_parser/parse_13f.py` — XML parser + verification (§2.2, §3.2)
3. Implement `python_parser/cusip_resolver.py` — SEC company_tickers.json (§2.7)
4. Wire into dispatcher in `api_server.py`
5. Add `storeHoldings()` to ingestion.service.ts
6. Add `storeInsiderTransactions()` to ingestion.service.ts
7. Add structured query routes in RAG for insider/institutional data
8. Add provocation templates referencing insider activity + institutional changes
9. Add `GET /api/deals/:id/data-coverage` endpoint (§8.4)

**DON'T:**
- Don't modify existing hybrid_parser.py
- Don't modify existing 10-K/10-Q/8-K processing

**VERIFY (Phase 2 Tests):**
| ID | Test | Expected |
|---|---|---|
| P2-T1 | Parse Berkshire 13F-HR | Holdings count matches cover page `tableEntryTotal` exactly |
| P2-T2 | Parse Berkshire 13F-HR | Total value matches cover page `tableValueTotal` within $1000 |
| P2-T3 | Parse Berkshire 13F-HR | Top 5 positions by value match manual reading |
| P2-T4 | Parse 13F-HR/A (amendment) | Both original and amendment stored (different accessionNo) |
| P2-T5 | CUSIP "037833100" + issuer "APPLE INC" | Resolves to ticker "AAPL" |
| P2-T6 | CUSIP for obscure issuer | Returns `ticker=NULL`, `issuerName` preserved |
| P2-T7 | Parse 5 recent NVDA Form 4s | Transaction count matches XML element counts for each |
| P2-T8 | Form 4 with derivative transaction | `isDerivative=true`, exercisePrice populated |
| P2-T9 | Form 4 with multiple transactions | All transactions extracted (not just first) |
| P2-T10 | Form 4/A (amendment) | Stored with different accessionNo |
| P2-T11 | Query: "Who are NVDA's largest institutional holders?" | Returns structured data from institutional_holdings |
| P2-T12 | Query: "Any insider selling at NVDA?" | Returns Form 4 data from insider_transactions |
| P2-T13 | Data coverage endpoint for NVDA | Shows filing counts per type including 13F and Form 4 |
| P2-T14 | Existing 10-K queries still work | All pre-existing test cases pass (zero regression) |

### Phase 3: DEF 14A + S-1 Parsers (Week 6-8)

**DO:**
1. Implement `python_parser/parse_proxy.py` — keyword section detection + Tier 1 verification (§2.4, §3.4)
2. Extend `hybrid_parser.py` with S-1 section definitions (§2.5) — add to `SEC_SECTIONS` dict ONLY
3. Wire proxy and hybrid_s1 into dispatcher
4. Implement Tier 2 semantic verification (sampled 10%) (§3.4)
5. Add proxy section routing in RAG (compensation queries → executive_compensation chunks)
6. Add provocation templates for governance concerns

**DON'T:**
- Don't modify existing 10-K/10-Q/8-K parsing logic in hybrid_parser.py
- Only ADD new entries to SEC_SECTIONS dict; don't change existing entries

**VERIFY (Phase 3 Tests):**
| ID | Test | Expected |
|---|---|---|
| P3-T1 | Parse AAPL latest DEF 14A | ≥5 of 9 sections extracted |
| P3-T2 | Parse NVDA latest DEF 14A | ≥5 of 9 sections extracted |
| P3-T3 | Parse JPM latest DEF 14A | ≥5 of 9 sections extracted (bank format) |
| P3-T4 | Any DEF 14A section | Word count >100 per section |
| P3-T5 | `executive_compensation` section | Contains word "compensation" in content |
| P3-T6 | All 3 proxies | Structural verification (Tier 1) passes |
| P3-T7 | DEF 14A with <3 sections detected | Flagged for review, NOT marked as success |
| P3-T8 | Recent large-cap S-1 | ≥8 of 13 defined sections extracted |
| P3-T9 | S-1 risk factors | Contains word "risk" |
| P3-T10 | S-1 financial metrics | iXBRL extraction produces >0 metrics |
| P3-T11 | Query: "What is NVDA CEO's compensation?" | Pulls from DEF 14A chunks |
| P3-T12 | Existing 10-K queries still work | All pre-existing test cases pass |

### Phase 4: Agentic Transcript Acquisition (Week 9-11)

**DO:**
1. Implement `WebBrowseTool` (HTTP + Cheerio, robots.txt, rate limiting) (§6.5)
2. Implement `IrPageFinderAgent` with web search + LLM page analysis (§6.3)
3. Implement `TranscriptAcquisitionAgent` (§6.4)
4. Implement `python_parser/parse_transcript.py` — confidence-scored diarization (§2.6)
5. Wire transcript parser into dispatcher as `'EARNINGS': 'transcript'`
6. Add `processEarningsTranscript()` method to sec-processing.service.ts
7. Implement `OrchestratorAgent` skeleton with plan/execute loop (§6.2)
8. Add Step A2 execution logic in pipeline-orchestration.service.ts
9. Add transcript section routing in RAG
10. Add transcript citations with speaker attribution (§8.3)

**DON'T:**
- Don't implement audio transcription (Whisper — future phase)
- Don't break existing SEC filing pipeline

**VERIFY (Phase 4 Tests):**
| ID | Test | Expected |
|---|---|---|
| P4-T1 | WebBrowseTool fetches investor.nvidia.com | Returns text + links, respects robots.txt |
| P4-T2 | IR Finder for NVDA | Finds investor.nvidia.com, maps earnings page URL |
| P4-T3 | IR Finder for AAPL | Finds investor.apple.com, maps earnings page URL |
| P4-T4 | IR Finder for obscure company | Returns low confidence, doesn't crash |
| P4-T5 | IR mapping cached | Second lookup uses cache, no web search |
| P4-T6 | IR mapping stale (>30 days) | Re-verifies IR page |
| P4-T7 | Parse NVDA Q3 2025 transcript | Participant list with ≥3 executives and ≥3 analysts |
| P4-T8 | Parse NVDA Q3 2025 transcript | Split into prepared_remarks + qa sections |
| P4-T9 | Parse NVDA Q3 2025 transcript | Word preservation ratio 0.95-1.05 |
| P4-T10 | Parse NVDA Q3 2025 transcript | ≥50% chunks have speaker attribution |
| P4-T11 | Parse NVDA Q3 2025 transcript | CEO remarks attributed to "Jensen Huang" |
| P4-T12 | Transcript without clear Q&A divider | Falls back to `earnings_full_transcript` gracefully |
| P4-T13 | PDF transcript | Text extraction produces parseable content |
| P4-T14 | Query: "What did Jensen Huang say about data center revenue?" | Returns attributed content from transcript |
| P4-T15 | Query: "How has management tone changed over last 4 quarters?" | Cross-quarter transcript analysis |
| P4-T16 | Existing SEC queries still work | All pre-existing test cases pass |

### Phase 5: Query-Triggered + Freshness (Week 12-13)

**DO:**
1. Implement query-triggered background acquisition (§7.4)
2. Weekly transcript freshness check on Mondays (§7.1, Change 2)
3. User-facing note when data is being acquired ("Filing data is being acquired...")
4. Full data coverage display in frontend (§8.4)
5. Connect orchestrator to all triggers (deal creation, cron, query-triggered)

**VERIFY (Phase 5 Tests):**
| ID | Test | Expected |
|---|---|---|
| P5-T1 | Query referencing missing Form 4 data | Triggers background acquisition, shows note |
| P5-T2 | Monday cron | Includes transcript freshness check |
| P5-T3 | Tuesday cron | Does NOT run transcript check |
| P5-T4 | New deal creation for new ticker | Full acquisition of all filing types + transcripts |
| P5-T5 | Data coverage display | Shows counts per filing type, last updated timestamp |
| P5-T6 | Cron missed (simulate) | 8 AM health check triggers catch-up |

### Phase 6: Audio Transcription (FUTURE — NOT IN SCOPE)

For companies with audio-only webcasts: Whisper/AWS Transcribe → LLM post-processing → same transcript parser. Defer until text transcript pipeline is proven and a client requests it.

---

## Part 10: Comprehensive File Change Index

### New Files (create these)
| File | Phase | Purpose |
|---|---|---|
| `src/common/section-labels.ts` | 1 | Consolidated section/filing type humanization |
| `python_parser/parse_form4.py` | 2 | Form 4 XML parser |
| `python_parser/parse_13f.py` | 2 | 13F-HR XML parser |
| `python_parser/cusip_resolver.py` | 2 | CUSIP → ticker via SEC data |
| `python_parser/parse_proxy.py` | 3 | DEF 14A section extractor |
| `python_parser/parse_transcript.py` | 4 | Earnings transcript parser |
| `src/agents/orchestrator.agent.ts` | 4 | Orchestrator agent |
| `src/agents/ir-page-finder.agent.ts` | 4 | IR page discovery |
| `src/agents/transcript-acquisition.agent.ts` | 4 | Transcript download |
| `src/agents/tools/web-browse.tool.ts` | 4 | HTTP + Cheerio browsing |

### Modified Files (edit these)
| File | Phase | Change |
|---|---|---|
| `python_parser/api_server.py` | 1 | Add dispatcher |
| `python_parser/hybrid_parser.py` | 3 | Add S-1 sections to SEC_SECTIONS dict |
| `prisma/schema.prisma` | 1 | Add 3 new models |
| `src/filings/filing-detector.service.ts` | 1 | Expand default filingTypes |
| `src/filings/filing-detection-scheduler.service.ts` | 1 | Expand types, health check, transcript day |
| `src/dataSources/sec/ingestion.service.ts` | 2 | Route holdings/transactions |
| `src/deals/deal.service.ts` | 1 | Auto-trigger on deal creation |
| `src/deals/pipeline-orchestration.service.ts` | 1 | Expand filingTypes, add Step A2 |
| `src/rag/section-exporter.service.ts` | 1 | Import from section-labels |
| `src/rag/rag.service.ts` | 1,2 | Import section-labels, add structured routes |

### Frontend Changes
| Component | Phase | Change |
|---|---|---|
| Citation display | 1 | Use humanized labels |
| Pipeline status | 1 | Show Step A2 |
| Deal creation | 1 | Remove manual "Start Analysis" |
| Deal page | 2 | Add data coverage display |

---

## WHAT THIS UNLOCKS

When all phases are deployed, creating a deal for NVDA triggers:

1. EDGAR agent downloads all 10-K, 10-Q, 8-K, 13F, DEF 14A, Form 4 filings
2. IR Finder agent locates investor.nvidia.com
3. Transcript agent downloads 8-12 quarters of earnings transcripts
4. All content parsed, metrics extracted, narratives indexed with speaker attribution
5. Within minutes, workspace is fully loaded

An analyst asks: "What should worry me about this investment?"

FundLens cross-references:
- 10-K risk factors (China export controls, customer concentration)
- 13F data (hedge fund position reductions — "Bridgewater cut NVDA by 40%")
- Form 4 (insider selling — "CFO sold 80% of holdings 3 weeks before earnings")
- DEF 14A (compensation misalignment — "CEO pay up 35% while margins compressed")
- Earnings calls (tone shift from "explosive growth" to "disciplined execution")
- Financials (margin trajectory, capex ramp, FCF conversion)

That is what no terminal does today. Bloomberg has the data in separate tabs. FundLens connects the dots and asks the uncomfortable question.
