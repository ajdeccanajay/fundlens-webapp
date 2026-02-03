# FundLens.ai Full Webapp Style Uplift Prompt
## **PROMPT 1 OF 2 — RUN THIS FIRST**

## Context
Apply the FundLens.ai brand identity consistently across the entire webapp. This prompt establishes the global design system foundation—tokens, components, and patterns—that all features (including the Research Assistant and Scratch Pad) will inherit.

**Brand DNA:** Professional PE/financial services platform with deep navy sophistication, clean typography, and the distinctive wave pattern motif. The design should feel institutional-grade yet modern—trustworthy enough for deal teams, polished enough to impress.

**Why run this first:** Establishing the design tokens and base components ensures consistency. The Research Assistant prompt (Prompt 2) builds on this foundation with feature-specific refinements.

---

## Global Design Tokens

### Complete Color System
```css
:root {
  /* ═══════════════════════════════════════════════════════════════
     BRAND COLORS - Core FundLens Identity
     ═══════════════════════════════════════════════════════════════ */
  
  /* Primary Navy Palette */
  --color-navy-950: #050B12;    /* Darkest - text on light bg */
  --color-navy-900: #0B1829;    /* Primary brand navy */
  --color-navy-800: #132337;    /* Lighter navy */
  --color-navy-700: #1A3A5C;    /* Mid navy */
  --color-navy-600: #1E5A7A;    /* Teal-navy bridge */
  --color-navy-500: #2D4A6B;    /* Slate blue */
  
  /* Teal/Blue Accent Palette */
  --color-teal-600: #1B4D6E;    /* CTA buttons */
  --color-teal-500: #1E5A7A;    /* Primary accent */
  --color-teal-400: #3A7CA5;    /* Wave highlight */
  --color-teal-300: #5B9DC4;    /* Lighter accent */
  --color-teal-200: #A3CEEB;    /* Very light accent */
  --color-teal-100: #D6EAF5;    /* Accent tint */
  --color-teal-50: #EBF5FA;     /* Subtle tint */
  
  /* ═══════════════════════════════════════════════════════════════
     SEMANTIC COLORS
     ═══════════════════════════════════════════════════════════════ */
  
  /* Success (Green) */
  --color-success-600: #059669;
  --color-success-500: #10B981;
  --color-success-100: #D1FAE5;
  --color-success-50: #ECFDF5;
  
  /* Warning (Amber) */
  --color-warning-600: #D97706;
  --color-warning-500: #F59E0B;
  --color-warning-100: #FEF3C7;
  --color-warning-50: #FFFBEB;
  
  /* Error (Red) */
  --color-error-600: #DC2626;
  --color-error-500: #EF4444;
  --color-error-100: #FEE2E2;
  --color-error-50: #FEF2F2;
  
  /* Info (Blue) */
  --color-info-600: #2563EB;
  --color-info-500: #3B82F6;
  --color-info-100: #DBEAFE;
  --color-info-50: #EFF6FF;
  
  /* ═══════════════════════════════════════════════════════════════
     NEUTRAL COLORS
     ═══════════════════════════════════════════════════════════════ */
  
  --color-white: #FFFFFF;
  --color-gray-50: #F8FAFC;
  --color-gray-100: #F1F5F9;
  --color-gray-200: #E2E8F0;
  --color-gray-300: #CBD5E1;
  --color-gray-400: #94A3B8;
  --color-gray-500: #64748B;
  --color-gray-600: #475569;
  --color-gray-700: #334155;
  --color-gray-800: #1E293B;
  --color-gray-900: #0F172A;
  
  /* ═══════════════════════════════════════════════════════════════
     APPLIED COLOR TOKENS (Light Mode)
     ═══════════════════════════════════════════════════════════════ */
  
  /* Backgrounds */
  --bg-primary: var(--color-white);
  --bg-secondary: var(--color-gray-50);
  --bg-tertiary: var(--color-gray-100);
  --bg-inverse: var(--color-navy-900);
  --bg-accent: var(--color-teal-50);
  --bg-hover: var(--color-gray-100);
  --bg-active: var(--color-teal-100);
  
  /* Text */
  --text-primary: var(--color-navy-900);
  --text-secondary: var(--color-gray-600);
  --text-tertiary: var(--color-gray-400);
  --text-inverse: var(--color-white);
  --text-accent: var(--color-teal-500);
  --text-link: var(--color-teal-600);
  --text-link-hover: var(--color-navy-700);
  
  /* Borders */
  --border-subtle: var(--color-gray-200);
  --border-default: var(--color-gray-300);
  --border-strong: var(--color-gray-400);
  --border-focus: var(--color-teal-500);
  --border-accent: var(--color-teal-400);
  
  /* ═══════════════════════════════════════════════════════════════
     GRADIENTS
     ═══════════════════════════════════════════════════════════════ */
  
  /* Hero/Header gradient (matches fundlens.ai wave section) */
  --gradient-hero: linear-gradient(135deg, 
    var(--color-navy-900) 0%, 
    var(--color-navy-700) 50%, 
    var(--color-teal-500) 100%
  );
  
  /* Subtle background gradient */
  --gradient-subtle: linear-gradient(180deg, 
    var(--color-gray-50) 0%, 
    var(--color-white) 100%
  );
  
  /* Card hover state */
  --gradient-card-hover: linear-gradient(135deg, 
    rgba(30, 90, 122, 0.05) 0%, 
    rgba(11, 24, 41, 0.02) 100%
  );
  
  /* Button gradient (optional premium feel) */
  --gradient-button: linear-gradient(135deg, 
    var(--color-navy-900) 0%, 
    var(--color-navy-700) 100%
  );
  
  /* ═══════════════════════════════════════════════════════════════
     TYPOGRAPHY
     ═══════════════════════════════════════════════════════════════ */
  
  /* Font Families */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace;
  
  /* Font Sizes */
  --text-xs: 0.75rem;      /* 12px */
  --text-sm: 0.875rem;     /* 14px */
  --text-base: 1rem;       /* 16px */
  --text-lg: 1.125rem;     /* 18px */
  --text-xl: 1.25rem;      /* 20px */
  --text-2xl: 1.5rem;      /* 24px */
  --text-3xl: 1.875rem;    /* 30px */
  --text-4xl: 2.25rem;     /* 36px */
  --text-5xl: 3rem;        /* 48px */
  
  /* Font Weights */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
  
  /* Line Heights */
  --leading-none: 1;
  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
  --leading-loose: 2;
  
  /* Letter Spacing */
  --tracking-tighter: -0.05em;
  --tracking-tight: -0.025em;
  --tracking-normal: 0;
  --tracking-wide: 0.025em;
  --tracking-wider: 0.05em;
  
  /* ═══════════════════════════════════════════════════════════════
     SPACING
     ═══════════════════════════════════════════════════════════════ */
  
  --spacing-0: 0;
  --spacing-px: 1px;
  --spacing-0-5: 0.125rem;  /* 2px */
  --spacing-1: 0.25rem;     /* 4px */
  --spacing-1-5: 0.375rem;  /* 6px */
  --spacing-2: 0.5rem;      /* 8px */
  --spacing-2-5: 0.625rem;  /* 10px */
  --spacing-3: 0.75rem;     /* 12px */
  --spacing-3-5: 0.875rem;  /* 14px */
  --spacing-4: 1rem;        /* 16px */
  --spacing-5: 1.25rem;     /* 20px */
  --spacing-6: 1.5rem;      /* 24px */
  --spacing-7: 1.75rem;     /* 28px */
  --spacing-8: 2rem;        /* 32px */
  --spacing-9: 2.25rem;     /* 36px */
  --spacing-10: 2.5rem;     /* 40px */
  --spacing-12: 3rem;       /* 48px */
  --spacing-14: 3.5rem;     /* 56px */
  --spacing-16: 4rem;       /* 64px */
  --spacing-20: 5rem;       /* 80px */
  --spacing-24: 6rem;       /* 96px */
  
  /* ═══════════════════════════════════════════════════════════════
     BORDER RADIUS
     ═══════════════════════════════════════════════════════════════ */
  
  --radius-none: 0;
  --radius-sm: 0.25rem;     /* 4px */
  --radius-md: 0.375rem;    /* 6px */
  --radius-lg: 0.5rem;      /* 8px */
  --radius-xl: 0.75rem;     /* 12px */
  --radius-2xl: 1rem;       /* 16px */
  --radius-3xl: 1.5rem;     /* 24px */
  --radius-full: 9999px;    /* Pill shape */
  
  /* ═══════════════════════════════════════════════════════════════
     SHADOWS
     ═══════════════════════════════════════════════════════════════ */
  
  --shadow-xs: 0 1px 2px 0 rgba(11, 24, 41, 0.05);
  --shadow-sm: 0 1px 3px 0 rgba(11, 24, 41, 0.1), 0 1px 2px -1px rgba(11, 24, 41, 0.1);
  --shadow-md: 0 4px 6px -1px rgba(11, 24, 41, 0.1), 0 2px 4px -2px rgba(11, 24, 41, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(11, 24, 41, 0.1), 0 4px 6px -4px rgba(11, 24, 41, 0.1);
  --shadow-xl: 0 20px 25px -5px rgba(11, 24, 41, 0.1), 0 8px 10px -6px rgba(11, 24, 41, 0.1);
  --shadow-2xl: 0 25px 50px -12px rgba(11, 24, 41, 0.25);
  --shadow-inner: inset 0 2px 4px 0 rgba(11, 24, 41, 0.05);
  
  /* Focus shadows */
  --shadow-focus: 0 0 0 3px rgba(30, 90, 122, 0.3);
  --shadow-focus-error: 0 0 0 3px rgba(239, 68, 68, 0.3);
  
  /* ═══════════════════════════════════════════════════════════════
     TRANSITIONS
     ═══════════════════════════════════════════════════════════════ */
  
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slower: 500ms cubic-bezier(0.4, 0, 0.2, 1);
  
  /* ═══════════════════════════════════════════════════════════════
     Z-INDEX SCALE
     ═══════════════════════════════════════════════════════════════ */
  
  --z-dropdown: 10;
  --z-sticky: 20;
  --z-fixed: 30;
  --z-modal-backdrop: 40;
  --z-modal: 50;
  --z-popover: 60;
  --z-tooltip: 70;
}
```

