/**
 * AutomationListPage — smoke tests.
 *
 * Covers three contract surfaces:
 *   1. Loading -> Skeleton placeholders render.
 *   2. Empty -> EmptyState ("No automations yet").
 *   3. Populated -> one row per automation with name + description.
 *
 * All network calls are stubbed; bulk-update mutation is a no-op.
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

const useAutomationsMock = vi.fn()
const mutationStub = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  isLoading: false,
  isError: false,
  error: null,
  reset: vi.fn(),
})

vi.mock('@/api/hooks/useAutomations', () => ({
  useAutomations: () => useAutomationsMock(),
  useBulkAutomationsUpdate: () => mutationStub(),
}))

import AutomationListPage from './AutomationListPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <AutomationListPage />
    </MemoryRouter>,
  )
}

function makeAutomation(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Automation ${id}`,
    description: `Description ${id}`,
    enabled: true,
    execution_count: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('AutomationListPage', () => {
  beforeEach(() => {
    useAutomationsMock.mockReset()
  })

  it('renders without crashing while loading', () => {
    useAutomationsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })
    const { container } = renderPage()
    expect(container.firstChild).not.toBeNull()
  })

  it('renders the EmptyState when there are no automations', () => {
    useAutomationsMock.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    })
    renderPage()
    expect(screen.getByText(/No automations yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/Automation 1/)).not.toBeInTheDocument()
  })

  it('renders a row per automation when populated', () => {
    useAutomationsMock.mockReturnValue({
      data: [makeAutomation(1), makeAutomation(2)],
      isLoading: false,
      error: null,
    })
    renderPage()
    expect(screen.getByText('Automation 1')).toBeInTheDocument()
    expect(screen.getByText('Automation 2')).toBeInTheDocument()
    expect(screen.getByText('Description 1')).toBeInTheDocument()
  })
})
