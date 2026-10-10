/**
 * `<Textarea>` primitive contract tests.
 *
 * Locks in the behaviour feature forms depend on:
 *   1. Renders a native `<textarea>` (role="textbox") and spreads arbitrary
 *      DOM props (placeholder, rows, maxLength, name, aria-label).
 *   2. The optional `label` renders an associated `<label>` (htmlFor === id)
 *      and, together with `required`, wires the visible/SR required marker
 *      plus `required` + `aria-required` on the control.
 *   3. The `size` scale maps to the right spacing/text utilities (md default),
 *      and a caller `className` merges + wins conflicts via cn().
 *   4. The `error` string is programmatically associated: the control gets
 *      `aria-invalid="true"` and `aria-describedby` pointing at the error
 *      paragraph's id — even for an aria-label-only textarea (useId fallback).
 *   5. Hint/error feedback merges with caller-supplied descriptions.
 *   6. The optional `help` renders a HelpIcon whose accessible name defaults
 *      to "Help for {id}" and honours an explicit `help.for` override.
 *   7. The ref forwards to the underlying `<textarea>` and onChange fires.
 *
 * `@testing-library/user-event` is not installed in this repo, so user
 * interactions are driven with `fireEvent` (matching Card / EditableText /
 * HelpIcon tests). react-i18next is mocked so Label's required marker and
 * HelpIcon's aria-label resolve without an i18n provider.
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRef } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      maybeOpts?: Record<string, unknown>,
    ) => {
      // Signature A: t(key, 'Default string'[, interpolations])
      if (typeof defaultOrOpts === 'string') {
        const template = defaultOrOpts || key;
        if (!maybeOpts) return template;
        return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
          String(maybeOpts[name] ?? `{{${name}}}`),
        );
      }
      // Signature B: t(key, { defaultValue, ...interpolations })
      const opts = defaultOrOpts ?? {};
      const template =
        (typeof opts.defaultValue === 'string' && opts.defaultValue) || key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String(opts[name] ?? `{{${name}}}`),
      );
    },
  }),
}));

import { Textarea } from './Textarea';

afterEach(cleanup);

describe('Textarea — rendering & prop spread', () => {
  it('renders a native <textarea> reachable via role="textbox"', () => {
    render(<Textarea aria-label="Comment" />);
    const el = screen.getByRole('textbox', { name: 'Comment' });
    expect(el.tagName).toBe('TEXTAREA');
  });

  it('spreads arbitrary DOM attributes onto the textarea', () => {
    render(
      <Textarea
        aria-label="Comment"
        placeholder="Type here…"
        rows={5}
        maxLength={120}
        name="comment"
      />,
    );
    const el = screen.getByRole('textbox', { name: 'Comment' });
    expect(el).toHaveAttribute('placeholder', 'Type here…');
    expect(el).toHaveAttribute('rows', '5');
    expect(el).toHaveAttribute('maxlength', '120');
    expect(el).toHaveAttribute('name', 'comment');
  });

  it('renders no <label> element when the label prop is omitted', () => {
    const { container } = render(<Textarea aria-label="Comment" />);
    expect(container.querySelector('label')).toBeNull();
  });
});

describe('Textarea — label association', () => {
  it('renders a <label> whose htmlFor matches the textarea id (accessible name)', () => {
    render(<Textarea label="Notes" />);
    // getByRole with a name only resolves when the label is programmatically
    // associated via for/id — this is the accessibility contract.
    const el = screen.getByRole('textbox', { name: 'Notes' });
    const label = screen.getByText('Notes').closest('label') as HTMLLabelElement;
    expect(label).not.toBeNull();
    expect(label.getAttribute('for')).toBe(el.id);
  });

  it('uses a generated id independent of the visible label', () => {
    render(<Textarea label="Release Notes" />);
    const el = screen.getByRole('textbox', { name: 'Release Notes' });
    expect(el.id).toBeTruthy();
    expect(el.id).not.toBe('release-notes');
  });

  it('preserves an explicit caller id', () => {
    render(<Textarea label="Notes" id="custom-id" />);
    const el = screen.getByRole('textbox', { name: 'Notes' });
    expect(el.id).toBe('custom-id');
  });
});

describe('Textarea — sizing', () => {
  it('applies the md scale (text-sm) by default', () => {
    render(<Textarea aria-label="C" />);
    expect(screen.getByRole('textbox', { name: 'C' }).className).toContain('text-sm');
  });

  it.each([
    ['sm', 'text-xs'],
    ['md', 'text-sm'],
    ['lg', 'text-base'],
    ['auto', 'text-d-base'],
  ] as const)('maps size="%s" to the "%s" utility', (size, cls) => {
    render(<Textarea aria-label="C" size={size} />);
    expect(screen.getByRole('textbox', { name: 'C' }).className).toContain(cls);
  });

  it('keeps the density font-size for size="auto" (tailwind-merge ordering guard)', () => {
    // Regression guard: the density utility text-d-base shares a
    // tailwind-merge group with the arbitrary colour text-[var(--text-primary)].
    // If sizeClasses is ever reordered before the colour base again, the
    // density size is silently stripped and size="auto" does nothing.
    render(<Textarea aria-label="C" size="auto" />);
    const className = screen.getByRole('textbox', { name: 'C' }).className;
    expect(className).toContain('text-d-base');
    expect(className).toContain('px-d-pad-x');
    expect(className).toContain('py-d-pad-y');
  });

  it('merges a caller className and resolves conflicts via cn() (tailwind-merge)', () => {
    render(<Textarea aria-label="C" className="rounded-none" />);
    const className = screen.getByRole('textbox', { name: 'C' }).className;
    // caller's rounded-none must win over the shared control shape.
    expect(className).toContain('rounded-none');
    expect(className).not.toContain('rounded-shape-sm');
  });
});

describe('Textarea — required', () => {
  it('sets the required attribute and aria-required when required', () => {
    render(<Textarea label="Notes" required />);
    const el = screen.getByRole('textbox', { name: /Notes/ });
    expect(el).toBeRequired();
    expect(el).toHaveAttribute('aria-required', 'true');
  });

  it('renders a visible (aria-hidden) required marker inside the label', () => {
    const { container } = render(<Textarea label="Notes" required />);
    const marker = container.querySelector('[aria-hidden="true"]');
    expect(marker).not.toBeNull();
    expect(marker).toHaveTextContent('*');
  });

  it('omits aria-required and the required attribute when not required', () => {
    render(<Textarea label="Notes" />);
    const el = screen.getByRole('textbox', { name: 'Notes' });
    expect(el).not.toBeRequired();
    expect(el).not.toHaveAttribute('aria-required');
  });
});

describe('Textarea — error a11y wiring', () => {
  it('associates the error message via aria-invalid + aria-describedby', () => {
    render(<Textarea label="Notes" error="Notes are required" />);
    const el = screen.getByRole('textbox', { name: 'Notes' });
    expect(el).toHaveAttribute('aria-invalid', 'true');

    const describedBy = el.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const errorEl = document.getElementById(describedBy as string);
    expect(errorEl).not.toBeNull();
    expect(errorEl).toHaveTextContent('Notes are required');
    expect(screen.getByRole('alert')).toBe(errorEl);
  });

  it('applies the error border utility when an error is present', () => {
    render(<Textarea label="Notes" error="bad" />);
    expect(screen.getByRole('textbox', { name: 'Notes' }).className).toContain('border-[var(--semantic-danger)]');
  });

  it('associates the error even for an aria-label-only textarea (useId fallback)', () => {
    // No id and no label — the useId fallback must still yield a resolvable
    // aria-describedby target so the error is announced to screen readers.
    render(<Textarea aria-label="Comment" error="Too long" />);
    const el = screen.getByRole('textbox', { name: 'Comment' });
    const describedBy = el.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent('Too long');
  });

  it('renders no error paragraph and no invalid state when error is absent', () => {
    render(<Textarea label="Notes" />);
    const el = screen.getByRole('textbox', { name: 'Notes' });
    expect(el).not.toHaveAttribute('aria-invalid');
    expect(el).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText('Notes are required')).toBeNull();
  });

  it('gives two error textareas distinct describedby ids (no collision)', () => {
    render(
      <>
        <Textarea aria-label="First" error="err a" />
        <Textarea aria-label="Second" error="err b" />
      </>,
    );
    const a = screen.getByRole('textbox', { name: 'First' }).getAttribute('aria-describedby');
    const b = screen.getByRole('textbox', { name: 'Second' }).getAttribute('aria-describedby');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('renders a hint and preserves a caller-supplied description association', () => {
    render(
      <>
        <span id="external-help">External help</span>
        <Textarea
          label="Notes"
          hint="Up to 120 characters"
          aria-describedby="external-help"
        />
      </>,
    );
    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    expect(textarea).toHaveAttribute(
      'aria-describedby',
      `external-help ${textarea.id}-hint`,
    );
    expect(document.getElementById(`${textarea.id}-hint`)).toHaveTextContent(
      'Up to 120 characters',
    );
  });
});

describe('Textarea — help icon', () => {
  it('names implicit field help using the visible label, not the generated id', () => {
    render(<Textarea label="Notes" help={{ content: 'Explain the field' }} />);
    expect(screen.getByRole('button', { name: 'Help for Notes' })).toBeInTheDocument();
  });

  it('honours an explicit help.for override for the trigger label', () => {
    render(
      <Textarea label="Notes" help={{ content: 'x', for: 'custom-target' }} />,
    );
    expect(
      screen.getByRole('button', { name: 'Help for custom-target' }),
    ).toBeInTheDocument();
  });

  it('renders no help trigger when help is omitted', () => {
    render(<Textarea label="Notes" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Textarea — ref & interaction', () => {
  it('forwards its ref to the underlying <textarea>', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea aria-label="C" ref={ref} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('TEXTAREA');
  });

  it('fires onChange and reflects the typed value', () => {
    const onChange = vi.fn();
    render(<Textarea aria-label="Comment" onChange={onChange} />);
    const el = screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;
    fireEvent.change(el, { target: { value: 'hello world' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(el.value).toBe('hello world');
  });

  it('respects the disabled attribute', () => {
    render(<Textarea aria-label="Comment" disabled />);
    const textarea = screen.getByRole('textbox', { name: 'Comment' });
    expect(textarea).toBeDisabled();
    expect(textarea.className).toContain('disabled:bg-[var(--surface-2)]');
    expect(textarea.className).toContain('disabled:text-[var(--text-secondary)]');
    expect(textarea.className).toContain('disabled:opacity-100');
  });
});

describe('Textarea — restrained states and preservation', () => {
  it('keeps implicit identity, value, focus and descriptions across translated labels', () => {
    const { rerender } = render(
      <Textarea label="Notes" defaultValue="Saved notes" hint="Description" />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    const id = textarea.id;
    textarea.focus();

    rerender(<Textarea label="Notizen" defaultValue="Saved notes" hint="Beschreibung" />);

    expect(screen.getByRole('textbox', { name: 'Notizen' })).toBe(textarea);
    expect(textarea.id).toBe(id);
    expect(textarea).toHaveFocus();
    expect(textarea).toHaveValue('Saved notes');
    expect(textarea).toHaveAttribute('aria-describedby', `${id}-hint`);
    expect(document.getElementById(`${id}-hint`)).toHaveTextContent('Beschreibung');
  });

  it('retains explicit ids, including an intentionally empty caller id', () => {
    const { rerender } = render(<Textarea label="Notes" id="saved-setting" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('id', 'saved-setting');
    rerender(<Textarea label="Notizen" id="saved-setting" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('id', 'saved-setting');
    rerender(<Textarea aria-label="Comment" id="" />);
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveAttribute('id', '');
  });

  it('switches hint and error while retaining every external description', () => {
    const { rerender } = render(
      <>
        <span id="context">Context</span>
        <span id="limits">Limits</span>
        <Textarea id="notes" label="Notes" hint="Hint" aria-describedby="context limits" />
      </>,
    );
    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    expect(textarea).toHaveAttribute('aria-describedby', 'context limits notes-hint');
    rerender(
      <>
        <span id="context">Context</span>
        <span id="limits">Limits</span>
        <Textarea id="notes" label="Notes" hint="Hint" error="Invalid" aria-describedby="context limits" />
      </>,
    );
    expect(textarea).toHaveAttribute('aria-describedby', 'context limits notes-error');
    expect(screen.queryByText('Hint')).toBeNull();
    expect(screen.getByRole('alert')).toHaveClass('text-[var(--semantic-danger)]');
    rerender(
      <>
        <span id="context">Context</span>
        <span id="limits">Limits</span>
        <Textarea id="notes" label="Notes" hint="Hint" aria-describedby="context limits" />
      </>,
    );
    expect(textarea).toHaveAttribute('aria-describedby', 'context limits notes-hint');
    expect(textarea).not.toHaveAttribute('aria-invalid');
  });

  it('retains native form ownership, serialization, reset and constraints', () => {
    render(
      <>
        <form id="notes-form" />
        <Textarea
          aria-label="Comment"
          form="notes-form"
          name="comment"
          defaultValue="Original"
          required
          minLength={2}
          wrap="hard"
          readOnly
        />
      </>,
    );
    const textarea = screen.getByRole('textbox', { name: 'Comment' });
    const form = document.getElementById('notes-form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Expected native form');
    expect(new FormData(form).get('comment')).toBe('Original');
    expect(textarea).toHaveAttribute('minlength', '2');
    expect(textarea).toHaveAttribute('wrap', 'hard');
    expect(textarea).toHaveAttribute('readonly');
    fireEvent.change(textarea, { target: { value: 'Changed' } });
    form.reset();
    expect(textarea).toHaveValue('Original');
  });

  it('uses a semantic invalid border and visible offset focus without decorative glow', () => {
    render(<Textarea aria-label="Comment" error="Invalid" />);
    const textarea = screen.getByRole('textbox', { name: 'Comment' });
    expect(textarea).toHaveClass(
      'border-[var(--semantic-danger)]',
      'focus-visible:border-[var(--semantic-danger)]',
      'focus-visible:outline-2',
      'focus-visible:outline-offset-2',
      'focus-visible:outline-[var(--focus-ring)]',
    );
    expect(textarea.className).not.toMatch(/rose-|neon-|shadow-|ring-2/);
  });

  it('wraps long labels and feedback while preserving reachable mobile and dense desktop controls', () => {
    const label = 'LangesWort'.repeat(30);
    render(<Textarea label={label} hint={label} rows={1} size="auto" />);
    const textarea = screen.getByRole('textbox', { name: label });
    expect(screen.getAllByText(label)[0].closest('label')).toHaveClass('min-w-0', 'break-words');
    expect(document.getElementById(`${textarea.id}-hint`)).toHaveClass('break-words');
    expect(textarea).toHaveClass('min-h-11', 'md:min-h-0', 'min-w-0', 'max-w-full');
    expect(textarea).toHaveClass('px-d-pad-x', 'py-d-pad-y', 'text-d-base');
    expect(textarea).toHaveAttribute('rows', '1');
  });

  it('preserves default vertical resizing and caller resizing overrides', () => {
    const { rerender } = render(<Textarea aria-label="Comment" />);
    expect(screen.getByRole('textbox')).toHaveClass('resize-y');
    rerender(<Textarea aria-label="Comment" className="resize-none" />);
    expect(screen.getByRole('textbox')).toHaveClass('resize-none');
    expect(screen.getByRole('textbox')).not.toHaveClass('resize-y');
  });

  it('uses existing motion tokens and the reduced-motion safety net', () => {
    render(<Textarea aria-label="Comment" />);
    expect(screen.getByRole('textbox')).toHaveClass(
      'transition-colors',
      'duration-fast',
      'ease-standard',
      'motion-reduce:transition-none',
    );
  });
});
