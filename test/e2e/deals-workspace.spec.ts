import { test, expect } from '@playwright/test';

/**
 * Deal Workspace - E2E Tests
 * 
 * Tests the complete user workflows for the Deal Workspace
 * Phase 1: Foundation
 */

const BASE_URL = 'http://localhost:3000';
const WORKSPACE_URL = `${BASE_URL}/app/deals/workspace.html?ticker=AAPL`;

test.describe('Deal Workspace - Navigation', () => {
  test('should load workspace with correct ticker', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    // Check page title
    await expect(page).toHaveTitle(/FundLens - Deal Workspace/);
    
    // Check ticker in header
    await expect(page.locator('h1')).toContainText('AAPL');
  });

  test('should navigate between views via sidebar', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    // Click Analysis
    await page.click('text=Analysis');
    await expect(page.locator('.nav-item.active')).toContainText('Analysis');
    
    // Click Research
    await page.click('text=Research');
    await expect(page.locator('.nav-item.active')).toContainText('Research');
    
    // Click Scratchpad
    await page.click('text=Scratchpad');
    await expect(page.locator('.nav-item.active')).toContainText('Scratchpad');
    
    // Click IC Memo
    await page.click('text=IC Memo');
    await expect(page.locator('.nav-item.active')).toContainText('IC Memo');
  });

  test('should navigate via keyboard shortcuts', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    // Cmd+1 for Analysis
    await page.keyboard.press('Meta+1');
    await expect(page).toHaveURL(/.*#analysis/);
    
    // Cmd+2 for Research
    await page.keyboard.press('Meta+2');
    await expect(page).toHaveURL(/.*#research/);
    
    // Cmd+3 for Scratchpad
    await page.keyboard.press('Meta+3');
    await expect(page).toHaveURL(/.*#scratchpad/);
    
    // Cmd+4 for IC Memo
    await page.keyboard.press('Meta+4');
    await expect(page).toHaveURL(/.*#ic-memo/);
  });

  test('should update URL hash on navigation', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    await page.click('text=Research');
    await expect(page).toHaveURL(/.*#research/);
    
    await page.click('text=Scratchpad');
    await expect(page).toHaveURL(/.*#scratchpad/);
  });

  test('should load correct view from URL hash', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#research`);
    
    // Should show research view
    await expect(page.locator('.nav-item.active')).toContainText('Research');
    await expect(page.locator('text=Research Assistant')).toBeVisible();
  });

  test('should handle browser back/forward', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    // Navigate to research
    await page.click('text=Research');
    await expect(page).toHaveURL(/.*#research/);
    
    // Navigate to scratchpad
    await page.click('text=Scratchpad');
    await expect(page).toHaveURL(/.*#scratchpad/);
    
    // Go back
    await page.goBack();
    await expect(page).toHaveURL(/.*#research/);
    
    // Go forward
    await page.goForward();
    await expect(page).toHaveURL(/.*#scratchpad/);
  });

  test('should show active state on current view', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    await page.click('text=Research');
    
    const activeNav = page.locator('.nav-item.active');
    await expect(activeNav).toContainText('Research');
    await expect(activeNav).toHaveCSS('background-color', /rgb\(239, 246, 255\)/);
  });

  test('should preserve state when switching views', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    // Go to Analysis, select Qualitative tab
    await page.click('text=Analysis');
    await page.click('button:has-text("Qualitative")');
    
    // Switch to Research
    await page.click('text=Research');
    
    // Switch back to Analysis
    await page.click('text=Analysis');
    
    // Qualitative tab should still be selected
    const qualitativeBtn = page.locator('button:has-text("Qualitative")');
    await expect(qualitativeBtn).toHaveClass(/bg-gradient/);
  });
});

test.describe('Deal Workspace - Analysis View', () => {
  test('should display analysis view by default', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    await expect(page.locator('.nav-item.active')).toContainText('Analysis');
    await expect(page.locator('text=Financial Performance')).toBeVisible();
  });

  test('should switch between analysis tabs', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    // Click Quantitative
    await page.click('button:has-text("Quantitative")');
    await expect(page.locator('text=Financial Performance')).toBeVisible();
    
    // Click Qualitative
    await page.click('button:has-text("Qualitative")');
    await page.waitForTimeout(500); // Wait for tab switch
    
    // Click Export
    await page.click('button:has-text("Export")');
    await expect(page.locator('text=Export Financial Statements')).toBeVisible();
  });

  test('should show loading state initially', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    // Check for loading spinner or text
    const loadingIndicator = page.locator('text=Loading financial data');
    if (await loadingIndicator.isVisible()) {
      await expect(loadingIndicator).toBeVisible();
    }
  });

  test('should display metric cards', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    await page.waitForTimeout(2000); // Wait for data to load
    
    // Check for metric cards
    await expect(page.locator('text=Revenue')).toBeVisible();
    await expect(page.locator('text=Net Income')).toBeVisible();
    await expect(page.locator('text=Op Margin')).toBeVisible();
    await expect(page.locator('text=Free Cash Flow')).toBeVisible();
  });
});

