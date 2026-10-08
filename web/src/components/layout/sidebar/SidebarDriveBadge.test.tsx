import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SidebarDriveBadge } from './SidebarDriveBadge'

const mocks = vi.hoisted(() => ({
  drives: [] as unknown[] | undefined,
  score: undefined as { overall: number } | undefined,
  error: null as Error | null,
  fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  useDrives: vi.fn(),
  useDriveScore: vi.fn(),
}))

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: mocks.useDrives.mockImplementation(() => ({ data: mocks.drives, error: mocks.error, fetchStatus: mocks.fetchStatus })),
  useDriveScore: mocks.useDriveScore.mockImplementation(() => ({ data: mocks.score, error: mocks.error, fetchStatus: mocks.fetchStatus })),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, value: string | { count?: number; score?: number; defaultValue: string }) =>
      typeof value === 'string'
        ? value
        : value.defaultValue.replace('{{count}}', String(value.count)).replace('{{score}}', String(value.score)),
  }),
}))

beforeEach(() => {
  mocks.drives = []
  mocks.score = undefined
  mocks.error = null
  mocks.fetchStatus = 'idle'
  mocks.useDrives.mockClear()
  mocks.useDriveScore.mockClear()
})

it('shows only an actual selected vehicle drive count for today', () => {
  mocks.drives = [{}, {}, {}]
  render(<SidebarDriveBadge kind="today" vehicleId="7" />)
  expect(screen.getByLabelText('3 drives today')).toHaveTextContent('3 today')
  expect(mocks.useDrives).toHaveBeenCalledWith('7', expect.objectContaining({
    start: expect.stringMatching(/T.*Z$/),
    end: expect.stringMatching(/T.*Z$/),
    limit: 1000,
  }))
  expect(mocks.useDriveScore).toHaveBeenCalledWith(undefined)
})

it('does not present a capped or unavailable drive count as the complete total', () => {
  mocks.drives = Array.from({ length: 1000 }, () => ({}))
  const { rerender } = render(<SidebarDriveBadge kind="today" vehicleId="7" />)
  expect(screen.queryByLabelText(/drives today/)).not.toBeInTheDocument()
  mocks.drives = undefined
  rerender(<SidebarDriveBadge kind="today" vehicleId="7" />)
  expect(screen.queryByLabelText(/drives today/)).not.toBeInTheDocument()
})

it('shows an uncapped real drive score and omits invalid scores', () => {
  mocks.score = { overall: 100 }
  const { rerender } = render(<SidebarDriveBadge kind="score" vehicleId="7" />)
  expect(screen.getByLabelText('Drive score 100')).toHaveTextContent('100')
  expect(mocks.useDrives).toHaveBeenCalledWith(undefined, expect.any(Object))
  expect(mocks.useDriveScore).toHaveBeenCalledWith('7')
  mocks.score = { overall: Number.NaN }
  rerender(<SidebarDriveBadge kind="score" vehicleId="7" />)
  expect(screen.queryByLabelText(/Drive score/)).not.toBeInTheDocument()
})

it('keeps measured zero scores neutral without inventing success or activity', () => {
  mocks.score = { overall: 0 }
  render(<SidebarDriveBadge kind="score" vehicleId="7" />)
  const badge = screen.getByLabelText('Drive score 0')
  expect(badge).toHaveTextContent('0')
  expect(badge).toHaveClass('bg-[var(--surface-3)]', 'text-[var(--text-secondary)]')
  expect(badge.className).not.toMatch(/emerald|neon|animate|shadow/)
})

it('keeps retained counts and scores through failed and paused refreshes', () => {
  mocks.drives = [{}, {}]
  mocks.score = { overall: 73.6 }
  mocks.error = new Error('Refresh failed')
  mocks.fetchStatus = 'paused'
  const { rerender } = render(<SidebarDriveBadge kind="today" vehicleId="7" />)
  expect(screen.getByLabelText('2 drives today')).toHaveTextContent('2 today')
  rerender(<SidebarDriveBadge kind="score" vehicleId="7" />)
  expect(screen.getByLabelText('Drive score 74')).toHaveTextContent('74')
})

it('omits absent scores and zero counts without substituting readings', () => {
  const { container, rerender } = render(<SidebarDriveBadge kind="score" vehicleId="7" />)
  expect(container).toBeEmptyDOMElement()
  rerender(<SidebarDriveBadge kind="today" vehicleId="7" />)
  expect(container).toBeEmptyDOMElement()
})

it.each([-1, 101, Number.POSITIVE_INFINITY])('omits out-of-domain score %s', overall => {
  mocks.score = { overall }
  const { container } = render(<SidebarDriveBadge kind="score" vehicleId="7" />)
  expect(container).toBeEmptyDOMElement()
})

it('retains selected vehicle identity when the badge scope changes', () => {
  mocks.drives = [{}]
  mocks.score = { overall: 52 }
  const { rerender } = render(<SidebarDriveBadge kind="today" vehicleId="7" />)
  rerender(<SidebarDriveBadge kind="score" vehicleId="19" />)
  expect(mocks.useDriveScore).toHaveBeenLastCalledWith('19')
  expect(mocks.useDrives).toHaveBeenLastCalledWith(undefined, expect.objectContaining({ limit: 1000 }))
  expect(screen.getByLabelText('Drive score 52')).toHaveTextContent('52')
})
