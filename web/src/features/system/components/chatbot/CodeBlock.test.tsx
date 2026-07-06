/**
 * `<CodeBlock>` contract tests.
 *
 * CodeBlock is the fenced-code wrapper `<MarkdownRenderer>` hands assistant
 * replies. Its defining contract is the *split* between what it DISPLAYS
 * (the pre-rendered, escaped `children` from react-markdown) and what it
 * COPIES (the raw `text` string). These tests lock that split down along
 * with the language-tag fallback, null-safety, the copy affordance, and the
 * accessible grouping.
 *
 * `@testing-library/user-event` is not installed in this repo, so
 * interactions are driven via `fireEvent` — matching every other component
 * test here (CopyButton, FullscreenButton, EditableText).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Deterministic i18n: return the default value and interpolate `{{name}}`
// placeholders from the options bag, mirroring the mock used by the other
// component tests in this tree.
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

import { CodeBlock } from './CodeBlock';

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

function codeText(container: HTMLElement): string {
  return container.querySelector('pre code')?.textContent ?? '';
}

describe('CodeBlock — language tag', () => {
  it('renders the supplied language token as the header label', () => {
    render(<CodeBlock language="ts" text="const a = 1;" />);
    expect(screen.getByText('ts')).toBeInTheDocument();
  });

  it('trims surrounding whitespace from the language token', () => {
    render(<CodeBlock language="  go  " text="package main" />);
    expect(screen.getByText('go')).toBeInTheDocument();
    expect(screen.queryByText('  go  ')).toBeNull();
  });

  it('falls back to "text" when no language is supplied', () => {
    render(<CodeBlock text="print(1)" />);
    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('falls back to "text" for an empty or whitespace-only language', () => {
    const { unmount } = render(<CodeBlock language="" text="a" />);
    expect(screen.getByText('text')).toBeInTheDocument();
    unmount();

    render(<CodeBlock language="   " text="b" />);
    expect(screen.getByText('text')).toBeInTheDocument();
  });
});

describe('CodeBlock — content rendering', () => {
  it('renders the raw text inside <pre><code> when no children are given', () => {
    const { container } = render(<CodeBlock language="bash" text="echo hi" />);
    expect(codeText(container)).toBe('echo hi');
  });

  it('prefers pre-rendered children over the raw text for display', () => {
    const { container } = render(
      <CodeBlock language="ts" text="RAW_CLIP">
        <span>DISPLAY_NODE</span>
      </CodeBlock>,
    );
    expect(codeText(container)).toBe('DISPLAY_NODE');
    // The raw clipboard payload must never leak into the rendered output.
    expect(screen.queryByText('RAW_CLIP')).toBeNull();
  });

  it('falls back to the raw text when children is explicitly null', () => {
    const { container } = render(<CodeBlock text="fallback-content">{null}</CodeBlock>);
    expect(codeText(container)).toBe('fallback-content');
  });

  it('renders an empty code block without crashing when text is empty', () => {
    const { container } = render(<CodeBlock language="ts" text="" />);
    expect(container.querySelector('pre code')).toBeInTheDocument();
    expect(codeText(container)).toBe('');
    // The panel is always shown — never gated away to a blank node.
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});

describe('CodeBlock — copy affordance', () => {
  it('renders an icon-only copy button exposing an accessible name', () => {
    render(<CodeBlock language="ts" text="x" />);
    const btn = screen.getByRole('button', { name: 'Copy' });
    expect(btn).toBeInTheDocument();
    // iconOnly => no visible label text, only the assistive name.
    expect(btn).not.toHaveTextContent('Copy');
  });

  it('copies the RAW text — not the displayed children — to the clipboard', async () => {
    render(
      <CodeBlock language="ts" text="RAW_CLIP">
        <span>DISPLAY_NODE</span>
      </CodeBlock>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('RAW_CLIP');
    });
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('toggles the button to the "Copied" state after a successful copy', async () => {
    render(<CodeBlock language="ts" text="const a = 1;" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('copies an empty string when text is empty (never the literal "undefined")', async () => {
    render(<CodeBlock text="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('');
    });
  });
});

describe('CodeBlock — accessibility & structure', () => {
  it('wraps the block in a group named for the code language', () => {
    render(<CodeBlock language="ts" text="x" />);
    expect(screen.getByRole('group', { name: 'ts code snippet' })).toBeInTheDocument();
  });

  it('names the group with the "text" fallback when no language is set', () => {
    render(<CodeBlock text="x" />);
    expect(screen.getByRole('group', { name: 'text code snippet' })).toBeInTheDocument();
  });

  it('merges a custom className onto the root group while keeping base styles', () => {
    render(<CodeBlock text="x" className="test-marker" />);
    const group = screen.getByRole('group');
    expect(group.className).toContain('test-marker');
    expect(group.className).toContain('relative');
  });
});
