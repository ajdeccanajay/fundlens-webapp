# FundLens.ai Research Assistant & Scratch Pad UI Prompt

## Context
I'm building a world-class research assistant interface for FundLens.ai—an AI-powered private equity deal intelligence platform. The interface analyzes SEC filings (10-K, 10-Q, 8-K) and must handle rich financial content (tables, charts, citations). It includes a "Scratch Pad" for saving insights during due diligence workflows.

**Brand Positioning:** Professional, institutional-grade, trustworthy—designed for PE analysts and deal teams who demand precision and efficiency. The visual identity combines deep navy sophistication with clean, modern UI patterns.

---

## FundLens Design System

### Brand Colors (Extracted from fundlens.ai)
```css
/* Primary Brand Colors */
--fundlens-navy: #0B1829;            /* Deep navy - primary brand color */
--fundlens-navy-light: #132337;      /* Lighter navy for gradients */
--fundlens-navy-mid: #1A3A5C;        /* Mid-tone for hover states */
--fundlens-teal: #1E5A7A;            /* Teal accent from gradient */
--fundlens-slate: #2D4A6B;           /* Slate blue for secondary elements */

/* CTA & Accent Colors */
--fundlens-cta: #1B4D6E;             /* Contact us button - rounded pill */
--fundlens-cta-hover: #164058;       /* CTA hover state */
--fundlens-wave-accent: #3A7CA5;     /* Lighter blue from wave pattern */

/* Text Colors */
--text-white: #FFFFFF;
--text-off-white: #F0F4F8;
--text-muted: #94A3B8;               /* Muted text on dark backgrounds */

/* Light Mode UI Colors (for app interior) */
--bg-primary: #FFFFFF;
--bg-secondary: #F8FAFC;
--bg-tertiary: #F1F5F9;
--bg-navy-tint: #EEF2F6;             /* Very light navy tint */

--text-primary: #0B1829;             /* Navy as primary text */
--text-secondary: #475569;
--text-tertiary: #94A3B8;

--border-subtle: #E2E8F0;
--border-default: #CBD5E1;
--border-focus: var(--fundlens-teal);

/* Semantic Colors */
--success: #10B981;
--success-light: #D1FAE5;
--warning: #F59E0B;
--warning-light: #FEF3C7;
--error: #EF4444;
--error-light: #FEE2E2;
--info: #3B82F6;
--info-light: #DBEAFE;

/* Gradients (matching the wave aesthetic) */
--gradient-hero: linear-gradient(135deg, #0B1829 0%, #1A3A5C 50%, #1E5A7A 100%);
--gradient-subtle: linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 100%);
--gradient-card-hover: linear-gradient(135deg, rgba(30, 90, 122, 0.05) 0%, rgba(11, 24, 41, 0.02) 100%);
```

### Typography
```css
/* Font Stack - Clean, professional (matching the site's sans-serif) */
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-heading: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;

/* Type Scale */
--text-xs: 0.75rem;     /* 12px */
--text-sm: 0.875rem;    /* 14px */
--text-base: 1rem;      /* 16px */
--text-lg: 1.125rem;    /* 18px */
--text-xl: 1.25rem;     /* 20px */
--text-2xl: 1.5rem;     /* 24px */
--text-3xl: 1.875rem;   /* 30px */

/* Font Weights */
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;

/* Headings style (italic like "FundLens" on site) */
.brand-heading {
  font-style: italic;
  font-weight: var(--font-bold);
}

/* CRITICAL: Tabular nums for financial data */
.financial-data {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}
```

### Spacing & Layout
```css
--spacing-1: 0.25rem;   /* 4px */
--spacing-2: 0.5rem;    /* 8px */
--spacing-3: 0.75rem;   /* 12px */
--spacing-4: 1rem;      /* 16px */
--spacing-5: 1.25rem;   /* 20px */
--spacing-6: 1.5rem;    /* 24px */
--spacing-8: 2rem;      /* 32px */
--spacing-10: 2.5rem;   /* 40px */
--spacing-12: 3rem;     /* 48px */

/* Border Radius - matching the rounded CTA pill style */
--radius-sm: 0.25rem;   /* 4px */
--radius-md: 0.5rem;    /* 8px */
--radius-lg: 0.75rem;   /* 12px */
--radius-xl: 1rem;      /* 16px */
--radius-2xl: 1.5rem;   /* 24px */
--radius-full: 9999px;  /* Pills like "Contact us" button */
```

