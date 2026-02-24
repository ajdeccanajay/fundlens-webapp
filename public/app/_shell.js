/**
 * FundLens Shared Shell
 * Module-agnostic shell providing nav bar, sidebar, breadcrumbs, auth, filing notifications,
 * event bus, and entity context. Works with any FundLens module (Equity, PE, Credit).
 *
 * Usage: x-data="FundLensShell('pageName', { ...pageState, ...pageMethods })"
 * Requires: window.FundLensModuleConfig (loaded via _module-config.js before this file)
 */
window.FundLensShell = function(viewName, viewData) {
    const config = window.FundLensModuleConfig;
    if (!config) throw new Error('FundLensModuleConfig not loaded. Include _module-config.js before _shell.js');

    const params = new URLSearchParams(window.location.search);
    const entityValue = params.get(config.entityParam) || '';

    const shellData = {
        // --- Common State ---
        currentPage: viewName,
        user: { email: '', tenantId: '', tenantName: '', tenantSlug: '', role: '', isPlatformAdmin: false },
        entityContext: { type: config.entityType, value: entityValue, displayName: entityValue, extra: {} },
        dealInfo: { ticker: entityValue, name: entityValue + ' Inc.', sector: '' },
        isOnline: navigator.onLine,
        dataLoadError: null,
        showUserMenu: false,
        sidebarGroups: config.sidebarGroups,

        // Filing Notifications
        filingNotifications: [],
        filingNotifCount: 0,
        filingNotifOpen: false,
        filingNotifToast: null,
        _filingNotifPollTimer: null,

        // Scratchpad count (sidebar badge)
        scratchpadCount: 0,

        // --- Event Bus ---
        _eventListeners: {},
        shellOn(event, callback) {
            if (!this._eventListeners[event]) this._eventListeners[event] = [];
            this._eventListeners[event].push(callback);
        },
        shellEmit(event, data) {
            (this._eventListeners[event] || []).forEach(cb => cb(data));
        },

        // --- Auth ---
        getAuthHeaders() {
            const token = localStorage.getItem('fundlens_token') || localStorage.getItem('authToken');
            if (!token) {
                window.location.href = '/login.html';
                return null;
            }
            return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
        },

        async loadUser() {
            let token = localStorage.getItem('fundlens_token') || localStorage.getItem('authToken');
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

            // DEV MODE: Auto-inject mock token on localhost
            if (!token && isLocalhost) {
                this._injectDevToken();
                token = localStorage.getItem('fundlens_token');
            }

            // Force clear old invalid token on localhost
            if (isLocalhost && token) {
                try {
                    const parts = token.split('.');
                    if (parts.length === 3) {
                        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                        const payload = JSON.parse(atob(base64));
                        if (payload['custom:tenant_id'] === 'default-tenant') {
                            localStorage.removeItem('fundlens_token');
                            localStorage.removeItem('fundlens_user');
                            localStorage.removeItem('authToken');
                            this._injectDevToken();
                            token = localStorage.getItem('fundlens_token');
                        }
                    }
                } catch (e) { /* ignore parse errors */ }
            }

            if (!token) {
                window.location.href = '/login.html';
                return;
            }

            // Load cached user
            const userStr = localStorage.getItem('fundlens_user');
            if (userStr) {
                try { this.user = JSON.parse(userStr); } catch (e) { /* ignore */ }
            }

            // Verify with server
            try {
                const resp = await fetch('/api/auth/me', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.success && data.user) {
                        const isPlatformAdmin = data.user.tenantId === '00000000-0000-0000-0000-000000000000' &&
                                               data.user.tenantRole === 'admin';
                        this.user = { ...this.user, ...data.user, isPlatformAdmin };
                        localStorage.setItem('fundlens_user', JSON.stringify(this.user));
                    }
                }
            } catch (e) { console.warn('Auth verify failed:', e.message); }
        },

        logout() {
            localStorage.removeItem('fundlens_token');
            localStorage.removeItem('fundlens_refresh_token');
            localStorage.removeItem('fundlens_user');
            localStorage.removeItem('fundlens_email');
            window.location.href = '/login.html';
        },

        getUserInitials() {
            if (!this.user.email) return '?';
            return this.user.email.substring(0, 2).toUpperCase();
        },

        _injectDevToken() {
            const base64url = (str) => btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
            const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
            const payload = base64url(JSON.stringify({
                sub: '00000000-0000-0000-0000-000000000001',
                email: 'dev@fundlens.ai',
                email_verified: true,
                'custom:tenant_id': '00000000-0000-0000-0000-000000000000',
                'custom:tenant_slug': 'default',
                'custom:tenant_role': 'admin',
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + 86400,
                iss: 'fundlens-dev-mode'
            }));
            const token = header + '.' + payload + '.dev-signature';
            localStorage.setItem('fundlens_token', token);
            localStorage.setItem('fundlens_user', JSON.stringify({
                email: 'dev@fundlens.ai',
                tenantId: '00000000-0000-0000-0000-000000000000',
                tenantSlug: 'default',
                tenantName: 'Default Tenant',
                role: 'admin'
            }));
        },

        // --- Entity Context ---
        async loadEntityInfo() {
            if (config.loadEntityInfo && this.entityContext.value) {
                const info = await config.loadEntityInfo(this.entityContext.value, this.getAuthHeaders());
                this.entityContext.displayName = info.displayName || this.entityContext.value;
                this.entityContext.extra = info;
                // Keep dealInfo in sync for backward compat
                this.dealInfo = {
                    ticker: this.entityContext.value,
                    name: info.displayName || this.entityContext.value + ' Inc.',
                    sector: info.sector || ''
                };
            }
        },

        // --- Navigation ---
        navigateTo(pageName) {
            window.location.href = config.basePath + '/' + pageName + '.html?' + params.toString();
        },

        navigateToWithParams(pageName, extraParams) {
            const newParams = new URLSearchParams(params.toString());
            Object.entries(extraParams || {}).forEach(function(entry) { newParams.set(entry[0], entry[1]); });
            window.location.href = config.basePath + '/' + pageName + '.html?' + newParams.toString();
        },

        // --- Breadcrumbs ---
        get breadcrumbItems() {
            var bc = config.breadcrumbs;
            var currentItem = config.sidebarGroups
                .flatMap(function(g) { return g.items; })
                .find(function(i) { return i.page === viewName; });
            return [
                { label: bc.home.label, path: bc.home.path, icon: 'fas fa-home' },
                { label: bc.module.label, path: bc.module.path },
                { label: this.entityContext.displayName, path: null },
                { label: currentItem ? currentItem.name : viewName, path: null },
            ];
        },

        // --- Filing Notifications ---
        async loadFilingNotifications() {
            try {
                var headers = this.getAuthHeaders();
                if (!headers) return;
                var resp = await fetch('/api/filings/notifications?dismissed=false&limit=20', { headers: headers });
                if (!resp.ok) return;
                var data = await resp.json();
                if (data.success) {
                    this.filingNotifications = data.notifications || [];
                    this.filingNotifCount = data.count || 0;
                    this.shellEmit('filing:loaded', this.filingNotifications);
                }
            } catch (e) { console.warn('Filing notifications unavailable:', e.message); }
        },

        startFilingNotifPolling() {
            this._filingNotifPollTimer = setInterval(async () => {
                var prevCount = this.filingNotifCount;
                await this.loadFilingNotifications();
                if (this.filingNotifCount > prevCount) {
                    var diff = this.filingNotifCount - prevCount;
                    this.filingNotifToast = diff + ' new filing' + (diff > 1 ? 's' : '') + ' detected';
                    setTimeout(() => { this.filingNotifToast = null; }, 4000);
                }
            }, 60000);
        },

        async dismissFilingNotif(id) {
            try {
                var headers = this.getAuthHeaders();
                if (!headers) return;
                var resp = await fetch('/api/filings/notifications/' + id, { method: 'DELETE', headers: headers });
                if (resp.ok) {
                    this.filingNotifications = this.filingNotifications.filter(function(n) { return n.id !== id; });
                    this.filingNotifCount = Math.max(0, this.filingNotifCount - 1);
                }
            } catch (e) { console.warn('Could not dismiss notification:', e.message); }
        },

        async dismissAllFilingNotifs() {
            try {
                var headers = this.getAuthHeaders();
                if (!headers) return;
                var ids = this.filingNotifications.map(function(n) { return n.id; });
                await Promise.all(ids.map(function(id) {
                    return fetch('/api/filings/notifications/' + id, { method: 'DELETE', headers: headers });
                }));
                this.filingNotifications = [];
                this.filingNotifCount = 0;
            } catch (e) { console.warn('Could not dismiss all notifications:', e.message); }
        },

        getFilingTypeBadgeClass(filingType) {
            var type = (filingType || '').toUpperCase();
            if (type.includes('10-K')) return 'filing-type-10k';
            if (type.includes('10-Q')) return 'filing-type-10q';
            if (type.includes('8-K')) return 'filing-type-8k';
            return 'filing-type-default';
        },

        formatFilingDate(dateStr) {
            if (!dateStr) return '';
            try {
                var d = new Date(dateStr);
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            } catch (e) { return dateStr; }
        },

        // --- Scratchpad Count ---
        async loadScratchpadCount() {
            try {
                var headers = this.getAuthHeaders();
                if (!headers) return;
                var resp = await fetch('/api/research/notebooks', { headers: headers });
                if (resp.ok) {
                    var data = await resp.json();
                    if (data.data && data.data.length > 0) {
                        this.scratchpadCount = data.data[0]._count?.insights || 0;
                    } else {
                        this.scratchpadCount = 0;
                    }
                    this.shellEmit('scratchpad:countChanged', this.scratchpadCount);
                }
            } catch (e) { this.scratchpadCount = 0; }
        },

        // --- Keyboard Shortcuts ---
        _setupKeyboardShortcuts() {
            var self = this;
            document.addEventListener('keydown', function(e) {
                if (e.metaKey || e.ctrlKey) {
                    var allItems = config.sidebarGroups.flatMap(function(g) { return g.items; });
                    var item = allItems.find(function(i) { return i.shortcut === e.key; });
                    if (item) {
                        e.preventDefault();
                        self.navigateTo(item.page);
                    }
                }
            });
        },

        // --- Online/Offline ---
        _setupOnlineOfflineHandlers() {
            var self = this;
            window.addEventListener('online', function() { self.isOnline = true; });
            window.addEventListener('offline', function() { self.isOnline = false; });
        },

        // --- Shell Init ---
        async _shellInit() {
            if (!this.entityContext.value) {
                window.location.href = config.basePath + '/index.html';
                return;
            }
            await this.loadUser();
            await this.loadEntityInfo();
            this.loadFilingNotifications();
            this.startFilingNotifPolling();
            this.loadScratchpadCount();
            this._setupKeyboardShortcuts();
            this._setupOnlineOfflineHandlers();
        },
    };

    // Merge shell data with view-specific data
    var merged = Object.assign({}, shellData, viewData);

    // Wrap init: call shell init first, then view init if provided
    var viewInit = viewData.init;
    merged.init = async function() {
        await this._shellInit();
        if (viewInit) await viewInit.call(this);
    };

    return merged;
};
