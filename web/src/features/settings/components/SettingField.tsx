import type { ReactNode } from 'react'
import { HelpIcon } from '@/components/ui'

export interface SettingFieldHelp {
  /** i18n key for the inline `<HelpIcon>`. */
  i18nKey?: string
  /** Plain-text fallback when the i18n key is missing. */
  content?: string
  /** Field id surfaced in the HelpIcon's aria-label. */
  for?: string
}

export function SettingField({
  label,
  help,
  htmlFor,
  children,
}: {
  label: string
  /** Optional inline help icon attached to the label. */
  help?: SettingFieldHelp
  /**
   * id of the control this field labels. When provided, the `<label>` is
   * programmatically associated with the control via `htmlFor` so assistive
   * tech announces the label and clicking it focuses the control. Omit it
   * for fields whose control does not expose a stable id.
   */
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        <label
          htmlFor={htmlFor}
          className="block text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]"
        >
          {label}
        </label>
        {help && (
          <HelpIcon i18nKey={help.i18nKey} content={help.content} for={help.for} />
        )}
      </div>
      {children}
    </div>
  )
}
