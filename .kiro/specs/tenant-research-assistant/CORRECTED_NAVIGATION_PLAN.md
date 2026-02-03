# Corrected Navigation Plan

## Understanding

The user wants:
1. **Single page**: `comprehensive-financial-analysis.html` 
2. **Navigation tabs/buttons** for:
   - Financial Analysis (current view - quantitative/qualitative/export tabs)
   - Research Assistant (modal/panel - chat for this deal's company + cross-company)
   - Scratchpad (modal/panel - saved insights)
   - IC Memo (modal/panel - generate memo from scratchpad)
3. **All within deal context**: Everything relates to the current ticker (e.g., AAPL)
4. **Working links**: Actually functional, not just placeholders

## Implementation Approach

### Option 1: Modal-Based (Recommended)
Add navigation buttons that open modals/side panels:
- Click "Research Assistant" → Opens chat modal (can ask about AAPL or cross-company)
- Click "Scratchpad" → Opens scratchpad side panel
- Click "IC Memo" → Opens memo generation modal

### Option 2: Tab-Based
Add to existing tab navigation:
- Quantitative | Qualitative | Export | Research | Scratchpad | IC Memo

### Option 3: Hybrid
Keep existing tabs, add floating action buttons for Research/Scratchpad/Memo

## Recommended: Modal-Based Implementation

```
┌─────────────────────────────────────────────────────────┐
│ Comprehensive Financial Analysis - AAPL                 │
│ [Research] [Scratchpad (3)] [IC Memo]          [Help]  │
├─────────────────────────────────────────────────────────┤
│ [Quantitative] [Qualitative] [Export]                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Financial metrics and analysis...                      │
│                                                          │
└─────────────────────────────────────────────────────────┘

Click "Research" →

┌─────────────────────────────────────────────────────────┐
│ Research Assistant - AAPL Context              [×]      │
├─────────────────────────────────────────────────────────┤
│ Ask questions about AAPL or compare with other companies│
│                                                          │
│ User: What are AAPL's key risks?                        │
│ AI: Based on the 10-K...                                │
│                                                          │
│ [Type your question...]                    [Send]       │
└─────────────────────────────────────────────────────────┘
```

This keeps everything on one page, maintains context, and provides a cohesive experience.

