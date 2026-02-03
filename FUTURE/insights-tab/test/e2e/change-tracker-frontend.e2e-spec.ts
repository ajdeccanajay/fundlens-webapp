import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Change Tracker Frontend (Task 2.6)
 * 
 * Tests the Change Tracker UI in the Insights tab
 */

test.describe('Change Tracker Frontend', () => {
  const BASE_URL = 'http://localhost:3000';
  const WORKSPACE_URL = `${BASE_URL}/app/deals/workspace.html?ticker=AMZN`;

  test.beforeEach(async ({ page }) => {
    // Navigate to workspace
    await page.goto(WORKSPACE_URL);
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Click on Insights tab
    await page.click('text=Insights');
    
    // Wait for insights to load
    await page.waitForTimeout(1000);
  });

  test('should display change tracker section', async ({ page }) => {
    // Check section header
    await expect(page.locator('text=Change Tracker')).toBeVisible();
    
    // Check refresh button
    await expect(page.locator('button:has-text("Refresh")')).toBeVisible();
  });

  test('should display period selection dropdowns', async ({ page }) => {
    // Check from period label
    await expect(page.locator('text=From Period')).toBeVisible();
    
    // Check to period label
    await expect(page.locator('text=To Period')).toBeVisible();
    
    // Check dropdowns exist
    const fromSelect = page.locator('select').first();
    const toSelect = page.locator('select').nth(1);
    
    await expect(fromSelect).toBeVisible();
    await expect(toSelect).toBeVisible();
  });

  test('should display change type filters', async ({ page }) => {
    // Check filter section
    await expect(page.locator('text=Change Types')).toBeVisible();
    
    // Check all filter options
    await expect(page.locator('text=New Disclosures')).toBeVisible();
    await expect(page.locator('text=Language Changes')).toBeVisible();
    await expect(page.locator('text=Metric Changes')).toBeVisible();
    await expect(page.locator('text=Accounting Changes')).toBeVisible();
  });

  test('should display materiality filters', async ({ page }) => {
    // Check materiality section
    await expect(page.locator('text=Materiality')).toBeVisible();
    
    // Check all materiality options
    await expect(page.locator('text=All Changes')).toBeVisible();
    await expect(page.locator('text=High Materiality')).toBeVisible();
    await expect(page.locator('text=Medium Materiality')).toBeVisible();
    await expect(page.locator('text=Low Materiality')).toBeVisible();
  });

  test('should have all change type filters checked by default', async ({ page }) => {
    // Check all checkboxes are checked
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }
  });

  test('should have "All Changes" materiality selected by default', async ({ page }) => {
    // Check "All Changes" radio is selected
    const allChangesRadio = page.locator('input[type="radio"][value="all"]');
    await expect(allChangesRadio).toBeChecked();
  });

  test('should disable detect button when no periods selected', async ({ page }) => {
    // Check detect button is disabled initially
    const detectButton = page.locator('button:has-text("Detect Changes")');
    await expect(detectButton).toBeDisabled();
  });

  test('should enable detect button when periods selected', async ({ page }) => {
    // Select from period
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    // Select to period
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    // Check detect button is enabled
    const detectButton = page.locator('button:has-text("Detect Changes")');
    await expect(detectButton).toBeEnabled();
  });

  test('should display initial empty state', async ({ page }) => {
    // Check initial empty state
    await expect(page.locator('text=Select periods to detect changes')).toBeVisible();
    await expect(page.locator('text=Choose two periods above to compare')).toBeVisible();
  });

  test('should display loading state when detecting changes', async ({ page }) => {
    // Select periods
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    // Click detect button
    await page.click('button:has-text("Detect Changes")');
    
    // Check loading state appears
    await expect(page.locator('text=Detecting changes...')).toBeVisible();
  });

  test('should display error state on failure', async ({ page }) => {
    // Mock API to return error
    await page.route('**/api/deals/*/insights/changes*', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });
    
    // Select periods
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    // Click detect button
    await page.click('button:has-text("Detect Changes")');
    
    // Wait for error
    await page.waitForTimeout(1000);
    
    // Check error message
    await expect(page.locator('.bg-red-50')).toBeVisible();
  });

  test('should display changes with data', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/changes*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          changes: [
            {
              id: 'change-1',
              type: 'metric_change',
              category: 'Revenue',
              description: 'Revenue increased significantly',
              fromValue: 100000000,
              toValue: 150000000,
              delta: 50,
              materiality: 'high',
              context: 'Strong growth in cloud services',
            },
            {
              id: 'change-2',
              type: 'new_disclosure',
              category: 'Risk Factors',
              description: 'New risk disclosure added',
              fromValue: null,
              toValue: 'New regulatory risk identified',
              delta: null,
              materiality: 'medium',
              context: 'Added in latest 10-K filing',
            },
          ],
          summary: {
            total: 2,
            material: 1,
            byType: {
              metric_change: 1,
              new_disclosure: 1,
            },
          },
        }),
      });
    });
    
    // Select periods
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    // Click detect button
    await page.click('button:has-text("Detect Changes")');
    
    // Wait for changes
    await page.waitForTimeout(1000);
    
    // Check summary
    await expect(page.locator('text=Found 2 change(s)')).toBeVisible();
    await expect(page.locator('text=(1 material)')).toBeVisible();
    
    // Check change cards
    await expect(page.locator('text=Revenue')).toBeVisible();
    await expect(page.locator('text=Risk Factors')).toBeVisible();
  });

  test('should display change type badges', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/changes*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          changes: [
            {
              id: 'change-1',
              type: 'metric_change',
              category: 'Revenue',
              description: 'Revenue increased',
              fromValue: 100000000,
              toValue: 150000000,
              delta: 50,
              materiality: 'high',
              context: 'Strong growth',
            },
          ],
          summary: { total: 1, material: 1, byType: {} },
        }),
      });
    });
    
    // Select periods and detect
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    await page.click('button:has-text("Detect Changes")');
    await page.waitForTimeout(1000);
    
    // Check type badge
    await expect(page.locator('text=METRIC CHANGE')).toBeVisible();
  });

  test('should display materiality badges', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/changes*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          changes: [
            {
              id: 'change-1',
              type: 'metric_change',
              category: 'Revenue',
              description: 'Revenue increased',
              fromValue: 100000000,
              toValue: 150000000,
              delta: 50,
              materiality: 'high',
              context: 'Strong growth',
            },
          ],
          summary: { total: 1, material: 1, byType: {} },
        }),
      });
    });
    
    // Select periods and detect
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    await page.click('button:has-text("Detect Changes")');
    await page.waitForTimeout(1000);
    
    // Check materiality badge
    await expect(page.locator('text=HIGH')).toBeVisible();
  });

  test('should display side-by-side comparison', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/changes*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          changes: [
            {
              id: 'change-1',
              type: 'metric_change',
              category: 'Revenue',
              description: 'Revenue increased',
              fromValue: 100000000,
              toValue: 150000000,
              delta: 50,
              materiality: 'high',
              context: 'Strong growth',
            },
          ],
          summary: { total: 1, material: 1, byType: {} },
        }),
      });
    });
    
    // Select periods and detect
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    await page.click('button:has-text("Detect Changes")');
    await page.waitForTimeout(1000);
    
    // Check period labels
    await expect(page.locator('text=FY2023')).toBeVisible();
    await expect(page.locator('text=FY2024')).toBeVisible();
    
    // Check values
    await expect(page.locator('text=$100.0M')).toBeVisible();
    await expect(page.locator('text=$150.0M')).toBeVisible();
  });

  test('should display delta for numeric changes', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/changes*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          changes: [
            {
              id: 'change-1',
              type: 'metric_change',
              category: 'Revenue',
              description: 'Revenue increased',
              fromValue: 100000000,
              toValue: 150000000,
              delta: 50,
              materiality: 'high',
              context: 'Strong growth',
            },
          ],
          summary: { total: 1, material: 1, byType: {} },
        }),
      });
    });
    
    // Select periods and detect
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    await page.click('button:has-text("Detect Changes")');
    await page.waitForTimeout(1000);
    
    // Check delta display
    await expect(page.locator('text=Change:')).toBeVisible();
    await expect(page.locator('text=50%')).toBeVisible();
  });

  test('should display context box', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/changes*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          changes: [
            {
              id: 'change-1',
              type: 'metric_change',
              category: 'Revenue',
              description: 'Revenue increased',
              fromValue: 100000000,
              toValue: 150000000,
              delta: 50,
              materiality: 'high',
              context: 'Strong growth in cloud services',
            },
          ],
          summary: { total: 1, material: 1, byType: {} },
        }),
      });
    });
    
    // Select periods and detect
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    await page.click('button:has-text("Detect Changes")');
    await page.waitForTimeout(1000);
    
    // Check context
    await expect(page.locator('text=Strong growth in cloud services')).toBeVisible();
  });

  test('should display action buttons', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/changes*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          changes: [
            {
              id: 'change-1',
              type: 'metric_change',
              category: 'Revenue',
              description: 'Revenue increased',
              fromValue: 100000000,
              toValue: 150000000,
              delta: 50,
              materiality: 'high',
              context: 'Strong growth',
            },
          ],
          summary: { total: 1, material: 1, byType: {} },
        }),
      });
    });
    
    // Select periods and detect
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    await page.click('button:has-text("Detect Changes")');
    await page.waitForTimeout(1000);
    
    // Check action buttons
    await expect(page.locator('button:has-text("View Source")')).toBeVisible();
    await expect(page.locator('button:has-text("Save to Scratchpad")')).toBeVisible();
  });

  test('should filter changes by type', async ({ page }) => {
    // Mock successful API response with multiple types
    await page.route('**/api/deals/*/insights/changes*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          changes: [
            {
              id: 'change-1',
              type: 'metric_change',
              category: 'Revenue',
              description: 'Revenue increased',
              fromValue: 100000000,
              toValue: 150000000,
              delta: 50,
              materiality: 'high',
              context: 'Strong growth',
            },
            {
              id: 'change-2',
              type: 'new_disclosure',
              category: 'Risk',
              description: 'New risk',
              fromValue: null,
              toValue: 'New risk',
              delta: null,
              materiality: 'medium',
              context: 'Added',
            },
          ],
          summary: { total: 2, material: 1, byType: {} },
        }),
      });
    });
    
    // Select periods and detect
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    await page.click('button:has-text("Detect Changes")');
    await page.waitForTimeout(1000);
    
    // Initially should show 2 changes
    await expect(page.locator('text=Found 2 change(s)')).toBeVisible();
    
    // Uncheck "New Disclosures"
    await page.click('label:has-text("New Disclosures") input[type="checkbox"]');
    
    // Should now show 1 change
    await expect(page.locator('text=Found 1 change(s)')).toBeVisible();
  });

  test('should filter changes by materiality', async ({ page }) => {
    // Mock successful API response with different materiality levels
    await page.route('**/api/deals/*/insights/changes*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          changes: [
            {
              id: 'change-1',
              type: 'metric_change',
              category: 'Revenue',
              description: 'Revenue increased',
              fromValue: 100000000,
              toValue: 150000000,
              delta: 50,
              materiality: 'high',
              context: 'Strong growth',
            },
            {
              id: 'change-2',
              type: 'language_change',
              category: 'MD&A',
              description: 'Tone shift',
              fromValue: 'positive',
              toValue: 'cautious',
              delta: null,
              materiality: 'low',
              context: 'Language change',
            },
          ],
          summary: { total: 2, material: 1, byType: {} },
        }),
      });
    });
    
    // Select periods and detect
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    await page.click('button:has-text("Detect Changes")');
    await page.waitForTimeout(1000);
    
    // Initially should show 2 changes
    await expect(page.locator('text=Found 2 change(s)')).toBeVisible();
    
    // Select "High Materiality" only
    await page.click('label:has-text("High Materiality") input[type="radio"]');
    
    // Should now show 1 change
    await expect(page.locator('text=Found 1 change(s)')).toBeVisible();
  });

  test('should display empty state when no changes match filters', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/changes*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          changes: [
            {
              id: 'change-1',
              type: 'metric_change',
              category: 'Revenue',
              description: 'Revenue increased',
              fromValue: 100000000,
              toValue: 150000000,
              delta: 50,
              materiality: 'high',
              context: 'Strong growth',
            },
          ],
          summary: { total: 1, material: 1, byType: {} },
        }),
      });
    });
    
    // Select periods and detect
    const fromSelect = page.locator('select').first();
    await fromSelect.selectOption('FY2023');
    
    const toSelect = page.locator('select').nth(1);
    await toSelect.selectOption('FY2024');
    
    await page.click('button:has-text("Detect Changes")');
    await page.waitForTimeout(1000);
    
    // Uncheck all change types
    await page.click('label:has-text("New Disclosures") input[type="checkbox"]');
    await page.click('label:has-text("Language Changes") input[type="checkbox"]');
    await page.click('label:has-text("Metric Changes") input[type="checkbox"]');
    await page.click('label:has-text("Accounting Changes") input[type="checkbox"]');
    
    // Should show 0 changes
    await expect(page.locator('text=Found 0 change(s)')).toBeVisible();
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Check section is visible
    await expect(page.locator('text=Change Tracker')).toBeVisible();
    
    // Check controls stack vertically
    const grid = page.locator('.grid-cols-1');
    await expect(grid).toBeVisible();
  });
});
