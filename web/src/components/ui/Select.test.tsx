/**
 * `<Select>` primitive tests.
 *
 * Locks down the full contract of the shared form select:
 *   - option rendering (incl. per-option value/label/disabled) and the
 *     null-safe `?? []` guard so a nullish `options` never `.map`s on undefined,
 *   - placeholder empty-value option,
 *   - id resolution (explicit id › stable locale-independent `useId` fallback that
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
  it('derives a stable implicit id and wires the <label htmlFor>', () => {
    render(<Select options={OPTIONS} label="Vehicle Type" />);
    const select = screen.getByLabelText('Vehicle Type');
    expect(select.id).toMatch(/^select-/);
    expect(document.querySelector('label')?.htmlFor).toBe(select.id);
  });

  it('prefers an explicit id over the implicit id', () => {
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
    const errorEl = document.getElementById(`${select.id}-error`);
    expect(errorEl?.textContent).toBe('Please pick a model');
    expect(select.getAttribute('aria-describedby')).toBe(`${select.id}-error`);
    expect(screen.getByRole('alert')).toHaveTextContent('Please pick a model');
  });

  it('applies the semantic danger border when in error', () => {
    const { container } = render(<Select options={OPTIONS} label="Model" error="x" />);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.className).toContain('border-[var(--semantic-danger)]');
  });
});

describe('Select — hint state', () => {
  it('renders the hint and points aria-describedby at it when there is no error', () => {
    render(<Select options={OPTIONS} label="Model" hint="Pick your trim" />);
    const select = screen.getByLabelText('Model');
    expect(select.getAttribute('aria-invalid')).toBeNull();
    expect(document.getElementById(`${select.id}-hint`)?.textContent).toBe('Pick your trim');
    expect(select.getAttribute('aria-describedby')).toBe(`${select.id}-hint`);
  });

  it('lets error win over hint: hint is not rendered and describedby targets the error', () => {
    render(<Select options={OPTIONS} label="Model" error="Bad" hint="Ignored hint" />);
    const select = screen.getByLabelText('Model');
    expect(document.getElementById(`${select.id}-hint`)).toBeNull();
    expect(screen.queryByText('Ignored hint')).toBeNull();
    expect(select.getAttribute('aria-describedby')).toBe(`${select.id}-error`);
  });

  it('omits aria-describedby when neither error nor hint is present', () => {
    const { container } = render(<Select options={OPTIONS} label="Model" />);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.getAttribute('aria-describedby')).toBeNull();
  });

  it('preserves caller descriptions while appending the hint association', () => {
    render(
      <>
        <span id="external-help">External help</span>
        <Select
          options={OPTIONS}
          label="Model"
          hint="Pick your trim"
          aria-describedby="external-help"
        />
      </>,
    );
    const select = screen.getByLabelText('Model');
    expect(select).toHaveAttribute(
      'aria-describedby',
      `external-help ${select.id}-hint`,
    );
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
    expect(screen.getByRole('button', { name: 'Help for Notify Mode' })).toBeInTheDocument();
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

describe('Select — identity and native form preservation', () => {
  it('retains identity, focus, value and descriptions when the label is translated', () => {
    const ref = createRef<HTMLSelectElement>();
    const { rerender } = render(
      <Select ref={ref} options={OPTIONS} label="Vehicle" hint="Choose" aria-describedby="external" help={{ content: 'Help' }} />,
    );
    const select = screen.getByLabelText('Vehicle');
    const id = select.id;
    fireEvent.change(select, { target: { value: 'model-3' } });
    select.focus();
    rerender(
      <Select ref={ref} options={OPTIONS} label="Fahrzeug" hint="Wählen" aria-describedby="external" help={{ content: 'Hilfe' }} />,
    );
    expect(screen.getByLabelText('Fahrzeug')).toBe(select);
    expect(select.id).toBe(id);
    expect(ref.current?.value).toBe('model-3');
    expect(document.activeElement).toBe(select);
    expect(select).toHaveAttribute('aria-describedby', `external ${id}-hint`);
    expect(document.getElementById(`${id}-hint`)).toHaveTextContent('Wählen');
    expect(screen.getByRole('button', { name: 'Help for Fahrzeug' })).toHaveAttribute('data-help-for', id);
  });

  it('gives repeated labels distinct control and feedback identities', () => {
    render(<><Select options={OPTIONS} label="Model" error="First" /><Select options={OPTIONS} label="Model" hint="Second" /></>);
    const [first, second] = screen.getAllByLabelText('Model');
    expect(first.id).not.toBe(second.id);
    expect(first).toHaveAttribute('aria-describedby', `${first.id}-error`);
    expect(second).toHaveAttribute('aria-describedby', `${second.id}-hint`);
    expect(document.getElementById(`${first.id}-error`)).toHaveTextContent('First');
    expect(document.getElementById(`${second.id}-hint`)).toHaveTextContent('Second');
  });

  it('preserves explicit IDs, help names and empty overrides', () => {
    const { rerender } = render(<Select options={OPTIONS} id="saved-model" label="Model" help={{ content: 'Help' }} />);
    expect(screen.getByRole('button', { name: 'Help for saved-model' })).toHaveAttribute('data-help-for', 'saved-model');
    rerender(<Select options={OPTIONS} id="saved-model" label="Modell" error="Bad" aria-describedby="external" help={{ content: 'Help', for: '', ariaLabel: '' }} />);
    expect(screen.getByLabelText('Modell')).toHaveAttribute('id', 'saved-model');
    expect(screen.getByLabelText('Modell')).toHaveAttribute('aria-describedby', 'external saved-model-error');
    expect(screen.getByRole('button', { name: '' })).toHaveAttribute('data-help-for', '');
    expect(screen.getByRole('button', { name: '' })).toHaveAttribute('aria-label', '');
  });

  it('retains zero-valued options, required validation and native form data', () => {
    const { container } = render(
      <form id="native-form">
        <Select options={[{ value: '0', label: 'Zero' }]} label="Count" placeholder="Choose" name="count" required defaultValue="" />
      </form>,
    );
    const form = container.querySelector('form');
    const select = screen.getByRole('combobox', { name: 'Count required' });
    expect(form?.checkValidity()).toBe(false);
    fireEvent.change(select, { target: { value: '0' } });
    expect(form?.checkValidity()).toBe(true);
    expect(form && new FormData(form).get('count')).toBe('0');
    form?.reset();
    expect(form?.checkValidity()).toBe(false);
  });

  it('keeps controlled changes and the full long option label', () => {
    const label = 'Very long localized vehicle model description '.repeat(10);
    const onChange = vi.fn();
    const { rerender } = render(<Select options={[{ value: '0', label }]} label={label} value="" placeholder="Choose" onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: label.trim() });
    fireEvent.change(select, { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    rerender(<Select options={[{ value: '0', label }]} label={label} value="0" onChange={onChange} />);
    expect(select).toHaveValue('0');
    expect(screen.getByRole('option')).toHaveTextContent(label.trim());
    expect(document.querySelector('label')).toHaveClass('min-w-0', 'break-words');
  });

  it('uses bounded focus and motion with reachable fixed sizes without replacing density auto', () => {
    const { rerender } = render(<Select options={OPTIONS} size="sm" />);
    const select = screen.getByRole('combobox');
    expect(select).toHaveClass('min-h-11', 'md:min-h-9', 'focus-visible:ring-offset-2', 'motion-reduce:transition-none');
    rerender(<Select options={OPTIONS} size="md" />);
    expect(select).toHaveClass('min-h-11', 'md:min-h-10');
    rerender(<Select options={OPTIONS} size="auto" />);
    expect(select).toHaveClass('min-h-d-row');
    expect(select).not.toHaveClass('min-h-11');
  });
});
