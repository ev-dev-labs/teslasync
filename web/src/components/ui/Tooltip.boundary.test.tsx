import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tooltip } from './Tooltip';

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
    expect(screen.getByRole('tooltip')).toHaveStyle({ maxWidth: '200px', translate: '-92px 0' });
    expect(screen.getByRole('tooltip')).toHaveClass('whitespace-normal', 'break-words');
  });

  it('retains the unbounded single-line API when no boundary is requested', () => {
    render(<Tooltip content="Short label"><span>Prepared marker</span></Tooltip>);
    expect(screen.getByRole('tooltip').style.maxWidth).toBe('');
    expect(screen.getByRole('tooltip')).toHaveClass('whitespace-nowrap');
  });
});
