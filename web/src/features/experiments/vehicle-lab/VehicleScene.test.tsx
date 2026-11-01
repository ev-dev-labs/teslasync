import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VehicleScene from './VehicleScene'
import { canUseWebGL } from './sceneCapabilities'
import en from '@/i18n/en.json'

vi.mock('./sceneCapabilities', () => ({ canUseWebGL: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }))
vi.mock('./VehicleStudioCanvas', () => ({
  default: ({ onUnavailable }: { onUnavailable: () => void }) =>
    <button onClick={onUnavailable}>Simulate context loss</button>,
}))

beforeEach(() => vi.mocked(canUseWebGL).mockReturnValue(false))

it('shows all seventeen unknown signals without loading a canvas when WebGL is unavailable', () => {
  render(<VehicleScene />)
  expect(screen.getByRole('status')).toHaveTextContent(en.experiments.vehicleLab.webglUnavailable)
  expect(screen.getAllByText('Unavailable')).toHaveLength(17)
  expect(screen.getByText('Front-left door')).toBeInTheDocument()
  expect(screen.getByText('Rear-right tire')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('recovers from a lost graphics context without hiding the signal summary', async () => {
  vi.mocked(canUseWebGL).mockReturnValue(true)
  render(<VehicleScene />)
  await userEvent.click(await screen.findByRole('button', { name: 'Simulate context loss' }))
  expect(screen.getByRole('status')).toHaveTextContent(en.experiments.vehicleLab.webglUnavailable)
  expect(screen.getAllByText('Unavailable')).toHaveLength(17)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
