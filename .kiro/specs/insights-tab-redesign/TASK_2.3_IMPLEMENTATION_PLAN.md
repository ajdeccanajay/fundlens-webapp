# Task 2.3: Comp Table Frontend - Implementation Plan

**Date:** February 2, 2026  
**Status:** 📋 READY TO IMPLEMENT  
**Estimated Time:** 2 days  
**Priority:** HIGH

---

## Overview

Build the frontend UI for the Comparison Table feature, allowing analysts to compare multiple companies across selected metrics with percentile highlighting and outlier detection.

---

## Current Status

### ✅ Completed Prerequisites
- Task 2.1: CompTableService (backend logic)
- Task 2.2: API endpoints (GET and POST)
- Existing workspace.html structure analyzed
- Alpine.js patterns identified
- Design system CSS available

### 🎯 What We're Building
A comprehensive comparison table UI with:
- Company multi-select with search
- Metric multi-select
- Period selection
- Dynamic table with percentile highlighting
- Outlier indicators
- Export button
- Responsive design

---

## UI Design Specification

### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│  📊 Company Comparison                          [Refresh]    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Companies ▼  │  │ Metrics ▼    │  │ Period ▼     │      │
│  │ AMZN, GOOGL  │  │ Revenue, ... │  │ FY2024       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
│  [Build Comparison]                          [Export Excel]  │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│  Comparison Table                                            │
├──────┬──────────┬──────────┬──────────┬──────────┬─────────┤
│Ticker│ Company  │ Revenue  │ Gross    │Percentile│Outliers │
│      │          │          │ Profit   │          │         │
├──────┼──────────┼──────────┼──────────┼──────────┼─────────┤
│AMZN  │ Amazon   │ $574.8B  │ $270.5B  │   100%   │ 🔴 2    │
│      │          │ ▓▓▓▓▓▓▓▓ │ ▓▓▓▓▓▓▓▓ │          │         │
├──────┼──────────┼──────────┼──────────┼──────────┼─────────┤
│GOOGL │ Alphabet │ $307.4B  │ $189.8B  │    67%   │ 🟡 1    │
│      │          │ ▓▓▓▓▓░░░ │ ▓▓▓▓▓░░░ │          │         │
├──────┼──────────┼──────────┼──────────┼──────────┼─────────┤
│META  │ Meta     │ $134.9B  │ $109.5B  │     0%   │ 🔵 1    │
│      │          │ ▓▓░░░░░░ │ ▓▓▓░░░░░ │          │         │
└──────┴──────────┴──────────┴──────────┴──────────┴─────────┘
│                                                               │
│  Summary Statistics                                          │
│  Median: $307.4B  │  Mean: $338.7B  │  P75: $441.1B         │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Add Alpine.js State (15 min)

Add to the `workspaceData()` function:

```javascript
// Comp Table (Phase 2)
compTable: {
    selectedCompanies: [],
    selectedMetrics: [],
    selectedPeriod: 'FY2024',
    data: null,
    loading: false,
    error: null,
    
    // Available options
    availableCompanies: ['AMZN', 'GOOGL', 'META', 'AAPL', 'MSFT', 'TSLA'],
    availableMetrics: ['revenue', 'gross_profit', 'operating_income', 'net_income', 'ebitda'],
    availablePeriods: ['FY2024', 'FY2023', 'FY2022', 'FY2021'],
    
    // UI state
    showCompanySearch: false,
    companySearchQuery: '',
    showMetricSearch: false,
},
```

### Step 2: Add Methods (30 min)

