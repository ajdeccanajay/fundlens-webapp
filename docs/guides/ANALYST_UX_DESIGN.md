# Analyst-First UX Design: Insights Over Corrections
**Date:** January 29, 2026  
**Role:** Senior Principal AI Engineer + Head of Design  
**Philosophy:** Analysts get insights. System handles data quality.

---

## Core Design Principle

**❌ WRONG:** Make analysts fix data  
**✅ RIGHT:** System auto-corrects, analysts validate insights

**Key Insight:** Analysts should only interact with data quality when it **blocks their analysis**. Otherwise, the system should handle it silently.

---

## User Flow: Analyst's Day

### Morning: Deal Setup (5 minutes)
```
Analyst arrives → Opens deal workspace → System shows:

┌─────────────────────────────────────────────────────────┐
│  AAPL Analysis - FY2024                                 │
│  ┌───────────────────────────────────────────────────┐ │
│  │  📊 Data Quality: 96% ✓                          │ │
│  │  Last updated: 2 hours ago                        │ │
│  │                                                    │ │
│  │  Ready to analyze                                 │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  [Start Analysis] [View Financials] [Chat]            │
└─────────────────────────────────────────────────────────┘
```

**Analyst clicks "Start Analysis"** → Goes straight to insights

**NO data correction needed** - System already validated everything

---

### Analysis Flow: Insights First

```
┌─────────────────────────────────────────────────────────┐
│  Financial Analysis                                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Revenue Trend                                          │
│  ┌─────────────────────────────────────────────────┐  │
│  │  📈 +15% YoY growth                             │  │
│  │  Driven by: iPhone sales (+20%), Services (+12%)│  │
│  │  Risk: China revenue declining (-8%)            │  │
│  │                                                  │  │
│  │  [Drill Down] [View Details] [Add to Report]   │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  Margin Analysis                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │  📊 Gross Margin: 46.7% (stable)               │  │
│  │  Operating Margin: 30.1% (+2.3pp)              │  │
│  │                                                  │  │
│  │  [Drill Down] [Compare Peers] [Add to Report]  │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Analyst sees insights, not raw data**

**Drill-down is one click away** - but starts with the story

---

## When Data Quality Matters: Subtle Indicators

### Scenario 1: High Confidence (96%+) - Silent Success
```
┌─────────────────────────────────────────────────────────┐
│  Revenue: $394.3B (+15% YoY)                           │
│  ✓ Verified                                             │
└─────────────────────────────────────────────────────────┘
```

**No action needed** - Analyst doesn't even think about data quality

---

### Scenario 2: Medium Confidence (85-95%) - Gentle Nudge
```
┌─────────────────────────────────────────────────────────┐
│  SG&A: $24.9B (+0% YoY)                                │
│  ⓘ Auto-verified against filing                        │
│  [View Source]                                          │
└─────────────────────────────────────────────────────────┘
```

**Subtle indicator** - System already verified, analyst can check if curious

---

### Scenario 3: Low Confidence (<85%) - Proactive Help
```
┌─────────────────────────────────────────────────────────┐
│  ⚠️ Data Quality Alert                                  │
│                                                         │
│  We found a potential issue with R&D expenses:         │
│  • Extracted: $29.9B                                    │
│  • Expected range: $26-28B (based on trends)           │
│                                                         │
│  System is reviewing the filing...                     │
│  You can continue your analysis.                       │
│                                                         │
│  [Dismiss] [View Details] [Use Anyway]                │
└─────────────────────────────────────────────────────────┘
```

**System handles it** - Analyst can ignore and keep working

---

## The Three Pages: Insight-Focused Design

### Page 1: Deal Dashboard (Overview)

**Purpose:** High-level health check + quick insights

```
┌─────────────────────────────────────────────────────────────┐
│  AAPL - Apple Inc.                          FY2024 10-K     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📊 Key Metrics                                             │
│  ┌──────────────┬──────────────┬──────────────┐           │
│  │ Revenue      │ Gross Margin │ Op. Margin   │           │
│  │ $394.3B      │ 46.7%        │ 30.1%        │           │
│  │ +15% ✓       │ +0.2pp ✓     │ +2.3pp ✓     │           │
│  └──────────────┴──────────────┴──────────────┘           │
│                                                             │
│  💡 AI Insights                                             │
│  • Strong revenue growth driven by iPhone and Services     │
│  • Margin expansion from operational efficiency            │
│  • China revenue declining - monitor closely               │
│                                                             │
│  📈 Trend Analysis                                          │
│  [Revenue Chart] [Margin Chart] [Segment Chart]           │
│                                                             │
│  🔍 Deep Dive                                               │
│  [Financial Statements] [Segment Analysis] [Peer Compare]  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Data Quality: 96% ✓  |  Last updated: 2h ago      │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Data quality is footer** - Not the focus

