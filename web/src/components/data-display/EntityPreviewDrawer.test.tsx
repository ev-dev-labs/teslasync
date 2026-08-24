import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EntityPreviewDrawer } from './EntityPreviewDrawer'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}))

describe('EntityPreviewDrawer', () => {
  it('renders evidence and continues to the full workflow', () => {
    const onClose = vi.fn()
    const onOpenDetails = vi.fn()

    render(
      <EntityPreviewDrawer
        open
        onClose={onClose}
        eyebrow="Drive preview"
        title="Home to Office"
        description="Completed drive"
        statusLabel="Completed"
        statusTone="success"
        fields={[
          { key: 'distance', label: 'Distance', value: '42 km' },
          { key: 'energy', label: 'Energy', value: '7.8 kWh' },
        ]}
        primaryAction={{
          label: 'Open drive details',
          onClick: onOpenDetails,
        }}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Home to Office' })).toBeInTheDocument()
    expect(screen.getByText('42 km')).toBeInTheDocument()
    expect(screen.getByText('7.8 kWh')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open drive details' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onOpenDetails).toHaveBeenCalledOnce()
  })
})