```javascript
// Comp Table Methods
async buildCompTable() {
    if (this.compTable.selectedCompanies.length === 0) {
        this.compTable.error = 'Please select at least one company';
        return;
    }
    
    if (this.compTable.selectedMetrics.length === 0) {
        this.compTable.error = 'Please select at least one metric';
        return;
    }
    
    this.compTable.loading = true;
    this.compTable.error = null;
    
    try {
        const response = await fetch(
            `/api/deals/${this.dealId}/insights/comp-table?` +
            `companies=${this.compTable.selectedCompanies.join(',')}&` +
            `metrics=${this.compTable.selectedMetrics.join(',')}&` +
            `period=${this.compTable.selectedPeriod}`
        );
        
        if (!response.ok) {
            throw new Error('Failed to build comparison table');
        }
        
        const result = await response.json();
        this.compTable.data = result.data;
    } catch (error) {
        console.error('Error building comp table:', error);
        this.compTable.error = error.message;
    } finally {
        this.compTable.loading = false;
    }
},

toggleCompany(ticker) {
    const index = this.compTable.selectedCompanies.indexOf(ticker);
    if (index > -1) {
        this.compTable.selectedCompanies.splice(index, 1);
    } else {
        this.compTable.selectedCompanies.push(ticker);
    }
},

toggleMetric(metric) {
    const index = this.compTable.selectedMetrics.indexOf(metric);
    if (index > -1) {
        this.compTable.selectedMetrics.splice(index, 1);
    } else {
        this.compTable.selectedMetrics.push(metric);
    }
},

getFilteredCompanies() {
    if (!this.compTable.companySearchQuery) {
        return this.compTable.availableCompanies;
    }
    return this.compTable.availableCompanies.filter(c => 
        c.toLowerCase().includes(this.compTable.companySearchQuery.toLowerCase())
    );
},

getPercentileColor(percentile) {
    if (percentile >= 75) return 'text-green-600 bg-green-50';
    if (percentile <= 25) return 'text-red-600 bg-red-50';
    return 'text-gray-600 bg-gray-50';
},

getPercentileBarWidth(percentile) {
    return Math.round(percentile) + '%';
},

formatMetricValue(value) {
    if (value === null || value === undefined) return 'N/A';
    if (value >= 1000000000) return '$' + (value / 1000000000).toFixed(1) + 'B';
    if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
    return '$' + value.toLocaleString();
},

async exportCompTable() {
    if (!this.compTable.data) {
        alert('Please build a comparison table first');
        return;
    }
    
    try {
        const response = await fetch(
            `/api/deals/${this.dealId}/insights/comp-table/export`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companies: this.compTable.selectedCompanies,
                    metrics: this.compTable.selectedMetrics,
                    period: this.compTable.selectedPeriod,
                }),
            }
        );
        
        if (!response.ok) {
            throw new Error('Export failed');
        }
        
        // For now, just show success message
        // In Task 2.7, we'll implement actual Excel download
        alert('Export functionality will be available in Task 2.7');
    } catch (error) {
        console.error('Export error:', error);
        alert('Export failed: ' + error.message);
    }
},
```

### Step 3: Add HTML Section (1 hour)

Insert after the Anomaly Detection section in workspace.html:

