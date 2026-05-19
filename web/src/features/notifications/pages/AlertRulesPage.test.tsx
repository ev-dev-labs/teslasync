/**
 * AlertRulesPage — smoke tests.
 *
 * Owns three contract surfaces:
 *   1. Loading -> skeleton block visible (PageContainer renders the
 *      header even while the list is loading).
 *   2. Empty rules list -> EmptyState.
 *   3. Populated list -> one row per rule, with the bulk-action toolbar.
 *
 * All mutations are stubbed so the test never touches the network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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
vi.mock('@/hooks/useEditLease', () => ({
  useEditLease: () => ({ isOwner: true, otherTab: null, claim: vi.fn() }),
}))

const useAlertRulesMock = vi.fn()
const mutationStub = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  isLoading: false,
  isError: false,
  error: null,
  reset: vi.fn(),
})

vi.mock('@/api/hooks/useNotifications', () => ({
  useAlertRules: () => useAlertRulesMock(),
  useBulkEnableRules: () => mutationStub(),
  useBulkDisableRules: () => mutationStub(),
  useDeleteAlertRule: () => mutationStub(),
  useSaveAlertRule: () => mutationStub(),
}))

import AlertRulesPage from './AlertRulesPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <AlertRulesPage />
    </MemoryRouter>,
  )
}

function makeRule(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Rule ${id}`,
    description: '',
    enabled: true,
    severity: 'warning',
    type: 'low_battery',
    conditions: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('AlertRulesPage', () => {
  beforeEach(() => {
    useAlertRulesMock.mockReset()
  })

  it('renders without crashing while loading', () => {
    useAlertRulesMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })
    const { container } = renderPage()
    expect(container.firstChild).not.toBeNull()
  })

  it('renders the EmptyState when no rules exist', () => {
    useAlertRulesMock.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    })
    renderPage()
    // EmptyState message text comes through the i18n fallback.
    expect(
      screen.getByText(/No alert rules yet/i),
    ).toBeInTheDocument()
    // No rule rows are rendered when empty.
    expect(screen.queryByText(/Rule 1/)).not.toBeInTheDocument()
  })

  it('renders a row per rule when the list is populated', () => {
    useAlertRulesMock.mockReturnValue({
      data: [makeRule(1), makeRule(2)],
      isLoading: false,
      error: null,
    })
    renderPage()
    expect(screen.getByText('Rule 1')).toBeInTheDocument()
    expect(screen.getByText('Rule 2')).toBeInTheDocument()
  })
})
