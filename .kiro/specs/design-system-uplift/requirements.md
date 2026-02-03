# FundLens.ai Design System Uplift - Requirements

## Overview
Apply the FundLens.ai brand identity consistently across the entire webapp, establishing a professional PE/financial services platform with deep navy sophistication, clean typography, and the distinctive wave pattern motif.

## Brand DNA
- **Professional PE/financial services platform** with deep navy sophistication
- **Clean typography** using Inter and JetBrains Mono
- **Distinctive wave pattern motif** from fundlens.ai marketing site
- **Institutional-grade yet modern** - trustworthy for deal teams, polished to impress
- **Navy + Teal color palette** with semantic colors for status indicators

## Source Document
Reference: `/Users/deccanajay/Documents/fundlens-parsing-develop/fundlens-webapp-style-uplift-prompt.md`

## Scope
This is **PROMPT 1 OF 2** - establishes the global design system foundation that all features will inherit.

### In Scope
1. Global design tokens (colors, typography, spacing, shadows, etc.)
2. Core component patterns (buttons, forms, cards, badges, navigation)
3. Data display components (tables, loading states, empty states)
4. Overlay components (modals, tooltips, dropdowns)
5. Layout patterns and responsive breakpoints
6. Animation utilities
7. Dark mode support

### Out of Scope (for now)
- Feature-specific refinements (covered in Prompt 2)
- Backend changes
- API modifications
- Database schema changes

## Design Token Categories

### 1. Color System
- **Primary Navy Palette**: 950, 900, 800, 700, 600, 500
- **Teal/Blue Accent Palette**: 600, 500, 400, 300, 200, 100, 50
- **Semantic Colors**: Success (green), Warning (amber), Error (red), Info (blue)
- **Neutral Colors**: White, Gray 50-900
- **Applied Tokens**: Backgrounds, text, borders
- **Gradients**: Hero, subtle, card hover, button

### 2. Typography
- **Font Families**: Inter (sans), JetBrains Mono (mono)
- **Font Sizes**: xs (12px) to 5xl (48px)
- **Font Weights**: 400, 500, 600, 700
- **Line Heights**: none, tight, snug, normal, relaxed, loose
- **Letter Spacing**: tighter to wider

### 3. Spacing Scale
- 0 to 24 (0px to 96px) using consistent increments

### 4. Border Radius
- none, sm, md, lg, xl, 2xl, 3xl, full

### 5. Shadows
- xs, sm, md, lg, xl, 2xl, inner
- Focus shadows for accessibility

### 6. Transitions
- fast (150ms), base (200ms), slow (300ms), slower (500ms)

### 7. Z-Index Scale
- dropdown (10), sticky (20), fixed (30), modal-backdrop (40), modal (50), popover (60), tooltip (70)

## Component Patterns

### Buttons
- **Variants**: primary (navy), secondary (outline), accent (teal), ghost, danger
- **Modifiers**: pill, icon-only
- **Sizes**: sm, base, lg
- **States**: hover, focus, disabled, active

### Form Inputs
- **Types**: text, textarea, select
- **Features**: icon support, validation states (error, success)
- **Components**: label, helper text, input group

### Cards
- **Variants**: default, interactive, navy header
- **Sections**: header, body, footer
- **States**: hover effects, elevation changes

### Badges
- **Types**: filing type (10-K, 10-Q, 8-K), status (success, warning, error, info, neutral), brand
- **Style**: pill-shaped, color-coded

### Navigation
- **Top navbar**: Navy background, logo, links, active states
- **Sidebar**: Collapsible, sections, active states
- **Responsive**: Mobile drawer behavior

### Tables
- **Variants**: standard, compact, striped
- **Features**: numeric columns (right-aligned, monospace), hover states, sorting indicators

### Modals & Dialogs
- **Components**: backdrop, header, body, footer, close button
- **Features**: backdrop blur, focus trap, ESC to close

### Loading States
- **Skeleton loaders**: shimmer animation
- **Spinners**: rotating border
- **Overlay**: semi-transparent with blur

### Tooltips
- **Position**: top, bottom, left, right
- **Style**: Navy background, white text, arrow pointer

## Layout Patterns

### Page Layout
- **Structure**: sidebar + main content area
- **Responsive**: Collapsible sidebar on mobile

### Container Widths
- sm (640px), md (768px), lg (1024px), xl (1280px), 2xl (1536px)

### Grid System
- 2, 3, 4 column layouts
- Responsive breakpoints

## Dark Mode Support
- Complete token overrides for dark theme
- Toggle mechanism
- Persistent preference

## Accessibility Requirements
- WCAG 2.1 AA compliance
- Focus indicators on all interactive elements
- Sufficient color contrast ratios
- Keyboard navigation support
- Screen reader friendly markup

## Browser Support
- Chrome/Edge (last 2 versions)
- Firefox (last 2 versions)
- Safari (last 2 versions)
- Mobile browsers (iOS Safari, Chrome Android)

## Performance Targets
- CSS bundle < 50KB (gzipped)
- No layout shifts (CLS < 0.1)
- Fast paint times (FCP < 1.5s)

## Implementation Priority

### Phase 1 - Foundation (Critical)
1. Import CSS variables into global stylesheet
2. Set up font loading (Inter, JetBrains Mono)
3. Apply base typography styles
4. Set up color scheme toggle (light/dark)

### Phase 2 - Core Components (High)
1. Button variants
2. Form inputs
3. Cards
4. Badges
5. Navigation (navbar, sidenav)

### Phase 3 - Data Display (High)
1. Tables (standard, compact, striped)
2. Loading states (skeletons, spinners)
3. Empty states

### Phase 4 - Overlays & Feedback (Medium)
1. Modals
2. Tooltips
3. Toast notifications
4. Dropdown menus

### Phase 5 - Polish (Low)
1. Animation utilities
2. Responsive adjustments
3. Accessibility audit (focus states, contrast)
4. Performance optimization

## Success Criteria
- [ ] All pages use design tokens consistently
- [ ] No hardcoded colors, spacing, or typography values
- [ ] Dark mode works across all pages
- [ ] All interactive elements have proper focus states
- [ ] Responsive design works on mobile, tablet, desktop
- [ ] Brand identity is consistent with fundlens.ai marketing site
- [ ] Performance targets met
- [ ] Accessibility requirements met

## Files to Update

### Global Styles
- Create: `public/css/design-system.css` (new global stylesheet)
- Update: All HTML files to include new stylesheet

### Pages to Update (Priority Order)
1. **Research Assistant** (`public/app/research/index.html`)
2. **Deal Workspace** (`public/app/deals/workspace.html`)
3. **Deal Dashboard** (`public/deal-dashboard.html`)
4. **Deal Analysis** (`public/deal-analysis.html`)
5. **Financial Analysis** (`public/financial-analysis.html`)
6. **Login** (`public/login.html`)
7. **Main Dashboard** (`public/fundlens-main.html`)
8. **Admin Tools** (`public/internal/platform-admin.html`)
9. All other pages

### Components to Update
- Navigation component (`public/components/research-navigation.html`)
- Any shared UI components

## Notes
- This is a visual/CSS-only update - no backend changes required
- Existing functionality must remain intact
- Can be deployed incrementally (page by page)
- Should not break any existing features
- Focus on consistency and polish
