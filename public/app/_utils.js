/**
 * FundLens Shared Utilities
 * Module-agnostic formatting functions used across all FundLens modules.
 * Loaded via <script src="/app/_utils.js"></script>
 */
window.FundLensUtils = {
    formatCurrency(value) {
        if (value == null || isNaN(value)) return '—';
        var abs = Math.abs(value);
        var sign = value < 0 ? '-' : '';
        if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(1) + 'B';
        if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
        if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
        return sign + '$' + abs.toFixed(0);
    },

    formatPercent(value) {
        if (value == null || isNaN(value)) return '—';
        return (value * 100).toFixed(1) + '%';
    },

    formatRatio(value) {
        if (value == null || isNaN(value)) return '—';
        return value.toFixed(2) + 'x';
    },

    formatDays(value) {
        if (value == null || isNaN(value)) return '—';
        return Math.round(value) + ' days';
    },

    getYoYGrowth(growthData, period) {
        if (!growthData || !period) return '—';
        var growth = growthData.find(function(g) { return g.period.endsWith('_to_' + period); });
        return growth ? this.formatPercent(growth.value) : '—';
    },

    getYoYGrowthLatest(growthData) {
        if (!growthData || growthData.length === 0) return '—';
        return this.formatPercent(growthData[0].value);
    },

    getMarginForPeriod(marginData, period) {
        if (!marginData || !period) return '—';
        var margin = marginData.find(function(m) { return m.period === period; });
        return margin ? this.formatPercent(margin.value) : '—';
    },

    getValueForPeriod(data, period, type) {
        if (!data || !period) return '—';
        var entry = data.find(function(d) { return d.period === period; });
        if (!entry) return '—';
        if (type === 'currency') return this.formatCurrency(entry.value);
        if (type === 'percent') return this.formatPercent(entry.value);
        if (type === 'ratio') return this.formatRatio(entry.value);
        if (type === 'days') return this.formatDays(entry.value);
        return entry.value;
    },

    deepCopy(obj) {
        return JSON.parse(JSON.stringify(obj));
    }
};
