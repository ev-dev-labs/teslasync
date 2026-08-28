/**
 * Validation summary (A11Y-04).
 *
 * When a form submit fails, per-field `<ErrorText role="alert">`
 * messages are individually announced but collectively useless: a
 * screen-reader user hears one error, has no idea how many others
 * exist, and has to Tab through the whole form to find them. Sighted
 * keyboard users have it worse — the first invalid field may be three
 * screens below the submit button.
 *
 * WCAG 3.3.1 (Error Identification) and the WAI "form validation"
 * pattern both call for a single summary at the top of the form that:
 *
 *   - is a live region so it announces as soon as it appears,
 *   - receives focus on submit failure so the user lands on the
 *     problem instead of hunting for it, and
 *   - links each message to the field it belongs to, so activating a
 *     message moves focus straight to that control.
 *
 * This component does all three. It focuses itself only when the set of
 * errors *changes* — re-rendering a form with the same errors (a
 * keystroke elsewhere, a parent state update) does not re-steal focus,
 * which is the bug that makes most hand-rolled summaries unusable.
 *
 * @example
 *   <ValidationSummary
 *     errors={[
 *       { fieldId: 'vin', message: t('form.vin.required', 'VIN is required') },
 *       { fieldId: 'name', message: t('form.name.tooLong', 'Name is too long') },
 *     ]}
 *   />
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Text } from '@/components/ui/Typography';

export interface ValidationError {
  /**
   * `id` of the invalid control. When present the message renders as a
   * button that moves focus to that control; when absent the message is
   * plain text (used for form-level errors that belong to no field).
   */
  fieldId?: string;
  /** Already-translated, human-readable description of the problem. */
  message: string;
  /**
   * Optional field label, already translated. Prefixed to the message
   * so "Required" becomes "VIN: Required" when read out of context.
   */
  label?: string;
}

export interface ValidationSummaryProps {
  /** Current validation errors. Empty or undefined renders nothing. */
  errors?: readonly ValidationError[];
  /**
   * Heading text. Defaults to a translated, count-aware sentence.
   * Pass a form-specific string when the generic one reads oddly.
   */
  title?: string;
  /**
   * Set false to render the summary without moving focus. Use for
   * always-visible advisory summaries that are not the result of a
   * submit attempt.
   */
  focusOnError?: boolean;
  className?: string;
}

/** Stable identity for a set of errors, used to detect real changes. */
function signature(errors: readonly ValidationError[]): string {
  return errors.map((e) => `${e.fieldId ?? ''}|${e.message}`).join('\u0000');
}

export function ValidationSummary({
  errors,
  title,
  focusOnError = true,
  className,
}: ValidationSummaryProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSignature = useRef<string | null>(null);

  const list = errors ?? [];
  const sig = list.length > 0 ? signature(list) : null;

  useEffect(() => {
    if (!focusOnError) {
      lastSignature.current = sig;
      return;
    }
    // Only a *new* set of problems justifies taking focus. Repeating a
    // focus move on every render of an unchanged error set traps the
    // user in the summary and makes the form impossible to complete.
    if (sig && sig !== lastSignature.current) {
      containerRef.current?.focus();
    }
    lastSignature.current = sig;
  }, [sig, focusOnError]);

  if (list.length === 0) return null;

  const heading =
    title ??
    (list.length === 1
      ? t('form.validation.summaryTitleOne', 'Fix 1 problem before continuing')
      : t(
          'form.validation.summaryTitleMany',
          'Fix {{count}} problems before continuing',
          { count: list.length },
        ));

  const focusField = (fieldId: string) => {
    const field = document.getElementById(fieldId);
    if (!field) return;
    field.focus();
    // jsdom (and older Safari) do not implement scrollIntoView; focusing
    // is the accessibility-critical half, scrolling is the nicety.
    field.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  };

  return (
    <div
      ref={containerRef}
      // `alert` is assertive: a failed submit is exactly the "user must
      // know now" case the role exists for. `tabIndex={-1}` makes the
      // container programmatically focusable without adding it to the
      // tab order.
      role="alert"
      aria-labelledby={undefined}
      tabIndex={-1}
      data-validation-summary="true"
      className={cn(
        'rounded-panel border border-rose-500/40 bg-rose-500/10 px-4 py-3 outline-none',
        'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <Text as="p" variant="bodySm" weight="semibold" className="text-rose-200">
            {heading}
          </Text>
          <ul className="mt-1.5 space-y-1">
            {list.map((error, index) => {
              // Composed in JS rather than through an interpolated
              // translation: the separator is punctuation, not copy, and
              // keeping it out of the catalog means the message reads
              // identically whether or not a catalog entry exists.
              const text = error.label
                ? `${error.label}: ${error.message}`
                : error.message;
              return (
                <li key={`${error.fieldId ?? 'form'}-${index}`}>
                  {error.fieldId ? (
                    <button
                      type="button"
                      onClick={() => focusField(error.fieldId!)}
                      className={cn(
                        'text-left text-sm text-rose-200 underline underline-offset-2',
                        'hover:text-rose-100',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400',
                      )}
                    >
                      {text}
                    </button>
                  ) : (
                    <Text as="span" variant="bodySm" className="text-rose-200">
                      {text}
                    </Text>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
