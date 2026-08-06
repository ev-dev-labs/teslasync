/**
 * `<Toggle>` switch primitive tests.
 *
 * Locks down the full contract of the shared WAI-ARIA switch:
 *   - it renders a real `role="switch"` `<button type="button">` whose
 *     `aria-checked` faithfully mirrors the `checked` prop (and is *never*
 *     dropped — a nullish prop falls back to "false" so the state is always
 *     announced),
 *   - the accessible name comes from the visible `label` (associated via
 *     `aria-labelledby`) and, when there is no visible label, from a
 *     caller-supplied `aria-label` / `aria-labelledby` that lands on the
 *     interactive button rather than the neutral wrapper `<div>`,
 *   - `aria-describedby` / `title` are forwarded to the button too,
 *   - clicking the button, the visible label, or the wrapper toggles exactly
 *     once (the wrapper's `closest('button')` guard prevents a double-fire),
 *   - `size` variants, on/off track colours, and thumb travel,
 *   - className passthrough, ref forwarding to the wrapper, and native prop
 *     spread onto the wrapper.
 *
 * `@testing-library/user-event` is not installed in this repo, so
 * interactions are driven via `fireEvent` — matching every other component
 * test here (Select, Slider, FullscreenButton). The rendered `<button>` is a
 * real native button, so Space/Enter activation is browser-native; a
 * `fireEvent.click` is the faithful stand-in for that activation in jsdom.
 * The component uses no i18n or network, so nothing needs mocking.
 */
import { createRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { Toggle } from './Toggle';

afterEach(() => cleanup());

function getThumb(sw: HTMLElement): HTMLElement {
  const thumb = sw.querySelector('span[aria-hidden="true"]');
  if (!thumb) throw new Error('thumb decoration not found');
  return thumb as HTMLElement;
}

describe('Toggle — role + checked state', () => {
  it('renders a role="switch" button reflecting the unchecked state', () => {
    render(<Toggle checked={false} onChange={() => {}} aria-label="Sync" />);
    const sw = screen.getByRole('switch', { name: 'Sync' });
    expect(sw.tagName).toBe('BUTTON');
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects the checked state via aria-checked="true"', () => {
    render(<Toggle checked onChange={() => {}} aria-label="Sync" />);
    expect(screen.getByRole('switch', { name: 'Sync' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('flips aria-checked on a controlled re-render', () => {
    const { rerender } = render(
      <Toggle checked={false} onChange={() => {}} aria-label="Sync" />,
    );
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    rerender(<Toggle checked onChange={() => {}} aria-label="Sync" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('renders a native <button type="button"> so it is keyboard-operable and never submits a form', () => {
    render(<Toggle checked={false} onChange={() => {}} aria-label="Sync" />);
    const sw = screen.getByRole('switch');
    expect(sw.tagName).toBe('BUTTON');
    expect(sw).toHaveAttribute('type', 'button');
    // Native buttons are focusable — the a11y contract relies on that for
    // Space/Enter activation.
    sw.focus();
    expect(document.activeElement).toBe(sw);
  });

  it('normalises a nullish checked prop to aria-checked="false" (state is always announced)', () => {
    render(
      <Toggle
        checked={undefined as unknown as boolean}
        onChange={() => {}}
        aria-label="Sync"
      />,
    );
    // role="switch" REQUIRES aria-checked; a nullish prop must fall back to
    // "false" rather than dropping the attribute entirely (which would be an
    // invalid, un-announced switch).
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('Toggle — visible label association', () => {
  it('renders the visible label and links it to the switch via aria-labelledby', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Notifications" />);
    const sw = screen.getByRole('switch', { name: 'Notifications' });
    const labelledBy = sw.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe(
      'Notifications',
    );
    // With a visible label and no explicit aria-label, no redundant aria-label
    // is emitted on the control.
    expect(sw).not.toHaveAttribute('aria-label');
  });

  it('omits the label span (and aria-labelledby) when no label is given', () => {
    const { container } = render(
      <Toggle checked={false} onChange={() => {}} aria-label="Sync" />,
    );
    // The only <span> is the aria-hidden thumb; no id-bearing label span.
    expect(container.querySelectorAll('span[id]')).toHaveLength(0);
    expect(screen.getByRole('switch')).not.toHaveAttribute('aria-labelledby');
  });
});

describe('Toggle — icon-only naming lands on the button, not the wrapper', () => {
  it('forwards aria-label to the switch button rather than the neutral wrapper div', () => {
    const { container } = render(
      <Toggle checked={false} onChange={() => {}} aria-label="Toggle dark mode" />,
    );
    const sw = screen.getByRole('switch', { name: 'Toggle dark mode' });
    expect(sw).toHaveAttribute('aria-label', 'Toggle dark mode');
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.tagName).toBe('DIV');
    // The whole point of destructuring these out of ...props: they must NOT
    // decorate the wrapper (a screen reader would skip the div).
    expect(wrapper).not.toHaveAttribute('aria-label');
  });

  it('forwards a caller aria-labelledby to the button when there is no visible label', () => {
    render(
      <>
        <span id="ext-name">External name</span>
        <Toggle checked={false} onChange={() => {}} aria-labelledby="ext-name" />
      </>,
    );
    expect(
      screen.getByRole('switch', { name: 'External name' }),
    ).toHaveAttribute('aria-labelledby', 'ext-name');
  });

  it('lets the visible label win over a supplied aria-label (aria-labelledby precedence)', () => {
    render(
      <Toggle
        checked={false}
        onChange={() => {}}
        label="Visible"
        aria-label="Hidden"
      />,
    );
    // Accessible name resolves to the visible label, not the aria-label.
    expect(screen.getByRole('switch', { name: 'Visible' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Hidden' })).toBeNull();
  });

  it('forwards aria-describedby and title to the button (not the wrapper)', () => {
    const { container } = render(
      <Toggle
        checked={false}
        onChange={() => {}}
        aria-label="Sync"
        aria-describedby="sync-help"
        title="Keep vehicles in sync"
      />,
    );
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-describedby', 'sync-help');
    expect(sw).toHaveAttribute('title', 'Keep vehicles in sync');
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).not.toHaveAttribute('aria-describedby');
    expect(wrapper).not.toHaveAttribute('title');
  });
});

describe('Toggle — interactions', () => {
  it('calls onChange with the negated value when the button is clicked (off → on)', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} aria-label="Sync" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange(false) when a checked switch is clicked (on → off)', () => {
    const onChange = vi.fn();
    render(<Toggle checked onChange={onChange} aria-label="Sync" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('fires onChange exactly once per button click (wrapper guard prevents a double-fire)', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Dark mode" />);
    // Clicking the button bubbles to the wrapper's onClick; the
    // closest('button') guard must suppress the wrapper's own toggle.
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('toggles when the visible label text is clicked', () => {
    const onChange = vi.fn();
    render(<Toggle checked onChange={onChange} label="Dark mode" />);
    fireEvent.click(screen.getByText('Dark mode'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('toggles when the wrapper padding/gap is clicked', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Toggle checked={false} onChange={onChange} label="Sync" />,
    );
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('toggles a nullish checked prop to true on click', () => {
    const onChange = vi.fn();
    render(
      <Toggle
        checked={undefined as unknown as boolean}
        onChange={onChange}
        aria-label="Sync"
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Toggle — size variants', () => {
  it('applies md track + thumb sizing by default', () => {
    render(<Toggle checked={false} onChange={() => {}} aria-label="Sync" />);
    const sw = screen.getByRole('switch');
    expect(sw.className).toContain('h-6');
    expect(sw.className).toContain('w-11');
    expect(getThumb(sw).className).toContain('h-5');
    expect(getThumb(sw).className).toContain('w-5');
  });

  it('applies sm track + thumb sizing when size="sm"', () => {
    render(<Toggle checked={false} onChange={() => {}} aria-label="Sync" size="sm" />);
    const sw = screen.getByRole('switch');
    expect(sw.className).toContain('h-5');
    expect(sw.className).toContain('w-9');
    expect(getThumb(sw).className).toContain('h-3.5');
    expect(getThumb(sw).className).toContain('w-3.5');
  });
});

describe('Toggle — visual state', () => {
  it('uses the on (cyan) track when checked and the off (gray) track when unchecked', () => {
    const { rerender } = render(
      <Toggle checked={false} onChange={() => {}} aria-label="Sync" />,
    );
    expect(screen.getByRole('switch').className).toContain('bg-[var(--control-track-off)]');
    rerender(<Toggle checked onChange={() => {}} aria-label="Sync" />);
    expect(screen.getByRole('switch').className).toContain('bg-cyan-500');
  });

  it('rests the thumb at the start when off and translates it fully when on (md)', () => {
    const { rerender } = render(
      <Toggle checked={false} onChange={() => {}} aria-label="Sync" />,
    );
    let thumb = getThumb(screen.getByRole('switch'));
    expect(thumb.className).toContain('translate-x-[3px]');
    expect(thumb.className).not.toContain('translate-x-5');

    rerender(<Toggle checked onChange={() => {}} aria-label="Sync" />);
    thumb = getThumb(screen.getByRole('switch'));
    // tailwind-merge collapses the resting offset into the checked travel.
    expect(thumb.className).toContain('translate-x-5');
    expect(thumb.className).not.toContain('translate-x-[3px]');
  });

  it('marks the thumb decoration aria-hidden so screen readers ignore it', () => {
    render(<Toggle checked onChange={() => {}} aria-label="Sync" />);
    expect(getThumb(screen.getByRole('switch'))).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});

describe('Toggle — passthrough + ref', () => {
  it('merges a custom className onto the wrapper', () => {
    const { container } = render(
      <Toggle
        checked={false}
        onChange={() => {}}
        aria-label="Sync"
        className="my-custom-class"
      />,
    );
    expect((container.firstChild as HTMLElement).className).toContain(
      'my-custom-class',
    );
  });

  it('forwards the ref to the wrapper <div>', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Toggle ref={ref} checked={false} onChange={() => {}} aria-label="Sync" />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.tagName).toBe('DIV');
  });

  it('spreads arbitrary native props (data-*) onto the wrapper', () => {
    const { container } = render(
      <Toggle
        checked={false}
        onChange={() => {}}
        aria-label="Sync"
        data-testid="sync-toggle"
      />,
    );
    expect((container.firstChild as HTMLElement).getAttribute('data-testid')).toBe(
      'sync-toggle',
    );
  });
});
