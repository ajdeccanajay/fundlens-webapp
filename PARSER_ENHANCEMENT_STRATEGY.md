# Parser Enhancement Strategy: Quantitative, Qualitative & HITL
**Date:** January 29, 2026  
**Focus:** 3 Strategic Improvements + Human-in-the-Loop Implementation

---

## Part 1: Three Strategic Parser Improvements

### 1. Semantic Footnote Linking & Context Extraction

**Problem:** You extract footnotes as narrative chunks but don't link them to specific metrics or extract structured context.

**Current State:**
```python
# You extract narratives but miss the semantic links
narratives.append({
    'section_key': 'item_8',
    'content': chunk,
    # ❌ Missing: which metrics does this footnote explain?
})
```

**Strategic Enhancement:**

#### A. Footnote Reference Graph
```python
@dataclass
class FootnoteReference:
    """Links metrics to their explanatory footnotes"""
    metric_id: str
    footnote_number: str
    footnote_section: str  # e.g., "Note 3: Revenue Recognition"
    footnote_text: str
    context_type: str  # 'accounting_policy', 'segment_breakdown', 'reconciliation'
    extracted_data: Optional[Dict[str, Any]] = None  # Structured data from footnote
```

#### B. Implementation Approach
```python
class FootnoteLinkingService:
    def link_footnotes_to_metrics(
        self, 
        metrics: List[ExtractedMetric],
        html_content: str
    ) -> List[FootnoteReference]:
        """
        1. Parse footnote section (usually after financial statements)
        2. Extract footnote numbers from metric labels (e.g., "Revenue (1)")
        3. Match footnote numbers to footnote text
        4. Extract structured data from footnotes (tables, lists)
        5. Classify footnote type (policy, segment, reconciliation)
        """
        
        # Find footnote references in metric labels
        for metric in metrics:
            refs = self._extract_footnote_refs(metric.raw_label)
            for ref_num in refs:
                footnote = self._find_footnote_by_number(html_content, ref_num)
                if footnote:
                    # Extract structured data if footnote contains tables
                    structured_data = self._extract_footnote_tables(footnote)
                    
                    yield FootnoteReference(
                        metric_id=metric.id,
                        footnote_number=ref_num,
                        footnote_section=footnote.section_title,
                        footnote_text=footnote.text,
                        context_type=self._classify_footnote(footnote),
                        extracted_data=structured_data
                    )
```

#### C. Use Cases
- **Segment Revenue:** "Revenue (1)" → Footnote 1 has table with geographic breakdown
- **Accounting Changes:** "Net Income (2)" → Footnote 2 explains restatement
- **Fair Value:** "Investments (3)" → Footnote 3 has Level 1/2/3 breakdown

**Impact:** +5-8% qualitative data extraction, enables segment analysis

**Effort:** 2-3 weeks

---


### 2. MD&A Narrative Intelligence Layer

**Problem:** You extract MD&A text as chunks but don't extract structured insights (trends, risks, forward guidance).

**Current State:**
```python
# You extract text but miss the semantic meaning
narratives.append({
    'section_key': 'item_7',  # MD&A
    'content': 'Revenue increased 15% due to strong iPhone sales...',
    # ❌ Missing: trend direction, magnitude, drivers, sentiment
})
```

**Strategic Enhancement:**

#### A. Structured MD&A Extraction
```python
@dataclass
class MDAnalysis:
    """Structured insights from MD&A section"""
    metric_name: str
    period: str
    
    # Quantitative insights
    change_amount: Optional[float] = None
    change_percent: Optional[float] = None
    trend_direction: str = 'neutral'  # 'increasing', 'decreasing', 'stable'
    
    # Qualitative insights
    drivers: List[str] = field(default_factory=list)  # ["strong iPhone sales", "new markets"]
    risks: List[str] = field(default_factory=list)
    management_commentary: str = ""
    sentiment: str = 'neutral'  # 'positive', 'negative', 'neutral'
    
    # Forward-looking
    guidance: Optional[str] = None
    outlook: str = 'neutral'
```

