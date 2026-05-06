/**
 * Phase-46 / Prompt 38 — `<EditableText>` contract tests.
 *
 * Verifies the inline-edit lifecycle: enter on dblclick / Enter / F2,
 * Enter saves, Escape cancels, blur saves only when valid, errors
 * roll back to edit mode without losing the typed value, and the
 * custom display render prop receives an onStartEdit callback so
 * consumer-rendered Link + pencil affordances work.
 *
 * `@testing-library/user-event` is not installed in this repo, so we
 * drive the tests via `fireEvent` from `@testing-library/react` —
 * matches every other component test here (TagInput, ContextMenu,
 * focusTrap, etc.).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      let template: string;
      let interpolations: Record<string, unknown> | undefined;
      if (typeof defaultOrOpts === 'string') {
        template = defaultOrOpts || key;
        interpolations = opts;
      } else {
        template = key;
        interpolations = defaultOrOpts;
      }
      if (!interpolations) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String(interpolations?.[name] ?? `{{${name}}}`),
      );
    },
  }),
}));

import { EditableText } from './EditableText';
import {
  __resetAnnouncerForTests,
  subscribeAnnouncer,
} from '@/hooks/useAnnouncer';

afterEach(() => {
  cleanup();
  __resetAnnouncerForTests();
});

/** Type a value into a controlled input via fireEvent.change. */
function typeInto(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe('EditableText — display mode', () => {
  it('renders a button-styled-as-text trigger with the current value', () => {
    render(
      <EditableText value="Home" onSave={async () => {}} ariaLabel="Rename geofence" />,
    );
    const trigger = screen.getByRole('button', { name: 'Rename geofence' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Home');
  });

  it('shows placeholder text when value is empty', () => {
    render(
      <EditableText
        value=""
        placeholder="Untitled"
        onSave={async () => {}}
        ariaLabel="Rename"
      />,
    );
    expect(screen.getByRole('button', { name: 'Rename' })).toHaveTextContent('Untitled');
  });

  it('disables the trigger when disabled is true', () => {
    render(
      <EditableText
        value="Locked"
        disabled
        onSave={async () => {}}
        ariaLabel="Rename"
      />,
    );
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
  });
});

describe('EditableText — entering edit mode', () => {
  it('click enters edit mode (native button activation)', () => {
    render(<EditableText value="Home" onSave={async () => {}} ariaLabel="Rename" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByTestId('editable-text-input')).toBeInTheDocument();
  });

  it('double-click enters edit mode', () => {
    render(<EditableText value="Home" onSave={async () => {}} ariaLabel="Rename" />);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByTestId('editable-text-input')).toBeInTheDocument();
  });

  it('F2 from focused trigger enters edit mode', () => {
    render(<EditableText value="Home" onSave={async () => {}} ariaLabel="Rename" />);
    const trigger = screen.getByRole('button', { name: 'Rename' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'F2' });
    expect(screen.getByTestId('editable-text-input')).toBeInTheDocument();
  });

  it('does NOT enter edit mode when disabled (button onClick skipped)', () => {
    render(
      <EditableText
        value="Home"
        disabled
        onSave={async () => {}}
        ariaLabel="Rename"
      />,
    );
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.queryByTestId('editable-text-input')).not.toBeInTheDocument();
  });
});

describe('EditableText — saving', () => {
  it('Enter calls onSave with the trimmed draft and exits edit mode', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableText value="Home" onSave={onSave} ariaLabel="Rename" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByTestId('editable-text-input') as HTMLInputElement;
    typeInto(input, '  Garage  ');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('Garage');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('editable-text-input')).not.toBeInTheDocument();
    });
  });

  it('blur saves when value is valid and changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableText value="Home" onSave={onSave} ariaLabel="Rename" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByTestId('editable-text-input') as HTMLInputElement;
    typeInto(input, 'Garage');
    fireEvent.blur(input);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('Garage');
    });
  });

  it('Enter on an unchanged value exits edit mode WITHOUT calling onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableText value="Home" onSave={onSave} ariaLabel="Rename" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByTestId('editable-text-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.queryByTestId('editable-text-input')).not.toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rapid Enter+blur fires onSave only once (in-flight guard)', async () => {
    let resolveSave!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<EditableText value="Home" onSave={onSave} ariaLabel="Rename" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByTestId('editable-text-input') as HTMLInputElement;
    typeInto(input, 'Garage');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledTimes(1);
    act(() => resolveSave());
    await waitFor(() => {
      expect(screen.queryByTestId('editable-text-input')).not.toBeInTheDocument();
    });
  });

  it('shows a Spinner while save is in flight and disables the input', async () => {
    let resolveSave!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<EditableText value="Home" onSave={onSave} ariaLabel="Rename" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByTestId('editable-text-input') as HTMLInputElement;
    typeInto(input, 'Garage');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByTestId('editable-text-spinner')).toBeInTheDocument();
    expect(input).toBeDisabled();
    act(() => resolveSave());
    await waitFor(() => {
      expect(screen.queryByTestId('editable-text-input')).not.toBeInTheDocument();
    });
  });
});

