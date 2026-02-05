# 🎨 Intent Analytics Dashboard - Visual Guide

## Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  🎯 Intent Analytics Dashboard                                      │
│  Monitor intent detection performance and manage failed patterns    │
│                                                                      │
│  Tenant: [ACME Corp ▼]  Period: [Last 24 Hours ▼]  [🔄 Refresh]   │
│  Last refresh: 2:45:30 PM                                           │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│ Total Queries│ Regex Success│ LLM Fallback │ Avg Confidence│ Avg Latency │  LLM Cost    │
│              │     Rate     │     Rate     │              │             │              │
│    1,250     │    82.5%     │    15.2%     │    87.0%     │   245ms     │   $0.0023    │
│ Last 24 hours│  Target: >80%│  Target: <20%│  Target: >85%│ Target: <500│ Last 24 hours│
│              │      🟢      │      🟢      │      🟢      │     🟢      │              │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Failed Query Patterns                                               │
│                                                                      │
│  [All] [Pending] [Reviewed] [Implemented] [Rejected]                │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ what are [ticker]'s main products?              12 occurrences│   │
│  │ [PENDING]                                                     │   │
│  │                                                               │   │
│  │ Example Queries:                                              │   │
│  │ • What are AAPL's main products?                              │   │
│  │ • What are MSFT's main products?                              │   │
│  │ • What are NVDA's main products?                              │   │
│  │                                                               │   │
│  │ [Mark Reviewed] [Mark Implemented] [Reject]                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ tell me about [ticker] strategy                  8 occurrences│   │
│  │ [REVIEWED]                                                    │   │
│  │                                                               │   │
│  │ Example Queries:                                              │   │
│  │ • Tell me about AAPL strategy                                 │   │
│  │ • Tell me about GOOGL strategy                                │   │
│  │                                                               │   │
│  │ 📝 Will add regex pattern in next sprint                      │   │
│  │                                                               │   │
│  │ [Mark Implemented]                                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Metric Cards - Color Coding

### 🟢 Green (Good Performance)
```
┌──────────────┐
│ Regex Success│
│     Rate     │
│    82.5%     │  ← Green text
│ Target: >80% │
│      🟢      │
└──────────────┘
```
**Meaning**: Metric meets or exceeds target

### 🟡 Yellow (Acceptable)
```
┌──────────────┐
│ Regex Success│
│     Rate     │
│    75.0%     │  ← Yellow text
│ Target: >80% │
│      🟡      │
└──────────────┘
```
**Meaning**: Metric is below target but still acceptable

### 🔴 Red (Poor Performance)
```
┌──────────────┐
│ Regex Success│
│     Rate     │
│    55.0%     │  ← Red text
│ Target: >80% │
│      🔴      │
└──────────────┘
```
**Meaning**: Metric is below acceptable threshold

---

## Pattern Status Badges

### Pending (Yellow)
```
┌─────────────────────────────────────────┐
│ what are [ticker]'s main products?      │
│ [PENDING] ← Yellow badge                │
└─────────────────────────────────────────┘
```
**Meaning**: New pattern, needs review

### Reviewed (Blue)
```
┌─────────────────────────────────────────┐
│ tell me about [ticker] strategy         │
│ [REVIEWED] ← Blue badge                 │
│ 📝 Will add regex pattern next sprint   │
└─────────────────────────────────────────┘
```
**Meaning**: Pattern reviewed, awaiting implementation

### Implemented (Green)
```
┌─────────────────────────────────────────┐
│ what is [ticker] revenue in [period]    │
│ [IMPLEMENTED] ← Green badge             │
│ 📝 Added regex: /revenue.*in.*\d{4}/    │
└─────────────────────────────────────────┘
```
**Meaning**: Regex pattern added to code

### Rejected (Red)
```
┌─────────────────────────────────────────┐
│ random invalid query pattern            │
│ [REJECTED] ← Red badge                  │
│ 📝 Not a valid financial query          │
└─────────────────────────────────────────┘
```
**Meaning**: Pattern rejected, won't implement

---

## Interactive Elements

### Tenant Selector
```
┌─────────────────┐
│ Tenant:         │
│ [ACME Corp   ▼] │ ← Dropdown
│                 │
│ Options:        │
│ • ACME Corp     │
│ • Demo Tenant   │
│ • Test Tenant   │
└─────────────────┘
```

### Period Selector
```
┌──────────────────────┐
│ Period:              │
│ [Last 24 Hours    ▼] │ ← Dropdown
│                      │
│ Options:             │
│ • Last 24 Hours      │
│ • Last 7 Days        │
└──────────────────────┘
```

