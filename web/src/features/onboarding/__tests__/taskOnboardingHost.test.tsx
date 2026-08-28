import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'

import { TaskOnboardingHost } from '../components/TaskOnboardingHost'
import {
  __resetOnboardingTasksForTests,
  getTaskStatus,
  isTaskOnboardingOptedOut,
} from '@/lib/onboardingTasks'

/**
 * HELP-01 integration.
 *
 * The behaviours under test are the ones a user feels: does an unsolicited
 * surface appear, can it be got rid of permanently, and does it stay gone.
 */

const mockVehicles = vi.hoisted(() => ({ current: [] as Array<{ id: number }> }))

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: mockVehicles.current }),
}))

function renderHost(initialPath = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="*" element={<TaskOnboardingHost />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  __resetOnboardingTasksForTests()
  mockVehicles.current = []
})

describe('TaskOnboardingHost', () => {
  it('offers the vehicle-linking task to a new user on the dashboard', () => {
    renderHost('/')
    const hint = screen.getByTestId('task-onboarding-hint')
    expect(hint).toHaveAttribute('data-task-id', 'link-vehicle')
  })

  it('renders nothing at all on an unrelated route', () => {
    const { container } = renderHost('/battery')
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing once the task is no longer outstanding', () => {
    mockVehicles.current = [{ id: 1 }]
    const { container } = renderHost('/')
    expect(container).toBeEmptyDOMElement()
  })

  it('is a note, not a dialog — it never traps or steals focus', () => {
    renderHost('/')
    expect(screen.getByRole('note')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(document.body)
  })

  it('states the prerequisite alongside the benefit', () => {
    renderHost('/')
    expect(screen.getByText(/nothing is recorded until/i)).toBeInTheDocument()
    expect(screen.getByText(/requires a signed-in tesla account/i)).toBeInTheDocument()
  })

  it('offers exactly one canonical action', () => {
    renderHost('/')
    const action = screen.getByTestId('task-onboarding-action')
    expect(action).toHaveAttribute('href', '/onboarding')
  })

  it('records completion when the user follows the action', () => {
    renderHost('/')
    fireEvent.click(screen.getByTestId('task-onboarding-action'))
    expect(getTaskStatus('link-vehicle', 1)).toBe('completed')
  })

  it('dismisses permanently at this version and disappears immediately', () => {
    renderHost('/')
    fireEvent.click(screen.getByTestId('task-onboarding-dismiss'))
    expect(getTaskStatus('link-vehicle', 1)).toBe('dismissed')
    expect(screen.queryByTestId('task-onboarding-hint')).not.toBeInTheDocument()
  })

  it('lets the user turn the whole surface off', () => {
    renderHost('/')
    fireEvent.click(screen.getByTestId('task-onboarding-optout'))
    expect(isTaskOnboardingOptedOut()).toBe(true)
    expect(screen.queryByTestId('task-onboarding-hint')).not.toBeInTheDocument()
  })

  it('honours a previous opt-out on a fresh mount', () => {
    renderHost('/')
    fireEvent.click(screen.getByTestId('task-onboarding-optout'))

    const { container } = renderHost('/')
    expect(container).toBeEmptyDOMElement()
  })

  it('honours a previous dismissal on a fresh mount', () => {
    renderHost('/')
    fireEvent.click(screen.getByTestId('task-onboarding-dismiss'))

    const { container } = renderHost('/')
    expect(container).toBeEmptyDOMElement()
  })
})
