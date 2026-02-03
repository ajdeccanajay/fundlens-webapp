# FundLens.ai Design System Uplift - Design Document

## Architecture Overview

### Design Token System
We'll implement a CSS custom properties (variables) based design system that provides:
- Single source of truth for all design decisions
- Easy theme switching (light/dark mode)
- Consistent spacing, typography, and colors
- Maintainable and scalable styling

### File Structure
```
public/
├── css/
│   ├── design-system.css          # Core design tokens and utilities
│   ├── components/
│   │   ├── buttons.css            # Button component styles
│   │   ├── forms.css              # Form component styles
│   │   ├── cards.css              # Card component styles
│   │   ├── badges.css             # Badge component styles
│   │   ├── navigation.css         # Navigation component styles
│   │   ├── tables.css             # Table component styles
│   │   ├── modals.css             # Modal component styles
│   │   └── loading.css            # Loading state styles
│   └── utilities/
│       ├── layout.css             # Layout utilities
│       ├── spacing.css            # Spacing utilities
│       └── animations.css         # Animation utilities
```

## Design Token Implementation

### Color Token Strategy
```css
:root {
  /* Raw color values */
  --color-navy-900: #0B1829;
  --color-teal-500: #1E5A7A;
  
  /* Semantic tokens (light mode) */
  --bg-primary: var(--color-white);
  --text-primary: var(--color-navy-900);
  --border-default: var(--color-gray-300);
}

[data-theme="dark"] {
  /* Semantic tokens (dark mode) */
  --bg-primary: var(--color-navy-900);
  --text-primary: var(--color-gray-50);
  --border-default: var(--color-navy-600);
}
```

**Benefits:**
- Components reference semantic tokens (`--bg-primary`)
- Theme switching only updates semantic tokens
- Raw colors remain constant
- Easy to maintain and extend

### Typography System
```css
:root {
  /* Font families */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', monospace;
  
  /* Type scale */
  --text-xs: 0.75rem;    /* 12px */
  --text-sm: 0.875rem;   /* 14px */
  --text-base: 1rem;     /* 16px */
  --text-lg: 1.125rem;   /* 18px */
  --text-xl: 1.25rem;    /* 20px */
  
  /* Font weights */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
}
```

### Spacing System
8px base unit with consistent scale:
```css
:root {
  --spacing-1: 0.25rem;   /* 4px */
  --spacing-2: 0.5rem;    /* 8px */
  --spacing-3: 0.75rem;   /* 12px */
  --spacing-4: 1rem;      /* 16px */
  --spacing-5: 1.25rem;   /* 20px */
  --spacing-6: 1.5rem;    /* 24px */
  --spacing-8: 2rem;      /* 32px */
  --spacing-10: 2.5rem;   /* 40px */
  --spacing-12: 3rem;     /* 48px */
}
```

## Component Design Patterns

### Button Component
```html
<!-- Primary button -->
<button class="btn btn-primary">
  Create Deal
</button>

<!-- Secondary button -->
<button class="btn btn-secondary">
  Cancel
</button>

<!-- Accent button (teal) -->
<button class="btn btn-accent">
  Start Analysis
</button>

<!-- Icon button -->
<button class="btn btn-icon btn-ghost">
  <svg>...</svg>
</button>

<!-- Pill button (CTA style) -->
<button class="btn btn-primary btn-pill">
  Contact us
</button>
```

**CSS Implementation:**
```css
.btn {
  /* Base styles */
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2-5) var(--spacing-4);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  border-radius: var(--radius-lg);
  transition: all var(--transition-fast);
}

.btn-primary {
  background: var(--color-navy-900);
  color: var(--text-inverse);
}

.btn-primary:hover {
  background: var(--color-navy-700);
}
```

### Card Component
```html
<!-- Standard card -->
<div class="card">
  <div class="card__header">
    <h3 class="card__title">Deal Overview</h3>
  </div>
  <div class="card__body">
    <p>Content goes here...</p>
  </div>
  <div class="card__footer">
    <button class="btn btn-secondary">View Details</button>
  </div>
</div>

<!-- Interactive card (hover effects) -->
<div class="card card--interactive">
  <div class="card__body">
    <h4>AMGN</h4>
    <p>Amgen Inc.</p>
  </div>
</div>

<!-- Navy header card -->
<div class="card">
  <div class="card__header card__header--navy">
    <h3 class="card__title">Financial Metrics</h3>
  </div>
  <div class="card__body">
    <p>Metrics content...</p>
  </div>
</div>
```

