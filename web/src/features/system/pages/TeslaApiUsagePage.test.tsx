import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import TeslaApiUsagePage from './TeslaApiUsagePage'
import { ROUTE_REGISTRY } from '@/lib/routeRegistry'

const usage = vi.hoisted(() => vi.fn())
const cycleProps = vi.hoisted(() => vi.fn())
vi.mock('@/api/hooks/useTeslaUsage', () => ({ useTeslaUsage: usage }))
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string) => fallback,
}) }))
vi.mock('@/components/layout', () => ({
  PageLayout: ({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) =>
    <main><h1>{title}</h1><p>{subtitle}</p>{children}</main>,
}))
vi.mock('@/components/motion', () => ({ FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('../components/status', () => ({
  TeslaApiUsageCard: ({ apiUsage, error, loading }: { apiUsage?: { current: { estimated_usd: number } }; error?: Error | null; loading?: boolean }) => {
    cycleProps({ apiUsage, error, loading })
    return <section data-testid="cycle">{loading ? 'loading' : error ? 'error' : apiUsage?.current.estimated_usd ?? 'empty'}</section>
  },
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

  it('retries only the failed billing cycle and recovers without remounting history', () => {
    const refetch = vi.fn()
    const failed = {
      data: undefined, isLoading: false, isFetching: false,
      error: new Error('unavailable'), isError: true, fetchStatus: 'idle', refetch,
    }
    usage.mockReturnValue(failed)
    const { rerender } = render(<TeslaApiUsagePage />)
    const history = screen.getByTestId('selected-history')
    const cycle = screen.getByRole('region', { name: 'Current cycle and prior periods' })
    fireEvent.click(within(cycle).getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)

    usage.mockReturnValue({ ...failed, isFetching: true, fetchStatus: 'fetching' })
    rerender(<TeslaApiUsagePage />)
    expect(within(cycle).getByRole('button', { name: 'Retry' })).toBeDisabled()
    expect(within(cycle).getByRole('button', { name: 'Retry' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('selected-history')).toBe(history)

    usage.mockReturnValue({ ...failed, fetchStatus: 'paused' })
    rerender(<TeslaApiUsagePage />)
    expect(within(cycle).getByRole('button', { name: 'Retry' })).toBeDisabled()
    expect(within(cycle).getByRole('button', { name: 'Retry' })).not.toHaveAttribute('aria-busy')
    expect(screen.getByTestId('selected-history')).toBe(history)

    usage.mockReturnValue({
      data: { current: { estimated_usd: 0 }, history: [] },
      isLoading: false, isFetching: false, error: null, fetchStatus: 'idle', refetch,
    })
    rerender(<TeslaApiUsagePage />)
    expect(screen.getByTestId('cycle')).toHaveTextContent(/^0$/)
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByTestId('selected-history')).toBe(history)
    expect(screen.getByText('How the estimate is calculated')).toBeInTheDocument()
  })

  it.each([
    [{ isLoading: true, isPending: true, isFetching: true, fetchStatus: 'fetching' }, 'loading'],
    [{ isLoading: false, isPending: true, isFetching: false, fetchStatus: 'paused' }, 'empty'],
    [{ isLoading: false, isPending: false, isFetching: false, fetchStatus: 'idle' }, 'empty'],
  ])('does not invent an error or zero for a cycle without data: %s', (state, expected) => {
    usage.mockReturnValue({ ...state, data: undefined, error: null, refetch: vi.fn() })
    render(<TeslaApiUsagePage />)
    expect(screen.getByTestId('cycle')).toHaveTextContent(expected)
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('selected-history')).toBeInTheDocument()
  })
})


describe('Tesla API usage preservation boundaries', () => {
  it('exposes all three independently named regions even before usage is available', () => {
    usage.mockReturnValue({ data: undefined, isLoading: false, error: null })
    render(<TeslaApiUsagePage />)
    for (const name of ['Current cycle and prior periods', 'Tesla usage history', 'How the estimate is calculated']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
    expect(screen.getByTestId('cycle')).toHaveTextContent('empty')
    expect(screen.getByText(/Counts come only from locally observed Tesla Fleet Telemetry/)).toBeInTheDocument()
    expect(screen.getByText(/Retransmitted signals are deduplicated/)).toBeInTheDocument()
    expect(screen.getByText(/No monthly credit, rounding or invoice adjustments are assumed/)).toBeInTheDocument()
  })

  it('keeps a measured zero distinct from unavailable cycle data', () => {
    const data = { current: { estimated_usd: 0 } }
    usage.mockReturnValue({ data, isLoading: false, error: null })
    render(<TeslaApiUsagePage />)
    expect(screen.getByTestId('cycle')).toHaveTextContent(/^0$/)
    expect(cycleProps).toHaveBeenLastCalledWith({ apiUsage: data, error: null, loading: false })
    expect(screen.getByTestId('selected-history')).toBeInTheDocument()
  })

  it('forwards retained usage and refresh failure without replacing history or methodology', () => {
    const data = { current: { estimated_usd: 4 } }
    const error = new Error('refresh unavailable')
    const refetch = vi.fn()
    usage.mockReturnValue({ data, isLoading: false, error, isError: true, isFetching: false, refetch })
    const { rerender } = render(<TeslaApiUsagePage />)
    expect(cycleProps).toHaveBeenLastCalledWith({ apiUsage: data, error, loading: false })
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('role', 'status')
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('selected-history')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'How the estimate is calculated' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()

    usage.mockReturnValue({ data, isLoading: false, error: null, isError: false, isFetching: false, refetch })
    rerender(<TeslaApiUsagePage />)
    expect(screen.getByTestId('cycle')).toHaveTextContent('4')
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('selected-history')).toBeInTheDocument()
  })

  it('preserves retained content and explains a paused refresh without inventing an error', () => {
    const data = { current: { estimated_usd: 4 } }
    usage.mockReturnValue({ data, isLoading: false, error: null, fetchStatus: 'paused' })
    render(<TeslaApiUsagePage />)
    expect(screen.getByTestId('cycle')).toHaveTextContent('4')
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true')
    expect(cycleProps).toHaveBeenLastCalledWith({ apiUsage: data, error: null, loading: false })
    expect(screen.getByTestId('selected-history')).toBeInTheDocument()
    expect(screen.getByText('150,000 / $1')).toBeInTheDocument()
  })

  it('keeps the complete API pricing reference and enables long-word wrapping', () => {
    const source = `https://developer.tesla.com/${'pricing-reference'.repeat(30)}`
    usage.mockReturnValue({ data: { current: { estimated_usd: 4 }, rate_source: source }, isLoading: false, error: null })
    render(<TeslaApiUsagePage />)
    expect(screen.getByText(/Tesla Fleet API pricing reference/)).toHaveTextContent(source)
    expect(screen.getByText(/Tesla Fleet API pricing reference/)).toHaveClass('break-words')
    expect(screen.getByText(/These are fixed UTC 30-day windows/)).toBeInTheDocument()
  })
})
