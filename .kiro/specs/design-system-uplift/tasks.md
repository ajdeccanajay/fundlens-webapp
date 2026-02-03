# FundLens.ai Design System Uplift - Tasks

## Phase 1: Foundation Setup ⚡ CRITICAL

### Task 1.1: Create Design System CSS File
- [ ] Create `public/css/design-system.css`
- [ ] Add all CSS custom properties from source document
- [ ] Organize into logical sections (colors, typography, spacing, etc.)
- [ ] Add comments for each section
- [ ] Include both light and dark mode tokens

**Files:**
- `public/css/design-system.css` (new)

**Acceptance Criteria:**
- All design tokens defined
- Light and dark mode tokens complete
- File is well-organized and commented
- No syntax errors

---

### Task 1.2: Set Up Font Loading
- [ ] Add Google Fonts link for Inter and JetBrains Mono
- [ ] Add preconnect hints for performance
- [ ] Set font-display: swap for better UX
- [ ] Test font loading in browser

**Files:**
- All HTML files (add to `<head>`)

**Acceptance Criteria:**
- Fonts load correctly
- No FOIT (Flash of Invisible Text)
- Preconnect hints improve performance

---

### Task 1.3: Create Base Typography Styles
- [ ] Set base font family on body
- [ ] Define heading styles (h1-h6)
- [ ] Define paragraph styles
- [ ] Define link styles
- [ ] Define code/pre styles

**Files:**
- `public/css/design-system.css`

**Acceptance Criteria:**
- Typography is consistent across all pages
- Headings use correct font weights
- Links have proper hover states
- Code blocks use monospace font

---

### Task 1.4: Implement Theme Toggle
- [ ] Create theme toggle button component
- [ ] Add JavaScript for theme switching
- [ ] Store theme preference in localStorage
- [ ] Load saved theme on page load
- [ ] Add theme toggle to navbar

**Files:**
- `public/css/design-system.css`
- `public/js/theme-toggle.js` (new)
- All HTML files (add toggle button)

**Acceptance Criteria:**
- Theme toggle works
- Theme preference persists across page loads
- Smooth transition between themes
- No flash of wrong theme on load

---

## Phase 2: Core Components 🎨 HIGH PRIORITY

### Task 2.1: Button Components
- [ ] Create button base styles
- [ ] Create button variants (primary, secondary, accent, ghost, danger)
- [ ] Create button sizes (sm, base, lg)
- [ ] Create button modifiers (pill, icon-only)
- [ ] Add focus states for accessibility
- [ ] Add disabled states
- [ ] Test all combinations

**Files:**
- `public/css/components/buttons.css` (new)

**Acceptance Criteria:**
- All button variants work
- Hover/focus/active states work
- Disabled state prevents interaction
- Buttons are keyboard accessible

---

### Task 2.2: Form Input Components
- [ ] Create input base styles
- [ ] Create input variants (text, textarea, select)
- [ ] Create input states (error, success, disabled)
- [ ] Create input group with icon support
- [ ] Create label and helper text styles
- [ ] Add focus states for accessibility
- [ ] Test all combinations

**Files:**
- `public/css/components/forms.css` (new)

**Acceptance Criteria:**
- All input types work
- Validation states display correctly
- Icons align properly
- Forms are keyboard accessible

---

### Task 2.3: Card Components
- [ ] Create card base styles
- [ ] Create card sections (header, body, footer)
- [ ] Create card variants (default, interactive, navy header)
- [ ] Add hover effects for interactive cards
- [ ] Test all combinations

**Files:**
- `public/css/components/cards.css` (new)

**Acceptance Criteria:**
- Cards display correctly
- Hover effects work smoothly
- Navy header variant works
- Cards are responsive

---

### Task 2.4: Badge Components
- [ ] Create badge base styles
- [ ] Create filing type badges (10-K, 10-Q, 8-K)
- [ ] Create status badges (success, warning, error, info, neutral)
- [ ] Create brand badge
- [ ] Test all combinations

