import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DensityToggle } from '../DensityToggle';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | undefined, opts?: Record<string, unknown>) => {
      const tpl = fallback ?? '';
      if (!opts) return tpl;
      return Object.entries(opts).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        tpl,
      );
    },
  }),
}));

describe('DensityToggle', () => {
  it('renders all 3 default options as a radiogroup', () => {
    render(<DensityToggle value="comfortable" onChange={vi.fn()} testId="dt" />);
    const group = screen.getByTestId('dt');
    expect(group).toHaveAttribute('role', 'radiogroup');
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(3);
  });

  it('marks the selected option with aria-checked=true', () => {
    render(<DensityToggle value="compact" onChange={vi.fn()} testId="dt" />);
    expect(screen.getByTestId('dt-compact')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('dt-table')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('dt-comfortable')).toHaveAttribute('aria-checked', 'false');
  });

  it('only the selected radio has tabIndex=0', () => {
    render(<DensityToggle value="table" onChange={vi.fn()} testId="dt" />);
    expect(screen.getByTestId('dt-table')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('dt-compact')).toHaveAttribute('tabindex', '-1');
  });

  it('calls onChange when an option is clicked', () => {
    const onChange = vi.fn();
    render(<DensityToggle value="table" onChange={onChange} testId="dt" />);
    fireEvent.click(screen.getByTestId('dt-comfortable'));
    expect(onChange).toHaveBeenCalledWith('comfortable');
  });

  it('moves selection with arrow keys (radiogroup pattern)', () => {
    const onChange = vi.fn();
    render(<DensityToggle value="compact" onChange={onChange} testId="dt" />);
    const group = screen.getByTestId('dt');

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('comfortable');

    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('table');
  });

  it('wraps around at the ends with arrow keys', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DensityToggle value="table" onChange={onChange} testId="dt" />,
    );
    fireEvent.keyDown(screen.getByTestId('dt'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('comfortable');

    rerender(<DensityToggle value="comfortable" onChange={onChange} testId="dt" />);
    fireEvent.keyDown(screen.getByTestId('dt'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('table');
  });

  it('respects a constrained options list', () => {
    render(
      <DensityToggle
        value="compact"
        onChange={vi.fn()}
        options={['compact', 'comfortable']}
        testId="dt"
      />,
    );
    expect(screen.queryByTestId('dt-table')).toBeNull();
    expect(screen.getByTestId('dt-compact')).toBeInTheDocument();
    expect(screen.getByTestId('dt-comfortable')).toBeInTheDocument();
  });

  it('uses the supplied ariaLabel for the group', () => {
    render(
      <DensityToggle
        value="comfortable"
        onChange={vi.fn()}
        ariaLabel="Custom group label"
        testId="dt"
      />,
    );
    expect(screen.getByLabelText('Custom group label')).toBeInTheDocument();
  });
});
