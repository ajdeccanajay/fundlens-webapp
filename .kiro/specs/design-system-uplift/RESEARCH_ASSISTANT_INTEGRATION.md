# Research Assistant - Design System Integration Plan

## Current State
- File: `public/app/research/index.html`
- Size: 1,344 lines
- Current styling: Tailwind CSS + custom styles
- Backup created: `public/app/research/index.html.backup-pre-design-system`

## Integration Strategy

### What We're Keeping
✅ All JavaScript functionality (Alpine.js)
✅ All API calls and data handling
✅ All event listeners and interactions
✅ Marked.js and Highlight.js for markdown rendering
✅ SSE streaming for chat responses
✅ Citation system
✅ Scratchpad functionality
✅ Document preview modal

### What We're Changing
🔄 Replace Tailwind CSS with design system
🔄 Update color scheme to FundLens navy/teal
🔄 Add design system CSS and theme toggle
🔄 Update button styles to use design system
🔄 Update form input styles
🔄 Update card styles
🔄 Update modal styles
🔄 Add Google Fonts (Inter, JetBrains Mono)

### Changes to Make

#### 1. Head Section
**Before:**
```html
<script src="https://cdn.tailwindcss.com"></script>
```

**After:**
```html
<!-- Google Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

<!-- Design System -->
<link rel="stylesheet" href="/css/design-system.css">
<script src="/js/theme-toggle.js"></script>
```

#### 2. Custom Styles
- Keep most custom styles (they're specific to chat UI)
- Update colors to use CSS variables
- Update fonts to use design system tokens

#### 3. HTML Classes
- Replace Tailwind utility classes with design system classes where applicable
- Keep custom classes for chat-specific styling

## Implementation Approach

Since this is a complex page with many custom styles, we'll take a **hybrid approach**:

1. **Add design system** to `<head>`
2. **Update custom CSS** to use design system tokens
3. **Keep Tailwind** for now (gradual migration)
4. **Add theme toggle** button to navigation

This allows us to:
- Test the design system integration
- Keep all functionality working
- Gradually migrate away from Tailwind
- Ensure zero breaking changes

## Testing Checklist

After integration:
- [ ] Page loads without errors
- [ ] Fonts load correctly (Inter, JetBrains Mono)
- [ ] Theme toggle appears and works
- [ ] Chat interface displays correctly
- [ ] Messages send and receive correctly
- [ ] Citations display correctly
- [ ] Scratchpad works
- [ ] Document preview modal works
- [ ] All buttons are clickable
- [ ] All forms work
- [ ] Responsive design works
- [ ] Dark mode works

## Rollback Plan

If anything breaks:
```bash
cp public/app/research/index.html.backup-pre-design-system public/app/research/index.html
```

## Next Steps After This Page

Once Research Assistant is working:
1. Deal Workspace
2. Deal Dashboard
3. Deal Analysis
4. Financial Analysis
5. Login
6. Main Dashboard
7. Admin Tools
