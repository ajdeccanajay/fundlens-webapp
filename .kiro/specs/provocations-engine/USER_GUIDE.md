# Provocations Engine - User Guide

## Overview

The Provocations Engine is an adversarial research tool that helps you stress-test investment theses by surfacing risks, contradictions, and inconvenient truths hidden in SEC filings. It provides two analysis modes:

1. **Provocations Mode**: Adversarial analysis that challenges your investment thesis
2. **Sentiment Mode**: Tracks management tone and confidence shifts over time

## Getting Started

### Accessing Provocations Mode

1. **Navigate to a company workspace** (e.g., AAPL, MSFT)
2. **Open the Research Assistant** in the workspace
3. **Toggle Provocations Mode** using the mode selector
4. **Visual indicator**: The Research Assistant border will change color when Provocations Mode is active

### Using Preset Questions

When you activate Provocations Mode, you'll see **4-6 preset question chips** based on available data:

**Cross-Filing Language Analysis**:
- "What risk factors were added, removed, or materially changed between the last two 10-Ks?"
- "How has management's tone in the MD&A section shifted over the last 4 quarters?"
- "What accounting policy changes occurred between filings?"

**Management Credibility**:
- "Compare management's forward-looking statements from prior filings against actual results"
- "Has management quietly walked back prior guidance?"
- "Track management's historical accuracy in guidance"

**Financial Red Flags**:
- "Identify contradictions between segment performance and consolidated narrative"
- "Compare stated capital allocation strategy against actual capex commitments"
- "Detect defensive language increases in risk disclosures"

**Thesis Stress Testing**:
- "What are the strongest arguments against this investment thesis?"
- "What material risks is the market potentially underpricing?"

Simply **click a preset question chip** to execute that analysis.

### Understanding Provocation Structure

Each provocation includes:

1. **Title**: Brief summary of the finding
2. **Severity Badge**: 
   - 🔴 **RED FLAG**: Material risks that could significantly impact investment thesis
   - 🟠 **AMBER**: Noteworthy patterns requiring monitoring
   - 🟢 **GREEN CHALLENGE**: Intellectually important questions that strengthen thesis if answered
3. **Observation**: What changed or what was found
4. **Filing References**: Exact citations with filing type, date, section, and text excerpts
5. **Cross-Filing Delta**: What changed between versions (if comparing multiple filings)
6. **Implication**: Why this matters for your investment thesis
7. **Challenge Question**: A question to probe deeper

### Example Provocation

```
🔴 RED FLAG: New Risk Factor Added - Supply Chain Concentration

Observation:
The 2024 10-K added a new risk factor regarding supply chain concentration 
that was not present in the 2023 10-K. The company now discloses that 60% 
of critical components come from a single supplier.

Filing References:
- 2024 10-K (Filed: 2024-10-30) - Item 1A, Risk Factors, Page 15
  "We depend on a limited number of suppliers for critical components..."
- 2023 10-K (Filed: 2023-10-28) - Item 1A, Risk Factors
  [No comparable disclosure]

Cross-Filing Delta:
New risk factor added. No prior disclosure of supplier concentration.

Implication:
This represents a material operational risk that was not previously disclosed. 
The concentration creates vulnerability to supply disruptions and pricing power 
of the supplier. The timing of disclosure (after stock price appreciation) 
raises questions about when management became aware of this risk.

Challenge Question:
Why was this risk not disclosed in prior filings? Has the concentration 
increased, or is this a change in disclosure practice?
```

## Provocations Tab

### Auto-Generation

After you submit **3 or more research queries** for a ticker, the system automatically generates a comprehensive provocations analysis and displays it in the **Provocations Tab**.

The Provocations Tab shows:
- **Top 3-5 most material provocations**
- **Severity badges** for quick prioritization
- **Challenge questions** for each finding
- **Link to activate Provocations Mode** in Research Assistant for deeper analysis

### Accessing the Provocations Tab

1. Navigate to company workspace
2. Click the **Provocations** tab (alongside Quantitative, Qualitative, Export)
3. Review auto-generated findings
4. Click "Activate Provocations Mode" to explore further

## Sentiment Mode

### Activating Sentiment Mode

1. Open Research Assistant
2. Toggle to **Sentiment Mode**
3. View sentiment-specific preset questions

### Sentiment Analysis Features

**Sentiment Scores** (-1 to +1 scale):
- **Very Negative** (-1.0 to -0.5): Highly defensive, pessimistic tone
- **Negative** (-0.5 to -0.1): Cautious, hedging language
- **Neutral** (-0.1 to +0.1): Balanced tone
- **Positive** (+0.1 to +0.5): Confident, optimistic language
- **Very Positive** (+0.5 to +1.0): Highly confident, aggressive tone

**Sentiment Deltas**:
- Tracks sentiment changes between filings
- **Material shifts** (>0.3 delta) are flagged
- Direction indicators: improving, declining, stable

**Confidence Language Tracking**:
- Monitors confidence indicators: "will", "expect", "confident"
- Tracks hedging language: "may", "could", "uncertain"
- Measures confidence level shifts (0-10 scale)