### Shadows
```css
--shadow-sm: 0 1px 2px 0 rgba(11, 24, 41, 0.05);
--shadow-md: 0 4px 6px -1px rgba(11, 24, 41, 0.1), 0 2px 4px -2px rgba(11, 24, 41, 0.1);
--shadow-lg: 0 10px 15px -3px rgba(11, 24, 41, 0.1), 0 4px 6px -4px rgba(11, 24, 41, 0.1);
--shadow-xl: 0 20px 25px -5px rgba(11, 24, 41, 0.1), 0 8px 10px -6px rgba(11, 24, 41, 0.1);
--shadow-panel: 0 25px 50px -12px rgba(11, 24, 41, 0.25);

/* Glow effect for focus states (matching the wave aesthetic) */
--shadow-focus: 0 0 0 3px rgba(30, 90, 122, 0.3);
```

---

## Chat Interface Design

### Overall Layout
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌─────┐                                                                      │
│ │(|)  │ FundLens    Research Assistant              📋 Scratch Pad  [? Help]│
│ └─────┘                                                                      │
├────────────┬─────────────────────────────────────────────────────────────────┤
│            │  ┌───────────────────────────────────────────────────────────┐  │
│ 🔍 Search  │  │ Active Filings: AAPL 10-K (2024), MSFT 10-Q (Q3 2024)    │  │
│            │  └───────────────────────────────────────────────────────────┘  │
│ ─────────  │                                                                 │
│ Today      │                                                                 │
│  ○ AAPL    │     ┌─────────────────────────────────────────────────────┐    │
│    analysis│     │ What are the key risk factors for Apple's           │    │
│  ○ MSFT vs │     │ supply chain?                                    ┘  │    │
│    GOOGL   │     └─────────────────────────────────────────────────────┘    │
│            │                                                                 │
│ Yesterday  │     ┌─────────────────────────────────────────────────────────┐│
│  ○ Due     │     │ Based on Apple's 2024 10-K filing, here are the key    ││
│    dilig...│     │ supply chain risk factors:                              ││
│            │     │                                                          ││
│ ─────────  │     │ **Geographic Concentration** [1]                        ││
│ + New Chat │     │ Apple relies heavily on manufacturing partners in...    ││
│            │     │                                                          ││
│            │     │ ┌────────────────────────────────────────────────────┐  ││
│            │     │ │ Region    │ % of Supply │ YoY Change │ Risk Level │  ││
│            │     │ ├───────────┼─────────────┼────────────┼────────────┤  ││
│            │     │ │ China     │      67.2%  │     -3.1%  │ High       │  ││
│            │     │ │ Taiwan    │      18.4%  │     +1.2%  │ Medium     │  ││
│            │     │ │ Vietnam   │       8.7%  │     +2.8%  │ Low        │  ││
│            │     │ └────────────────────────────────────────────────────┘  ││
│            │     │                                                          ││
│            │     │ [📋 Copy]  [⭐ Save to Scratch Pad]  [↻ Regenerate]      ││
│            │     └─────────────────────────────────────────────────────────┘│
│            │                                                                 │
│            ├─────────────────────────────────────────────────────────────────┤
│            │  ┌─────────────────────────────────────────────────────────┐   │
│            │  │ Ask about revenue trends, segment performance...      ⬆ │   │
│            │  └─────────────────────────────────────────────────────────┘   │
└────────────┴─────────────────────────────────────────────────────────────────┘
```

### Header Bar
```css
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-3) var(--spacing-6);
  background: var(--fundlens-navy);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.header__logo {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  color: var(--text-white);
  font-weight: var(--font-bold);
  font-style: italic;
}

.header__title {
  color: var(--text-off-white);
  font-size: var(--text-lg);
  font-weight: var(--font-medium);
  margin-left: var(--spacing-4);
  padding-left: var(--spacing-4);
  border-left: 1px solid rgba(255, 255, 255, 0.2);
}

.header__actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
}

/* Scratch Pad toggle button - pill style like "Contact us" */
.scratch-pad-toggle {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-4);
  background: var(--fundlens-cta);
  color: var(--text-white);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  transition: all 200ms ease;
}

.scratch-pad-toggle:hover {
  background: var(--fundlens-cta-hover);
  transform: translateY(-1px);
}

.scratch-pad-toggle__badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  background: var(--text-white);
  color: var(--fundlens-navy);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}
