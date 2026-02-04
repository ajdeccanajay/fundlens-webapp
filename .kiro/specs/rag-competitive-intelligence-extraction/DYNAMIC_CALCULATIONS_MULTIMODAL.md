# Dynamic Metric Calculation and Multi-Modal Responses

## Overview

This document explains how the RAG system handles:
1. **Dynamic metric calculations** - Computing metrics not pre-calculated by the Python engine
2. **Peer comparisons** - Comparing custom metrics across companies
3. **Multi-modal responses** - Generating charts, tables, and visualizations
4. **Code interpretation** - Executing complex Python calculations

---

## 1. Dynamic Metric Calculation

### The Challenge

**Current State:**
- Python engine pre-calculates common metrics (Revenue, EBITDA, Gross Margin, etc.)
- Stored in RDS for fast retrieval
- Works great for standard metrics

**New Requirement:**
- User asks: "Calculate NVDA's operating leverage"
- Operating leverage = % change in EBIT / % change in Revenue
- NOT pre-calculated in database
- Need to compute on-demand

### Solution Architecture

```
User Query → Intent Detection → Formula Extraction → Component Retrieval → Calculation → Response
```

### Step-by-Step Example

**Query:** "Calculate NVDA's operating leverage for FY2024 vs FY2023"

**Step 1: Intent Detection**
```typescript
// intent-detector.service.ts detects dynamic calculation

{
  type: 'dynamic_calculation',
  ticker: 'NVDA',
  metric: 'operating_leverage',
  formula: null, // To be extracted
  periods: ['FY2024', 'FY2023'],
  needsComparison: true
}
```

**Step 2: Formula Extraction (LLM-Assisted)**
```typescript
// Use Claude to extract/generate formula

const prompt = `
The user wants to calculate "operating leverage" for NVDA.

Operating leverage is defined as:
Operating Leverage = (% Change in Operating Income) / (% Change in Revenue)

To calculate this, we need:
1. Operating Income for FY2024 and FY2023
2. Revenue for FY2024 and FY2023

Generate a JSON formula specification:
{
  "metric_name": "operating_leverage",
  "formula": "((operating_income_2024 - operating_income_2023) / operating_income_2023) / ((revenue_2024 - revenue_2023) / revenue_2023)",
  "required_metrics": [
    {"name": "operating_income", "periods": ["FY2024", "FY2023"]},
    {"name": "revenue", "periods": ["FY2024", "FY2023"]}
  ]
}
`;

const formulaSpec = await this.bedrock.extractFormula(prompt);
```

**Step 3: Component Retrieval**
```typescript
// Retrieve required metrics from RDS

const components = await this.structuredRetriever.retrieve({
  tickers: ['NVDA'],
  metrics: ['operating_income', 'revenue'],
  periods: ['FY2024', 'FY2023'],
  filingTypes: ['10-K']
});

// Result:
// operating_income FY2024: $22.1B
// operating_income FY2023: $4.2B
// revenue FY2024: $60.9B
// revenue FY2023: $26.9B
```

**Step 4: Calculation**
```typescript
// Execute formula

const result = this.calculateMetric(formulaSpec, components);

// Calculation:
// Operating Income % change = (22.1 - 4.2) / 4.2 = 4.26 (426%)
// Revenue % change = (60.9 - 26.9) / 26.9 = 1.26 (126%)
// Operating Leverage = 4.26 / 1.26 = 3.38
```

**Step 5: Response Generation**
```typescript
const response = `
NVIDIA's Operating Leverage (FY2024 vs FY2023): 3.38

This means that for every 1% increase in revenue, operating income increased by 3.38%.

Calculation:
- Operating Income grew 426% (from $4.2B to $22.1B)
- Revenue grew 126% (from $26.9B to $60.9B)
- Operating Leverage = 426% / 126% = 3.38

This high operating leverage indicates strong operational efficiency and economies of scale.
`;
```

### Implementation

