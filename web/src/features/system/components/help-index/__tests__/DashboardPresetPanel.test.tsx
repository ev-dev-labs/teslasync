import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import '@/i18n'

import { DashboardPresetPanel, resolvePresetCardState } from '../DashboardPresetPanel'
import {
  DASHBOARD_PRESET_APPLIED_KEY,
  DASHBOARD_PRESET_PREFERENCE_KEY,
  getDashboardPresetPreference,
  hasPendingDashboardPreset,
  peekPendingDashboardPreset,
  requestDashboardPresetApplication,
  setAppliedDashboardPresetRole,
} from '@/lib/dashboardPresets'

/**
 * HELP-11 picker honesty (correction round).
 *
 * The review found the panel claiming "Selected" for a role whose widgets had
 * never been written to any dashboard. That is a lie the user discovers the
 * moment they open the dashboard and see their old layout — so "chosen" and
 * "applied" are now distinct states with distinct copy.
 */

function renderPanel() {
  return render(
    <MemoryRouter>
      <DashboardPresetPanel />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('DashboardPresetPanel — chosen vs applied', () => {
  it('offers every role and marks none as chosen initially', () => {
    renderPanel()
    const cards = screen.getAllByTestId('dashboard-preset-card')
    expect(cards).toHaveLength(4)
    for (const card of cards) {
      expect(card).toHaveAttribute('data-selected', 'false')
      expect(card).toHaveAttribute('data-applied', 'false')
    }
  })

  it('says "Chosen" — never "Selected" — before the dashboard applies it', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('choose-preset-owner'))

    expect(getDashboardPresetPreference()).toBe('owner')
    // Choosing queues exactly one application.
    expect(peekPendingDashboardPreset()?.role).toBe('owner')
    const card = screen
      .getAllByTestId('dashboard-preset-card')
      .find((c) => c.getAttribute('data-preset-role') === 'owner')!
    expect(card).toHaveAttribute('data-selected', 'true')
    expect(card).toHaveAttribute('data-applied', 'false')
    expect(screen.getByTestId('choose-preset-owner')).toHaveTextContent(/chosen/i)
    expect(screen.getByTestId('preset-pending-note-owner')).toBeInTheDocument()
  })

  it('points the user at the dashboard while an application is pending', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('choose-preset-maintainer'))
    expect(screen.getByTestId('dashboard-preset-open-dashboard')).toHaveTextContent(
      /open the dashboard to apply it/i,
    )
  })

  it('says "Selected" only once the dashboard reports it applied', () => {
    window.localStorage.setItem(DASHBOARD_PRESET_PREFERENCE_KEY, 'energy_analyst')
    window.localStorage.setItem(DASHBOARD_PRESET_APPLIED_KEY, 'energy_analyst')
    renderPanel()

    const card = screen
      .getAllByTestId('dashboard-preset-card')
      .find((c) => c.getAttribute('data-preset-role') === 'energy_analyst')!
    expect(card).toHaveAttribute('data-applied', 'true')
    expect(screen.getByTestId('choose-preset-energy_analyst')).toHaveTextContent(/selected/i)
    expect(screen.getByTestId('preset-applied-energy_analyst')).toBeInTheDocument()
    expect(screen.queryByTestId('preset-pending-note-energy_analyst')).not.toBeInTheDocument()
  })

  it('flips to applied live when the dashboard emits the applied event', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('choose-preset-fleet_operator'))
    expect(screen.getByTestId('preset-pending-fleet_operator')).toBeInTheDocument()

    act(() => {
      // This is exactly what `applyRolePreset` does after writing the layout.
      setAppliedDashboardPresetRole('fleet_operator')
    })

    expect(screen.getByTestId('preset-applied-fleet_operator')).toBeInTheDocument()
    expect(screen.queryByTestId('preset-pending-fleet_operator')).not.toBeInTheDocument()
  })

  it('reverts to a re-appliable state when the layout stops matching', () => {
    // The exact stale-marker scenario: apply on the dashboard, then customise
    // or undo. The dashboard's reconciliation clears the applied marker. The
    // panel must stop claiming "Selected" — and must NOT show a pending
    // application, because navigation alone must never re-apply.
    window.localStorage.setItem(DASHBOARD_PRESET_PREFERENCE_KEY, 'owner')
    window.localStorage.setItem(DASHBOARD_PRESET_APPLIED_KEY, 'owner')
    renderPanel()
    expect(screen.getByTestId('preset-applied-owner')).toBeInTheDocument()

    act(() => {
      setAppliedDashboardPresetRole(null)
    })

    expect(screen.queryByTestId('preset-applied-owner')).not.toBeInTheDocument()
    // No queued application — this is the whole point of the fix.
    expect(hasPendingDashboardPreset()).toBe(false)
    expect(screen.queryByTestId('preset-pending-owner')).not.toBeInTheDocument()
    // …but the user is told why, and offered an explicit way back.
    expect(screen.getByTestId('preset-diverged-note-owner')).toBeInTheDocument()
    expect(screen.getByTestId('reapply-preset-owner')).toBeInTheDocument()
  })

  it('queues exactly one application when the user explicitly re-applies', () => {
    window.localStorage.setItem(DASHBOARD_PRESET_PREFERENCE_KEY, 'owner')
    renderPanel()
    expect(hasPendingDashboardPreset()).toBe(false)

    fireEvent.click(screen.getByTestId('reapply-preset-owner'))

    const request = peekPendingDashboardPreset()
    expect(request?.role).toBe('owner')
    expect(screen.getByTestId('preset-pending-owner')).toBeInTheDocument()
  })

  it('offers no re-apply while the preset is actually applied', () => {
    window.localStorage.setItem(DASHBOARD_PRESET_PREFERENCE_KEY, 'owner')
    window.localStorage.setItem(DASHBOARD_PRESET_APPLIED_KEY, 'owner')
    renderPanel()
    expect(screen.queryByTestId('reapply-preset-owner')).not.toBeInTheDocument()
  })

  it('re-reads the marker when the tab becomes visible again', () => {
    // Going to the dashboard, undoing, and coming back fires no event at a
    // backgrounded tab — so visibility is the only signal available.
    window.localStorage.setItem(DASHBOARD_PRESET_PREFERENCE_KEY, 'owner')
    window.localStorage.setItem(DASHBOARD_PRESET_APPLIED_KEY, 'owner')
    renderPanel()
    expect(screen.getByTestId('preset-applied-owner')).toBeInTheDocument()

    // Simulate the other surface clearing it without dispatching to this tab.
    window.localStorage.removeItem(DASHBOARD_PRESET_APPLIED_KEY)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(screen.queryByTestId('preset-applied-owner')).not.toBeInTheDocument()
  })

  it('clears the preference AND the queued application when tapped again', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('choose-preset-owner'))
    expect(hasPendingDashboardPreset()).toBe(true)

    fireEvent.click(screen.getByTestId('choose-preset-owner'))

    expect(getDashboardPresetPreference()).toBeNull()
    // Unchoosing must cancel the application, not leave it armed.
    expect(hasPendingDashboardPreset()).toBe(false)
    expect(screen.getByTestId('choose-preset-owner')).toHaveTextContent(/use this preset/i)
  })

  it('lists the widget composition so the choice is inspectable', () => {
    renderPanel()
    const card = screen
      .getAllByTestId('dashboard-preset-card')
      .find((c) => c.getAttribute('data-preset-role') === 'maintainer')!
    expect(card.querySelectorAll('[data-preset-widget]').length).toBeGreaterThan(3)
    expect(card.querySelector('[data-preset-widget="system-health"]')).not.toBeNull()
  })

  it('states that it updates the existing dashboard rather than creating one', () => {
    renderPanel()
    expect(screen.getByTestId('dashboard-preset-panel')).toHaveTextContent(
      /updates your existing dashboard in place/i,
    )
  })
})

