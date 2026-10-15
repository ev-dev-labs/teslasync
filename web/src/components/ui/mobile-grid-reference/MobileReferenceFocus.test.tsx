import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import '@/i18n';
import { Button } from '@/components/ui';
import { MobileReferenceDialogs } from './MobileReferenceDialogs';
import { referenceCallbacks, referenceModel } from './testFixtures';

afterEach(cleanup);
function SortHarness() {
  const [open, setOpen] = useState(false);
  const model = referenceModel();
  const callbacks = referenceCallbacks();
  callbacks.onOverlay = (_overlay, next) => setOpen(next);
  return <>
    <Button onClick={() => setOpen(true)}>Open reference sort</Button>
    <MobileReferenceDialogs model={{ ...model, overlays: { sort: open, overflow: false } }} callbacks={callbacks} />
  </>;
}
describe('shared Modal focus contract composed by sort candidate', () => {
  it('focuses current radio, traps Tab at the footer, closes Escape and restores trigger', () => {
    render(<SortHarness />);
    const trigger = screen.getByRole('button', { name: 'Open reference sort' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('radio', { name: 'Newest first' })).toHaveFocus();
    const last = screen.getByRole('button', { name: 'Done' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it('dismisses by backdrop and returns focus without a new focus implementation', () => {
    const { baseElement } = render(<SortHarness />);
    const trigger = screen.getByRole('button', { name: 'Open reference sort' });
    trigger.focus(); fireEvent.click(trigger);
    const backdrop = baseElement.querySelector('.fixed[aria-hidden="true"]');
    if (!backdrop) throw new Error('Expected shared Modal backdrop');
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
