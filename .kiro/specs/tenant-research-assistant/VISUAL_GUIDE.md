# Visual Guide - Research Tools Integration

**Date**: January 26, 2026

---

## Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  📊 Comprehensive Financial Analysis - AAPL                     │
│                                                                  │
│  [🧠 Research] [📑 Scratchpad (3)] [📄 IC Memo]  [AAPL] [Load] │
└─────────────────────────────────────────────────────────────────┘
│                                                                  │
│  [Quantitative] [Qualitative] [Export]                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Financial Performance Metrics                          │    │
│  │  • Revenue: $394.3B                                     │    │
│  │  • Net Income: $97.0B                                   │    │
│  │  • Operating Margin: 30.1%                              │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Research Assistant Modal

### When Opened (Click "Research Assistant" button)

```
┌─────────────────────────────────────────────────────────────────┐
│ ████████████████████████████████████████████████████████████████│
│ ██                                                          ██  │
│ ██  ┌────────────────────────────────────────────────┐     ██  │
│ ██  │ 🧠 Research Assistant                      [×] │     ██  │
│ ██  │ Ask questions about AAPL or compare companies │     ██  │
│ ██  ├────────────────────────────────────────────────┤     ██  │
│ ██  │                                                │     ██  │
│ ██  │  Welcome to Research Assistant                 │     ██  │
│ ██  │                                                │     ██  │
│ ██  │  ┌──────────────┐  ┌──────────────┐          │     ██  │
│ ██  │  │ 📊 Compare   │  │ ⚠️  Risk     │          │     ██  │
│ ██  │  │   Companies  │  │   Analysis   │          │     ██  │
│ ██  │  └──────────────┘  └──────────────┘          │     ██  │
│ ██  │                                                │     ██  │
│ ██  ├────────────────────────────────────────────────┤     ██  │
│ ██  │ [Type your question...]              [Send]   │     ██  │
│ ██  └────────────────────────────────────────────────┘     ██  │
│ ██                                                          ██  │
│ ████████████████████████████████████████████████████████████████│
└─────────────────────────────────────────────────────────────────┘
```

### After Sending Message

```
┌─────────────────────────────────────────────────────────────────┐
│ ████████████████████████████████████████████████████████████████│
│ ██                                                          ██  │
│ ██  ┌────────────────────────────────────────────────┐     ██  │
│ ██  │ 🧠 Research Assistant                      [×] │     ██  │
│ ██  ├────────────────────────────────────────────────┤     ██  │
│ ██  │                                                │     ██  │
│ ██  │                  ┌──────────────────────────┐ │     ██  │
│ ██  │                  │ What are the key risks   │ │     ██  │
│ ██  │                  │ for AAPL?                │ │     ██  │
│ ██  │                  └──────────────────────────┘ │     ██  │
│ ██  │                                                │     ██  │
│ ██  │  ┌──────────────────────────────────────────┐ │     ██  │
│ ██  │  │ Based on the 10-K filing, key risks:    │ │     ██  │
│ ██  │  │                                          │ │     ██  │
│ ██  │  │ 1. Supply chain dependencies...         │ │     ██  │
│ ██  │  │ 2. Regulatory challenges...             │ │     ██  │
│ ██  │  │ 3. Competition in smartphone market...  │ │     ██  │
│ ██  │  │                                          │ │     ██  │
│ ██  │  │ [📑 Save to Scratchpad]                 │ │     ██  │
│ ██  │  │                                          │ │     ██  │
│ ██  │  │ Sources: AAPL 10-K 2024                 │ │     ██  │
│ ██  │  └──────────────────────────────────────────┘ │     ██  │
│ ██  │                                                │     ██  │
│ ██  ├────────────────────────────────────────────────┤     ██  │
│ ██  │ [Type your question...]              [Send]   │     ██  │
│ ██  └────────────────────────────────────────────────┘     ██  │
│ ██                                                          ██  │
│ ████████████████████████████████████████████████████████████████│
└─────────────────────────────────────────────────────────────────┘
```

