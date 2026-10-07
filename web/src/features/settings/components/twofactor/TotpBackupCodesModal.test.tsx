/**
 * TotpBackupCodesModal contract.
 *
 * The modal is the one-time reveal of TOTP backup codes after enroll /
 * regenerate. It is presentational: the code list, the download handler and
 * the dismissal all arrive as props. These tests pin every observable facet:
 *
 *   1. Visibility gating — hidden when `open` is false, and hidden when
 *      `codes` is null even if `open` is true (the `open && codes != null`
 *      guard).
 *   2. Populated render — title, one-time warning, every code as a semantic
 *      `<code>` element, and the copy / download / done controls.
 *   3. Interactions — copy writes the newline-joined list to the clipboard,
 *      download fires `onDownload` (never `onClose`), the primary button and
 *      the dialog's Close affordance both fire `onClose`, and Esc closes.
 *   4. Empty / degraded path — an empty `codes` array surfaces an actionable
 *      empty state (never a blank grid) with a working dismiss button, and
 *      the copy / download controls are withheld.
 *   5. Duplicate codes render without a key collision.
 *   6. The default export is the same component as the named export.
 *
 * `react-i18next` is stubbed to fall back to the inline English defaults and
 * `navigator.clipboard` is mocked so the CopyButton primitive runs end-to-end
 * without touching a real clipboard.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue
        if (fallback != null) return fallback
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { TotpBackupCodesModal } from './TotpBackupCodesModal'
import TotpBackupCodesModalDefault from './TotpBackupCodesModal'

type Props = ComponentProps<typeof TotpBackupCodesModal>

const CODES = ['AAAA-1111', 'BBBB-2222', 'CCCC-3333']

const writeText = vi.fn(() => Promise.resolve())

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

function setup(overrides: Partial<Props> = {}) {
  const onDownload = vi.fn()
  const onClose = vi.fn()
  const props: Props = {
    open: true,
    codes: CODES,
    onDownload,
    onClose,
    ...overrides,
  }
  const utils = render(<TotpBackupCodesModal {...props} />)
  return { onDownload, onClose, ...utils }
}

describe('TotpBackupCodesModal — visibility gating', () => {
  it('renders nothing when open is false', () => {
    setup({ open: false })
    expect(screen.queryByTestId('totp-backup-modal')).toBeNull()
    expect(screen.queryByText(/will not be shown again/i)).toBeNull()
  })

  it('stays hidden when codes is null even if open is true', () => {
    setup({ open: true, codes: null })
    expect(screen.queryByTestId('totp-backup-modal')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('TotpBackupCodesModal — populated render', () => {
  it('shows the title, one-time warning and every code as a semantic <code>', () => {
    setup()

    expect(screen.getByTestId('totp-backup-modal')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Save your backup codes')).toBeInTheDocument()
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument()

    const list = screen.getByTestId('totp-backup-list')
    expect(list.querySelectorAll('li')).toHaveLength(CODES.length)
    expect(list.querySelectorAll('code')).toHaveLength(CODES.length)
    for (const code of CODES) {
      expect(screen.getByText(code)).toBeInTheDocument()
    }
  })

  it('exposes labelled copy, download and done controls', () => {
    setup()
    // Icon-only Download button carries a visible text label for a11y.
    expect(screen.getByTestId('totp-backup-download')).toHaveTextContent('Download .txt')
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByTestId('totp-backup-done')).toHaveTextContent('I saved them')
  })
})

describe('TotpBackupCodesModal — interactions', () => {
  it('copies the newline-joined codes to the clipboard', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('AAAA-1111\nBBBB-2222\nCCCC-3333')
    })
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('fires onDownload (and not onClose) from the download button', () => {
    const { onDownload, onClose } = setup()
    fireEvent.click(screen.getByTestId('totp-backup-download'))
    expect(onDownload).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('fires onClose from the primary "I saved them" button', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByTestId('totp-backup-done'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fires onClose from the dialog Close (X) affordance', () => {
    const { onClose } = setup()
    const closeBtn = screen.getByRole('button', { name: 'Close' })
    expect(closeBtn).toBeInTheDocument()
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fires onClose when Escape is pressed (keyboard operability)', () => {
    const { onClose } = setup()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('TotpBackupCodesModal — empty / degraded path', () => {
  it('shows an actionable empty state instead of a blank grid when codes is empty', () => {
    const { onClose } = setup({ codes: [] })

    // Modal still opens because [] != null, but no code grid / copy / download.
    expect(screen.getByTestId('totp-backup-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('totp-backup-list')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
    expect(screen.queryByTestId('totp-backup-download')).toBeNull()

    const empty = screen.getByTestId('totp-backup-empty')
    expect(empty).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/No backup codes were returned/i)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('totp-backup-dismiss'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('TotpBackupCodesModal — resilience & exports', () => {
  it('renders duplicate codes without collapsing the list (key collision safe)', () => {
    setup({ codes: ['DUP-0000', 'DUP-0000', 'UNIQ-9999'] })
    const list = screen.getByTestId('totp-backup-list')
    expect(list.querySelectorAll('li')).toHaveLength(3)
    expect(screen.getAllByText('DUP-0000')).toHaveLength(2)
  })

  it('exposes the same component via the default export', () => {
    expect(TotpBackupCodesModalDefault).toBe(TotpBackupCodesModal)
    render(
      <TotpBackupCodesModalDefault open codes={CODES} onDownload={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByTestId('totp-backup-modal')).toBeInTheDocument()
  })
})
