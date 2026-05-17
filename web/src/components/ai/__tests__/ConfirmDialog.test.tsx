// Phase-50 / 0005 — F4 AiConfirmDialog tests.
//
// Pins the user-facing contract:
//   - open=false renders nothing
//   - open=true renders tool name + JSON args + Approve/Cancel
//   - Approve invokes onConfirm
//   - Cancel invokes onCancel
//   - loading=true disables both buttons
//   - args render as pretty-printed JSON

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiConfirmDialog } from '../ConfirmDialog';

// react-i18next's useTranslation returns the second argument
// (English fallback) when no provider is mounted; tests therefore
// need NO i18n setup. The component is i18n-aware but degrades
// gracefully which matches existing AI components in this dir.

describe('AiConfirmDialog', () => {
  const tool = {
    name: 'set_alert_threshold',
    description: 'Update an alert rule threshold.',
    mutates: true,
  };
  const args = { rule_id: 42, threshold: 80 };

  it('renders nothing when open=false', () => {
    const { container } = render(
      <AiConfirmDialog open={false} tool={tool} args={args} onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders tool name and pretty-printed args when open', () => {
    render(
      <AiConfirmDialog open tool={tool} args={args} onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    expect(screen.getByTestId('ai-confirm-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('ai-confirm-tool-name')).toHaveTextContent('set_alert_threshold');
    const pre = screen.getByTestId('ai-confirm-args');
    expect(pre).toHaveTextContent(/"rule_id": 42/);
    expect(pre).toHaveTextContent(/"threshold": 80/);
  });

  it('calls onConfirm when the approve button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <AiConfirmDialog open tool={tool} args={args} onConfirm={onConfirm} onCancel={() => undefined} />,
    );
    fireEvent.click(screen.getByTestId('ai-confirm-approve'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <AiConfirmDialog open tool={tool} args={args} onConfirm={() => undefined} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByTestId('ai-confirm-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while loading', () => {
    render(
      <AiConfirmDialog open tool={tool} args={args} onConfirm={() => undefined} onCancel={() => undefined} loading />,
    );
    expect(screen.getByTestId('ai-confirm-approve')).toBeDisabled();
    expect(screen.getByTestId('ai-confirm-cancel')).toBeDisabled();
  });

  it('renders empty {} when args is null', () => {
    render(
      <AiConfirmDialog open tool={tool} args={null} onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    expect(screen.getByTestId('ai-confirm-args')).toHaveTextContent(/^\s*\{\}\s*$/);
  });

  it('shows the read-only intro for non-mutating tools', () => {
    render(
      <AiConfirmDialog
        open
        tool={{ name: 'query_vehicle_count', mutates: false }}
        args={{}}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    // English fallback for ai.confirm.intro.read includes "run a tool":
    expect(screen.getByText(/run a tool/i)).toBeInTheDocument();
  });

  it('shows the mutating intro for mutating tools', () => {
    render(
      <AiConfirmDialog open tool={tool} args={args} onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    // English fallback for ai.confirm.intro.mutates includes "make a change":
    expect(screen.getByText(/make a change/i)).toBeInTheDocument();
  });
});