**Files:**
- `public/css/components/badges.css` (new)

**Acceptance Criteria:**
- All badge types display correctly
- Colors match design system
- Badges are pill-shaped
- Text is readable

---

### Task 2.5: Navigation Components
- [ ] Create navbar styles
- [ ] Create navbar logo styles
- [ ] Create navbar link styles with active state
- [ ] Create sidebar navigation styles
- [ ] Create sidebar section styles
- [ ] Create sidebar item styles with active state
- [ ] Add responsive behavior (mobile drawer)
- [ ] Test navigation on all screen sizes

**Files:**
- `public/css/components/navigation.css` (new)

**Acceptance Criteria:**
- Navbar displays correctly
- Sidebar displays correctly
- Active states work
- Mobile drawer works
- Navigation is keyboard accessible

---

## Phase 3: Data Display Components 📊 HIGH PRIORITY

### Task 3.1: Table Components
- [ ] Create table base styles
- [ ] Create table wrapper for overflow
- [ ] Create table variants (standard, compact, striped)
- [ ] Create numeric column styles (right-aligned, monospace)
- [ ] Add hover states for rows
- [ ] Test tables with various data

**Files:**
- `public/css/components/tables.css` (new)

**Acceptance Criteria:**
- Tables display correctly
- Numeric columns align right
- Hover states work
- Tables are responsive (horizontal scroll)

---

### Task 3.2: Loading State Components
- [ ] Create skeleton loader styles with shimmer animation
- [ ] Create spinner styles
- [ ] Create loading overlay styles
- [ ] Test loading states in various contexts

**Files:**
- `public/css/components/loading.css` (new)

**Acceptance Criteria:**
- Skeleton loaders animate smoothly
- Spinners rotate correctly
- Loading overlays block interaction
- Animations respect prefers-reduced-motion

---

### Task 3.3: Empty State Components
- [ ] Create empty state container styles
- [ ] Create empty state icon styles
- [ ] Create empty state text styles
- [ ] Create empty state action button styles
- [ ] Test empty states in various contexts

**Files:**
- `public/css/components/empty-states.css` (new)

**Acceptance Criteria:**
- Empty states are centered and styled
- Icons display correctly
- Text is readable
- Action buttons work

---

## Phase 4: Overlays & Feedback 🔔 MEDIUM PRIORITY

### Task 4.1: Modal Components
- [ ] Create modal backdrop styles
- [ ] Create modal container styles
- [ ] Create modal sections (header, body, footer)
- [ ] Create modal close button styles
- [ ] Add modal animations (fade in/out, scale)
- [ ] Test modals on various screen sizes

**Files:**
- `public/css/components/modals.css` (new)

**Acceptance Criteria:**
- Modals display correctly
- Backdrop blocks interaction
- Close button works
- Animations are smooth
- Modals are keyboard accessible (ESC to close)

---

### Task 4.2: Tooltip Components
- [ ] Create tooltip base styles
- [ ] Create tooltip arrow styles
- [ ] Add tooltip positioning (top, bottom, left, right)
- [ ] Add tooltip animations (fade in/out)
- [ ] Test tooltips in various contexts

**Files:**
- `public/css/components/tooltips.css` (new)

**Acceptance Criteria:**
- Tooltips display on hover
- Arrows point to trigger element
- Positioning works correctly
- Animations are smooth

---

### Task 4.3: Toast Notification Components
- [ ] Create toast container styles
- [ ] Create toast variants (success, warning, error, info)
- [ ] Add toast animations (slide in/out)
- [ ] Create toast close button styles
- [ ] Test toasts with various messages

**Files:**
- `public/css/components/toasts.css` (new)
- `public/js/toast.js` (new)

**Acceptance Criteria:**
- Toasts display in correct position
- Variants have correct colors
- Animations are smooth
- Auto-dismiss works
- Close button works

