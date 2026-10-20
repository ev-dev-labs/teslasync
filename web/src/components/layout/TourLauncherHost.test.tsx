import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TOUR_OPEN_LAUNCHER_EVENT } from '@/lib/tourRegistry'
import { TourLauncherHost } from './TourLauncherHost'

const { loaded } = vi.hoisted(() => ({ loaded: vi.fn() }))
vi.mock('@/features/onboarding/TourLauncher', () => {
  loaded()
  return { TourLauncher: ({ initialOpen }: { initialOpen?: boolean }) =>
    <div data-testid="deferred-tour">{String(initialOpen)}</div> }
})

afterEach(cleanup)

it('loads no dialog before a request and retains the first request through loading', async () => {
  render(<TourLauncherHost />)
  expect(loaded).not.toHaveBeenCalled()
  expect(screen.queryByTestId('deferred-tour')).not.toBeInTheDocument()
  await act(async () => { window.dispatchEvent(new CustomEvent(TOUR_OPEN_LAUNCHER_EVENT)) })
  expect(await screen.findByTestId('deferred-tour')).toHaveTextContent('true')
  expect(loaded).toHaveBeenCalledTimes(1)
})
