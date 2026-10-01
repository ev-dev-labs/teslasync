import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const fixtures = vi.hoisted(() => {
  const create = (id: string, name: string, widgetIds: string[]) => ({
    id, name,
    widgets: widgetIds.map((widgetId, index) => ({ id: `${id}-${index}`, widgetId })),
    layouts: { lg: [] },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  });
  return [
    create('default', 'Default', ['battery-gauge', 'vehicle-hero']),
    create('minimal', 'Minimal', ['battery-radial-gauge']),
    { ...create('broken', 'Broken Import', []), widgets: undefined },
  ];
});

vi.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string, options?: Record<string, unknown>) =>
    typeof fallback === 'string'
      ? Object.entries(options ?? {}).reduce((text, [key, value]) =>
          text.replace(`{{${key}}}`, String(value)), fallback)
      : _key;
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('@/features/dashboard/hooks/useDashboardLayout', async () => {
  const actual = await vi.importActual<typeof import('@/features/dashboard/hooks/useDashboardLayout')>(
    '@/features/dashboard/hooks/useDashboardLayout',
  );
  return { ...actual, DASHBOARD_PRESETS: fixtures };
});

import { TemplateGallery } from '../TemplateGallery';

afterEach(cleanup);

function setup(initialTemplateId?: string) {
  const onClose = vi.fn();
  const onApply = vi.fn();
  const props = { open: true, onClose, onApply, initialTemplateId };
  return { ...render(<TemplateGallery {...props} />), props, onClose, onApply };
}

describe('TemplateGallery', () => {
  it('does not render while closed', () => {
    render(<TemplateGallery open={false} onClose={vi.fn()} onApply={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows named starters and a preview together, without a drill-down', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Create a layout' });
    expect(within(dialog).getByRole('button', { name: /Blank Dashboard/ })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: /Minimal/ })).toBeVisible();
    expect(within(dialog).getByRole('heading', { name: 'Layout preview' })).toBeVisible();
    expect(within(dialog).getByLabelText(/Layout name/)).toHaveValue('Default');
    expect(within(dialog).getByText('2 widgets')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: /Minimal/ }));
    expect(within(dialog).getByLabelText(/Layout name/)).toHaveValue('Minimal');
    expect(within(dialog).getByText('1 widgets')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Template Preview' })).toBeNull();
  });

  it('creates the selected starter with a trimmed custom name', () => {
    const { onApply } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Minimal/ }));
    fireEvent.change(screen.getByLabelText(/Layout name/), { target: { value: '  My commute  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create layout' }));
    expect(onApply).toHaveBeenCalledWith('minimal', 'My commute');
  });

  it('opens blank selection directly and only creates it after naming', () => {
    const { onApply } = setup('__blank__');
    expect(screen.getByRole('button', { name: /Blank Dashboard/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/Layout name/)).toHaveValue('New Layout');
    fireEvent.change(screen.getByLabelText(/Layout name/), { target: { value: 'Fresh Board' } });
    fireEvent.keyDown(screen.getByLabelText(/Layout name/), { key: 'Enter' });
    expect(onApply).toHaveBeenCalledWith('__blank__', 'Fresh Board');
  });

  it('filters starters by widget or purpose and allows clearing empty results', () => {
    setup();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search layout starters' }), { target: { value: 'Level Gauge' } });
    expect(screen.getByRole('button', { name: /Minimal/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Blank Dashboard/ })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search layout starters' }), { target: { value: 'zzzzxyz' } });
    expect(screen.getByText('No starters match this search.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('button', { name: /Blank Dashboard/ })).toBeVisible();
  });

  it('rejects an empty name and tolerates a starter with missing widgets', () => {
    const { onApply } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Broken Import/ }));
    expect(screen.getByText('0 widgets')).toBeVisible();
    fireEvent.change(screen.getByLabelText(/Layout name/), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Create layout' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText(/Layout name/), { key: 'Enter' });
    expect(screen.getByText('Enter a name for the layout.')).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('resets the selection, name, and search when reopened', () => {
    const { rerender, props } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Minimal/ }));
    fireEvent.change(screen.getByLabelText(/Layout name/), { target: { value: 'Old name' } });
    rerender(<TemplateGallery {...props} open={false} />);
    rerender(<TemplateGallery {...props} open initialTemplateId="__blank__" />);
    expect(screen.getByLabelText(/Layout name/)).toHaveValue('New Layout');
    expect(screen.getByRole('button', { name: /Blank Dashboard/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('closes via the dialog close control', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