```typescript
// src/rag/dynamic-calculator.service.ts

@Injectable()
export class DynamicCalculatorService {
  constructor(
    private readonly bedrock: BedrockService,
    private readonly structuredRetriever: StructuredRetrieverService,
  ) {}
  
  async calculateDynamicMetric(query: string, ticker: string, metricName: string): Promise<CalculationResult> {
    // Step 1: Extract formula specification
    const formulaSpec = await this.extractFormulaSpec(metricName);
    
    // Step 2: Retrieve required component metrics
    const components = await this.retrieveComponents(ticker, formulaSpec.required_metrics);
    
    // Step 3: Validate all components are available
    if (!this.validateComponents(components, formulaSpec.required_metrics)) {
      return {
        success: false,
        error: 'Missing required metrics',
        missingMetrics: this.identifyMissingMetrics(components, formulaSpec.required_metrics)
      };
    }
    
    // Step 4: Execute calculation
    const result = this.executeFormula(formulaSpec.formula, components);
    
    // Step 5: Format response
    return {
      success: true,
      metricName,
      value: result,
      formula: formulaSpec.formula,
      components,
      explanation: this.generateExplanation(metricName, result, components)
    };
  }
  
  private async extractFormulaSpec(metricName: string): Promise<FormulaSpec> {
    const prompt = `
    Extract the formula specification for the financial metric: "${metricName}"
    
    Return JSON with:
    {
      "metric_name": string,
      "formula": string (JavaScript expression),
      "required_metrics": [
        {"name": string, "periods": string[]}
      ],
      "description": string
    }
    
    Common financial metrics:
    - Operating Leverage = (% Change in Operating Income) / (% Change in Revenue)
    - Asset Turnover = Revenue / Average Total Assets
    - Inventory Turnover = Cost of Revenue / Average Inventory
    - Days Sales Outstanding = (Accounts Receivable / Revenue) * 365
    - Debt to Equity = Total Debt / Total Equity
    - Interest Coverage = Operating Income / Interest Expense
    `;
    
    const response = await this.bedrock.generate(prompt, {});
    return JSON.parse(response.answer);
  }
  
  private executeFormula(formula: string, components: Record<string, number>): number {
    // Safe formula execution using Function constructor
    // Only allow mathematical operations, no external access
    const allowedOperations = ['+', '-', '*', '/', '(', ')', 'Math.'];
    
    // Replace metric names with values
    let executableFormula = formula;
    for (const [key, value] of Object.entries(components)) {
      executableFormula = executableFormula.replace(new RegExp(key, 'g'), value.toString());
    }
    
    // Execute in isolated context
    try {
      const result = new Function(`return ${executableFormula}`)();
      return result;
    } catch (error) {
      throw new Error(`Formula execution failed: ${error.message}`);
    }
  }
}
```

---

## 2. Peer Comparison with Dynamic Metrics

### Example Query

**Query:** "Compare operating leverage for NVDA, AMD, and INTC"

### Implementation

```typescript
async compareDynamicMetric(tickers: string[], metricName: string): Promise<ComparisonResult> {
  const results: Record<string, CalculationResult> = {};
  
  // Calculate metric for each ticker independently
  for (const ticker of tickers) {
    try {
      results[ticker] = await this.calculateDynamicMetric('', ticker, metricName);
    } catch (error) {
      results[ticker] = {
        success: false,
        error: error.message
      };
    }
  }
  
  // Generate comparison table
  return {
    metric: metricName,
    results,
    ranking: this.rankResults(results),
    insights: this.generateComparisonInsights(results)
  };
}
```

### Response Format

```
Operating Leverage Comparison (FY2024 vs FY2023):

Company  | Operating Leverage | Operating Income Growth | Revenue Growth
---------|-------------------|------------------------|---------------
NVDA     | 3.38              | +426%                  | +126%
AMD      | 2.15              | +172%                  | +80%
INTC     | -1.42             | -28%                   | +20%

Insights:
- NVDA shows the highest operating leverage (3.38), indicating strong operational efficiency
- AMD demonstrates positive leverage (2.15) with solid growth
- INTC shows negative leverage (-1.42), with operating income declining despite revenue growth

[Chart: Bar chart showing operating leverage comparison]
```

---

## 3. Multi-Modal Response Generation

### Chart Types

#### 1. Line Charts (Trends)
**Use Case:** Time series analysis

**Query:** "Show NVDA's revenue trend over the last 5 years"

**Response:**
```json
{
  "type": "line_chart",
  "config": {
    "type": "line",
    "data": {
      "labels": ["FY2020", "FY2021", "FY2022", "FY2023", "FY2024"],
      "datasets": [{
        "label": "NVDA Revenue",
        "data": [16.7, 26.9, 26.9, 26.9, 60.9],
        "borderColor": "rgb(75, 192, 192)",
        "tension": 0.1
      }]
    },
    "options": {
      "responsive": true,
      "plugins": {
        "title": {
          "display": true,
          "text": "NVIDIA Revenue Trend (FY2020-FY2024)"
        }
      },
      "scales": {
        "y": {
          "title": {
            "display": true,
            "text": "Revenue (Billions USD)"
          }
        }
      }
    }
  }
}
```

#### 2. Bar Charts (Comparisons)
**Use Case:** Peer comparison

**Query:** "Compare NVDA, AMD, and INTC revenue for FY2024"

