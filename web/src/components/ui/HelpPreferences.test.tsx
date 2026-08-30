import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetProductPreferences,
  updateProductPreferences,
} from '@/lib/productPreferences'
import { HelpIcon } from './HelpIcon'
import { HelpTooltip } from './HelpTooltip'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
    ) =>
      typeof fallbackOrOptions === 'string'
        ? fallbackOrOptions
        : typeof fallbackOrOptions?.defaultValue === 'string'
          ? fallbackOrOptions.defaultValue
          : key,
  }),
}))

function HelpSurfaces() {
  return (
    <>
      <HelpIcon content="Field explanation" for="analysis-window" />
      <HelpTooltip text="Metric explanation" />
    </>
  )
}

describe('contextual help preference', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetProductPreferences()
  })

  it('shows contextual explanations by default', () => {
    render(<HelpSurfaces />)
    expect(
      screen.getByRole('button', { name: 'Help for analysis-window' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'More info' }),
    ).toBeInTheDocument()
  })

  it('removes inline help while preserving the surrounding UI', () => {
    render(
      <div>
        <span>Analysis window</span>
        <HelpSurfaces />
      </div>,
    )

    act(() => {
      updateProductPreferences({ contextualHelp: false })
    })

    expect(screen.getByText('Analysis window')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
