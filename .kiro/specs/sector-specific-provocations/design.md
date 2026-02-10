# Design Document: Sector-Specific Provocations Enhancement

## Overview

This design extends the existing Provocations Engine to generate sector-specific, industry-aware provocations tailored to each company's unique business model, competitive dynamics, and industry-specific risks. Currently, all companies receive the same 5 generic value investing provocations regardless of sector.

### Design Philosophy

1. **Leverage Existing Infrastructure**: Build on the current Provocations Engine without major architectural changes
2. **Configuration-Driven**: Sector templates stored as YAML/JSON configuration, not hardcoded
3. **Intelligent Selection**: Dynamic provocation selection based on sector + company context
4. **Peer-Aware**: Integrate peer comparison context where relevant
5. **Backward Compatible**: Generic provocations remain as fallback

### Key Architectural Decisions

- **GICS Classification**: Use industry-standard GICS (Global Industry Classification Standard) for sector mapping
- **Template Library**: YAML-based sector provocation templates for easy maintenance
- **Hybrid Approach**: Combine universal + sector-specific + company-specific provocations
- **Minimal Schema Changes**: Extend existing tables, don't rebuild
- **Reuse Existing Services**: Leverage current LLM integration, caching, and data pipeline

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│              Sector-Specific Provocations Layer                  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         Sector Classification Service (NEW)               │  │
│  │  • GICS Sector Mapper                                     │  │
│  │  • Multi-Segment Detector                                 │  │
│  │  • Sector Metadata Cache                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ▲                                   │
│                              │                                   │
│  ┌──────────────────────────┴───────────────────────────────┐  │
│  │      Sector Template Library (NEW - YAML Config)          │  │
│  │  • Technology Sector Templates                            │  │
│  │  • Financials Sector Templates                            │  │
│  │  • Healthcare Sector Templates                            │  │
│  │  • Consumer Sector Templates                              │  │
│  │  • Energy Sector Templates                                │  │
│  │  • ... (11 GICS sectors total)                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ▲                                   │
│                              │                                   │
│  ┌──────────────────────────┴───────────────────────────────┐  │
│  │    Enhanced Provocation Generator (MODIFIED)              │  │
│  │  • Sector-Aware Selection Logic                           │  │
│  │  • Peer Context Integration                               │  │
│  │  • Historical Overlay                                     │  │
│  │  • Materiality Scoring                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ▲                                   │
│                              │                                   │
│  ┌──────────────────────────┴───────────────────────────────┐  │
│  │         Peer Group Service (NEW)                          │  │
│  │  • Peer Company Detection                                 │  │
│  │  • Peer Metrics Aggregation                               │  │
│  │  • Outlier Detection                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Existing       │  │  Existing       │  │   Existing      │
│  Provocation    │  │  Temporal Diff  │  │   Bedrock LLM   │
│  Generator      │  │  Engine         │  │   Service       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Data Flow

```
1. Sector Classification Flow:
   Ticker → GICS Mapper → Sector Metadata → Cache

2. Template Selection Flow:
   Sector + Company Context → Template Library → Relevant Templates

3. Enhanced Provocation Generation Flow:
   Templates + Filing Data + Peer Context → LLM → Sector-Specific Provocations

4. Multi-Segment Flow:
   Ticker → Segment Detector → Multiple Sectors → Merged Template Set
```

## Components and Interfaces

### 1. Sector Classification Service

```typescript
interface SectorClassificationService {
  /**
   * Get GICS sector classification for a ticker
   */
  getSectorClassification(ticker: string): Promise<SectorClassification>;

  /**
   * Detect multi-segment companies
   */
  detectSegments(ticker: string): Promise<CompanySegment[]>;

  /**
   * Get sector metadata (keywords, metrics, risk factors)
   */
  getSectorMetadata(sectorCode: string): Promise<SectorMetadata>;
}

interface SectorClassification {
  ticker: string;
  primarySector: GICSSector;
  primaryIndustry: GICSIndustry;
  segments?: CompanySegment[];
  confidence: number;
  source: 'sec_filing' | 'market_data' | 'manual_override';
  lastUpdated: Date;
}

interface GICSSector {
  code: string; // e.g., "45" for Information Technology
  name: string; // e.g., "Information Technology"
  description: string;
}

interface GICSIndustry {
  code: string; // e.g., "4510" for Software & Services
  name: string;
  sectorCode: string;
}

interface CompanySegment {
  name: string;
  sector: GICSSector;
  revenueContribution: number; // percentage
  description: string;
}

interface SectorMetadata {
  sectorCode: string;
  keyMetrics: string[]; // e.g., ["R&D/Revenue", "Deferred Revenue", "Customer Concentration"]
  riskKeywords: string[]; // e.g., ["patent", "regulatory", "competition"]
  secSections: string[]; // e.g., ["Item 1A", "MD&A"]
  peerGroupCriteria: PeerGroupCriteria;
}

interface PeerGroupCriteria {
  sectorCode: string;
  industryCode?: string;
  marketCapRange?: { min: number; max: number };
  revenueRange?: { min: number; max: number };
}
```

