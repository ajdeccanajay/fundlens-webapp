# Demo Preparation: Hedge Fund Research Analyst
**Date:** February 6, 2026, 10:00 AM  
**Audience:** Hedge Fund Research Analyst  
**Focus:** Value investing, deep fundamental analysis, competitive intelligence

---

## 🎯 5 Demo Questions (Show These Live)

These questions showcase the platform's ability to handle sophisticated equity research workflows that hedge fund analysts perform daily.

### 1. **Deep Dive on Capital Efficiency**
```
Compare NVDA and AMD's return on invested capital and free cash flow conversion. 
Which company is more capital efficient and why?
```
**Why this resonates:** Hedge funds obsess over capital efficiency. This shows multi-company comparison, calculated metrics (ROIC, FCF conversion), and qualitative reasoning—all in one query.

### 2. **Competitive Positioning Analysis**
```
What are NVDA's key competitive advantages in the data center GPU market? 
How sustainable are these advantages given AMD's recent product launches?
```
**Why this resonates:** Shows the platform can extract strategic insights from 10-K narratives, understand competitive dynamics, and synthesize information across multiple filings. This is classic fundamental research.

### 3. **Risk Assessment for Thesis Development**
```
What are the top 3 operational and financial risks facing NVDA? 
How have these risks evolved over the past 2 years?
```
**Why this resonates:** Risk analysis is critical for hedge funds. This demonstrates temporal analysis, risk factor extraction, and trend identification—key for building investment theses.

### 4. **Margin Quality and Sustainability**
```
Analyze NVDA's gross margin trends over the last 3 years. 
What's driving the changes and are they sustainable?
```
**Why this resonates:** Margin analysis is fundamental to value investing. Shows the platform can extract metrics, identify trends, and connect quantitative data with qualitative MD&A explanations.

### 5. **Forward-Looking Catalyst Identification**
```
What growth catalysts and headwinds did NVDA's management discuss in their latest 10-K? 
How do these compare to analyst expectations?
```
**Why this resonates:** Hedge funds need to identify catalysts before the market does. This shows the platform can extract forward-looking statements, management guidance, and strategic priorities—alpha-generating insights.

---

## 📋 Pre-Demo Testing Checklist (Tonight, Before 10 AM)

### Testing Window: 8:00 PM - 11:00 PM (Feb 5)
**Goal:** Validate 5-10 queries on localhost, fix any critical issues

### Test Environment Setup
```bash
# 1. Start localhost environment
npm run dev

# 2. Verify database connection
npm run check:db

# 3. Check data availability for demo tickers
# Ensure NVDA, AMD, AAPL, MSFT, AMZN have recent 10-K data
```

---

## 🧪 Extended Test Query Suite (5-10 Questions)

Test these queries in order. Document any failures or slow responses.

### **Core 5 Demo Questions** (MUST WORK)
1. ✅ Compare NVDA and AMD's return on invested capital and free cash flow conversion. Which company is more capital efficient and why?
2. ✅ What are NVDA's key competitive advantages in the data center GPU market? How sustainable are these advantages given AMD's recent product launches?
3. ✅ What are the top 3 operational and financial risks facing NVDA? How have these risks evolved over the past 2 years?
4. ✅ Analyze NVDA's gross margin trends over the last 3 years. What's driving the changes and are they sustainable?
5. ✅ What growth catalysts and headwinds did NVDA's management discuss in their latest 10-K? How do these compare to analyst expectations?

### **Backup Questions** (Test if time permits)
6. ✅ Compare AAPL and MSFT's revenue growth and operating leverage over the past 3 years
7. ✅ What is AMZN's AWS revenue and margin trajectory? How does it compare to their retail business?
8. ✅ Analyze NVDA's R&D spending as a percentage of revenue. Is this sustainable given their growth rate?
9. ✅ What are the key differences in NVDA and AMD's business models and go-to-market strategies?
10. ✅ Show me NVDA's debt maturity schedule and interest coverage ratio. Is their balance sheet healthy?

---

## 🔍 What to Check During Testing

### 1. **Response Quality**
- [ ] Answers are accurate and cite specific 10-K sections
- [ ] Quantitative data matches actual filings
- [ ] Qualitative insights are relevant and insightful
- [ ] Citations are provided with section references

### 2. **Response Speed**
- [ ] Queries return in < 5 seconds (acceptable for demo)
- [ ] No timeout errors
- [ ] Streaming responses work smoothly

### 3. **Error Handling**
- [ ] Ambiguous queries trigger clarification prompts (if applicable)
- [ ] Missing data is handled gracefully
- [ ] No 500 errors or crashes

