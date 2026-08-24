/**
 * `<Select>` primitive tests.
 *
 * Locks down the full contract of the shared form select:
 *   - option rendering (incl. per-option value/label/disabled) and the
 *     null-safe `?? []` guard so a nullish `options` never `.map`s on undefined,
 *   - placeholder empty-value option,
 *   - id resolution (explicit id › label slug › stable `useId` fallback that
 *     never collapses to `undefined-error`),
 *   - required forwarding + `aria-required`,
 *   - error state (message node, `aria-invalid`, `aria-describedby`, red border),
 *   - hint state and the error-takes-precedence-over-hint branch,
 *   - size variants, className passthrough, ref forwarding, native prop spread,
 *   - the onChange path, and the label-paired `<HelpIcon>` affordance.
 *
 * `react-i18next` is mocked (the transitive `<Label>` / `<HelpIcon>` reach for
 * `t`) so assertions are deterministic. Interactions use `fireEvent` — the repo
 * does not depend on `@testing-library/user-event`.
 */
import { createRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | { defaultValue?: string; field?: string }) => {
      if (typeof opts === 'string') return opts || key;
      if (opts) {
        if (key === 'a11y.helpFor' && opts.field) return `Help for ${opts.field}`;
        if (opts.defaultValue) return opts.defaultValue;
      }
      return key;
    },
  }),
}));

import { Select, type SelectOption } from './Select';

const OPTIONS: SelectOption[] = [
  { value: 'model-s', label: 'Model S' },
  { value: 'model-3', label: 'Model 3' },
  { value: 'model-x', label: 'Model X', disabled: true },
];

afterEach(() => cleanup());

describe('Select — option rendering', () => {
  it('renders one <option> per provided option with the right value/label/disabled', () => {
    const { container } = render(<Select options={OPTIONS} />);
    const opts = container.querySelectorAll('option');
    expect(opts).toHaveLength(3);
    expect((opts[0] as HTMLOptionElement).value).toBe('model-s');
    expect(opts[0].textContent).toBe('Model S');
    expect((opts[1] as HTMLOptionElement).value).toBe('model-3');
    expect((opts[2] as HTMLOptionElement).disabled).toBe(true);
  });

  it('prepends a leading empty-value option when a placeholder is supplied', () => {
    const { container } = render(<Select options={OPTIONS} placeholder="Choose a model" />);
    const opts = container.querySelectorAll('option');
    expect(opts).toHaveLength(4);
    expect((opts[0] as HTMLOptionElement).value).toBe('');
    expect(opts[0].textContent).toBe('Choose a model');
  });

  it('renders no empty-value option when placeholder is omitted', () => {
    const { container } = render(<Select options={OPTIONS} />);
    const hasEmpty = Array.from(container.querySelectorAll('option')).some(
      (o) => (o as HTMLOptionElement).value === '',
    );
    expect(hasEmpty).toBe(false);
  });

  it('is null-safe: a nullish options prop renders the control without crashing', () => {
    const { container } = render(
      <Select options={undefined as unknown as SelectOption[]} placeholder="Empty" />,
    );
    const select = container.querySelector('select');
    expect(select).not.toBeNull();
    // Only the placeholder survives — the `?? []` guard stops `.map` on undefined.
    expect(container.querySelectorAll('option')).toHaveLength(1);
  });
});

describe('Select — id resolution', () => {
  it('derives a slugified id from the label and wires the <label htmlFor>', () => {
    render(<Select options={OPTIONS} label="Vehicle Type" />);
    const select = screen.getByLabelText('Vehicle Type');
    expect(select.id).toBe('vehicle-type');
    expect(document.querySelector('label[for="vehicle-type"]')).not.toBeNull();
  });

  it('prefers an explicit id over the label-derived slug', () => {
    render(<Select options={OPTIONS} label="Vehicle Type" id="custom-id" />);
    const select = screen.getByLabelText('Vehicle Type');
    expect(select.id).toBe('custom-id');
  });

  it('falls back to a stable, non-"undefined" useId when neither id nor label is given', () => {
    const { container } = render(<Select options={OPTIONS} error="Bad" />);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.id).toMatch(/^select-/);
    expect(select.id).not.toContain('undefined');
    // The described-by target is derived from the SAME stable id, so it never
    // collapses to the invalid, duplicated `undefined-error`.
    const describedBy = select.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toBe(`${select.id}-error`);
    expect(describedBy).not.toContain('undefined');
    expect(document.getElementById(describedBy)).not.toBeNull();
  });
});

describe('Select — required', () => {
  it('forwards required to the native <select> and mirrors it as aria-required', () => {
    const { container } = render(<Select options={OPTIONS} label="Model" required />);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.required).toBe(true);
    expect(select.getAttribute('aria-required')).toBe('true');
  });

  it('omits aria-required entirely when not required', () => {
    const { container } = render(<Select options={OPTIONS} label="Model" />);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.getAttribute('aria-required')).toBeNull();
  });
});