#### B. Implementation with LLM
```python
class MDAIntelligenceService:
    def extract_mda_insights(
        self, 
        mda_text: str,
        metrics: List[ExtractedMetric]
    ) -> List[MDAnalysis]:
        """
        Use Claude/GPT-4 to extract structured insights from MD&A
        """
        
        prompt = f"""
        Extract structured insights from this MD&A section:
        
        {mda_text}
        
        For each financial metric mentioned, extract:
        1. Change amount and percentage
        2. Trend direction (increasing/decreasing/stable)
        3. Key drivers (list of reasons for change)
        4. Risks mentioned
        5. Management sentiment (positive/negative/neutral)
        6. Forward guidance if mentioned
        
        Return as JSON array.
        """
        
        response = self.llm.complete(prompt, response_format='json')
        return [MDAnalysis(**item) for item in response]
```

#### C. Pattern-Based Fallback (No LLM)
```python
class MDAPatternExtractor:
    """Deterministic extraction for common patterns"""
    
    TREND_PATTERNS = [
        r'(\w+)\s+(?:increased|rose|grew)\s+(?:by\s+)?(\d+)%',
        r'(\w+)\s+(?:decreased|declined|fell)\s+(?:by\s+)?(\d+)%',
        r'(\w+)\s+was\s+\$?([\d,\.]+)\s+(?:million|billion)',
    ]
    
    DRIVER_PATTERNS = [
        r'(?:due to|driven by|primarily from|as a result of)\s+([^\.]+)',
        r'(?:reflecting|attributable to)\s+([^\.]+)',
    ]
    
    def extract_trends(self, text: str) -> List[MDAnalysis]:
        """Extract trends using regex patterns"""
        analyses = []
        
        for pattern in self.TREND_PATTERNS:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for match in matches:
                metric_name = match.group(1)
                change_pct = float(match.group(2)) if len(match.groups()) > 1 else None
                
                # Find drivers in surrounding text
                context = text[max(0, match.start()-200):match.end()+200]
                drivers = self._extract_drivers(context)
                
                analyses.append(MDAnalysis(
                    metric_name=metric_name,
                    change_percent=change_pct,
                    trend_direction='increasing' if 'increased' in match.group(0) else 'decreasing',
                    drivers=drivers
                ))
        
        return analyses
```

#### D. Use Cases
- **Trend Analysis:** "Revenue increased 15% due to strong iPhone sales" → structured trend
- **Risk Identification:** Extract all risks mentioned in MD&A
- **Guidance Extraction:** "We expect revenue growth of 10-12% next year"
- **Sentiment Analysis:** Positive/negative tone per metric

**Impact:** +10-15% qualitative insights, enables narrative analysis

**Effort:** 2-3 weeks (pattern-based) or 1 week (LLM-based)

**Cost:** $0 (pattern-based) or $0.01-0.05 per filing (LLM-based)

---

### 3. Hierarchical Metric Relationship Graph

**Problem:** You extract parent_metric but don't build a full relationship graph for drill-down analysis.

**Current State:**
```python
@dataclass
class ExtractedMetric:
    parent_metric: Optional[str] = None  # Single parent
    indent_level: int = 0
    # ❌ Missing: children, siblings, calculation formula
```

**Strategic Enhancement:**

