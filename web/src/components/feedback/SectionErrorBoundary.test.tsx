import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import { SectionErrorBoundary } from './SectionErrorBoundary'

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Section explosion')
  return <div>Section OK</div>
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('SectionErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SectionErrorBoundary name="test">
          <div>Section content</div>
        </SectionErrorBoundary>
      </I18nextProvider>,
    )
    expect(screen.getByText('Section content')).toBeInTheDocument()
  })

  it('falls back to inline UI by default and shows Retry', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SectionErrorBoundary name="test">
          <ThrowingComponent shouldThrow />
        </SectionErrorBoundary>
      </I18nextProvider>,
    )
    expect(screen.queryByText('Section OK')).not.toBeInTheDocument()
    // Underlying ErrorBoundary inline mode
    expect(screen.getByText('Component failed to load')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('uses fallbackTitle when provided', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SectionErrorBoundary name="test" fallbackTitle="Custom title">
          <ThrowingComponent shouldThrow />
        </SectionErrorBoundary>
      </I18nextProvider>,
    )
    expect(screen.getByText('Custom title')).toBeInTheDocument()
    expect(screen.getByText(/other parts of the page should still work/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('renders custom fallback node when provided', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SectionErrorBoundary
          name="test"
          fallback={<div data-testid="custom">Custom fallback</div>}
        >
          <ThrowingComponent shouldThrow />
        </SectionErrorBoundary>
      </I18nextProvider>,
    )
    expect(screen.getByTestId('custom')).toBeInTheDocument()
    expect(screen.queryByText('Component failed to load')).not.toBeInTheDocument()
  })

  it('isolates failures — sibling renders normally', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <div>
          <SectionErrorBoundary name="left">
            <ThrowingComponent shouldThrow />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="right">
            <div>Sibling OK</div>
          </SectionErrorBoundary>
        </div>
      </I18nextProvider>,
    )
    // The thrown sibling shows the inline fallback
    expect(screen.getByText('Component failed to load')).toBeInTheDocument()
    // The healthy sibling continues to render
    expect(screen.getByText('Sibling OK')).toBeInTheDocument()
  })
})