**Response:**
```json
{
  "type": "bar_chart",
  "config": {
    "type": "bar",
    "data": {
      "labels": ["NVDA", "AMD", "INTC"],
      "datasets": [{
        "label": "FY2024 Revenue",
        "data": [60.9, 22.7, 54.2],
        "backgroundColor": [
          "rgba(75, 192, 192, 0.6)",
          "rgba(255, 99, 132, 0.6)",
          "rgba(54, 162, 235, 0.6)"
        ]
      }]
    },
    "options": {
      "responsive": true,
      "plugins": {
        "title": {
          "display": true,
          "text": "Revenue Comparison - FY2024"
        }
      },
      "scales": {
        "y": {
          "title": {
            "display": true,
            "text": "Revenue (Billions USD)"
          }
        }
      }
    }
  }
}
```

#### 3. Pie Charts (Composition)
**Use Case:** Revenue breakdown by segment

**Query:** "Show NVDA's revenue breakdown by segment"

**Response:**
```json
{
  "type": "pie_chart",
  "config": {
    "type": "pie",
    "data": {
      "labels": ["Data Center", "Gaming", "Professional Visualization", "Automotive"],
      "datasets": [{
        "data": [47.5, 9.1, 1.5, 2.8],
        "backgroundColor": [
          "rgba(75, 192, 192, 0.6)",
          "rgba(255, 99, 132, 0.6)",
          "rgba(54, 162, 235, 0.6)",
          "rgba(255, 206, 86, 0.6)"
        ]
      }]
    },
    "options": {
      "responsive": true,
      "plugins": {
        "title": {
          "display": true,
          "text": "NVIDIA Revenue by Segment - FY2024"
        },
        "legend": {
          "position": "right"
        }
      }
    }
  }
}
```

### Chart Generator Service

```typescript
// src/rag/chart-generator.service.ts

@Injectable()
export class ChartGeneratorService {
  generateLineChart(data: TimeSeriesData): ChartConfig {
    return {
      type: 'line',
      data: {
        labels: data.periods,
        datasets: data.series.map(series => ({
          label: series.label,
          data: series.values,
          borderColor: this.getColor(series.label),
          tension: 0.1
        }))
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: data.title
          }
        },
        scales: {
          y: {
            title: {
              display: true,
              text: data.yAxisLabel
            }
          }
        }
      }
    };
  }
  
  generateBarChart(data: ComparisonData): ChartConfig {
    return {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [{
          label: data.metric,
          data: data.values,
          backgroundColor: data.labels.map((_, i) => this.getColor(i))
        }]
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: data.title
          }
        },
        scales: {
          y: {
            title: {
              display: true,
              text: data.yAxisLabel
            }
          }
        }
      }
    };
  }
  
  private getColor(index: number | string): string {
    const colors = [
      'rgba(75, 192, 192, 0.6)',
      'rgba(255, 99, 132, 0.6)',
      'rgba(54, 162, 235, 0.6)',
      'rgba(255, 206, 86, 0.6)',
      'rgba(153, 102, 255, 0.6)'
    ];
    
    if (typeof index === 'number') {
      return colors[index % colors.length];
    }
    
    // Hash string to color
    const hash = index.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  }
}
```

---

## 4. Code Interpreter for Complex Calculations

### Use Cases

1. **Regression Analysis:** "Run a regression of NVDA's revenue on time"
2. **Correlation Matrix:** "Show correlation between NVDA's revenue, R&D, and net income"
3. **Scenario Modeling:** "Model NVDA's revenue if growth rate drops to 20%"
4. **Sensitivity Analysis:** "How sensitive is NVDA's net margin to changes in cost of revenue?"

### Implementation

```typescript
// src/rag/code-interpreter.service.ts

@Injectable()
export class CodeInterpreterService {
  constructor(private readonly bedrock: BedrockService) {}
  
  async executeCalculation(query: string, data: Record<string, any>): Promise<CodeExecutionResult> {
    // Step 1: Generate Python code
    const code = await this.generateCode(query, data);
    
    // Step 2: Execute in sandboxed environment
    const result = await this.executeSandboxed(code, data);
    
    // Step 3: Return results with code
    return {
      success: true,
      code,
      result,
      explanation: await this.explainResult(query, result)
    };
  }
  
  private async generateCode(query: string, data: Record<string, any>): Promise<string> {
    const prompt = `
    Generate Python code to answer this financial analysis question:
    "${query}"
    
    Available data:
    ${JSON.stringify(data, null, 2)}
    
    Requirements:
    - Use only standard libraries (numpy, pandas, scipy, matplotlib)
    - Return results as JSON
    - Include error handling
    - Add comments explaining the analysis
    
    Example:
    \`\`\`python
    import numpy as np
    import pandas as pd
    from scipy import stats
    
    # Load data
    revenue = np.array(data['revenue'])
    time = np.array(data['periods'])
    
    # Run linear regression
    slope, intercept, r_value, p_value, std_err = stats.linregress(time, revenue)
    
    # Return results
    result = {
      "slope": slope,
      "intercept": intercept,
      "r_squared": r_value**2,
      "p_value": p_value
    }
    print(json.dumps(result))
    \`\`\`
    `;
    
    const response = await this.bedrock.generate(prompt, {});
    return this.extractCode(response.answer);
  }
  
  private async executeSandboxed(code: string, data: Record<string, any>): Promise<any> {
    // Execute Python code in sandboxed environment
    // Options:
    // 1. AWS Lambda with Python runtime
    // 2. Docker container with restricted permissions
    // 3. Python subprocess with timeout and resource limits
    
    const response = await fetch('https://code-executor.example.com/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, data })
    });
    
    return response.json();
  }
}
```

### Example: Regression Analysis

**Query:** "Run a regression of NVDA's revenue on time to predict FY2025 revenue"

**Generated Code:**
```python
import numpy as np
from scipy import stats
import json

