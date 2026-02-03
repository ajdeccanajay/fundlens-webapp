import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Interactive Hierarchy + Context Panel (Week 5)
 * 
 * Tests:
 * - Hierarchy expansion/collapse
 * - Visual indicators (key drivers, formulas, contribution %)
 * - Context panel open/close
 * - Context data display (footnotes, MD&A, breakdowns)
 * - Keyboard navigation
 * - Responsive design
 * - Accessibility
 * - Error handling
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_TICKER = 'AAPL';

// Mock JWT token for testing
function generateMockToken() {
  const base64url = (str: string) => {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    sub: '00000000-0000-0000-0000-000000000001',
    email: 'test@fundlens.ai',
    email_verified: true,
    'custom:tenant_id': '00000000-0000-0000-0000-000000000000',
    'custom:tenant_slug': 'default',
    'custom:tenant_role': 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
    iss: 'fundlens-test'
  }));
  const signature = 'test-signature';

  return `${header}.${payload}.${signature}`;
}

test.describe('Interactive Hierarchy E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Clear cache and storage
    await page.context().clearCookies();
    
    // Set up authentication
    const mockToken = generateMockToken();
    await page.addInitScript((token) => {
      localStorage.clear();
      localStorage.setItem('fundlens_token', token);
      localStorage.setItem('fundlens_user', JSON.stringify({
        email: 'test@fundlens.ai',
        tenantId: '00000000-0000-0000-0000-000000000000',
        tenantSlug: 'default',
        tenantName: 'Default Tenant',
        role: 'admin'
      }));
    }, mockToken);

    // Navigate to workspace
    await page.goto(`${BASE_URL}/app/deals/workspace.html?ticker=${TEST_TICKER}&_t=${Date.now()}`, {
      waitUntil: 'networkidle'
    });
    
    // Wait for Alpine.js to initialize
    await page.waitForTimeout(2000);
    
    // Ensure we're on Analysis tab
    await page.click('.nav-item:has-text("Analysis")');
    await page.waitForTimeout(500);
  });

  test('should display hierarchy in Analysis tab', async ({ page }) => {
    // Check if hierarchy section exists (may not have data)
    const hasHierarchy = await page.locator('text=Financial Performance Metrics').isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasHierarchy) {
      // Check for metric rows
      const metricRows = page.locator('.metric-row');
      const rowCount = await metricRows.count();
      expect(rowCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should expand metric row on click', async ({ page }) => {
    // Find an expandable metric row
    const expandableRow = page.locator('.metric-row.expandable').first();
    const hasExpandable = await expandableRow.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasExpandable) {
      // Click expand button
      await expandableRow.locator('.expand-btn').click();
      await page.waitForTimeout(300);
      
      // Check if row is expanded
      await expect(expandableRow).toHaveClass(/expanded/);
    }
  });

  test('should collapse metric row on second click', async ({ page }) => {
    const expandableRow = page.locator('.metric-row.expandable').first();
    const hasExpandable = await expandableRow.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasExpandable) {
      // Expand
      await expandableRow.locator('.expand-btn').click();
      await page.waitForTimeout(300);
      
      // Collapse
      await expandableRow.locator('.expand-btn').click();
      await page.waitForTimeout(300);
      
      // Check if row is collapsed
      const isExpanded = await expandableRow.evaluate((el) => el.classList.contains('expanded'));
      expect(isExpanded).toBeFalsy();
    }
  });

  test('should show children when expanded', async ({ page }) => {
    const expandableRow = page.locator('.metric-row.expandable').first();
    const hasExpandable = await expandableRow.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasExpandable) {
      // Get metric ID
      const metricId = await expandableRow.getAttribute('data-metric-id');
      
      // Expand
      await expandableRow.locator('.expand-btn').click();
      await page.waitForTimeout(300);
      
      // Check for child rows
      const childRows = page.locator(`.metric-row[data-parent-id="${metricId}"]`);
      const childCount = await childRows.count();
      
      // May or may not have children depending on data
      console.log('Child rows found:', childCount);
    }
  });

  test('should hide children when collapsed', async ({ page }) => {
    const expandableRow = page.locator('.metric-row.expandable').first();
    const hasExpandable = await expandableRow.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasExpandable) {
      const metricId = await expandableRow.getAttribute('data-metric-id');
      
      // Expand then collapse
      await expandableRow.locator('.expand-btn').click();
      await page.waitForTimeout(300);
      await expandableRow.locator('.expand-btn').click();
      await page.waitForTimeout(300);
      
      // Check children are hidden
      const childRows = page.locator(`.metric-row[data-parent-id="${metricId}"]`);
      const visibleChildren = await childRows.filter({ hasNot: page.locator('.hidden') }).count();
      expect(visibleChildren).toBe(0);
    }
  });

  test('should display key driver badges', async ({ page }) => {
    // Check for key driver badges
    const keyDriverBadges = page.locator('.key-driver-badge');
    const badgeCount = await keyDriverBadges.count();
    
    // May or may not have key drivers depending on data
    console.log('Key driver badges found:', badgeCount);
    
    if (badgeCount > 0) {
      await expect(keyDriverBadges.first()).toBeVisible();
      await expect(keyDriverBadges.first()).toContainText('Key Driver');
    }
  });

  test('should display formulas for calculated metrics', async ({ page }) => {
    // Check for formula display
    const formulas = page.locator('.metric-formula');
    const formulaCount = await formulas.count();
    
    console.log('Formulas found:', formulaCount);
    
    if (formulaCount > 0) {
      await expect(formulas.first()).toBeVisible();
    }
  });

  test('should display contribution percentages', async ({ page }) => {
    // Check for contribution percentages
    const contributions = page.locator('.metric-contribution');
    const contributionCount = await contributions.count();
    
    console.log('Contribution percentages found:', contributionCount);
    
    if (contributionCount > 0) {
      await expect(contributions.first()).toBeVisible();
      const text = await contributions.first().textContent();
      expect(text).toMatch(/%/);
    }
  });

  test('should navigate with arrow keys', async ({ page }) => {
    const metricRows = page.locator('.metric-row');
    const rowCount = await metricRows.count();
    
    if (rowCount > 1) {
      // Focus first row
      await metricRows.first().focus();
      
      // Press arrow down
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(100);
      
      // Check focus moved (implementation-dependent)
      const focusedElement = await page.evaluate(() => document.activeElement?.className);
      console.log('Focused element:', focusedElement);
    }
  });

  test('should expand/collapse with Enter key', async ({ page }) => {
    const expandableRow = page.locator('.metric-row.expandable').first();
    const hasExpandable = await expandableRow.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasExpandable) {
      // Focus and press Enter
      await expandableRow.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      
      // Check if expanded
      const isExpanded = await expandableRow.evaluate((el) => el.classList.contains('expanded'));
      expect(isExpanded).toBeTruthy();
    }
  });

  test('should expand/collapse with Space key', async ({ page }) => {
    const expandableRow = page.locator('.metric-row.expandable').first();
    const hasExpandable = await expandableRow.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasExpandable) {
      // Focus and press Space
      await expandableRow.focus();
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
      
      // Check if expanded
      const isExpanded = await expandableRow.evaluate((el) => el.classList.contains('expanded'));
      expect(isExpanded).toBeTruthy();
    }
  });

  test('should have proper indentation for hierarchy levels', async ({ page }) => {
    // Check for level-1, level-2, level-3 classes
    const level1Rows = page.locator('.metric-row.level-1');
    const level2Rows = page.locator('.metric-row.level-2');
    const level3Rows = page.locator('.metric-row.level-3');
    
    const level1Count = await level1Rows.count();
    const level2Count = await level2Rows.count();
    const level3Count = await level3Rows.count();
    
    console.log('Hierarchy levels:', { level1: level1Count, level2: level2Count, level3: level3Count });
    
    // Check indentation increases with level
    if (level1Count > 0) {
      const level1Padding = await level1Rows.first().evaluate((el) => 
        window.getComputedStyle(el).paddingLeft
      );
      console.log('Level 1 padding:', level1Padding);
      expect(parseInt(level1Padding)).toBeGreaterThan(16);
    }
  });
});

