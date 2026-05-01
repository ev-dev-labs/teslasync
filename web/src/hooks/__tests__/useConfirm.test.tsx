import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useConfirm } from '../useConfirm'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface HarnessProps {
  optionsBuilder?: () => Parameters<ReturnType<typeof useConfirm>['confirm']>[0]
  onResult?: (ok: boolean) => void
  /** When true the harness renders the dialog with `loading` overridden to true. */
  forceLoading?: boolean
}

function defaultOptions(): Parameters<ReturnType<typeof useConfirm>['confirm']>[0] {
  return {
    title: 'Delete rule?',
    message: 'This cannot be undone.',
    variant: 'danger',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
  }
}

function Harness({ optionsBuilder = defaultOptions, onResult, forceLoading }: HarnessProps) {
  const { confirm, dialogProps } = useConfirm()
  const trigger = async () => {
    const ok = await confirm(optionsBuilder())
    onResult?.(ok)
  }
  const merged = dialogProps && forceLoading ? { ...dialogProps, loading: true } : dialogProps
  return (
    <>
      <button onClick={trigger}>open</button>
      {merged && <ConfirmDialog {...merged} />}
    </>
  )
}

function openDialog() {
  fireEvent.click(screen.getByText('open'))
}

describe('useConfirm', () => {
  it('renders nothing until confirm() is called', () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens a dialog with the supplied title and message', () => {
    render(<Harness />)
    openDialog()
    expect(screen.getByRole('dialog', { name: 'Delete rule?' })).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('resolves true when the confirm button is clicked', async () => {
    let resolved: boolean | undefined
    render(<Harness onResult={(ok) => { resolved = ok }} />)
    openDialog()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })

    expect(resolved).toBe(true)
    // Dialog dismisses after resolution.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('resolves false when the cancel button is clicked', async () => {
    let resolved: boolean | undefined
    render(<Harness onResult={(ok) => { resolved = ok }} />)
    openDialog()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })

    expect(resolved).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('resolves false when the Escape key is pressed', async () => {
    let resolved: boolean | undefined
    render(<Harness onResult={(ok) => { resolved = ok }} />)
    openDialog()

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    expect(resolved).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('resolves false when the Modal backdrop (click-outside) is clicked', async () => {
    let resolved: boolean | undefined
    const { container } = render(<Harness onResult={(ok) => { resolved = ok }} />)
    openDialog()

    // The Modal renders its backdrop as a sibling of the dialog with the
    // .bg-black/50 class. Click it to simulate click-outside.
    const backdrop = container.querySelector('.bg-black\\/50') as HTMLElement | null
    expect(backdrop).not.toBeNull()
    await act(async () => {
      fireEvent.click(backdrop!)
    })

    expect(resolved).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('disables the confirm button until requireTypedConfirmation matches exactly', () => {
    render(
      <Harness optionsBuilder={() => ({
        title: 'Delete vehicle?',
        message: 'Type the VIN to confirm.',
        variant: 'danger',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        requireTypedConfirmation: '5YJ3E1EA7JF000001',
        typedConfirmationLabel: 'Type the VIN to confirm',
      })} />,
    )
    openDialog()

    const confirmBtn = screen.getByRole('button', { name: 'Delete' })
    expect(confirmBtn).toBeDisabled()

    const input = screen.getByLabelText('Type the VIN to confirm') as HTMLInputElement

    fireEvent.change(input, { target: { value: '5YJ3E1EA7JF00000' } }) // missing last char
    expect(confirmBtn).toBeDisabled()

    fireEvent.change(input, { target: { value: '5YJ3E1EA7JF000001' } })
    expect(confirmBtn).not.toBeDisabled()
  })

  it('clicking confirm with typed confirmation resolves true', async () => {
    let resolved: boolean | undefined
    render(
      <Harness
        onResult={(ok) => { resolved = ok }}
        optionsBuilder={() => ({
          title: 'Reset settings?',
          message: 'Type "reset" to confirm.',
          variant: 'danger',
          confirmLabel: 'Reset',
          requireTypedConfirmation: 'reset',
          typedConfirmationLabel: 'Type reset to confirm',
        })}
      />,
    )
    openDialog()

    const input = screen.getByLabelText('Type reset to confirm') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'reset' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    })

    expect(resolved).toBe(true)
  })

  it('disables both buttons and shows a spinner when loading', () => {
    render(<Harness forceLoading />)
    openDialog()

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
    const confirmBtn = screen.getByRole('button', { name: 'Delete' })

    expect(cancelBtn).toBeDisabled()
    expect(confirmBtn).toBeDisabled()
    expect(confirmBtn).toHaveAttribute('aria-busy', 'true')
    // Button renders an animated spinner svg when loading.
    expect(confirmBtn.querySelector('svg.animate-spin')).not.toBeNull()
  })

  it('loading suppresses the Escape-key cancel path', async () => {
    let resolved: boolean | undefined
    render(<Harness forceLoading onResult={(ok) => { resolved = ok }} />)
    openDialog()

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    // Dialog stays open and the promise has not resolved.
    expect(screen.queryByRole('dialog')).not.toBeNull()
    expect(resolved).toBeUndefined()
  })
})