#### A. Metric Relationship Graph
```python
@dataclass
class MetricNode:
    """Node in the metric hierarchy graph"""
    metric_id: str
    normalized_name: str
    value: float
    
    # Hierarchy
    parent_id: Optional[str] = None
    children_ids: List[str] = field(default_factory=list)
    sibling_ids: List[str] = field(default_factory=list)
    level: int = 0  # 0=top-level, 1=child, 2=grandchild
    
    # Relationships
    calculation_formula: Optional[str] = None  # "revenue - cost_of_revenue"
    rollup_type: str = 'sum'  # 'sum', 'difference', 'product', 'ratio'
    
    # Validation
    calculated_value: Optional[float] = None  # From formula
    variance: Optional[float] = None  # Actual vs calculated
    
    # Metadata
    statement_type: str
    display_order: int = 0

class MetricHierarchyGraph:
    """Build and query metric relationship graph"""
    
    def __init__(self):
        self.nodes: Dict[str, MetricNode] = {}
        self.edges: List[Tuple[str, str, str]] = []  # (parent, child, relationship_type)
    
    def build_from_metrics(self, metrics: List[ExtractedMetric]):
        """Build graph from flat metric list"""
        
        # Create nodes
        for metric in metrics:
            node = MetricNode(
                metric_id=metric.id,
                normalized_name=metric.normalized_metric,
                value=metric.value,
                parent_id=metric.parent_metric,
                level=metric.indent_level,
                statement_type=metric.statement_type
            )
            self.nodes[metric.id] = node
        
        # Build edges and infer relationships
        for node_id, node in self.nodes.items():
            if node.parent_id:
                parent = self.nodes.get(node.parent_id)
                if parent:
                    parent.children_ids.append(node_id)
                    
                    # Infer calculation formula
                    formula = self._infer_formula(parent, node)
                    if formula:
                        node.calculation_formula = formula
        
        # Find siblings
        for node in self.nodes.values():
            if node.parent_id:
                parent = self.nodes[node.parent_id]
                node.sibling_ids = [
                    child_id for child_id in parent.children_ids 
                    if child_id != node.metric_id
                ]
    
    def _infer_formula(self, parent: MetricNode, child: MetricNode) -> Optional[str]:
        """Infer calculation formula based on metric names"""
        
        # Common patterns
        if parent.normalized_name == 'gross_profit':
            if child.normalized_name == 'revenue':
                return 'revenue - cost_of_revenue'
        
        if parent.normalized_name == 'operating_income':
            if child.normalized_name == 'gross_profit':
                return 'gross_profit - operating_expenses'
        
        # Generic: parent = sum of children
        return f"sum({', '.join(parent.children_ids)})"
    
    def get_drill_down_path(self, metric_id: str) -> List[MetricNode]:
        """Get full drill-down path from top-level to this metric"""
        path = []
        current = self.nodes.get(metric_id)
        
        while current:
            path.insert(0, current)
            current = self.nodes.get(current.parent_id) if current.parent_id else None
        
        return path
    
    def get_subtree(self, metric_id: str) -> List[MetricNode]:
        """Get all descendants of a metric"""
        node = self.nodes.get(metric_id)
        if not node:
            return []
        
        subtree = [node]
        for child_id in node.children_ids:
            subtree.extend(self.get_subtree(child_id))
        
        return subtree
    
    def validate_rollups(self) -> List[Dict]:
        """Validate that parent = sum of children"""
        validation_errors = []
        
        for node in self.nodes.values():
            if node.children_ids:
                children_sum = sum(
                    self.nodes[child_id].value 
                    for child_id in node.children_ids
                )
                
                variance = abs(node.value - children_sum)
                variance_pct = (variance / abs(node.value) * 100) if node.value != 0 else 0
                
                if variance_pct > 1.0:  # 1% tolerance
                    validation_errors.append({
                        'metric': node.normalized_name,
                        'expected': children_sum,
                        'actual': node.value,
                        'variance_pct': variance_pct
                    })
        
        return validation_errors
```

#### B. Use Cases
- **Drill-Down Analysis:** Click "Revenue" → see Product Revenue, Service Revenue, etc.
- **Variance Analysis:** Validate parent = sum of children
- **Formula Discovery:** Automatically infer calculation formulas
- **Waterfall Charts:** Show how components build up to total
- **Segment Analysis:** Navigate through geographic/product segments

**Impact:** +20-30% analyst productivity, enables interactive exploration

**Effort:** 2 weeks

---

## Part 2: Human-in-the-Loop (HITL) for Metric Corrections

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Deal Workspace UI                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Financial Statements Table                          │  │
│  │  ┌────────────┬──────────┬──────────┬──────────┐   │  │
│  │  │ Metric     │ 2024     │ 2023     │ Actions  │   │  │
│  │  ├────────────┼──────────┼──────────┼──────────┤   │  │
│  │  │ Revenue    │ $100M ✓  │ $90M ✓   │ [Edit]   │   │  │
│  │  │ COGS       │ $60M ⚠️  │ $50M ✓   │ [Edit]   │   │  │
│  │  │ Gross Profit│ $40M ✓  │ $40M ✓   │ [Edit]   │   │  │
│  │  └────────────┴──────────┴──────────┴──────────┘   │  │
│  │                                                       │  │
│  │  ✓ = Validated  ⚠️ = Low confidence  ❌ = Failed    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Database Schema