**Insights are hero** - What analyst cares about

---

### Page 2: Financial Statements (Interactive Drill-Down)

**Purpose:** Explore numbers with context

```
┌─────────────────────────────────────────────────────────────┐
│  Income Statement - FY2024                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Revenue                          $394.3B    +15% ✓        │
│    ├─ Product Revenue             $298.1B    +14%          │
│    │   ├─ iPhone                  $201.2B    +20% 📈       │
│    │   ├─ Mac                     $29.4B     +2%           │
│    │   ├─ iPad                    $28.3B     -3%           │
│    │   └─ Wearables               $39.2B     +12%          │
│    └─ Services Revenue            $96.2B     +12% 📈       │
│                                                             │
│  Cost of Revenue                  $210.4B    +13% ✓        │
│  ─────────────────────────────────────────────────         │
│  Gross Profit                     $183.9B    +17% ✓        │
│  Gross Margin                     46.7%      +0.2pp        │
│                                                             │
│  [Click any metric to see details, trends, and context]    │
└─────────────────────────────────────────────────────────────┘
```

**Interaction:** Click "iPhone $201.2B" →

```
┌─────────────────────────────────────────────────────────────┐
│  iPhone Revenue Deep Dive                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  $201.2B (+20% YoY) ✓                                       │
│                                                             │
│  📊 Trend (5 years)                                         │
│  [Chart showing iPhone revenue growth]                     │
│                                                             │
│  💬 Management Commentary (MD&A)                            │
│  "iPhone revenue increased 20% driven by strong demand     │
│   for iPhone 15 Pro models and growth in emerging markets" │
│                                                             │
│  🌍 Geographic Breakdown                                    │
│  • Americas: $95B (+18%)                                    │
│  • Europe: $52B (+25%)                                      │
│  • China: $38B (-8%) ⚠️                                     │
│  • Rest of Asia: $16B (+35%)                                │
│                                                             │
│  📝 Footnotes                                               │
│  See Note 3: Revenue Recognition for accounting policies   │
│                                                             │
│  [Add to Report] [Compare to Peers] [View Source Filing]   │
└─────────────────────────────────────────────────────────────┘
```

**Everything analyst needs** - Trend, context, breakdown, commentary

**No data correction UI** - System already validated

---

### Page 3: Chat/Research Assistant (Natural Language)

**Purpose:** Ask questions, get insights

```
┌─────────────────────────────────────────────────────────────┐
│  Research Assistant                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  You: Why did iPhone revenue grow 20%?                     │
│                                                             │
│  Assistant:                                                 │
│  iPhone revenue grew 20% to $201.2B in FY2024 driven by:   │
│                                                             │
│  1. **Strong iPhone 15 Pro demand** - Management noted     │
│     "exceptional demand" for Pro models with new features  │
│                                                             │
│  2. **Emerging market growth** - India and Southeast Asia  │
│     grew 35%, offsetting China decline (-8%)               │
│                                                             │
│  3. **Pricing power** - Average selling price increased    │
│     5% due to Pro mix shift                                │
│                                                             │
│  Sources: 10-K page 42, MD&A section, Note 3              │
│                                                             │
│  [View detailed breakdown] [Compare to competitors]        │
│                                                             │
│  ─────────────────────────────────────────────────────     │
│                                                             │
│  You: [Type your question...]                              │
└─────────────────────────────────────────────────────────────┘
```

**Natural language** - No need to navigate complex UI

**Contextual answers** - Combines quantitative + qualitative

---

## Hidden: Data Quality Management

### Where HITL Lives: Background, Not Foreground

**Analyst never sees this unless there's a problem:**

```
System Background Process:
1. Parse filing → 96% confidence
2. Auto-validate against rules
3. Flag 3 metrics with low confidence
4. Auto-correct 2 using historical patterns
5. Flag 1 for human review (unusual variance)
6. Send notification to data quality team (not analyst)
7. Data quality team reviews and approves
8. System updates metrics
9. Analyst sees "96% ✓" - never knew there was an issue
```

**Analyst experience:** Seamless

**Data quality team experience:** Focused workflow for exceptions only

---

## When Analyst MUST Interact: Exception Handling

