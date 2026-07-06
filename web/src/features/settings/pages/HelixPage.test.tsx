/**
 * HelixPage contract.
 *
 * HelixPage is the thin chrome that hosts the Helix AI integration: a
 * `<PageContainer>` (h1 + subtitle + breadcrumb overrides + document title)
 * wrapping the self-contained `<AISettings>` controller. `AISettings` owns its
 * own data / loading / empty / error lifecycle and is exercised end-to-end by
 * `components/__tests__/AISettings.test.tsx`, so here we stub it and pin only
 * the page's own responsibilities:
 *
 *   1. Chrome renders — the page paints its h1 title and subtitle.
 *   2. The opt-in surface is mounted — `<AISettings>` is inside the page body.
 *   3. ADR-015 §I7 "always rendered" — the surface stays mounted even when the
 *      settings query reports `isLoading`. The page must NOT swap its body for
 *      a page-level loading Spinner. This is the regression guard for the bug
 *      this change fixes: a `<PageContainer loading={isLoading}>` gate used to
 *      blank the surface during first load. If that gate is reintroduced, the
 *      mocked `useSettings` below forces `isLoading` and PageContainer hides
 *      the surface behind its Spinner — failing this test.
 *   4. `usePageTitle` sets `document.title` to `"Helix — TeslaSync"` and
 *      restores the previous title on unmount.
 *   5. The page forwards `integrations` + `helix` breadcrumb label overrides to
 *      the Layout via `useSetBreadcrumbOverrides`.
 *
 * i18n is stubbed so `t(key, default)` resolves to the inline default.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// Stub the heavy AISettings controller — this page is pure chrome around it,
// and its full opt-in surface has its own dedicated contract test.
vi.mock('../components', () => ({
  AISettings: () => <div data-testid="ai-settings-surface">AISettings</div>,
}))

// Control the settings query's loading flag so the §I7 regression guard can
// simulate a still-loading first paint. HelixPage (correctly) no longer reads
// this hook; the mock exists so that if a page-level loading gate is ever
// reintroduced, the guard test fails.
vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({ isLoading: false })),
}))

// Spy on the breadcrumb-override registration (called inside PageContainer) so
// we can assert the labels HelixPage forwards, without standing up the real
// context provider.
vi.mock('@/components/layout/BreadcrumbOverridesContext', async () => {
  const actual = await vi.importActual<
    typeof import('@/components/layout/BreadcrumbOverridesContext')
  >('@/components/layout/BreadcrumbOverridesContext')
  return { ...actual, useSetBreadcrumbOverrides: vi.fn() }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue
        if (fallback != null) return fallback
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { useSettings } from '@/api/hooks/useSettings'
import { useSetBreadcrumbOverrides } from '@/components/layout/BreadcrumbOverridesContext'
import { __resetTitleStoreForTests } from '@/lib/titleStore'
import HelixPage from './HelixPage'

const mockedUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>
const mockedUseSetBreadcrumbOverrides =
  useSetBreadcrumbOverrides as unknown as ReturnType<typeof vi.fn>

function renderPage() {
  return render(
    <MemoryRouter>
      <HelixPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  __resetTitleStoreForTests()
  mockedUseSettings.mockReset()
  mockedUseSettings.mockReturnValue({ isLoading: false })
  mockedUseSetBreadcrumbOverrides.mockReset()
})

describe('HelixPage — page chrome', () => {
  it('renders the page-level h1 title and subtitle', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Helix' })).toBeInTheDocument()
    expect(
      screen.getByText(/Optional AI integration\. Off by default/i),
    ).toBeInTheDocument()
  })

  it('mounts the AISettings opt-in surface inside the page body', () => {
    renderPage()

    expect(screen.getByTestId('ai-settings-surface')).toBeInTheDocument()
    expect(screen.getByTestId('ai-settings-surface')).toHaveTextContent('AISettings')
  })
})

describe('HelixPage — ADR-015 §I7 always-rendered opt-in surface', () => {
  it('keeps the opt-in surface mounted even while the settings query is loading', () => {
    // Force the settings query into its loading state. A reintroduced
    // page-level `<PageContainer loading={isLoading}>` gate would replace the
    // whole body with a Spinner here; the surface must instead stay on screen.
    mockedUseSettings.mockReturnValue({ isLoading: true })

    renderPage()

    expect(screen.getByTestId('ai-settings-surface')).toBeInTheDocument()
    // No page-level loading Spinner replaced the surface. The Spinner exposes
    // role="status" with the accessible name "Loading".
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull()
  })

  it('renders the surface identically whether or not settings are loaded', () => {
    // isLoading=false (default): still the same always-mounted surface.
    renderPage()
    expect(screen.getByTestId('ai-settings-surface')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull()
  })
})

describe('HelixPage — document title', () => {
  it('sets the tab title to "Helix — TeslaSync" and restores it on unmount', () => {
    const { unmount } = renderPage()

    expect(document.title).toBe('Helix — TeslaSync')

    unmount()
    // usePageTitle restores the title captured at mount (the reset default).
    expect(document.title).toBe('TeslaSync')
  })
})

describe('HelixPage — breadcrumb overrides', () => {
  it('forwards Integrations + Helix label overrides to the Layout breadcrumb', () => {
    renderPage()

    expect(mockedUseSetBreadcrumbOverrides).toHaveBeenCalledWith({
      integrations: 'Integrations',
      helix: 'Helix',
    })
  })
})
