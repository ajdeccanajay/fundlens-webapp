# Insights Tab Enhancement: AI-Powered Provocations
## Transforming Insights from "What Happened" to "What Does It Mean?"

---

## 🎯 Core Concept: Context-Aware Provocations

Instead of generating provocations in isolation, integrate them **directly into the Insights tab** based on what the analyst is viewing.

### Current Insights Tab Structure:
```
1. Key Metrics (hero cards)
2. Trends & Insights (from MD&A)
3. Risk Factors
4. Forward Guidance
5. Metric Hierarchy
```

### Enhanced Structure:
```
1. Key Metrics (hero cards) → ADD: "Challenge This" button
2. Trends & Insights → ADD: Provocations inline
3. Risk Factors → ADD: "What's Missing?" provocations
4. Forward Guidance → ADD: "Stress Test" scenarios
5. Metric Hierarchy → ADD: "Decomposition Questions"
6. NEW: Conviction Builder (provocations + answers)
```

---

## 📋 Implementation Plan

### **Phase 1: Inline Provocations (Week 1)**

Add provocations directly to existing sections:

#### 1.1 Key Metrics - "Challenge This Metric"
```html
<!-- In workspace.html, after each metric card -->
<div class="metric-card">
    <div class="metric-value">$50.2B Revenue</div>
    <div class="metric-change text-green-600">↑ 12% YoY</div>
    
    <!-- NEW: Provocation Button -->
    <button @click="showProvocation(metric.id)" 
            class="mt-2 text-xs text-indigo-600 hover:text-indigo-800 flex items-center">
        <i class="fas fa-brain mr-1"></i>
        Challenge This
    </button>
    
    <!-- Provocation Panel (slides down) -->
    <div x-show="activeProvocation === metric.id" 
         class="mt-3 p-3 bg-yellow-50 border-l-4 border-yellow-400 rounded">
        <p class="text-sm font-semibold text-gray-900 mb-2">
            🤔 Revenue grew 12%, but operating margin declined 200bps. 
            Is this growth profitable or just buying revenue?
        </p>
        <div class="text-xs text-gray-600 space-y-1">
            <div><strong>Bull Case:</strong> Investing in high-margin segments that will pay off in 2025</div>
            <div><strong>Bear Case:</strong> Competitive pressure forcing price cuts to maintain share</div>
            <div><strong>Watch:</strong> Gross margin trend, pricing commentary in next earnings call</div>
        </div>
        <div class="mt-2 flex gap-2">
            <button @click="addToScratchpad(provocation)" 
                    class="text-xs bg-indigo-600 text-white px-2 py-1 rounded">
                Save to Scratchpad
            </button>
            <button @click="researchThis(provocation)" 
                    class="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">
                Research This
            </button>
        </div>
    </div>
</div>
```

#### 1.2 Trends Section - Auto-Generated Provocations
```html
<!-- After each trend card -->
<div class="trend-card">
    <div class="trend-header">AWS Growth Accelerating</div>
    <p class="text-sm">AWS revenue grew 19% YoY vs 12% in prior quarter...</p>
    
    <!-- NEW: Inline Provocation -->
    <div class="mt-3 p-2 bg-purple-50 border-l-2 border-purple-400 rounded">
        <div class="flex items-start gap-2">
            <i class="fas fa-lightbulb text-purple-600 mt-0.5"></i>
            <div class="flex-1">
                <p class="text-xs font-semibold text-gray-900">Provocation:</p>
                <p class="text-xs text-gray-700">
                    AWS reacceleration coincides with Azure's deceleration. 
                    Is this market share gain or just easier comps?
                </p>
            </div>
        </div>
        <button @click="exploreProvocation('aws-growth')" 
                class="mt-2 text-xs text-purple-600 hover:underline">
            Explore with AI →
        </button>
    </div>
</div>
```

#### 1.3 Risk Factors - "What's Not Listed?"
```html
<!-- After risk factors list -->
<div class="risk-section">
    <!-- Existing risks... -->
    
    <!-- NEW: Missing Risk Provocations -->
    <div class="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
        <h4 class="text-sm font-semibold text-gray-900 mb-2 flex items-center">
            <i class="fas fa-exclamation-triangle text-orange-600 mr-2"></i>
            Risks Not Mentioned in Filing
        </h4>
        <div class="space-y-2">
            <div class="text-xs text-gray-700">
                <strong>AI Capex Sustainability:</strong> Company is spending $50B/year on AI infrastructure. 
                What if ROI doesn't materialize?
            </div>
            <div class="text-xs text-gray-700">
                <strong>Key Person Risk:</strong> CEO has been in role 27 years. 
                What's the succession plan?
            </div>
        </div>
    </div>
</div>
```

