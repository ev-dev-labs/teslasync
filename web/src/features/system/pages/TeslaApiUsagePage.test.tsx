import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import TeslaApiUsagePage from './TeslaApiUsagePage'
import { ROUTE_REGISTRY } from '@/lib/routeRegistry'

const usage = vi.hoisted(() => vi.fn())
vi.mock('@/api/hooks/useTeslaUsage', () => ({ useTeslaUsage: usage }))
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string) => fallback,
}) }))
vi.mock('@/components/layout', () => ({
  PageContainer: ({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) =>
    <main><h1>{title}</h1><p>{subtitle}</p>{children}</main>,
}))
vi.mock('@/components/motion', () => ({ FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('../components/status', () => ({
  TeslaApiUsageCard: ({ apiUsage, error, loading }: { apiUsage?: { current: { estimated_usd: number } }; error?: Error; loading?: boolean }) =>
    <section data-testid="cycle">{loading ? 'loading' : error ? 'error' : apiUsage?.current.estimated_usd ?? 'empty'}</section>,
  TeslaApiUsageHistory: () => <section data-testid="selected-history">Selected range, distribution and time series</section>,
}))

beforeEach(() => usage.mockReset())

describe('Tesla API usage route page', () => {
  it('renders current/prior periods, selected history and transparent rates independently', () => {
    usage.mockReturnValue({ data: { current: { estimated_usd: 4 } }, isLoading: false, error: null })
    render(<TeslaApiUsagePage />)
    expect(screen.getByRole('heading', { name: 'Tesla API usage' })).toBeInTheDocument()
    expect(screen.getByTestId('cycle')).toHaveTextContent('4')
    expect(screen.getByTestId('selected-history')).toBeInTheDocument()
    expect(screen.getByText('150,000 / $1')).toBeInTheDocument()
    expect(screen.getByText('1,000 / $1')).toBeInTheDocument()
    expect(screen.getByText('500 / $1')).toBeInTheDocument()
    expect(screen.getByText('50 / $1')).toBeInTheDocument()
    expect(screen.getByText(/not Tesla calendar-month billing cycles/)).toBeInTheDocument()
    expect(ROUTE_REGISTRY.some(route => route.path === '/tesla-api-usage' && route.name === 'TeslaApiUsage')).toBe(true)
  })

  it.each([
    [{ isLoading: true, error: null, data: undefined }, 'loading'],
    [{ isLoading: false, error: new Error('unavailable'), data: undefined }, 'error'],
    [{ isLoading: false, error: null, data: undefined }, 'empty'],
  ])('does not hide independent history or methodology when cycle is %s', (state, expected) => {
    usage.mockReturnValue(state)
    render(<TeslaApiUsagePage />)
    expect(screen.getByTestId('cycle')).toHaveTextContent(expected)
    expect(screen.getByTestId('selected-history')).toBeInTheDocument()
    expect(screen.getByText('How the estimate is calculated')).toBeInTheDocument()
  })
})