### Scenario: Critical Data Issue Blocks Analysis

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️ Analysis Paused                                         │
│                                                             │
│  We found a significant discrepancy in the financial data: │
│                                                             │
│  **Net Income doesn't reconcile**                          │
│  • Income Statement: $97.0B                                 │
│  • Cash Flow Statement: $99.8B                              │
│  • Difference: $2.8B (2.9%)                                 │
│                                                             │
│  This may affect your analysis. Our data quality team      │
│  is reviewing the filing.                                   │
│                                                             │
│  What would you like to do?                                 │
│                                                             │
│  [Wait for Review] (Recommended)                           │
│  [Continue Anyway] (Use with caution)                      │
│  [Help Me Understand]                                       │
└─────────────────────────────────────────────────────────────┘
```

**Analyst clicks "Help Me Understand":**

```
┌─────────────────────────────────────────────────────────────┐
│  Understanding the Discrepancy                              │
│                                                             │
│  This is likely due to:                                     │
│  • Non-cash charges (stock-based compensation)              │
│  • Timing differences (accrual vs cash basis)               │
│  • Foreign currency adjustments                             │
│                                                             │
│  Our system is checking the footnotes for reconciliation.   │
│                                                             │
│  You can:                                                   │
│  1. Use Income Statement figure ($97.0B) for P&L analysis  │
│  2. Use Cash Flow figure ($99.8B) for cash analysis        │
│  3. Wait for our team to reconcile (ETA: 30 min)           │
│                                                             │
│  [Use Income Statement] [Use Cash Flow] [Wait]             │
└─────────────────────────────────────────────────────────────┘
```

**System guides analyst** - Doesn't make them fix it

---

## Relationship Graph: Invisible Power

### How Analyst Experiences It

**Analyst clicks "Revenue" → System shows:**

```
┌─────────────────────────────────────────────────────────────┐
│  Revenue Breakdown                                          │
│                                                             │
│  Total Revenue: $394.3B                                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Product Revenue        $298.1B  (76%)              │  │
│  │  ├─ iPhone              $201.2B  (51%)  [Expand]    │  │
│  │  ├─ Mac                 $29.4B   (7%)               │  │
│  │  ├─ iPad                $28.3B   (7%)               │  │
│  │  └─ Wearables           $39.2B   (10%)              │  │
│  │                                                      │  │
│  │  Services Revenue       $96.2B   (24%)              │  │
│  │  ├─ App Store           $38.5B   (10%)  [Expand]    │  │
│  │  ├─ iCloud              $18.1B   (5%)               │  │
│  │  ├─ Apple Music         $15.2B   (4%)               │  │
│  │  └─ Other Services      $24.4B   (6%)               │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  [View as Chart] [Compare to Prior Year] [Export]          │
└─────────────────────────────────────────────────────────────┘
```

**Behind the scenes:** Relationship graph powers this

**Analyst sees:** Clean hierarchy, one click to expand

**Analyst clicks "iPhone" → Expands to show geographic breakdown**

**System automatically:**
- Validates iPhone = sum of geographies
- Shows trends
- Highlights anomalies
- Provides context from MD&A

---

## Footnotes & Context: Seamless Integration

### How Analyst Experiences It

**Analyst hovers over "Revenue" → Tooltip appears:**

```
┌─────────────────────────────────────────────┐
│  Revenue: $394.3B                           │
│                                             │
│  📝 See Note 3: Revenue Recognition         │
│  💬 Management: "Strong growth across all   │
│     product categories..."                  │
│                                             │
│  [View Full Context]                        │
└─────────────────────────────────────────────┘
```

**Analyst clicks "View Full Context":**

```
┌─────────────────────────────────────────────────────────────┐
│  Revenue Context                                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📊 Quantitative                                            │
│  • Total: $394.3B (+15% YoY)                                │
│  • Product: $298.1B (+14%)                                  │
│  • Services: $96.2B (+12%)                                  │
│                                                             │
│  💬 Management Commentary (MD&A, page 28)                   │
│  "Revenue increased 15% driven by strong iPhone demand     │
│   and continued growth in Services. We saw particular      │
│   strength in emerging markets..."                          │
│                                                             │
│  📝 Accounting Policy (Note 3, page 67)                     │
│  "Revenue is recognized when control transfers to the      │
│   customer. For products, this is typically at point of    │
│   sale. For services, revenue is recognized ratably..."    │
│                                                             │
│  🌍 Geographic Breakdown (Note 3, page 68)                  │
│  [Table showing revenue by geography]                      │
│                                                             │
│  [View Source Filing] [Add to Report]                      │
└─────────────────────────────────────────────────────────────┘
```

**Everything in one place** - No hunting through filing

**Behind the scenes:** Footnote linking system extracted this

**Analyst sees:** Seamless, contextual information

---

## MD&A Intelligence: Narrative Insights

### How Analyst Experiences It

**Analyst opens "Insights" tab:**

```
┌─────────────────────────────────────────────────────────────┐
│  AI-Generated Insights                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📈 Revenue Trends                                          │
│  • iPhone revenue accelerating (+20% vs +5% prior year)    │
│  • Services growth steady (+12% vs +11% prior year)        │
│  • China revenue declining (-8%) - first decline in 3 years│
│                                                             │
│  💡 Key Drivers                                             │
│  • iPhone 15 Pro strong demand (mentioned 12x in MD&A)     │
│  • Emerging markets growth (India +35%, SEA +28%)          │
│  • Services attach rate improving (24% of revenue vs 22%)  │
│                                                             │
│  ⚠️ Risks Identified                                        │
│  • China regulatory environment (mentioned 8x)              │
│  • Supply chain constraints (mentioned 5x)                  │
│  • Currency headwinds (mentioned 4x)                        │
│                                                             │
│  🔮 Forward Guidance                                        │
│  • Management expects "continued growth" in Services        │
│  • No specific revenue guidance provided                    │
│  • Capex increasing 15% for manufacturing capacity          │
│                                                             │
│  [View Detailed Analysis] [Compare to Peers] [Export]      │
└─────────────────────────────────────────────────────────────┘
```

**Behind the scenes:** MD&A intelligence extracted this

**Analyst sees:** Structured insights, not raw text

**Analyst can drill into any insight for source quotes**

---

## Summary: Analyst Experience

### What Analyst Sees

1. **Deal Dashboard** - High-level insights, health check
2. **Financial Statements** - Interactive drill-down with context
3. **Chat/Research** - Natural language Q&A
4. **Insights** - AI-generated narrative analysis

### What Analyst Doesn't See (Unless Necessary)

1. **Data quality scores** - Hidden in footer
2. **Correction workflows** - Handled by data quality team
3. **Parser details** - Completely invisible
4. **Validation errors** - Auto-corrected silently

### When Analyst Interacts with Data Quality

**Only when:**
1. Critical discrepancy blocks analysis (rare)
2. Analyst is curious about source (optional)
3. Analyst wants to verify unusual number (optional)

**Never for:**
1. Routine corrections
2. Parser improvements
3. Data validation
4. Quality monitoring

---

## Implementation: Pages & Components

### Page 1: `/deals/:id` (Deal Dashboard)
- Hero metrics with trends
- AI insights summary
- Quick actions (drill-down, compare, export)
- Data quality indicator (footer)

### Page 2: `/deals/:id/financials` (Financial Statements)
- Interactive statement view
- Click to drill-down
- Hover for context
- Relationship graph powers navigation

### Page 3: `/deals/:id/chat` (Research Assistant)
- Natural language interface
- Contextual answers
- Source citations
- Add to report

### Hidden: `/admin/data-quality` (Data Quality Team Only)
- Correction queue
- Pattern analysis
- Parser improvement tracking
- NOT for analysts

---

## Key Design Decisions

### 1. Progressive Disclosure
- Start with insights
- Drill down for details
- Context on demand
- Source always available

### 2. Confidence-Based UI
- High confidence (>95%): No indicator
- Medium confidence (85-95%): Subtle checkmark
- Low confidence (<85%): Proactive help, but non-blocking

### 3. Separation of Concerns
- **Analysts:** Get insights
- **Data Quality Team:** Fix data
- **System:** Auto-correct when possible

### 4. Trust Through Transparency
- Always show source
- Always explain discrepancies
- Always provide context
- Never hide problems, but don't make analyst fix them

---

## Success Metrics

### Analyst Productivity
- Time to first insight: <30 seconds
- Questions answered per session: 10-15
- Reports generated per day: 3-5

### Data Quality (Invisible to Analyst)
- Auto-correction rate: 95%
- Human review needed: 5%
- Analyst-initiated corrections: <1%

### User Satisfaction
- "I trust the data": 95%+
- "I can find what I need": 95%+
- "I don't think about data quality": 90%+

**Bottom Line:** Analysts should feel like they're working with perfect data, even though the system is constantly validating and correcting behind the scenes.
