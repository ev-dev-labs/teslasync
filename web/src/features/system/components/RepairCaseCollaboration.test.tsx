import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepairCaseComment } from '@/api/hooks/useDataRepair';
import { ToastProvider } from '@/components/feedback';
import catalog from '@/i18n/en.json';
import { RepairCaseCollaboration } from './RepairCaseCollaboration';

vi.unmock('react-i18next');
const transport = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ request: transport }));

const translation = createInstance();
const comments: RepairCaseComment[] = [{
  id: 11,
  case_id: 7,
  actor: 'Evidence reviewer',
  body: 'Original full note\nSecond line retained',
  created_at: '2026-08-25T10:04:00Z',
}];
const initialProps = {
  caseId: 7,
  assignedTo: 'Review operator',
  comments,
  canWrite: true,
  writeBlockReason: 'Return to live mode',
};

function renderCollaboration() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui = (props = initialProps) => (
    <I18nextProvider i18n={translation}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RepairCaseCollaboration {...props} />
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
  return { ...render(ui()), ui, client };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

beforeAll(async () => {
  await translation.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: catalog },
      fr: { translation: { dataRepair: { cases: { assignee: 'Responsable' } } } },
    },
    interpolation: { escapeValue: false },
  });
});
beforeEach(async () => {
  transport.mockReset();
  transport.mockResolvedValue({});
  await translation.changeLanguage('en');
});
afterEach(cleanup);

