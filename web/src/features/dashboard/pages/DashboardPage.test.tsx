/**
 * DashboardPage — smoke test.
 *
 * The dashboard page is widget-driven and pulls in many feature hooks
 * (multi-dashboard layout, kiosk, keyboard shortcuts, SSE, auth status,
 * sync). We mock each of those hooks with a minimal, contract-shaped
 * stub so the page can mount under jsdom and verify it doesn't crash.
 *
 * Functional widget rendering is covered by the per-widget unit tests
 * in `web/src/features/dashboard/widgets/` — this is intentionally
 * just a "does the shell mount" check.
 */

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string | Record<string, unknown>) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: vi.fn(),
}))

vi.mock('@/api/hooks/useSettings', () => ({
  useAuthStatus: () => ({ data: { authenticated: true }, isLoading: false }),
}))

vi.mock('@/api/hooks/useVehicles', () => ({
  useSyncVehicles: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}))

vi.mock('@/api/client', () => ({
  request: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/components/ui/ThemeProvider', () => ({
  useTheme: () => ({
    themeId: 'midnight',
    setThemeId: vi.fn(),
    themes: [],
  }),
}))

vi.mock('../hooks/useDashboardLayout', () => ({
  useDashboardLayout: () => ({
    dashboards: [{ id: 'default', name: 'Default', widgets: [] }],
    activeDashboard: { id: 'default', name: 'Default', widgets: [] },
    activeId: 'default',
    visibleFor: vi.fn(() => true),
    pinToVehicle: vi.fn(),
    switchDashboard: vi.fn(),
    createDashboard: vi.fn(),
    renameDashboard: vi.fn(),
    deleteDashboard: vi.fn(),
    reorderDashboards: vi.fn(),
    duplicateDashboard: vi.fn(),
    updateDashboardSettings: vi.fn(),
    updateDashboardIcon: vi.fn(),
    applyPreset: vi.fn(),
    resetToDefault: vi.fn(),
    editMode: false,
    setEditMode: vi.fn(),
    dirty: false,
    addWidget: vi.fn(),
    addWidgets: vi.fn(),
    removeWidget: vi.fn(),
    updateWidgetConfig: vi.fn(),
    updateLayouts: vi.fn(),
    autoArrange: vi.fn(),
    getWidgetSize: vi.fn(() => ({ cols: 1, rows: 1 })),
    exportDashboard: vi.fn(),
    importDashboard: vi.fn(),
    importDashboardFromData: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoCount: 0,
    undo: vi.fn(),
    redo: vi.fn(),
  }),
}))

vi.mock('../hooks/useLayoutKeyboard', () => ({
  useLayoutKeyboard: vi.fn(),
}))

vi.mock('../hooks/useKioskMode', () => ({
  useKioskMode: () => ({
    config: { enabled: false, rotationSeconds: 30, dashboardIds: [] },
    updateConfig: vi.fn(),
    isKiosk: false,
    enterKiosk: vi.fn(),
    exitKiosk: vi.fn(),
    isDimmed: false,
    isCursorHidden: false,
    rotateIndex: 0,
    validIds: [],
  }),
}))

import DashboardPage from './DashboardPage'

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DashboardPage', () => {
  it('renders the shell without crashing on an empty dashboard', () => {
    const { container } = renderPage()
    expect(container.firstChild).not.toBeNull()
  })
})
