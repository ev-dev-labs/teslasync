import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@/i18n';
import { EmptyState } from '../EmptyState';

function renderInRouter(ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <Routes>
        <Route path="/start" element={ui} />
        <Route path="/target" element={<div data-testid="target-page">Target reached</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EmptyState', () => {
  it('renders icon, title, and message', () => {
    renderInRouter(
      <EmptyState
        icon={<span data-testid="icon">★</span>}
        title="Nothing here"
        message="No data has been recorded yet."
      />,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /nothing here/i })).toBeInTheDocument();
    expect(screen.getByText(/no data has been recorded/i)).toBeInTheDocument();
  });

  it('renders supporting guidance separately from the primary message', () => {
    renderInRouter(
      <EmptyState
        message="No sessions have been recorded."
        description="Complete a charging session to populate this view."
      />,
    );

    expect(screen.getByText('No sessions have been recorded.')).toBeInTheDocument();
    expect(
      screen.getByText('Complete a charging session to populate this view.'),
    ).toBeInTheDocument();
  });

  it('exposes role="status" so assistive tech announces empty surfaces', () => {
    renderInRouter(<EmptyState message="Nothing yet" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('invokes the action onClick handler when the action button is clicked', () => {
    const onClick = vi.fn();
    renderInRouter(
      <EmptyState message="Nothing yet" action={{ label: 'Do thing', onClick }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /do thing/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders actionTo as a navigating <a> Link element', () => {
    renderInRouter(
      <EmptyState
        message="Nothing yet"
        actionTo={{ label: 'Go to target', to: '/target' }}
      />,
    );
    const link = screen.getByRole('link', { name: /go to target/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/target');
    fireEvent.click(link);
    expect(screen.getByTestId('target-page')).toBeInTheDocument();
  });

  it('prefers actionTo over action when both are provided (only the link renders)', () => {
    const onClick = vi.fn();
    renderInRouter(
      <EmptyState
        message="Nothing yet"
        action={{ label: 'Imperative', onClick }}
        actionTo={{ label: 'Navigate', to: '/target' }}
      />,
    );
    expect(screen.getByRole('link', { name: /navigate/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /imperative/i })).not.toBeInTheDocument();
  });

  it('renders no CTA element when neither action nor actionTo is provided', () => {
    renderInRouter(<EmptyState message="Nothing yet" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
