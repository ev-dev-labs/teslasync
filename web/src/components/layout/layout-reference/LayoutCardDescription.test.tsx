import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui';
import { LayoutCard } from './LayoutCard';

const title = 'A complete long heading that must remain readable and must name its description help control';
const description = 'A deliberately long description with every original sentence and detail retained. Only its visual preview is clamped; the shared tooltip must expose the full explanation through a native keyboard-focusable and phone-tappable help button.';
const helpName = `Read full description for ${title}`;

describe('LayoutCard complete description help', () => {
  it('retains the full heading and description and uses a native named help button', () => {
    const { container } = render(
      <LayoutCard title={title} description={description} footer={<span>Original footer</span>}>
        <span>Original content</span>
      </LayoutCard>,
    );
    expect(screen.getByRole('heading', { name: title })).toHaveTextContent(title);
    const trigger = screen.getByRole('button', { name: helpName });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).not.toHaveAttribute('tabindex');
    expect(container.querySelector('[data-card-desc]')?.textContent).toBe(description);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe(description);
    expect(trigger.getAttribute('aria-describedby')?.split(/\s+/)).toContain(tooltip.id);
    expect(trigger).toHaveAccessibleDescription(description);
    expect(container.querySelector('[data-card]')).toHaveAttribute('data-card-size', 'full');
    expect(screen.getByText('Original content')).toBeInTheDocument();
    expect(screen.getByText('Original footer')).toBeInTheDocument();
  });

  it('supports keyboard focus, phone click focus, and Escape without a focus trap', () => {
    render(
      <LayoutCard title={title} description={description}
        actions={<Button type="button">Original action</Button>}>
        <Button type="button">Next content action</Button>
      </LayoutCard>,
    );
    const trigger = screen.getByRole('button', { name: helpName });
    act(() => trigger.focus());
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleDescription(description);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).not.toHaveFocus();
    // Touch-generated click must explicitly focus even on browsers that do
    // not grant button focus on a tap. Tooltip owns focus-within disclosure.
    fireEvent.touchStart(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    const next = screen.getByRole('button', { name: 'Next content action' });
    act(() => next.focus());
    expect(next).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Original action' })).toBeInTheDocument();
  });

  it('does not fabricate a help control when description is absent', () => {
    render(<LayoutCard title={title}><span>Independent content remains</span></LayoutCard>);
    expect(screen.queryByRole('button', { name: helpName })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText('Independent content remains')).toBeInTheDocument();
  });
});
