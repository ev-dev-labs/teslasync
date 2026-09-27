import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SidebarDriveBadge } from './SidebarDriveBadge'

const mocks = vi.hoisted(() => ({
  drives: [] as unknown[] | undefined,
  score: undefined as { overall: number } | undefined,
  useDrives: vi.fn(),
  useDriveScore: vi.fn(),
}))

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: mocks.useDrives.mockImplementation(() => ({ data: mocks.drives })),
  useDriveScore: mocks.useDriveScore.mockImplementation(() => ({ data: mocks.score })),
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