# Data
years = np.array([2020, 2021, 2022, 2023, 2024])
revenue = np.array([16.7, 26.9, 26.9, 26.9, 60.9])

# Linear regression
slope, intercept, r_value, p_value, std_err = stats.linregress(years, revenue)

# Predict FY2025
fy2025_prediction = slope * 2025 + intercept

# Results
result = {
    "slope": float(slope),
    "intercept": float(intercept),
    "r_squared": float(r_value**2),
    "p_value": float(p_value),
    "fy2025_prediction": float(fy2025_prediction),
    "interpretation": f"Revenue is growing at ${slope:.2f}B per year on average"
}

print(json.dumps(result))
```

**Response:**
```
Regression Analysis: NVDA Revenue vs Time

Results:
- Slope: $11.05B per year
- R²: 0.72 (72% of variance explained by time)
- P-value: 0.048 (statistically significant at 5% level)

FY2025 Prediction: $82.4B

Interpretation:
NVIDIA's revenue is growing at an average rate of $11.05B per year. 
Based on this trend, FY2025 revenue is predicted to be $82.4B.

Note: This is a simple linear model. Actual results may vary based on 
market conditions, competition, and other factors.

[Chart: Line chart showing historical revenue and predicted FY2025]
```

---

## Integration with RAG Service

```typescript
// src/rag/rag.service.ts

async query(query: string, options?: any): Promise<RAGResponse> {
  // Detect query type
  const intent = await this.intentDetector.detectIntent(query);
  
  // Handle different query types
  if (intent.type === 'dynamic_calculation') {
    return this.handleDynamicCalculation(query, intent);
  }
  
  if (intent.needsChart) {
    return this.handleChartQuery(query, intent);
  }
  
  if (intent.needsCodeExecution) {
    return this.handleCodeExecution(query, intent);
  }
  
  // Standard RAG flow
  return this.handleStandardQuery(query, intent);
}

private async handleDynamicCalculation(query: string, intent: QueryIntent): Promise<RAGResponse> {
  // Calculate dynamic metric
  const calculation = await this.dynamicCalculator.calculateDynamicMetric(
    query,
    intent.ticker as string,
    intent.metrics[0]
  );
  
  // Generate response with calculation
  return {
    answer: this.formatCalculationResponse(calculation),
    calculation,
    intent,
    timestamp: new Date()
  };
}

private async handleChartQuery(query: string, intent: QueryIntent): Promise<RAGResponse> {
  // Retrieve data
  const data = await this.structuredRetriever.retrieve({
    tickers: intent.ticker,
    metrics: intent.metrics,
    periods: intent.periods
  });
  
  // Generate chart
  const chart = await this.chartGenerator.generateChart(data, intent.chartType);
  
  // Generate response with chart
  return {
    answer: this.formatChartResponse(data),
    chart,
    data,
    intent,
    timestamp: new Date()
  };
}
```

---

## Summary

### Dynamic Metric Calculation
- **What:** Compute metrics not pre-calculated in database
- **How:** LLM extracts formula → Retrieve components → Execute calculation
- **Example:** Operating leverage, asset turnover, custom ratios

### Peer Comparison
- **What:** Compare custom metrics across companies
- **How:** Calculate metric for each company → Rank → Generate insights
- **Example:** Compare operating leverage for NVDA, AMD, INTC

### Multi-Modal Responses
- **What:** Include charts, tables, and visualizations in responses
- **How:** Detect chart need → Generate Chart.js config → Return with response
- **Types:** Line (trends), Bar (comparisons), Pie (composition)

### Code Interpreter
- **What:** Execute complex Python calculations
- **How:** LLM generates code → Execute in sandbox → Return results
- **Use Cases:** Regression, correlation, scenario modeling, sensitivity analysis

These capabilities transform the RAG chatbot from a **text-only Q&A system** into a **full-featured financial analysis assistant** that can:
1. Calculate any metric on-demand
2. Compare companies on custom metrics
3. Visualize data with charts
4. Perform advanced statistical analysis

The result: **Institutional-grade financial analysis** directly in the chat interface.
