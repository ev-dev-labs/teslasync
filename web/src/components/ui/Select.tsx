import {
  forwardRef,
  useCallback,
  useId,
  useMemo,
  useRef,
  type ChangeEvent,
  type SelectHTMLAttributes,
} from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { getLangDir } from '@/lib/i18nDir';
import { Label } from './Label';
import { HelpIcon, type HelpIconProps } from './HelpIcon';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'size'> {
  options: SelectOption[];
  label?: string;
  /**
   * Optional `<HelpIcon>` rendered immediately after the label. The
   * HelpIcon's `for` defaults to the select's resolved id so screen
   * readers announce "Help for {{id}}" when the trigger is focused.
   */
  help?: Omit<HelpIconProps, 'for'> & { for?: string };
  error?: string;
  hint?: string;
  placeholder?: string; // ok-any: gate substring-matches "placeholder"; this is a real prop, not stub content
  /**
   * Sizing scale. Defaults to `'md'` for back-compat. Pass `'auto'` to
   * follow the user's `ui_density` setting via density-aware Tailwind
   * utilities.
   */
  size?: 'sm' | 'md' | 'lg' | 'auto';
}

const sizeClasses: Record<NonNullable<SelectProps['size']>, string> = {
  sm: 'px-2 py-1.5 text-xs',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-2.5 text-base',
  auto: 'px-d-pad-x py-d-pad-y text-d-base min-h-d-row',
};

/**
 * Radix reserves the empty string internally to represent "no value" and
 * throws if a `<Select.Item>` is given `value=""`. Several call-sites, however,
 * legitimately use `{ value: '', label: 'All …' }` as a real, selectable
 * option (audit-log filters, api-log filters, "No flags", "No home geofence",
 * …). Map `''` to this private sentinel for the Radix layer only, and map it
 * back before emitting `onChange`, so callers keep seeing `''` exactly as they
 * did with the native `<select>`.
 */
const EMPTY_SENTINEL = '__teslasync_select_empty__';

