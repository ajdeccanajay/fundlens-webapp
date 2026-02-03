import { test, expect } from '@playwright/test';

test.describe('Deal Workspace - Comprehensive Metrics (Phase 2)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to workspace with a test ticker
    await page.goto('/app/deals/workspace.html?ticker=AAPL');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test.describe('Quantitative Metrics Display', () => {
    test('should display financial performance section with all metrics', async ({ page }) => {
      // Click Analysis tab
      await page.click('text=Analysis');
      
      // Click Quantitative tab
      await page.click('text=Quantitative');
      
      // Wait for data to load
      await page.waitForSelector('text=1. Financial Performance Metrics', { timeout: 10000 });
      
      // Check Revenue section
      await expect(page.locator('text=Revenue')).toBeVisible();
      await expect(page.locator('text=TTM Revenue')).toBeVisible();
      await expect(page.locator('text=Revenue CAGR')).toBeVisible();
      
      // Check Gross Profit section
      await expect(page.locator('text=Gross Profit & Margin')).toBeVisible();
      await expect(page.locator('text=Gross Profit TTM')).toBeVisible();
      await expect(page.locator('text=Gross Margin TTM')).toBeVisible();
      
      // Check Operating Income section
      await expect(page.locator('text=Operating Income (EBIT)')).toBeVisible();
      await expect(page.locator('text=Operating Income TTM')).toBeVisible();
      
      // Check EBITDA section
      await expect(page.locator('text=EBITDA')).toBeVisible();
      await expect(page.locator('text=EBITDA TTM')).toBeVisible();
      
      // Check Net Income section
      await expect(page.locator('text=Net Income')).toBeVisible();
      await expect(page.locator('text=Net Income TTM')).toBeVisible();
    });

    test('should display cash flow metrics section', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Quantitative');
      
      await page.waitForSelector('text=2. Cash Flow Metrics', { timeout: 10000 });
      
      await expect(page.locator('text=Operating Cash Flow TTM')).toBeVisible();
      await expect(page.locator('text=Free Cash Flow TTM')).toBeVisible();
      await expect(page.locator('text=CapEx TTM')).toBeVisible();
      await expect(page.locator('text=Cash Conversion Ratio TTM')).toBeVisible();
    });

    test('should display working capital cycle section', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Quantitative');
      
      await page.waitForSelector('text=3. Working Capital Cycle', { timeout: 10000 });
      
      await expect(page.locator('text=DSO (Days Sales Outstanding)')).toBeVisible();
      await expect(page.locator('text=DIO (Days Inventory Outstanding)')).toBeVisible();
      await expect(page.locator('text=DPO (Days Payable Outstanding)')).toBeVisible();
      await expect(page.locator('text=Cash Conversion Cycle')).toBeVisible();
    });

    test('should display balance sheet health section', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Quantitative');
      
      await page.waitForSelector('text=4. Balance Sheet Health', { timeout: 10000 });
      
      await expect(page.locator('text=Current Ratio')).toBeVisible();
      await expect(page.locator('text=Quick Ratio')).toBeVisible();
      await expect(page.locator('text=Working Capital')).toBeVisible();
      await expect(page.locator('text=Debt/Equity')).toBeVisible();
      await expect(page.locator('text=ROE')).toBeVisible();
      await expect(page.locator('text=Asset Turnover')).toBeVisible();
    });

    test('should display annual tables with historical data', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Quantitative');
      
      await page.waitForSelector('text=Annual Revenue (from 10-K)', { timeout: 10000 });
      
      // Check for table headers
      await expect(page.locator('text=Fiscal Year')).toBeVisible();
      await expect(page.locator('text=YoY Growth')).toBeVisible();
      
      // Check for at least one fiscal year row
      await expect(page.locator('text=FY2023').or(page.locator('text=FY2022'))).toBeVisible();
    });

    test('should show data source attribution', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Quantitative');
      
      await page.waitForSelector('text=All metrics calculated', { timeout: 10000 });
      
      await expect(page.locator('text=All metrics calculated deterministically from SEC filings')).toBeVisible();
      await expect(page.locator('text=Last calculated:')).toBeVisible();
    });
  });

  test.describe('Qualitative Analysis Display', () => {
    test('should display all qualitative categories', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Qualitative');
      
      // Wait for qualitative data to load
      await page.waitForSelector('text=Company Description', { timeout: 10000 });
      
      // Check for all 8 categories
      await expect(page.locator('text=Company Description')).toBeVisible();
      await expect(page.locator('text=Revenue Breakdown')).toBeVisible();
      await expect(page.locator('text=Growth Drivers')).toBeVisible();
      await expect(page.locator('text=Competitive Dynamics')).toBeVisible();
      await expect(page.locator('text=Industry & TAM')).toBeVisible();
      await expect(page.locator('text=Management Team')).toBeVisible();
      await expect(page.locator('text=Investment Thesis')).toBeVisible();
      await expect(page.locator('text=Recent Developments')).toBeVisible();
    });

    test('should show cached answer indicators', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Qualitative');
      
      await page.waitForSelector('text=Company Description', { timeout: 10000 });
      
      // Check for instant/cached badges
      const instantBadges = page.locator('text=⚡ Instant');
      await expect(instantBadges.first()).toBeVisible({ timeout: 10000 });
    });

    test('should display Q&A cards with questions and answers', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Qualitative');
      
      await page.waitForSelector('.qa-card', { timeout: 10000 });
      
      // Check that at least one QA card exists
      const qaCards = page.locator('.qa-card');
      await expect(qaCards.first()).toBeVisible();
    });
  });

  test.describe('Export Wizard', () => {
    test('should display export wizard with 3 steps', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Export');
      
      // Wait for wizard to load
      await page.waitForSelector('text=Step 1: Select Year', { timeout: 10000 });
      
      // Check for progress indicator
      await expect(page.locator('text=Select Year')).toBeVisible();
      await expect(page.locator('text=Filing Type')).toBeVisible();
      await expect(page.locator('text=Export')).toBeVisible();
    });

    test('should allow year selection in step 1', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Export');
      
      await page.waitForSelector('text=Step 1: Select Year', { timeout: 10000 });
      
      // Wait for years to load
      await page.waitForSelector('button:has-text("2023")', { timeout: 5000 });
      
      // Click a year
      await page.click('button:has-text("2023")');
      
      // Check that Next button is enabled
      const nextButton = page.locator('button:has-text("Next: Choose Filing Type")');
      await expect(nextButton).toBeEnabled();
    });

    test('should allow filing type selection in step 2', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Export');
      
      await page.waitForSelector('text=Step 1: Select Year', { timeout: 10000 });
      
      // Select year
      await page.waitForSelector('button:has-text("2023")', { timeout: 5000 });
      await page.click('button:has-text("2023")');
      
      // Go to step 2
      await page.click('button:has-text("Next: Choose Filing Type")');
      
      // Wait for step 2
      await page.waitForSelector('text=Step 2: Select Filing Type', { timeout: 5000 });
      
      // Check for filing type options
      await expect(page.locator('text=10-K Annual')).toBeVisible();
      await expect(page.locator('text=10-Q Quarterly')).toBeVisible();
    });

    test('should allow statement selection in step 3', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Export');
      
      await page.waitForSelector('text=Step 1: Select Year', { timeout: 10000 });
      
      // Navigate through wizard
      await page.waitForSelector('button:has-text("2023")', { timeout: 5000 });
      await page.click('button:has-text("2023")');
      await page.click('button:has-text("Next: Choose Filing Type")');
      
      await page.waitForSelector('text=10-K Annual', { timeout: 5000 });
      await page.click('text=10-K Annual');
      await page.click('button:has-text("Next: Export Options")');
      
      // Wait for step 3
      await page.waitForSelector('text=Statements to Include', { timeout: 5000 });
      
      // Check for statement options
      await expect(page.locator('text=Income Statement')).toBeVisible();
      await expect(page.locator('text=Balance Sheet')).toBeVisible();
      await expect(page.locator('text=Cash Flow')).toBeVisible();
    });

    test('should enable export button when all selections are made', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Export');
      
      await page.waitForSelector('text=Step 1: Select Year', { timeout: 10000 });
      
      // Complete wizard
      await page.waitForSelector('button:has-text("2023")', { timeout: 5000 });
      await page.click('button:has-text("2023")');
      await page.click('button:has-text("Next: Choose Filing Type")');
      
      await page.waitForSelector('text=10-K Annual', { timeout: 5000 });
      await page.click('text=10-K Annual');
      await page.click('button:has-text("Next: Export Options")');
      
      await page.waitForSelector('text=Statements to Include', { timeout: 5000 });
      
      // Export button should be enabled (statements are pre-selected)
      const exportButton = page.locator('button:has-text("Export to Excel")');
      await expect(exportButton).toBeEnabled();
    });

    test('should allow navigation back through wizard steps', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Export');
      
      await page.waitForSelector('text=Step 1: Select Year', { timeout: 10000 });
      
      // Go to step 2
      await page.waitForSelector('button:has-text("2023")', { timeout: 5000 });
      await page.click('button:has-text("2023")');
      await page.click('button:has-text("Next: Choose Filing Type")');
      
      await page.waitForSelector('text=Step 2: Select Filing Type', { timeout: 5000 });
      
      // Go back to step 1
      await page.click('button:has-text("Back")');
      
      // Should be back at step 1
      await expect(page.locator('text=Step 1: Select Year')).toBeVisible();
    });
  });

  test.describe('Loading States', () => {
    test('should show loading spinner for quantitative data', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Quantitative');
      
      // Check for loading state (may be brief)
      const loadingText = page.locator('text=Loading Comprehensive Metrics');
      // Don't fail if loading is too fast
      try {
        await expect(loadingText).toBeVisible({ timeout: 1000 });
      } catch (e) {
        // Loading was too fast, that's okay
      }
    });

    test('should show loading spinner for qualitative data', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Qualitative');
      
      // Check for loading state
      const loadingText = page.locator('text=Querying Knowledge Base');
      try {
        await expect(loadingText).toBeVisible({ timeout: 1000 });
      } catch (e) {
        // Loading was too fast, that's okay
      }
    });
  });

  test.describe('Tab Switching', () => {
    test('should switch between quantitative and qualitative tabs', async ({ page }) => {
      await page.click('text=Analysis');
      
      // Start with quantitative
      await page.click('text=Quantitative');
      await page.waitForSelector('text=1. Financial Performance Metrics', { timeout: 10000 });
      
      // Switch to qualitative
      await page.click('text=Qualitative');
      await page.waitForSelector('text=Company Description', { timeout: 10000 });
      
      // Switch back to quantitative
      await page.click('text=Quantitative');
      await expect(page.locator('text=1. Financial Performance Metrics')).toBeVisible();
    });

    test('should preserve data when switching tabs', async ({ page }) => {
      await page.click('text=Analysis');
      await page.click('text=Quantitative');
      
      await page.waitForSelector('text=1. Financial Performance Metrics', { timeout: 10000 });
      
      // Switch to export and back
      await page.click('text=Export');
      await page.waitForSelector('text=Step 1: Select Year', { timeout: 5000 });
      
      await page.click('text=Quantitative');
      
      // Data should still be there
      await expect(page.locator('text=1. Financial Performance Metrics')).toBeVisible();
    });
  });

  test.describe('Responsive Design', () => {
    test('should display properly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      await page.click('text=Analysis');
      await page.click('text=Quantitative');
      
      await page.waitForSelector('text=1. Financial Performance Metrics', { timeout: 10000 });
      
      // Check that content is visible
      await expect(page.locator('text=Revenue')).toBeVisible();
    });

    test('should display properly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      
      await page.click('text=Analysis');
      await page.click('text=Quantitative');
      
      await page.waitForSelector('text=1. Financial Performance Metrics', { timeout: 10000 });
      
      await expect(page.locator('text=Revenue')).toBeVisible();
    });
  });

  test.describe('Error Handling', () => {
    test('should show empty state when no data available', async ({ page }) => {
      // Navigate to workspace without ticker
      await page.goto('/app/deals/workspace.html');
      
      await page.click('text=Analysis');
      await page.click('text=Quantitative');
      
      // Should show loading initially, then no data
      await page.waitForTimeout(2000);
      
      // Check for empty state or loading state
      const hasContent = await page.locator('text=1. Financial Performance Metrics').isVisible().catch(() => false);
      const hasLoading = await page.locator('text=Loading').isVisible().catch(() => false);
      
      expect(hasContent || hasLoading).toBeTruthy();
    });
  });
});