### 2. Sector Template Library

**Template Structure (YAML)**:

```yaml
# config/sector-templates/technology.yaml
sector:
  code: "45"
  name: "Information Technology"
  
provocations:
  - id: "tech_rd_capitalization"
    title: "R&D Capitalization vs Expense Policy"
    severity: "RED_FLAG"
    category: "accounting_red_flags"
    description: "Compare R&D capitalization policy to peers and track changes"
    prompt_template: |
      Analyze {ticker}'s R&D accounting policy:
      1. What percentage of R&D is capitalized vs expensed?
      2. How does this compare to peers: {peer_avg_rd_cap}%?
      3. Has the capitalization policy changed in recent filings?
      4. What is the amortization period for capitalized R&D?
      
      Flag if:
      - Capitalization rate increased materially (>5pp)
      - Capitalization rate significantly above peer average (>10pp)
      - Amortization period extended
    required_data:
      - "10-K"
      - "financial_metrics"
    peer_comparison: true
    
  - id: "tech_deferred_revenue"
    title: "Deferred Revenue Quality & Growth"
    severity: "AMBER"
    category: "earnings_quality"
    description: "Track deferred revenue trends as leading indicator"
    prompt_template: |
      Analyze {ticker}'s deferred revenue:
      1. Deferred revenue growth rate vs revenue growth rate
      2. Deferred revenue as % of revenue (current vs historical)
      3. Changes in revenue recognition policy (ASC 606)
      4. Unbilled deferred revenue trends
      
      Flag if:
      - Deferred revenue growing slower than revenue (demand weakness)
      - Deferred revenue declining (renewal issues)
      - Material changes to revenue recognition timing
    required_data:
      - "10-K"
      - "10-Q"
      - "balance_sheet"
    peer_comparison: false

  - id: "tech_customer_concentration"
    title: "Customer Concentration Risk"
    severity: "AMBER"
    category: "risk_escalation"
    description: "Track top customer concentration and changes"
    prompt_template: |
      Analyze {ticker}'s customer concentration:
      1. Revenue from top 10 customers as % of total
      2. Changes in top customer list between filings
      3. Loss of major customers or contract renewals
      4. Geographic concentration risks
      
      Flag if:
      - Top 10 customers >40% of revenue
      - Major customer lost or not renewed
      - Increased concentration vs prior year
    required_data:
      - "10-K"
      - "Item 1"
    peer_comparison: true
    
  - id: "tech_tam_claims"
    title: "TAM Claims vs Actual Penetration"
    severity: "GREEN_CHALLENGE"
    category: "management_credibility"
    description: "Validate Total Addressable Market claims"
    prompt_template: |
      Analyze {ticker}'s TAM claims:
      1. Stated TAM in investor presentations vs filings
      2. Implied market share based on revenue / TAM
      3. TAM growth assumptions vs actual market growth
      4. Changes in TAM definition over time
      
      Challenge:
      - Is TAM realistically addressable or theoretical?
      - Has TAM been redefined to justify valuation?
      - What is actual penetration rate?
    required_data:
      - "10-K"
      - "MD&A"
    peer_comparison: false
    
  - id: "tech_cloud_transition"
    title: "Cloud Transition Metrics"
    severity: "AMBER"
    category: "competitive_moat"
    description: "Track cloud/SaaS transition progress"
    prompt_template: |
      Analyze {ticker}'s cloud transition:
      1. Cloud revenue as % of total (current vs historical)
      2. Cloud revenue growth rate vs legacy products
      3. Cloud gross margins vs legacy
      4. Customer migration rate to cloud
      
      Flag if:
      - Cloud growth decelerating
      - Cloud margins compressing
      - Legacy revenue declining faster than cloud growing
    required_data:
      - "10-K"
      - "10-Q"
      - "segment_data"
    peer_comparison: true

# Peer comparison metrics for this sector
peer_metrics:
  - "rd_expense_pct_revenue"
  - "deferred_revenue_pct_revenue"
  - "cloud_revenue_pct"
  - "gross_margin"
  - "customer_concentration_top10"
```

### 3. Enhanced Provocation Generator Service