---

## Scratchpad Side Panel

### When Opened (Click "Scratchpad" button)

```
┌──────────────────────────────────┬─────────────────────────────┐
│                                  │ 📑 Research Scratchpad  [×] │
│  Main Page Content               │                             │
│                                  │ [📥 Export to Markdown]     │
│  Financial metrics...            │                             │
│                                  │ ┌─────────────────────────┐ │
│  Charts and tables...            │ │ Based on the 10-K...    │ │
│                                  │ │                         │ │
│                                  │ │ 1. Supply chain...      │ │
│                                  │ │ 2. Regulatory...        │ │
│                                  │ │                         │ │
│                                  │ │ 📝 Your notes:          │ │
│                                  │ │ Important for Q4        │ │
│                                  │ │                         │ │
│                                  │ │ Just now          [🗑️]  │ │
│                                  │ └─────────────────────────┘ │
│                                  │                             │
│                                  │ ┌─────────────────────────┐ │
│                                  │ │ Revenue grew 15%...     │ │
│                                  │ │                         │ │
│                                  │ │ 2m ago            [🗑️]  │ │
│                                  │ └─────────────────────────┘ │
│                                  │                             │
└──────────────────────────────────┴─────────────────────────────┘
```

---

## IC Memo Generator Modal

### Initial State

```
┌─────────────────────────────────────────────────────────────────┐
│ ████████████████████████████████████████████████████████████████│
│ ██                                                          ██  │
│ ██  ┌────────────────────────────────────────────────┐     ██  │
│ ██  │ 📄 IC Memo Generator                       [×] │     ██  │
│ ██  │ Generate Investment Committee memo for AAPL    │     ██  │
│ ██  ├────────────────────────────────────────────────┤     ██  │
│ ██  │                                                │     ██  │
│ ██  │              📄                                │     ██  │
│ ██  │                                                │     ██  │
│ ██  │      Generate IC Memo                          │     ██  │
│ ██  │                                                │     ██  │
│ ██  │  Create a comprehensive Investment Committee  │     ██  │
│ ██  │  memo using your scratchpad notes and          │     ██  │
│ ██  │  financial analysis                            │     ██  │
│ ██  │                                                │     ██  │
│ ██  │  Memo will include:                            │     ██  │
│ ██  │  ✓ Executive Summary                           │     ██  │
│ ██  │  ✓ Financial Performance Metrics               │     ██  │
│ ██  │  ✓ Qualitative Analysis                        │     ██  │
│ ██  │  ✓ Your Research Notes                         │     ██  │
│ ██  │  ✓ Investment Recommendation                   │     ██  │
│ ██  │                                                │     ██  │
│ ██  │         [✨ Generate IC Memo]                  │     ██  │
│ ██  │                                                │     ██  │
│ ██  └────────────────────────────────────────────────┘     ██  │
│ ██                                                          ██  │
│ ████████████████████████████████████████████████████████████████│
└─────────────────────────────────────────────────────────────────┘
```

### After Generation

```
┌─────────────────────────────────────────────────────────────────┐
│ ████████████████████████████████████████████████████████████████│
│ ██                                                          ██  │
│ ██  ┌────────────────────────────────────────────────┐     ██  │
│ ██  │ 📄 IC Memo Generator                       [×] │     ██  │
│ ██  ├────────────────────────────────────────────────┤     ██  │
│ ██  │                                                │     ██  │
│ ██  │  # Investment Committee Memo: AAPL             │     ██  │
│ ██  │  **Date:** January 26, 2026                    │     ██  │
│ ██  │                                                │     ██  │
│ ██  │  ## Executive Summary                          │     ██  │
│ ██  │  This memo presents an analysis of AAPL...     │     ██  │
│ ██  │                                                │     ██  │
│ ██  │  ## Financial Highlights                       │     ██  │
│ ██  │  - TTM Revenue: $394.3B                        │     ██  │
│ ██  │  - TTM Net Income: $97.0B                      │     ██  │
│ ██  │  - Net Margin: 24.6%                           │     ██  │
│ ██  │                                                │     ██  │
│ ██  │  ## Research Notes                             │     ██  │
│ ██  │  ### Note 1                                    │     ██  │
│ ██  │  Based on the 10-K filing, key risks...        │     ██  │
│ ██  │                                                │     ██  │
│ ██  ├────────────────────────────────────────────────┤     ██  │
│ ██  │  [📥 Download as PDF]  [🔄 Generate New]      │     ██  │
│ ██  └────────────────────────────────────────────────┘     ██  │
│ ██                                                          ██  │
│ ████████████████████████████████████████████████████████████████│
└─────────────────────────────────────────────────────────────────┘
```