---

## Dark Mode Tokens
```css
[data-theme="dark"], .dark {
  /* Backgrounds */
  --bg-primary: var(--color-navy-900);
  --bg-secondary: var(--color-navy-800);
  --bg-tertiary: var(--color-navy-700);
  --bg-inverse: var(--color-white);
  --bg-accent: rgba(30, 90, 122, 0.2);
  --bg-hover: var(--color-navy-700);
  --bg-active: rgba(30, 90, 122, 0.3);
  
  /* Text */
  --text-primary: var(--color-gray-50);
  --text-secondary: var(--color-gray-400);
  --text-tertiary: var(--color-gray-500);
  --text-inverse: var(--color-navy-900);
  --text-accent: var(--color-teal-300);
  --text-link: var(--color-teal-400);
  --text-link-hover: var(--color-teal-300);
  
  /* Borders */
  --border-subtle: var(--color-navy-700);
  --border-default: var(--color-navy-600);
  --border-strong: var(--color-navy-500);
}
```

---

## Component Patterns

### Buttons
```css
/* Base button */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2-5) var(--spacing-4);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  line-height: var(--leading-tight);
  border-radius: var(--radius-lg);
  transition: all var(--transition-fast);
  cursor: pointer;
  white-space: nowrap;
}

.btn:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Primary button (navy) */
.btn-primary {
  background: var(--color-navy-900);
  color: var(--text-inverse);
  border: 1px solid var(--color-navy-900);
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-navy-700);
  border-color: var(--color-navy-700);
}

/* Secondary button (outline) */
.btn-secondary {
  background: transparent;
  color: var(--color-navy-900);
  border: 1px solid var(--border-default);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-secondary);
  border-color: var(--border-strong);
}

/* Accent button (teal) */
.btn-accent {
  background: var(--color-teal-600);
  color: var(--text-inverse);
  border: 1px solid var(--color-teal-600);
}

.btn-accent:hover:not(:disabled) {
  background: var(--color-teal-500);
  border-color: var(--color-teal-500);
}

/* Ghost button */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
}

.btn-ghost:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Danger button */
.btn-danger {
  background: var(--color-error-500);
  color: var(--text-inverse);
  border: 1px solid var(--color-error-500);
}

.btn-danger:hover:not(:disabled) {
  background: var(--color-error-600);
  border-color: var(--color-error-600);
}

/* Pill variant (like "Contact us" CTA) */
.btn-pill {
  border-radius: var(--radius-full);
  padding: var(--spacing-2-5) var(--spacing-5);
}

/* Size variants */
.btn-sm {
  padding: var(--spacing-1-5) var(--spacing-3);
  font-size: var(--text-xs);
}

.btn-lg {
  padding: var(--spacing-3) var(--spacing-6);
  font-size: var(--text-base);
}

/* Icon-only button */
.btn-icon {
  padding: var(--spacing-2);
  width: 36px;
  height: 36px;
}

.btn-icon.btn-sm {
  width: 28px;
  height: 28px;
  padding: var(--spacing-1);
}

.btn-icon.btn-lg {
  width: 44px;
  height: 44px;
  padding: var(--spacing-2-5);
}
```