### Form Component
```html
<div class="form-group">
  <label class="label" for="ticker">
    Ticker Symbol
  </label>
  <div class="input-group">
    <span class="input-group__icon">
      <svg>...</svg>
    </span>
    <input 
      type="text" 
      id="ticker" 
      class="input" 
      placeholder="e.g., AAPL"
    />
  </div>
  <span class="helper-text">
    Enter a valid stock ticker symbol
  </span>
</div>

<!-- Error state -->
<div class="form-group">
  <label class="label" for="ticker-error">
    Ticker Symbol
  </label>
  <input 
    type="text" 
    id="ticker-error" 
    class="input input-error" 
    value="INVALID"
  />
  <span class="helper-text helper-text-error">
    Ticker not found
  </span>
</div>
```

### Table Component
```html
<div class="table-wrapper">
  <table class="table">
    <thead>
      <tr>
        <th>Metric</th>
        <th class="numeric">FY 2023</th>
        <th class="numeric">FY 2024</th>
        <th class="numeric">Change</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Revenue</td>
        <td class="numeric">$26.4B</td>
        <td class="numeric">$28.1B</td>
        <td class="numeric">+6.4%</td>
      </tr>
    </tbody>
  </table>
</div>
```

### Badge Component
```html
<!-- Filing type badges -->
<span class="badge badge-10k">10-K</span>
<span class="badge badge-10q">10-Q</span>
<span class="badge badge-8k">8-K</span>

<!-- Status badges -->
<span class="badge badge-success">Complete</span>
<span class="badge badge-warning">Processing</span>
<span class="badge badge-error">Failed</span>
<span class="badge badge-info">New</span>
```

### Navigation Component
```html
<!-- Top navbar -->
<nav class="navbar">
  <div class="navbar__logo">
    <span style="font-style: italic; font-weight: bold;">FundLens</span>
  </div>
  <div class="navbar__links">
    <a href="/research" class="navbar__link navbar__link--active">
      Research
    </a>
    <a href="/deals" class="navbar__link">
      Deals
    </a>
    <a href="/settings" class="navbar__link">
      Settings
    </a>
  </div>
</nav>

<!-- Sidebar navigation -->
<aside class="sidenav">
  <div class="sidenav__section">
    <h4 class="sidenav__title">Workspaces</h4>
    <a href="#" class="sidenav__item sidenav__item--active">
      <svg>...</svg>
      <span>My Research</span>
    </a>
    <a href="#" class="sidenav__item">
      <svg>...</svg>
      <span>Shared</span>
    </a>
  </div>
</aside>
```

### Modal Component
```html
<!-- Modal backdrop -->
<div class="modal-backdrop"></div>

<!-- Modal -->
<div class="modal">
  <div class="modal__header">
    <h3 class="modal__title">Create New Deal</h3>
    <button class="modal__close">
      <svg>...</svg>
    </button>
  </div>
  <div class="modal__body">
    <p>Modal content goes here...</p>
  </div>
  <div class="modal__footer">
    <button class="btn btn-secondary">Cancel</button>
    <button class="btn btn-primary">Create</button>
  </div>
</div>
```

### Loading States
```html
<!-- Skeleton loader -->
<div class="skeleton skeleton-heading"></div>
<div class="skeleton skeleton-text"></div>
<div class="skeleton skeleton-text"></div>

<!-- Spinner -->
<div class="spinner"></div>

<!-- Loading overlay -->
<div class="loading-overlay">
  <div class="spinner"></div>
</div>
```

## Layout Patterns

### App Layout
```html
<div class="app-layout">
  <!-- Sidebar -->
  <aside class="app-sidebar">
    <nav class="sidenav">
      <!-- Navigation content -->
    </nav>
  </aside>
  
  <!-- Main content area -->
  <main class="app-main">
    <!-- Header -->
    <header class="app-header">
      <nav class="navbar">
        <!-- Top navigation -->
      </nav>
    </header>
    
    <!-- Content -->
    <div class="app-content">
      <!-- Page content -->
    </div>
  </main>
</div>
```

### Grid Layout
```html
<div class="container-xl">
  <div class="grid grid-cols-3">
    <div class="card">Card 1</div>
    <div class="card">Card 2</div>
    <div class="card">Card 3</div>
  </div>
</div>
```

## Dark Mode Implementation

### Toggle Mechanism
```html
<button id="theme-toggle" class="btn btn-icon btn-ghost">
  <svg class="theme-icon-light">☀️</svg>
  <svg class="theme-icon-dark">🌙</svg>
</button>

<script>
const themeToggle = document.getElementById('theme-toggle');
const html = document.documentElement;

// Load saved theme
const savedTheme = localStorage.getItem('theme') || 'light';
html.setAttribute('data-theme', savedTheme);

// Toggle theme
themeToggle.addEventListener('click', () => {
  const currentTheme = html.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
});
</script>
```

