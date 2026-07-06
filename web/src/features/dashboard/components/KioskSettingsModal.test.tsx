/**
 * KioskSettingsModal contract.
 *
 * The modal is a pure controlled surface — every setting is read from the
 * `config` prop and every mutation is reported back through `onUpdateConfig`
 * (plus `onEnterKiosk` / `onClose` for the primary actions). The suite locks:
 *   1. Open/closed rendering + the accessible dialog / section structure.
 *   2. Each control reflects its config value and reports the right partial
 *      update (rotation interval, cursor auto-hide, screen dimming, clock,
 *      widget/background opacity).
 *   3. Conditional sub-controls only appear when their parent toggle is on.
 *   4. The dashboard rotation picker: default "all selected", add/remove, and
 *      the "never drop below one" guard.
 *   5. Regression guard for the impure-state-updater bug — toggling a
 *      dashboard must call onUpdateConfig exactly once (an updater with a side
 *      effect double-fires under React StrictMode, which wraps every render
 *      here).
 *   6. Hardening: a partial / legacy persisted config is merged over defaults
 *      so sliders never render `NaN`; an undefined `dashboards` prop never
 *      crashes.
 *
 * i18n is stubbed so `t(key, fallback)` returns the English fallback, making
 * the visible copy deterministic. No network is touched — the component has no
 * data hooks.
 */

import { describe, it, expect, vi } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { KioskSettingsModal } from './KioskSettingsModal'
import { DEFAULT_KIOSK_CONFIG, type KioskConfig } from '../hooks/useKioskMode'
import type { SavedDashboard } from '../widgets/types'

function makeDashboard(id: string, name: string, extra: Partial<SavedDashboard> = {}): SavedDashboard {
  return { id, name, widgets: [], layouts: {}, createdAt: '', updatedAt: '', ...extra }
}

const DASHBOARDS: SavedDashboard[] = [
  makeDashboard('a', 'Alpha'),
  makeDashboard('b', 'Bravo'),
  makeDashboard('c', 'Charlie', { isDefault: true }),
]

interface Overrides {
  open?: boolean
  /** Shallow overrides merged over DEFAULT_KIOSK_CONFIG. */
  config?: Partial<KioskConfig>
  /** A verbatim config (used to feed intentionally-partial legacy shapes). */
  rawConfig?: KioskConfig
  dashboards?: SavedDashboard[]
}

function setup(o: Overrides = {}) {
  const onClose = vi.fn()
  const onUpdateConfig = vi.fn()
  const onEnterKiosk = vi.fn()
  const config: KioskConfig = o.rawConfig ?? { ...DEFAULT_KIOSK_CONFIG, ...o.config }
  render(
    <StrictMode>
      <KioskSettingsModal
        open={o.open ?? true}
        onClose={onClose}
        onUpdateConfig={onUpdateConfig}
        onEnterKiosk={onEnterKiosk}
        config={config}
        dashboards={o.dashboards ?? DASHBOARDS}
      />
    </StrictMode>,
  )
  return { onClose, onUpdateConfig, onEnterKiosk }
}