describe('Select — error state', () => {
  it('renders the error message, marks the control invalid, and wires aria-describedby', () => {
    render(<Select options={OPTIONS} label="Model" error="Please pick a model" />);
    const select = screen.getByLabelText('Model');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    const errorEl = document.getElementById('model-error');
    expect(errorEl?.textContent).toBe('Please pick a model');
    expect(select.getAttribute('aria-describedby')).toBe('model-error');
  });

  it('applies the red border class when in error', () => {
    const { container } = render(<Select options={OPTIONS} label="Model" error="x" />);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.className).toContain('border-rose-500');
  });
});

describe('Select — hint state', () => {
  it('renders the hint and points aria-describedby at it when there is no error', () => {
    render(<Select options={OPTIONS} label="Model" hint="Pick your trim" />);
    const select = screen.getByLabelText('Model');
    expect(select.getAttribute('aria-invalid')).toBeNull();
    expect(document.getElementById('model-hint')?.textContent).toBe('Pick your trim');
    expect(select.getAttribute('aria-describedby')).toBe('model-hint');
  });

  it('lets error win over hint: hint is not rendered and describedby targets the error', () => {
    render(<Select options={OPTIONS} label="Model" error="Bad" hint="Ignored hint" />);
    const select = screen.getByLabelText('Model');
    expect(document.getElementById('model-hint')).toBeNull();
    expect(screen.queryByText('Ignored hint')).toBeNull();
    expect(select.getAttribute('aria-describedby')).toBe('model-error');
  });

  it('omits aria-describedby when neither error nor hint is present', () => {
    const { container } = render(<Select options={OPTIONS} label="Model" />);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.getAttribute('aria-describedby')).toBeNull();
  });
});

describe('Select — size variants', () => {
  it('applies md sizing utilities by default', () => {
    const { container } = render(<Select options={OPTIONS} />);
    expect((container.querySelector('select') as HTMLSelectElement).className).toContain('text-sm');
  });

  const sizeCases: Array<['sm' | 'lg' | 'auto', string]> = [
    ['sm', 'min-h-9'],
    ['lg', 'text-base'],
    ['auto', 'min-h-d-row'],
  ];
  it.each(sizeCases)('applies %s sizing utilities', (size, expected) => {
    const { container } = render(<Select options={OPTIONS} size={size} />);
    expect((container.querySelector('select') as HTMLSelectElement).className).toContain(expected);
  });
});

describe('Select — passthrough, ref, and interaction', () => {
  it('merges a custom className onto the native <select>', () => {
    const { container } = render(<Select options={OPTIONS} className="my-custom-class" />);
    expect((container.querySelector('select') as HTMLSelectElement).className).toContain(
      'my-custom-class',
    );
  });

  it('forwards the ref to the underlying <select> element', () => {
    const ref = createRef<HTMLSelectElement>();
    render(<Select options={OPTIONS} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
    expect(ref.current?.tagName).toBe('SELECT');
  });

  it('spreads arbitrary native props (name, disabled, data-*) onto the <select>', () => {
    const { container } = render(
      <Select options={OPTIONS} name="model" disabled data-testid="model-select" />,
    );
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.name).toBe('model');
    expect(select.disabled).toBe(true);
    expect(select.getAttribute('data-testid')).toBe('model-select');
    expect(select.className).toContain('disabled:bg-[var(--surface-2)]');
    expect(select.className).toContain('disabled:text-[var(--text-secondary)]');
    expect(select.className).toContain('disabled:opacity-100');
    expect(select.className).not.toContain('disabled:opacity-50');
  });

  it('fires onChange and reflects the chosen value when the user selects an option', () => {
    const onChange = vi.fn();
    render(<Select options={OPTIONS} label="Model" onChange={onChange} />);
    const select = screen.getByLabelText('Model') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'model-3' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(select.value).toBe('model-3');
  });
});

describe('Select — help affordance', () => {
  it('renders a per-field HelpIcon after the label when help is provided', () => {
    render(
      <Select options={OPTIONS} label="Notify Mode" help={{ content: 'When to notify you' }} />,
    );
    expect(screen.getByRole('button', { name: 'Help for notify-mode' })).toBeInTheDocument();
  });

  it('lets help.for override the field name announced in the trigger aria-label', () => {
    render(
      <Select options={OPTIONS} label="Notify Mode" help={{ content: 'x', for: 'custom-target' }} />,
    );
    expect(screen.getByRole('button', { name: 'Help for custom-target' })).toBeInTheDocument();
  });

  it('does not render help when there is no label (help pairs with the label)', () => {
    render(<Select options={OPTIONS} help={{ content: 'orphan help' }} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