---

### Task 4.4: Dropdown Menu Components
- [ ] Create dropdown container styles
- [ ] Create dropdown item styles
- [ ] Create dropdown divider styles
- [ ] Add dropdown animations (fade in/out)
- [ ] Test dropdowns in various contexts

**Files:**
- `public/css/components/dropdowns.css` (new)

**Acceptance Criteria:**
- Dropdowns display correctly
- Items are clickable
- Dividers separate sections
- Animations are smooth
- Dropdowns close on outside click

---

## Phase 5: Layout & Utilities 📐 MEDIUM PRIORITY

### Task 5.1: Layout Utilities
- [ ] Create app layout styles (sidebar + main)
- [ ] Create container width utilities
- [ ] Create grid system utilities
- [ ] Add responsive breakpoints
- [ ] Test layouts on all screen sizes

**Files:**
- `public/css/utilities/layout.css` (new)

**Acceptance Criteria:**
- App layout works correctly
- Containers have correct max-widths
- Grid system is responsive
- Sidebar collapses on mobile

---

### Task 5.2: Spacing Utilities
- [ ] Create margin utilities (m-1, m-2, etc.)
- [ ] Create padding utilities (p-1, p-2, etc.)
- [ ] Create gap utilities for flexbox/grid
- [ ] Test spacing utilities in various contexts

**Files:**
- `public/css/utilities/spacing.css` (new)

**Acceptance Criteria:**
- Spacing utilities work correctly
- Values match design system
- Utilities are responsive

---

### Task 5.3: Animation Utilities
- [ ] Create fade-in animation
- [ ] Create slide-up animation
- [ ] Create scale-in animation
- [ ] Create hover-lift utility
- [ ] Add prefers-reduced-motion support
- [ ] Test animations in various contexts

**Files:**
- `public/css/utilities/animations.css` (new)

**Acceptance Criteria:**
- Animations are smooth
- Timing is correct
- Reduced motion preference is respected
- Animations don't cause layout shifts

---

## Phase 6: Page Migration 🚀 HIGH PRIORITY

### Task 6.1: Migrate Research Assistant Page
- [ ] Add design system CSS to page
- [ ] Update HTML to use new component classes
- [ ] Update inline styles to use design tokens
- [ ] Test all functionality
- [ ] Test responsive design
- [ ] Test dark mode
- [ ] Test accessibility

**Files:**
- `public/app/research/index.html`

**Acceptance Criteria:**
- Page uses design system consistently
- All functionality works
- Responsive design works
- Dark mode works
- Accessibility is maintained

---

### Task 6.2: Migrate Deal Workspace Page
- [ ] Add design system CSS to page
- [ ] Update HTML to use new component classes
- [ ] Update inline styles to use design tokens
- [ ] Test all functionality
- [ ] Test responsive design
- [ ] Test dark mode
- [ ] Test accessibility

**Files:**
- `public/app/deals/workspace.html`

**Acceptance Criteria:**
- Page uses design system consistently
- All functionality works
- Responsive design works
- Dark mode works
- Accessibility is maintained

---

### Task 6.3: Migrate Deal Dashboard Page
- [ ] Add design system CSS to page
- [ ] Update HTML to use new component classes
- [ ] Update inline styles to use design tokens
- [ ] Test all functionality
- [ ] Test responsive design
- [ ] Test dark mode
- [ ] Test accessibility

**Files:**
- `public/deal-dashboard.html`

**Acceptance Criteria:**
- Page uses design system consistently
- All functionality works
- Responsive design works
- Dark mode works
- Accessibility is maintained

---

### Task 6.4: Migrate Deal Analysis Page
- [ ] Add design system CSS to page
- [ ] Update HTML to use new component classes
- [ ] Update inline styles to use design tokens
- [ ] Test all functionality
- [ ] Test responsive design
- [ ] Test dark mode
- [ ] Test accessibility

