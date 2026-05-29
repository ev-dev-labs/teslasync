/**
 * Form `<label>` primitive with visible and accessible required indicators.
 *
 * Renders an HTML `<label>` element. When `required` is set:
 *
 *   1. A red `*` is rendered after the label children, marked
 *      `aria-hidden="true"` so screen readers don't announce the
 *      glyph as "asterisk".
 *   2. A `<VisuallyHidden>` span carrying the i18n string
 *      `form.required` is appended so the accessible name of the
 *      paired control becomes e.g. "Email required" — satisfying
 *      WCAG 3.3.2 (Labels or Instructions).
 *
 * The shared form primitives (`Input`, `Textarea`, `Select`) auto-render
 * this Label whenever their `label=` prop is provided AND `required` is
 * set, so most call-sites never import this directly. Reach for it
 * explicitly when wiring a custom composite control (coordinate picker,
 * code editor, etc.) where you also want the visible + a11y required
 * marker.
 *
 * NOTE: the Typography `Label` re-exported from `@/components/ui` is a
 * span-based typography role — semantically distinct from this form
 * label. Import this Label directly from `@/components/ui/Label`.
 */

import { type LabelHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { VisuallyHidden } from '@/components/a11y';
import { cn } from '@/lib/cn';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /**
   * When true, renders a visible `*` (aria-hidden) AND a screen-reader-only
   * "required" string so the accessible name of the paired control reads
   * "<label> required".
   */
  required?: boolean;
  children?: ReactNode;
}

export function Label({
  required,
  children,
  className,
  ...rest
}: LabelProps) {
  const { t } = useTranslation();
  return (
    <label className={cn(className)} {...rest}>
      {children}
      {required ? (
        <>
          {' '}
          <span aria-hidden="true" className="text-rose-300">
            *
          </span>
          <VisuallyHidden>{` ${t('form.required', 'required')}`}</VisuallyHidden>
        </>
      ) : null}
    </label>
  );
}

Label.displayName = 'Label';
