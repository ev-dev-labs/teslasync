import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageLayout, type PageLayoutProps } from './PageLayout';

vi.mock('@/components/layout', () => ({
  PageContainer: ({ children, className, title }: PageLayoutProps) => (
    <main className={className}>
      <header>{title}</header>
      {children}
    </main>
  ),
}));

describe('shared page content width', () => {
  it('uses the header content boundary without capping or recentering the report', () => {
    const { container } = render(
      <PageLayout title="Drive report">
        <section data-testid="report-card">Retained report content</section>
      </PageLayout>,
    );
    const content = container.querySelector('[data-layout-reference]');
    expect(content).toHaveClass('w-full', 'min-w-0', '@container');
    expect(content).not.toHaveClass('mx-auto');
    expect(content?.className).not.toMatch(/\bmax-w-/);
    expect(content?.parentElement).toBe(screen.getByText('Drive report').parentElement);
    expect(content).toContainElement(screen.getByTestId('report-card'));
  });
});
