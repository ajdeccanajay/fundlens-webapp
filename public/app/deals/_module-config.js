/**
 * FundLens Equity Research Module Configuration
 * Defines sidebar groups, entity type, breadcrumbs, and entity info loader.
 * Must be loaded BEFORE _shell.js via <script src="_module-config.js"></script>
 */
window.FundLensModuleConfig = {
    moduleName: 'Equity Research',
    moduleSlug: 'deals',
    basePath: '/app/deals',

    // Entity context — what identifies the "thing" being analyzed
    entityParam: 'ticker',
    entityType: 'ticker',

    // Sidebar navigation — grouped to preserve current UX
    sidebarGroups: [
        {
            label: 'Analysis',
            collapsed: false,
            items: [
                { name: 'Quantitative', page: 'quantitative', icon: 'fas fa-chart-bar', shortcut: '1' },
                { name: 'Qualitative', page: 'qualitative', icon: 'fas fa-search', shortcut: '2' },
            ]
        },
        {
            label: 'Tools',
            collapsed: false,
            items: [
                { name: 'Export', page: 'export', icon: 'fas fa-file-export', shortcut: '3' },
                { name: 'Provocations', page: 'provocations', icon: 'fas fa-bolt', shortcut: '4' },
            ]
        },
        {
            label: 'Research',
            collapsed: false,
            items: [
                { name: 'Research Assistant', page: 'research', icon: 'fas fa-robot', shortcut: '5' },
                { name: 'Scratchpad', page: 'scratchpad', icon: 'fas fa-sticky-note', shortcut: '6', badge: 'scratchpadCount' },
                { name: 'IC Memo', page: 'ic-memo', icon: 'fas fa-file-contract', shortcut: '7' },
                { name: 'Documents', page: 'documents', icon: 'fas fa-folder-open', shortcut: '8' },
            ]
        }
    ],

    // Breadcrumb config
    breadcrumbs: {
        home: { label: 'Home', path: '/fundlens-main.html' },
        module: { label: 'Deals', path: '/app/deals/index.html' },
    },

    // Entity info loader — fetches display name for breadcrumbs
    async loadEntityInfo(entityValue, authHeaders) {
        try {
            const resp = await fetch('/api/deals/info?ticker=' + entityValue, { headers: authHeaders });
            if (resp.ok) {
                const data = await resp.json();
                return { displayName: data.name || entityValue, sector: data.sector || '', dealId: data.id || null };
            }
        } catch (e) { /* fallback below */ }
        return { displayName: entityValue + ' Inc.', sector: '', dealId: null };
    }
};