```

### Message Input Area
```css
.input-container {
  padding: var(--spacing-4) var(--spacing-6);
  background: var(--bg-primary);
  border-top: 1px solid var(--border-subtle);
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: var(--spacing-3);
  padding: var(--spacing-3);
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  transition: all 200ms ease;
}

.input-wrapper:focus-within {
  border-color: var(--fundlens-teal);
  box-shadow: var(--shadow-focus);
  background: var(--bg-primary);
}

.input-textarea {
  flex: 1;
  min-height: 24px;
  max-height: 200px;
  padding: var(--spacing-1) var(--spacing-2);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  color: var(--text-primary);
  background: transparent;
  border: none;
  resize: none;
  outline: none;
}

.input-textarea::placeholder {
  color: var(--text-tertiary);
}

.send-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: var(--fundlens-navy);
  color: var(--text-white);
  border-radius: var(--radius-lg);
  transition: all 200ms ease;
}

.send-button:hover:not(:disabled) {
  background: var(--fundlens-navy-mid);
  transform: scale(1.05);
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Loading state */
.send-button--loading {
  background: var(--fundlens-teal);
}

.send-button--loading .icon {
  animation: spin 1s linear infinite;
}
```

### Conversation Sidebar
```css
.sidebar {
  width: 260px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
}

.sidebar__search {
  padding: var(--spacing-4);
  border-bottom: 1px solid var(--border-subtle);
}

.sidebar__search-input {
  width: 100%;
  padding: var(--spacing-2) var(--spacing-3);
  padding-left: var(--spacing-8);
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

.sidebar__list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-2);
}

.sidebar__section-title {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.sidebar__item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 150ms ease;
}

.sidebar__item:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.sidebar__item--active {
  background: var(--gradient-card-hover);
  color: var(--fundlens-navy);
  font-weight: var(--font-medium);
}

.sidebar__new-chat {
  margin: var(--spacing-4);
  padding: var(--spacing-3);
  background: var(--fundlens-navy);
  color: var(--text-white);
  border-radius: var(--radius-full);
  font-weight: var(--font-medium);
  text-align: center;
  transition: all 200ms ease;
}

.sidebar__new-chat:hover {
  background: var(--fundlens-navy-mid);
}
```

### Message Bubbles

**User Messages:**
```css
.message--user {
  display: flex;
  justify-content: flex-end;
  padding: var(--spacing-4) var(--spacing-6);
}

.message--user .message__content {
  max-width: 70%;
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--fundlens-navy);
  color: var(--text-white);
  border-radius: var(--radius-xl);
  border-bottom-right-radius: var(--radius-sm);
}
```

**Assistant Messages:**
```css
.message--assistant {
  padding: var(--spacing-4) var(--spacing-6);
}

.message--assistant .message__content {
  max-width: 100%;
  color: var(--text-primary);
  line-height: var(--leading-relaxed);
}

/* Section headings in responses */
.message__content h3 {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--fundlens-navy);
  margin-top: var(--spacing-4);
  margin-bottom: var(--spacing-2);
}

/* Streaming cursor */
.message--streaming::after {
  content: '|';
  animation: blink 1s infinite;
  color: var(--fundlens-teal);
  font-weight: var(--font-bold);
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
```

### Message Actions
```css
.message__actions {
  display: flex;
  gap: var(--spacing-2);
  margin-top: var(--spacing-3);
  padding-top: var(--spacing-3);
  border-top: 1px solid var(--border-subtle);
  opacity: 0;
  transition: opacity 150ms ease;
}

.message:hover .message__actions {
  opacity: 1;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition: all 150ms ease;
}

.action-btn:hover {
  background: var(--bg-tertiary);
  border-color: var(--border-default);
  color: var(--text-primary);
}

/* Primary action - Save to Scratch Pad */
.action-btn--primary {
  background: rgba(30, 90, 122, 0.1);
  border-color: var(--fundlens-teal);
  color: var(--fundlens-teal);
}

.action-btn--primary:hover {
  background: var(--fundlens-teal);
  color: var(--text-white);
}
```

---

## Rich Content Rendering

### Financial Tables
```css
.table-container {
  margin: var(--spacing-4) 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-2) var(--spacing-3);
  background: var(--fundlens-navy);
  color: var(--text-white);
}

.table-header__title {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}

.table-header__actions {
  display: flex;
  gap: var(--spacing-2);
}