## Responsive Design Strategy

### Breakpoints
- **Mobile**: < 640px
- **Tablet**: 640px - 1024px
- **Desktop**: > 1024px

### Mobile-First Approach
```css
/* Mobile styles (default) */
.grid {
  grid-template-columns: 1fr;
}

/* Tablet and up */
@media (min-width: 640px) {
  .grid-cols-2 {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* Desktop and up */
@media (min-width: 1024px) {
  .grid-cols-3 {
    grid-template-columns: repeat(3, 1fr);
  }
}
```

### Sidebar Behavior
- **Desktop**: Always visible, fixed width (260px)
- **Mobile**: Hidden by default, slides in as drawer

## Animation Guidelines

### Transition Timing
- **Fast (150ms)**: Hover states, focus indicators
- **Base (200ms)**: Button clicks, input focus
- **Slow (300ms)**: Modal open/close, drawer slide
- **Slower (500ms)**: Page transitions

### Animation Principles
1. **Purposeful**: Animations should provide feedback or guide attention
2. **Subtle**: Avoid distracting or excessive motion
3. **Performant**: Use transform and opacity for smooth 60fps animations
4. **Respectful**: Honor `prefers-reduced-motion` user preference

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Accessibility Considerations

### Focus Indicators
All interactive elements must have visible focus states:
```css
.btn:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
```

### Color Contrast
- **Text on light background**: Minimum 4.5:1 ratio
- **Text on dark background**: Minimum 4.5:1 ratio
- **Large text (18px+)**: Minimum 3:1 ratio

### Keyboard Navigation
- Tab order follows visual order
- All interactive elements are keyboard accessible
- Modal focus trap implemented
- ESC key closes modals and dropdowns

### Screen Reader Support
- Semantic HTML elements
- ARIA labels where needed
- Hidden content properly marked
- Loading states announced

## Performance Optimization

### CSS Strategy
1. **Critical CSS**: Inline above-the-fold styles
2. **Lazy load**: Non-critical styles loaded async
3. **Minification**: Production CSS minified and gzipped
4. **Purging**: Remove unused styles in production

### Font Loading
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### Image Optimization
- Use WebP format with fallbacks
- Lazy load images below the fold
- Provide appropriate sizes for responsive images

## Migration Strategy

### Phase 1: Foundation Setup
1. Create `public/css/design-system.css` with all tokens
2. Add font loading to HTML head
3. Test token system in isolation

### Phase 2: Component Library
1. Build component CSS files
2. Create component documentation/examples
3. Test components in isolation

### Phase 3: Page Migration
1. Start with Research Assistant (highest priority)
2. Migrate one page at a time
3. Test thoroughly before moving to next page
4. Keep old styles as fallback during migration

### Phase 4: Cleanup
1. Remove old/unused CSS
2. Optimize and minify
3. Performance audit
4. Accessibility audit

## Testing Checklist

### Visual Testing
- [ ] All pages render correctly in light mode
- [ ] All pages render correctly in dark mode
- [ ] Responsive design works on mobile, tablet, desktop
- [ ] All interactive states work (hover, focus, active, disabled)
- [ ] Loading states display correctly
- [ ] Empty states display correctly

### Functional Testing
- [ ] Theme toggle works and persists
- [ ] All buttons are clickable
- [ ] All forms are submittable
- [ ] All modals open and close
- [ ] All navigation links work
- [ ] Keyboard navigation works

### Accessibility Testing
- [ ] Focus indicators visible on all interactive elements
- [ ] Color contrast meets WCAG AA standards
- [ ] Screen reader can navigate all content
- [ ] Keyboard-only navigation works
- [ ] ARIA labels present where needed

### Performance Testing
- [ ] CSS bundle size < 50KB gzipped
- [ ] No layout shifts (CLS < 0.1)
- [ ] Fast paint times (FCP < 1.5s)
- [ ] Fonts load without FOIT/FOUT

## Documentation

### Component Documentation
Each component should have:
- Visual examples
- HTML markup
- CSS classes
- Variants and modifiers
- Usage guidelines
- Accessibility notes

### Token Documentation
- Color palette with hex values
- Typography scale with pixel values
- Spacing scale with pixel values
- Usage examples for each token

## Maintenance Plan

### Regular Reviews
- Quarterly design system audit
- Remove unused components/tokens
- Update documentation
- Performance optimization

### Version Control
- Semantic versioning for design system
- Changelog for breaking changes
- Migration guides for major updates

### Contribution Guidelines
- How to propose new components
- How to modify existing components
- Testing requirements
- Documentation requirements