/**
 * Accessible select control, rebuilt on Radix UI's `Select` primitive
 * (`@radix-ui/react-select`) for its polished, portalled listbox popup with
 * type-ahead, Arrow/Home/End/PageUp-Down navigation, Enter/Space to commit,
 * Escape/outside-click to dismiss, auto-flip/viewport-clamped positioning, and
 * full pointer + keyboard handling. Radix primitives render unstyled, so this
 * file ports the original glassmorphism Tailwind design onto the Radix parts.
 *
 * ── Dual-layer accessibility + compat model ─────────────────────────────────
 * To rebuild on Radix WITHOUT changing the external prop API — Radix's
 * `onValueChange(value: string)` is not a DOM event, yet every one of this
 * component's ~80 call-sites reads `event.target.value` from `onChange`, and
 * existing tests treat the control as a native `<select>`
 * (`getByRole('combobox')`, `getByLabelText`, `fireEvent.change`,
 * `getByTestId(id) as HTMLSelectElement`) — a real native `<select>` is
 * rendered alongside the Radix UI and kept in sync:
 *
 *   • Native `<select>` (rendered first, off-screen, `tabIndex={-1}`, NOT
 *     `aria-hidden`): the SINGLE element carrying the `combobox` role AND the
 *     caller's `id` + label association, so the accessibility topology and the
 *     `getElementById(id)` / `getByLabelText` / `getByRole('combobox')` /
 *     `fireEvent.change` behavior all match the original component exactly. It
 *     owns the real form value + `name` (native submission), the forwarded
 *     `HTMLSelectElement` ref, the `onChange(event => event.target.value)`
 *     surface, and any forwarded `data-*`/`data-testid`. Assistive-tech and
 *     forms-mode users can operate it directly.
 *   • Radix `<Select.Trigger>` (visible, focusable, `role="button"` +
 *     `aria-haspopup="listbox"` + `aria-expanded`): the styled control sighted
 *     pointer/keyboard users drive. Its `role` is `button` (not a second
 *     `combobox`) and it is deliberately NOT associated with the field label —
 *     so exactly one element answers `getByRole('combobox')` / `getByLabelText`.
 *     Its accessible name comes from its own content (the selected option, or
 *     the prompt text); the field label lives on the native combobox beside it
 *     and remains visible for sighted users.
 *
 * Committing a value through the Radix listbox mirrors it onto the native
 * `<select>` and fires the same `onChange`; operating the native `<select>`
 * updates the controlled value that drives Radix — so the two layers never
 * diverge, in either direction.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>((props, ref) => {
  const {
    options,
    label,
    help,
    error,
    hint,
    placeholder: promptText, // ok-any: gate substring-matches "placeholder"; native <select> has no such attribute so it is a real, explicit prop
    size = 'md',
    className,
    id,
    required,
    disabled,
    value,
    defaultValue,
    onChange,
    name,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    ...rest
  } = props;

  const { i18n } = useTranslation();
  const reactId = useId();
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-') || reactId;

  const safeOptions = options ?? [];
  const hasEmptyOption = safeOptions.some((opt) => opt.value === '');

  // Always render both layers as *controlled* off a single resolved string
  // value (falling back to the initial `defaultValue`, then `''`). Never switch
  // a layer between a defined and an `undefined` value across renders: doing so
  // trips React's + Radix's "changing from uncontrolled to controlled" warning
  // when a caller's bound value legitimately flips (e.g. an optional field
  // toggling between a set string and `undefined`). Every call-site is
  // controlled, so this is behaviour-preserving.
  const stringValue = value == null ? undefined : String(value);
  const stringDefault = defaultValue == null ? undefined : String(defaultValue);
  const currentValue = stringValue ?? stringDefault ?? '';

  const toRadix = useCallback(
    (v: string): string => {
      if (v === '') return hasEmptyOption ? EMPTY_SENTINEL : '';
      return v;
    },
    [hasEmptyOption],
  );

  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const setRefs = useCallback(
    (node: HTMLSelectElement | null) => {
      nativeRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // Fired when the user commits an option through the Radix listbox. Mirror the
  // chosen value onto the hidden native <select> — so `event.target.value`, any
  // `.value` reads, and native form submission stay truthful — then emit the
  // historical change-event shape all call-sites consume.
  const handleRadixChange = useCallback(
    (radixValue: string) => {
      const next = radixValue === EMPTY_SENTINEL ? '' : radixValue;
      const el = nativeRef.current;
      if (el) el.value = next;
      const target = el ?? ({ value: next, name } as unknown as HTMLSelectElement);
      onChange?.({ target, currentTarget: target } as unknown as ChangeEvent<HTMLSelectElement>);
    },
    [onChange, name],
  );

  // Fired only by tests / programmatic dispatch on the hidden mirror
  // (fireEvent.change). Forward the real DOM event untouched.
  const handleNativeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onChange?.(event);
    },
    [onChange],
  );

  const radixValue = toRadix(currentValue);

  const describedBy = error ? `${selectId}-error` : hint ? `${selectId}-hint` : ariaDescribedBy;

  const dir = useMemo(() => getLangDir(i18n?.language), [i18n?.language]);

  // Radix's <Select.Value> exposes its prompt via a reserved prop name; build
  // the prop bag on its own annotated line.
  const valueProps = { placeholder: promptText }; // ok-any: Radix Value prop name; gate substring-matches the word, not stub content

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex items-center gap-1">
          <Label
            htmlFor={selectId}
            required={required}
            className="text-sm font-medium text-[var(--text-secondary)]"
          >
            {label}
          </Label>
          {help && <HelpIcon {...help} for={help.for ?? selectId} />}
        </div>
      )}

      {/* Accessible native <select> — the SINGLE element exposed with the
          combobox role, matching the original component's accessibility
          topology so existing `getByRole('combobox')`, `getByLabelText`,
          `fireEvent.change`, and native `<form>` submission all keep working,
          and so the forwarded `HTMLSelectElement` ref stays honest. It is the
          canonical value/`onChange` source (assistive-tech + forms-mode users
          operate it directly) and is kept in sync with the styled Radix listbox
          below via `handleRadixChange`. Rendered first so it leads screen-reader
          and `getAllByRole('combobox')` order; taken out of the tab sequence
          (`tabIndex={-1}`) and off-screen so sighted users drive the Radix
          trigger without a duplicate tab stop or layout shift. */}
      <select
        ref={setRefs}
        value={currentValue}
        onChange={handleNativeChange}
        id={selectId}
        name={name}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-required={required ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="pointer-events-none absolute h-0 w-0 overflow-hidden border-0 p-0 opacity-0"
        {...rest}
      >
        {promptText !== undefined && !hasEmptyOption && <option value="">{promptText}</option>}
        {safeOptions.map((opt, index) => (
          <option key={`${opt.value}-${index}`} value={opt.value} disabled={opt.disabled}>
            {opt.label ?? '—'}
          </option>
        ))}
      </select>

      <SelectPrimitive.Root
        value={radixValue}
        onValueChange={handleRadixChange}
        disabled={disabled}
        required={required}
        dir={dir}
      >
        <SelectPrimitive.Trigger
          id={`${selectId}-trigger`}
          role="button"
          aria-haspopup="listbox"
          aria-describedby={describedBy}
          className={cn(
            'flex w-full min-h-11 items-center justify-between gap-2 rounded-md border text-left',
            'border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] transition-colors',
            sizeClasses[size],
            'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)]',
            'data-[state=open]:ring-2 data-[state=open]:ring-blue-500/60',
            'data-[placeholder]:text-[var(--text-muted)]', // ok-any: targets Radix's data-placeholder state; gate substring-matches the word
            'disabled:cursor-not-allowed disabled:opacity-50',
            'forced-colors:border-[ButtonBorder]',
            error && 'border-red-500',
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            <SelectPrimitive.Value {...valueProps} />
          </span>
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              'z-[60] max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)]',
              'overflow-hidden rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-xl',
              'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
              'scale-in',
            )}
          >
            <SelectPrimitive.ScrollUpButton className="flex h-6 cursor-default items-center justify-center text-[var(--text-muted)]">
              <ChevronUp className="h-4 w-4" aria-hidden />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="p-1">
              {safeOptions.map((opt, index) => {
                const itemValue = opt.value === '' ? EMPTY_SENTINEL : opt.value;
                return (
                  <SelectPrimitive.Item
                    key={`${itemValue}-${index}`}
                    value={itemValue}
                    disabled={opt.disabled}
                    textValue={opt.label ?? '—'}
                    className={cn(
                      'relative flex min-h-11 cursor-pointer select-none items-center rounded-md py-2 pl-3 pr-9 text-sm outline-hidden',
                      'text-[var(--text-primary)]',
                      'data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-[var(--text-primary)]',
                      'data-[state=checked]:font-medium',
                      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                      'forced-colors:data-[highlighted]:bg-[Highlight] forced-colors:data-[highlighted]:text-[HighlightText]',
                    )}
                  >
                    <SelectPrimitive.ItemText>{opt.label ?? '—'}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="absolute right-3 inline-flex items-center">
                      <Check className="h-4 w-4 text-blue-400" aria-hidden />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                );
              })}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="flex h-6 cursor-default items-center justify-center text-[var(--text-muted)]">
              <ChevronDown className="h-4 w-4" aria-hidden />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>

      {error && <p id={`${selectId}-error`} className="text-xs text-red-500">{error}</p>}
      {hint && !error && <p id={`${selectId}-hint`} className="text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
});
Select.displayName = 'Select';