### Form Inputs
```css
/* Base input */
.input {
  width: 100%;
  padding: var(--spacing-2-5) var(--spacing-3);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  transition: all var(--transition-fast);
}

.input::placeholder {
  color: var(--text-tertiary);
}

.input:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.input:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: var(--shadow-focus);
}

.input:disabled {
  background: var(--bg-secondary);
  cursor: not-allowed;
  opacity: 0.7;
}

/* Input with icon */
.input-group {
  position: relative;
}

.input-group .input {
  padding-left: var(--spacing-10);
}

.input-group__icon {
  position: absolute;
  left: var(--spacing-3);
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  pointer-events: none;
}

/* Input states */
.input-error {
  border-color: var(--color-error-500);
}

.input-error:focus {
  box-shadow: var(--shadow-focus-error);
}

.input-success {
  border-color: var(--color-success-500);
}

/* Textarea */
.textarea {
  min-height: 100px;
  resize: vertical;
}

/* Select */
.select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right var(--spacing-3) center;
  padding-right: var(--spacing-10);
}

/* Label */
.label {
  display: block;
  margin-bottom: var(--spacing-1-5);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-primary);
}

/* Helper text */
.helper-text {
  margin-top: var(--spacing-1-5);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.helper-text-error {
  color: var(--color-error-500);
}
```

