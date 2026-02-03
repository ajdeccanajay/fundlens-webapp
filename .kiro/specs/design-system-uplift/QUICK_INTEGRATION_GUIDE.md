# Quick Integration Guide - Apply Design System to Any Page

Use this guide to quickly apply the design system to remaining pages.

## Step-by-Step Integration

### Step 1: Create Backup
```bash
cp public/path/to/page.html public/path/to/page.html.backup-pre-design-system
```

### Step 2: Add to `<head>` Section

Add these lines in the `<head>` section, **before** any other CSS:

```html
<!-- Google Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

<!-- Design System -->
<link rel="stylesheet" href="/css/design-system.css">
<script src="/js/theme-toggle.js"></script>
```

### Step 3: Add Style Overrides

Add this `<style>` block **after** the design system CSS:

```html
<style>
    /* ═══════════════════════════════════════════════════════════════
       DESIGN SYSTEM OVERRIDES - Force design system styles
       ═══════════════════════════════════════════════════════════════ */
    
    /* Force design system fonts to override Tailwind */
    * {
        font-family: var(--font-sans) !important;
    }
    
    code, pre, .font-mono {
        font-family: var(--font-mono) !important;
    }
    
    /* Force body background to use design system */
    body {
        background: linear-gradient(135deg, var(--color-gray-50) 0%, var(--color-white) 50%, var(--color-teal-50) 100%) !important;
        font-family: var(--font-sans) !important;
    }
    
    /* Update gradients to use design system colors */
    .gradient-bg { 
        background: var(--gradient-hero) !important;
    }
    
    /* Update navigation to use design system navy */
    nav.bg-white {
        background: var(--color-navy-900) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
    }
    
    nav.bg-white * {
        color: var(--text-inverse) !important;
    }
    
    /* Update text colors to use design system */
    .text-gray-900 {
        color: var(--text-primary) !important;
    }
    
    .text-gray-600 {
        color: var(--text-secondary) !important;
    }
    
    .text-gray-500 {
        color: var(--text-tertiary) !important;
    }
    
    /* Update card backgrounds */
    .bg-white {
        background: var(--bg-primary) !important;
    }
    
    /* Update borders */
    .border-gray-100,
    .border-gray-200 {
        border-color: var(--border-subtle) !important;
    }
    
    /* Update buttons */
    .btn-primary {
        background: var(--gradient-button) !important;
        transition: all var(--transition-slow) !important;
        color: var(--text-inverse) !important;
    }
    
    .btn-primary:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(30, 90, 122, 0.4) !important;
    }
</style>
```

### Step 4: Test

1. **Hard refresh**: `Cmd + Shift + R` (Mac) or `Ctrl + Shift + R` (Windows/Linux)
2. **Check font**: Should be Inter (not system font)
3. **Check navigation**: Should be dark navy (not white)
4. **Check functionality**: All features should work

### Step 5: Document

Create a completion document:

```markdown
# [Page Name] - Design System Integration COMPLETE ✅

**Date**: [Date]
**Status**: Complete
**File**: `[file path]`
**Backup**: `[backup file path]`

## Changes Made
- Added Google Fonts (Inter, JetBrains Mono)
- Added design system CSS
- Added theme toggle JS
- Added style overrides

## Testing Results
- [ ] Visual changes visible
- [ ] Font changed to Inter
- [ ] Navigation is navy
- [ ] All functionality works

## User Approval
- [ ] User tested
- [ ] User approved
```

## Common Overrides by Page Type

### Dashboard Pages
```css
/* Metric cards */
.metric-card {
    background: linear-gradient(145deg, var(--bg-primary) 0%, var(--bg-secondary) 100%) !important;
    border-radius: var(--radius-xl) !important;
    box-shadow: var(--shadow-md) !important;
}

/* Status badges */
.badge-success { background: var(--color-success-100); color: var(--color-success-600); }
.badge-warning { background: var(--color-warning-100); color: var(--color-warning-600); }
.badge-error { background: var(--color-error-100); color: var(--color-error-600); }
```

### Form Pages (Login, etc.)
```css
/* Form inputs */
.input {
    border: 1px solid var(--border-default) !important;
    border-radius: var(--radius-lg) !important;
    font-family: var(--font-sans) !important;
}

.input:focus {
    border-color: var(--border-focus) !important;
    box-shadow: var(--shadow-focus) !important;
}

/* Form buttons */
.btn-submit {
    background: var(--gradient-button) !important;
    color: var(--text-inverse) !important;
}
```

### Data Tables
```css
/* Table headers */
.table th {
    background: var(--bg-tertiary) !important;
    color: var(--text-primary) !important;
    font-weight: var(--font-semibold) !important;
}

/* Table rows */
.table tbody tr:hover {
    background: var(--bg-hover) !important;
}
```

### Modals
```css
/* Modal backdrop */
.modal-backdrop {
    background: rgba(11, 24, 41, 0.6) !important;
}

/* Modal content */
.modal {
    background: var(--bg-primary) !important;
    border-radius: var(--radius-xl) !important;
    box-shadow: var(--shadow-2xl) !important;
}
```

## Troubleshooting

### Problem: Changes Not Visible
**Solution**: Hard refresh (`Cmd + Shift + R`)

### Problem: Fonts Not Changing
**Solution**: Check DevTools Network tab for font loading errors

### Problem: Navigation Still White
**Solution**: Ensure style overrides are after design system CSS

### Problem: Tailwind Overriding Styles
**Solution**: Add `!important` to design system overrides

## Rollback

If anything breaks:
```bash
cp public/path/to/page.html.backup-pre-design-system public/path/to/page.html
```

## Pages Remaining

- [ ] Deal Workspace (`public/app/deals/workspace.html`)
- [ ] Deal Dashboard (`public/deal-dashboard.html`)
- [ ] Deal Analysis (`public/deal-analysis.html`)
- [ ] Financial Analysis (`public/financial-analysis.html`)
- [ ] Login (`public/login.html`)
- [ ] Main Dashboard (`public/fundlens-main.html`)
- [ ] Admin Tools (`public/internal/platform-admin.html`)

## Estimated Time Per Page

- Simple page (login, etc.): 5-10 minutes
- Medium page (dashboard): 10-15 minutes
- Complex page (workspace): 15-20 minutes

## Quality Checklist

Before marking a page complete:
- [ ] Backup created
- [ ] Design system CSS added
- [ ] Theme toggle JS added
- [ ] Style overrides added
- [ ] Hard refresh tested
- [ ] Font changed to Inter
- [ ] Navigation is navy
- [ ] All functionality works
- [ ] User tested (if possible)
- [ ] Documentation created

## Tips

1. **Always create backup first** - Safety net for rollback
2. **Use aggressive overrides** - `!important` ensures precedence
3. **Test immediately** - Hard refresh after changes
4. **Document as you go** - Create completion docs
5. **Keep it simple** - Don't over-customize, use design system tokens

## Design System Resources

- **Design System CSS**: `public/css/design-system.css`
- **Theme Toggle JS**: `public/js/theme-toggle.js`
- **Source Requirements**: `fundlens-webapp-style-uplift-prompt.md`
- **Documentation**: `.kiro/specs/design-system-uplift/`

## Questions?

Refer to:
- `VISUAL_CHANGES_GUIDE.md` - Troubleshooting
- `DEALS_INDEX_FINAL.md` - Complete example
- `SESSION_SUMMARY.md` - Overview