### Filter Buttons
```
┌────────────────────────────────────────────────────┐
│ [All] [Pending] [Reviewed] [Implemented] [Rejected]│
│  ^^^                                                │
│  Active (blue background)                           │
└────────────────────────────────────────────────────┘
```

### Action Buttons
```
┌─────────────────────────────────────────────────┐
│ [Mark Reviewed] [Mark Implemented] [Reject]     │
│  Blue button    Green button       Red button   │
└─────────────────────────────────────────────────┘
```

---

## Workflow Examples

### Example 1: Review a Pending Pattern

**Step 1**: Pattern appears as pending
```
┌─────────────────────────────────────────┐
│ what are [ticker]'s competitors?        │
│ [PENDING]                               │
│ 15 occurrences                          │
│                                         │
│ [Mark Reviewed] [Mark Implemented] [Reject]
└─────────────────────────────────────────┘
```

**Step 2**: Click "Mark Reviewed"
```
┌─────────────────────────────────────────┐
│ Notes for this reviewed action:         │
│ [Will add regex for competitor queries] │
│                                         │
│ Your name:                              │
│ [Admin]                                 │
│                                         │
│ [OK] [Cancel]                           │
└─────────────────────────────────────────┘
```

**Step 3**: Pattern updated to reviewed
```
┌─────────────────────────────────────────┐
│ what are [ticker]'s competitors?        │
│ [REVIEWED]                              │
│ 15 occurrences                          │
│ 📝 Will add regex for competitor queries│
│                                         │
│ [Mark Implemented]                      │
└─────────────────────────────────────────┘
```

### Example 2: Implement a Reviewed Pattern

**Step 1**: Pattern is reviewed
```
┌─────────────────────────────────────────┐
│ what are [ticker]'s competitors?        │
│ [REVIEWED]                              │
│ 15 occurrences                          │
│ 📝 Will add regex for competitor queries│
│                                         │
│ [Mark Implemented]                      │
└─────────────────────────────────────────┘
```

**Step 2**: Add regex to code
```typescript
// In intent-detector.service.ts
if (query.match(/\b(competitor|competitors|competition)\b/i)) {
  sections.push('item_1');
  subsectionName = 'Competition';
}
```

**Step 3**: Click "Mark Implemented"
```
┌─────────────────────────────────────────┐
│ Notes for this implemented action:      │
│ [Added regex pattern to code]           │
│                                         │
│ Your name:                              │
│ [Admin]                                 │
│                                         │
│ [OK] [Cancel]                           │
└─────────────────────────────────────────┘
```

**Step 4**: Pattern updated to implemented
```
┌─────────────────────────────────────────┐
│ what are [ticker]'s competitors?        │
│ [IMPLEMENTED]                           │
│ 15 occurrences                          │
│ 📝 Added regex pattern to code          │
│                                         │
│ (No action buttons - workflow complete) │
└─────────────────────────────────────────┘
```

### Example 3: Reject an Invalid Pattern

**Step 1**: Pattern appears as pending
```
┌─────────────────────────────────────────┐
│ random invalid query text               │
│ [PENDING]                               │
│ 3 occurrences                           │
│                                         │
│ [Mark Reviewed] [Mark Implemented] [Reject]
└─────────────────────────────────────────┘
```

**Step 2**: Click "Reject"
```
┌─────────────────────────────────────────┐
│ Notes for this rejected action:         │
│ [Not a valid financial query]           │
│                                         │
│ Your name:                              │
│ [Admin]                                 │
│                                         │
│ [OK] [Cancel]                           │
└─────────────────────────────────────────┘
```

**Step 3**: Pattern updated to rejected
```
┌─────────────────────────────────────────┐
│ random invalid query text               │
│ [REJECTED]                              │
│ 3 occurrences                           │
│ 📝 Not a valid financial query          │
│                                         │
│ (No action buttons - workflow complete) │
└─────────────────────────────────────────┘
```

---

## Empty States

### No Failed Patterns
```
┌─────────────────────────────────────────┐
│                                         │
│              ✨                          │
│                                         │
│      No failed patterns found           │
│                                         │
│  All queries are being detected         │
│  successfully!                          │
│                                         │
└─────────────────────────────────────────┘
```

### No Data for Tenant
```
┌─────────────────────────────────────────┐
│                                         │
│              📊                          │
│                                         │
│      No data for this tenant            │
│                                         │
│  Run some queries to generate data      │
│                                         │
└─────────────────────────────────────────┘
```