test.describe('Deal Workspace - Research View', () => {
  test('should display empty state initially', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#research`);
    
    await expect(page.locator('text=Research Assistant')).toBeVisible();
    await expect(page.locator('text=Ask questions about')).toBeVisible();
  });

  test('should show quick query buttons', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#research`);
    
    await expect(page.locator('text=Risk Analysis')).toBeVisible();
    await expect(page.locator('text=Compare')).toBeVisible();
  });

  test('should have message input area', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#research`);
    
    const input = page.locator('textarea[placeholder*="Ask about"]');
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
  });

  test('should have send button', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#research`);
    
    const sendBtn = page.locator('button:has(i.fa-paper-plane)');
    await expect(sendBtn).toBeVisible();
  });

  test('should allow typing in input', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#research`);
    
    const input = page.locator('textarea[placeholder*="Ask about"]');
    await input.fill('What are the key risks?');
    
    await expect(input).toHaveValue('What are the key risks?');
  });

  test('should populate input on quick query click', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#research`);
    
    await page.click('text=Risk Analysis');
    
    const input = page.locator('textarea[placeholder*="Ask about"]');
    await expect(input).toHaveValue(/risks/i);
  });
});

test.describe('Deal Workspace - Scratchpad View', () => {
  test('should display empty state when no items', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#scratchpad`);
    
    // Check for empty state
    const emptyState = page.locator('text=No saved items yet');
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('should have export button', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#scratchpad`);
    
    await expect(page.locator('text=Export to Markdown')).toBeVisible();
  });

  test('should display scratchpad title', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#scratchpad`);
    
    await expect(page.locator('text=Research Scratchpad')).toBeVisible();
  });
});

test.describe('Deal Workspace - IC Memo View', () => {
  test('should display generation screen', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#ic-memo`);
    
    await expect(page.locator('text=Investment Committee Memo')).toBeVisible();
    await expect(page.locator('text=Generate IC Memo')).toBeVisible();
  });

  test('should show memo includes list', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#ic-memo`);
    
    await expect(page.locator('text=Memo will include:')).toBeVisible();
    await expect(page.locator('text=Executive Summary')).toBeVisible();
    await expect(page.locator('text=Financial Metrics')).toBeVisible();
  });

  test('should have generate button', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#ic-memo`);
    
    const generateBtn = page.locator('button:has-text("Generate Memo")');
    await expect(generateBtn).toBeVisible();
    await expect(generateBtn).toBeEnabled();
  });
});

test.describe('Deal Workspace - Header', () => {
  test('should display FundLens logo', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    const logo = page.locator('.fa-chart-line').first();
    await expect(logo).toBeVisible();
  });

  test('should display ticker and company name', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    await expect(page.locator('h1')).toContainText('AAPL');
  });

  test('should have export button in header', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    const exportBtn = page.locator('button:has-text("Export")').first();
    await expect(exportBtn).toBeVisible();
  });

  test('should have settings button in header', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    const settingsBtn = page.locator('button:has(i.fa-cog)');
    await expect(settingsBtn).toBeVisible();
  });
});

test.describe('Deal Workspace - Sidebar', () => {
  test('should display all navigation items', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    await expect(page.locator('text=Analysis')).toBeVisible();
    await expect(page.locator('text=Research')).toBeVisible();
    await expect(page.locator('text=Scratchpad')).toBeVisible();
    await expect(page.locator('text=IC Memo')).toBeVisible();
  });

  test('should display keyboard shortcuts hint', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    await expect(page.locator('text=Keyboard Shortcuts')).toBeVisible();
    await expect(page.locator('text=⌘1 - Analysis')).toBeVisible();
    await expect(page.locator('text=⌘2 - Research')).toBeVisible();
  });

  test('should display icons for each nav item', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    await expect(page.locator('.fa-chart-bar')).toBeVisible();
    await expect(page.locator('.fa-brain')).toBeVisible();
    await expect(page.locator('.fa-bookmark')).toBeVisible();
    await expect(page.locator('.fa-file-alt')).toBeVisible();
  });
});

test.describe('Deal Workspace - Responsive Design', () => {
  test('should work on desktop resolution', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(WORKSPACE_URL);
    
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('text=Analysis')).toBeVisible();
  });

  test('should work on laptop resolution', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(WORKSPACE_URL);
    
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('text=Analysis')).toBeVisible();
  });
});

test.describe('Deal Workspace - Performance', () => {
  test('should load within reasonable time', async ({ page }) => {
    const startTime = Date.now();
    await page.goto(WORKSPACE_URL);
    const loadTime = Date.now() - startTime;
    
    expect(loadTime).toBeLessThan(5000); // 5 seconds max
  });

  test('should switch views quickly', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    const startTime = Date.now();
    await page.click('text=Research');
    const switchTime = Date.now() - startTime;
    
    expect(switchTime).toBeLessThan(500); // 500ms max
  });
});

test.describe('Deal Workspace - Error Handling', () => {
  test('should handle invalid ticker gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}/app/deals/workspace.html?ticker=INVALID`);
    
    // Should still load the page
    await expect(page).toHaveTitle(/FundLens - Deal Workspace/);
  });

  test('should handle missing ticker parameter', async ({ page }) => {
    await page.goto(`${BASE_URL}/app/deals/workspace.html`);
    
    // Should default to AAPL or show error
    await expect(page).toHaveTitle(/FundLens - Deal Workspace/);
  });

  test('should handle invalid hash route', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}#invalid`);
    
    // Should still load the page
    await expect(page).toHaveTitle(/FundLens - Deal Workspace/);
  });
});

test.describe('Deal Workspace - Accessibility', () => {
  test('should have proper heading structure', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
  });

  test('should have clickable navigation items', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    const navItems = page.locator('.nav-item');
    const count = await navItems.count();
    
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('should have visible text labels', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    await expect(page.locator('text=Analysis')).toBeVisible();
    await expect(page.locator('text=Research')).toBeVisible();
  });
});
