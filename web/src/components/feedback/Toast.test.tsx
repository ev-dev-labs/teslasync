import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToastProvider, useToast } from './Toast'

// Mock framer-motion to render children immediately without animations
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...filterDomProps(props)}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
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

function _ToastTriggerWithDuration({ duration }: { duration: number }) {
  const toast = useToast()
  return (
    <button onClick={() => toast.toast({ type: 'info', title: 'timed', duration })}>
      fire
    </button>
  )
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

  it('can be manually dismissed via the close button', () => {
    const { container } = renderWithProvider(<ToastTrigger type="info" title="Dismiss me" />)
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
  })

  it('throws when useToast is used outside ToastProvider', () => {
    function Orphan() {
      useToast()
      return null
    }
    // Suppress error boundary noise
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Orphan />)).toThrow('useToast must be used within ToastProvider')
    vi.restoreAllMocks()
  })
})
