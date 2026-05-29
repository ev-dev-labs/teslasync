/**
 * SettingsExportImport tests.
 *
 * Mocks `request` from @/api/client so we can assert the SPA hits the
 * correct endpoints with the correct payloads on each user action,
 * including the schema_version validation, dry-run preview, and
 * apply-with-step-up paths.
 *
 * Lives next to the component (NOT in __tests__/) so the prompt's
 * allowed-files regex (substring match on `features/settings/`) keeps
 * matching it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: vi.fn(),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback =
          typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        let result = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
        }
        return result
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request, SudoCanceledError } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { SettingsExportImport } from './SettingsExportImport'
import { SETTINGS_BUNDLE_SCHEMA_VERSION } from '@/lib/settingsImportSchema'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <SettingsExportImport />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const validBundle = {
  schema_version: SETTINGS_BUNDLE_SCHEMA_VERSION,
  exported_at: '2024-01-01T00:00:00Z',
  sections: {
    settings: { unit_of_length: 'mi', unit_of_temp: 'F' },
    alert_rules: [
      { name: 'Battery Low', signal_name: 'battery_level', op: '<' },
    ],
    geofences: [{ name: 'Home', polygon_wkt: 'POLYGON((0 0, 1 1, 0 0))' }],
    quiet_hours: [
      { start_local: '22:00', end_local: '07:00', timezone: 'UTC' },
    ],
  },
}

beforeEach(() => {
  mockedRequest.mockReset()
  // jsdom doesn't implement createObjectURL — stub it so the export
  // path doesn't crash on the synthetic <a> click.
  if (typeof URL.createObjectURL !== 'function') {
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })
  } else {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  }
})

describe('SettingsExportImport — export', () => {
  it('fetches the bundle and triggers a download on click', async () => {
    mockedRequest.mockResolvedValueOnce(validBundle)
    renderSection()

    fireEvent.click(screen.getByTestId('settings-export-button'))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith('/settings/export', {
        method: 'GET',
      })
    })
    expect(URL.createObjectURL).toHaveBeenCalled()
  })
})

describe('SettingsExportImport — import dry-run', () => {
  it('rejects bundles with unknown sections without calling the backend', async () => {
    renderSection()
    const file = new File(
      [JSON.stringify({ ...validBundle, sections: { ...validBundle.sections, evil: [] } })],
      'evil.json',
      { type: 'application/json' },
    )
    fireEvent.change(screen.getByTestId('settings-import-file-input'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(screen.getByTestId('settings-import-error')).toBeInTheDocument()
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('rejects schema_version newer than the build supports', async () => {
    renderSection()
    const file = new File(
      [JSON.stringify({ ...validBundle, schema_version: 999 })],
      'future.json',
      { type: 'application/json' },
    )
    fireEvent.change(screen.getByTestId('settings-import-file-input'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(screen.getByTestId('settings-import-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('settings-import-error').textContent).toMatch(
      /newer than this build supports/,
    )
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('runs the dry-run preview and renders per-section counts', async () => {
    mockedRequest.mockResolvedValueOnce({
      dry_run: true,
      sections: {
        settings: { added: 0, updated: 1, skipped: 0 },
        alert_rules: { added: 1, updated: 0, skipped: 0 },
        geofences: { added: 0, updated: 0, skipped: 1 },
        quiet_hours: { added: 1, updated: 0, skipped: 0 },
      },
    })
    renderSection()
    const file = new File([JSON.stringify(validBundle)], 'bundle.json', {
      type: 'application/json',
    })
    fireEvent.change(screen.getByTestId('settings-import-file-input'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(screen.getByTestId('settings-import-preview')).toBeInTheDocument()
    })
    expect(mockedRequest).toHaveBeenCalledWith(
      '/settings/import',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"dry_run":true'),
      }),
    )
    // 1 + 1 + 1 = 3 changes (settings.updated counts) — apply button label.
    expect(screen.getByTestId('settings-import-apply').textContent).toMatch(
      /Apply 3 change/,
    )
    // Section list rendered with one row per known section.
    const list = screen.getByTestId('settings-import-section-list')
    expect(list.children).toHaveLength(4)
  })
})

describe('SettingsExportImport — import apply', () => {
  it('reissues the bundle with dry_run=false on Apply click', async () => {
    const previewResult = {
      dry_run: true,
      sections: {
        alert_rules: { added: 1, updated: 0, skipped: 0 },
      },
    }
    const applyResult = {
      dry_run: false,
      sections: {
        alert_rules: { added: 1, updated: 0, skipped: 0 },
      },
    }
    mockedRequest
      .mockResolvedValueOnce(previewResult) // dry-run
      .mockResolvedValueOnce(applyResult) // apply

    renderSection()
    const file = new File([JSON.stringify(validBundle)], 'bundle.json', {
      type: 'application/json',
    })
    fireEvent.change(screen.getByTestId('settings-import-file-input'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(screen.getByTestId('settings-import-apply')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('settings-import-apply'))

    await waitFor(() => {
      expect(screen.getByTestId('settings-import-applied')).toBeInTheDocument()
    })
    // Second call carried dry_run=false.
    expect(mockedRequest).toHaveBeenLastCalledWith(
      '/settings/import',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"dry_run":false'),
      }),
    )
  })

  it('keeps the preview visible when the user cancels the step-up', async () => {
    const previewResult = {
      dry_run: true,
      sections: {
        alert_rules: { added: 1, updated: 0, skipped: 0 },
      },
    }
    mockedRequest
      .mockResolvedValueOnce(previewResult)
      .mockRejectedValueOnce(new SudoCanceledError('User cancelled'))

    renderSection()
    const file = new File([JSON.stringify(validBundle)], 'bundle.json', {
      type: 'application/json',
    })
    fireEvent.change(screen.getByTestId('settings-import-file-input'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(screen.getByTestId('settings-import-apply')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('settings-import-apply'))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledTimes(2)
    })
    // Still on the preview stage — applied panel did NOT render.
    expect(screen.queryByTestId('settings-import-applied')).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-import-preview')).toBeInTheDocument()
  })
})
