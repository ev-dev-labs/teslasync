import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock';
import { Button } from './Button';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: Record<string, string>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (match, key: string) => options?.[key] ?? match),
  }),
}));

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function copy() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  });
}

describe('CodeBlock', () => {
  it('copies exact Unicode, newlines, tabs and surrounding whitespace', async () => {
    const text = ' \tconst café = "🚗";\r\n  你好\n\n ';
    const { container } = render(<CodeBlock text={text} language="ts" />);

    expect(container.querySelector('pre code')?.textContent).toBe(text);
    await copy();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('escapes malicious markup as literal text', async () => {
    const text = '<script>alert("x")</script><img src=x onerror="alert(1)">&';
    const { container } = render(<CodeBlock text={text} language="html" />);

    expect(container.querySelector('code')?.textContent).toBe(text);
    expect(container.querySelector('script, img')).toBeNull();
    await copy();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
  });

  it('displays supplied React children while copying only the raw payload', async () => {
    const text = '  original\n\tpayload ';
    const { container } = render(
      <CodeBlock text={text}>
        <span data-testid="rendered-code">Different display</span>
      </CodeBlock>,
    );

    expect(container.querySelector('pre code')?.textContent).toBe('Different display');
    expect(screen.getByTestId('rendered-code')).toBeInTheDocument();
    await copy();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
  });

  it('preserves explicitly empty display children without emptying the clipboard', async () => {
    const { container } = render(<CodeBlock text="raw payload">{''}</CodeBlock>);

    expect(container.querySelector('code')?.textContent).toBe('');
    await copy();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('raw payload');
  });

  it('uses the trimmed language for the visible header and accessible group name', () => {
    render(<CodeBlock text="package main" language="  go  " />);

    const group = screen.getByRole('group', { name: 'go code snippet' });
    expect(within(group).getByText('go')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it.each([undefined, '', ' \t '])('defaults language %j to the technical text token', (language) => {
    render(<CodeBlock text="payload" language={language} />);

    expect(screen.getByRole('group', { name: 'text code snippet' })).toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('allows an explicit accessible label and caller-supplied heading', () => {
    render(
      <CodeBlock text="{}" language="json" ariaLabel="Response body" heading={<h3>Payload</h3>} />,
    );

    const group = screen.getByRole('group', { name: 'Response body' });
    expect(within(group).getByRole('heading', { name: 'Payload' })).toBeInTheDocument();
    expect(within(group).queryByText('json')).not.toBeInTheDocument();
  });

  it('replaces default copying with a caller-owned action and error presentation', () => {
    const onManualCopy = vi.fn();
    render(
      <CodeBlock
        text="payload"
        action={(
          <>
            <Button onClick={onManualCopy}>Manual copy</Button>
            <span role="alert">Clipboard unavailable</span>
          </>
        )}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Clipboard unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Manual copy' }));
    expect(onManualCopy).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('confines overflow and applies custom classes without wrapping by default', () => {
    const { container } = render(<CodeBlock text={'x'.repeat(1000)} className="caller-class" />);

    expect(screen.getByRole('group')).toHaveClass('min-w-0', 'max-w-full', 'overflow-hidden', 'caller-class');
    expect(container.querySelector('pre')).toHaveClass('max-w-full', 'overflow-auto', 'whitespace-pre');
    expect(container.querySelector('pre')).not.toHaveClass('whitespace-pre-wrap');
  });

  it('wraps payload display only and leaves copied whitespace unchanged', async () => {
    const text = '  long-payload\n\t' + 'x'.repeat(1000);
    const { container } = render(<CodeBlock text={text} wrap />);

    expect(container.querySelector('pre')).toHaveClass('overflow-auto', 'whitespace-pre-wrap', 'break-words');
    expect(container.querySelector('pre')).not.toHaveClass('whitespace-pre');
    expect(container.querySelector('code')?.textContent).toBe(text);
    await copy();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
  });

  it.each(['', null, undefined])('renders and copies empty runtime text %j without stringification', async (text) => {
    const { container } = render(<CodeBlock text={text as unknown as string} />);

    expect(screen.getByRole('group', { name: 'text code snippet' })).toBeInTheDocument();
    expect(container.querySelector('code')?.textContent).toBe('');
    await copy();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('');
  });

  it('renders JSON and markdown literally without parsing or a highlighting engine', () => {
    const text = '{"x":1}\n**not bold**\n```typescript\nconst x = 1;\n```';
    const { container } = render(<CodeBlock text={text} language="json" />);

    expect(container.querySelector('code')?.textContent).toBe(text);
    expect(container.querySelector('code')?.childElementCount).toBe(0);
    expect(container.querySelector('strong, .hljs, .token')).toBeNull();
  });

  it('rejects arbitrary runtime objects instead of coercing a clipboard payload', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(
        <CodeBlock text={{ payload: true } as unknown as string}>Display</CodeBlock>,
      )).toThrow('CodeBlock text must be a string');
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});
