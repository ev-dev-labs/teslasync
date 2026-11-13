import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@/i18n';
import { EmptyState } from '../EmptyState';
import { getAppDesignAttributes, observeAppDesignScopes } from '../../ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';

const controlRules: Rule[] = [];
postcss.parse(readFileSync(resolve(
  process.cwd(), 'src', 'components', 'ui', 'app-designs', 'controls.css',
), 'utf8')).walkRules(rule => { controlRules.push(rule); });

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
  it.each(PACK_IDS)('%s binds both navigation CTAs to real control consumers without replacing anchors', pack => {
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <MemoryRouter>
          <EmptyState
            message="Retained empty-state guidance"
            actionTo={{ label: 'Review drives', to: '/drives?range=7d' }}
            secondaryActionTo={{ label: 'Review settings', to: '/settings' }}
          />
        </MemoryRouter>
      </div>,
    );
    const release = observeAppDesignScopes(view.container.firstElementChild!);
    try {
      const links = screen.getAllByRole('link');
      expect(links.map(link => link.getAttribute('href'))).toEqual(['/drives?range=7d', '/settings']);
      for (const link of links) {
        expect(link.tagName).toBe('A');
        expect(link).toHaveAttribute('data-app-part', 'button');
        expect(link).toHaveAttribute('data-app-variant', 'secondary');
        expect(link).toHaveAttribute('data-app-size', 'md');
        const selected = controlRules.flatMap(rule => rule.selectors.filter(selector =>
          selector.includes('[data-app-part~="button"]') && selector.includes('[data-app-variant="secondary"]')
          && [...document.querySelectorAll(selector)].includes(link),
        ));
        expect(selected.length).toBeGreaterThan(0);
        expect(link.querySelector('button')).toBeNull();
        link.focus();
        expect(link).toHaveFocus();
      }
    } finally {
      release();
    }
  });

  it('keeps routerless navigation fallback and disabled/busy imperative actions separate', () => {
    const onClick = vi.fn();
    const view = render(<EmptyState
      message="Retained routerless guidance"
      actionTo={{ label: 'Choose a vehicle', to: '/vehicles' }}
      secondaryActionTo={{ label: 'Read help', to: '/help' }}
    />);
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/vehicles', '/help']);
    expect(screen.getByRole('status')).toHaveTextContent('Retained routerless guidance');
    expect(screen.getAllByRole('link')[0]).not.toHaveAttribute('data-app-design-owner');
    view.rerender(<EmptyState message="Retained guidance" action={{ label: 'Retry', onClick, disabled: true }} />);
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(onClick).not.toHaveBeenCalled();
    view.rerender(<EmptyState message="Retained guidance" action={{ label: 'Retry', onClick, loading: true }} />);
    expect(retry).toBeDisabled();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(retry);
    expect(onClick).not.toHaveBeenCalled();
  });

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

  it('marks self-populating content as informational without inventing a CTA', () => {
    renderInRouter(<EmptyState variant="informational" message="Data appears after the next sync." />);
    expect(screen.getByRole('status')).toHaveAttribute('data-variant', 'informational');
    expect(screen.getByRole('status')).toHaveTextContent('Data appears after the next sync.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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

  it('renders a secondary CTA beside the primary and wires both handlers', () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    renderInRouter(
      <EmptyState
        message="Nothing yet"
        action={{ label: 'Primary path', onClick: onPrimary }}
        secondaryAction={{ label: 'Other path', onClick: onSecondary }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /primary path/i }));
    fireEvent.click(screen.getByRole('button', { name: /other path/i }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('renders a lone secondary CTA without requiring a primary', () => {
    const onSecondary = vi.fn();
    renderInRouter(
      <EmptyState message="Nothing yet" secondaryAction={{ label: 'Other path', onClick: onSecondary }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /other path/i }));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('prefers secondary navigation without changing the primary imperative action', () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    renderInRouter(
      <EmptyState
        message="Nothing yet"
        action={{ label: 'Primary action', onClick: onPrimary }}
        secondaryAction={{ label: 'Secondary action', onClick: onSecondary }}
        secondaryActionTo={{ label: 'Secondary destination', to: '/target' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Primary action' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Secondary action' })).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Secondary destination' });
    expect(link).toHaveAttribute('href', '/target');
    fireEvent.click(link);
    expect(screen.getByTestId('target-page')).toBeInTheDocument();
    expect(onSecondary).not.toHaveBeenCalled();
  });

  it('keeps imperative defaults enabled, not busy, and native form submission intact', () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());
    renderInRouter(
      <form onSubmit={onSubmit}>
        <EmptyState
          message="Nothing yet"
          action={{ label: 'Primary action', onClick }}
          secondaryAction={{ label: 'Secondary action', onClick }}
        />
      </form>,
    );
    for (const name of ['Primary action', 'Secondary action']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-busy');
      expect(button).not.toHaveAttribute('type');
      fireEvent.click(button);
    }
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('retains long RTL content and action labels with bounded wrapping classes', () => {
    const label = 'الإجراء الطويل '.repeat(12).trim();
    const message = 'سجل_غير_متوفر'.repeat(30);
    renderInRouter(
      <div dir="rtl">
        <EmptyState
          title={label}
          message={message}
          description={message + ' المزيد'}
          action={{ label, onClick: vi.fn() }}
          secondaryActionTo={{ label: label + ' رابط', to: '/target' }}
          className="owned-empty-state"
        />
      </div>,
    );
    expect(screen.getByRole('status')).toHaveClass('owned-empty-state', 'min-w-0');
    expect(screen.getByRole('heading')).toHaveTextContent(label.trim());
    expect(screen.getByText(message)).toHaveClass('break-words');
    expect(screen.getByText(message + ' المزيد')).toHaveClass('break-words');
    const button = screen.getByRole('button', { name: label.trim() });
    expect(button).toHaveClass('max-w-full', 'whitespace-normal', 'min-h-11');
    const link = screen.getByRole('link', { name: (label + ' رابط').trim() });
    expect(link).toHaveClass('max-w-full', 'break-words', 'min-h-11');
    expect(link).toHaveAttribute('href', '/target');
    expect(button.parentElement).toHaveClass('flex-wrap', 'max-w-full');
  });
});