```sql
-- Store analyst corrections
CREATE TABLE metric_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id),
    tenant_id UUID NOT NULL,
    
    -- Original extracted metric
    original_metric_id UUID REFERENCES financial_metrics(id),
    normalized_metric VARCHAR(255) NOT NULL,
    fiscal_period VARCHAR(50) NOT NULL,
    
    -- Original vs corrected values
    original_value DECIMAL(20, 2),
    corrected_value DECIMAL(20, 2) NOT NULL,
    original_source VARCHAR(50),  -- 'ixbrl', 'html_table', 'derived'
    
    -- Correction metadata
    correction_reason TEXT,
    correction_type VARCHAR(50),  -- 'value_error', 'wrong_metric', 'missing_data', 'manual_entry'
    confidence_before DECIMAL(5, 2),
    
    -- Audit trail
    corrected_by UUID NOT NULL REFERENCES users(id),
    corrected_at TIMESTAMP NOT NULL DEFAULT NOW(),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP,
    
    -- Source documentation
    source_document_url TEXT,  -- Link to SEC filing page
    source_page_number INT,
    source_screenshot_url TEXT,  -- S3 URL to screenshot
    
    -- Approval workflow
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
    approval_notes TEXT,
    
    UNIQUE(deal_id, normalized_metric, fiscal_period)
);

-- Track correction patterns for parser improvement
CREATE TABLE correction_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Pattern identification
    ticker VARCHAR(10),
    filing_type VARCHAR(10),
    normalized_metric VARCHAR(255),
    correction_type VARCHAR(50),
    
    -- Frequency
    occurrence_count INT DEFAULT 1,
    first_seen TIMESTAMP DEFAULT NOW(),
    last_seen TIMESTAMP DEFAULT NOW(),
    
    -- Pattern details
    common_reason TEXT,
    suggested_fix TEXT,  -- Recommendation for parser improvement
    
    -- Status
    parser_fix_applied BOOLEAN DEFAULT FALSE,
    fix_applied_at TIMESTAMP,
    
    UNIQUE(ticker, normalized_metric, correction_type)
);

-- Audit log for all metric changes
CREATE TABLE metric_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL,
    metric_id UUID,
    
    action VARCHAR(50) NOT NULL,  -- 'extracted', 'corrected', 'approved', 'rejected'
    old_value DECIMAL(20, 2),
    new_value DECIMAL(20, 2),
    
    changed_by UUID NOT NULL REFERENCES users(id),
    changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    reason TEXT,
    metadata JSONB
);
```

---


### Backend Implementation