**Files:**
- `public/deal-analysis.html`

**Acceptance Criteria:**
- Page uses design system consistently
- All functionality works
- Responsive design works
- Dark mode works
- Accessibility is maintained

---

### Task 6.5: Migrate Financial Analysis Page
- [ ] Add design system CSS to page
- [ ] Update HTML to use new component classes
- [ ] Update inline styles to use design tokens
- [ ] Test all functionality
- [ ] Test responsive design
- [ ] Test dark mode
- [ ] Test accessibility

**Files:**
- `public/financial-analysis.html`

**Acceptance Criteria:**
- Page uses design system consistently
- All functionality works
- Responsive design works
- Dark mode works
- Accessibility is maintained

---

### Task 6.6: Migrate Login Page
- [ ] Add design system CSS to page
- [ ] Update HTML to use new component classes
- [ ] Update inline styles to use design tokens
- [ ] Test all functionality
- [ ] Test responsive design
- [ ] Test dark mode
- [ ] Test accessibility

**Files:**
- `public/login.html`

**Acceptance Criteria:**
- Page uses design system consistently
- All functionality works
- Responsive design works
- Dark mode works
- Accessibility is maintained

---

### Task 6.7: Migrate Main Dashboard Page
- [ ] Add design system CSS to page
- [ ] Update HTML to use new component classes
- [ ] Update inline styles to use design tokens
- [ ] Test all functionality
- [ ] Test responsive design
- [ ] Test dark mode
- [ ] Test accessibility

**Files:**
- `public/fundlens-main.html`

**Acceptance Criteria:**
- Page uses design system consistently
- All functionality works
- Responsive design works
- Dark mode works
- Accessibility is maintained

---

### Task 6.8: Migrate Admin Tools Page
- [ ] Add design system CSS to page
- [ ] Update HTML to use new component classes
- [ ] Update inline styles to use design tokens
- [ ] Test all functionality
- [ ] Test responsive design
- [ ] Test dark mode
- [ ] Test accessibility

**Files:**
- `public/internal/platform-admin.html`

**Acceptance Criteria:**
- Page uses design system consistently
- All functionality works
- Responsive design works
- Dark mode works
- Accessibility is maintained

---

### Task 6.9: Migrate Remaining Pages
- [ ] Identify all remaining HTML pages
- [ ] Migrate each page following same process
- [ ] Test all functionality
- [ ] Test responsive design
- [ ] Test dark mode
- [ ] Test accessibility

**Files:**
- All remaining HTML files in `public/`

**Acceptance Criteria:**
- All pages use design system consistently
- All functionality works
- Responsive design works
- Dark mode works
- Accessibility is maintained

---

## Phase 7: Polish & Optimization ✨ LOW PRIORITY

### Task 7.1: Accessibility Audit
- [ ] Run automated accessibility tests (axe, Lighthouse)
- [ ] Manual keyboard navigation testing
- [ ] Screen reader testing
- [ ] Color contrast verification
- [ ] Fix any issues found
- [ ] Document accessibility features

**Acceptance Criteria:**
- WCAG 2.1 AA compliance
- All interactive elements keyboard accessible
- All images have alt text
- Color contrast meets standards
- Screen reader can navigate all content

---

### Task 7.2: Performance Optimization
- [ ] Minify CSS files
- [ ] Remove unused CSS
- [ ] Optimize font loading
- [ ] Measure and optimize bundle size
- [ ] Run Lighthouse performance audit
- [ ] Fix any issues found

**Acceptance Criteria:**
- CSS bundle < 50KB gzipped
- No layout shifts (CLS < 0.1)
- Fast paint times (FCP < 1.5s)
- Lighthouse score > 90

---

### Task 7.3: Responsive Design Testing
- [ ] Test on mobile devices (iOS, Android)
- [ ] Test on tablets (iPad, Android tablets)
- [ ] Test on desktop (various screen sizes)
- [ ] Test on different browsers (Chrome, Firefox, Safari, Edge)
- [ ] Fix any layout issues
- [ ] Document responsive breakpoints

