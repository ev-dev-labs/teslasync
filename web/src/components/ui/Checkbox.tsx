import { forwardRef, useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

const sizes = {
  sm: { box: 'h-3.5 w-3.5', icon: 'h-2.5 w-2.5' },
  md: { box: 'h-4 w-4', icon: 'h-3 w-3' },
  lg: { box: 'h-5 w-5', icon: 'h-3.5 w-3.5' },
} as const;

export type CheckboxSize = keyof typeof sizes;

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'size'> {
  /** Optional inline label rendered to the right of the box. */
  label?: ReactNode;
  /** Mixed-state checkbox (typically used by "select all" headers). */
  indeterminate?: boolean;
  /** Visual size of the box. Defaults to `md`. */
  size?: CheckboxSize;
  /** Standard React-style change handler reporting the new boolean. */
  onChange?: (checked: boolean) => void;
}

/**
 * Accessible checkbox primitive.
 *
 * Uses a visually-hidden native `<input type="checkbox">` for keyboard,
 * screen-reader, and form-association semantics, layered with a styled
 * indicator that follows the design system tokens. Supports the
 * indeterminate (mixed) state for bulk-selection patterns.
 *
 * The `<input>` element here is intentional — `components/ui/` is
 * exempt from the audit's raw-HTML rule precisely because this is
 * where shared primitives live. Feature pages should import this
 * component instead of writing their own checkbox.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      indeterminate = false,
      size = 'md',
      onChange,
      className,
      disabled,
      checked,
      defaultChecked,
      ...inputProps
    },
    forwardedRef,
  ) => {
    const localRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      const el = localRef.current;
      if (!el) return;
      el.indeterminate = indeterminate;
    }, [indeterminate, checked]);

    const setRefs = (node: HTMLInputElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) (forwardedRef as { current: HTMLInputElement | null }).current = node;
    };

    const dims = sizes[size];

    const indicator = (
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded border transition-colors',
          dims.box,
          'border-[var(--border-strong)] bg-white/[0.04]',
          'peer-checked:border-cyan-500 peer-checked:bg-cyan-500/20 peer-checked:text-cyan-300',
          'peer-indeterminate:border-cyan-500 peer-indeterminate:bg-cyan-500/20 peer-indeterminate:text-cyan-300',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-500 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-transparent',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
          'text-transparent',
        )}
      >
        {indeterminate ? <Minus className={dims.icon} /> : <Check className={dims.icon} />}
      </span>
    );

    return (
      <label
        className={cn(
          'inline-flex cursor-pointer items-center gap-2 select-none',
          disabled && 'cursor-not-allowed opacity-60',
          className,
        )}
      >
        <input
          ref={setRefs}
          type="checkbox"
          // `peer` powers the indicator's checked/focus/disabled styles
          // via Tailwind's peer-* variants. `sr-only` hides it visually
          // while keeping it in the accessibility tree.
          className="peer sr-only"
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          onChange={e => {
            if (disabled) return;
            onChange?.(e.target.checked);
          }}
          {...inputProps}
        />
        {indicator}
        {label != null && <span className="text-sm text-[var(--text-primary)]">{label}</span>}
      </label>
    );
  },
);
Checkbox.displayName = 'Checkbox';
