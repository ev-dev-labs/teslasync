/**
 * Phase-46 / Prompt 20 — AcknowledgeAlertDialog tests.
 *
 * Verifies the modal lifecycle:
 *   1. Renders title + textarea + Submit/Cancel
 *   2. Submit fires onSubmit with the trimmed note
 *   3. Empty/whitespace note allowed (passes "" to onSubmit)
 *   4. Cancel fires onClose without calling onSubmit
 *   5. The note state resets when reopening for a different alert
 *   6. Submit is disabled while submitting
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@/i18n';

import { AcknowledgeAlertDialog } from '../AcknowledgeAlertDialog';

describe('AcknowledgeAlertDialog — Phase-46 / Prompt 20', () => {
  beforeEach(() => {
    cleanup();
  });
  afterEach(() => {
    cleanup();
  });

  it('does not render when closed', () => {
    render(
      <AcknowledgeAlertDialog open={false} onClose={() => {}} onSubmit={() => {}} />,
    );
    expect(document.body.querySelectorAll('[role="dialog"]').length).toBe(0);
  });

  it('renders the dialog title, textarea, Submit, and Cancel when open', () => {
    render(
      <AcknowledgeAlertDialog open={true} onClose={() => {}} onSubmit={() => {}} />,
    );
    expect(screen.getByText(/Acknowledge alert/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Acknowledge$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('passes the trimmed note to onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <AcknowledgeAlertDialog open={true} onClose={() => {}} onSubmit={onSubmit} />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  Investigating MQTT  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Acknowledge$/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('Investigating MQTT');
  });

  it('allows submitting with an empty note', () => {
    const onSubmit = vi.fn();
    render(
      <AcknowledgeAlertDialog open={true} onClose={() => {}} onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Acknowledge$/i }));
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('allows submitting with a whitespace-only note (collapses to empty)', () => {
    const onSubmit = vi.fn();
    render(
      <AcknowledgeAlertDialog open={true} onClose={() => {}} onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByRole('textbox') as HTMLTextAreaElement, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Acknowledge$/i }));
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('Cancel fires onClose without calling onSubmit', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <AcknowledgeAlertDialog open={true} onClose={onClose} onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables Submit + Cancel while submitting=true', () => {
    render(
      <AcknowledgeAlertDialog
        open={true}
        onClose={() => {}}
        onSubmit={() => {}}
        submitting={true}
      />,
    );
    expect(screen.getByRole('button', { name: /^Acknowledge$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeDisabled();
  });

  it('shows the alertTitle subtitle when provided', () => {
    render(
      <AcknowledgeAlertDialog
        open={true}
        onClose={() => {}}
        onSubmit={() => {}}
        alertTitle="Battery low on Model Y"
      />,
    );
    expect(screen.getByText('Battery low on Model Y')).toBeInTheDocument();
  });

  it('resets the note when reopening', () => {
    const { rerender } = render(
      <AcknowledgeAlertDialog open={true} onClose={() => {}} onSubmit={() => {}} />,
    );
    fireEvent.change(screen.getByRole('textbox') as HTMLTextAreaElement, { target: { value: 'first' } });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('first');
    rerender(
      <AcknowledgeAlertDialog open={false} onClose={() => {}} onSubmit={() => {}} />,
    );
    rerender(
      <AcknowledgeAlertDialog open={true} onClose={() => {}} onSubmit={() => {}} />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('disables Submit when textarea contains over the 1000-char limit', () => {
    const onSubmit = vi.fn();
    render(
      <AcknowledgeAlertDialog open={true} onClose={() => {}} onSubmit={onSubmit} />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x'.repeat(1001) } });
    expect(screen.getByRole('button', { name: /^Acknowledge$/i })).toBeDisabled();
  });
});
