/**
 * Phase-46 / Prompt 24 — TagInput unit tests.
 *
 * Locks in the contract documented in TagInput.tsx: separator commit,
 * Backspace-to-delete, dedupe, validateTag, maxTags, paste-splitting,
 * announcer wiring, and basic a11y wiring (label, aria-describedby).
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import '@/i18n';
import { TagInput, type TagInputHandle, type TagInputProps } from '../TagInput';
import { __resetAnnouncerForTests } from '@/hooks/useAnnouncer';

interface HarnessProps extends Omit<TagInputProps, 'value' | 'onChange'> {
  initial?: string[];
  onChange?: (next: string[]) => void;
  handleRef?: React.Ref<TagInputHandle>;
}

function Harness({ initial = [], onChange, handleRef, ...rest }: HarnessProps) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <TagInput
      ref={handleRef}
      label={rest.label ?? 'Tags'}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      {...rest}
    />
  );
}

function getInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: /tags/i }) as HTMLInputElement;
}

describe('TagInput', () => {
  beforeEach(() => {
    __resetAnnouncerForTests();
  });

  it('renders an input wired to the visible label', () => {
    render(<Harness />);
    const input = getInput();
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-labelledby');
  });

  it('Enter commits a single tag and clears the input', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: 'foo' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['foo']);
    expect(input).toHaveValue('');
    expect(
      screen.getByRole('button', { name: /remove foo/i }),
    ).toBeInTheDocument();
  });

  it('typing a comma commits the preceding fragment as a tag', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = getInput();
    // Simulate typing "foo," — the change event lands with the
    // comma already present.
    fireEvent.change(input, { target: { value: 'foo,' } });
    expect(onChange).toHaveBeenCalledWith(['foo']);
    expect(input).toHaveValue('');
  });

  it('typing a separator with trailing fragment keeps remainder as pending', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: 'foo,bar' } });
    expect(onChange).toHaveBeenCalledWith(['foo']);
    expect(input).toHaveValue('bar');
  });

  it('paste of "foo,bar,baz" creates 3 tags in one shot', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = getInput();
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => 'foo,bar,baz',
      },
    });
    expect(onChange).toHaveBeenLastCalledWith(['foo', 'bar', 'baz']);
    expect(input).toHaveValue('');
  });

  it('paste with newlines splits across rows', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = getInput();
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => 'foo\nbar\r\nbaz',
      },
    });
    expect(onChange).toHaveBeenLastCalledWith(['foo', 'bar', 'baz']);
  });

  it('Backspace at empty input removes the last tag', () => {
    const onChange = vi.fn();
    render(<Harness initial={['foo', 'bar']} onChange={onChange} />);
    const input = getInput();
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['foo']);
  });

  it('Backspace with pending text does NOT remove a tag', () => {
    const onChange = vi.fn();
    render(<Harness initial={['foo']} onChange={onChange} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: 'b' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clicking a chip remove button removes that tag', () => {
    const onChange = vi.fn();
    render(<Harness initial={['foo', 'bar', 'baz']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove bar/i }));
    expect(onChange).toHaveBeenCalledWith(['foo', 'baz']);
  });

  it('rejects duplicate (case-insensitive) silently and keeps input cleared', () => {
    const onChange = vi.fn();
    render(<Harness initial={['Foo']} onChange={onChange} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: 'foo' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
  });

  it('rejects empty / whitespace-only commits silently', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
  });

  it('validateTag rejection shows ErrorText and blocks add', () => {
    const onChange = vi.fn();
    render(
      <Harness
        onChange={onChange}
        validateTag={(tag) =>
          tag.length < 3 ? 'Tag must be at least 3 characters' : null
        }
      />,
    );
    const input = getInput();
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 3/i)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('editing the field clears a stale validation error', () => {
    render(
      <Harness
        validateTag={(tag) =>
          tag.length < 3 ? 'Tag must be at least 3 characters' : null
        }
      />,
    );
    const input = getInput();
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText(/at least 3/i)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.queryByText(/at least 3/i)).not.toBeInTheDocument();
  });

  it('maxTags reached disables input and shows helper text', () => {
    render(<Harness initial={['a', 'b']} maxTags={2} />);
    const input = getInput();
    expect(input).toBeDisabled();
    expect(screen.getByText(/maximum 2 tags/i)).toBeInTheDocument();
    // Label shows count fraction.
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
  });

  it('lowercase=true normalises tags before commit', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} lowercase />);
    const input = getInput();
    fireEvent.change(input, { target: { value: 'FOO' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['foo']);
  });

  it('blur commits pending text', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: 'foo' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(['foo']);
  });

  it('hideLabel still exposes the field via aria-labelledby', () => {
    render(<Harness label="Vehicle IDs" hideLabel />);
    const input = screen.getByRole('textbox', { name: /vehicle ids/i });
    expect(input).toHaveAttribute('aria-labelledby');
  });

  it('imperative commitPending() commits via the handle', () => {
    const onChange = vi.fn();
    const ref: React.MutableRefObject<TagInputHandle | null> = { current: null };
    render(<Harness onChange={onChange} handleRef={ref} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: 'foo' } });
    ref.current?.commitPending();
    expect(onChange).toHaveBeenCalledWith(['foo']);
  });

  it('aria-describedby references the hidden tags enumeration', () => {
    render(<Harness initial={['foo', 'bar']} />);
    const input = getInput();
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    // One of the referenced ids carries the tag list text.
    const ids = (describedBy ?? '').split(/\s+/);
    const matched = ids
      .map((id) => document.getElementById(id))
      .find((node) => node?.textContent?.includes('Tags: foo, bar'));
    expect(matched).toBeTruthy();
  });

  it('disabled prop disables input and chip remove buttons', () => {
    render(<Harness initial={['foo']} disabled />);
    const input = getInput();
    expect(input).toBeDisabled();
    const removeBtn = screen.getByRole('button', { name: /remove foo/i });
    expect(removeBtn).toBeDisabled();
  });

  it('separators=[";"," "] commits on semicolon and space too', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} separators={[';', ' ']} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: 'foo;bar baz' } });
    expect(onChange).toHaveBeenLastCalledWith(['foo', 'bar']);
    expect(input).toHaveValue('baz');
  });
});
