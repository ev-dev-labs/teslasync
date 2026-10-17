import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrderedStepList, type OrderedStep } from './OrderedStepList';

const passiveSteps: readonly OrderedStep[] = [
  { id: 'connect', title: 'Connect', description: 'Authorize your account.' },
  { id: 'configure', title: 'Configure', description: 'Choose your settings.' },
  { id: 'verify', title: 'Verify' },
];

describe('OrderedStepList', () => {
  it('defaults to passive numbered instructions without deriving a current step', () => {
    render(<OrderedStepList steps={passiveSteps} aria-label="Instructions" />);
    const list = screen.getByRole('list', { name: 'Instructions' });
    expect(list.tagName).toBe('OL');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    rows.forEach((row, index) => {
      expect(within(row).getByText(String(index + 1)).closest('[aria-hidden]'))
        .toHaveAttribute('aria-hidden', 'true');
      expect(row).not.toHaveAttribute('aria-current');
      expect(row).not.toHaveAttribute('data-state');
      expect(row).not.toHaveAttribute('tabindex');
    });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/not started|in progress|completed/i)).not.toBeInTheDocument();
  });

  it('uses caller-explicit state and localized visible labels, not first-undone policy', () => {
    const steps: readonly OrderedStep[] = [
      { id: 'pending', title: 'First', state: { kind: 'pending', label: 'Non commencé' } },
      { id: 'done', title: 'Second', state: { kind: 'completed', label: 'Terminé' } },
      { id: 'current', title: 'Third', state: { kind: 'current', label: 'En cours' } },
    ];
    const { rerender } = render(<OrderedStepList steps={steps} aria-label="Étapes" />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).not.toHaveAttribute('aria-current');
    expect(rows[1]).not.toHaveAttribute('aria-current');
    expect(rows[2]).toHaveAttribute('aria-current', 'step');
    expect(within(rows[0]).getByText('Non commencé')).toBeVisible();
    expect(within(rows[1]).getByText('Terminé')).toBeVisible();
    expect(within(rows[2]).getByText('En cours')).toBeVisible();
    rerender(<OrderedStepList steps={steps.slice(0, 2)} aria-label="Étapes" />);
    expect(screen.getAllByRole('listitem').every((row) => !row.hasAttribute('aria-current'))).toBe(true);
  });

  it('renders caller actions for any state and delegates activation without changing progress', () => {
    const onClick = vi.fn();
    render(<OrderedStepList aria-label="Actions" steps={[
      { id: 'completed', title: 'Connected', state: { kind: 'completed', label: 'Done' },
        action: { label: 'Reconnect', ariaLabel: 'Reconnect account', onClick } },
      { id: 'passive', title: 'Settings', action: { label: 'Configure', onClick } },
      { id: 'pending', title: 'Next', state: { kind: 'pending', label: 'Waiting' },
        action: { label: 'Continue', onClick, disabled: true } },
      { id: 'busy', title: 'Request', action: { label: 'Retry', onClick, loading: true } },
    ]} />);
    const reconnect = screen.getByRole('button', { name: 'Reconnect account' });
    expect(reconnect).toHaveAttribute('type', 'button');
    fireEvent.click(reconnect);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const disabled = screen.getByRole('button', { name: 'Continue' });
    expect(disabled).toBeDisabled();
    fireEvent.click(disabled);
    const busy = screen.getByRole('button', { name: 'Retry' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(busy);
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('data-state', 'completed');
    expect(screen.getAllByRole('listitem').every((row) => !row.hasAttribute('aria-current'))).toBe(true);
  });

  it('preserves readonly caller order and stable row identity across reordering and localization', () => {
    const steps = Object.freeze(passiveSteps.map((step) => Object.freeze({ ...step })));
    const { rerender } = render(<OrderedStepList steps={steps} aria-label="Instructions" />);
    const originalRows = screen.getAllByRole('listitem');
    expect(originalRows.map((row) => row.dataset.stepId)).toEqual(['connect', 'configure', 'verify']);
    rerender(<OrderedStepList aria-label="Instructions" steps={[
      { ...steps[2], title: 'Vérifier' },
      { ...steps[0], title: 'Connexion' },
      { ...steps[1], title: 'Configuration' },
    ]} />);
    const reordered = screen.getAllByRole('listitem');
    expect(reordered[0]).toBe(originalRows[2]);
    expect(reordered[1]).toBe(originalRows[0]);
    expect(reordered[2]).toBe(originalRows[1]);
    expect(within(reordered[0]).getByText('1')).toBeInTheDocument();
    expect(steps.map((step) => step.id)).toEqual(['connect', 'configure', 'verify']);
  });

  it('supports a caller heading as the accessible list name', () => {
    render(<>
      <h2 id="guide-title">How setup works</h2>
      <OrderedStepList id="guide" steps={passiveSteps} aria-labelledby="guide-title" />
    </>);
    expect(screen.getByRole('list', { name: 'How setup works' })).toHaveAttribute('id', 'guide');
    expect(screen.getByRole('list')).not.toHaveAttribute('aria-label');
  });

  it('keeps a named empty list without fabricated instructions and accepts rich caller empty content', () => {
    const { rerender } = render(<OrderedStepList steps={[]} aria-label="Instructions" />);
    expect(screen.getByRole('list', { name: 'Instructions' })).toBeEmptyDOMElement();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText(/no data|no steps/i)).not.toBeInTheDocument();
    rerender(<OrderedStepList steps={[]} aria-label="Instructions"
      emptyContent={<p>Instructions will appear after <a href="#configure">configuration</a>.</p>} />);
    expect(screen.getByRole('link', { name: 'configuration' })).toBeVisible();
    expect(screen.getByRole('list')).toBeEmptyDOMElement();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('retains long rich content, RTL order and wrapping affordances without truncation', () => {
    const longText = 'UnbrokenLocalizedInstruction'.repeat(20);
    render(<OrderedStepList aria-label="دليل" dir="rtl" className="w-32" steps={[
      { id: 'first', title: <strong>{longText}</strong>,
        description: <><p>تفاصيل <a href="#details">المساعدة</a></p><p>{longText}</p></>,
        action: { label: longText, onClick: vi.fn() } },
      { id: 'second', title: 'التالي' },
    ]} />);
    const list = screen.getByRole('list', { name: 'دليل' });
    expect(list.parentElement).toHaveAttribute('dir', 'rtl');
    expect(list.parentElement).toHaveClass('min-w-0', 'max-w-full', 'w-32');
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.dataset.stepId)).toEqual(['first', 'second']);
    expect(rows[0].lastElementChild).toHaveClass('min-w-0', 'break-words', '[overflow-wrap:anywhere]');
    expect(screen.getByRole('link', { name: 'المساعدة' })).toBeVisible();
    expect(rows[0].querySelector('strong')).toHaveTextContent(longText);
    const button = screen.getByRole('button', { name: longText });
    expect(button).toHaveClass('h-auto', 'min-h-11', 'max-w-full', 'whitespace-normal', '[overflow-wrap:anywhere]');
    expect(rows[0].querySelector('[aria-hidden] > div')).toHaveClass(
      'h-auto', 'w-auto', 'forced-colors:text-[CanvasText]', 'forced-colors:outline-[CanvasText]',
    );
    expect(list.querySelector('[class*="truncate"], [class*="line-clamp"], [style]')).toBeNull();
    expect(list).not.toHaveClass('flex-row-reverse');
  });

  it('rejects missing or duplicate stable ids rather than falling back to localized titles', () => {
    expect(() => OrderedStepList({ 'aria-label': 'Invalid', steps: [
      { id: 'same', title: 'First' }, { id: 'same', title: 'Second' },
    ] })).toThrow('step ids must be nonempty and unique');
    expect(() => OrderedStepList({ 'aria-label': 'Invalid', steps: [
      { id: ' ', title: 'First' },
    ] })).toThrow('step ids must be nonempty and unique');
  });
});