```typescript
interface EnhancedProvocationGenerator extends ProvocationGeneratorService {
  /**
   * Generate sector-specific provocations
   */
  generateSectorSpecificProvocations(
    ticker: string,
    sectorClassification: SectorClassification,
    options?: ProvocationOptions
  ): Promise<ProvocationResult[]>;

  /**
   * Select relevant templates based on sector and company context
   */
  selectRelevantTemplates(
    sectorClassification: SectorClassification,
    companyContext: CompanyContext
  ): Promise<ProvocationTemplate[]>;

  /**
   * Enrich provocation with peer comparison data
   */
  enrichWithPeerContext(
    provocation: ProvocationResult,
    peerData: PeerComparisonData
  ): Promise<ProvocationResult>;
}

interface ProvocationTemplate {
  id: string;
  title: string;
  severity: SeverityLevel;
  category: ProvocationCategory;
  description: string;
  promptTemplate: string;
  requiredData: string[];
  peerComparison: boolean;
  sectorCode: string;
}

interface CompanyContext {
  ticker: string;
  marketCap?: number;
  revenue?: number;
  segments?: CompanySegment[];
  historicalIssues?: string[]; // e.g., ["restatement_2022", "sec_inquiry_2023"]
  filingHistory: FilingMetadata[];
}

interface ProvocationOptions {
  maxProvocations?: number; // default: 5-7
  includePeerComparison?: boolean; // default: true
  includeHistoricalContext?: boolean; // default: true
  severityFilter?: SeverityLevel[];
}

interface PeerComparisonData {
  peerGroup: PeerCompany[];
  metrics: Map<string, PeerMetricComparison>;
}

interface PeerCompany {
  ticker: string;
  name: string;
  sector: string;
  marketCap: number;
}

interface PeerMetricComparison {
  metricName: string;
  companyValue: number;
  peerAverage: number;
  peerMedian: number;
  percentile: number; // company's percentile rank
  outlier: boolean; // true if >2 std dev from mean
}
```

### 4. Peer Group Service

```typescript
interface PeerGroupService {
  /**
   * Get peer companies for a ticker
   */
  getPeerGroup(
    ticker: string,
    criteria: PeerGroupCriteria
  ): Promise<PeerCompany[]>;

  /**
   * Get peer metrics for comparison
   */
  getPeerMetrics(
    ticker: string,
    peerGroup: PeerCompany[],
    metricNames: string[]
  ): Promise<PeerComparisonData>;

  /**
   * Detect outliers vs peer group
   */
  detectOutliers(
    ticker: string,
    peerData: PeerComparisonData
  ): Promise<OutlierAnalysis[]>;
}

interface OutlierAnalysis {
  metricName: string;
  companyValue: number;
  peerAverage: number;
  standardDeviations: number;
  direction: 'above' | 'below';
  materiality: 'high' | 'medium' | 'low';
  implication: string;
}
```

## Sector Template Definitions

### Technology Sector (GICS 45)

**Key Provocations**:
1. 🔴 R&D Capitalization vs Expense Policy (RED_FLAG)
2. 🟠 Deferred Revenue Quality & Growth (AMBER)
3. 🟠 Customer Concentration Risk (AMBER)
4. 📊 TAM Claims vs Actual Penetration (GREEN_CHALLENGE)
5. 🟠 Cloud Transition Metrics (AMBER)

**Sector-Specific Metrics**:
- R&D as % of revenue
- Deferred revenue growth rate
- Customer concentration (top 10)
- Cloud revenue %
- Gross margin trends

### Financials Sector (GICS 40)

**Key Provocations**:
1. 🔴 Loan Loss Reserve Adequacy (RED_FLAG)
2. 🔴 Net Interest Margin Compression (RED_FLAG)
3. 🟠 Credit Quality Deterioration (AMBER)
4. 🟠 Regulatory Capital Ratios (AMBER)
5. 📊 Fee Income Diversification (GREEN_CHALLENGE)

**Sector-Specific Metrics**:
- Loan loss reserves / NPLs
- Net interest margin (NIM)
- Non-performing loan ratio
- Tier 1 capital ratio
- Fee income as % of total revenue

### Healthcare Sector (GICS 35)

**Key Provocations**:
1. 🔴 Pipeline Risk & Patent Cliffs (RED_FLAG)
2. 🔴 FDA Approval Delays or Rejections (RED_FLAG)
3. 🟠 Pricing Pressure & Rebate Trends (AMBER)
4. 🟠 Clinical Trial Success Rates (AMBER)
5. 📊 R&D Productivity (GREEN_CHALLENGE)

**Sector-Specific Metrics**:
- Pipeline value at risk (patents expiring)
- FDA approval success rate
- Average selling price trends
- R&D spend per approved drug
- Rebate % of gross revenue

### Consumer Discretionary/Staples (GICS 25/30)

**Key Provocations**:
1. 🟠 Same-Store Sales Trends (AMBER)
2. 🟠 Inventory Turnover & Obsolescence (AMBER)
3. 🟠 Brand Health & Market Share (AMBER)
4. 📊 Channel Mix Shifts (GREEN_CHALLENGE)
5. 📊 Private Label Pressure (GREEN_CHALLENGE)

