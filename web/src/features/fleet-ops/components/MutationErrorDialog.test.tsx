import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ApiError } from '@/api/client';
import { MutationErrorDialog } from './MutationErrorDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, value),
        fallback,
      ),
  }),
}));

it('identifies optimistic conflicts and offers a refresh', () => {
  const refresh = vi.fn();
  render(
    <MutationErrorDialog
      error={new ApiError('record changed since it was loaded', 409)}
      resourceName="driver"
      onClose={vi.fn()}
      onRefresh={refresh}
    />,
  );
  expect(screen.getByRole('dialog', { name: 'Record changed' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Refresh before trying again');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
  expect(refresh).toHaveBeenCalledOnce();
});