.table-action-btn {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--text-xs);
  color: var(--text-off-white);
  background: rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-sm);
  transition: all 150ms ease;
}

.table-action-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.financial-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.financial-table thead {
  background: var(--bg-tertiary);
  position: sticky;
  top: 0;
}

.financial-table th {
  padding: var(--spacing-3);
  text-align: left;
  font-weight: var(--font-semibold);
  color: var(--fundlens-navy);
  border-bottom: 2px solid var(--border-default);
  white-space: nowrap;
}

.financial-table th.numeric {
  text-align: right;
}

.financial-table td {
  padding: var(--spacing-3);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

.financial-table td.numeric {
  text-align: right;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.financial-table tbody tr:nth-child(even) {
  background: var(--bg-secondary);
}

.financial-table tbody tr:hover {
  background: rgba(30, 90, 122, 0.05);
}

/* Value formatting */
.value-positive { 
  color: var(--success); 
}

.value-negative { 
  color: var(--error); 
}

.value-highlight {
  background: rgba(30, 90, 122, 0.1);
  font-weight: var(--font-medium);
}

/* Risk level badges */
.risk-badge {
  display: inline-flex;
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
}

.risk-badge--high { background: var(--error-light); color: var(--error); }
.risk-badge--medium { background: var(--warning-light); color: #B45309; }
.risk-badge--low { background: var(--success-light); color: #047857; }
```

### Citations
```css
.citation {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--spacing-1);
  margin: 0 2px;
  font-size: 11px;
  font-weight: var(--font-semibold);
  color: var(--fundlens-teal);
  background: rgba(30, 90, 122, 0.1);
  border-radius: var(--radius-sm);
  cursor: pointer;
  vertical-align: super;
  transition: all 150ms ease;
}

.citation:hover {
  background: var(--fundlens-teal);
  color: var(--text-white);
}

/* Source popover */
.source-popover {
  position: absolute;
  z-index: 100;
  width: 360px;
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}

.source-popover__header {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-3);
  background: var(--fundlens-navy);
  color: var(--text-white);
}

.filing-badge {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--text-xs);
  font-weight: var(--font-bold);
  border-radius: var(--radius-sm);
  text-transform: uppercase;
}

.filing-badge--10k { background: #3B82F6; }
.filing-badge--10q { background: #10B981; }
.filing-badge--8k { background: #F59E0B; }

.source-popover__body {
  padding: var(--spacing-3);
}

.source-popover__snippet {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: var(--leading-relaxed);
  padding-left: var(--spacing-3);
  border-left: 3px solid var(--fundlens-teal);
}

.source-popover__link {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  margin-top: var(--spacing-3);
  font-size: var(--text-sm);
  color: var(--fundlens-teal);
  font-weight: var(--font-medium);
}
```

---

## Scratch Pad Design

### Panel Layout
```css
.scratch-pad {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  height: 100vh;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-panel);
  transform: translateX(100%);
  transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 50;
  display: flex;
  flex-direction: column;
}

.scratch-pad--open {
  transform: translateX(0);
}

/* Header */
.scratch-pad__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-4) var(--spacing-5);
  background: var(--fundlens-navy);
  color: var(--text-white);
}

.scratch-pad__title {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
}

.scratch-pad__close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-off-white);
  border-radius: var(--radius-md);
  transition: all 150ms ease;
}

.scratch-pad__close:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Search & Filters */
.scratch-pad__toolbar {
  padding: var(--spacing-3) var(--spacing-4);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.scratch-pad__search {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-3);
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.scratch-pad__search-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: var(--text-sm);
  outline: none;
}

.scratch-pad__tabs {
  display: flex;
  gap: var(--spacing-1);
  margin-top: var(--spacing-3);
}

.scratch-pad__tab {
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  border-radius: var(--radius-full);
  transition: all 150ms ease;
}

.scratch-pad__tab:hover {
  background: var(--bg-tertiary);
}

.scratch-pad__tab--active {
  background: var(--fundlens-navy);
  color: var(--text-white);
}

/* Items List */
.scratch-pad__list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-3);
}

.scratch-pad__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  text-align: center;
  padding: var(--spacing-8);
}

.scratch-pad__empty-icon {
  width: 64px;
  height: 64px;
  margin-bottom: var(--spacing-4);
  opacity: 0.5;
}
```

### Saved Item Cards
```css
.saved-item {
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  margin-bottom: var(--spacing-3);
  overflow: hidden;
  transition: all 200ms ease;
}