**Defensive Language Detection**:
- Identifies increased legal hedging
- Tracks blame attribution patterns
- Measures defensive score (0-10 scale)

### Sentiment Preset Questions

- "How has management sentiment in MD&A changed over the last 4 quarters?"
- "Has management confidence language strengthened or weakened?"
- "Is management using more defensive or hedging language?"
- "Track commitment language strength across filings"

## Saving to Scratchpad

### How to Save Provocations

1. View a provocation in Research Assistant
2. Click **"Save to Scratchpad"** button
3. The complete provocation structure is saved, including:
   - Severity classification
   - Observation and filing references
   - Implication and challenge question
   - Original formatting

### Organizing Scratchpad Items

- Organize by ticker
- Organize by category (risk escalation, management credibility, etc.)
- Organize by severity
- Use saved provocations in investment memos

## Severity Classifications

### RED FLAG 🔴

**When to expect RED FLAGS**:
- Material risks that could significantly impact investment thesis
- New risk factors that weren't previously disclosed
- Contradictions between management statements and results
- Accounting policy changes that reduce transparency
- Material guidance walk-backs without explanation

**Example RED FLAGS**:
- "New risk factor added regarding customer concentration"
- "Management guidance missed by >20% with no prior warning"
- "Accounting policy change reduces revenue recognition transparency"

### AMBER 🟠

**When to expect AMBER**:
- Noteworthy patterns requiring monitoring
- Moderate tone shifts in management language
- Minor contradictions or inconsistencies
- Increased defensive language
- Risk factor rewording that changes emphasis

**Example AMBER**:
- "Management tone shifted from confident to cautious in MD&A"
- "Defensive language increased by 30% in risk disclosures"
- "Segment performance narrative doesn't fully align with reported numbers"

### GREEN CHALLENGE 🟢

**When to expect GREEN CHALLENGE**:
- Intellectually important questions that strengthen thesis if answered
- Areas requiring deeper research
- Questions about strategic decisions
- Opportunities to validate assumptions

**Example GREEN CHALLENGE**:
- "Why did the company prioritize debt reduction over growth investments?"
- "What explains the divergence between segment margins?"
- "How sustainable is the current competitive advantage?"

## Performance Expectations

### Response Times

- **Preset questions display**: <500ms
- **Pre-computed queries**: <3 seconds
- **Custom queries (first time)**: <5 seconds (streaming response)
- **Cached queries**: <3 seconds

### Data Requirements

For optimal results, ensure:
- At least **2 filings** for diff computation
- Optimal: **3-4 filings** for trend analysis
- Filing types: 10-K, 10-Q with MD&A and Risk Factors sections

## Best Practices

### 1. Start with Preset Questions

Preset questions are optimized for common analysis patterns and return results quickly.

### 2. Review Severity Badges

Focus on RED FLAGS first, then AMBER, then GREEN CHALLENGE.

### 3. Verify Filing References

Always click through to source documents to verify provocations in context.

### 4. Use Challenge Questions

The challenge questions are designed to guide deeper research. Use them to probe further.

### 5. Save Key Findings

Save important provocations to Scratchpad for inclusion in investment memos.

### 6. Compare Across Tickers

Use Provocations Mode to compare management credibility and risk disclosure practices across competitors.

### 7. Track Sentiment Trends

Use Sentiment Mode to identify inflection points in management tone that may precede business changes.

## Troubleshooting

### "No provocations found"

**Possible reasons**:
- Insufficient filing data (need at least 2 filings)
- No material changes detected between filings
- Filing data still being processed

**Solution**: Wait for more filings to be ingested, or try a different ticker.

### "Preset questions not appearing"

**Possible reasons**:
- Insufficient data for that question category
- Filing types required for that question are not available

**Solution**: The system automatically filters preset questions based on available data. Try a different mode or wait for more data.

### Slow response times

**Possible reasons**:
- First-time query (not cached)
- Complex analysis requiring multiple filing comparisons
- High system load

**Solution**: Subsequent queries will be faster due to caching. Preset questions are optimized for speed.

## Demo Video

[Link to demo video showing complete workflow]

## Screenshots

### Provocations Mode Toggle
[Screenshot of Research Assistant with Provocations Mode active]

### Preset Question Chips
[Screenshot showing 4-6 preset question chips]

### Provocation Display
[Screenshot of a complete provocation with severity badge]

### Provocations Tab
[Screenshot of Provocations Tab showing top 3-5 findings]

### Sentiment Analysis
[Screenshot of sentiment scores and deltas]

## Support

For questions or issues:
- Contact: support@fundlens.com
- Documentation: [Link to full documentation]
- API Reference: [Link to API docs]

## Next Steps

1. **Try Provocations Mode** on a ticker you're researching
2. **Execute preset questions** to see common analysis patterns
3. **Review the Provocations Tab** after 3+ queries
4. **Save key findings** to Scratchpad
5. **Try Sentiment Mode** to track management tone shifts

Happy researching! 🔍
