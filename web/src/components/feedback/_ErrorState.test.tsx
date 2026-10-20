import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertCircle, Server, WifiOff } from 'lucide-react'
import { ErrorState } from './_ErrorState'

/**
 * ErrorState primitive contract.
 *
 * ErrorState is the shared "icon + title + message + action" card that
 * backs both {@link QueryError} and {@link ErrorDisplay}. It owns the
 * accessibility semantics (role + live-region politeness), the compact
 * variant, and the passthrough className — so those are what we pin here
 * rather than any single failure copy.
 */
describe('ErrorState', () => {
  it('renders the title, the message, and marks the icon decorative', () => {
    const { container } = render(
      <ErrorState
        Icon={Server}
        title="Server error"
        message="Something went wrong on our end."
      />,
    )

    expect(screen.getByText('Server error')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong on our end.')).toBeInTheDocument()

    // The icon carries no semantic meaning (the title does), so it must be
    // hidden from assistive tech rather than announced as an unlabelled graphic.
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('defaults to an assertive alert live region', () => {
    render(<ErrorState Icon={AlertCircle} title="Cannot reach server" message="Try again." />)

    const region = screen.getByRole('alert')
    expect(region).toHaveAttribute('aria-live', 'assertive')
    // A default (blocking) error is not a polite status region.
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('derives aria-live="polite" from role="status" when ariaLive is omitted', () => {
    render(
      <ErrorState
        Icon={WifiOff}
        role="status"
        title="You're offline"
        message="We'll retry automatically when your connection returns."
      />,
    )

    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    // A non-blocking status surface must not announce assertively.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('honours an explicit ariaLive that overrides the role-derived default', () => {
    render(
      <ErrorState
        Icon={WifiOff}
        role="status"
        ariaLive="assertive"
        title="You're offline"
        message="Connection lost."
      />,
    )

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'assertive')
  })

  it('renders the action node and wires its click handler', () => {
    const onRetry = vi.fn()
    render(
      <ErrorState
        Icon={Server}
        title="Server error"
        message="Please try again."
        action={
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        }
      />,
    )

    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toBeInTheDocument()

    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('omits the action slot entirely when no action is provided', () => {
    render(<ErrorState Icon={AlertCircle} title="Cannot reach server" message="Try again." />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('applies tighter padding and a smaller icon in the compact variant', () => {
    const { container } = render(
      <ErrorState Icon={AlertCircle} title="Save failed" message="Inline error." compact />,
    )

    const region = screen.getByRole('alert')
    expect(region).toHaveClass('p-3', 'mb-3')
    expect(region).not.toHaveClass('p-4')

    // Compact swaps the 16px icon for the 14px one.
    expect(container.querySelector('svg')).toHaveClass('h-3.5', 'w-3.5')
  })

  it('uses roomier padding and a full-size icon by default (non-compact)', () => {
    const { container } = render(
      <ErrorState Icon={AlertCircle} title="Save failed" message="Something went wrong." />,
    )

    const region = screen.getByRole('alert')
    expect(region).toHaveClass('p-4', 'mb-6')
    expect(region).not.toHaveClass('p-3')
    expect(container.querySelector('svg')).toHaveClass('h-4', 'w-4')
  })

  it('merges a caller-supplied className onto the container', () => {
    render(
      <ErrorState
        Icon={AlertCircle}
        title="Server error"
        message="Boom."
        className="mt-8 max-w-md"
      />,
    )

    const region = screen.getByRole('alert')
    expect(region).toHaveClass('mt-8', 'max-w-md')
    // Base chrome is preserved alongside the override.
    expect(region).toHaveClass('rounded-panel')
  })

  it.each([
    ['danger', 'border-[var(--semantic-danger-border)]', 'bg-[var(--semantic-danger-bg)]'],
    ['warning', 'border-[var(--semantic-warning-border)]', 'bg-[var(--semantic-warning-bg)]'],
    ['info', 'border-[var(--semantic-info-border)]', 'bg-[var(--semantic-info-bg)]'],
    ['neutral', 'border-[var(--border-default)]', 'bg-[var(--surface-2)]'],
  ] as const)('applies the %s semantic tone', (tone, borderClass, backgroundClass) => {
    render(
      <ErrorState
        Icon={AlertCircle}
        title={`${tone} state`}
        message="Distinct semantic treatment."
        tone={tone}
      />,
    )

    expect(screen.getByRole('alert')).toHaveClass(borderClass, backgroundClass)
  })

  it('keeps long copy readable and lets the action wrap below it on mobile', () => {
    const title = 'A long localized title '.repeat(8)
    const message = 'UnbrokenIdentifier'.repeat(20)
    render(
      <ErrorState
        Icon={Server}
        title={title}
        message={message}
        action={<button type="button">Retry this unusually long localized request</button>}
      />,
    )

    expect(screen.getByText(title.trim())).toHaveClass('text-sm', 'text-[var(--text-primary)]')
    expect(screen.getByText(message)).toHaveClass('text-sm', 'text-[var(--text-secondary)]')
    expect(screen.getByText(message).parentElement).toHaveClass('min-w-0', 'break-words')
    expect(screen.getByRole('button').parentElement).toHaveClass(
      'w-full',
      'md:w-auto',
      '[&_button]:min-h-11',
      '[&_button]:min-w-11',
      '[&_button]:whitespace-normal',
    )
    expect(screen.getByRole('alert')).not.toHaveClass('backdrop-blur-sm', 'overflow-hidden')
  })

  it('preserves caller footer disclosure and focusable help without adding live regions', () => {
    render(
      <ErrorState
        Icon={Server}
        title="Server error"
        message="Try again."
        footer={
          <details>
            <summary>Technical details</summary>
            <a href="/help">Help with this error</a>
          </details>
        }
      />,
    )

    const summary = screen.getByText('Technical details')
    fireEvent.click(summary)
    expect(summary.closest('details')).toBeInTheDocument()
    const help = screen.getByRole('link', { name: 'Help with this error' })
    expect(help).toHaveAttribute('href', '/help')
    help.focus()
    expect(help).toHaveFocus()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('retains disabled retry semantics and never invokes its callback', () => {
    const onRetry = vi.fn()
    render(
      <ErrorState
        Icon={WifiOff}
        role="status"
        tone="warning"
        title="Offline"
        message="Retry when online."
        action={<button type="button" disabled onClick={onRetry}>Retry when online</button>}
      />,
    )

    const retry = screen.getByRole('button', { name: 'Retry when online' })
    expect(retry).toBeDisabled()
    fireEvent.click(retry)
    expect(onRetry).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })
})