.saved-item:hover {
  border-color: var(--fundlens-teal);
  box-shadow: var(--shadow-md);
}

.saved-item__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--spacing-3);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-subtle);
}

.saved-item__title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--fundlens-navy);
  margin-bottom: var(--spacing-1);
}

.saved-item__meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.saved-item__source {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: 2px var(--spacing-2);
  background: rgba(30, 90, 122, 0.1);
  color: var(--fundlens-teal);
  border-radius: var(--radius-sm);
  font-weight: var(--font-medium);
}

.saved-item__body {
  padding: var(--spacing-3);
}

.saved-item__preview {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: var(--leading-relaxed);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Table preview */
.saved-item__table-preview {
  margin-top: var(--spacing-2);
  padding: var(--spacing-2);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  overflow: hidden;
}

.saved-item__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-1);
  margin-top: var(--spacing-2);
}

.saved-item__tag {
  padding: 2px var(--spacing-2);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border-radius: var(--radius-full);
}

.saved-item__actions {
  display: flex;
  gap: var(--spacing-1);
  padding: var(--spacing-2) var(--spacing-3);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.saved-item__action {
  flex: 1;
  padding: var(--spacing-2);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  text-align: center;
  border-radius: var(--radius-sm);
  transition: all 150ms ease;
}

.saved-item__action:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.saved-item__action--danger:hover {
  background: var(--error-light);
  color: var(--error);
}
```

### Collections
```css
.collections-dropdown {
  position: relative;
}

.collections-trigger {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.collections-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: var(--spacing-1);
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 10;
}

.collections-menu__item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--text-sm);
  color: var(--text-primary);
  transition: all 150ms ease;
}

.collections-menu__item:hover {
  background: var(--bg-secondary);
}

.collections-menu__color {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
}
```

### Export Panel
```css
.scratch-pad__footer {
  padding: var(--spacing-3) var(--spacing-4);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.export-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-2);
  padding: var(--spacing-3);
  background: var(--fundlens-navy);
  color: var(--text-white);
  border-radius: var(--radius-full);
  font-weight: var(--font-medium);
  transition: all 200ms ease;
}

.export-btn:hover {
  background: var(--fundlens-navy-mid);
}
```

---

## Animations & Micro-interactions

### Save to Scratch Pad Animation
```css
/* When user clicks "Save to Scratch Pad" */
@keyframes saveConfirm {
  0% { transform: scale(1); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}

@keyframes flyToScratchPad {
  0% {
    opacity: 1;
    transform: translate(0, 0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(calc(100vw - 200px), -50vh) scale(0.2);
  }
}

.save-animation {
  animation: flyToScratchPad 400ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.scratch-pad-toggle--pulse {
  animation: saveConfirm 300ms ease;
}
```

### General Transitions
```css
/* Smooth transitions for all interactive elements */
.interactive {
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Hover lift effect */
.hoverable:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

/* Focus ring consistent with brand */
.focusable:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
```

---

## Responsive Behavior

### Tablet (768px - 1199px)
```css
@media (max-width: 1199px) {
  .sidebar {
    position: fixed;
    left: -260px;
    z-index: 40;
    transition: left 300ms ease;
  }
  
  .sidebar--open {
    left: 0;
  }
  
  .scratch-pad {
    width: 360px;
  }
}
```

### Mobile (< 768px)
```css
@media (max-width: 767px) {
  .scratch-pad {
    width: 100%;
  }
  
  .message--user .message__content {
    max-width: 85%;
  }
  
  .table-container {
    margin-left: calc(-1 * var(--spacing-4));
    margin-right: calc(-1 * var(--spacing-4));
    border-radius: 0;
  }
}
```

---

## Implementation Checklist

### Phase 1 - Core Chat
- [ ] Message input with auto-resize
- [ ] User/assistant message styling
- [ ] Streaming response with cursor
- [ ] Basic message actions

### Phase 2 - Rich Content  
- [ ] Financial table component
- [ ] Citation system with popovers
- [ ] Code/data block rendering
- [ ] Copy functionality

### Phase 3 - Scratch Pad
- [ ] Slide-out panel
- [ ] Save animation
- [ ] Item cards with preview
- [ ] Search and filter
- [ ] Collections

### Phase 4 - Polish
- [ ] All micro-interactions
- [ ] Loading skeletons
- [ ] Error states
- [ ] Mobile optimization
- [ ] Keyboard shortcuts