---

### **Phase 2: Conviction Builder Section (Week 2)**

Add a new section to Insights tab: **"Conviction Builder"**

```html
<!-- NEW SECTION in Insights Tab -->
<div class="conviction-builder bg-white rounded-xl p-6 border border-gray-200">
    <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold flex items-center">
            <i class="fas fa-balance-scale text-indigo-600 mr-3"></i>
            Conviction Builder
        </h2>
        <div class="flex items-center gap-2">
            <span class="text-sm text-gray-600">Your Conviction:</span>
            <div class="conviction-meter">
                <div class="w-32 h-2 bg-gray-200 rounded-full">
                    <div class="h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full"
                         :style="`width: ${convictionScore}%`"></div>
                </div>
                <span class="text-sm font-bold ml-2" x-text="convictionScore + '%'"></span>
            </div>
        </div>
    </div>
    
    <!-- Provocation Cards -->
    <div class="space-y-3">
        <template x-for="(prov, idx) in provocations" :key="prov.id">
            <div class="provocation-card border rounded-lg p-4"
                 :class="prov.answered ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'">
                
                <!-- Question -->
                <div class="flex items-start justify-between mb-2">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-semibold text-gray-500" 
                                  x-text="'#' + (idx + 1)"></span>
                            <span class="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded"
                                  x-text="prov.category"></span>
                            <span x-show="prov.priority === 'high'" 
                                  class="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                                High Priority
                            </span>
                        </div>
                        <p class="text-sm font-semibold text-gray-900" x-text="prov.question"></p>
                        <p class="text-xs text-gray-600 mt-1" x-text="prov.why_it_matters"></p>
                    </div>
                    
                    <!-- Status Icon -->
                    <div class="ml-3">
                        <i x-show="prov.answered" 
                           class="fas fa-check-circle text-green-600 text-xl"></i>
                        <i x-show="!prov.answered" 
                           class="far fa-circle text-gray-300 text-xl"></i>
                    </div>
                </div>
                
                <!-- Data Points Referenced -->
                <div class="flex flex-wrap gap-1 mb-3">
                    <template x-for="dataPoint in prov.data_points_referenced" :key="dataPoint">
                        <span class="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded"
                              x-text="dataPoint"></span>
                    </template>
                </div>
                
                <!-- Bull/Bear Cases (Collapsible) -->
                <div x-show="prov.showDetails" class="mb-3 space-y-2">
                    <div class="bg-green-50 p-2 rounded">
                        <p class="text-xs font-semibold text-green-800">🐂 Bull Case:</p>
                        <p class="text-xs text-green-700" x-text="prov.analysis.bull_case"></p>
                    </div>
                    <div class="bg-red-50 p-2 rounded">
                        <p class="text-xs font-semibold text-red-800">🐻 Bear Case:</p>
                        <p class="text-xs text-red-700" x-text="prov.analysis.bear_case"></p>
                    </div>
                    <div class="bg-blue-50 p-2 rounded">
                        <p class="text-xs font-semibold text-blue-800">👀 What to Watch:</p>
                        <p class="text-xs text-blue-700" x-text="prov.analysis.what_to_watch"></p>
                    </div>
                </div>
                
                <!-- Actions -->
                <div class="flex gap-2">
                    <button @click="prov.showDetails = !prov.showDetails"
                            class="text-xs text-indigo-600 hover:text-indigo-800">
                        <i :class="prov.showDetails ? 'fas fa-chevron-up' : 'fas fa-chevron-down'"></i>
                        <span x-text="prov.showDetails ? 'Hide' : 'Show'"></span> Analysis
                    </button>
                    <button @click="researchProvocation(prov)"
                            class="text-xs bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700">
                        <i class="fas fa-search mr-1"></i>Research This
                    </button>
                    <button @click="answerProvocation(prov)"
                            class="text-xs bg-gray-200 text-gray-700 px-3 py-1 rounded hover:bg-gray-300">
                        <i class="fas fa-pencil mr-1"></i>My Answer
                    </button>
                    <button @click="dismissProvocation(prov)"
                            class="text-xs text-gray-500 hover:text-gray-700">
                        Dismiss
                    </button>
                </div>
                
                <!-- User's Answer (if provided) -->
                <div x-show="prov.userAnswer" class="mt-3 p-3 bg-blue-50 border-l-4 border-blue-400 rounded">
                    <p class="text-xs font-semibold text-blue-900 mb-1">Your Answer:</p>
                    <p class="text-xs text-blue-800" x-text="prov.userAnswer"></p>
                    <div class="mt-2 flex items-center gap-2">
                        <span class="text-xs text-blue-700">Your View:</span>
                        <span class="text-xs font-semibold px-2 py-0.5 rounded"
                              :class="prov.userStance === 'bullish' ? 'bg-green-100 text-green-700' : 
                                      prov.userStance === 'bearish' ? 'bg-red-100 text-red-700' : 
                                      'bg-gray-100 text-gray-700'"
                              x-text="prov.userStance"></span>
                    </div>
                </div>
            </div>
        </template>
    </div>
    
    <!-- Generate More Button -->
    <button @click="generateMoreProvocations()"
            :disabled="loading.provocations"
            class="mt-4 w-full py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50">
        <i class="fas fa-magic mr-2"></i>
        <span x-text="loading.provocations ? 'Generating...' : 'Generate More Provocations'"></span>
    </button>
</div>
```