### Cards
```css
.card {
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  overflow: hidden;
  transition: all var(--transition-base);
}

.card:hover {
  border-color: var(--border-default);
  box-shadow: var(--shadow-md);
}

.card--interactive:hover {
  border-color: var(--color-teal-500);
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.card__header {
  padding: var(--spacing-4) var(--spacing-5);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.card__header--navy {
  background: var(--color-navy-900);
  color: var(--text-inverse);
  border-bottom: none;
}

.card__title {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.card__header--navy .card__title {
  color: var(--text-inverse);
}

.card__body {
  padding: var(--spacing-5);
}

.card__footer {
  padding: var(--spacing-4) var(--spacing-5);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}
```

### Badges
```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: var(--spacing-0-5) var(--spacing-2);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
  white-space: nowrap;
}

/* Filing type badges */
.badge-10k { background: var(--color-info-100); color: var(--color-info-600); }
.badge-10q { background: var(--color-success-100); color: var(--color-success-600); }
.badge-8k { background: var(--color-warning-100); color: var(--color-warning-600); }

/* Status badges */
.badge-success { background: var(--color-success-100); color: var(--color-success-600); }
.badge-warning { background: var(--color-warning-100); color: var(--color-warning-600); }
.badge-error { background: var(--color-error-100); color: var(--color-error-600); }
.badge-info { background: var(--color-info-100); color: var(--color-info-600); }
.badge-neutral { background: var(--color-gray-100); color: var(--color-gray-600); }

/* Brand badge */
.badge-brand { 
  background: var(--color-teal-100); 
  color: var(--color-teal-600); 
}
```

### Navigation
```css
/* Top navigation bar */
.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-3) var(--spacing-6);
  background: var(--color-navy-900);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.navbar__logo {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  color: var(--text-inverse);
  font-weight: var(--font-bold);
  font-style: italic;
  font-size: var(--text-xl);
}

.navbar__links {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
}

.navbar__link {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--text-sm);
  color: rgba(255, 255, 255, 0.8);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.navbar__link:hover {
  color: var(--text-inverse);
  background: rgba(255, 255, 255, 0.1);
}

.navbar__link--active {
  color: var(--text-inverse);
  text-decoration: underline;
  text-underline-offset: 4px;
}

/* Sidebar navigation */
.sidenav {
  width: 260px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-subtle);
  height: 100%;
}

.sidenav__section {
  padding: var(--spacing-4);
  border-bottom: 1px solid var(--border-subtle);
}

.sidenav__title {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  margin-bottom: var(--spacing-2);
}

.sidenav__item {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.sidenav__item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidenav__item--active {
  background: var(--color-teal-50);
  color: var(--color-teal-600);
  font-weight: var(--font-medium);
}
```

### Tables (Global Pattern)
```css
.table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.table th {
  padding: var(--spacing-3) var(--spacing-4);
  text-align: left;
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-bottom: 2px solid var(--border-default);
  white-space: nowrap;
}

.table td {
  padding: var(--spacing-3) var(--spacing-4);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

.table tbody tr:hover {
  background: var(--bg-hover);
}

/* Numeric columns */
.table th.numeric,
.table td.numeric {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
}

/* Compact table */
.table-compact th,
.table-compact td {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--text-xs);
}

/* Striped table */
.table-striped tbody tr:nth-child(even) {
  background: var(--bg-secondary);
}
```

