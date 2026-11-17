import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider, useToast, type ToastAction } from './Toast'

// Mock framer-motion to render children immediately without animations
vi.mock('framer-motion', () => ({
  m: {
    div: ({ children, ...props }: any) => <div {...filterDomProps(props)}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  // Toast.tsx now consumes `useReducedMotion` indirectly via `useMotionPreference`.
  // Default to motion enabled in tests; reduced-motion behaviour is covered by
  // the dedicated useMotionPreference test.
  useReducedMotion: () => false,
}))

// Filter out non-DOM props from framer-motion
function filterDomProps(props: Record<string, any>) {
  const { layout: _l, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props
  return rest
}

// Helper component that triggers toasts via the hook
function ToastTrigger({ type, title, message, duration: _duration }: {
  type: 'success' | 'error' | 'info' | 'warning'
  title: string
  message?: string
  duration?: number
}) {
  const toast = useToast()
  return (
    <button onClick={() => toast[type](title, message)}>
      fire
    </button>
  )
}

function ToastTriggerWithDuration({ duration, action }: { duration: number; action?: ToastAction }) {
  const toast = useToast()
  return (
    <button onClick={() => toast.toast({ type: 'info', title: 'timed', duration, action })}>
      fire
    </button>
  )
}

function ToastOnMount() {
  const { toast } = useToast()
  useEffect(() => {
    toast({ type: 'info', title: 'Mount feedback', duration: 2000 })
  }, [toast])
  return null
}

const renderWithProvider = (ui: React.ReactElement) =>
  render(<ToastProvider>{ui}</ToastProvider>)

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a toast message after trigger', () => {
    renderWithProvider(<ToastTrigger type="success" title="Saved!" />)
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Saved!')).toBeInTheDocument()
  })

  it('renders a success toast', () => {
    renderWithProvider(<ToastTrigger type="success" title="Success toast" />)
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Success toast')).toBeInTheDocument()
  })

  it('renders an error toast', () => {
    renderWithProvider(<ToastTrigger type="error" title="Error toast" />)
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Error toast')).toBeInTheDocument()
  })

  it('renders an info toast', () => {
    renderWithProvider(<ToastTrigger type="info" title="Info toast" />)
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Info toast')).toBeInTheDocument()
  })

  it('renders a warning toast', () => {
    renderWithProvider(<ToastTrigger type="warning" title="Warning toast" />)
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Warning toast')).toBeInTheDocument()
  })

  it('shows optional message body', () => {
    renderWithProvider(<ToastTrigger type="info" title="Title" message="Extra detail" />)
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Extra detail')).toBeInTheDocument()
  })

  it('auto-dismisses after the default duration (4 s)', () => {
    renderWithProvider(<ToastTrigger type="success" title="Bye soon" />)
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Bye soon')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(4500) })
    expect(screen.queryByText('Bye soon')).not.toBeInTheDocument()
  })

  it('cancels pending dismissal timers when its provider unmounts', () => {
    const view = renderWithProvider(<ToastTriggerWithDuration duration={60_000} />)
    const initialTimers = vi.getTimerCount()
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('timed')).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(initialTimers + 1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(initialTimers)
    act(() => { vi.advanceTimersByTime(60_001) })
  })

  it('does not extend older toast lifetimes when another toast arrives', () => {
    renderWithProvider(<ToastTrigger type="info" title="First" />)
    fireEvent.click(screen.getByText('fire'))
    act(() => { vi.advanceTimersByTime(2000) })
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getAllByText('First')).toHaveLength(2)
    act(() => { vi.advanceTimersByTime(2001) })
    expect(screen.getAllByText('First')).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.queryByText('First')).not.toBeInTheDocument()
  })

  it('keeps dismissal deadlines through StrictMode effect replay', () => {
    render(<StrictMode><ToastProvider><ToastOnMount /></ToastProvider></StrictMode>)
    expect(screen.getAllByText('Mount feedback')).toHaveLength(2)
    act(() => { vi.advanceTimersByTime(2001) })
    expect(screen.queryByText('Mount feedback')).not.toBeInTheDocument()
  })

  it('does not schedule a dismissal for persistent toasts', () => {
    renderWithProvider(<ToastTriggerWithDuration duration={0} />)
    const initialTimers = vi.getTimerCount()
    fireEvent.click(screen.getByText('fire'))
    expect(vi.getTimerCount()).toBe(initialTimers)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('timed')).toBeInTheDocument()
  })

  it('cancels the timer for a toast evicted by the five-toast limit', () => {
    renderWithProvider(<ToastTrigger type="info" title="Recent" />)
    const initialTimers = vi.getTimerCount()
    for (let index = 0; index < 6; index += 1) fireEvent.click(screen.getByText('fire'))
    expect(screen.getAllByText('Recent')).toHaveLength(5)
    expect(vi.getTimerCount()).toBe(initialTimers + 5)
  })

  it('can be manually dismissed via the close button', () => {
    const { container } = renderWithProvider(<ToastTrigger type="info" title="Dismiss me" />)
    const initialTimers = vi.getTimerCount()
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Dismiss me')).toBeInTheDocument()

    // The X close button
    const _closeBtn = container.querySelector('button:not(:first-child)')
    // Find the close button inside the toast (not the trigger button)
    const allButtons = container.querySelectorAll('button')
    const dismissBtn = Array.from(allButtons).find(b => b !== screen.getByText('fire'))
    expect(dismissBtn).toBeTruthy()
    fireEvent.click(dismissBtn!)
    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(initialTimers)
  })

  it('keeps callback and dismissal controls keyboard operable without default button chrome', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    const callback = vi.fn(() => {
      expect(screen.getByText('timed')).toBeInTheDocument()
    })
    renderWithProvider(
      <ToastTriggerWithDuration duration={0} action={{ label: 'Undo save', onClick: callback }} />,
    )
    await user.click(screen.getByRole('button', { name: 'fire' }))

    const action = screen.getByRole('button', { name: 'Undo save' })
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' })
    expect(action).toHaveAttribute('data-app-part', 'button feedback-actions')
    expect(action).toHaveAttribute('type', 'button')
    expect(action).toHaveClass('h-auto', 'p-0', 'hover:bg-transparent')
    expect(action).not.toHaveClass('h-9', 'px-3')
    expect(action).not.toBeDisabled()
    expect(action).not.toHaveAttribute('aria-busy')
    expect(dismiss).toHaveAttribute('data-app-part', 'button feedback-dismiss')
    expect(dismiss).toHaveClass('h-auto', 'p-1.5', 'rounded-lg')
    expect(dismiss).not.toHaveClass('h-9', 'px-3')
    expect(dismiss).not.toHaveAttribute('type')

    await user.tab()
    expect(action).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(callback).toHaveBeenCalledOnce()
    expect(screen.queryByText('timed')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'fire' }))
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toHaveFocus()
    await user.keyboard(' ')
    expect(callback).toHaveBeenCalledOnce()
    expect(screen.queryByText('timed')).not.toBeInTheDocument()
  })

  it('retains navigation precedence over callback actions', () => {
    const callback = vi.fn()
    render(
      <MemoryRouter>
        <ToastProvider>
          <ToastTriggerWithDuration
            duration={0}
            action={{ label: 'Review saved data', to: '/saved?source=toast', onClick: callback }}
          />
        </ToastProvider>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'fire' }))
    const link = screen.getByRole('link', { name: 'Review saved data →' })
    expect(link).toHaveAttribute('href', '/saved?source=toast')
    expect(screen.queryByRole('button', { name: 'Review saved data' })).not.toBeInTheDocument()
    fireEvent.click(link)
    expect(callback).not.toHaveBeenCalled()
    expect(screen.queryByText('timed')).not.toBeInTheDocument()
  })

  it('falls back to a no-op toast API outside ToastProvider in tests', () => {
    function Orphan() {
      const api = useToast()
      api.success('silent')
      return <span>orphan-ok</span>
    }
    expect(() => render(<Orphan />)).not.toThrow()
    expect(screen.getByText('orphan-ok')).toBeInTheDocument()
  })
})