describe('KioskSettingsModal — rendering', () => {
  it('renders nothing when closed', () => {
    setup({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Kiosk Settings')).toBeNull()
  })

  it('renders an accessible dialog with every section when open', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Kiosk Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Dashboard Rotation' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Display' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Transparency' })).toBeInTheDocument()
  })

  it('localizes the select option labels', () => {
    setup({ config: { rotateInterval: 30, showClock: true, dimAfter: 5 } })
    expect(screen.getByText('Off')).toBeInTheDocument()
    expect(screen.getByText('1 min')).toBeInTheDocument()
    expect(screen.getByText('Top Left')).toBeInTheDocument()
    expect(screen.getByText('Never')).toBeInTheDocument()
  })
})

describe('KioskSettingsModal — dashboard rotation picker', () => {
  it('selects every dashboard by default when the config list is empty', () => {
    setup({ config: { rotateInterval: 30, dashboardIds: [] } })
    expect((screen.getByRole('checkbox', { name: 'Alpha' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Bravo' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Charlie' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('honours an explicit dashboardIds selection', () => {
    setup({ config: { rotateInterval: 30, dashboardIds: ['a'] } })
    expect((screen.getByRole('checkbox', { name: 'Alpha' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Bravo' }) as HTMLInputElement).checked).toBe(false)
  })

  it('persists a de-selection exactly once — no impure-updater double fire', () => {
    const { onUpdateConfig } = setup({ config: { rotateInterval: 30, dashboardIds: [] } })
    const alpha = screen.getByRole('checkbox', { name: 'Alpha' }) as HTMLInputElement
    fireEvent.click(alpha)
    expect(onUpdateConfig).toHaveBeenCalledTimes(1)
    expect(onUpdateConfig).toHaveBeenCalledWith({ dashboardIds: ['b', 'c'] })
    expect(alpha.checked).toBe(false)
  })

  it('adds a dashboard back to the rotation set when re-checked', () => {
    const { onUpdateConfig } = setup({ config: { rotateInterval: 30, dashboardIds: ['a'] } })
    const bravo = screen.getByRole('checkbox', { name: 'Bravo' }) as HTMLInputElement
    fireEvent.click(bravo)
    expect(onUpdateConfig).toHaveBeenCalledWith({ dashboardIds: ['a', 'b'] })
    expect(bravo.checked).toBe(true)
  })

  it('refuses to drop below one selected dashboard', () => {
    const { onUpdateConfig } = setup({ config: { rotateInterval: 30, dashboardIds: ['a'] } })
    const alpha = screen.getByRole('checkbox', { name: 'Alpha' }) as HTMLInputElement
    fireEvent.click(alpha)
    expect(alpha.checked).toBe(true)
    expect(onUpdateConfig).toHaveBeenCalledWith({ dashboardIds: ['a'] })
  })

  it('hides the picker when rotation is off', () => {
    setup({ config: { rotateInterval: 0 } })
    expect(screen.queryByText('Dashboards to Rotate')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('hides the picker when there is only a single dashboard', () => {
    setup({ config: { rotateInterval: 30 }, dashboards: [makeDashboard('solo', 'Solo')] })
    expect(screen.queryByText('Dashboards to Rotate')).toBeNull()
  })
})

describe('KioskSettingsModal — rotation interval', () => {
  it('reflects and persists the rotation interval', () => {
    const { onUpdateConfig } = setup({ config: { rotateInterval: 30 } })
    const select = screen.getByLabelText('Rotation Interval') as HTMLSelectElement
    expect(select.value).toBe('30')
    fireEvent.change(select, { target: { value: '60' } })
    expect(onUpdateConfig).toHaveBeenCalledWith({ rotateInterval: 60 })
  })
})

describe('KioskSettingsModal — cursor auto-hide', () => {
  it('shows the timeout select and its value only when auto-hide is on', () => {
    setup({ config: { hideCursor: true, cursorTimeout: 5 } })
    const select = screen.getByLabelText('Hide After') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.value).toBe('5')
  })

  it('hides the timeout select when auto-hide is off', () => {
    setup({ config: { hideCursor: false } })
    expect(screen.queryByLabelText('Hide After')).toBeNull()
  })

  it('persists toggling auto-hide off', () => {
    const { onUpdateConfig } = setup({ config: { hideCursor: true } })
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-hide Cursor' }))
    expect(onUpdateConfig).toHaveBeenCalledWith({ hideCursor: false })
  })

  it('persists a cursor-timeout change', () => {
    const { onUpdateConfig } = setup({ config: { hideCursor: true, cursorTimeout: 5 } })
    fireEvent.change(screen.getByLabelText('Hide After'), { target: { value: '10' } })
    expect(onUpdateConfig).toHaveBeenCalledWith({ cursorTimeout: 10 })
  })
})

describe('KioskSettingsModal — screen dimming', () => {
  it('hides the brightness slider when dimming is off', () => {
    setup({ config: { dimAfter: 0 } })
    expect(screen.queryByLabelText('Dimmed Brightness')).toBeNull()
  })

  it('shows the brightness slider reflecting dimLevel when dimming is on', () => {
    setup({ config: { dimAfter: 10, dimLevel: 0.5 } })
    const slider = screen.getByLabelText('Dimmed Brightness') as HTMLInputElement
    expect(slider).toBeInTheDocument()
    expect(slider.value).toBe('50')
  })

  it('persists a brightness change', () => {
    const { onUpdateConfig } = setup({ config: { dimAfter: 10, dimLevel: 0.5 } })
    fireEvent.change(screen.getByLabelText('Dimmed Brightness'), { target: { value: '70' } })
    expect(onUpdateConfig).toHaveBeenCalledWith({ dimLevel: 0.7 })
  })

  it('persists a dim-after change', () => {
    const { onUpdateConfig } = setup({ config: { dimAfter: 0 } })
    fireEvent.change(screen.getByLabelText('Dim Screen After'), { target: { value: '15' } })
    expect(onUpdateConfig).toHaveBeenCalledWith({ dimAfter: 15 })
  })
})

describe('KioskSettingsModal — clock', () => {
  it('shows and reflects the clock-position select when the clock is enabled', () => {
    setup({ config: { showClock: true, clockPosition: 'bottom-right' } })
    expect((screen.getByLabelText('Clock Position') as HTMLSelectElement).value).toBe('bottom-right')
  })

  it('hides the clock-position select when the clock is disabled', () => {
    setup({ config: { showClock: false } })
    expect(screen.queryByLabelText('Clock Position')).toBeNull()
  })

  it('persists a clock-position change', () => {
    const { onUpdateConfig } = setup({ config: { showClock: true } })
    fireEvent.change(screen.getByLabelText('Clock Position'), { target: { value: 'top-left' } })
    expect(onUpdateConfig).toHaveBeenCalledWith({ clockPosition: 'top-left' })
  })
})

describe('KioskSettingsModal — transparency', () => {
  it('reflects and persists widget + background opacity', () => {
    const { onUpdateConfig } = setup({ config: { widgetOpacity: 1, backgroundOpacity: 1 } })
    const widget = screen.getByLabelText('Widget Opacity') as HTMLInputElement
    const background = screen.getByLabelText('Background Opacity') as HTMLInputElement
    expect(widget.value).toBe('100')
    expect(background.value).toBe('100')
    fireEvent.change(widget, { target: { value: '50' } })
    expect(onUpdateConfig).toHaveBeenCalledWith({ widgetOpacity: 0.5 })
    fireEvent.change(background, { target: { value: '75' } })
    expect(onUpdateConfig).toHaveBeenCalledWith({ backgroundOpacity: 0.75 })
  })
})

describe('KioskSettingsModal — primary actions', () => {
  it('enters kiosk mode: persists the selection, closes, then enters', () => {
    const { onClose, onEnterKiosk, onUpdateConfig } = setup({
      config: { rotateInterval: 30, dashboardIds: [] },
    })
    fireEvent.click(screen.getByRole('button', { name: /Enter Kiosk Mode/ }))
    expect(onUpdateConfig).toHaveBeenCalledWith({ dashboardIds: ['a', 'b', 'c'] })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onEnterKiosk).toHaveBeenCalledTimes(1)
  })

  it('cancels without entering kiosk mode', () => {
    const { onClose, onEnterKiosk } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onEnterKiosk).not.toHaveBeenCalled()
  })
})

describe('KioskSettingsModal — hardening', () => {
  it('merges a partial/legacy config over defaults so sliders never render NaN', () => {
    const partial = {
      rotateInterval: 30,
      dashboardIds: [],
      hideCursor: false,
      cursorTimeout: 5,
      dimAfter: 10,
      showClock: false,
      clockPosition: 'bottom-right',
      // dimLevel, widgetOpacity, backgroundOpacity intentionally omitted
    } as unknown as KioskConfig
    setup({ rawConfig: partial })
    expect((screen.getByLabelText('Dimmed Brightness') as HTMLInputElement).value).toBe('50')
    expect((screen.getByLabelText('Widget Opacity') as HTMLInputElement).value).toBe('100')
    expect((screen.getByLabelText('Background Opacity') as HTMLInputElement).value).toBe('100')
  })

  it('does not crash when the dashboards prop is undefined', () => {
    const onClose = vi.fn()
    render(
      <StrictMode>
        <KioskSettingsModal
          open
          onClose={onClose}
          onUpdateConfig={vi.fn()}
          onEnterKiosk={vi.fn()}
          config={{ ...DEFAULT_KIOSK_CONFIG, rotateInterval: 30 }}
          dashboards={undefined as unknown as SavedDashboard[]}
        />
      </StrictMode>,
    )
    expect(screen.getByRole('dialog', { name: 'Kiosk Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
