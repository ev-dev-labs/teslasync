/**
 * TotpEnrollModal contract.
 *
 * A presentational dialog: the page/flow hands down the enrollment payload,
 * the controlled code value, the verify state and the three intents
 * (change / verify / close). The modal owns a handful of behaviours worth
 * pinning:
 *
 *   1. Visibility — nothing renders when closed, and nothing renders when
 *      `enrollment` is null even if `open` is true (double guard).
 *   2. Content — QR image (src + alt), manual secret, copy affordance, the
 *      6-digit input and both action buttons all render for a real payload.
 *   3. Interactions — typing raises onCodeChange with the raw value; clicking
 *      Verify raises onVerify; Cancel and the header Close both raise onClose;
 *      Enter in the input submits (keyboard operability) — but not mid-verify.
 *   4. Error surface — a non-empty error renders a role="alert"; the empty
 *      string does NOT render an empty alert (harden point).
 *   5. Verifying — the input, Cancel and Verify are disabled and Verify is
 *      marked aria-busy so AT users hear the pending state.
 *   6. Clipboard — the Copy button writes the secret to navigator.clipboard.
 *   7. a11y — the input is label-associated and the QR carries alt text.
 *
 * react-i18next is stubbed so `t(key, default)` falls back to the default
 * string, matching every other component test here. `@testing-library/user-event`
 * is not installed in this repo, so `fireEvent` drives interactions. No network
 * is touched — the component is pure props-in, DOM-out.
 */
import '@testing-library/jest-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { ComponentProps } from 'react'

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
  }
})

import { TotpEnrollModal } from './TotpEnrollModal'
import TotpEnrollModalDefault from './TotpEnrollModal'
import type { TOTPEnrollment } from '@/api/types'

type Props = ComponentProps<typeof TotpEnrollModal>

const SECRET = 'JBSWY3DPEHPK3PXP'
const QR = 'data:image/png;base64,iVBORw0KGgo='

function makeEnrollment(overrides: Partial<TOTPEnrollment> = {}): TOTPEnrollment {
  return {
    secret: SECRET,
    otpauth_uri: `otpauth://totp/TeslaSync:alice?secret=${SECRET}&issuer=TeslaSync`,
    qr_data_uri: QR,
    backup_codes: ['AAAA-AAAA', 'BBBB-BBBB'],
    expires_at: new Date('2030-01-01T00:00:00Z').toISOString(),
    ...overrides,
  }
}

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    open: true,
    enrollment: makeEnrollment(),
    code: '',
    error: null,
    verifying: false,
    onCodeChange: vi.fn(),
    onVerify: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

function renderModal(overrides: Partial<Props> = {}) {
  const props = makeProps(overrides)
  return { props, ...render(<TotpEnrollModal {...props} />) }
}

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TotpEnrollModal — visibility', () => {
  it('renders nothing when open is false', () => {
    renderModal({ open: false })
    expect(screen.queryByTestId('totp-enroll-modal')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByTestId('totp-qr')).toBeNull()
  })

  it('renders nothing when enrollment is null even if open is true', () => {
    renderModal({ open: true, enrollment: null })
    expect(screen.queryByTestId('totp-enroll-modal')).toBeNull()
    expect(screen.queryByTestId('totp-secret')).toBeNull()
    expect(screen.queryByTestId('totp-verify-input')).toBeNull()
  })
})

describe('TotpEnrollModal — content', () => {
  it('renders the QR, manual secret, input and both actions for a real payload', () => {
    renderModal()

    expect(screen.getByRole('dialog')).toBeInTheDocument()

    const qr = screen.getByTestId('totp-qr')
    expect(qr).toHaveAttribute('src', QR)
    expect(qr).toHaveAttribute('alt', 'TOTP QR code')

    expect(screen.getByTestId('totp-secret')).toHaveTextContent(SECRET)
    expect(screen.getByTestId('totp-verify-input')).toBeInTheDocument()
    expect(screen.getByTestId('totp-verify-submit')).toHaveTextContent('Verify and activate')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('reflects the controlled code value on the input', () => {
    renderModal({ code: '123456' })
    expect(screen.getByTestId('totp-verify-input')).toHaveValue('123456')
  })
})

describe('TotpEnrollModal — interactions', () => {
  it('raises onCodeChange with the raw typed value', () => {
    const onCodeChange = vi.fn()
    renderModal({ onCodeChange })

    fireEvent.change(screen.getByTestId('totp-verify-input'), {
      target: { value: '135790' },
    })
    expect(onCodeChange).toHaveBeenCalledTimes(1)
    expect(onCodeChange).toHaveBeenCalledWith('135790')
  })

  it('raises onVerify when the Verify button is clicked', () => {
    const onVerify = vi.fn()
    renderModal({ onVerify })

    fireEvent.click(screen.getByTestId('totp-verify-submit'))
    expect(onVerify).toHaveBeenCalledTimes(1)
  })

  it('raises onClose from both Cancel and the header Close control', () => {
    const onClose = vi.fn()
    renderModal({ onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('submits on Enter in the code input (keyboard operability)', () => {
    const onVerify = vi.fn()
    renderModal({ onVerify })

    fireEvent.keyDown(screen.getByTestId('totp-verify-input'), { key: 'Enter' })
    expect(onVerify).toHaveBeenCalledTimes(1)
  })

  it('does not submit on Enter while a verify is in flight', () => {
    const onVerify = vi.fn()
    renderModal({ onVerify, verifying: true })

    fireEvent.keyDown(screen.getByTestId('totp-verify-input'), { key: 'Enter' })
    expect(onVerify).not.toHaveBeenCalled()
  })
})

describe('TotpEnrollModal — error surface', () => {
  it('renders a role="alert" with the message when error is set', () => {
    renderModal({ error: 'Code did not match. Try the next one.' })

    const alert = screen.getByRole('alert')
    expect(alert).toBe(screen.getByTestId('totp-verify-error'))
    expect(alert).toHaveTextContent('Code did not match. Try the next one.')
  })

  it('does not render an empty alert when error is an empty string', () => {
    // Harden point: an empty-string error must not surface a blank
    // role="alert" that assistive tech would announce as an empty region.
    renderModal({ error: '' })
    expect(screen.queryByTestId('totp-verify-error')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('TotpEnrollModal — verifying state', () => {
  it('disables the input, Cancel and Verify and marks Verify busy', () => {
    renderModal({ verifying: true })

    expect(screen.getByTestId('totp-verify-input')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    const submit = screen.getByTestId('totp-verify-submit')
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('aria-busy', 'true')
  })
})

describe('TotpEnrollModal — clipboard + a11y', () => {
  it('copies the secret to the clipboard when Copy is clicked', async () => {
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET))
  })

  it('associates the code input with its label and gives the QR alt text', () => {
    renderModal()

    expect(
      screen.getByLabelText('Enter the 6-digit code from your app'),
    ).toBe(screen.getByTestId('totp-verify-input'))
    expect(screen.getByAltText('TOTP QR code')).toBeInTheDocument()
  })
})

describe('TotpEnrollModal — module surface', () => {
  it('exposes the same component as its default export', () => {
    expect(TotpEnrollModalDefault).toBe(TotpEnrollModal)
  })
})