#### A. Correction Service
```typescript
// src/deals/metric-correction.service.ts

@Injectable()
export class MetricCorrectionService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationService: NotificationService
  ) {}

  async correctMetric(
    dealId: string,
    userId: string,
    correction: CreateCorrectionDto
  ): Promise<MetricCorrection> {
    // 1. Validate user has permission
    await this.validatePermission(dealId, userId);
    
    // 2. Get original metric
    const originalMetric = await this.prisma.financialMetric.findFirst({
      where: {
        dealId,
        normalizedMetric: correction.normalizedMetric,
        fiscalPeriod: correction.fiscalPeriod
      }
    });
    
    // 3. Create correction record
    const correctionRecord = await this.prisma.metricCorrection.create({
      data: {
        dealId,
        tenantId: correction.tenantId,
        originalMetricId: originalMetric?.id,
        normalizedMetric: correction.normalizedMetric,
        fiscalPeriod: correction.fiscalPeriod,
        originalValue: originalMetric?.value,
        correctedValue: correction.correctedValue,
        originalSource: originalMetric?.source,
        correctionReason: correction.reason,
        correctionType: correction.type,
        confidenceBefore: originalMetric?.confidenceScore,
        correctedBy: userId,
        sourceDocumentUrl: correction.sourceUrl,
        sourcePageNumber: correction.pageNumber,
        status: 'pending'
      }
    });
    
    // 4. Update audit log
    await this.auditService.logMetricChange({
      dealId,
      metricId: originalMetric?.id,
      action: 'corrected',
      oldValue: originalMetric?.value,
      newValue: correction.correctedValue,
      changedBy: userId,
      reason: correction.reason
    });
    
    // 5. Track correction pattern
    await this.trackCorrectionPattern(correctionRecord);
    
    // 6. Notify reviewers if needed
    if (correction.requiresReview) {
      await this.notificationService.notifyReviewers(dealId, correctionRecord);
    }
    
    return correctionRecord;
  }

  async approvCorrection(
    correctionId: string,
    reviewerId: string,
    notes?: string
  ): Promise<void> {
    // 1. Update correction status
    await this.prisma.metricCorrection.update({
      where: { id: correctionId },
      data: {
        status: 'approved',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        approvalNotes: notes
      }
    });
    
    // 2. Apply correction to deal's financial data
    const correction = await this.prisma.metricCorrection.findUnique({
      where: { id: correctionId }
    });
    
    await this.applyCorrection(correction);
    
    // 3. Recalculate derived metrics
    await this.recalculateDerivedMetrics(correction.dealId, correction.fiscalPeriod);
    
    // 4. Update validation status
    await this.revalidateFinancials(correction.dealId);
  }

  private async trackCorrectionPattern(
    correction: MetricCorrection
  ): Promise<void> {
    // Track patterns for parser improvement
    const deal = await this.prisma.deal.findUnique({
      where: { id: correction.dealId },
      select: { ticker: true, filingType: true }
    });
    
    await this.prisma.correctionPattern.upsert({
      where: {
        ticker_normalizedMetric_correctionType: {
          ticker: deal.ticker,
          normalizedMetric: correction.normalizedMetric,
          correctionType: correction.correctionType
        }
      },
      update: {
        occurrenceCount: { increment: 1 },
        lastSeen: new Date(),
        commonReason: correction.correctionReason
      },
      create: {
        ticker: deal.ticker,
        filingType: deal.filingType,
        normalizedMetric: correction.normalizedMetric,
        correctionType: correction.correctionType,
        occurrenceCount: 1,
        commonReason: correction.correctionReason
      }
    });
  }

  async getCorrectionPatterns(
    minOccurrences: number = 3
  ): Promise<CorrectionPattern[]> {
    // Get patterns that occur frequently (parser bugs)
    return this.prisma.correctionPattern.findMany({
      where: {
        occurrenceCount: { gte: minOccurrences },
        parserFixApplied: false
      },
      orderBy: { occurrenceCount: 'desc' }
    });
  }

  async generateParserImprovementReport(): Promise<ParserImprovementReport> {
    // Generate report for engineering team
    const patterns = await this.getCorrectionPatterns(3);
    
    const report = {
      totalCorrections: await this.prisma.metricCorrection.count(),
      uniquePatterns: patterns.length,
      topIssues: patterns.slice(0, 10).map(p => ({
        ticker: p.ticker,
        metric: p.normalizedMetric,
        occurrences: p.occurrenceCount,
        reason: p.commonReason,
        suggestedFix: this.generateSuggestedFix(p)
      })),
      byTicker: await this.groupPatternsByTicker(patterns),
      byMetric: await this.groupPatternsByMetric(patterns)
    };
    
    return report;
  }

  private generateSuggestedFix(pattern: CorrectionPattern): string {
    // AI-generated suggestions for parser improvements
    if (pattern.correctionType === 'value_error') {
      return `Check XBRL tag mapping for ${pattern.normalizedMetric} in ${pattern.ticker} filings`;
    }
    if (pattern.correctionType === 'wrong_metric') {
      return `Review metric classification logic for ${pattern.normalizedMetric}`;
    }
    if (pattern.correctionType === 'missing_data') {
      return `Add extraction pattern for ${pattern.normalizedMetric} in ${pattern.ticker} filings`;
    }
    return 'Manual review required';
  }
}
```

