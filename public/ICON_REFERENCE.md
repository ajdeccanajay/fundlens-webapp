# FundLens Icon Reference Guide

## Navigation Icons

### Workspace Sidebar

```
┌─────────────────────────────┐
│  📈 Analysis                │  fa-chart-line (trending chart)
│  🔍 Research                │  fa-search (magnifying glass)
│  📝 Scratchpad              │  fa-sticky-note (note)
│  📄 IC Memo                 │  fa-file-contract (document)
└─────────────────────────────┘
```

### Common Action Icons

| Action | Icon | Class | Color |
|--------|------|-------|-------|
| Export to Excel | 📊 | `fa-file-excel` | Green |
| Export to PDF | 📕 | `fa-file-pdf` | Red |
| Download | ⬇️ | `fa-download` | Blue |
| Settings | ⚙️ | `fa-cog` | Gray |
| Delete | 🗑️ | `fa-trash` | Red |
| Edit | ✏️ | `fa-edit` | Blue |
| Save | 💾 | `fa-save` | Green |
| Close | ✖️ | `fa-times` | Gray |

### Status Icons

| Status | Icon | Class | Color |
|--------|------|-------|-------|
| Success | ✅ | `fa-check-circle` | Green |
| Error | ❌ | `fa-exclamation-circle` | Red |
| Warning | ⚠️ | `fa-exclamation-triangle` | Yellow |
| Info | ℹ️ | `fa-info-circle` | Blue |
| Loading | ⏳ | `fa-spinner fa-spin` | Blue |

### Financial Icons

| Item | Icon | Class | Use Case |
|------|------|-------|----------|
| Revenue | 💰 | `fa-dollar-sign` | Revenue metrics |
| Growth | 📈 | `fa-chart-line` | Growth trends |
| Comparison | ⚖️ | `fa-balance-scale` | Comp tables |
| Calculator | 🧮 | `fa-calculator` | Financial calcs |
| Report | 📊 | `fa-chart-bar` | Reports |
| Document | 📄 | `fa-file-alt` | Documents |

### User Interface Icons

| Element | Icon | Class | Use Case |
|---------|------|-------|----------|
| User Menu | 👤 | User initials | Profile dropdown |
| Tenant | 🏢 | Badge with text | Tenant identifier |
| Admin | ⭐ | `PLATFORM ADMIN` | Admin badge |
| Chevron Down | ▼ | `fa-chevron-down` | Dropdowns |
| Plus | ➕ | `fa-plus` | Add new |
| Search | 🔍 | `fa-search` | Search bars |

## Icon Usage Guidelines

### DO ✅
- Use icons that clearly represent their function
- Maintain consistent icon style (all FontAwesome)
- Use appropriate colors for actions (red=delete, green=success)
- Include aria-hidden="true" for decorative icons
- Provide text labels alongside icons

### DON'T ❌
- Don't use the same icon for different functions
- Don't use icons without text labels in navigation
- Don't mix icon libraries (stick to FontAwesome)
- Don't use overly complex or obscure icons
- Don't rely solely on color to convey meaning

## FontAwesome Classes

All icons use FontAwesome 6.0.0:
```html
<i class="fas fa-icon-name"></i>
```

### Icon Sizes
- `text-xs` - Extra small (12px)
- `text-sm` - Small (14px)
- `text-base` - Base (16px)
- `text-lg` - Large (18px)
- `text-xl` - Extra large (20px)
- `text-2xl` - 2X large (24px)
- `text-3xl` - 3X large (30px)

### Icon Colors
- `text-gray-400` - Default inactive
- `text-indigo-600` - Primary active
- `text-green-600` - Success
- `text-red-600` - Error/Delete
- `text-yellow-600` - Warning
- `text-blue-600` - Info

## Examples

### Navigation Item
```html
<div class="nav-item flex items-center px-3 py-3 rounded-lg">
    <i class="fas fa-chart-line w-5 text-gray-400" aria-hidden="true"></i>
    <span class="ml-3 text-sm font-medium">Analysis</span>
</div>
```

### Action Button
```html
<button class="bg-green-600 text-white px-6 py-3 rounded-lg">
    <i class="fas fa-file-excel mr-2"></i>Export to Excel
</button>
```

### Status Indicator
```html
<div class="flex items-center">
    <i class="fas fa-check-circle text-green-600 mr-2"></i>
    <span>Completed</span>
</div>
```