---

## Save to Scratchpad Modal

```
┌─────────────────────────────────────────────────────────────────┐
│ ████████████████████████████████████████████████████████████████│
│ ██                                                          ██  │
│ ██           ┌──────────────────────────────┐              ██  │
│ ██           │ Save to Scratchpad           │              ██  │
│ ██           ├──────────────────────────────┤              ██  │
│ ██           │                              │              ██  │
│ ██           │ Add your notes (optional)    │              ██  │
│ ██           │                              │              ██  │
│ ██           │ ┌──────────────────────────┐ │              ██  │
│ ██           │ │ Add context, thoughts,   │ │              ██  │
│ ██           │ │ or follow-up questions...│ │              ██  │
│ ██           │ │                          │ │              ██  │
│ ██           │ │                          │ │              ██  │
│ ██           │ └──────────────────────────┘ │              ██  │
│ ██           │                              │              ██  │
│ ██           │  [Save]        [Cancel]      │              ██  │
│ ██           │                              │              ██  │
│ ██           └──────────────────────────────┘              ██  │
│ ██                                                          ██  │
│ ████████████████████████████████████████████████████████████████│
└─────────────────────────────────────────────────────────────────┘
```

---

## User Flow Diagram

```
┌─────────────────┐
│  User loads     │
│  page with      │
│  ticker: AAPL   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Financial      │
│  metrics load   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  User clicks    │
│  "Research      │
│  Assistant"     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Modal opens    │
│  with chat UI   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  User types     │
│  question       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AI streams     │
│  response       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  User clicks    │
│  "Save to       │
│  Scratchpad"    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Save modal     │
│  opens          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  User adds      │
│  notes & saves  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Item saved     │
│  Badge updates  │
│  to "1"         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  User clicks    │
│  "Scratchpad"   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Panel slides   │
│  in from right  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  User sees      │
│  saved item     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  User clicks    │
│  "IC Memo"      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Modal opens    │
│  with generator │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  User clicks    │
│  "Generate"     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Memo generates │
│  with all data  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  User downloads │
│  memo as .md    │
└─────────────────┘
```

---

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     Frontend (Alpine.js)                     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Research    │  │  Scratchpad  │  │  IC Memo     │     │
│  │  Assistant   │  │  Panel       │  │  Generator   │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                  │                  │              │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          │ POST /research/  │ GET /research/   │ POST /deals/
          │ conversations    │ notebooks        │ document-gen
          │                  │                  │
          ▼                  ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│                     Backend API (NestJS)                     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Research    │  │  Notebook    │  │  Document    │     │
│  │  Service     │  │  Service     │  │  Generation  │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                  │                  │              │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│                     Database (PostgreSQL)                    │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Conversations│  │  Notebooks   │  │  Insights    │     │
│  │  Messages    │  │  Insights    │  │  Messages    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Component State Diagram

