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

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import * as reactI18next from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'

import { AiOutputPanel, type AiOutputPanelProps } from './AiOutputPanel'
import { AIFeatureCard, type AIFeatureStream } from './AIFeatureCard'

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

    it('prioritizes the error while keeping incomplete accumulated text readable', () => {
      renderPanel({ state: 'error', error: 'boom', text: 'half-written answer' })
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('boom')
      const narrative = screen.getByText('half-written answer')
      expect(narrative).toBeVisible()
      expect(alert.compareDocumentPosition(narrative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(alert).not.toHaveTextContent('half-written answer')
      expect(screen.queryByTestId(THINKING)).toBeNull()
      expect(screen.queryByText(/no output|successful|verified/i)).toBeNull()
    })

    it('does not fabricate a narrative or completion summary for an empty failed stream', () => {
      renderPanel({ state: 'error', error: 'connection interrupted', text: '' })
      expect(screen.getByRole('alert')).toHaveTextContent('connection interrupted')
      expect(screen.getByTestId(PANEL).querySelectorAll('p')).toHaveLength(1)
      expect(screen.queryByText(/no output|successful|tokens/i)).toBeNull()
      expect(screen.queryByTestId(THINKING)).toBeNull()
    })

    it('retains the literal string zero and unknown failure without inventing freshness', () => {
      renderPanel({ state: 'error', error: null, text: '0' })
      expect(screen.getByText('0')).toBeVisible()
      expect(screen.getByRole('alert')).toHaveTextContent(/Helix error:\s*unknown/i)
      expect(screen.queryByTestId('helix-evidence-trail')).toBeNull()
      expect(screen.queryByText(/successful|verified|last success|updated|no output/i)).toBeNull()
      expect(screen.getByTestId(PANEL).querySelector('time')).toBeNull()
    })

    it('keeps partial prose selectable verbatim alongside failed evidence without a done summary', () => {
      const text = 'مرحبا\n\n0 <script>literal</script>'
      renderPanel({
        state: 'error',
        error: 'interrupted',
        text,
        activity: [{ id: 'failed-source', name: 'query_battery_status', status: 'failed' }],
        usage: { in: 20, out: 10 },
      })
      const paragraph = screen.getByTestId(PANEL).querySelectorAll('p')[1]
      expect(paragraph).toHaveClass('whitespace-pre-wrap', 'break-words')
      expect(paragraph.textContent).toBe(text)
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      selection?.removeAllRanges()
      selection?.addRange(range)
      expect(selection?.toString()).toBe(text)
      selection?.removeAllRanges()
      expect(screen.getByRole('alert')).toHaveTextContent('interrupted')
      const trail = screen.getByTestId('helix-evidence-trail')
      expect(trail).toHaveTextContent('Limited evidence')
      expect(trail).toHaveTextContent('Unavailable')
      expect(trail).not.toHaveTextContent(/successful|tokens|Grounded in/)
      expect(screen.getByTestId(PANEL).querySelector('script')).toBeNull()
    })

    it('keeps the real feature retry available and preserves streaming, paused and done phases', () => {
      const start = vi.fn()
      const stream: AIFeatureStream = {
        state: 'error', text: 'partial answer', error: 'interrupted', start,
      }
      const card = (current: AIFeatureStream) => (
        <AIFeatureCard title="Answer" description="Source context" buttonLabel="Explain" canStart stream={current} />
      )
      const { rerender } = render(card(stream))
      expect(screen.getByText('partial answer')).toBeVisible()
      expect(screen.getByRole('alert')).toHaveTextContent('interrupted')
      const retry = screen.getByRole('button', { name: /Explain/ })
      expect(retry).toBeEnabled()
      fireEvent.click(retry)
      expect(start).toHaveBeenCalledTimes(1)

      rerender(card({ ...stream, state: 'streaming', text: 'new delta', error: null }))
      expect(screen.getByText('new delta')).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByRole('button', { name: /Explain/ })).toBeDisabled()
      rerender(card({ ...stream, state: 'paused-confirm', error: null }))
      expect(screen.getByText('partial answer')).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
      rerender(card({ ...stream, state: 'done', text: 'completed narrative', error: null }))
      expect(screen.getByText('completed narrative')).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
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

  describe('restrained presentation and preservation', () => {
    it('uses existing surface and shape roles without fixed white chrome', () => {
      renderPanel({ state: 'done', text: 'Answer' })
      expect(screen.getByTestId(PANEL)).toHaveClass(
        'min-w-0',
        'rounded-shape-lg',
        'bg-[var(--surface-1)]',
      )
      expect(screen.getByTestId(PANEL).className).not.toContain('bg-white')
    })

    it('keeps long RTL prose and markup literal with wrapping and paragraph breaks', () => {
      const text = `مرحبا\n\n${'long-source-identifier'.repeat(80)}\n<script>not executable</script>`
      renderPanel({ state: 'done', text })
      const paragraph = screen.getByTestId(PANEL).querySelector('p')
      expect(paragraph).toHaveClass('whitespace-pre-wrap', 'break-words')
      expect(paragraph?.textContent).toBe(text)
      expect(screen.getByTestId(PANEL).querySelector('script')).toBeNull()
    })

    it('keeps error semantics and long messages using the theme danger role', () => {
      const error = 'source-unavailable'.repeat(80)
      renderPanel({ state: 'error', error })
      const alert = screen.getByRole('alert')
      expect(alert).toHaveClass('text-[var(--semantic-danger)]')
      expect(alert).toHaveTextContent(error)
      expect(alert.querySelector('span')).toHaveClass('min-w-0', 'break-words')
      expect(alert.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    })

    it('preserves evidence-only paused streams and clears them on a caller scope reset', () => {
      const { rerender } = renderPanel({
        state: 'paused-confirm',
        activity: [{ id: 'reading', name: 'query_battery_status', status: 'running' }],
      })
      expect(screen.getByTestId('helix-evidence-trail')).toHaveTextContent('Battery status')
      expect(screen.getByTestId(PANEL)).toHaveTextContent('No output was generated.')
      rerender(<AiOutputPanel text="" state="idle" error={null} />)
      expect(screen.queryByTestId(PANEL)).toBeNull()
      expect(screen.queryByTestId('helix-evidence-trail')).toBeNull()
    })
  })

  describe('known transport error recovery', () => {
    it.each([
      'stream_no_body',
      'stream_incomplete',
      'stream_http_400',
      'stream_http_404',
      'stream_http_408',
      'stream_http_500',
      'stream_http_502',
      'stream_http_503',
      'stream_http_504',
    ])('explains recovery for %s while retaining literal diagnostics and partial prose', (error) => {
      const text = 'مرحبا\n\n0 <script>literal</script>'
      renderPanel({ state: 'error', error, text })
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('Helix temporarily unavailable')
      expect(alert).toHaveTextContent('Please try again.')
      expect(alert).toHaveTextContent('The non-Helix baseline continues to work.')
      expect(alert.querySelector('code')?.textContent).toBe(error)
      const prose = screen.getByTestId(PANEL).querySelectorAll('p')[1]
      expect(prose.textContent).toBe(text)
      expect(prose).toHaveClass('whitespace-pre-wrap', 'break-words')
      expect(alert.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.queryByTestId(THINKING)).toBeNull()
      expect(screen.queryByText(/offline|successful|verified|last success|updated|no output/i)).toBeNull()
      expect(screen.getByTestId(PANEL).querySelector('script')).toBeNull()
    })

    it.each([
      ['stream_http_401', 'Sign in required', 'Sign in'],
      ['stream_http_403', 'Permission denied', 'Your account does not have permission'],
      ['stream_http_429', 'Helix temporarily unavailable', 'Wait before retrying.'],
    ])('gives accurate recovery for %s without inventing an expired session or provider outage', (error, title, nextStep) => {
      renderPanel({ state: 'error', error })
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(title)
      expect(alert).toHaveTextContent(nextStep)
      expect(alert).toHaveTextContent('The non-Helix baseline continues to work.')
      expect(alert.querySelector('code')?.textContent).toBe(error)
      expect(alert).not.toHaveTextContent(/offline|session has expired|provider|automatically/)
    })

    it.each([
      'Failed to fetch',
      'provider_unavailable',
      'unknown_future_code',
      'stream_http_999',
      'stream_http_404: extra diagnostic',
      ' stream_incomplete ',
      'toString',
      '',
    ])('keeps unknown error %j verbatim without inferring offline or a known-code recovery', (error) => {
      renderPanel({ state: 'error', error })
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toBe(`Helix error: ${error}`)
      expect(alert.querySelector('code')).toBeNull()
      expect(alert).not.toHaveTextContent(/offline|temporarily unavailable|try again|provider is not responding/i)
      expect(screen.getByTestId(PANEL).querySelectorAll('p')).toHaveLength(1)
    })

    it('uses translated canonical recovery keys and leaves the technical code untranslated', async () => {
      const instance = createInstance()
      await instance.init({
        lng: 'fr',
        fallbackLng: false,
        resources: {
          fr: {
            translation: {
              helix: { errorLabel: 'Erreur Helix :' },
              ai: {
                limit: {
                  title: { generic: 'Helix temporairement indisponible' },
                  desc: { generic: 'La méthode sans Helix reste disponible.' },
                },
              },
              errorBoundary: { body: 'Veuillez réessayer.' },
            },
          },
        },
      })
      const translation = vi.spyOn(reactI18next, 'useTranslation').mockImplementation(() => {
        const result: [typeof instance.t, typeof instance, boolean] = [instance.t, instance, true]
        return Object.assign(result, { t: instance.t, i18n: instance, ready: true })
      })
      try {
        renderPanel({ state: 'error', error: 'stream_incomplete', text: 'texte conservé' })
        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent('Erreur Helix :')
        expect(alert).toHaveTextContent('Helix temporairement indisponible')
        expect(alert).toHaveTextContent('Veuillez réessayer.')
        expect(alert).toHaveTextContent('La méthode sans Helix reste disponible.')
        expect(alert.querySelector('code')?.textContent).toBe('stream_incomplete')
        expect(alert).not.toHaveTextContent(/temporarily unavailable|Please try again|non-Helix baseline/)
        expect(screen.getByText('texte conservé')).toBeVisible()
      } finally {
        translation.mockRestore()
      }
    })

    it('keeps the caller manual baseline, actions and re-draft available across a known failure and retained phases', () => {
      const start = vi.fn()
      const copy = vi.fn()
      const apply = vi.fn()
      const manualDraft = '{"title":"manual baseline","value":0}'
      const stream: AIFeatureStream = {
        state: 'error', text: 'partial draft', error: 'stream_http_404', start,
      }
      const card = (current: AIFeatureStream) => (
        <>
          <Textarea aria-label="Manual JSON editor" defaultValue={manualDraft} />
          <Button onClick={copy}>Copy manual draft</Button>
          <AIFeatureCard title="Dashboard" description="Source context" buttonLabel="Draft dashboard" canStart stream={current}>
            <Button onClick={apply}>Apply retained proposal</Button>
          </AIFeatureCard>
        </>
      )
      const { rerender } = render(card(stream))
      expect(screen.getByRole('textbox', { name: 'Manual JSON editor' })).toHaveValue(manualDraft)
      fireEvent.click(screen.getByRole('button', { name: 'Copy manual draft' }))
      fireEvent.click(screen.getByRole('button', { name: 'Apply retained proposal' }))
      fireEvent.click(screen.getByRole('button', { name: /Draft dashboard/ }))
      expect(copy).toHaveBeenCalledTimes(1)
      expect(apply).toHaveBeenCalledTimes(1)
      expect(start).toHaveBeenCalledTimes(1)
      expect(screen.getByText('partial draft')).toBeVisible()
      for (const state of ['idle', 'paused-confirm', 'streaming', 'done'] as const) {
        rerender(card({ ...stream, state }))
        expect(screen.queryByRole('alert')).toBeNull()
        expect(screen.getByText('partial draft')).toBeVisible()
        expect(screen.getByRole('textbox', { name: 'Manual JSON editor' })).toHaveValue(manualDraft)
        expect(screen.getByRole('button', { name: /Draft dashboard/ }).hasAttribute('disabled')).toBe(state === 'streaming')
      }
    })
  })
})
