import {
  ALLOWED_DENSITIES,
  BOOTSTRAP_PROVIDER_TREE,
  BOOTSTRAP_SEQUENCE,
  DEFAULT_DENSITY,
  WEB_BOOTSTRAP_UNAVAILABLE_ADAPTATIONS,
  applyInitialDensity,
  clearParityReportedErrors,
  formatWebVitalDevLog,
  getNativeDensity,
  getParityReportedErrors,
  recordParityFrontendError,
  resolveInitialDensity,
  runWebBootstrapParity,
  selectQueryErrorForReport,
  selectWebVitalsMode,
  shouldClearDevServiceWorker,
} from '../src/web-parity/main';

describe('web/src/main.tsx native bootstrap parity', () => {
  afterEach(() => {
    applyInitialDensity('comfortable');
    clearParityReportedErrors();
  });

  describe('density bootstrap (lines 37-54)', () => {
    test('keeps a valid cached density', () => {
      for (const density of ALLOWED_DENSITIES) {
        expect(resolveInitialDensity(density)).toBe(density);
      }
    });

    test('falls back to comfortable for missing or invalid values', () => {
      expect(resolveInitialDensity(null)).toBe(DEFAULT_DENSITY);
      expect(resolveInitialDensity(undefined)).toBe(DEFAULT_DENSITY);
      expect(resolveInitialDensity('cozy')).toBe(DEFAULT_DENSITY);
      expect(DEFAULT_DENSITY).toBe('comfortable');
    });

    test('applyInitialDensity updates the in-process store', () => {
      expect(applyInitialDensity('spacious')).toBe('spacious');
      expect(getNativeDensity()).toBe('spacious');
      expect(applyInitialDensity('bogus')).toBe('comfortable');
      expect(getNativeDensity()).toBe('comfortable');
    });
  });

  describe('queryCache error decision (lines 74-87)', () => {
    test('reports only updated/error events with a non-null error', () => {
      const err = new Error('boom');
      expect(
        selectQueryErrorForReport({type: 'updated', action: {type: 'error', error: err}}),
      ).toEqual({error: err, source: 'query'});
    });

    test('ignores non-updated, non-error, and null-error events', () => {
      expect(selectQueryErrorForReport(undefined)).toBeNull();
      expect(selectQueryErrorForReport({type: 'added'})).toBeNull();
      expect(
        selectQueryErrorForReport({type: 'updated', action: {type: 'success'}}),
      ).toBeNull();
      expect(
        selectQueryErrorForReport({type: 'updated', action: {type: 'error', error: null}}),
      ).toBeNull();
    });

    test('the in-process reporter records forwarded errors', () => {
      const err = new Error('query failed');
      recordParityFrontendError(err, 'query');
      expect(getParityReportedErrors()).toEqual([{error: err, source: 'query'}]);
    });
  });

  describe('service worker + web-vitals branches', () => {
    test('shouldClearDevServiceWorker mirrors the web guard (line 56)', () => {
      expect(shouldClearDevServiceWorker({DEV: true}, true)).toBe(true);
      expect(shouldClearDevServiceWorker({DEV: true}, false)).toBe(false);
      expect(
        shouldClearDevServiceWorker({DEV: true, VITE_PWA_DEV: 'true'}, true),
      ).toBe(false);
      expect(shouldClearDevServiceWorker({PROD: true}, true)).toBe(false);
    });

    test('selectWebVitalsMode mirrors PROD vs DEV (lines 134/142)', () => {
      expect(selectWebVitalsMode({PROD: true})).toBe('production-reporter');
      expect(selectWebVitalsMode({DEV: true})).toBe('dev-console');
    });

    test('formatWebVitalDevLog mirrors the dev console shape (lines 145-147)', () => {
      expect(
        formatWebVitalDevLog({name: 'LCP', value: 2345.6, id: 'v-1', rating: 'good'}),
      ).toEqual(['[web-vitals]', 'LCP', 2346, 'good', 'v-1']);
      expect(
        formatWebVitalDevLog({name: 'CLS', value: 0.04, id: 'v-2'}),
      ).toEqual(['[web-vitals]', 'CLS', 0, '', 'v-2']);
    });
  });

  describe('structure preservation', () => {
    test('provider tree preserves the 13 render-tree nodes (lines 89-127)', () => {
      expect(BOOTSTRAP_PROVIDER_TREE.map(node => node.component)).toEqual([
        'React.StrictMode',
        'ErrorBoundary',
        'QueryClientProvider',
        'QueryBroadcastBridge',
        'FormatterPrefsBridge',
        'BrowserRouter',
        'NavigationGuardProvider',
        'ThemeProvider',
        'SelectedVehicleProvider',
        'ToastProvider',
        'App',
        'ReloadPrompt',
        'AchievementUnlockListener',
      ]);
    });

    test('bootstrap sequence covers all 8 imperative steps', () => {
      expect(BOOTSTRAP_SEQUENCE.map(step => step.id)).toEqual([
        'init-rum',
        'install-global-error-reporting',
        'density-bootstrap',
        'clear-dev-service-worker',
        'create-query-client',
        'subscribe-query-errors',
        'render-root',
        'report-web-vitals',
      ]);
      expect(WEB_BOOTSTRAP_UNAVAILABLE_ADAPTATIONS.length).toBeGreaterThan(0);
    });
  });

  describe('runWebBootstrapParity orchestrator', () => {
    test('wires a query client and forwards failures to the reporter', () => {
      const reported: unknown[] = [];
      const result = runWebBootstrapParity({
        cachedDensity: 'compact',
        env: {DEV: true},
        reportError: error => reported.push(error),
      });

      try {
        expect(result.density).toBe('compact');
        expect(result.webVitalsMode).toBe('dev-console');
        expect(result.clearDevServiceWorker).toBe(false);
        expect(result.providerTree).toBe(BOOTSTRAP_PROVIDER_TREE);

        const err = new Error('refetch failed');
        result.queryClient.getQueryCache().notify({
          type: 'updated',
          query: {} as never,
          action: {type: 'error', error: err},
        } as never);

        expect(reported).toContain(err);
      } finally {
        result.unsubscribeQueryErrors();
        result.queryClient.clear();
      }
    });
  });
});