```
Research Assistant Modal
┌─────────────────────────────────────┐
│ State: showResearchModal            │
│ ├─ false: Hidden                    │
│ └─ true: Visible                    │
│                                     │
│ State: researchMessages             │
│ ├─ []: Empty (welcome screen)       │
│ └─ [...]: Has messages (chat view)  │
│                                     │
│ State: researchTyping               │
│ ├─ false: Can send                  │
│ └─ true: Waiting for response       │
└─────────────────────────────────────┘

Scratchpad Panel
┌─────────────────────────────────────┐
│ State: showScratchpad               │
│ ├─ false: Hidden                    │
│ └─ true: Visible                    │
│                                     │
│ State: scratchpadItems              │
│ ├─ []: Empty (empty state)          │
│ └─ [...]: Has items (list view)     │
│                                     │
│ State: scratchpadCount              │
│ └─ Number: Badge count              │
└─────────────────────────────────────┘

IC Memo Modal
┌─────────────────────────────────────┐
│ State: showICMemo                   │
│ ├─ false: Hidden                    │
│ └─ true: Visible                    │
│                                     │
│ State: icMemoGenerated              │
│ ├─ false: Generator screen          │
│ └─ true: Memo preview               │
│                                     │
│ State: icMemoGenerating             │
│ ├─ false: Ready                     │
│ └─ true: Generating (spinner)       │
└─────────────────────────────────────┘
```

---

## Animation Timeline

```
Research Assistant Modal Open
0ms   ─────────────────────────────────────────────
      │ User clicks button
      │
50ms  │ ▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
      │ Overlay starts fading in
      │
100ms │ ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
      │ Modal starts scaling up
      │
150ms │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░
      │ Overlay fully visible
      │
200ms │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
      │ Modal fully visible
      │ Animation complete
      └─────────────────────────────────────────────

Scratchpad Panel Slide In
0ms   ─────────────────────────────────────────────
      │ User clicks button
      │
50ms  │                                    ░░░░░░░
      │ Panel starts sliding in
      │
100ms │                              ░░░░░░░░░░░░░
      │ Panel halfway visible
      │
150ms │                        ░░░░░░░░░░░░░░░░░░░
      │ Panel almost visible
      │
200ms │                  ░░░░░░░░░░░░░░░░░░░░░░░░░
      │ Panel fully visible
      │ Animation complete
      └─────────────────────────────────────────────

Typing Indicator
0ms   ─────────────────────────────────────────────
      │ ●○○  (dot 1 pulses)
      │
200ms │ ○●○  (dot 2 pulses)
      │
400ms │ ○○●  (dot 3 pulses)
      │
600ms │ ●○○  (repeat)
      │
      └─────────────────────────────────────────────
```

---

## Responsive Breakpoints

```
Desktop (1280px+)
┌─────────────────────────────────────────────────────────────┐
│  [Research] [Scratchpad (3)] [IC Memo]  [AAPL ▼] [Load]    │
│                                                              │
│  Full width modals (max-width: 1024px)                      │
│  Scratchpad panel: 396px                                    │
└─────────────────────────────────────────────────────────────┘

Tablet (768px - 1279px)
┌──────────────────────────────────────────────────┐
│  [🧠] [📑 (3)] [📄]  [AAPL ▼] [Load]            │
│                                                   │
│  Modals: 90% width                                │
│  Scratchpad: 320px                                │
└──────────────────────────────────────────────────┘

Mobile (< 768px)
┌────────────────────────────────┐
│  [🧠] [📑] [📄]  [AAPL] [Load] │
│                                 │
│  Modals: Full screen            │
│  Scratchpad: Full screen        │
└────────────────────────────────┘
```

---

## Color Scheme

```
Primary Colors:
┌────────┬────────┬────────┬────────┐
│ Indigo │ Purple │ Green  │ Gray   │
│ #6366f1│ #8b5cf6│ #10b981│ #6b7280│
└────────┴────────┴────────┴────────┘

Research Assistant:
- User messages: Purple gradient (#667eea → #764ba2)
- Assistant messages: White with gray border
- Typing indicator: Gray (#9ca3af)

Scratchpad:
- Panel background: White
- Items: Light gray (#f9fafb)
- Badge: Red (#ef4444)

IC Memo:
- Generate button: Green gradient (#10b981 → #14b8a6)
- Preview: White with prose styling
```

---

**This visual guide helps understand the layout and flow of the integrated research tools.**
