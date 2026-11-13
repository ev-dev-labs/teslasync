import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from './Tooltip';
import { Button } from './Button';

afterEach(() => vi.restoreAllMocks());

describe('Tooltip allocated boundary', () => {
  it('wraps and constrains a long description to its caller-owned surface', () => {
    const boundary = document.createElement('div');
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this === boundary ? new DOMRect(50, 0, 200, 12) : new DOMRect(240, 0, 4, 12);
    });
    render(
      <Tooltip content="Complete caller-supplied marker description" boundaryRef={{ current: boundary }}>
        <span>Prepared marker</span>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toHaveStyle({ maxWidth: '200px', left: '-190px' });
    expect(screen.getByRole('tooltip').style.translate).toBe('');
    expect(screen.getByRole('tooltip')).toHaveClass('whitespace-normal', 'break-words');
  });

  it('retains the unbounded single-line API when no boundary is requested', () => {
    render(<Tooltip content="Short label"><span>Prepared marker</span></Tooltip>);
    expect(screen.getByRole('tooltip').style.maxWidth).toBe('');
    expect(screen.getByRole('tooltip')).toHaveClass('whitespace-nowrap');
  });

  it('keeps portaled help out of the header layout through composition changes and scrolling', async () => {
    let left = 252;
    let top = 140;
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(80);
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => new DOMRect(left, top, 44, 44));
    const { container, unmount } = render(
      <Tooltip content="Complete mobile header explanation" side="bottom" multiline portal>
        <Button>Header info</Button>
      </Tooltip>,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(container).not.toContainElement(tooltip);
    expect(tooltip.closest('[data-app-design-portal]')?.parentElement).toBe(document.body);
    expect(tooltip).toHaveClass('fixed', 'opacity-0');
    expect(tooltip).toHaveStyle({ left: '58px', top: '192px', maxWidth: '366px' });
    await act(async () => {
      left = 100;
      container.setAttribute('class', 'recomposed-header');
    });
    expect(tooltip).toHaveStyle({ left: '12px', top: '192px' });
    top = 940;
    fireEvent.scroll(window);
    expect(tooltip).toHaveStyle({ left: '12px', top: '852px' });
    unmount();
    expect(document.querySelector('[data-app-design-portal]')).toBeNull();
    const calls = bounds.mock.calls.length;
    fireEvent.scroll(window);
    expect(bounds.mock.calls).toHaveLength(calls);
  });

  it('reveals portaled full copy on hover or focus, dismisses with Escape and retains focus', () => {
    render(
      <Tooltip content="The final instruction is preserved." portal>
        <Button aria-describedby="external">Header info</Button>
      </Tooltip>,
    );
    const trigger = screen.getByText('Header info');
    const tooltip = screen.getByRole('tooltip');
    expect(trigger).toHaveAttribute('aria-describedby', `external ${tooltip.id}`);
    fireEvent.mouseEnter(trigger.parentElement!);
    expect(tooltip).toHaveClass('opacity-100');
    act(() => trigger.focus());
    fireEvent.mouseLeave(trigger.parentElement!);
    expect(tooltip).toHaveClass('opacity-100');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(tooltip).toHaveClass('!opacity-0');
    act(() => trigger.blur());
    expect(tooltip).toHaveClass('opacity-0');
    act(() => trigger.focus());
    expect(tooltip).toHaveClass('opacity-100');
    expect(tooltip).not.toHaveClass('!opacity-0');
    expect(tooltip).toHaveTextContent('The final instruction is preserved.');
  });
});