**Acceptance Criteria:**
- All pages work on mobile
- All pages work on tablet
- All pages work on desktop
- All pages work in all browsers
- No horizontal scrolling on mobile

---

### Task 7.4: Dark Mode Polish
- [ ] Review all pages in dark mode
- [ ] Adjust colors for better contrast
- [ ] Fix any visual issues
- [ ] Test theme toggle on all pages
- [ ] Ensure smooth transitions

**Acceptance Criteria:**
- Dark mode looks good on all pages
- Color contrast is sufficient
- No visual glitches
- Theme toggle works everywhere
- Transitions are smooth

---

### Task 7.5: Documentation
- [ ] Create component documentation
- [ ] Create design token documentation
- [ ] Create usage guidelines
- [ ] Create migration guide
- [ ] Create maintenance guide
- [ ] Add examples for each component

**Files:**
- `.kiro/specs/design-system-uplift/COMPONENT_LIBRARY.md` (new)
- `.kiro/specs/design-system-uplift/USAGE_GUIDE.md` (new)
- `.kiro/specs/design-system-uplift/MIGRATION_GUIDE.md` (new)

**Acceptance Criteria:**
- All components documented
- All tokens documented
- Usage examples provided
- Migration guide is clear
- Maintenance guide is complete

---

## Phase 8: Cleanup & Deployment 🧹 LOW PRIORITY

### Task 8.1: Remove Old Styles
- [ ] Identify unused CSS files
- [ ] Remove old inline styles
- [ ] Remove old CSS classes
- [ ] Test that nothing breaks
- [ ] Clean up commented code

**Acceptance Criteria:**
- No unused CSS files
- No old inline styles
- No old CSS classes
- All functionality still works
- Code is clean

---

### Task 8.2: Final Testing
- [ ] Full regression testing
- [ ] Cross-browser testing
- [ ] Cross-device testing
- [ ] Performance testing
- [ ] Accessibility testing
- [ ] User acceptance testing

**Acceptance Criteria:**
- All tests pass
- No regressions
- Performance targets met
- Accessibility standards met
- Users approve design

---

### Task 8.3: Production Deployment
- [ ] Build production CSS bundle
- [ ] Minify and gzip CSS
- [ ] Update CDN/cache headers
- [ ] Deploy to staging
- [ ] Test on staging
- [ ] Deploy to production
- [ ] Monitor for issues

**Acceptance Criteria:**
- Production bundle is optimized
- Deployment is successful
- No errors in production
- Performance is good
- Users are happy

---

## Task Dependencies

```
Phase 1 (Foundation) → Phase 2 (Components) → Phase 3 (Data Display)
                                            ↓
Phase 4 (Overlays) ← Phase 5 (Layout) ← Phase 6 (Migration)
        ↓
Phase 7 (Polish) → Phase 8 (Cleanup)
```

## Estimated Timeline

- **Phase 1**: 1-2 days
- **Phase 2**: 2-3 days
- **Phase 3**: 1-2 days
- **Phase 4**: 2-3 days
- **Phase 5**: 1-2 days
- **Phase 6**: 3-5 days (depends on number of pages)
- **Phase 7**: 2-3 days
- **Phase 8**: 1-2 days

**Total**: 13-22 days (2-4 weeks)

## Priority Order

1. **Phase 1** (Foundation) - CRITICAL
2. **Phase 2** (Core Components) - HIGH
3. **Phase 6** (Page Migration) - HIGH (start with Research Assistant)
4. **Phase 3** (Data Display) - HIGH
5. **Phase 5** (Layout) - MEDIUM
6. **Phase 4** (Overlays) - MEDIUM
7. **Phase 7** (Polish) - LOW
8. **Phase 8** (Cleanup) - LOW