### 4. **UX Polish**
- [ ] Citations render correctly
- [ ] Formatting is clean and professional
- [ ] No UI glitches or broken layouts
- [ ] Dark mode works (if applicable)

---

## 🚨 Critical Issues to Fix Tonight

If you encounter these issues, fix them before the demo:

### **P0 - Demo Blockers**
- Query returns no data or errors out
- Response is factually incorrect
- UI is broken or unreadable
- Citations don't work

### **P1 - Demo Degraders**
- Response is slow (> 10 seconds)
- Formatting is messy
- Missing key insights that should be obvious

### **P2 - Nice to Have**
- Minor formatting improvements
- Additional context in responses
- Better citation formatting

---

## 🎬 Demo Flow Recommendation

### Opening (2 minutes)
"FundLens is an AI-powered research platform built specifically for equity analysts. It ingests SEC filings and lets you ask sophisticated questions in natural language—the same questions you'd spend hours researching manually."

### Live Demo (10 minutes)
**Show the 5 core questions in this order:**

1. **Start with capital efficiency** (Question 1)
   - Shows multi-company comparison
   - Demonstrates calculated metrics
   - Highlights qualitative reasoning

2. **Move to competitive analysis** (Question 2)
   - Shows strategic insight extraction
   - Demonstrates cross-filing synthesis
   - Highlights narrative understanding

3. **Show risk assessment** (Question 3)
   - Shows temporal analysis
   - Demonstrates risk factor extraction
   - Highlights trend identification

4. **Demonstrate margin analysis** (Question 4)
   - Shows metric extraction + trends
   - Demonstrates quant + qual integration
   - Highlights sustainability analysis

5. **Finish with catalysts** (Question 5)
   - Shows forward-looking extraction
   - Demonstrates management guidance parsing
   - Highlights alpha-generating insights

### Closing (3 minutes)
"This is just the beginning. We're building features for cross-company analysis, custom metrics, and automated report generation. What would be most valuable for your research workflow?"

---

## 📊 Success Metrics for Demo

### Must Achieve
- [ ] All 5 core questions work flawlessly
- [ ] Responses are accurate and insightful
- [ ] Demo completes in 15 minutes
- [ ] Client asks follow-up questions (engagement signal)

### Bonus Points
- [ ] Client tests their own queries
- [ ] Client asks about pricing/timeline
- [ ] Client mentions specific use cases
- [ ] Client wants to schedule follow-up

---

## 🛠️ Quick Fixes Reference

### If a query fails:
1. Check if ticker data exists in database
2. Verify 10-K filing is ingested
3. Test with a simpler version of the query
4. Have a backup question ready

### If response is slow:
1. Check database connection
2. Verify Bedrock API is responding
3. Consider pre-caching common queries
4. Have a "this is a complex query" explanation ready

### If formatting is broken:
1. Check citation rendering
2. Verify markdown parsing
3. Test in different browser
4. Have screenshots of working version as backup

---

## 📝 Testing Log Template

Use this to track your testing tonight:

```
Query #1: [Question text]
Status: ✅ Pass / ❌ Fail / ⚠️ Needs Fix
Response Time: [X seconds]
Issues: [Any problems noted]
Fix Applied: [What you did to fix it]

Query #2: [Question text]
...
```

---

## 🎯 Final Pre-Demo Checklist (Tomorrow Morning, 9:00 AM)

- [ ] Restart localhost environment
- [ ] Test all 5 core questions one final time
- [ ] Clear browser cache
- [ ] Close unnecessary tabs/applications
- [ ] Have backup questions ready
- [ ] Have TESTING_URLS_GUIDE.md open for reference
- [ ] Charge laptop fully
- [ ] Test screen sharing setup
- [ ] Have water nearby (stay hydrated!)

---

## 💡 Pro Tips for the Demo

1. **Start with context:** "Let me show you how a hedge fund analyst would use this..."
2. **Narrate as you type:** "I'm asking about capital efficiency because..."
3. **Highlight citations:** "Notice how it's pulling from the actual 10-K..."
4. **Show, don't tell:** Let the platform speak for itself
5. **Invite interaction:** "What would you want to ask about NVDA?"
6. **Be honest about limitations:** "We're still building X feature..."
7. **Focus on value:** "This query would normally take 2 hours of manual research..."

---

## 🚀 You've Got This!

The platform is solid. The questions are killer. The audience is perfect. Just test thoroughly tonight, fix any critical issues, and let the platform shine tomorrow.

**Remember:** Hedge fund analysts care about:
- **Accuracy** (data must be correct)
- **Speed** (time is money)
- **Depth** (surface-level insights aren't enough)
- **Actionability** (insights must inform investment decisions)

Your platform delivers all four. Show them that tomorrow.

Good luck! 🎉
