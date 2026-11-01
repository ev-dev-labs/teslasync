import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VehicleStudioCanvas from './VehicleStudioCanvas'

const canvas = vi.hoisted(() => ({ props: null as { dpr: number[]; frameloop: string } | null }))
vi.mock('@react-three/fiber', () => ({
  Canvas: (props: { dpr: number[]; frameloop: string }) => { canvas.props = props; return null },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }))
vi.mock('@/components/ui/ThemeProvider', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/ui/ThemeProvider')>(),
  useTheme: () => ({ theme: { primary: '#336699' }, mode: { surface1: '#ffffff', colorScheme: 'light' } }),
}))

afterEach(() => vi.restoreAllMocks())

it('selects exactly one camera view with keyboard-accessible buttons', async () => {
  render(<VehicleStudioCanvas onUnavailable={vi.fn()} />)
  for (const name of ['Rear', 'Side', 'Top', 'Tires', 'Front']) {
    await userEvent.click(screen.getByRole('button', { name }))
    expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
  }
})

it('caps DPR at two and stops the demand renderer when the document is hidden', () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  render(<VehicleStudioCanvas onUnavailable={vi.fn()} />)
  expect(canvas.props).toMatchObject({ dpr: [1, 2], frameloop: 'demand' })
  visibility.mockReturnValue('hidden')
  fireEvent(document, new Event('visibilitychange'))
  expect(canvas.props?.frameloop).toBe('never')
  visibility.mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  expect(canvas.props?.frameloop).toBe('demand')
})
