// Behaviour + a11y contract for AiOutputPanel — the shared
// streaming-output renderer paired with useAiStream.
//
// Exercises the full render matrix
//   (idle / streaming / paused-confirm / done / error)
//     × (empty / non-empty accumulated text)
// plus the pendingChild override (undefined default indicator, custom
// node, explicit null opt-out), the error fallback message, the
// assertive alert region for errors, and the done-with-no-text
// empty-state (regression guard against a blank panel).
//
// react-i18next's useTranslation returns the inline English fallback
// when no provider is mounted, so — like the sibling AI component
// tests — no i18n setup is required.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AiOutputPanel, type AiOutputPanelProps } from './AiOutputPanel'

const PANEL = 'ai-output-panel'
const THINKING = 'ai-thinking-indicator'

function renderPanel(props: Partial<AiOutputPanelProps> = {}) {
  const merged: AiOutputPanelProps = {
    text: '',
    state: 'idle',
    error: null,
    ...props,
  }
  return render(<AiOutputPanel {...merged} />)
}

describe('AiOutputPanel', () => {
  describe('not-started lifecycle', () => {
    it('renders nothing when idle with no accumulated text', () => {
      const { container } = renderPanel({ state: 'idle', text: '' })
      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByTestId(PANEL)).toBeNull()
    })

    it('renders nothing when paused-confirm with no text (the dialog owns the UI)', () => {
      const { container } = renderPanel({ state: 'paused-confirm', text: '' })
      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByTestId(PANEL)).toBeNull()
    })

    it('shows accumulated text even while idle once some text exists', () => {
      renderPanel({ state: 'idle', text: 'partial output' })
      const panel = screen.getByTestId(PANEL)
      expect(panel).toBeInTheDocument()
      expect(panel).toHaveTextContent('partial output')
      expect(screen.queryByTestId(THINKING)).toBeNull()
    })
  })

  describe('streaming', () => {
    it('shows the animated thinking indicator while streaming with no text yet', () => {
      renderPanel({ state: 'streaming', text: '' })
      const indicator = screen.getByTestId(THINKING)
      expect(indicator).toBeInTheDocument()
      // The indicator is a polite live-status region so screen readers
      // announce that the model is working.
      expect(indicator).toHaveAttribute('role', 'status')
      expect(indicator).toHaveAttribute('aria-live', 'polite')
    })

    it('renders the accumulated text (not the indicator) once deltas arrive', () => {
      renderPanel({ state: 'streaming', text: 'Hello world' })
      expect(screen.getByTestId(PANEL)).toHaveTextContent('Hello world')
      expect(screen.queryByTestId(THINKING)).toBeNull()
    })

    it('renders a custom pendingChild in place of the default indicator', () => {
      renderPanel({
        state: 'streaming',
        text: '',
        pendingChild: <span data-testid="custom-pending">Working…</span>,
      })
      expect(screen.getByTestId('custom-pending')).toBeInTheDocument()
      expect(screen.getByTestId('custom-pending')).toHaveTextContent('Working…')
      expect(screen.queryByTestId(THINKING)).toBeNull()
    })

    it('omits the placeholder entirely when pendingChild is explicitly null', () => {
      renderPanel({ state: 'streaming', text: '', pendingChild: null })
      const panel = screen.getByTestId(PANEL)
      expect(panel).toBeInTheDocument()
      expect(screen.queryByTestId(THINKING)).toBeNull()
      // Panel container is present but carries no placeholder content.
      expect(panel).toBeEmptyDOMElement()
    })
  })

  describe('error', () => {
    it('renders the error message inside an assertive alert region', () => {
      renderPanel({ state: 'error', error: 'rate limit exceeded' })
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('Helix error:')
      expect(alert).toHaveTextContent('rate limit exceeded')
    })

    it('falls back to "unknown" when the error message is null', () => {
      renderPanel({ state: 'error', error: null })
      expect(screen.getByRole('alert')).toHaveTextContent(/Helix error:\s*unknown/i)
    })

    it('prefers the error over any accumulated text', () => {
      renderPanel({ state: 'error', error: 'boom', text: 'half-written answer' })
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('boom')
      expect(screen.getByTestId(PANEL)).not.toHaveTextContent('half-written answer')
    })

    it('marks the decorative brand mark aria-hidden so the alert reads cleanly', () => {
      const { container } = renderPanel({ state: 'error', error: 'x' })
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('done', () => {
    it('renders the completed narrative with whitespace preserved', () => {
      renderPanel({ state: 'done', text: 'Line one\n\nLine two' })
      const paragraph = screen.getByTestId(PANEL).querySelector('p')
      expect(paragraph).not.toBeNull()
      expect(paragraph?.className).toContain('whitespace-pre-wrap')
      expect(paragraph?.textContent).toBe('Line one\n\nLine two')
    })

    it('shows an explicit empty-state message when done with no output (never a blank panel)', () => {
      renderPanel({ state: 'done', text: '' })
      const panel = screen.getByTestId(PANEL)
      expect(panel).toBeInTheDocument()
      // Regression guard: a completed-but-silent stream must not leave an
      // empty paragraph / blank panel behind.
      expect(panel).not.toBeEmptyDOMElement()
      expect(panel).toHaveTextContent(/no output/i)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByTestId(THINKING)).toBeNull()
    })

    it('renders successful and failed evidence sources without exposing payloads', () => {
      renderPanel({
        state: 'done',
        text: 'Grounded answer',
        activity: [
          { id: 'one', name: 'query_battery_status', status: 'succeeded' },
          { id: 'two', name: 'query_vehicle_location', status: 'failed' },
        ],
        usage: { in: 20, out: 10 },
      })

      const trail = screen.getByTestId('helix-evidence-trail')
      expect(trail).toHaveTextContent('Evidence trail')
      expect(trail).toHaveTextContent('Battery status')
      expect(trail).toHaveTextContent('Vehicle location')
      expect(trail).toHaveTextContent('1 successful')
      expect(trail).toHaveTextContent('1 unavailable')
      expect(trail).toHaveTextContent('30 tokens')
      expect(trail).not.toHaveTextContent('vehicle_id')
    })
  })
})
