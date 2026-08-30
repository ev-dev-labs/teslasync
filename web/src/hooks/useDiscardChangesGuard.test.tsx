import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '@/components/ui'
import {
  GuardedLink,
  NavigationGuardProvider,
} from '@/components/feedback'
import { useDiscardChangesGuard } from './useDiscardChangesGuard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

function ExplicitCloseHarness({
  dirty,
  onClose,
}: {
  dirty: boolean
  onClose: () => void
}) {
  const { requestClose, dialogProps } = useDiscardChangesGuard(dirty, onClose)
  return (
    <>
      <button type="button" onClick={requestClose}>
        Close editor
      </button>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </>
  )
}

describe('useDiscardChangesGuard', () => {
  it('closes immediately when the editor is clean', async () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <ExplicitCloseHarness dirty={false} onClose={onClose} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps a dirty editor open when the operator declines to discard', async () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <ExplicitCloseHarness dirty onClose={onClose} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(
      await screen.findByRole('dialog', { name: 'Unsaved changes' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('discards and closes only after explicit confirmation', async () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <ExplicitCloseHarness dirty onClose={onClose} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Discard changes' }),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('registers the same dirty state with guarded in-app navigation', async () => {
    function NavigationHarness() {
      const [dirty] = useState(true)
      useDiscardChangesGuard(dirty, vi.fn(), {
        message: 'Unsaved fleet editor',
      })
      return <GuardedLink to="/next">Next page</GuardedLink>
    }

    render(
      <MemoryRouter initialEntries={['/current']}>
        <NavigationGuardProvider>
          <Routes>
            <Route path="/current" element={<NavigationHarness />} />
            <Route path="/next" element={<p>Next destination</p>} />
          </Routes>
        </NavigationGuardProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Next page' }))
    expect(await screen.findByText('Unsaved fleet editor')).toBeInTheDocument()
    expect(screen.queryByText('Next destination')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByText('Unsaved fleet editor')).not.toBeInTheDocument())
    expect(screen.queryByText('Next destination')).not.toBeInTheDocument()
  })
})