---

### **Phase 3: Smart Provocation Engine (Week 3)**

#### Backend Service: `provocation.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { BedrockService } from '../rag/bedrock.service';
import { PrismaService } from '../../prisma/prisma.service';

interface ProvocationContext {
  ticker: string;
  sector: string;
  thesisDirection?: 'long' | 'short' | 'neutral';
  currentView: 'metrics' | 'trends' | 'risks' | 'hierarchy';
  focusMetric?: string;
  recentMetrics: any[];
  mdaInsights: any;
  hierarchyData: any;
}

@Injectable()
export class ProvocationService {
  constructor(
    private bedrock: BedrockService,
    private prisma: PrismaService,
  ) {}

  async generateContextualProvocations(context: ProvocationContext) {
    // Build dynamic prompt based on what analyst is viewing
    const prompt = this.buildSmartPrompt(context);
    
    // Call Bedrock with enhanced prompt
    const response = await this.bedrock.generateProvocations(prompt);
    
    // Prioritize provocations based on data anomalies
    const prioritized = this.prioritizeProvocations(response, context);
    
    // Store for tracking
    await this.storeProvocations(context.ticker, prioritized);
    
    return prioritized;
  }

  private buildSmartPrompt(context: ProvocationContext): string {
    // Start with base prompt
    let prompt = `You are analyzing ${context.ticker} in the ${context.sector} sector.\n\n`;
    
    // Add context-specific focus
    if (context.currentView === 'metrics' && context.focusMetric) {
      prompt += `The analyst is examining ${context.focusMetric}. `;
      prompt += `Generate 3 provocations specifically about this metric and its drivers.\n\n`;
    }
    
    if (context.currentView === 'trends') {
      prompt += `The analyst is reviewing MD&A trends. `;
      prompt += `Generate provocations that challenge the narrative in management commentary.\n\n`;
    }
    
    if (context.currentView === 'risks') {
      prompt += `The analyst is reviewing disclosed risks. `;
      prompt += `Generate provocations about risks NOT mentioned in the filing.\n\n`;
    }
    
    // Add data anomalies
    const anomalies = this.detectAnomalies(context.recentMetrics);
    if (anomalies.length > 0) {
      prompt += `DATA ANOMALIES DETECTED:\n`;
      anomalies.forEach(a => {
        prompt += `- ${a.metric}: ${a.description}\n`;
      });
      prompt += `\nGenerate provocations that explain these anomalies.\n\n`;
    }
    
    // Add financial data
    prompt += `RECENT METRICS:\n${JSON.stringify(context.recentMetrics, null, 2)}\n\n`;
    
    // Add MD&A insights
    if (context.mdaInsights) {
      prompt += `MD&A INSIGHTS:\n${JSON.stringify(context.mdaInsights, null, 2)}\n\n`;
    }
    
    // Add your original provocation rules
    prompt += this.getProvocationRules(context.sector);
    
    return prompt;
  }

