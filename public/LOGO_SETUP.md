# FundLens Logo Setup Guide

## Logo Placement

To complete the logo integration, place your FundLens logo image file in the following location:

```
public/fundlens-logo.png
```

## Logo Requirements

- **Format**: PNG with transparent background (recommended)
- **Dimensions**: Approximately 200-300px wide, height proportional
- **File name**: Must be exactly `fundlens-logo.png`
- **Color**: The logo should work well on both:
  - Navy blue background (#0B1829) for navigation bars
  - Dark gradient background for login page

## Where the Logo Appears

The logo has been integrated into:

1. **Navigation Bar** (all pages):
   - `/app/deals/index.html` - Deal Dashboard
   - `/app/deals/workspace.html` - Deal Workspace
   - `/deal-analysis.html` - Deal Analysis

2. **Login Page**:
   - `/login.html` - Sign In page

## Updated Icon System

The navigation icons have been updated to be more varied and meaningful:

### Workspace Sidebar Icons:
- **Analysis**: `fa-chart-line` (trending line chart) - for financial analysis
- **Research**: `fa-search` (magnifying glass) - for research assistant
- **Scratchpad**: `fa-sticky-note` (sticky note) - for saved notes
- **IC Memo**: `fa-file-contract` (document with signature) - for investment committee memos

### Other Common Icons Used:
- **Export**: `fa-download` or `fa-file-excel`
- **Settings**: `fa-cog`
- **User Profile**: User initials in circle
- **Tenant Badge**: Green gradient badge

## Testing

After placing the logo file:

1. Hard refresh your browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)
2. Check all pages listed above
3. Verify the logo displays correctly on both light and dark backgrounds
4. Ensure the logo is clickable and returns to the dashboard

## Fallback

If the logo file is not found, browsers will show a broken image icon. Make sure the file path is exactly:
```
/fundlens-logo.png
```

This resolves to `public/fundlens-logo.png` in your project structure.