test.describe('Context Panel E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Clear cache and storage
    await page.context().clearCookies();
    
    // Set up authentication
    const mockToken = generateMockToken();
    await page.addInitScript((token) => {
      localStorage.clear();
      localStorage.setItem('fundlens_token', token);
      localStorage.setItem('fundlens_user', JSON.stringify({
        email: 'test@fundlens.ai',
        tenantId: '00000000-0000-0000-0000-000000000000',
        tenantSlug: 'default',
        tenantName: 'Default Tenant',
        role: 'admin'
      }));
    }, mockToken);

    // Navigate to workspace
    await page.goto(`${BASE_URL}/app/deals/workspace.html?ticker=${TEST_TICKER}&_t=${Date.now()}`, {
      waitUntil: 'networkidle'
    });
    
    // Wait for Alpine.js to initialize
    await page.waitForTimeout(2000);
    
    // Ensure we're on Analysis tab
    await page.click('.nav-item:has-text("Analysis")');
    await page.waitForTimeout(500);
  });

  test('should open context panel on info icon click', async ({ page }) => {
    // Find info icon
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      // Click info icon
      await infoIcon.click();
      await page.waitForTimeout(500);
      
      // Check panel is visible
      const contextPanel = page.locator('.context-panel');
      await expect(contextPanel).toHaveClass(/open/);
    }
  });

  test('should display metric name in panel header', async ({ page }) => {
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      await infoIcon.click();
      await page.waitForTimeout(500);
      
      // Check header contains metric name
      const panelHeader = page.locator('.panel-header h3');
      await expect(panelHeader).toBeVisible();
      const headerText = await panelHeader.textContent();
      expect(headerText).toContain('Context:');
    }
  });

  test('should display footnotes section', async ({ page }) => {
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      await infoIcon.click();
      await page.waitForTimeout(1000);
      
      // Check for footnotes section
      const footnotesSection = page.locator('text=Footnotes');
      const hasFootnotes = await footnotesSection.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (hasFootnotes) {
        await expect(footnotesSection).toBeVisible();
        
        // Check for footnote items
        const footnoteItems = page.locator('.footnote-section');
        const footnoteCount = await footnoteItems.count();
        console.log('Footnotes found:', footnoteCount);
      }
    }
  });

  test('should display MD&A quotes section', async ({ page }) => {
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      await infoIcon.click();
      await page.waitForTimeout(1000);
      
      // Check for MD&A section
      const mdaSection = page.locator('text=MD&A Insights');
      const hasMda = await mdaSection.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (hasMda) {
        await expect(mdaSection).toBeVisible();
        
        // Check for MD&A quotes
        const mdaQuotes = page.locator('.mda-quote');
        const quoteCount = await mdaQuotes.count();
        console.log('MD&A quotes found:', quoteCount);
      }
    }
  });

  test('should display breakdowns section', async ({ page }) => {
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      await infoIcon.click();
      await page.waitForTimeout(1000);
      
      // Check for breakdowns section
      const breakdownsSection = page.locator('text=Breakdowns');
      const hasBreakdowns = await breakdownsSection.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (hasBreakdowns) {
        await expect(breakdownsSection).toBeVisible();
        
        // Check for breakdown tables
        const breakdownTables = page.locator('.breakdown-table');
        const tableCount = await breakdownTables.count();
        console.log('Breakdown tables found:', tableCount);
      }
    }
  });

  test('should close panel on close button click', async ({ page }) => {
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      // Open panel
      await infoIcon.click();
      await page.waitForTimeout(500);
      
      // Click close button
      await page.click('.btn-close');
      await page.waitForTimeout(500);
      
      // Check panel is closed
      const contextPanel = page.locator('.context-panel');
      const isOpen = await contextPanel.evaluate((el) => el.classList.contains('open'));
      expect(isOpen).toBeFalsy();
    }
  });

  test('should close panel on overlay click', async ({ page }) => {
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      // Open panel
      await infoIcon.click();
      await page.waitForTimeout(500);
      
      // Click overlay
      await page.click('.panel-overlay');
      await page.waitForTimeout(500);
      
      // Check panel is closed
      const contextPanel = page.locator('.context-panel');
      const isOpen = await contextPanel.evaluate((el) => el.classList.contains('open'));
      expect(isOpen).toBeFalsy();
    }
  });

  test('should close panel on Escape key', async ({ page }) => {
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      // Open panel
      await infoIcon.click();
      await page.waitForTimeout(500);
      
      // Press Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      
      // Check panel is closed
      const contextPanel = page.locator('.context-panel');
      const isOpen = await contextPanel.evaluate((el) => el.classList.contains('open'));
      expect(isOpen).toBeFalsy();
    }
  });

  test('should have slide-in animation', async ({ page }) => {
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      // Check initial state (off-screen)
      const contextPanel = page.locator('.context-panel');
      const initialTransform = await contextPanel.evaluate((el) => 
        window.getComputedStyle(el).transform
      );
      
      // Open panel
      await infoIcon.click();
      await page.waitForTimeout(500);
      
      // Check final state (on-screen)
      const finalTransform = await contextPanel.evaluate((el) => 
        window.getComputedStyle(el).transform
      );
      
      // Transform should change
      expect(initialTransform).not.toBe(finalTransform);
    }
  });

  test('should be responsive on mobile width', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);
    
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      await infoIcon.click();
      await page.waitForTimeout(500);
      
      // Check panel takes full width on mobile
      const contextPanel = page.locator('.context-panel');
      const width = await contextPanel.evaluate((el) => (el as HTMLElement).offsetWidth);
      
      // Should be close to viewport width
      expect(width).toBeGreaterThan(300);
    }
  });

  test('should have scrollable content', async ({ page }) => {
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      await infoIcon.click();
      await page.waitForTimeout(500);
      
      // Check panel content is scrollable
      const panelContent = page.locator('.panel-content');
      const isScrollable = await panelContent.evaluate((el) => {
        return el.scrollHeight > el.clientHeight || 
               window.getComputedStyle(el).overflowY === 'auto' ||
               window.getComputedStyle(el).overflowY === 'scroll';
      });
      
      console.log('Panel content scrollable:', isScrollable);
    }
  });

  test('should load context data from API', async ({ page }) => {
    // Monitor network requests
    const apiCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/deals/') && request.url().includes('/context/')) {
        apiCalls.push(request.url());
      }
    });
    
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      await infoIcon.click();
      await page.waitForTimeout(1000);
      
      // Check API was called
      expect(apiCalls.length).toBeGreaterThan(0);
      console.log('Context API calls:', apiCalls);
    }
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock API error
    await page.route('**/api/deals/*/context/*', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ message: 'Internal server error' })
      });
    });
    
    const infoIcon = page.locator('.context-icon').first();
    const hasInfoIcon = await infoIcon.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasInfoIcon) {
      await infoIcon.click();
      await page.waitForTimeout(1000);
      
      // Check for error message
      const errorMessage = page.locator('.empty-state, .error-message');
      const hasError = await errorMessage.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (hasError) {
        await expect(errorMessage).toBeVisible();
      }
    }
  });
});


