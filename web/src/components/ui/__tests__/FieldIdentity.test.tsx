import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../Input';
import { Textarea } from '../Textarea';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

afterEach(cleanup);

describe.each([
  ['Input', Input],
  ['Textarea', Textarea],
] as const)('%s — implicit field identity', (_name, Field) => {
  it('associates repeated labels with separate controls and feedback', () => {
    const { container } = render(
      <>
        <Field label="Name" error="First field error" />
        <Field label="Name" hint="Second field help" />
      </>,
    );
    const fields = screen.getAllByRole('textbox', { name: 'Name' });
    const labels = Array.from(container.querySelectorAll('label'));
    expect(fields).toHaveLength(2);
    expect(labels).toHaveLength(2);
    expect(fields[0].id).toBeTruthy();
    expect(fields[1].id).not.toBe(fields[0].id);
    labels.forEach((label, index) => {
      expect(label).toHaveAttribute('for', fields[index].id);
      expect(label.control).toBe(fields[index]);
    });
    expect(document.getElementById(`${fields[0].id}-error`)).toHaveTextContent('First field error');
    expect(document.getElementById(`${fields[1].id}-hint`)).toHaveTextContent('Second field help');
    expect(fields[0]).toHaveAttribute('aria-describedby', `${fields[0].id}-error`);
    expect(fields[1]).toHaveAttribute('aria-describedby', `${fields[1].id}-hint`);
    const ids = Array.from(container.querySelectorAll('[id]'), (node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps identical labels unique in independently mounted parents', () => {
    const first = render(<section><Field label="Name" error="First error" /></section>);
    const second = render(<section><Field label="Name" hint="Second hint" /></section>);
    const a = within(first.container).getByRole('textbox', { name: 'Name' });
    const b = within(second.container).getByRole('textbox', { name: 'Name' });
    expect(a.id).not.toBe(b.id);
    expect(first.container.querySelector('label')?.control).toBe(a);
    expect(second.container.querySelector('label')?.control).toBe(b);
    expect(document.getElementById(`${a.id}-error`)).toHaveTextContent('First error');
    expect(document.getElementById(`${b.id}-hint`)).toHaveTextContent('Second hint');
    first.unmount();
    expect(document.getElementById(`${a.id}-error`)).toBeNull();
    expect(document.getElementById(b.id)).toBe(b);
    expect(b).toHaveAttribute('aria-describedby', `${b.id}-hint`);
  });

  it('retains generated identity and value when a label changes language', () => {
    const { rerender } = render(<Field label="Name" defaultValue="Saved value" hint="Help" />);
    const original = screen.getByRole('textbox', { name: 'Name' });
    const id = original.id;
    rerender(<Field label="名前" defaultValue="Saved value" hint="Help" />);
    const translated = screen.getByRole('textbox', { name: '名前' });
    expect(translated).toBe(original);
    expect(translated.id).toBe(id);
    expect(translated).toHaveValue('Saved value');
    expect(translated).toHaveAttribute('aria-describedby', `${id}-hint`);
    expect(document.getElementById(`${id}-hint`)).toHaveTextContent('Help');
    expect(screen.getByText('名前').closest('label')).toHaveAttribute('for', id);
  });

  it('retains generated identity when a visible label is added or removed', () => {
    const { rerender } = render(<Field aria-label="Field" hint="Help" />);
    const original = screen.getByRole('textbox', { name: 'Field' });
    const id = original.id;
    rerender(<Field label="Visible label" hint="Help" />);
    expect(screen.getByRole('textbox', { name: 'Visible label' }).id).toBe(id);
    rerender(<Field aria-label="Field" hint="Help" />);
    expect(screen.getByRole('textbox', { name: 'Field' })).toBe(original);
    expect(original.id).toBe(id);
  });

  it('preserves explicit IDs, external descriptions and caller form attributes', () => {
    render(
      <>
        <span id="policy-help">Existing policy</span>
        <Field
          id="caller-field"
          label="Name"
          name="original_name"
          required
          disabled
          defaultValue="Original value"
          aria-describedby="policy-help"
          error="Required correction"
        />
      </>,
    );
    const field = screen.getByRole('textbox', { name: /Name/ });
    expect(field.id).toBe('caller-field');
    expect(field).toHaveAttribute('name', 'original_name');
    expect(field).toBeRequired();
    expect(field).toBeDisabled();
    expect(field).toHaveValue('Original value');
    expect(field).toHaveAttribute('aria-describedby', 'policy-help caller-field-error');
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps explicit feedback/external relationships through error, hint and locale changes', () => {
    const view = (label: string, error?: string) => (
      <>
        <span id="external-one">First description</span>
        <span id="external-two">Second description</span>
        <Field
          id="stable-caller-id"
          label={label}
          error={error}
          hint="Field hint"
          aria-describedby="external-one external-two"
        />
      </>
    );
    const { rerender } = render(view('Name', 'Field error'));
    const field = screen.getByRole('textbox', { name: 'Name' });
    expect(field).toHaveAttribute('aria-describedby', 'external-one external-two stable-caller-id-error');
    expect(document.getElementById('stable-caller-id-error')).toHaveTextContent('Field error');
    rerender(view('名前'));
    expect(screen.getByRole('textbox', { name: '名前' })).toBe(field);
    expect(field.id).toBe('stable-caller-id');
    expect(screen.getByText('名前').closest('label')).toHaveAttribute('for', 'stable-caller-id');
    expect(field).toHaveAttribute('aria-describedby', 'external-one external-two stable-caller-id-hint');
    expect(document.getElementById('stable-caller-id-error')).toBeNull();
    expect(document.getElementById('stable-caller-id-hint')).toHaveTextContent('Field hint');
    expect(document.getElementById('external-one')).toHaveTextContent('First description');
    expect(document.getElementById('external-two')).toHaveTextContent('Second description');
  });

  it('changes error feedback to hint without stale associations or value changes', () => {
    const { rerender } = render(<Field label="Name" error="Error" hint="Hint" defaultValue="Keep" />);
    const field = screen.getByRole('textbox', { name: 'Name' });
    const id = field.id;
    expect(document.getElementById(`${id}-hint`)).toBeNull();
    rerender(<Field label="Name" hint="Hint" defaultValue="Keep" />);
    expect(field.id).toBe(id);
    expect(field).toHaveValue('Keep');
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(field).toHaveAttribute('aria-describedby', `${id}-hint`);
    expect(document.getElementById(`${id}-error`)).toBeNull();
    expect(document.getElementById(`${id}-hint`)).toHaveTextContent('Hint');
  });

  it('keeps help readable while its field target uses the unique generated ID', () => {
    render(<Field label="Name" help={{ content: 'Field explanation' }} />);
    const field = screen.getByRole('textbox', { name: 'Name' });
    const help = screen.getByRole('button', { name: 'Help for Name' });
    expect(help).toHaveAttribute('data-help-for', field.id);
    expect(help).not.toHaveAccessibleName(`Help for ${field.id}`);
  });

  it('preserves explicit help target and accessible-name overrides', () => {
    const { rerender } = render(
      <Field label="Name" help={{ content: 'Help', for: 'original-target' }} />,
    );
    expect(screen.getByRole('button', { name: 'Help for original-target' }))
      .toHaveAttribute('data-help-for', 'original-target');
    rerender(
      <Field label="Name" help={{ content: 'Help', for: 'original-target', ariaLabel: 'Custom help name' }} />,
    );
    expect(screen.getByRole('button', { name: 'Custom help name' }))
      .toHaveAttribute('data-help-for', 'original-target');
  });

  it('preserves default helper semantics for an explicit caller ID', () => {
    render(<Field id="explicit-field" label="Name" help={{ content: 'Help' }} />);
    expect(screen.getByRole('button', { name: 'Help for explicit-field' }))
      .toHaveAttribute('data-help-for', 'explicit-field');
  });

  it('preserves empty help.for as explicit, without deriving a label or field target', () => {
    render(<Field label="Name" help={{ content: 'Help', for: '' }} />);
    const trigger = screen.getByRole('button', { name: 'More info' });
    expect(trigger).toHaveAttribute('data-help-for', '');
    const tooltip = screen.getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')?.split(/\s+/)).toEqual([tooltip.id]);
  });

  it('preserves empty help.ariaLabel instead of falling through to an inferred name', () => {
    render(<Field label="Name" help={{ content: 'Help', for: 'original-target', ariaLabel: '' }} />);
    const trigger = screen.getByRole('button', { name: '' });
    expect(trigger).toHaveAttribute('aria-label', '');
    expect(trigger).toHaveAttribute('data-help-for', 'original-target');
    const tooltip = screen.getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')?.split(/\s+/)).toEqual([tooltip.id]);
    expect(document.getElementById(tooltip.id)).toBe(tooltip);
    expect(trigger.getAttribute('aria-describedby')?.split(/\s+/)).not.toContain('original-target-help');
  });
});

it('keeps IDs distinct across primitives with the same visible label', () => {
  render(<><Input label="Notes" /><Textarea label="Notes" /></>);
  const fields = screen.getAllByRole('textbox', { name: 'Notes' });
  expect(fields).toHaveLength(2);
  expect(fields[0].id).not.toBe(fields[1].id);
});

it('preserves forwarded refs and controlled onChange for both primitives', () => {
  const input = createRef<HTMLInputElement>();
  const textarea = createRef<HTMLTextAreaElement>();
  const inputChange = vi.fn();
  const textareaChange = vi.fn();
  render(
    <>
      <Input label="Name" ref={input} value="Input value" onChange={inputChange} />
      <Textarea label="Name" ref={textarea} value="Textarea value" onChange={textareaChange} />
    </>,
  );
  expect(input.current).toBe(screen.getAllByRole('textbox', { name: 'Name' })[0]);
  expect(textarea.current).toBe(screen.getAllByRole('textbox', { name: 'Name' })[1]);
  fireEvent.change(input.current!, { target: { value: 'Changed input' } });
  fireEvent.change(textarea.current!, { target: { value: 'Changed textarea' } });
  expect(inputChange).toHaveBeenCalledTimes(1);
  expect(textareaChange).toHaveBeenCalledTimes(1);
});