```html
<!-- Company Comparison (Phase 2 - Task 2.3) -->
<div class="comp-table-section mt-8">
    <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold flex items-center">
            <i class="fas fa-balance-scale text-indigo-600 mr-3"></i>
            Company Comparison
        </h2>
        <button @click="buildCompTable()" 
                class="text-sm text-indigo-600 hover:text-indigo-800 flex items-center"
                :disabled="compTable.loading">
            <i class="fas fa-sync-alt mr-1" :class="compTable.loading ? 'animate-spin' : ''"></i>
            <span x-text="compTable.loading ? 'Building...' : 'Refresh'"></span>
        </button>
    </div>
    
    <!-- Selection Controls -->
    <div class="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <!-- Company Selection -->
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    Companies
                    <span class="text-xs text-gray-500 ml-1">
                        (<span x-text="compTable.selectedCompanies.length"></span> selected)
                    </span>
                </label>
                <div class="relative">
                    <button @click="compTable.showCompanySearch = !compTable.showCompanySearch"
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-left text-sm hover:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <span x-show="compTable.selectedCompanies.length === 0" class="text-gray-400">
                            Select companies...
                        </span>
                        <span x-show="compTable.selectedCompanies.length > 0" class="text-gray-900">
                            <span x-text="compTable.selectedCompanies.join(', ')"></span>
                        </span>
                    </button>
                    
                    <!-- Dropdown -->
                    <div x-show="compTable.showCompanySearch"
                         @click.away="compTable.showCompanySearch = false"
                         class="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                        <!-- Search -->
                        <div class="p-2 border-b border-gray-200">
                            <input type="text"
                                   x-model="compTable.companySearchQuery"
                                   placeholder="Search companies..."
                                   class="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        </div>
                        <!-- Options -->
                        <div class="p-2">
                            <template x-for="company in getFilteredCompanies()" :key="company">
                                <label class="flex items-center px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                                    <input type="checkbox"
                                           :checked="compTable.selectedCompanies.includes(company)"
                                           @change="toggleCompany(company)"
                                           class="mr-2 text-indigo-600 focus:ring-indigo-500">
                                    <span class="text-sm text-gray-700" x-text="company"></span>
                                </label>
                            </template>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Metric Selection -->
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    Metrics
                    <span class="text-xs text-gray-500 ml-1">
                        (<span x-text="compTable.selectedMetrics.length"></span> selected)
                    </span>
                </label>
                <div class="relative">
                    <button @click="compTable.showMetricSearch = !compTable.showMetricSearch"
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-left text-sm hover:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <span x-show="compTable.selectedMetrics.length === 0" class="text-gray-400">
                            Select metrics...
                        </span>
                        <span x-show="compTable.selectedMetrics.length > 0" class="text-gray-900">
                            <span x-text="compTable.selectedMetrics.length + ' metric(s)'"></span>
                        </span>
                    </button>
                    
                    <!-- Dropdown -->
                    <div x-show="compTable.showMetricSearch"
                         @click.away="compTable.showMetricSearch = false"
                         class="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                        <div class="p-2">
                            <template x-for="metric in compTable.availableMetrics" :key="metric">
                                <label class="flex items-center px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                                    <input type="checkbox"
                                           :checked="compTable.selectedMetrics.includes(metric)"
                                           @change="toggleMetric(metric)"
                                           class="mr-2 text-indigo-600 focus:ring-indigo-500">
                                    <span class="text-sm text-gray-700" x-text="metric.replace(/_/g, ' ')"></span>
                                </label>
                            </template>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Period Selection -->
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Period</label>
                <select x-model="compTable.selectedPeriod"
                        class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <template x-for="period in compTable.availablePeriods" :key="period">
                        <option :value="period" x-text="period"></option>
                    </template>
                </select>
            </div>
        </div>
        
        <!-- Action Buttons -->
        <div class="flex items-center gap-3 mt-4">
            <button @click="buildCompTable()"
                    :disabled="compTable.loading || compTable.selectedCompanies.length === 0 || compTable.selectedMetrics.length === 0"
                    class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center">
                <i class="fas fa-table mr-2"></i>
                Build Comparison
            </button>
            <button @click="exportCompTable()"
                    :disabled="!compTable.data"
                    class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center">
                <i class="fas fa-file-excel mr-2"></i>
                Export Excel
            </button>
        </div>
    </div>
    
    <!-- Error State -->
    <div x-show="compTable.error" class="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
        <div class="flex items-center">
            <i class="fas fa-exclamation-circle text-red-600 mr-3"></i>
            <span class="text-sm text-red-800" x-text="compTable.error"></span>
        </div>
    </div>
    
    <!-- Loading State -->
    <div x-show="compTable.loading" class="text-center py-8 bg-white rounded-lg border border-gray-200">
        <div class="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-3 animate-pulse">
            <i class="fas fa-table text-xl text-indigo-600"></i>
        </div>
        <p class="text-sm text-gray-500">Building comparison table...</p>
    </div>
    
    <!-- Comparison Table -->
    <div x-show="!compTable.loading && compTable.data" class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div class="overflow-x-auto">
            <table class="w-full">
                <thead class="bg-gray-50 border-b border-gray-200">
                    <tr>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ticker</th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                        <template x-for="header in compTable.data?.headers?.slice(2)" :key="header">
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider" 
                                x-text="header.replace(/_/g, ' ')"></th>
                        </template>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Outliers</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                    <template x-for="row in compTable.data?.rows" :key="row.ticker">
                        <tr class="hover:bg-gray-50">
                            <td class="px-4 py-3 text-sm font-medium text-gray-900" x-text="row.ticker"></td>
                            <td class="px-4 py-3 text-sm text-gray-700" x-text="row.companyName"></td>
                            <template x-for="metric in compTable.selectedMetrics" :key="metric">
                                <td class="px-4 py-3 text-right">
                                    <div class="text-sm font-medium text-gray-900" x-text="formatMetricValue(row.values[metric])"></div>
                                    <div class="mt-1 w-full bg-gray-200 rounded-full h-1.5">
                                        <div class="h-1.5 rounded-full transition-all"
                                             :class="row.outliers.includes(metric) ? 'bg-red-500' : 'bg-indigo-500'"
                                             :style="'width: ' + getPercentileBarWidth(row.percentiles[metric])"></div>
                                    </div>
                                    <div class="text-xs text-gray-500 mt-0.5" 
                                         x-text="row.percentiles[metric] ? Math.round(row.percentiles[metric]) + 'th %ile' : 'N/A'"></div>
                                </td>
                            </template>
                            <td class="px-4 py-3 text-center">
                                <span x-show="row.outliers.length > 0"
                                      class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                    <i class="fas fa-exclamation-triangle mr-1"></i>
                                    <span x-text="row.outliers.length"></span>
                                </span>
                                <span x-show="row.outliers.length === 0" class="text-gray-400 text-xs">—</span>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>
        
        <!-- Summary Statistics -->
        <div class="bg-gray-50 border-t border-gray-200 p-4">
            <h3 class="text-sm font-semibold text-gray-700 mb-3">Summary Statistics</h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <template x-for="metric in compTable.selectedMetrics" :key="metric">
                    <div>
                        <div class="text-xs text-gray-500 mb-1" x-text="metric.replace(/_/g, ' ')"></div>
                        <div class="space-y-1">
                            <div class="flex justify-between text-xs">
                                <span class="text-gray-600">Median:</span>
                                <span class="font-medium text-gray-900" x-text="formatMetricValue(compTable.data?.summary?.median[metric])"></span>
                            </div>
                            <div class="flex justify-between text-xs">
                                <span class="text-gray-600">Mean:</span>
                                <span class="font-medium text-gray-900" x-text="formatMetricValue(compTable.data?.summary?.mean[metric])"></span>
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>
    
    <!-- Empty State -->
    <div x-show="!compTable.loading && !compTable.data && !compTable.error" 
         class="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <i class="fas fa-table text-4xl text-gray-400 mb-3"></i>
        <p class="text-sm font-medium text-gray-700">No comparison table built yet</p>
        <p class="text-xs text-gray-500 mt-1">Select companies and metrics above, then click "Build Comparison"</p>
    </div>
</div>
```