  private detectAnomalies(metrics: any[]): any[] {
    const anomalies = [];
    
    // Example: Revenue up but margins down
    const revenueGrowth = this.getMetricGrowth(metrics, 'revenue');
    const marginChange = this.getMetricChange(metrics, 'operatingMargin');
    
    if (revenueGrowth > 10 && marginChange < -1) {
      anomalies.push({
        metric: 'Revenue vs Margin',
        description: `Revenue grew ${revenueGrowth}% but operating margin declined ${Math.abs(marginChange)}%`,
      });
    }
    
    // Example: FCF declining while net income growing
    const netIncomeGrowth = this.getMetricGrowth(metrics, 'netIncome');
    const fcfGrowth = this.getMetricGrowth(metrics, 'freeCashFlow');
    
    if (netIncomeGrowth > 5 && fcfGrowth < -5) {
      anomalies.push({
        metric: 'Earnings Quality',
        description: `Net income up ${netIncomeGrowth}% but FCF down ${Math.abs(fcfGrowth)}%`,
      });
    }
    
    // Add more anomaly detection logic...
    
    return anomalies;
  }

  private prioritizeProvocations(provocations: any[], context: ProvocationContext) {
    return provocations.map(p => {
      let priority = 'medium';
      
      // High priority if related to anomaly
      if (p.category === 'Earnings Quality' && this.hasEarningsQualityIssue(context)) {
        priority = 'high';
      }
      
      // High priority if challenges thesis direction
      if (p.thesis_direction_challenged === context.thesisDirection) {
        priority = 'high';
      }
      
      return { ...p, priority };
    }).sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  private getProvocationRules(sector: string): string {
    // Return sector-specific rules from your original prompt
    const rules = {
      'Technology': `
        Focus on:
        - Platform dependency and ecosystem lock-in
        - AI capex ROI
        - Regulatory risks
        - User growth vs monetization
      `,
      'Consumer Discretionary': `
        Focus on:
        - Brand equity vs promotional intensity
        - Channel mix economics
        - Inventory health
        - Pricing power
      `,
      // Add other sectors...
    };
    
    return rules[sector] || rules['Technology'];
  }
}
```

---

### **Phase 4: Interactive Provocation Flow (Week 4)**

#### Frontend JavaScript (Alpine.js)

```javascript
// Add to workspace.html Alpine component
provocations: [],
activeProvocation: null,
convictionScore: 50,
loading: {
  provocations: false,
},

async loadProvocations() {
  this.loading.provocations = true;
  
  try {
    const response = await fetch(`/api/deals/${this.dealId}/provocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentView: this.currentView,
        focusMetric: this.activeFocusMetric,
        thesisDirection: this.userThesisDirection || 'neutral',
      }),
    });
    
    const data = await response.json();
    this.provocations = data.provocations.map(p => ({
      ...p,
      showDetails: false,
      answered: false,
      userAnswer: null,
      userStance: null,
    }));
    
    // Auto-show first high-priority provocation
    const highPriority = this.provocations.find(p => p.priority === 'high');
    if (highPriority) {
      highPriority.showDetails = true;
    }
  } catch (error) {
    console.error('Failed to load provocations:', error);
  } finally {
    this.loading.provocations = false;
  }
},

async researchProvocation(provocation) {
  // Switch to Research tab with pre-filled question
  this.switchView('research');
  this.researchQuery = provocation.question;
  await this.submitResearchQuery();
},

async answerProvocation(provocation) {
  // Show modal for analyst to provide their answer
  const answer = prompt(`Your answer to: ${provocation.question}`);
  if (!answer) return;
  
  const stance = confirm('Are you bullish on this point?') ? 'bullish' : 
                 confirm('Are you bearish?') ? 'bearish' : 'neutral';
  
  provocation.userAnswer = answer;
  provocation.userStance = stance;
  provocation.answered = true;
  
  // Recalculate conviction score
  this.updateConvictionScore();
  
  // Save to backend
  await this.saveProvocationAnswer(provocation);
},

updateConvictionScore() {
  const answered = this.provocations.filter(p => p.answered).length;
  const total = this.provocations.length;
  
  if (total === 0) return;
  
  // Base score on % answered
  let score = (answered / total) * 100;
  
  // Adjust based on bull/bear balance
  const bullish = this.provocations.filter(p => p.userStance === 'bullish').length;
  const bearish = this.provocations.filter(p => p.userStance === 'bearish').length;
  
  // If all answers are one-sided, reduce conviction
  if (bullish > 0 && bearish === 0) score *= 0.8;
  if (bearish > 0 && bullish === 0) score *= 0.8;
  
  this.convictionScore = Math.round(score);
},

async generateMoreProvocations() {
  // Generate additional provocations based on answered ones
  await this.loadProvocations();
},
```

---

## 🎨 Visual Design Enhancements

### Color Coding System
```css
/* Provocation Priority Colors */
.provocation-high-priority {
  border-left: 4px solid #ef4444; /* Red */
  background: #fef2f2;
}

.provocation-medium-priority {
  border-left: 4px solid #f59e0b; /* Orange */
  background: #fffbeb;
}

.provocation-low-priority {
  border-left: 4px solid #3b82f6; /* Blue */
  background: #eff6ff;
}

/* Conviction Meter */
.conviction-meter {
  position: relative;
}

.conviction-meter::after {
  content: '';
  position: absolute;
  top: -2px;
  left: var(--conviction-position);
  width: 2px;
  height: 12px;
  background: #1f2937;
}

/* Answered State */
.provocation-answered {
  opacity: 0.7;
  background: #f0fdf4;
}
```

---

## 📊 Enhanced Prompt for Backend

Here's your improved prompt that integrates with the system:

```typescript
const ENHANCED_PROVOCATION_PROMPT = `
# Context-Aware Provocation Generator

You are analyzing ${ticker} (${sector}). The analyst is currently viewing: ${currentView}.

## Current Focus
${focusContext}

## Data Anomalies Detected
${anomalies.map(a => `- ${a.metric}: ${a.description}`).join('\n')}

## Recent Metrics
${JSON.stringify(recentMetrics, null, 2)}

## MD&A Insights
${JSON.stringify(mdaInsights, null, 2)}

## Your Task
Generate 3-5 provocations that:
1. **Address the anomalies above** - explain what's driving them
2. **Challenge the ${thesisDirection} thesis** - force stress-testing
3. **Are immediately actionable** - analyst can research them now
4. **Reference specific data points** - not generic questions

## Output Format
{
  "provocations": [
    {
      "id": 1,
      "question": "Direct, uncomfortable question",
      "why_it_matters": "One sentence on criticality",
      "category": "Earnings Quality | Competitive Position | Capital Allocation | etc.",
      "priority": "high | medium | low",
      "data_points_referenced": ["Specific metrics"],
      "analysis": {
        "summary": "2-3 sentences",
        "bull_case": "How a bull would answer",
        "bear_case": "How a bear would answer",
        "what_to_watch": "Specific metrics/events"
      }
    }
  ]
}

## Quality Rules
- NO generic questions like "What are the risks?"
- MUST reference actual data from above
- MUST be answerable with available information
- MUST challenge consensus thinking
- Each provocation must be distinct

Generate provocations now:
`;
```

---

## 🚀 Implementation Checklist

### Week 1: Foundation
- [ ] Add "Challenge This" buttons to metric cards
- [ ] Create provocation panel component
- [ ] Implement basic provocation display
- [ ] Add save to scratchpad functionality

### Week 2: Conviction Builder
- [ ] Create new Conviction Builder section
- [ ] Implement provocation cards with bull/bear cases
- [ ] Add answer/dismiss functionality
- [ ] Build conviction score calculator

### Week 3: Smart Engine
- [ ] Build `ProvocationService` backend
- [ ] Implement anomaly detection logic
- [ ] Add context-aware prompt building
- [ ] Integrate with Bedrock API

### Week 4: Polish
- [ ] Add visual design enhancements
- [ ] Implement keyboard shortcuts
- [ ] Add export to IC memo
- [ ] Build analytics tracking

---

## 💡 Key Improvements Over Original Prompt

| Aspect | Original Prompt | Enhanced Version |
|--------|----------------|------------------|
| **Context** | Static company info | Dynamic based on analyst's current view |
| **Data Integration** | Manual copy-paste | Auto-populated from your database |
| **Prioritization** | All equal weight | Smart prioritization based on anomalies |
| **Actionability** | One-shot questions | Interactive with research integration |
| **Tracking** | None | Conviction score + answer tracking |
| **UI Integration** | Separate tool | Embedded in workflow |

---

## 🎯 Success Metrics

Track these to measure impact:

1. **Engagement:** % of analysts who interact with provocations
2. **Completion:** Average # of provocations answered per company
3. **Research Depth:** # of "Research This" clicks per provocation
4. **Conviction Correlation:** Does higher conviction score correlate with better investment outcomes?
5. **Time Saved:** Reduction in time to form investment view

---

## 🏆 Competitive Advantage

This creates a unique moat because:

1. **Bloomberg/FactSet don't have this** - they show data, not provocations
2. **Integrates your existing data** - leverages your SEC parsing advantage
3. **Learns from analyst behavior** - gets smarter over time
4. **Builds institutional knowledge** - captures how best analysts think

---

**Next Step:** Start with Week 1 implementation - add "Challenge This" buttons to existing metric cards. This gives immediate value while you build out the full Conviction Builder.