/**
 * Combined-state consistency (final correction round).
 *
 * The review found the `!selected && applied` combination — reachable the
 * instant a user with `owner` applied chooses `energy_analyst` — disagreeing
 * with itself in three ways at once. The card said "Selected — tap to clear",
 * reported `aria-pressed=false`, and on click *chose* the role instead of
 * clearing it.
 *
 * These tests seed preference and applied to DIFFERENT roles so every card in
 * the panel is in a different state simultaneously, then assert that the
 * label, the icon, `aria-pressed`, the explanation and the storage effect of
 * clicking all describe the same thing.
 */
describe('DashboardPresetPanel — combined selected/applied/pending states', () => {
  /** owner is on screen; energy_analyst is what the user just chose. */
  function seedDivergentRoles() {
    window.localStorage.setItem(DASHBOARD_PRESET_PREFERENCE_KEY, 'energy_analyst')
    window.localStorage.setItem(DASHBOARD_PRESET_APPLIED_KEY, 'owner')
    requestDashboardPresetApplication('energy_analyst')
  }

  function card(role: string) {
    return screen
      .getAllByTestId('dashboard-preset-card')
      .find((c) => c.getAttribute('data-preset-role') === role)!
  }

  it('resolves each combination to exactly one explicit state', () => {
    // The table itself, so a future refactor cannot quietly re-merge two
    // states that must behave differently.
    expect(resolvePresetCardState({ selected: false, applied: false, pending: false })).toBe('idle')
    expect(resolvePresetCardState({ selected: true, applied: false, pending: true })).toBe('queued')
    expect(resolvePresetCardState({ selected: true, applied: true, pending: false })).toBe('active')
    expect(resolvePresetCardState({ selected: false, applied: true, pending: false })).toBe(
      'activeUnchosen',
    )
    expect(resolvePresetCardState({ selected: true, applied: false, pending: false })).toBe(
      'diverged',
    )
    // A queued request for some OTHER role must not describe this card.
    expect(resolvePresetCardState({ selected: false, applied: true, pending: true })).toBe(
      'activeUnchosen',
    )
    // A live layout outranks a queued request: announcing "applies next time"
    // about what is already on screen would be true and useless.
    expect(resolvePresetCardState({ selected: true, applied: true, pending: true })).toBe('active')
    // Torn cross-tab state — offer to choose rather than over-claim.
    expect(resolvePresetCardState({ selected: false, applied: false, pending: true })).toBe('idle')
  })

  it('never claims "Selected" for a role the user has not chosen', () => {
    seedDivergentRoles()
    renderPanel()

    const owner = card('owner')
    expect(owner).toHaveAttribute('data-card-state', 'activeUnchosen')
    const button = screen.getByTestId('choose-preset-owner')
    // The exact defect: this used to read "Selected — tap to clear".
    expect(button).not.toHaveTextContent(/selected/i)
    expect(button).toHaveTextContent(/use this preset/i)
  })

  it('agrees between label, aria-pressed and click outcome on an applied-but-unchosen card', () => {
    seedDivergentRoles()
    renderPanel()

    const button = screen.getByTestId('choose-preset-owner')
    // The label offers to choose…
    expect(button).toHaveTextContent(/use this preset/i)
    // …so it must not announce itself as pressed…
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveAttribute('data-primary-action', 'choose')

    fireEvent.click(button)

    // …and the click must actually choose it, not clear anything.
    expect(getDashboardPresetPreference()).toBe('owner')
    expect(peekPendingDashboardPreset()?.role).toBe('owner')
    // owner was already the live layout, so choosing it makes the card
    // genuinely `active` — and only now may it say "Selected".
    const after = screen.getByTestId('choose-preset-owner')
    expect(card('owner')).toHaveAttribute('data-card-state', 'active')
    expect(after).toHaveTextContent(/selected — tap to clear/i)
    expect(after).toHaveAttribute('aria-pressed', 'true')
    expect(after).toHaveAttribute('data-primary-action', 'clear')
  })

  it('explains honestly that an applied-but-unchosen preset is the current layout', () => {
    seedDivergentRoles()
    renderPanel()

    // Still shows the applied check — it IS what is on screen…
    expect(screen.getByTestId('preset-applied-owner')).toBeInTheDocument()
    // …but the copy says so, instead of implying the user picked it.
    expect(screen.getByTestId('preset-active-unchosen-note-owner')).toHaveTextContent(
      /what your dashboard looks like right now/i,
    )
    // It is not diverged and it is not queued.
    expect(screen.queryByTestId('preset-diverged-note-owner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('preset-pending-note-owner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reapply-preset-owner')).not.toBeInTheDocument()
  })

  it('shows the chosen-but-not-yet-applied role as queued at the same time', () => {
    seedDivergentRoles()
    renderPanel()

    const chosen = card('energy_analyst')
    expect(chosen).toHaveAttribute('data-card-state', 'queued')
    const button = screen.getByTestId('choose-preset-energy_analyst')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('data-primary-action', 'clear')
    expect(button).toHaveTextContent(/chosen/i)
    expect(button).not.toHaveTextContent(/selected/i)
    expect(screen.getByTestId('preset-pending-note-energy_analyst')).toBeInTheDocument()
  })

  it('clears — and only clears — when a pressed card is tapped', () => {
    seedDivergentRoles()
    renderPanel()

    fireEvent.click(screen.getByTestId('choose-preset-energy_analyst'))

    expect(getDashboardPresetPreference()).toBeNull()
    expect(hasPendingDashboardPreset()).toBe(false)
    // Clearing the preference must not touch what is actually on the dashboard.
    expect(window.localStorage.getItem(DASHBOARD_PRESET_APPLIED_KEY)).toBe('owner')
    expect(card('owner')).toHaveAttribute('data-card-state', 'activeUnchosen')
  })

  it('reserves "Selected — tap to clear" for chosen AND applied', () => {
    window.localStorage.setItem(DASHBOARD_PRESET_PREFERENCE_KEY, 'owner')
    window.localStorage.setItem(DASHBOARD_PRESET_APPLIED_KEY, 'owner')
    renderPanel()

    const button = screen.getByTestId('choose-preset-owner')
    expect(card('owner')).toHaveAttribute('data-card-state', 'active')
    expect(button).toHaveTextContent(/selected — tap to clear/i)
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('data-primary-action', 'clear')

    fireEvent.click(button)

    expect(getDashboardPresetPreference()).toBeNull()
    expect(hasPendingDashboardPreset()).toBe(false)
  })

  it('keeps aria-pressed and the offer to clear in lockstep across all four cards', () => {
    seedDivergentRoles()
    renderPanel()

    for (const c of screen.getAllByTestId('dashboard-preset-card')) {
      const role = c.getAttribute('data-preset-role')!
      const button = screen.getByTestId(`choose-preset-${role}`)
      const pressed = button.getAttribute('aria-pressed') === 'true'
      const offersClear = /tap to clear/i.test(button.textContent ?? '')
      // These are the two things a screen reader user and a sighted user
      // respectively rely on. They must never disagree.
      expect(offersClear).toBe(pressed)
      expect(button.getAttribute('data-primary-action')).toBe(pressed ? 'clear' : 'choose')
      expect(c.getAttribute('data-selected')).toBe(String(pressed))
    }
  })

  it('re-reads the preference on cross-tab writes, not just the applied marker', () => {
    // Choosing in another tab writes the preference and the pending record.
    // Reading only some of them is how a card ends up selected-but-not-pending
    // and lands in a state its copy was never written for.
    window.localStorage.setItem(DASHBOARD_PRESET_APPLIED_KEY, 'owner')
    renderPanel()
    expect(card('owner')).toHaveAttribute('data-card-state', 'activeUnchosen')

    act(() => {
      window.localStorage.setItem(DASHBOARD_PRESET_PREFERENCE_KEY, 'maintainer')
      requestDashboardPresetApplication('maintainer')
      window.dispatchEvent(new StorageEvent('storage'))
    })

    expect(card('maintainer')).toHaveAttribute('data-card-state', 'queued')
    expect(screen.getByTestId('choose-preset-maintainer')).toHaveAttribute('aria-pressed', 'true')
    expect(card('owner')).toHaveAttribute('data-card-state', 'activeUnchosen')
  })
})