### Modals & Dialogs
```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(11, 24, 41, 0.6);
  backdrop-filter: blur(4px);
  z-index: var(--z-modal-backdrop);
}

.modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  background: var(--bg-primary);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-2xl);
  z-index: var(--z-modal);
  overflow: hidden;
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-4) var(--spacing-5);
  border-bottom: 1px solid var(--border-subtle);
}

.modal__title {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.modal__close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.modal__close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal__body {
  padding: var(--spacing-5);
  overflow-y: auto;
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-3);
  padding: var(--spacing-4) var(--spacing-5);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}
```

### Loading States
```css
/* Skeleton loader */
.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-gray-200) 25%,
    var(--color-gray-100) 50%,
    var(--color-gray-200) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: var(--radius-md);
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skeleton-text {
  height: 1em;
  margin-bottom: var(--spacing-2);
}

.skeleton-heading {
  height: 1.5em;
  width: 60%;
  margin-bottom: var(--spacing-3);
}

/* Spinner */
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--color-teal-500);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Loading overlay */
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(2px);
}
```

### Tooltips
```css
.tooltip {
  position: relative;
}

.tooltip__content {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  padding: var(--spacing-2) var(--spacing-3);
  background: var(--color-navy-900);
  color: var(--text-inverse);
  font-size: var(--text-xs);
  border-radius: var(--radius-md);
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition: all var(--transition-fast);
  z-index: var(--z-tooltip);
}

.tooltip__content::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: var(--color-navy-900);
}

.tooltip:hover .tooltip__content {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(-4px);
}
```

---

## Layout Patterns

### Page Layout
```css
.app-layout {
  display: flex;
  min-height: 100vh;
}

.app-sidebar {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
}

.app-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-6);
}
```

### Container Widths
```css
.container {
  width: 100%;
  margin-left: auto;
  margin-right: auto;
  padding-left: var(--spacing-4);
  padding-right: var(--spacing-4);
}

.container-sm { max-width: 640px; }
.container-md { max-width: 768px; }
.container-lg { max-width: 1024px; }
.container-xl { max-width: 1280px; }
.container-2xl { max-width: 1536px; }
```

### Grid System
```css
.grid {
  display: grid;
  gap: var(--spacing-6);
}

.grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
.grid-cols-3 { grid-template-columns: repeat(3, 1fr); }
.grid-cols-4 { grid-template-columns: repeat(4, 1fr); }

@media (max-width: 1024px) {
  .grid-cols-3, .grid-cols-4 {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .grid-cols-2, .grid-cols-3, .grid-cols-4 {
    grid-template-columns: 1fr;
  }
}
```

---

## Animation Utilities
```css
/* Fade in */
.animate-fade-in {
  animation: fadeIn var(--transition-base) ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Slide up */
.animate-slide-up {
  animation: slideUp var(--transition-base) ease-out;
}

@keyframes slideUp {
  from { 
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Scale in */
.animate-scale-in {
  animation: scaleIn var(--transition-fast) ease-out;
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Hover lift */
.hover-lift {
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}

.hover-lift:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}
```

---

## Responsive Breakpoints
```css
/* Mobile first approach */
/* sm: 640px */
/* md: 768px */
/* lg: 1024px */
/* xl: 1280px */
/* 2xl: 1536px */

@media (max-width: 1024px) {
  .app-sidebar {
    position: fixed;
    left: -260px;
    z-index: var(--z-fixed);
    transition: left var(--transition-slow);
  }
  
  .app-sidebar--open {
    left: 0;
  }
}

@media (max-width: 640px) {
  .app-content {
    padding: var(--spacing-4);
  }
  
  .btn-lg {
    width: 100%;
  }
}
```

---

## Implementation Checklist

### Phase 1 - Foundation
- [ ] Import CSS variables into global stylesheet
- [ ] Set up font loading (Inter, JetBrains Mono)
- [ ] Apply base typography styles
- [ ] Set up color scheme toggle (light/dark)

### Phase 2 - Core Components
- [ ] Button variants
- [ ] Form inputs
- [ ] Cards
- [ ] Badges
- [ ] Navigation (navbar, sidenav)

### Phase 3 - Data Display
- [ ] Tables (standard, compact, striped)
- [ ] Loading states (skeletons, spinners)
- [ ] Empty states

### Phase 4 - Overlays & Feedback
- [ ] Modals
- [ ] Tooltips
- [ ] Toast notifications
- [ ] Dropdown menus

### Phase 5 - Polish
- [ ] Animation utilities
- [ ] Responsive adjustments
- [ ] Accessibility audit (focus states, contrast)
- [ ] Performance optimization
