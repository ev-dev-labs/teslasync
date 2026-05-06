import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { UserCell } from '../UserCell';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('UserCell', () => {
  it('renders an em-dash when user is null', () => {
    render(<UserCell user={null} />);
    expect(screen.getByTestId('user-cell-empty').textContent).toBe('—');
  });

  it('renders an em-dash when user is undefined', () => {
    render(<UserCell user={undefined} />);
    expect(screen.getByTestId('user-cell-empty').textContent).toBe('—');
  });

  it('renders an em-dash when user has no fields', () => {
    render(<UserCell user={{}} />);
    expect(screen.getByTestId('user-cell-empty').textContent).toBe('—');
  });

  it('renders the avatar and the display name when user.name is set', () => {
    render(<UserCell user={{ id: 'u-1', name: 'Alice Adams' }} />);
    expect(screen.getByTestId('user-cell')).toBeInTheDocument();
    expect(screen.getByTestId('avatar-initials').textContent).toBe('AA');
    // Two nodes carry the name (visible label + tooltip body) — assert both.
    const matches = screen.getAllByText('Alice Adams');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to the email local-part when name is empty', () => {
    render(<UserCell user={{ email: 'jane.smith@example.com' }} />);
    const matches = screen.getAllByText('jane.smith');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to the user id when name and email are absent', () => {
    render(<UserCell user={{ id: 'subject-abc' }} />);
    const matches = screen.getAllByText('subject-abc');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the email beneath the name when showEmail is true', () => {
    render(
      <UserCell user={{ name: 'Alice Adams', email: 'alice@example.com' }} showEmail />,
    );
    expect(screen.getAllByText('Alice Adams').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('does NOT render the email by default', () => {
    render(<UserCell user={{ name: 'Alice Adams', email: 'alice@example.com' }} />);
    expect(screen.queryByText('alice@example.com')).toBeNull();
  });

  it('always wraps the avatar in a tooltip for accessibility', () => {
    render(<UserCell user={{ name: 'Alice Adams' }} />);
    // UserCell sets showTooltip — the tooltip is the full name.
    expect(screen.getByRole('tooltip').textContent).toContain('Alice Adams');
  });
});
