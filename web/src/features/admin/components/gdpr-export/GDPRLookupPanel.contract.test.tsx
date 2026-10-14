import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GDPRLookupPanel } from './GDPRLookupPanel';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GDPRLookupPanel explicit lookup contract', () => {
  it('keeps the lookup shell, labeled editable ID, guidance and action visible before selection', () => {
    const { container } = render(
      <GDPRLookupPanel idInput="" onIdChange={vi.fn()} onLookup={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: 'Lookup artifact' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Artifact ID' })).toHaveValue('');
    expect(screen.getByPlaceholderText('e.g. 8f4c…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Look up' })).toBeDisabled();
    expect(screen.getByText(/Use Refresh to request an updated snapshot/)).toBeInTheDocument();
    expect(screen.getByText(/configured retention window/)).toBeInTheDocument();
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
  });

  it.each(['', '   ', '\t\n '])('rejects blank or whitespace-only draft %j for click and Enter', (idInput) => {
    const onLookup = vi.fn();
    render(<GDPRLookupPanel idInput={idInput} onIdChange={vi.fn()} onLookup={onLookup} />);

    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Artifact ID' }), { key: 'Enter' });

    expect(screen.getByRole('button', { name: 'Look up' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Artifact ID' })).toHaveValue(idInput.replace(/\r?\n/g, ''));
    expect(onLookup).not.toHaveBeenCalled();
  });

  it.each([null, undefined])('retains the existing nullish draft fallback for %s', (idInput) => {
    const onLookup = vi.fn();
    render(
      <GDPRLookupPanel
        idInput={idInput as unknown as string}
        onIdChange={vi.fn()}
        onLookup={onLookup}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Artifact ID' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Look up' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Artifact ID' }), { key: 'Enter' });
    expect(onLookup).not.toHaveBeenCalled();
  });

  it.each(['click', 'Enter'])('permits explicit %s submission while preserving the raw padded opaque ID', (action) => {
    const onLookup = vi.fn();
    const onIdChange = vi.fn();
    const idInput = '  qa?marker=1/#opaque  ';
    render(<GDPRLookupPanel idInput={idInput} onIdChange={onIdChange} onLookup={onLookup} />);

    expect(screen.getByRole('button', { name: 'Look up' })).toBeEnabled();
    if (action === 'click') fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    else fireEvent.keyDown(screen.getByRole('textbox', { name: 'Artifact ID' }), { key: 'Enter' });

    expect(onLookup).toHaveBeenCalledExactlyOnceWith();
    expect(onIdChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Artifact ID' })).toHaveValue(idInput);
  });

  it('forwards edits unchanged without automatically looking up or submitting unrelated keys', () => {
    const onIdChange = vi.fn();
    const onLookup = vi.fn();
    const { rerender } = render(
      <GDPRLookupPanel idInput="qa-old" onIdChange={onIdChange} onLookup={onLookup} />,
    );
    const input = screen.getByRole('textbox', { name: 'Artifact ID' });
    fireEvent.change(input, { target: { value: '  qa-new/#?  ' } });

    expect(onIdChange).toHaveBeenCalledExactlyOnceWith('  qa-new/#?  ');
    expect(onLookup).not.toHaveBeenCalled();
    rerender(
      <GDPRLookupPanel idInput="  qa-new/#?  " onIdChange={onIdChange} onLookup={onLookup} />,
    );
    expect(input).toHaveValue('  qa-new/#?  ');
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: ' ' });
    expect(onLookup).not.toHaveBeenCalled();
  });

  it('allows repeated deliberate lookup attempts and remains editable for retry', () => {
    const onLookup = vi.fn();
    const onIdChange = vi.fn();
    const { rerender } = render(
      <GDPRLookupPanel idInput="qa-first" onIdChange={onIdChange} onLookup={onLookup} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(onLookup).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox', { name: 'Artifact ID' })).toBeEnabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Artifact ID' }), { target: { value: 'qa-retry' } });
    expect(onIdChange).toHaveBeenCalledExactlyOnceWith('qa-retry');
    rerender(<GDPRLookupPanel idInput="qa-retry" onIdChange={onIdChange} onLookup={onLookup} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Artifact ID' }), { key: 'Enter' });
    expect(onLookup).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('textbox', { name: 'Artifact ID' })).toHaveValue('qa-retry');
  });

  it('does not invoke lookup on mount, rerender or elapsed time and exposes no download or export action', () => {
    vi.useFakeTimers();
    const onLookup = vi.fn();
    const onIdChange = vi.fn();
    const { container, rerender } = render(
      <GDPRLookupPanel idInput="qa-first" onIdChange={onIdChange} onLookup={onLookup} />,
    );
    rerender(<GDPRLookupPanel idInput="qa-second" onIdChange={onIdChange} onLookup={onLookup} />);
    act(() => vi.advanceTimersByTime(120_000));

    expect(onLookup).not.toHaveBeenCalled();
    expect(onIdChange).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('[download]')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Artifact ID' })).toHaveValue('qa-second');
  });

  it('describes explicit metadata refresh without inventing job status or download readiness', () => {
    render(<GDPRLookupPanel idInput="qa-only" onIdChange={vi.fn()} onLookup={vi.fn()} />);

    expect(screen.getByText(/this page does not poll automatically/)).toBeInTheDocument();
    expect(screen.getByText(/do not create exports or download bundles/)).toBeInTheDocument();
    expect(screen.getByText(/A saved manifest does not confirm current download availability or storage support/)).toBeInTheDocument();
    expect(screen.queryByText(/queued|running|track its status live|streamed straight/)).not.toBeInTheDocument();
  });

  it('uses theme-aware neutral information without turning guidance into a success or warning state', () => {
    const { container } = render(
      <GDPRLookupPanel idInput="" onIdChange={vi.fn()} onLookup={vi.fn()} />,
    );
    const guidance = screen.getByText(/A saved manifest does not confirm/).closest('div');
    expect(guidance).toHaveClass('rounded-panel', 'border-[var(--border-default)]', 'bg-[var(--surface-2)]');
    const icon = container.querySelector('.lucide-info');
    expect(icon).toHaveClass('text-[var(--text-secondary)]');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(guidance?.className).not.toMatch(/white|cyan|neon|success|warning|danger/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('imports existing typography through the UI category and keeps data and capability ownership outside the panel', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src', 'features', 'admin', 'components', 'gdpr-export', 'GDPRLookupPanel.tsx'),
      'utf8',
    );

    expect(source).toMatch(/import \{ GlassPanel, Button, Input, PanelTitle, Caption, Text \} from '@\/components\/ui';/);
    expect(source).not.toContain('@/components/ui/Typography');
    expect(source).not.toMatch(/useGDPRExport|request\(|fetch\(|useEffect|setInterval|downloadUrl|artifact\.status/);
  });
});
