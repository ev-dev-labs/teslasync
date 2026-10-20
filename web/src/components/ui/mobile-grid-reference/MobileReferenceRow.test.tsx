import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { MobileReferenceRow } from './MobileReferenceRow';
import { referenceRow } from './testFixtures';

afterEach(cleanup);
describe('mobile row activation and preservation', () => {
  it('opens exactly once on Enter/Space/click, with no extra open controls', () => {
    const activate = vi.fn(); const toggle = vi.fn();
    const { container } = render(<MobileReferenceRow row={referenceRow()} variant="cards"
      selecting={false} selected={false} onActivate={activate} onToggle={toggle} />);
    const card = screen.getByRole('button', { name: 'Reference record' });
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.click(card);
    expect(activate).toHaveBeenCalledTimes(3);
    expect(toggle).not.toHaveBeenCalled();
    expect(container.querySelector('[data-card] button, [data-card] a')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('selection routes both card and checkbox only to caller-owned toggle', () => {
    const activate = vi.fn(); const toggle = vi.fn();
    render(<MobileReferenceRow row={referenceRow()} variant="cards"
      selecting selected onActivate={activate} onToggle={toggle} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(activate).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
  it('exposes an invalid role mapping rather than discarding source fields silently', () => {
    const row = referenceRow(); const activate = vi.fn();
    render(<MobileReferenceRow row={{ ...row, meta: [...row.meta, ...row.meta] }}
      variant="cards" selecting={false} selected={false} onActivate={activate} onToggle={vi.fn()} />);
    expect(screen.getByText(/Invalid mobile mapping/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open reference details and actions' }));
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it('keeps long names accessible and zero distinct from missing values', () => {
    const row = referenceRow();
    const longTitle = 'Long reference '.repeat(40);
    const { container } = render(<MobileReferenceRow row={{ ...row, title: longTitle, meta: [
      ...row.meta, { key: 'duration_s', label: 'Duration', value: '—' },
    ] }} variant="cards" selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: longTitle.trim() })).toBeInTheDocument();
    expect(screen.getByText('0 kWh')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.querySelector('[data-card-label]')).toHaveAttribute('title', longTitle);
    expect(container.querySelectorAll('[data-card-meta]')).toHaveLength(2);
  });
  it('renders optional raw key/value label and exactly one labelled progress/badge', () => {
    const row = referenceRow();
    const { rerender, container } = render(<MobileReferenceRow row={{ ...row,
      badge: { value: 'A', label: 'Battery score A' },
      progress: { from: 45, to: 80, label: 'Battery from 45% to 80%' },
    }} variant="cards" selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByLabelText('Battery score A')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Battery from 45% to 80%' })).toBeInTheDocument();
    rerender(<MobileReferenceRow row={{ ...row, rawLabel: 'BatteryLevelLongRawFieldName' }} variant="keyValue"
      selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
    expect(container.querySelector('[data-kv-row]')).toBeInTheDocument();
    expect(container.querySelector('[data-card]')).toBeNull();
    expect(screen.getByText('BatteryLevelLongRawFieldName')).toBeInTheDocument();
  });
});