#### B. Controller Endpoints
```typescript
// src/deals/metric-correction.controller.ts

@Controller('deals/:dealId/metrics/corrections')
@UseGuards(JwtAuthGuard, TenantGuard)
export class MetricCorrectionController {
  constructor(private correctionService: MetricCorrectionService) {}

  @Post()
  async createCorrection(
    @Param('dealId') dealId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateCorrectionDto
  ) {
    return this.correctionService.correctMetric(dealId, user.id, dto);
  }

  @Get()
  async getCorrections(@Param('dealId') dealId: string) {
    return this.correctionService.getCorrections(dealId);
  }

  @Patch(':correctionId/approve')
  @RequireRole('analyst', 'admin')
  async approveCorrection(
    @Param('correctionId') correctionId: string,
    @CurrentUser() user: User,
    @Body() dto: ApproveCorrectDto
  ) {
    return this.correctionService.approveCorrection(
      correctionId,
      user.id,
      dto.notes
    );
  }

  @Patch(':correctionId/reject')
  @RequireRole('analyst', 'admin')
  async rejectCorrection(
    @Param('correctionId') correctionId: string,
    @CurrentUser() user: User,
    @Body() dto: RejectCorrectionDto
  ) {
    return this.correctionService.rejectCorrection(
      correctionId,
      user.id,
      dto.reason
    );
  }

  @Get('patterns')
  @RequireRole('admin')
  async getCorrectionPatterns() {
    return this.correctionService.getCorrectionPatterns();
  }

  @Get('improvement-report')
  @RequireRole('admin')
  async getImprovementReport() {
    return this.correctionService.generateParserImprovementReport();
  }
}
```

---

### Frontend Implementation

#### A. Inline Editing Component
```typescript
// public/app/deals/components/metric-editor.ts

class MetricEditor {
  private originalValue: number;
  private confidence: number;
  
  constructor(
    private metricName: string,
    private fiscalPeriod: string,
    private value: number,
    private confidence: number
  ) {
    this.originalValue = value;
  }

  render(): string {
    const confidenceClass = this.getConfidenceClass();
    const confidenceIcon = this.getConfidenceIcon();
    
    return `
      <div class="metric-row" data-metric="${this.metricName}">
        <div class="metric-name">${this.humanizeName(this.metricName)}</div>
        <div class="metric-value ${confidenceClass}">
          <span class="value-display" onclick="metricEditor.startEdit(this)">
            ${this.formatValue(this.value)}
          </span>
          <span class="confidence-indicator" title="Confidence: ${this.confidence}%">
            ${confidenceIcon}
          </span>
          <input 
            type="number" 
            class="value-input hidden" 
            value="${this.value}"
            onblur="metricEditor.saveEdit(this)"
            onkeypress="metricEditor.handleKeyPress(event, this)"
          />
        </div>
        <div class="metric-actions">
          <button onclick="metricEditor.openCorrectionModal('${this.metricName}', '${this.fiscalPeriod}')">
            Edit
          </button>
          <button onclick="metricEditor.viewSource('${this.metricName}')">
            Source
          </button>
        </div>
      </div>
    `;
  }

  getConfidenceClass(): string {
    if (this.confidence >= 90) return 'confidence-high';
    if (this.confidence >= 70) return 'confidence-medium';
    return 'confidence-low';
  }

  getConfidenceIcon(): string {
    if (this.confidence >= 90) return '✓';
    if (this.confidence >= 70) return '⚠️';
    return '❌';
  }

  startEdit(element: HTMLElement): void {
    const input = element.nextElementSibling as HTMLInputElement;
    element.classList.add('hidden');
    input.classList.remove('hidden');
    input.focus();
    input.select();
  }

  async saveEdit(input: HTMLInputElement): Promise<void> {
    const newValue = parseFloat(input.value);
    
    if (newValue === this.originalValue) {
      this.cancelEdit(input);
      return;
    }

    // Show correction modal
    this.openCorrectionModal(this.metricName, this.fiscalPeriod, newValue);
  }

  openCorrectionModal(
    metricName: string, 
    fiscalPeriod: string, 
    newValue?: number
  ): void {
    const modal = new CorrectionModal({
      metricName,
      fiscalPeriod,
      originalValue: this.originalValue,
      newValue: newValue || this.originalValue,
      confidence: this.confidence,
      onSave: (correction) => this.submitCorrection(correction)
    });
    
    modal.show();
  }

  async submitCorrection(correction: CorrectionData): Promise<void> {
    try {
      const response = await fetch(`/api/deals/${dealId}/metrics/corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(correction)
      });

      if (response.ok) {
        this.showSuccess('Correction submitted for review');
        this.updateUI(correction.correctedValue);
      } else {
        this.showError('Failed to submit correction');
      }
    } catch (error) {
      this.showError('Network error');
    }
  }
}
```

#### B. Correction Modal
```typescript
// public/app/deals/components/correction-modal.ts

