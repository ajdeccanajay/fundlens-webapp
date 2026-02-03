import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Comp Table Frontend (Task 2.3)
 * 
 * Tests the Company Comparison UI in the Insights tab
 */

test.describe('Comp Table Frontend', () => {
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

  test('should display company comparison section', async ({ page }) => {
    // Check section header
    await expect(page.locator('text=Company Comparison')).toBeVisible();
    
    // Check refresh button
    await expect(page.locator('button:has-text("Refresh")')).toBeVisible();
  });

  test('should display company selection dropdown', async ({ page }) => {
    // Check company selection label
    await expect(page.locator('text=Companies')).toBeVisible();
    
    // Click to open dropdown
    await page.click('button:has-text("Select companies...")');
    
    // Check dropdown is visible
    await expect(page.locator('input[placeholder="Search companies..."]')).toBeVisible();
    
    // Check available companies
    await expect(page.locator('text=AMZN')).toBeVisible();
    await expect(page.locator('text=GOOGL')).toBeVisible();
    await expect(page.locator('text=META')).toBeVisible();
  });

  test('should allow selecting multiple companies', async ({ page }) => {
    // Open company dropdown
    await page.click('button:has-text("Select companies...")');
    
    // Select AMZN
    await page.click('label:has-text("AMZN") input[type="checkbox"]');
    
    // Select GOOGL
    await page.click('label:has-text("GOOGL") input[type="checkbox"]');
    
    // Close dropdown
    await page.click('body');
    
    // Check selected count
    await expect(page.locator('text=(2 selected)')).toBeVisible();
    
    // Check selected companies displayed
    await expect(page.locator('text=AMZN, GOOGL')).toBeVisible();
  });

  test('should filter companies with search', async ({ page }) => {
    // Open company dropdown
    await page.click('button:has-text("Select companies...")');
    
    // Type in search
    await page.fill('input[placeholder="Search companies..."]', 'AMZ');
    
    // Check only AMZN is visible
    await expect(page.locator('label:has-text("AMZN")')).toBeVisible();
    await expect(page.locator('label:has-text("GOOGL")')).not.toBeVisible();
  });

  test('should display metric selection dropdown', async ({ page }) => {
    // Check metric selection label
    await expect(page.locator('text=Metrics')).toBeVisible();
    
    // Click to open dropdown
    await page.click('button:has-text("Select metrics...")');
    
    // Check available metrics
    await expect(page.locator('text=revenue')).toBeVisible();
    await expect(page.locator('text=gross profit')).toBeVisible();
    await expect(page.locator('text=operating income')).toBeVisible();
  });

  test('should allow selecting multiple metrics', async ({ page }) => {
    // Open metric dropdown
    await page.click('button:has-text("Select metrics...")');
    
    // Select revenue
    await page.click('label:has-text("revenue") input[type="checkbox"]');
    
    // Select gross profit
    await page.click('label:has-text("gross profit") input[type="checkbox"]');
    
    // Close dropdown
    await page.click('body');
    
    // Check selected count
    await expect(page.locator('text=(2 selected)')).toBeVisible();
    
    // Check display text
    await expect(page.locator('text=2 metric(s)')).toBeVisible();
  });

  test('should display period selection', async ({ page }) => {
    // Check period label
    await expect(page.locator('text=Period')).toBeVisible();
    
    // Check dropdown has options
    const periodSelect = page.locator('select').first();
    await expect(periodSelect).toBeVisible();
    
    // Check default value
    const value = await periodSelect.inputValue();
    expect(value).toBe('FY2024');
  });

  test('should disable build button when no selection', async ({ page }) => {
    // Check build button is disabled
    const buildButton = page.locator('button:has-text("Build Comparison")');
    await expect(buildButton).toBeDisabled();
  });

  test('should enable build button with valid selection', async ({ page }) => {
    // Select companies
    await page.click('button:has-text("Select companies...")');
    await page.click('label:has-text("AMZN") input[type="checkbox"]');
    await page.click('body');
    
    // Select metrics
    await page.click('button:has-text("Select metrics...")');
    await page.click('label:has-text("revenue") input[type="checkbox"]');
    await page.click('body');
    
    // Check build button is enabled
    const buildButton = page.locator('button:has-text("Build Comparison")');
    await expect(buildButton).toBeEnabled();
  });

  test('should display empty state initially', async ({ page }) => {
    // Check empty state
    await expect(page.locator('text=No comparison table built yet')).toBeVisible();
    await expect(page.locator('text=Select companies and metrics above')).toBeVisible();
  });

  test('should display loading state when building', async ({ page }) => {
    // Select companies and metrics
    await page.click('button:has-text("Select companies...")');
    await page.click('label:has-text("AMZN") input[type="checkbox"]');
    await page.click('body');
    
    await page.click('button:has-text("Select metrics...")');
    await page.click('label:has-text("revenue") input[type="checkbox"]');
    await page.click('body');
    
    // Click build button
    await page.click('button:has-text("Build Comparison")');
    
    // Check loading state appears
    await expect(page.locator('text=Building comparison table...')).toBeVisible();
  });

  test('should display error state on failure', async ({ page }) => {
    // Mock API to return error
    await page.route('**/api/deals/*/insights/comp-table*', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });
    
    // Select companies and metrics
    await page.click('button:has-text("Select companies...")');
    await page.click('label:has-text("AMZN") input[type="checkbox"]');
    await page.click('body');
    
    await page.click('button:has-text("Select metrics...")');
    await page.click('label:has-text("revenue") input[type="checkbox"]');
    await page.click('body');
    
    // Click build button
    await page.click('button:has-text("Build Comparison")');
    
    // Wait for error
    await page.waitForTimeout(1000);
    
    // Check error message
    await expect(page.locator('.bg-red-50')).toBeVisible();
  });

  test('should display comparison table with data', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/comp-table*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          data: {
            headers: ['ticker', 'companyName', 'revenue'],
            rows: [
              {
                ticker: 'AMZN',
                companyName: 'Amazon',
                values: { revenue: 574800000000 },
                percentiles: { revenue: 100 },
                outliers: [],
              },
              {
                ticker: 'GOOGL',
                companyName: 'Alphabet',
                values: { revenue: 307400000000 },
                percentiles: { revenue: 50 },
                outliers: [],
              },
            ],
            summary: {
              median: { revenue: 307400000000 },
              mean: { revenue: 441100000000 },
            },
          },
        }),
      });
    });
    
    // Select companies and metrics
    await page.click('button:has-text("Select companies...")');
    await page.click('label:has-text("AMZN") input[type="checkbox"]');
    await page.click('label:has-text("GOOGL") input[type="checkbox"]');
    await page.click('body');
    
    await page.click('button:has-text("Select metrics...")');
    await page.click('label:has-text("revenue") input[type="checkbox"]');
    await page.click('body');
    
    // Click build button
    await page.click('button:has-text("Build Comparison")');
    
    // Wait for table
    await page.waitForTimeout(1000);
    
    // Check table headers
    await expect(page.locator('th:has-text("Ticker")')).toBeVisible();
    await expect(page.locator('th:has-text("Company")')).toBeVisible();
    await expect(page.locator('th:has-text("revenue")')).toBeVisible();
    
    // Check table data
    await expect(page.locator('td:has-text("AMZN")')).toBeVisible();
    await expect(page.locator('td:has-text("Amazon")')).toBeVisible();
    await expect(page.locator('td:has-text("GOOGL")')).toBeVisible();
    await expect(page.locator('td:has-text("Alphabet")')).toBeVisible();
  });

  test('should display percentile bars', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/comp-table*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          data: {
            headers: ['ticker', 'companyName', 'revenue'],
            rows: [
              {
                ticker: 'AMZN',
                companyName: 'Amazon',
                values: { revenue: 574800000000 },
                percentiles: { revenue: 100 },
                outliers: [],
              },
            ],
            summary: {
              median: { revenue: 574800000000 },
              mean: { revenue: 574800000000 },
            },
          },
        }),
      });
    });
    
    // Select companies and metrics
    await page.click('button:has-text("Select companies...")');
    await page.click('label:has-text("AMZN") input[type="checkbox"]');
    await page.click('body');
    
    await page.click('button:has-text("Select metrics...")');
    await page.click('label:has-text("revenue") input[type="checkbox"]');
    await page.click('body');
    
    // Click build button
    await page.click('button:has-text("Build Comparison")');
    
    // Wait for table
    await page.waitForTimeout(1000);
    
    // Check percentile bar exists
    await expect(page.locator('.bg-indigo-500').first()).toBeVisible();
    
    // Check percentile text
    await expect(page.locator('text=100th %ile')).toBeVisible();
  });

  test('should display summary statistics', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/comp-table*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          data: {
            headers: ['ticker', 'companyName', 'revenue'],
            rows: [
              {
                ticker: 'AMZN',
                companyName: 'Amazon',
                values: { revenue: 574800000000 },
                percentiles: { revenue: 100 },
                outliers: [],
              },
            ],
            summary: {
              median: { revenue: 574800000000 },
              mean: { revenue: 574800000000 },
            },
          },
        }),
      });
    });
    
    // Select companies and metrics
    await page.click('button:has-text("Select companies...")');
    await page.click('label:has-text("AMZN") input[type="checkbox"]');
    await page.click('body');
    
    await page.click('button:has-text("Select metrics...")');
    await page.click('label:has-text("revenue") input[type="checkbox"]');
    await page.click('body');
    
    // Click build button
    await page.click('button:has-text("Build Comparison")');
    
    // Wait for table
    await page.waitForTimeout(1000);
    
    // Check summary section
    await expect(page.locator('text=Summary Statistics')).toBeVisible();
    await expect(page.locator('text=Median:')).toBeVisible();
    await expect(page.locator('text=Mean:')).toBeVisible();
  });

  test('should disable export button when no data', async ({ page }) => {
    // Check export button is disabled
    const exportButton = page.locator('button:has-text("Export Excel")');
    await expect(exportButton).toBeDisabled();
  });

  test('should enable export button with data', async ({ page }) => {
    // Mock successful API response
    await page.route('**/api/deals/*/insights/comp-table*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          data: {
            headers: ['ticker', 'companyName', 'revenue'],
            rows: [
              {
                ticker: 'AMZN',
                companyName: 'Amazon',
                values: { revenue: 574800000000 },
                percentiles: { revenue: 100 },
                outliers: [],
              },
            ],
            summary: {
              median: { revenue: 574800000000 },
              mean: { revenue: 574800000000 },
            },
          },
        }),
      });
    });
    
    // Select companies and metrics
    await page.click('button:has-text("Select companies...")');
    await page.click('label:has-text("AMZN") input[type="checkbox"]');
    await page.click('body');
    
    await page.click('button:has-text("Select metrics...")');
    await page.click('label:has-text("revenue") input[type="checkbox"]');
    await page.click('body');
    
    // Click build button
    await page.click('button:has-text("Build Comparison")');
    
    // Wait for table
    await page.waitForTimeout(1000);
    
    // Check export button is enabled
    const exportButton = page.locator('button:has-text("Export Excel")');
    await expect(exportButton).toBeEnabled();
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Check section is visible
    await expect(page.locator('text=Company Comparison')).toBeVisible();
    
    // Check controls stack vertically
    const grid = page.locator('.grid-cols-1');
    await expect(grid).toBeVisible();
  });
});