**Sector-Specific Metrics**:
- Comparable store sales growth
- Inventory days outstanding
- Market share by category
- E-commerce % of sales
- Gross margin by channel

### Energy Sector (GICS 10)

**Key Provocations**:
1. 🔴 Reserve Replacement Ratio (RED_FLAG)
2. 🟠 Finding & Development Costs (AMBER)
3. 🟠 Hedging Position & Commodity Exposure (AMBER)
4. 🟠 ESG Transition Risks (AMBER)
5. 📊 Decline Curve Analysis (GREEN_CHALLENGE)

**Sector-Specific Metrics**:
- Reserve replacement ratio
- Finding & development cost per BOE
- % of production hedged
- Carbon intensity metrics
- Production decline rates

### Industrials Sector (GICS 20)

**Key Provocations**:
1. 🟠 Backlog Quality & Conversion (AMBER)
2. 🟠 Project Execution & Cost Overruns (AMBER)
3. 🟠 Supply Chain Disruptions (AMBER)
4. 📊 Pricing Power vs Input Costs (GREEN_CHALLENGE)
5. 📊 Capacity Utilization (GREEN_CHALLENGE)

**Sector-Specific Metrics**:
- Backlog / revenue ratio
- Project margin trends
- On-time delivery %
- Price realization vs input inflation
- Capacity utilization rate

### Materials Sector (GICS 15)

**Key Provocations**:
1. 🟠 Commodity Price Exposure (AMBER)
2. 🟠 Capacity Utilization Trends (AMBER)
3. 🟠 Input Cost Inflation (AMBER)
4. 📊 Cyclicality & Demand Indicators (GREEN_CHALLENGE)
5. 📊 Geographic Concentration (GREEN_CHALLENGE)

**Sector-Specific Metrics**:
- Realized price vs spot price
- Capacity utilization %
- Input cost inflation rate
- Order book trends
- Geographic revenue mix

### Real Estate Sector (GICS 60)

**Key Provocations**:
1. 🟠 Occupancy Rate Trends (AMBER)
2. 🟠 Lease Rollover & Renewal Rates (AMBER)
3. 🟠 Cap Rate Compression/Expansion (AMBER)
4. 📊 Development Pipeline Risk (GREEN_CHALLENGE)
5. 📊 Tenant Credit Quality (GREEN_CHALLENGE)

**Sector-Specific Metrics**:
- Occupancy rate
- Lease renewal rate
- Cap rates by property type
- Development as % of NOI
- Tenant concentration

### Utilities Sector (GICS 55)

**Key Provocations**:
1. 🟠 Regulatory ROE & Rate Cases (AMBER)
2. 🟠 CapEx Cycle & Rate Base Growth (AMBER)
3. 🟠 Renewable Transition Costs (AMBER)
4. 📊 Regulatory Lag (GREEN_CHALLENGE)
5. 📊 Weather Normalization (GREEN_CHALLENGE)

**Sector-Specific Metrics**:
- Allowed ROE
- Rate base growth rate
- Renewable % of generation
- Regulatory lag (months)
- Weather-adjusted usage

### Communication Services Sector (GICS 50)

**Key Provocations**:
1. 🟠 Subscriber Churn Rates (AMBER)
2. 🟠 ARPU Trends (AMBER)
3. 🟠 Content Costs & ROI (AMBER)
4. 📊 Network Investment vs Competition (GREEN_CHALLENGE)
5. 📊 Spectrum Efficiency (GREEN_CHALLENGE)

**Sector-Specific Metrics**:
- Monthly churn rate
- ARPU (average revenue per user)
- Content spend as % of revenue
- CapEx per subscriber
- Spectrum holdings

## Implementation Strategy

### Phase 1: Core Infrastructure (Week 1-2)

**1.1 Sector Classification Service**
- Implement GICS sector mapper
- Create sector metadata cache
- Build multi-segment detector
- Add database tables for sector data

**1.2 Template Library Setup**
- Define YAML schema for sector templates
- Create templates for 3 pilot sectors (Technology, Financials, Healthcare)
- Build template loader and validator
- Implement template caching

**1.3 Database Schema Extensions**