---

## Loading States

### Initial Load
```
┌─────────────────────────────────────────┐
│                                         │
│              ⏳                          │
│                                         │
│         Loading metrics...              │
│                                         │
└─────────────────────────────────────────┘
```

### Refreshing
```
┌─────────────────────────────────────────┐
│  Last refresh: Refreshing... 🔄         │
└─────────────────────────────────────────┘
```

---

## Error States

### Authentication Error
```
┌─────────────────────────────────────────┐
│ ❌ Authentication failed                │
│                                         │
│ Invalid admin key. Please check your   │
│ credentials and try again.              │
└─────────────────────────────────────────┘
```

### Network Error
```
┌─────────────────────────────────────────┐
│ ❌ Failed to load metrics               │
│                                         │
│ Network error. Please check your       │
│ connection and try again.               │
└─────────────────────────────────────────┘
```

### Server Error
```
┌─────────────────────────────────────────┐
│ ❌ Server error                         │
│                                         │
│ Failed to fetch data. Please try       │
│ again later or contact support.         │
└─────────────────────────────────────────┘
```

---

## Responsive Design

### Desktop (>1200px)
```
┌────────────────────────────────────────────────────────────┐
│  Metrics: 3 columns × 2 rows                               │
│  ┌──────────┬──────────┬──────────┐                        │
│  │ Metric 1 │ Metric 2 │ Metric 3 │                        │
│  ├──────────┼──────────┼──────────┤                        │
│  │ Metric 4 │ Metric 5 │ Metric 6 │                        │
│  └──────────┴──────────┴──────────┘                        │
│                                                             │
│  Patterns: Full width                                       │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Pattern 1                                          │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
```

### Tablet (768px - 1200px)
```
┌──────────────────────────────────────┐
│  Metrics: 2 columns × 3 rows         │
│  ┌──────────┬──────────┐             │
│  │ Metric 1 │ Metric 2 │             │
│  ├──────────┼──────────┤             │
│  │ Metric 3 │ Metric 4 │             │
│  ├──────────┼──────────┤             │
│  │ Metric 5 │ Metric 6 │             │
│  └──────────┴──────────┘             │
│                                      │
│  Patterns: Full width                │
│  ┌────────────────────────────────┐  │
│  │ Pattern 1                      │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

---

## Color Palette

### Metrics
- **Green (Good)**: `#10b981` (Tailwind green-500)
- **Yellow (Warning)**: `#f59e0b` (Tailwind amber-500)
- **Red (Bad)**: `#ef4444` (Tailwind red-500)

### Status Badges
- **Pending**: `#fef3c7` background, `#92400e` text (Tailwind amber)
- **Reviewed**: `#dbeafe` background, `#1e40af` text (Tailwind blue)
- **Implemented**: `#d1fae5` background, `#065f46` text (Tailwind green)
- **Rejected**: `#fee2e2` background, `#991b1b` text (Tailwind red)

### Action Buttons
- **Reviewed**: `#3b82f6` (Tailwind blue-500)
- **Implemented**: `#10b981` (Tailwind green-500)
- **Rejected**: `#ef4444` (Tailwind red-500)

### Background
- **Page**: `#f5f5f5` (Light gray)
- **Cards**: `#ffffff` (White)
- **Borders**: `#e5e7eb` (Tailwind gray-200)

---

## Typography

### Headers
- **H1**: 24px, bold, `#333`
- **H2**: 20px, bold, `#333`
- **H3**: 14px, uppercase, `#666`

### Body
- **Regular**: 14px, `#333`
- **Small**: 12px, `#666`
- **Tiny**: 11px, `#999`

### Monospace
- **Pattern text**: 14px, Courier New, `#333`
- **Example queries**: 13px, system font, `#555`

---

## Accessibility

### Keyboard Navigation
- Tab through all interactive elements
- Enter to activate buttons
- Escape to close modals

### Screen Reader Support
- All buttons have descriptive labels
- Status badges have aria-labels
- Metrics have descriptive text

### Color Contrast
- All text meets WCAG AA standards
- Color is not the only indicator (icons + text)

---

## Animation & Transitions

### Smooth Transitions
- Metric updates: 300ms ease
- Button hover: 150ms ease
- Status badge changes: 200ms ease

### Loading Indicators
- Spinner for initial load
- Pulse animation for refreshing
- Skeleton screens for metrics

---

**Last Updated**: February 4, 2026  
**Design System**: FundLens Design System v1.0  
**Framework**: Vanilla HTML/CSS/JavaScript
