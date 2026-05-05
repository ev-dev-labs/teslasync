import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, History } from 'lucide-react'
import { AlertBanner } from './AlertBanner'
import { Button } from '@/components/ui/Button'
import { useAsOfDate } from '@/hooks/useAsOfDate'
import { formatDateTime, toLocalDatetimeStr } from '@/lib/dateFormat'

/**
 * Phase-46 / Prompt 64 — global "viewing data as of …" banner.
 *
 * Visible whenever the SPA is operating in time-machine mode (ie. the
 * `?as_of=` URL query parameter is set to a valid RFC 3339 timestamp).
 * The banner exists so users — and especially diagnostics operators
 * reconstructing post-incident state — never lose track of the fact
 * that what they are looking at is a historical snapshot rather than
 * live data.
 *
 * Mounted in the layout shell ABOVE ServiceStatusBanner so the
 * historical-mode warning sits at the top of the main content column,
 * just below BrowserCompatBanner. Reuses the AlertBanner `info`
 * variant so its tone matches the SPA's other contextual notices.
 *
 * Inline picker: the "Pick another date" button toggles a small
 * `<input type="datetime-local">` row attached to the banner. The same
 * UI is opened from the command palette via the
 * {@link TIME_MACHINE_OPEN_PICKER_EVENT} window event so users can both
 * reveal AND change the historical anchor without leaving the current
 * page.
 *
 * Styling note: button + input chrome routes through the shared UI
 * primitives so the banner stays compliant with the light-mode parity
 * audit (no raw `text-white/N` or `border-white/N` literals).
 */

export const TIME_MACHINE_OPEN_PICKER_EVENT = 'time-machine.open-picker'

interface TimeMachineBannerProps {
  /**
   * Test seam — overrides the live URL-derived asOf so spec files can
   * render the picker open/closed without going through MemoryRouter.
   * Production callers never set this.
   */
  testHookAsOf?: string | null
  /**
   * Test seam — forces the picker open on initial render. Production
   * code sets this only via the {@link TIME_MACHINE_OPEN_PICKER_EVENT}
   * window event.
   */
  testHookPickerOpen?: boolean
}

function localInputToRfc3339(value: string): string | null {
  if (!value) return null
  // <input type="datetime-local"> emits "YYYY-MM-DDTHH:mm" in LOCAL
  // time with no zone; the new Date(...) constructor interprets the
  // string in the host's local zone, then toISOString() converts to UTC.
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function TimeMachineBanner({
  testHookAsOf,
  testHookPickerOpen = false,
}: TimeMachineBannerProps = {}) {
  const { t, i18n } = useTranslation()
  const { asOf, setAsOf, clear } = useAsOfDate()
  const [pickerOpen, setPickerOpen] = useState<boolean>(testHookPickerOpen)
  const [draft, setDraft] = useState<string>('')

  const effective = testHookAsOf !== undefined ? testHookAsOf : asOf

  useEffect(() => {
    function onOpen() {
      // Pre-fill the picker with the current asOf if any, otherwise
      // yesterday at noon — sensible default that lands the user inside
      // the supported lookback window without requiring a click.
      const seed =
        effective != null
          ? new Date(effective)
          : (() => {
              const d = new Date()
              d.setDate(d.getDate() - 1)
              d.setHours(12, 0, 0, 0)
              return d
            })()
      setDraft(toLocalDatetimeStr(seed))
      setPickerOpen(true)
    }
    window.addEventListener(TIME_MACHINE_OPEN_PICKER_EVENT, onOpen)
    return () => window.removeEventListener(TIME_MACHINE_OPEN_PICKER_EVENT, onOpen)
  }, [effective])

  const handleSubmit = useCallback(() => {
    const iso = localInputToRfc3339(draft)
    if (!iso) return
    setAsOf(iso)
    setPickerOpen(false)
  }, [draft, setAsOf])

  const handleReturnToLive = useCallback(() => {
    clear()
    setPickerOpen(false)
  }, [clear])

  // Guardrail: only render when in time-machine mode OR when the picker
  // is explicitly open from the command palette. In live mode with a
  // closed picker the banner is invisible — no extra UI noise.
  if (effective == null && !pickerOpen) return null

  const formatted =
    effective != null ? formatDateTime(effective, { locale: i18n.language }) : ''
  const title = t('timeMachine.banner.title', 'Viewing data as of {{when}}', {
    when: formatted,
  })
  const body =
    effective != null
      ? t('timeMachine.banner.body', 'Read-only point-in-time mode.')
      : t('timeMachine.banner.pickPrompt', 'Pick a point in time to view historical data.')
  const pickLabel = t('timeMachine.banner.pick', 'Pick a date')
  const returnLabel = t('timeMachine.banner.returnToLive', 'Return to live')
  const submitLabel = t('timeMachine.banner.submit', 'View as of date')
  const cancelLabel = t('timeMachine.banner.cancel', 'Cancel')
  const inputLabel = t('timeMachine.banner.inputLabel', 'Date and time')
  const inputId = 'time-machine-banner-input'

  return (
    <div
      data-testid="time-machine-banner"
      data-as-of={effective ?? ''}
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[55] px-4 py-2"
    >
      <AlertBanner
        variant="info"
        title={title}
        icon={<History className="h-4 w-4" aria-hidden />}
      >
        <div className="flex flex-col gap-2">
          <span data-testid="time-machine-banner-body">{body}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen((prev) => !prev)}
              data-testid="time-machine-banner-pick"
              icon={<Clock className="h-3 w-3" aria-hidden />}
            >
              {pickLabel}
            </Button>
            {effective != null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReturnToLive}
                data-testid="time-machine-banner-return"
              >
                {returnLabel}
              </Button>
            )}
          </div>
          {pickerOpen && (
            <div
              data-testid="time-machine-banner-picker"
              className="flex flex-wrap items-end gap-2 pt-1"
            >
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={inputId}
                  className="text-xs font-medium text-[var(--text-secondary)]"
                >
                  {inputLabel}
                </label>
                <input
                  id={inputId}
                  type="datetime-local"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  data-testid="time-machine-banner-input"
                  className="rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSubmit}
                disabled={!draft}
                data-testid="time-machine-banner-submit"
              >
                {submitLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPickerOpen(false)}
                data-testid="time-machine-banner-cancel"
              >
                {cancelLabel}
              </Button>
            </div>
          )}
        </div>
      </AlertBanner>
    </div>
  )
}

export default TimeMachineBanner