### Step 4: Add CSS Styling (30 min)

Add to `public/css/workspace-enhancements.css`:

```css
/* Comp Table Styles */
.comp-table-section {
    margin-top: 2rem;
}

.comp-table-section table {
    font-size: 0.875rem;
}

.comp-table-section tbody tr {
    transition: background-color 0.15s ease;
}

.comp-table-section .percentile-bar {
    transition: width 0.3s ease;
}

/* Multi-select dropdowns */
.comp-table-section .dropdown-menu {
    max-height: 300px;
    overflow-y: auto;
}

.comp-table-section .dropdown-menu::-webkit-scrollbar {
    width: 6px;
}

.comp-table-section .dropdown-menu::-webkit-scrollbar-thumb {
    background-color: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
}

/* Responsive table */
@media (max-width: 768px) {
    .comp-table-section table {
        font-size: 0.75rem;
    }
    
    .comp-table-section th,
    .comp-table-section td {
        padding: 0.5rem;
    }
}
```

---

## Testing Plan

### Manual Testing Checklist
- [ ] Company selection works (add/remove)
- [ ] Metric selection works (add/remove)
- [ ] Period selection updates
- [ ] Build button disabled when no selection
- [ ] API call succeeds with valid data
- [ ] Table renders correctly
- [ ] Percentile bars display correctly
- [ ] Outliers highlighted
- [ ] Summary statistics show
- [ ] Export button triggers (placeholder)
- [ ] Error states display
- [ ] Loading states display
- [ ] Responsive on mobile
- [ ] Search filters companies

### E2E Tests (Playwright)

Create `test/e2e/comp-table-frontend.e2e-spec.ts`:

```typescript
describe('Comp Table Frontend', () => {
  it('should display company selection dropdown');
  it('should allow selecting multiple companies');
  it('should display metric selection dropdown');
  it('should build comparison table');
  it('should display percentile bars');
  it('should highlight outliers');
  it('should show summary statistics');
  it('should handle empty state');
  it('should handle error state');
  it('should be responsive on mobile');
});
```

---

## Acceptance Criteria

- ✅ Can add/remove companies dynamically
- ✅ Can add/remove metrics dynamically
- ✅ Can select period
- ✅ Table shows percentile rankings
- ✅ Outliers highlighted correctly
- ✅ Export button present (placeholder)
- ✅ Responsive design
- ✅ Loading states
- ✅ Error handling
- ✅ All Playwright tests passing

---

## Estimated Time Breakdown

1. **Alpine.js State Setup:** 15 minutes
2. **Methods Implementation:** 30 minutes
3. **HTML Structure:** 1 hour
4. **CSS Styling:** 30 minutes
5. **Testing & Debugging:** 2 hours
6. **E2E Tests:** 2 hours
7. **Documentation:** 30 minutes

**Total:** ~7 hours (1 day)

---

## Next Steps After Completion

1. Mark Task 2.3 as complete
2. Update tasks.md
3. Create changelog
4. Move to Task 2.4 (Change Tracker Service)

---

## Notes

- Uses existing Alpine.js patterns from workspace
- Follows design system CSS conventions
- Integrates with existing API endpoints
- Export functionality is placeholder for Task 2.7
- Mobile-responsive by default
- Accessible with keyboard navigation

---

**Status:** 📋 READY TO IMPLEMENT  
**Dependencies:** Tasks 2.1, 2.2 ✅  
**Blocks:** Task 2.7 (Export)