describe('RepairCaseCollaboration visible assignee label', () => {
  it('keeps a canonical visible label associated with the populated assignee, not just its placeholder', () => {
    renderCollaboration();
    const field = screen.getByRole('textbox', { name: catalog.dataRepair.cases.assignee });
    const label = screen.getByText(catalog.dataRepair.cases.assignee, { selector: 'label' });
    expect(label).toBeVisible();
    expect(label).toHaveAttribute('for', field.id);
    expect(field).toHaveAccessibleName(catalog.dataRepair.cases.assignee);
    expect(field).toHaveValue('Review operator');
    expect(field).toHaveAttribute('placeholder', catalog.dataRepair.cases.assigneePlaceholder);
    expect(screen.getByRole('heading', { name: catalog.dataRepair.cases.assignmentTitle })).toBeVisible();
    expect(screen.getByRole('heading', { name: catalog.dataRepair.cases.activityTitle })).toBeVisible();
    expect(screen.getByText('Evidence reviewer')).toBeVisible();
    expect(screen.getByText(/Original full note/).textContent).toBe(comments[0].body);
    expect(transport).not.toHaveBeenCalled();
  });

  it('localizes the visible label without changing field identity or editable drafts', async () => {
    renderCollaboration();
    const field = screen.getByRole('textbox', { name: 'Assignee' });
    const originalId = field.id;
    fireEvent.change(field, { target: { value: '  Edited operator  ' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Add review note' }), { target: { value: 'Draft note' } });
    await act(async () => { await translation.changeLanguage('fr'); });
    const localizedField = screen.getByRole('textbox', { name: 'Responsable' });
    expect(screen.getByText('Responsable', { selector: 'label' })).toBeVisible();
    expect(screen.getByText('Responsable', { selector: 'label' })).toHaveAttribute('for', originalId);
    expect(localizedField).toBe(field);
    expect(localizedField).toHaveValue('  Edited operator  ');
    expect(screen.getByRole('textbox', { name: 'Add review note' })).toHaveValue('Draft note');
    expect(transport).not.toHaveBeenCalled();
  });

  it('gives simultaneous panels independent label bindings even for the same case', () => {
    renderCollaboration();
    renderCollaboration();
    const fields = screen.getAllByRole('textbox', { name: 'Assignee' });
    const labels = screen.getAllByText('Assignee', { selector: 'label' });
    expect(fields[0].id).not.toBe(fields[1].id);
    labels.forEach((label, index) => {
      expect(label).toBeVisible();
      expect(label).toHaveAttribute('for', fields[index].id);
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('preserves both panels, full notes and drafts when editing permission changes', () => {
    const { rerender, ui } = renderCollaboration();
    fireEvent.change(screen.getByRole('textbox', { name: 'Assignee' }), { target: { value: 'Draft operator' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Add review note' }), { target: { value: 'Draft note' } });
    rerender(ui({ ...initialProps, canWrite: false }));
    for (const name of ['Assignee', 'Add review note']) {
      expect(screen.getByRole('textbox', { name })).toBeDisabled();
    }
    for (const name of ['Save assignment', 'Add note']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Return to live mode');
      fireEvent.click(button);
    }
    expect(screen.getByText('Assignee', { selector: 'label' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Assignee' })).toHaveValue('Draft operator');
    expect(screen.getByRole('textbox', { name: 'Add review note' })).toHaveValue('Draft note');
    expect(screen.getByText(/Original full note/).textContent).toBe(comments[0].body);
    expect(screen.getAllByRole('heading')).toHaveLength(2);
    expect(transport).not.toHaveBeenCalled();
    rerender(ui());
    expect(screen.getByRole('button', { name: 'Save assignment' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeEnabled();
  });

  it('preserves assignment payload, pending state and rejected draft through an explicit retry', async () => {
    const request = deferred<unknown>();
    transport.mockReturnValueOnce(request.promise);
    renderCollaboration();
    fireEvent.change(screen.getByRole('textbox', { name: 'Assignee' }), { target: { value: '  New operator  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    expect(transport).toHaveBeenLastCalledWith('/data-repair/cases/7/assignment', {
      method: 'PUT', requiresLiveMode: true, body: JSON.stringify({ assigned_to: 'New operator' }),
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save assignment' })).toBeDisabled());
    expect(screen.getByText('Assignee', { selector: 'label' })).toBeVisible();
    await act(async () => { request.reject(new Error('Assignment unavailable')); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save assignment' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Assignee' })).toHaveValue('  New operator  ');
    fireEvent.change(screen.getByRole('textbox', { name: 'Assignee' }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(transport).toHaveBeenLastCalledWith('/data-repair/cases/7/assignment', {
      method: 'PUT', requiresLiveMode: true, body: JSON.stringify({ assigned_to: null }),
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save assignment' })).toBeEnabled());
  });

  it('retains rejected review notes and clears them only after a successful retry', async () => {
    const first = deferred<RepairCaseComment>();
    const retry = deferred<RepairCaseComment>();
    transport.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    renderCollaboration();
    const note = screen.getByRole('textbox', { name: 'Add review note' });
    expect(note).toHaveAttribute('rows', '3');
    expect(note).toHaveAttribute('maxlength', '2000');
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled();
    fireEvent.change(note, { target: { value: '  Draft note\nSecond line  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    expect(transport).toHaveBeenLastCalledWith('/data-repair/cases/7/comments', {
      method: 'POST', requiresLiveMode: true, body: JSON.stringify({ body: 'Draft note\nSecond line' }),
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled());
    expect(note).toHaveValue('  Draft note\nSecond line  ');
    await act(async () => { first.reject(new Error('Note unavailable')); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add note' })).toBeEnabled());
    expect(note).toHaveValue('  Draft note\nSecond line  ');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(note).toHaveValue('  Draft note\nSecond line  ');
    await act(async () => { retry.resolve(comments[0]); });
    await waitFor(() => expect(note).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled();
    expect(screen.getByText(/Original full note/).textContent).toBe(comments[0].body);
  });

  it('preserves case-change draft reset and routes subsequent assignment to the new case', async () => {
    const { rerender, ui } = renderCollaboration();
    const field = screen.getByRole('textbox', { name: 'Assignee' });
    const originalId = field.id;
    fireEvent.change(field, { target: { value: 'Old draft' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Add review note' }), { target: { value: 'Old note' } });
    rerender(ui({ ...initialProps, caseId: 8, assignedTo: 'Next operator', comments: [] }));
    expect(screen.getByRole('textbox', { name: 'Assignee' })).toHaveValue('Next operator');
    expect(screen.getByRole('textbox', { name: 'Assignee' })).toHaveAttribute('id', originalId);
    expect(screen.getByText('Assignee', { selector: 'label' })).toHaveAttribute('for', originalId);
    expect(screen.getByRole('textbox', { name: 'Add review note' })).toHaveValue('');
    expect(screen.getByText(catalog.dataRepair.cases.noComments)).toBeVisible();
    expect(screen.getAllByRole('heading')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));
    await waitFor(() => expect(transport).toHaveBeenLastCalledWith('/data-repair/cases/8/assignment', {
      method: 'PUT', requiresLiveMode: true, body: JSON.stringify({ assigned_to: 'Next operator' }),
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save assignment' })).toBeEnabled());
  });
});
