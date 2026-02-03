# Design System Rollback Guide

## Checkpoint Created
**Date**: January 28, 2026 at 5:58 PM EST
**Backup File**: `design-system-backup-20260128-175803.tar.gz`
**Size**: 202KB
**Location**: Project root directory

## What's Backed Up
- Entire `public/` directory including:
  - All HTML files
  - All existing CSS files
  - All JavaScript files
  - All components
  - All assets

## How to Rollback

### Full Rollback (Restore Everything)
```bash
# From project root directory
tar -xzf design-system-backup-20260128-175803.tar.gz
```

This will restore the entire `public/` directory to its pre-design-system state.

### Partial Rollback (Restore Specific Files)
```bash
# Extract to a temporary location first
mkdir temp-restore
tar -xzf design-system-backup-20260128-175803.tar.gz -C temp-restore

# Copy specific files you want to restore
cp temp-restore/public/app/research/index.html public/app/research/index.html

# Clean up
rm -rf temp-restore
```

### View Backup Contents (Without Extracting)
```bash
tar -tzf design-system-backup-20260128-175803.tar.gz | less
```

## Files That Will Be Created (New Files)

### Phase 1 - Foundation
- `public/css/design-system.css` (NEW)
- `public/js/theme-toggle.js` (NEW)

### Phase 2 - Components
- `public/css/components/buttons.css` (NEW)
- `public/css/components/forms.css` (NEW)
- `public/css/components/cards.css` (NEW)
- `public/css/components/badges.css` (NEW)
- `public/css/components/navigation.css` (NEW)

### Phase 3 - Data Display
- `public/css/components/tables.css` (NEW)
- `public/css/components/loading.css` (NEW)
- `public/css/components/empty-states.css` (NEW)

### Phase 4 - Overlays
- `public/css/components/modals.css` (NEW)
- `public/css/components/tooltips.css` (NEW)
- `public/css/components/toasts.css` (NEW)
- `public/css/components/dropdowns.css` (NEW)

### Phase 5 - Utilities
- `public/css/utilities/layout.css` (NEW)
- `public/css/utilities/spacing.css` (NEW)
- `public/css/utilities/animations.css` (NEW)

## Files That Will Be Modified

### Phase 6 - Page Migration
All HTML files in `public/` will be modified to:
1. Include new CSS files in `<head>`
2. Update HTML classes to use design system
3. Remove inline styles
4. Add theme toggle button

**Modified Files:**
- `public/app/research/index.html`
- `public/app/deals/workspace.html`
- `public/deal-dashboard.html`
- `public/deal-analysis.html`
- `public/financial-analysis.html`
- `public/login.html`
- `public/fundlens-main.html`
- `public/internal/platform-admin.html`
- All other HTML files

## Rollback Scenarios

### Scenario 1: Design System Breaks Functionality
**Problem**: New styles break existing features
**Solution**: Full rollback
```bash
tar -xzf design-system-backup-20260128-175803.tar.gz
```

### Scenario 2: Specific Page Has Issues
**Problem**: One page doesn't work correctly with new design
**Solution**: Partial rollback for that page only
```bash
mkdir temp-restore
tar -xzf design-system-backup-20260128-175803.tar.gz -C temp-restore
cp temp-restore/public/app/research/index.html public/app/research/index.html
rm -rf temp-restore
```

### Scenario 3: Need to Compare Old vs New
**Problem**: Want to see what changed
**Solution**: Extract to temp directory and compare
```bash
mkdir old-version
tar -xzf design-system-backup-20260128-175803.tar.gz -C old-version
diff -r old-version/public/app/research/index.html public/app/research/index.html
```

### Scenario 4: Keep New CSS, Rollback HTML
**Problem**: CSS is fine but HTML changes broke something
**Solution**: Restore HTML files only
```bash
mkdir temp-restore
tar -xzf design-system-backup-20260128-175803.tar.gz -C temp-restore
# Copy only HTML files
find temp-restore/public -name "*.html" -exec cp {} public/ \;
rm -rf temp-restore
```

## Testing Before Full Commit

### Test Checklist
Before considering the design system complete, test:
- [ ] All pages load without errors
- [ ] All buttons are clickable
- [ ] All forms submit correctly
- [ ] All navigation links work
- [ ] Theme toggle works
- [ ] Responsive design works on mobile
- [ ] Dark mode works correctly
- [ ] No console errors
- [ ] Performance is acceptable

### Incremental Approach
We're migrating pages one at a time:
1. Research Assistant (first)
2. Deal Workspace
3. Deal Dashboard
4. Deal Analysis
5. Financial Analysis
6. Login
7. Main Dashboard
8. Admin Tools
9. Remaining pages

**Benefit**: If something breaks, only one page needs rollback.

## Emergency Contacts
If you need to rollback and I'm not available:
1. Run the full rollback command above
2. Restart any running services
3. Clear browser cache
4. Test that everything works

## Additional Backups

### Create Additional Checkpoint
If you want to create another checkpoint at any time:
```bash
tar -czf design-system-backup-$(date +%Y%m%d-%H%M%S).tar.gz public/
```

### List All Backups
```bash
ls -lh design-system-backup-*.tar.gz
```

### Delete Old Backups (After Successful Migration)
```bash
rm design-system-backup-*.tar.gz
```

## Notes
- Backup does NOT include backend code (only frontend)
- Backup does NOT include node_modules or dependencies
- Backup does NOT include database or .env files
- All new CSS files are additive (won't break existing styles)
- HTML changes are incremental (one page at a time)
- You can keep both old and new styles during migration

## Success Criteria for Removing Backup
Only delete the backup after:
- [ ] All pages migrated successfully
- [ ] All functionality tested and working
- [ ] Production deployment successful
- [ ] No issues reported for 1 week
- [ ] Team approves new design

## Backup Retention
**Recommended**: Keep backup for at least 2 weeks after full migration
**Location**: Move to safe storage location after migration complete