```sql
-- Sector classification table
CREATE TABLE sector_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(20) NOT NULL UNIQUE,
  primary_sector_code VARCHAR(10) NOT NULL,
  primary_sector_name VARCHAR(100) NOT NULL,
  primary_industry_code VARCHAR(10),
  primary_industry_name VARCHAR(100),
  segments JSONB, -- for multi-segment companies
  confidence DECIMAL(3,2),
  source VARCHAR(50),
  last_updated TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sector_class_ticker ON sector_classifications(ticker);
CREATE INDEX idx_sector_class_sector ON sector_classifications(primary_sector_code);

-- Peer groups table
CREATE TABLE peer_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(20) NOT NULL,
  peer_ticker VARCHAR(20) NOT NULL,
  sector_code VARCHAR(10) NOT NULL,
  market_cap BIGINT,
  revenue BIGINT,
  similarity_score DECIMAL(3,2),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(ticker, peer_ticker)
);

CREATE INDEX idx_peer_groups_ticker ON peer_groups(ticker);
CREATE INDEX idx_peer_groups_sector ON peer_groups(sector_code);

-- Peer metrics cache
CREATE TABLE peer_metrics_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(20) NOT NULL,
  metric_name VARCHAR(100) NOT NULL,
  company_value DECIMAL(20,4),
  peer_average DECIMAL(20,4),
  peer_median DECIMAL(20,4),
  percentile DECIMAL(5,2),
  is_outlier BOOLEAN DEFAULT FALSE,
  computed_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  UNIQUE(ticker, metric_name)
);

CREATE INDEX idx_peer_metrics_ticker ON peer_metrics_cache(ticker);
CREATE INDEX idx_peer_metrics_expires ON peer_metrics_cache(expires_at);
```

### Phase 2: Enhanced Provocation Generation (Week 3-4)

**2.1 Template Selection Logic**
- Implement sector-based template selection
- Add multi-segment template merging
- Build materiality scoring algorithm
- Implement provocation prioritization

**2.2 Peer Context Integration**
- Build peer group detection service
- Implement peer metrics aggregation
- Add outlier detection logic
- Integrate peer data into provocations

**2.3 LLM Prompt Enhancement**
- Update prompts to include sector context
- Add peer comparison data to prompts
- Implement template variable substitution
- Add sector-specific validation rules

### Phase 3: Remaining Sectors & Testing (Week 5-6)

**3.1 Complete Sector Coverage**
- Add templates for remaining 8 GICS sectors
- Validate templates with domain experts
- Test with representative tickers from each sector
- Refine prompts based on output quality

**3.2 Historical Context Overlay**
- Track recurring issues per ticker
- Build management credibility scoring
- Implement issue recurrence detection
- Add historical context to provocations

**3.3 Comprehensive Testing**
- Unit tests for all new services
- Integration tests for end-to-end flow
- Property-based tests for sector classification
- Performance testing with 100+ tickers

### Phase 4: Frontend Integration & Deployment (Week 7-8)

**4.1 API Endpoints**
- Add sector classification endpoint
- Update provocations endpoint to use sector logic
- Add peer comparison endpoint
- Implement sector metadata endpoint

**4.2 Frontend Updates**
- Display sector badge in workspace header
- Show peer comparison data in provocations
- Add sector filter to provocations tab
- Update scratchpad to include sector context

**4.3 Deployment & Monitoring**
- Deploy to staging environment
- Run smoke tests with production data
- Monitor performance and error rates
- Deploy to production with feature flag

## Data Models

### Sector Classification Models

```typescript
interface SectorClassification {
  id: string;
  ticker: string;
  primarySector: GICSSector;
  primaryIndustry: GICSIndustry;
  segments?: CompanySegment[];
  confidence: number;
  source: 'sec_filing' | 'market_data' | 'manual_override';
  lastUpdated: Date;
  createdAt: Date;
}

interface GICSSector {
  code: string; // "10" = Energy, "45" = Information Technology, etc.
  name: string;
  description: string;
}

interface GICSIndustry {
  code: string; // "4510" = Software & Services
  name: string;
  sectorCode: string;
}

interface CompanySegment {
  name: string;
  sector: GICSSector;
  revenueContribution: number; // percentage
  description: string;
}
```

### Template Models

```typescript
interface SectorTemplate {
  sectorCode: string;
  sectorName: string;
  provocations: ProvocationTemplate[];
  peerMetrics: string[];
  version: string;
  lastUpdated: Date;
}

interface ProvocationTemplate {
  id: string;
  title: string;
  severity: SeverityLevel;
  category: ProvocationCategory;
  description: string;
  promptTemplate: string;
  requiredData: string[];
  peerComparison: boolean;
  sectorCode: string;
  priority: number; // 1-10, higher = more important
}
```

### Peer Group Models

```typescript
interface PeerGroup {
  ticker: string;
  peers: PeerCompany[];
  criteria: PeerGroupCriteria;
  computedAt: Date;
  expiresAt: Date;
}

interface PeerCompany {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  marketCap: number;
  revenue: number;
  similarityScore: number; // 0-1
}

interface PeerMetricComparison {
  ticker: string;
  metricName: string;
  companyValue: number;
  peerAverage: number;
  peerMedian: number;
  peerMin: number;
  peerMax: number;
  percentile: number;
  standardDeviations: number;
  isOutlier: boolean;
  direction?: 'above' | 'below';
  computedAt: Date;
}
```

## API Endpoints

### New Endpoints

