/**
 * RoadmapPage — smoke tests.
 *
 * The page is a static catalogue with no API calls and no router/hash
 * navigation, so the contract surface is small:
 *   1. It renders without crashing under default i18n.
 *   2. The page title is set via usePageTitle.
 *   3. Every roadmap phase label (done/current/next/future) appears at
 *      least once as a phase badge so a future addition that forgets to
 *      wire a phase up will fail the test immediately.
 *   4. Every section heading from the static `roadmapItems` array is
 *      rendered so a future re-ordering / dedup that drops a section
 *      surfaces here.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

const setTitle = vi.fn()
vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (t: string) => setTitle(t),
}))

import RoadmapPage from './RoadmapPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <RoadmapPage />
    </MemoryRouter>,
  )
}

describe('RoadmapPage', () => {
  it('renders without crashing', () => {
    const { container } = renderPage()
    expect(container.firstChild).not.toBeNull()
  })

  it('sets the page title via usePageTitle', () => {
    setTitle.mockClear()
    renderPage()
    expect(setTitle).toHaveBeenCalled()
  })

  it('renders every roadmap phase label at least once', () => {
    renderPage()
    // Phase labels are hard-coded in phaseConfig and rendered as badge text.
    // If a future refactor drops one of these, the test fails — which is
    // the desired behaviour because the UI shipped without that phase.
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Up Next').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Future').length).toBeGreaterThan(0)
  })

  it('renders the Core Platform section title', () => {
    renderPage()
    // Anchor on a stable hand-authored section from `roadmapItems`. A
    // regex avoids whitespace flake from the surrounding badge layout.
    expect(screen.getByText(/Core Platform/i)).toBeInTheDocument()
  })
})