describe('EditableText — cancelling', () => {
  it('Escape rolls back to the original value and exits edit mode', async () => {
    const onSave = vi.fn();
    render(<EditableText value="Home" onSave={onSave} ariaLabel="Rename" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByTestId('editable-text-input') as HTMLInputElement;
    typeInto(input, 'Garage');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('editable-text-input')).not.toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Rename' })).toHaveTextContent('Home');
  });
});

describe('EditableText — validation', () => {
  it('empty draft on Enter shows the built-in empty error and does NOT call onSave', () => {
    const onSave = vi.fn();
    render(<EditableText value="Home" onSave={onSave} ariaLabel="Rename" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByTestId('editable-text-input') as HTMLInputElement;
    typeInto(input, '');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Value cannot be empty')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('editable-text-input')).toBeInTheDocument();
  });

  it('custom validate gates Enter and surfaces the returned message', () => {
    const onSave = vi.fn();
    const validate = (next: string) =>
      next.length < 3 ? 'Too short' : null;
    render(
      <EditableText
        value="Home"
        onSave={onSave}
        validate={validate}
        ariaLabel="Rename"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByTestId('editable-text-input') as HTMLInputElement;
    typeInto(input, 'Hi');
    expect(screen.getByText('Too short')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('editable-text-input')).toBeInTheDocument();
  });

  it('blur with an invalid draft stays in edit mode (does NOT save)', () => {
    const onSave = vi.fn();
    render(
      <EditableText
        value="Home"
        onSave={onSave}
        validate={(v) => (v.length < 3 ? 'Too short' : null)}
        ariaLabel="Rename"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByTestId('editable-text-input') as HTMLInputElement;
    typeInto(input, 'Hi');
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('editable-text-input')).toBeInTheDocument();
  });
});

describe('EditableText — error handling', () => {
  it('onSave rejection shows the error, stays in edit mode, preserves draft', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Conflict: name in use'));
    render(<EditableText value="Home" onSave={onSave} ariaLabel="Rename" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByTestId('editable-text-input') as HTMLInputElement;
    typeInto(input, 'Garage');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Conflict: name in use')).toBeInTheDocument();
    expect(screen.getByTestId('editable-text-input')).toBeInTheDocument();
    expect((screen.getByTestId('editable-text-input') as HTMLInputElement).value).toBe('Garage');
  });
});

describe('EditableText — announcer', () => {
  beforeEach(() => {
    __resetAnnouncerForTests();
  });

  it('announces "<label> saved" via the shared live region after a successful save', async () => {
    const captured: string[] = [];
    subscribeAnnouncer((message) => captured.push(message));

    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableText value="Home" onSave={onSave} ariaLabel="Rename geofence" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename geofence' }));
    const input = screen.getByTestId('editable-text-input') as HTMLInputElement;
    typeInto(input, 'Garage');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(captured.some((m) => m.includes('Rename geofence saved'))).toBe(true);
    });
  });
});

describe('EditableText — custom display render prop', () => {
  it('renders the custom display and forwards onStartEdit to enter edit mode', () => {
    render(
      <EditableText
        value="High SoC"
        onSave={async () => {}}
        ariaLabel="Rename rule"
        display={({ value, onStartEdit }) => (
          <>
            <a href="#go">{value}</a>
            <button type="button" onClick={onStartEdit} aria-label="edit-affordance">
              edit
            </button>
          </>
        )}
      />,
    );
    expect(screen.getByRole('link', { name: 'High SoC' })).toBeInTheDocument();
    expect(screen.queryByTestId('editable-text-trigger')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'edit-affordance' }));
    expect(screen.getByTestId('editable-text-input')).toBeInTheDocument();
  });

  it('passes the disabled flag through to the custom display', () => {
    let receivedDisabled: boolean | undefined;
    render(
      <EditableText
        value="x"
        disabled
        onSave={async () => {}}
        ariaLabel="Rename"
        display={({ disabled }) => {
          receivedDisabled = disabled;
          return <span>x</span>;
        }}
      />,
    );
    expect(receivedDisabled).toBe(true);
  });
});

describe('EditableText — heading variant', () => {
  it('applies the heading text size when variant=heading', () => {
    render(
      <EditableText
        value="Title"
        variant="heading"
        onSave={async () => {}}
        ariaLabel="Rename title"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Rename title' });
    expect(trigger.className).toContain('text-base');
    expect(trigger.className).toContain('font-semibold');
  });
});

describe('EditableText — external value sync', () => {
  it('updates the displayed value when the prop changes outside of editing', () => {
    const { rerender } = render(
      <EditableText value="Home" onSave={async () => {}} ariaLabel="Rename" />,
    );
    expect(screen.getByRole('button', { name: 'Rename' })).toHaveTextContent('Home');
    rerender(
      <EditableText value="Office" onSave={async () => {}} ariaLabel="Rename" />,
    );
    expect(screen.getByRole('button', { name: 'Rename' })).toHaveTextContent('Office');
  });
});