class CorrectionModal {
  constructor(private config: CorrectionModalConfig) {}

  show(): void {
    const html = `
      <div class="modal-overlay" onclick="this.remove()">
        <div class="modal-content" onclick="event.stopPropagation()">
          <h2>Correct Metric Value</h2>
          
          <div class="correction-form">
            <div class="form-group">
              <label>Metric</label>
              <div class="metric-display">${this.config.metricName}</div>
            </div>

            <div class="form-group">
              <label>Period</label>
              <div class="period-display">${this.config.fiscalPeriod}</div>
            </div>

            <div class="form-group">
              <label>Original Value</label>
              <div class="original-value">
                ${this.formatValue(this.config.originalValue)}
                <span class="confidence-badge">
                  ${this.config.confidence}% confidence
                </span>
              </div>
            </div>

            <div class="form-group">
              <label>Corrected Value *</label>
              <input 
                type="number" 
                id="corrected-value" 
                value="${this.config.newValue}"
                required
              />
            </div>

            <div class="form-group">
              <label>Correction Type *</label>
              <select id="correction-type" required>
                <option value="value_error">Value Error (wrong number)</option>
                <option value="wrong_metric">Wrong Metric (misclassified)</option>
                <option value="missing_data">Missing Data (not extracted)</option>
                <option value="manual_entry">Manual Entry (not in filing)</option>
              </select>
            </div>

            <div class="form-group">
              <label>Reason *</label>
              <textarea 
                id="correction-reason" 
                placeholder="Explain why this correction is needed..."
                required
              ></textarea>
            </div>

            <div class="form-group">
              <label>Source Document</label>
              <input 
                type="url" 
                id="source-url" 
                placeholder="https://sec.gov/..."
              />
              <input 
                type="number" 
                id="source-page" 
                placeholder="Page number"
              />
            </div>

            <div class="form-group">
              <label>Upload Screenshot (optional)</label>
              <input 
                type="file" 
                id="source-screenshot" 
                accept="image/*"
              />
            </div>

            <div class="form-actions">
              <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                Cancel
              </button>
              <button class="btn-primary" onclick="correctionModal.submit()">
                Submit Correction
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
  }

  async submit(): Promise<void> {
    const correctedValue = parseFloat(
      (document.getElementById('corrected-value') as HTMLInputElement).value
    );
    const correctionType = (document.getElementById('correction-type') as HTMLSelectElement).value;
    const reason = (document.getElementById('correction-reason') as HTMLTextAreaElement).value;
    const sourceUrl = (document.getElementById('source-url') as HTMLInputElement).value;
    const sourcePage = parseInt(
      (document.getElementById('source-page') as HTMLInputElement).value
    );

    // Upload screenshot if provided
    let screenshotUrl = null;
    const screenshotFile = (document.getElementById('source-screenshot') as HTMLInputElement).files?.[0];
    if (screenshotFile) {
      screenshotUrl = await this.uploadScreenshot(screenshotFile);
    }

    const correction = {
      normalizedMetric: this.config.metricName,
      fiscalPeriod: this.config.fiscalPeriod,
      correctedValue,
      type: correctionType,
      reason,
      sourceUrl,
      pageNumber: sourcePage,
      sourceScreenshotUrl: screenshotUrl,
      requiresReview: true
    };

    await this.config.onSave(correction);
    
    // Close modal
    document.querySelector('.modal-overlay')?.remove();
  }

  private async uploadScreenshot(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/uploads/screenshots', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    return data.url;
  }
}
```

---

### Workflow & Permissions

#### A. Correction Workflow
```
1. Analyst identifies incorrect value
   ↓
2. Analyst clicks "Edit" → Opens correction modal
   ↓
3. Analyst enters:
   - Corrected value
   - Correction type
   - Reason
   - Source document link
   - Screenshot (optional)
   ↓
4. System creates correction record (status: pending)
   ↓
5. System tracks correction pattern
   ↓
6. [Optional] Senior analyst reviews correction
   ↓
7. Correction approved → Applied to deal
   ↓
8. System recalculates derived metrics
   ↓
9. System revalidates financials
   ↓
10. Correction appears in audit log
```

#### B. Permission Levels
```typescript
enum CorrectionPermission {
  // Junior analyst: can create corrections, requires review
  CREATE_CORRECTION = 'correction:create',
  
  // Senior analyst: can approve corrections
  APPROVE_CORRECTION = 'correction:approve',
  
  // Admin: can view patterns and improvement reports
  VIEW_PATTERNS = 'correction:view_patterns',
  
  // Engineering: can mark parser fixes as applied
  MARK_FIX_APPLIED = 'correction:mark_fix_applied'
}
```

---

### Parser Improvement Loop

#### A. Weekly Review Process
```typescript
// scripts/weekly-correction-review.ts

async function weeklyReview() {
  const service = new MetricCorrectionService();
  
  // 1. Generate improvement report
  const report = await service.generateParserImprovementReport();
  
  // 2. Identify high-priority issues (>5 occurrences)
  const highPriority = report.topIssues.filter(i => i.occurrences >= 5);
  
  // 3. Create GitHub issues for parser improvements
  for (const issue of highPriority) {
    await createGitHubIssue({
      title: `Parser: Fix ${issue.metric} extraction for ${issue.ticker}`,
      body: `
        **Occurrences:** ${issue.occurrences}
        **Metric:** ${issue.metric}
        **Ticker:** ${issue.ticker}
        **Common Reason:** ${issue.reason}
        **Suggested Fix:** ${issue.suggestedFix}
        
        **Action Required:**
        1. Review XBRL tag mappings
        2. Test with recent ${issue.ticker} filings
        3. Update parser logic
        4. Mark pattern as fixed in database
      `,
      labels: ['parser-improvement', 'data-quality']
    });
  }
  
  // 4. Send report to engineering team
  await sendSlackNotification({
    channel: '#data-quality',
    message: `Weekly Parser Improvement Report:
      - Total corrections: ${report.totalCorrections}
      - Unique patterns: ${report.uniquePatterns}
      - High priority issues: ${highPriority.length}
      
      View full report: ${reportUrl}
    `
  });
}
```

---

## Summary

### Three Strategic Improvements

1. **Semantic Footnote Linking** (2-3 weeks)
   - Link metrics to explanatory footnotes
   - Extract structured data from footnotes
   - Enable segment analysis
   - **Impact:** +5-8% qualitative data extraction

2. **MD&A Narrative Intelligence** (1-3 weeks)
   - Extract trends, drivers, risks from MD&A
   - Pattern-based or LLM-based
   - Enable narrative analysis
   - **Impact:** +10-15% qualitative insights

3. **Hierarchical Metric Graph** (2 weeks)
   - Build relationship graph for drill-down
   - Validate rollups automatically
   - Enable interactive exploration
   - **Impact:** +20-30% analyst productivity

### HITL Implementation

- **Database:** 3 tables (corrections, patterns, audit_log)
- **Backend:** Correction service + controller
- **Frontend:** Inline editing + correction modal
- **Workflow:** Create → Review → Approve → Apply
- **Improvement Loop:** Weekly pattern analysis → Parser fixes

**Total Effort:** 5-8 weeks  
**Total Cost:** $40-64K development  
**ROI:** 50-100% analyst productivity improvement + continuous parser improvement
