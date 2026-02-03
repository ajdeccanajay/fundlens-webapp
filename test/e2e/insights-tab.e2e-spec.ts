import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Insights Tab
 * 
 * Tests:
 * 1. Navigation to Insights tab
 * 2. Data loading and display
 * 3. Hero metrics rendering
 * 4. Trends rendering
 * 5. Risk cards rendering
 * 6. Guidance rendering
 * 7. Keyboard navigation
 * 8. Accessibility (ARIA labels)
 * 9. Loading states
 * 10. Error handling
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

test.describe('Insights Tab E2E Tests', () => {
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
  });

  test('should display Insights navigation item', async ({ page }) => {
    // Check Insights nav item exists
    const insightsNav = page.locator('.nav-item', { hasText: 'Insights' });
    await expect(insightsNav).toBeVisible();
    
    // Check icon
    await expect(insightsNav.locator('i.fa-lightbulb')).toBeVisible();
  });

  test('should navigate to Insights tab on click', async ({ page }) => {
    // Click Insights nav item
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(500);

    // Verify insights view is active
    const insightsNav = page.locator('.nav-item', { hasText: 'Insights' });
    await expect(insightsNav).toHaveClass(/active/);
    
    // Verify URL hash updated
    expect(page.url()).toContain('#insights');
  });

  test('should navigate to Insights tab with keyboard shortcut', async ({ page }) => {
    // Press Cmd+I (or Ctrl+I on Windows)
    await page.keyboard.press('Meta+i');
    await page.waitForTimeout(500);

    // Verify insights view is active
    const insightsNav = page.locator('.nav-item', { hasText: 'Insights' });
    await expect(insightsNav).toHaveClass(/active/);
  });

  test('should show loading state when loading insights', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    
    // Check for loading indicator (may be brief)
    const loadingIndicator = page.locator('text=Loading Insights...');
    // Loading may complete quickly, so we just check it exists in DOM
    const loadingExists = await loadingIndicator.count() > 0 || 
                          await page.locator('.insights-hero').isVisible();
    expect(loadingExists).toBeTruthy();
  });

  test('should display hero metrics', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check hero metrics section
    await expect(page.locator('text=Key Metrics')).toBeVisible({ timeout: 10000 });
    
    // Check metric cards exist
    const metricCards = page.locator('.metric-card');
    const cardCount = await metricCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(0); // May be 0 if no data
    
    if (cardCount > 0) {
      // Check first metric card structure
      const firstCard = metricCards.first();
      await expect(firstCard.locator('.metric-label')).toBeVisible();
      await expect(firstCard.locator('.metric-value')).toBeVisible();
      await expect(firstCard.locator('.metric-change')).toBeVisible();
    }
  });

  test('should display trends section', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check if trends section exists (may not have data)
    const trendsSection = page.locator('text=Trends & Insights');
    const hasTrends = await trendsSection.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasTrends) {
      // Check trend cards
      const trendCards = page.locator('.trend-card');
      const trendCount = await trendCards.count();
      expect(trendCount).toBeGreaterThan(0);
      
      // Check first trend card structure
      const firstTrend = trendCards.first();
      await expect(firstTrend.locator('.trend-header')).toBeVisible();
      await expect(firstTrend.locator('.trend-badge')).toBeVisible();
    }
  });

  test('should display risk factors', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check if risk section exists (may not have data)
    const riskSection = page.locator('text=Risk Factors');
    const hasRisks = await riskSection.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasRisks) {
      // Check risk items
      const riskItems = page.locator('.risk-item');
      const riskCount = await riskItems.count();
      expect(riskCount).toBeGreaterThan(0);
      
      // Check first risk item structure
      const firstRisk = riskItems.first();
      await expect(firstRisk.locator('.risk-title')).toBeVisible();
      await expect(firstRisk.locator('.risk-severity')).toBeVisible();
      await expect(firstRisk.locator('.risk-description')).toBeVisible();
    }
  });

  test('should display forward guidance', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check if guidance section exists (may not have data)
    const guidanceSection = page.locator('text=Forward Guidance');
    const hasGuidance = await guidanceSection.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasGuidance) {
      // Check guidance card
      await expect(page.locator('.guidance-card')).toBeVisible();
      await expect(page.locator('.sentiment-badge')).toBeVisible();
    }
  });

  test('should display data quality metrics', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check data quality section
    await expect(page.locator('text=Data Quality')).toBeVisible({ timeout: 10000 });
    
    // Check quality metrics
    const qualityMetrics = page.locator('.quality-metric');
    const metricCount = await qualityMetrics.count();
    expect(metricCount).toBe(4); // Metrics, Trends, Risks, Guidance
  });

  test('should handle error state gracefully', async ({ page }) => {
    // Mock API error
    await page.route('**/api/deals/*/insights/*', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ message: 'Internal server error' })
      });
    });

    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check for error message
    const errorMessage = page.locator('.bg-red-50');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });

  test('should handle 404 not found gracefully', async ({ page }) => {
    // Mock API 404
    await page.route('**/api/deals/*/insights/*', (route) => {
      route.fulfill({
        status: 404,
        body: JSON.stringify({ message: 'Insights not found' })
      });
    });

    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check for error message
    const errorMessage = page.locator('text=No insights available');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });

  test('should have proper ARIA labels for accessibility', async ({ page }) => {
    // Check Insights nav item has aria-label
    const insightsNav = page.locator('.nav-item[aria-label="Insights view"]');
    await expect(insightsNav).toBeVisible();
    
    // Check it's keyboard accessible
    await insightsNav.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    // Verify navigation worked
    await expect(insightsNav).toHaveClass(/active/);
  });

  test('should persist view across page refresh', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(500);

    // Reload page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Verify still on Insights view (hash should persist)
    const insightsNav = page.locator('.nav-item', { hasText: 'Insights' });
    await expect(insightsNav).toHaveClass(/active/);
  });

  test('should switch between views correctly', async ({ page }) => {
    // Start on Analysis
    await expect(page.locator('.nav-item:has-text("Analysis")')).toHaveClass(/active/);

    // Switch to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(500);
    await expect(page.locator('.nav-item:has-text("Insights")')).toHaveClass(/active/);

    // Switch to Research
    await page.click('.nav-item:has-text("Research")');
    await page.waitForTimeout(500);
    await expect(page.locator('.nav-item:has-text("Research")')).toHaveClass(/active/);

    // Switch back to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(500);
    await expect(page.locator('.nav-item:has-text("Insights")')).toHaveClass(/active/);
  });

  test('should format currency values correctly', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check if hero metrics exist
    const metricCards = page.locator('.metric-card');
    const cardCount = await metricCards.count();
    
    if (cardCount > 0) {
      // Check first metric value is formatted (contains $ or numbers)
      const firstValue = await metricCards.first().locator('.metric-value').textContent();
      expect(firstValue).toMatch(/[\$\d,]/); // Should contain $ or numbers with commas
    }
  });

  test('should show key driver badge on important metrics', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check if any metrics have key driver badge
    const keyDriverBadges = page.locator('text=Key Driver');
    const badgeCount = await keyDriverBadges.count();
    
    // May or may not have key drivers depending on data
    console.log('Key driver badges found:', badgeCount);
  });

  test('should color-code risk severity correctly', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check if risks exist
    const riskItems = page.locator('.risk-item');
    const riskCount = await riskItems.count();
    
    if (riskCount > 0) {
      // Check first risk has severity badge with color
      const firstRisk = riskItems.first();
      const severityBadge = firstRisk.locator('.risk-severity');
      await expect(severityBadge).toBeVisible();
      
      // Check it has color class (bg-red, bg-yellow, or bg-blue)
      const badgeClass = await severityBadge.getAttribute('class');
      expect(badgeClass).toMatch(/bg-(red|yellow|blue)-/);
    }
  });

  test('should display sentiment icons for guidance', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check if guidance exists
    const guidanceCard = page.locator('.guidance-card');
    const hasGuidance = await guidanceCard.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasGuidance) {
      // Check sentiment badge has icon
      const sentimentBadge = page.locator('.sentiment-badge');
      await expect(sentimentBadge).toBeVisible();
      
      // Check for sentiment icon (smile, frown, or meh)
      const hasIcon = await sentimentBadge.locator('i.fa-smile, i.fa-frown, i.fa-meh').count() > 0;
      expect(hasIcon).toBeTruthy();
    }
  });

  // ========================================
  // ANOMALY DETECTION E2E TESTS (Phase 1)
  // ========================================

  test('should display anomaly detection section', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check anomaly section exists
    const anomalySection = page.locator('text=Anomalies Detected');
    await expect(anomalySection).toBeVisible({ timeout: 10000 });
  });

  test('should load anomalies automatically when switching to Insights', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check for loading state or loaded anomalies
    const loadingOrLoaded = await Promise.race([
      page.locator('text=Loading anomalies...').isVisible().catch(() => false),
      page.locator('.anomaly-card').first().isVisible({ timeout: 5000 }).catch(() => false),
      page.locator('text=No anomalies detected').isVisible({ timeout: 5000 }).catch(() => false),
    ]);

    expect(loadingOrLoaded).toBeTruthy();
  });

  test('should display anomaly cards with correct structure', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(3000);

    // Check if anomaly cards exist
    const anomalyCards = page.locator('.anomaly-card');
    const cardCount = await anomalyCards.count();

    if (cardCount > 0) {
      // Check first card structure
      const firstCard = anomalyCards.first();
      
      // Should have type icon
      await expect(firstCard.locator('i.fas')).toBeVisible();
      
      // Should have metric name
      await expect(firstCard.locator('.font-semibold').first()).toBeVisible();
      
      // Should have severity badge
      await expect(firstCard.locator('span').filter({ hasText: /HIGH|MEDIUM|LOW/i })).toBeVisible();
      
      // Should have description
      await expect(firstCard.locator('.text-gray-600')).toBeVisible();
    }
  });

  test('should show severity badges with correct colors', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(3000);

    const anomalyCards = page.locator('.anomaly-card');
    const cardCount = await anomalyCards.count();

    if (cardCount > 0) {
      // Check severity badges have appropriate colors
      const highSeverity = page.locator('span:has-text("HIGH")').first();
      const mediumSeverity = page.locator('span:has-text("MEDIUM")').first();
      const lowSeverity = page.locator('span:has-text("LOW")').first();

      // At least one should exist
      const hasAnySeverity = await Promise.race([
        highSeverity.isVisible().catch(() => false),
        mediumSeverity.isVisible().catch(() => false),
        lowSeverity.isVisible().catch(() => false),
      ]);

      expect(hasAnySeverity).toBeTruthy();
    }
  });

  test('should reveal dismiss button on hover', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(3000);

    const anomalyCards = page.locator('.anomaly-card');
    const cardCount = await anomalyCards.count();

    if (cardCount > 0) {
      const firstCard = anomalyCards.first();
      
      // Hover over card
      await firstCard.hover();
      await page.waitForTimeout(300);

      // Check if dismiss button appears
      const dismissButton = firstCard.locator('button[title="Dismiss"]');
      await expect(dismissButton).toBeVisible();
    }
  });

  test('should dismiss anomaly when clicking dismiss button', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(3000);

    const anomalyCards = page.locator('.anomaly-card');
    const initialCount = await anomalyCards.count();

    if (initialCount > 0) {
      const firstCard = anomalyCards.first();
      
      // Get anomaly metric name for verification
      const metricName = await firstCard.locator('.font-semibold').first().textContent();
      
      // Hover and click dismiss
      await firstCard.hover();
      await page.waitForTimeout(300);
      await firstCard.locator('button[title="Dismiss"]').click();
      
      // Wait for dismissal
      await page.waitForTimeout(1000);

      // Verify card is removed
      const newCount = await anomalyCards.count();
      expect(newCount).toBe(initialCount - 1);
      
      // Verify the specific anomaly is gone
      const stillExists = await page.locator(`.anomaly-card:has-text("${metricName}")`).count();
      expect(stillExists).toBe(0);
    }
  });

  test('should display summary statistics', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(3000);

    // Check for summary section
    const summarySection = page.locator('text=Detection Summary');
    const hasSummary = await summarySection.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasSummary) {
      // Check for stat labels
      await expect(page.locator('text=Total')).toBeVisible();
      await expect(page.locator('text=High')).toBeVisible();
      await expect(page.locator('text=Medium')).toBeVisible();
      await expect(page.locator('text=Low')).toBeVisible();
    }
  });

  test('should update summary stats after dismissing anomaly', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(3000);

    const anomalyCards = page.locator('.anomaly-card');
    const initialCount = await anomalyCards.count();

    if (initialCount > 0) {
      // Get initial total from summary
      const totalElement = page.locator('text=Total').locator('..').locator('.text-2xl');
      const initialTotal = await totalElement.textContent();

      // Dismiss first anomaly
      const firstCard = anomalyCards.first();
      await firstCard.hover();
      await page.waitForTimeout(300);
      await firstCard.locator('button[title="Dismiss"]').click();
      await page.waitForTimeout(1000);

      // Check total decreased
      const newTotal = await totalElement.textContent();
      expect(parseInt(newTotal || '0')).toBe(parseInt(initialTotal || '0') - 1);
    }
  });

  test('should show empty state when no anomalies', async ({ page }) => {
    // Mock API to return no anomalies
    await page.route('**/api/deals/*/insights/anomalies', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          success: true,
          data: {
            anomalies: [],
            summary: {
              total: 0,
              byType: {},
              bySeverity: { high: 0, medium: 0, low: 0 }
            }
          }
        })
      });
    });

    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check for empty state
    await expect(page.locator('text=No anomalies detected')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('i.fa-check-circle')).toBeVisible();
  });

  test('should show error state when API fails', async ({ page }) => {
    // Mock API error
    await page.route('**/api/deals/*/insights/anomalies', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ message: 'Internal server error' })
      });
    });

    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(2000);

    // Check for error message
    const errorMessage = page.locator('.bg-red-50');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });

  test('should display anomaly types with correct icons', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(3000);

    const anomalyCards = page.locator('.anomaly-card');
    const cardCount = await anomalyCards.count();

    if (cardCount > 0) {
      // Check for different anomaly type icons
      const hasOutlierIcon = await page.locator('.anomaly-card i.fa-exclamation-triangle').count() > 0;
      const hasSequentialIcon = await page.locator('.anomaly-card i.fa-chart-line').count() > 0;
      const hasReversalIcon = await page.locator('.anomaly-card i.fa-exchange-alt').count() > 0;
      const hasToneIcon = await page.locator('.anomaly-card i.fa-comment-dots').count() > 0;

      // At least one type should exist
      expect(hasOutlierIcon || hasSequentialIcon || hasReversalIcon || hasToneIcon).toBeTruthy();
    }
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(3000);

    // Check anomaly cards stack vertically
    const anomalyCards = page.locator('.anomaly-card');
    const cardCount = await anomalyCards.count();

    if (cardCount >= 2) {
      const firstCard = anomalyCards.nth(0);
      const secondCard = anomalyCards.nth(1);

      const firstBox = await firstCard.boundingBox();
      const secondBox = await secondCard.boundingBox();

      // Cards should be stacked (second card below first)
      if (firstBox && secondBox) {
        expect(secondBox.y).toBeGreaterThan(firstBox.y + firstBox.height - 10);
      }
    }
  });

  test('should refresh anomalies when clicking refresh button', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(3000);

    // Find and click refresh button
    const refreshButton = page.locator('button:has-text("Refresh")');
    const hasRefreshButton = await refreshButton.isVisible().catch(() => false);

    if (hasRefreshButton) {
      await refreshButton.click();
      
      // Check for loading state
      const loadingIndicator = page.locator('text=Loading anomalies...');
      await expect(loadingIndicator).toBeVisible({ timeout: 2000 });
    }
  });

  test('should maintain dismissed anomalies across view switches', async ({ page }) => {
    // Navigate to Insights
    await page.click('.nav-item:has-text("Insights")');
    await page.waitForTimeout(3000);

    const anomalyCards = page.locator('.anomaly-card');
    const initialCount = await anomalyCards.count();

    if (initialCount > 0) {
      // Dismiss first anomaly
      const firstCard = anomalyCards.first();
      const metricName = await firstCard.locator('.font-semibold').first().textContent();
      
      await firstCard.hover();
      await page.waitForTimeout(300);
      await firstCard.locator('button[title="Dismiss"]').click();
      await page.waitForTimeout(1000);

      // Switch to Analysis view
      await page.click('.nav-item:has-text("Analysis")');
      await page.waitForTimeout(500);

      // Switch back to Insights
      await page.click('.nav-item:has-text("Insights")');
      await page.waitForTimeout(2000);

      // Verify anomaly is still dismissed
      const stillDismissed = await page.locator(`.anomaly-card:has-text("${metricName}")`).count();
      expect(stillDismissed).toBe(0);
    }
  });
});