```typescript
// Get sector classification for a ticker
GET /api/sectors/:ticker
Response: SectorClassification

// Get peer group for a ticker
GET /api/peers/:ticker
Response: PeerGroup

// Get peer metrics comparison
GET /api/peers/:ticker/metrics?metrics=rd_pct,gross_margin
Response: PeerMetricComparison[]

// Get sector-specific provocations (replaces generic endpoint)
GET /api/provocations/:ticker/sector-specific
Response: ProvocationResult[]

// Get sector metadata
GET /api/sectors/:sectorCode/metadata
Response: SectorMetadata
```

### Modified Endpoints

```typescript
// Enhanced to use sector-specific logic
GET /api/provocations/:ticker/value-investing
Response: ProvocationResult[] // now includes sector-specific provocations
```

## Correctness Properties

### Sector Classification Properties

**Property 1: Sector Classification Accuracy**
*For any* ticker with available SEC filings, the sector classification service should correctly identify the primary GICS sector with >95% accuracy.
**Validates: Requirements US-1, FR-1, NFR-2**

**Property 2: Multi-Segment Detection**
*For any* company with multiple business segments representing >20% of revenue each, the system should detect and classify all major segments.
**Validates: Requirements US-3, FR-1**

**Property 3: Classification Persistence**
*For any* classified ticker, the sector classification should remain consistent across sessions unless explicitly updated or overridden.
**Validates: Requirements FR-1, NFR-3**

### Template Selection Properties

**Property 4: Sector-Specific Template Selection**
*For any* ticker with a known sector classification, the system should select provocations from that sector's template library, not generic templates.
**Validates: Requirements US-2, FR-2, FR-3**

**Property 5: Multi-Segment Template Merging**
*For any* multi-segment company, the system should generate provocations covering all segments with revenue contribution >20%, prioritized by segment size.
**Validates: Requirements US-3, FR-3**

**Property 6: Template Availability Fallback**
*For any* ticker where sector-specific templates are unavailable, the system should fall back to generic value investing provocations without error.
**Validates: Requirements US-1 (Acceptance Criteria 3), FR-3**

### Provocation Generation Properties

**Property 7: Sector-Specific Metric Usage**
*For any* generated provocation, if the template specifies sector-specific metrics (e.g., "R&D/Revenue" for tech), those metrics should be included in the analysis.
**Validates: Requirements US-2, FR-2**

**Property 8: Peer Comparison Integration**
*For any* provocation template with `peerComparison: true`, the generated provocation should include peer group context and outlier analysis.
**Validates: Requirements US-4, FR-4**

**Property 9: Provocation Count Constraint**
*For any* ticker, the system should generate between 5 and 7 total provocations, combining sector-specific and universal provocations.
**Validates: Requirements FR-3**

**Property 10: Materiality-Based Prioritization**
*For any* set of sector-specific provocations, RED_FLAG severity provocations should appear before AMBER, and AMBER before GREEN_CHALLENGE.
**Validates: Requirements FR-3**

### Peer Group Properties

**Property 11: Peer Group Relevance**
*For any* ticker, the peer group should consist of companies in the same GICS sector/industry with similar market cap (±50%) or revenue (±50%).
**Validates: Requirements US-4, FR-4, NFR-2**

**Property 12: Peer Metric Accuracy**
*For any* peer metric comparison, the peer average and median should be calculated from at least 3 peer companies with recent financial data (<12 months old).
**Validates: Requirements FR-4, NFR-2**

**Property 13: Outlier Detection Consistency**
*For any* metric value >2 standard deviations from peer average, the system should flag it as an outlier and include this in the provocation.
**Validates: Requirements US-4, FR-4**

### Historical Context Properties

**Property 14: Issue Recurrence Tracking**
*For any* ticker with historical provocations, if a similar issue appears in multiple filings, the system should flag it as a recurring issue.
**Validates: Requirements US-5, FR-5**

**Property 15: Management Credibility Scoring**
*For any* ticker with at least 4 quarters of forward-looking statements and subsequent results, the system should calculate a credibility score based on accuracy.
**Validates: Requirements US-5, FR-5**

### Performance Properties

**Property 16: Sector Classification Performance**
*For any* ticker, sector classification should complete in <100ms.
**Validates: Requirements NFR-1**

**Property 17: Provocation Generation Performance**
*For any* ticker with cached sector classification and peer data, sector-specific provocation generation should complete in <3 seconds.
**Validates: Requirements NFR-1**

**Property 18: Cache Effectiveness**
*For any* ticker accessed >3 times in 24 hours, cached sector-specific provocations should improve response time by >50% vs uncached.
**Validates: Requirements NFR-1**

### Data Quality Properties

**Property 19: Template Validation**
*For any* sector template loaded from YAML, all required fields (id, title, severity, category, promptTemplate) should be present and valid.
**Validates: Requirements FR-2, NFR-3**