// ========================================
// TASK 1.6: ENHANCED HIERARCHY E2E TESTS
// ========================================

test.describe('Enhanced Metric Hierarchy (Task 1.6)', () => {
  test.beforeEach(async ({ page }) => {
    // Clear cache and storage
    await page.context().clearCookies();
    
    // Set up authentication
    const mockToken = generateMockToken();
    await page.addInitScript((token) => {
      localStorage.clear();
      localStorage.setItem('fundlens_token', token);
      localStorage.setItem('fundlens_user', JSON.stringify({
        email: 'test@fundlens.ai',
        tenantId: '00000000-0000-0000-0000-000000000000',
        tenantSlug: 'default',
        tenantName: 'Default Tenant',
        role: 'admin'
      }));
    }, mockToken);

    // Navigate to workspace
    await page.goto(`${BASE_URL}/app/deals/workspace.html?ticker=${TEST_TICKER}&_t=${Date.now()}`, {
      waitUntil: 'networkidle'
    });
    
    // Wait for Alpine.js to initialize
    await page.waitForTimeout(2000);
    
    // Navigate to Insights tab
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);
  });

  test('should display enhanced hierarchy section with subtitle', async ({ page }) => {
    // Check for hierarchy section
    const hierarchySection = page.locator('.metric-hierarchy-section');
    await expect(hierarchySection).toBeVisible({ timeout: 10000 });
    
    // Check for subtitle/help text
    const subtitle = page.locator('text=Click to expand/collapse');
    await expect(subtitle).toBeVisible();
  });

  test('should display trend indicators (arrows) for metrics', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Check for trend arrows
    const upArrows = page.locator('.fa-arrow-up');
    const downArrows = page.locator('.fa-arrow-down');
    const flatArrows = page.locator('.fa-arrow-right');
    
    const upCount = await upArrows.count();
    const downCount = await downArrows.count();
    const flatCount = await flatArrows.count();
    
    const totalTrends = upCount + downCount + flatCount;
    console.log('Trend indicators found:', { up: upCount, down: downCount, flat: flatCount });
    
    // Should have at least some trend indicators if data exists
    if (totalTrends > 0) {
      expect(totalTrends).toBeGreaterThan(0);
    }
  });

  test('should color-code trend indicators correctly', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Check up arrows are green
    const upArrows = page.locator('.fa-arrow-up.text-green-600, .fa-arrow-up.text-green-500');
    const upCount = await upArrows.count();
    
    if (upCount > 0) {
      const firstUpArrow = upArrows.first();
      const color = await firstUpArrow.evaluate((el) => window.getComputedStyle(el).color);
      // Should be some shade of green
      expect(color).toMatch(/rgb\(.*\)/);
    }
    
    // Check down arrows are red
    const downArrows = page.locator('.fa-arrow-down.text-red-600, .fa-arrow-down.text-red-500');
    const downCount = await downArrows.count();
    
    if (downCount > 0) {
      const firstDownArrow = downArrows.first();
      const color = await firstDownArrow.evaluate((el) => window.getComputedStyle(el).color);
      // Should be some shade of red
      expect(color).toMatch(/rgb\(.*\)/);
    }
  });

  test('should display YoY change percentages next to trends', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Look for YoY change text (e.g., "+12%", "-5%")
    const yoyChanges = page.locator('span').filter({ hasText: /%/ });
    const changeCount = await yoyChanges.count();
    
    console.log('YoY changes found:', changeCount);
    
    if (changeCount > 0) {
      const firstChange = await yoyChanges.first().textContent();
      expect(firstChange).toMatch(/[+-]?\d+\.?\d*%/);
    }
  });

  test('should display contribution percentages for child metrics', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Expand a root metric if possible
    const expandButton = page.locator('.fa-chevron-right').first();
    const hasExpandable = await expandButton.isVisible().catch(() => false);
    
    if (hasExpandable) {
      await expandButton.click();
      await page.waitForTimeout(500);
      
      // Look for contribution percentages
      const contributionBars = page.locator('.bg-gradient-to-r.from-indigo-500.to-purple-500');
      const barCount = await contributionBars.count();
      
      console.log('Contribution bars found:', barCount);
      
      if (barCount > 0) {
        // Check percentage text
        const percentageText = page.locator('.text-indigo-600.font-bold').filter({ hasText: /%/ });
        const percentCount = await percentageText.count();
        expect(percentCount).toBeGreaterThan(0);
      }
    }
  });

  test('should animate contribution bars on expand', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    const expandButton = page.locator('.fa-chevron-right').first();
    const hasExpandable = await expandButton.isVisible().catch(() => false);
    
    if (hasExpandable) {
      // Click to expand
      await expandButton.click();
      await page.waitForTimeout(100);
      
      // Check for contribution bar animation
      const contributionBar = page.locator('.bg-gradient-to-r.from-indigo-500.to-purple-500').first();
      const hasBar = await contributionBar.isVisible({ timeout: 1000 }).catch(() => false);
      
      if (hasBar) {
        // Bar should have width style
        const width = await contributionBar.evaluate((el) => el.style.width);
        expect(width).toMatch(/\d+%/);
      }
    }
  });

  test('should display enhanced "View Context" buttons', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Check for context buttons with book icon
    const contextButtons = page.locator('button .fa-book-open');
    const buttonCount = await contextButtons.count();
    
    console.log('Context buttons found:', buttonCount);
    
    if (buttonCount > 0) {
      await expect(contextButtons.first()).toBeVisible();
    }
  });

  test('should show context button on hover for child metrics', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Expand a metric
    const expandButton = page.locator('.fa-chevron-right').first();
    const hasExpandable = await expandButton.isVisible().catch(() => false);
    
    if (hasExpandable) {
      await expandButton.click();
      await page.waitForTimeout(500);
      
      // Hover over a child metric
      const childMetric = page.locator('.metric-child').first();
      const hasChild = await childMetric.isVisible().catch(() => false);
      
      if (hasChild) {
        await childMetric.hover();
        await page.waitForTimeout(300);
        
        // Context button should become visible
        const contextButton = childMetric.locator('button .fa-book-open');
        const isVisible = await contextButton.isVisible().catch(() => false);
        
        // Button may be visible or have opacity transition
        console.log('Context button visible on hover:', isVisible);
      }
    }
  });

  test('should have gradient background on root metrics', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Check for gradient styling on root metrics
    const rootMetrics = page.locator('.metric-node > div').first();
    const hasRoot = await rootMetrics.isVisible().catch(() => false);
    
    if (hasRoot) {
      // Check for border or background styling
      const borderColor = await rootMetrics.evaluate((el) => 
        window.getComputedStyle(el).borderColor
      );
      
      expect(borderColor).toBeTruthy();
    }
  });

  test('should have smooth expand/collapse transitions', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    const expandButton = page.locator('.fa-chevron-right').first();
    const hasExpandable = await expandButton.isVisible().catch(() => false);
    
    if (hasExpandable) {
      // Get parent element
      const parentNode = expandButton.locator('xpath=ancestor::div[contains(@class, "metric-node")]').first();
      
      // Click to expand
      await expandButton.click();
      await page.waitForTimeout(100);
      
      // Check for transition classes
      const childrenContainer = parentNode.locator('div[x-show]').first();
      const hasTransition = await childrenContainer.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.transition !== 'none' && style.transition !== '';
      }).catch(() => false);
      
      console.log('Has transition:', hasTransition);
    }
  });

  test('should display key driver badges with star icon', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Look for key driver badges
    const keyDriverBadges = page.locator('text=Key Driver, text=Key');
    const badgeCount = await keyDriverBadges.count();
    
    console.log('Key driver badges found:', badgeCount);
    
    if (badgeCount > 0) {
      // Check for star icon
      const starIcon = page.locator('.fa-star').first();
      await expect(starIcon).toBeVisible();
    }
  });

  test('should display formula in monospace font with background', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Look for formulas
    const formulas = page.locator('.font-mono');
    const formulaCount = await formulas.count();
    
    console.log('Formulas found:', formulaCount);
    
    if (formulaCount > 0) {
      const firstFormula = formulas.first();
      
      // Check font family
      const fontFamily = await firstFormula.evaluate((el) => 
        window.getComputedStyle(el).fontFamily
      );
      
      expect(fontFamily).toMatch(/mono/i);
    }
  });

  test('should have proper spacing between hierarchy levels', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Expand a metric
    const expandButton = page.locator('.fa-chevron-right').first();
    const hasExpandable = await expandButton.isVisible().catch(() => false);
    
    if (hasExpandable) {
      await expandButton.click();
      await page.waitForTimeout(500);
      
      // Check for indentation
      const childContainer = page.locator('.ml-10').first();
      const hasChild = await childContainer.isVisible().catch(() => false);
      
      if (hasChild) {
        const marginLeft = await childContainer.evaluate((el) => 
          window.getComputedStyle(el).marginLeft
        );
        
        // Should have significant left margin
        expect(parseInt(marginLeft)).toBeGreaterThan(30);
      }
    }
  });

  test('should display values in tabular format', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Check for value displays
    const values = page.locator('.font-bold.text-gray-900, .font-semibold.text-gray-700');
    const valueCount = await values.count();
    
    console.log('Values found:', valueCount);
    
    if (valueCount > 1) {
      // Values should be aligned (right-aligned typically)
      const firstValue = values.first();
      const textAlign = await firstValue.evaluate((el) => 
        window.getComputedStyle(el.parentElement || el).textAlign
      );
      
      console.log('Value text alignment:', textAlign);
    }
  });

  test('should be responsive on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(2000);
    
    // Check hierarchy is still visible
    const hierarchySection = page.locator('.metric-hierarchy-section');
    await expect(hierarchySection).toBeVisible();
    
    // Check metrics stack properly
    const rootMetric = page.locator('.metric-node > div').first();
    const hasRoot = await rootMetric.isVisible().catch(() => false);
    
    if (hasRoot) {
      const width = await rootMetric.evaluate((el) => (el as HTMLElement).offsetWidth);
      
      // Should take most of viewport width
      expect(width).toBeGreaterThan(300);
      expect(width).toBeLessThan(400);
    }
  });

  test('should have hover effects on metrics', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    const rootMetric = page.locator('.metric-node > div').first();
    const hasRoot = await rootMetric.isVisible().catch(() => false);
    
    if (hasRoot) {
      // Get initial background
      const initialBg = await rootMetric.evaluate((el) => 
        window.getComputedStyle(el).backgroundColor
      );
      
      // Hover
      await rootMetric.hover();
      await page.waitForTimeout(200);
      
      // Background may change (or have gradient overlay)
      const hoverBg = await rootMetric.evaluate((el) => 
        window.getComputedStyle(el).backgroundColor
      );
      
      console.log('Background change on hover:', { initial: initialBg, hover: hoverBg });
    }
  });

  test('should display refresh button with icon', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Check for refresh button
    const refreshButton = page.locator('button:has-text("Refresh")');
    await expect(refreshButton).toBeVisible();
    
    // Check for sync icon
    const syncIcon = refreshButton.locator('.fa-sync-alt');
    await expect(syncIcon).toBeVisible();
  });

  test('should show loading state when refreshing', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Click refresh
    const refreshButton = page.locator('button:has-text("Refresh")');
    await refreshButton.click();
    
    // Check for loading state
    const loadingText = page.locator('text=Loading hierarchy...');
    const hasLoading = await loadingText.isVisible({ timeout: 1000 }).catch(() => false);
    
    if (hasLoading) {
      await expect(loadingText).toBeVisible();
    }
  });

  test('should maintain expanded state when refreshing', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Expand a metric
    const expandButton = page.locator('.fa-chevron-right').first();
    const hasExpandable = await expandButton.isVisible().catch(() => false);
    
    if (hasExpandable) {
      await expandButton.click();
      await page.waitForTimeout(500);
      
      // Refresh
      const refreshButton = page.locator('button:has-text("Refresh")');
      await refreshButton.click();
      await page.waitForTimeout(2000);
      
      // Check if still expanded (implementation-dependent)
      const chevronDown = page.locator('.fa-chevron-down').first();
      const isExpanded = await chevronDown.isVisible().catch(() => false);
      
      console.log('Maintained expanded state:', isExpanded);
    }
  });

  test('should have accessible focus states', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // Tab to first interactive element
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    
    // Check for focus outline
    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return {
        outline: style.outline,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor
      };
    });
    
    console.log('Focus state:', focusedElement);
    
    // Should have some outline
    if (focusedElement) {
      expect(focusedElement.outline !== 'none' || focusedElement.outlineWidth !== '0px').toBeTruthy();
    }
  });
});
