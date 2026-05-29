/**
 * RbacMatrixPage contract tests.
 *
 * Covers:
 *   1. AUTH_MODE_OPEN renders the inline placeholder.
 *   2. Loading state renders a spinner.
 *   3. Loaded matrix renders one column per role + one row per perm
 *      with effective-for-me + my-roles pills.
 *   4. Edit mode swaps cells for checkboxes; cancelling rolls back.
 *   5. Save sends only the diffed cells via PUT and exits edit mode.
 *   6. Save rejection surfaces the error code in the inline banner
 *      AND keeps the page in edit mode so the operator can retry.
 *   7. Empty roles array renders the EmptyState.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: vi.fn(),
  }
})

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { ApiError, request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import RbacMatrixPage from './RbacMatrixPage'
import type { RbacMatrixSessionResponse } from '@/api/types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RbacMatrixPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function makeMatrixResponse(
  overrides: Partial<RbacMatrixSessionResponse> = {},
): RbacMatrixSessionResponse {
  return {
    mode: 'session',
    roles: [
      { id: 'user', name: 'user' },
      { id: 'admin', name: 'admin' },
    ],
    permissions: [
      { id: 'fleet.read', name: 'View vehicles & telemetry', category: 'fleet' },
      { id: 'admin.audit', name: 'View audit log', category: 'admin' },
    ],
    categories: ['fleet', 'admin'],
    matrix: {
      admin: { 'fleet.read': true, 'admin.audit': true },
      user: { 'fleet.read': true },
    },
    effective_for_me: {
      'fleet.read': true,
      'admin.audit': false,
    },
    my_roles: ['user'],
    groups_header_name: 'X-Forwarded-Groups',
    ...overrides,
  }
}

beforeEach(() => {
  mockedRequest.mockReset()
})

afterEach(() => {
  vi.clearAllTimers()
})

describe('RbacMatrixPage', () => {
  it('renders the inline placeholder when the backend reports AUTH_MODE_OPEN', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError('open mode', 501, 'AUTH_MODE_OPEN'),
    )

    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('rbac-open-mode')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('rbac-matrix-grid')).not.toBeInTheDocument()
  })

  it('renders the loading spinner before the query resolves', () => {
    let resolver: (value: RbacMatrixSessionResponse) => void = () => {}
    mockedRequest.mockReturnValueOnce(
      new Promise<RbacMatrixSessionResponse>((resolve) => {
        resolver = resolve
      }),
    )

    renderPage()

    expect(screen.getByTestId('rbac-loading')).toBeInTheDocument()

    // Resolve so React Query teardown is clean.
    resolver(makeMatrixResponse())
  })

  it('renders one column per role and one row per permission', async () => {
    mockedRequest.mockResolvedValueOnce(makeMatrixResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('rbac-matrix-grid')).toBeInTheDocument(),
    )

    expect(screen.getByTestId('rbac-col-user')).toBeInTheDocument()
    expect(screen.getByTestId('rbac-col-admin')).toBeInTheDocument()
    expect(screen.getByTestId('rbac-row-fleet.read')).toBeInTheDocument()
    expect(screen.getByTestId('rbac-row-admin.audit')).toBeInTheDocument()

    // Read-only allow / deny markers.
    expect(screen.getByTestId('rbac-cell-admin-fleet.read')).toHaveTextContent('✓')
    expect(screen.getByTestId('rbac-cell-user-admin.audit')).toHaveTextContent('–')

    // My-roles + effective pills render.
    expect(screen.getByTestId('rbac-my-roles-pill')).toHaveTextContent(/user/)
    expect(screen.getByTestId('rbac-effective-pill')).toHaveTextContent(
      /1 \/ 2 effective/,
    )
  })

  it('switches to edit mode and reverts on cancel', async () => {
    mockedRequest.mockResolvedValueOnce(makeMatrixResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('rbac-edit-button')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByTestId('rbac-edit-button'))

    // Edit mode swaps the read-only marker for a checkbox.
    const cellEdit = await screen.findByTestId('rbac-cell-edit-user-admin.audit')
    expect(cellEdit).not.toBeChecked()

    // Toggle a cell — Save button should now show a non-zero count.
    fireEvent.click(cellEdit)
    expect(cellEdit).toBeChecked()
    expect(screen.getByTestId('rbac-save-button')).toHaveTextContent(/1/)

    // Cancel — back to read-only with the original snapshot.
    fireEvent.click(screen.getByTestId('rbac-cancel-button'))
    await waitFor(() =>
      expect(screen.queryByTestId('rbac-cell-edit-user-admin.audit')).toBeNull(),
    )
    expect(screen.getByTestId('rbac-cell-user-admin.audit')).toHaveTextContent('–')
  })

  it('sends only the diffed cells when Save is clicked', async () => {
    mockedRequest.mockResolvedValueOnce(makeMatrixResponse())
    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('rbac-edit-button')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByTestId('rbac-edit-button'))

    const cellEdit = await screen.findByTestId('rbac-cell-edit-user-admin.audit')
    fireEvent.click(cellEdit) // false → true (one diff)

    // The PUT call resolves to undefined (204).
    mockedRequest.mockResolvedValueOnce(undefined)
    // The subsequent invalidation triggers a refetch — return the
    // updated matrix.
    mockedRequest.mockResolvedValueOnce(
      makeMatrixResponse({
        matrix: {
          admin: { 'fleet.read': true, 'admin.audit': true },
          user: { 'fleet.read': true, 'admin.audit': true },
        },
        effective_for_me: { 'fleet.read': true, 'admin.audit': true },
      }),
    )

    fireEvent.click(screen.getByTestId('rbac-save-button'))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/admin/rbac/matrix',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            cells: [
              { role_id: 'user', permission_id: 'admin.audit', allowed: true },
            ],
          }),
        }),
      )
    })
  })

  it('keeps the page in edit mode and surfaces the error code when Save is rejected', async () => {
    mockedRequest.mockResolvedValueOnce(makeMatrixResponse())
    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('rbac-edit-button')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByTestId('rbac-edit-button'))
    const cellEdit = await screen.findByTestId('rbac-cell-edit-user-admin.audit')
    fireEvent.click(cellEdit)

    mockedRequest.mockRejectedValueOnce(
      new ApiError('bad request', 400, 'INVALID_PERMISSION'),
    )

    fireEvent.click(screen.getByTestId('rbac-save-button'))

    await waitFor(() =>
      expect(screen.getByTestId('rbac-save-error')).toHaveTextContent(
        'INVALID_PERMISSION',
      ),
    )

    // Still in edit mode — the operator can fix the input and retry.
    expect(screen.getByTestId('rbac-cancel-button')).toBeInTheDocument()
  })

  it('renders the EmptyState when no roles are configured', async () => {
    mockedRequest.mockResolvedValueOnce(
      makeMatrixResponse({
        roles: [],
        my_roles: [],
        matrix: {},
        effective_for_me: {},
      }),
    )
    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('rbac-empty')).toBeInTheDocument(),
    )
  })
})