**Property 20: Peer Data Freshness**
*For any* peer metric comparison, the underlying financial data should be <12 months old, or the comparison should be flagged as stale.
**Validates: Requirements FR-4, NFR-2**

## Testing Strategy

### Unit Tests

```typescript
describe('SectorClassificationService', () => {
  it('should classify AAPL as Information Technology sector', async () => {
    const classification = await service.getSectorClassification('AAPL');
    expect(classification.primarySector.code).toBe('45');
    expect(classification.primarySector.name).toBe('Information Technology');
  });

  it('should detect AMZN as multi-segment (Retail + Cloud)', async () => {
    const classification = await service.getSectorClassification('AMZN');
    expect(classification.segments).toBeDefined();
    expect(classification.segments.length).toBeGreaterThan(1);
  });

  it('should fall back to generic if sector unknown', async () => {
    const classification = await service.getSectorClassification('UNKNOWN');
    expect(classification.primarySector.code).toBe('00'); // generic
  });
});

describe('SectorTemplateLibrary', () => {
  it('should load technology sector templates', async () => {
    const templates = await library.getTemplates('45');
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0].sectorCode).toBe('45');
  });

  it('should validate template structure', async () => {
    const template = await library.getTemplate('45', 'tech_rd_capitalization');
    expect(template.id).toBe('tech_rd_capitalization');
    expect(template.promptTemplate).toContain('{ticker}');
  });
});

describe('EnhancedProvocationGenerator', () => {
  it('should generate tech-specific provocations for MSFT', async () => {
    const provocations = await generator.generateSectorSpecificProvocations('MSFT');
    expect(provocations.length).toBeGreaterThan(0);
    expect(provocations.some(p => p.title.includes('R&D'))).toBe(true);
  });

  it('should include peer comparison for tech companies', async () => {
    const provocations = await generator.generateSectorSpecificProvocations('AAPL');
    const rdProvocation = provocations.find(p => p.category === 'accounting_red_flags');
    expect(rdProvocation?.observation).toContain('peer');
  });

  it('should merge templates for multi-segment companies', async () => {
    const provocations = await generator.generateSectorSpecificProvocations('AMZN');
    // Should have both retail and tech provocations
    expect(provocations.some(p => p.title.includes('Inventory'))).toBe(true);
    expect(provocations.some(p => p.title.includes('Cloud'))).toBe(true);
  });
});

describe('PeerGroupService', () => {
  it('should find peers for AAPL in tech sector', async () => {
    const peers = await service.getPeerGroup('AAPL', { sectorCode: '45' });
    expect(peers.length).toBeGreaterThan(3);
    expect(peers.every(p => p.sector === 'Information Technology')).toBe(true);
  });

  it('should calculate peer metrics correctly', async () => {
    const metrics = await service.getPeerMetrics('AAPL', peers, ['rd_pct']);
    expect(metrics.metrics.get('rd_pct')).toBeDefined();
    expect(metrics.metrics.get('rd_pct')?.peerAverage).toBeGreaterThan(0);
  });

  it('should detect outliers', async () => {
    const outliers = await service.detectOutliers('NVDA', peerData);
    expect(outliers.length).toBeGreaterThan(0);
    expect(outliers[0].standardDeviations).toBeGreaterThan(2);
  });
});
```

### Property-Based Tests

```typescript
// Feature: sector-specific-provocations, Property 1: Sector Classification Accuracy
describe('Property: Sector Classification Accuracy', () => {
  it('should correctly classify any ticker with SEC filings', () => {
    fc.assert(
      fc.asyncProperty(
        fc.constantFrom('AAPL', 'MSFT', 'JPM', 'JNJ', 'XOM', 'BA', 'WMT', 'AMT', 'NEE', 'DIS'),
        async (ticker) => {
          const classification = await service.getSectorClassification(ticker);
          
          expect(classification.primarySector.code).toMatch(/^[0-9]{2}$/);
          expect(classification.primarySector.name).toBeTruthy();
          expect(classification.confidence).toBeGreaterThan(0.95);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: sector-specific-provocations, Property 4: Sector-Specific Template Selection
describe('Property: Sector-Specific Template Selection', () => {
  it('should select sector templates for any classified ticker', () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          ticker: fc.string({ minLength: 1, maxLength: 5 }),
          sectorCode: fc.constantFrom('10', '15', '20', '25', '30', '35', '40', '45', '50', '55', '60')
        }),
        async ({ ticker, sectorCode }) => {
          const classification = { ticker, primarySector: { code: sectorCode } };
          const templates = await generator.selectRelevantTemplates(classification, {});
          
          expect(templates.length).toBeGreaterThan(0);
          expect(templates.every(t => t.sectorCode === sectorCode)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: sector-specific-provocations, Property 9: Provocation Count Constraint
describe('Property: Provocation Count Constraint', () => {
  it('should generate 5-7 provocations for any ticker', () => {
    fc.assert(
      fc.asyncProperty(
        fc.constantFrom('AAPL', 'MSFT', 'JPM', 'JNJ', 'XOM', 'BA', 'WMT', 'AMT', 'NEE', 'DIS'),
        async (ticker) => {
          const provocations = await generator.generateSectorSpecificProvocations(ticker);
          
          expect(provocations.length).toBeGreaterThanOrEqual(5);
          expect(provocations.length).toBeLessThanOrEqual(7);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Integration Tests

```typescript
describe('End-to-End Sector-Specific Provocations', () => {
  it('should generate tech provocations for AAPL', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/provocations/AAPL/sector-specific')
      .expect(200);
    
    expect(result.body.length).toBeGreaterThan(0);
    expect(result.body[0].title).toBeTruthy();
    expect(result.body[0].severity).toMatch(/RED_FLAG|AMBER|GREEN_CHALLENGE/);
  });

  it('should include peer comparison for tech companies', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/provocations/MSFT/sector-specific')
      .expect(200);
    
    const rdProvocation = result.body.find(p => p.title.includes('R&D'));
    expect(rdProvocation.observation).toContain('peer');
  });

  it('should handle multi-segment companies', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/provocations/AMZN/sector-specific')
      .expect(200);
    
    // Should have provocations from multiple sectors
    expect(result.body.length).toBeGreaterThan(5);
  });
});
```

## Error Handling

### Sector Classification Errors

```typescript
class SectorClassificationError extends Error {
  constructor(
    public ticker: string,
    public reason: string
  ) {
    super(`Failed to classify sector for ${ticker}: ${reason}`);
  }
}

// Handling Strategy:
// - Fall back to generic provocations
// - Log error for manual review
// - Return partial results with warning
// - Cache failure to avoid repeated attempts
```

### Template Loading Errors

```typescript
class TemplateLoadError extends Error {
  constructor(
    public sectorCode: string,
    public reason: string
  ) {
    super(`Failed to load templates for sector ${sectorCode}: ${reason}`);
  }
}

// Handling Strategy:
// - Fall back to generic templates
// - Log error for immediate investigation
// - Alert if multiple sectors fail
// - Validate templates on startup
```

### Peer Data Errors

```typescript
class PeerDataError extends Error {
  constructor(
    public ticker: string,
    public operation: string,
    public reason: string
  ) {
    super(`Peer data operation ${operation} failed for ${ticker}: ${reason}`);
  }
}

// Handling Strategy:
// - Continue without peer comparison
// - Mark provocations as "peer data unavailable"
// - Log error for monitoring
// - Retry with exponential backoff
```

## Deployment Strategy

### Phase 1: Pilot Sectors (Week 1-2)
- Deploy Technology, Financials, Healthcare sectors
- Test with 10 representative tickers per sector
- Monitor performance and error rates
- Gather user feedback

### Phase 2: Remaining Sectors (Week 3-4)
- Deploy remaining 8 GICS sectors
- Expand testing to 50+ tickers
- Validate peer comparison accuracy
- Refine templates based on feedback

### Phase 3: Production Rollout (Week 5-6)
- Enable for all users with feature flag
- Monitor cache hit rates and performance
- Track user engagement metrics
- Iterate on template quality

### Phase 4: Optimization (Week 7-8)
- Optimize database queries
- Improve cache strategies
- Add historical context overlay
- Enhance peer group detection

## Success Metrics

### Relevance Metrics
- 80%+ of provocations rated "relevant" by users
- <10% generic fallback usage
- 90%+ sector classification accuracy

### Adoption Metrics
- 50%+ increase in provocations tab usage
- 30%+ increase in scratchpad saves from provocations
- Positive user feedback scores (>4/5)

### Performance Metrics
- <3 second provocation generation time
- 95%+ cache hit rate for repeat requests
- Zero timeout errors
- <100ms sector classification time

### Quality Metrics
- Peer comparison accuracy >90%
- Template coverage for all 11 GICS sectors
- <5% error rate in provocation generation

## Future Enhancements

### Phase 5: Advanced Features (Post-MVP)
- Custom sector definitions by user
- Machine learning for sector classification
- Real-time peer comparison updates
- Integration with external data providers (FactSet, Bloomberg)
- Multi-language support for international filings
- Sector rotation signals
- Macro overlay (interest rates, commodity prices)
- Industry sub-sector templates (e.g., SaaS vs Hardware within Tech)

### Phase 6: Intelligence Layer
- Automated template optimization based on user feedback
- Predictive provocations (flag issues before they appear in filings)
- Cross-sector pattern detection
- Management credibility scoring across portfolio
- Provocation impact tracking (did it predict a stock move?)
