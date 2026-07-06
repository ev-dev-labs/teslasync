/**
 * Tooltip text-colour contract tests.
 *
 * The shared `<Tooltip>` (web/src/components/ui/Tooltip.tsx) ships an
 * INVERTED surface for high contrast (light card in dark mode / dark card
 * in light mode) and cascades its own intrinsic `text-gray-100
 * dark:text-gray-900` pair through the JSX content. A child that hardcodes
 * `text-white/N` or `text-gray-{100..400}` will render invisibly in one of
 * the two themes — these tests pin the dev-time `console.warn` backstop
 * that catches the bug at run-time before it reaches production.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { Tooltip } from '../Tooltip';

describe('Tooltip — text-colour contract', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Default to development mode for the dev-time warn path.
    vi.stubEnv('PROD', '');
    vi.stubEnv('MODE', 'development');
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('renders without inheriting any text colour override on the body', () => {
    const { getByRole } = render(
      <Tooltip content="hello">
        <span>trigger</span>
      </Tooltip>,
    );
    const tip = getByRole('tooltip');
    // The intrinsic colour pair is on the tooltip body itself; no text-* class
    // should be inherited from the trigger or wrapper.
    expect(tip.className).toContain('text-[var(--text-inverse)]');
    expect(tip.className).toContain('dark:bg-gray-100');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn for plain string content', () => {
    render(
      <Tooltip content="just a label">
        <span>trigger</span>
      </Tooltip>,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when JSX content omits text-colour classes', () => {
    render(
      <Tooltip
        multiline
        content={
          <div className="space-y-1">
            <span className="font-semibold">Title</span>
            <span>Body copy that inherits the tooltip colour.</span>
          </div>
        }
      >
        <span>trigger</span>
      </Tooltip>,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn for decorative shades that convey meaning (text-amber-300)', () => {
    render(
      <Tooltip
        multiline
        content={
          <div>
            <span className="text-amber-300">Severity: warning</span>
          </div>
        }
      >
        <span>trigger</span>
      </Tooltip>,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn for emerald-300 (success) decorative class', () => {
    render(
      <Tooltip
        content={
          <span className="text-emerald-300">healthy</span>
        }
      >
        <span>trigger</span>
      </Tooltip>,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns once when content hardcodes text-white/80 (dev mode)', () => {
    render(
      <Tooltip
        multiline
        content={<div className="text-white/80">invisible body</div>}
      >
        <span>trigger</span>
      </Tooltip>,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.[0];
    expect(typeof message).toBe('string');
    expect(message as string).toContain('text-white/80');
    expect(message as string).toContain('inverted surface');
  });

  it('warns when content hardcodes text-gray-200 (within 100..400 band)', () => {
    render(
      <Tooltip
        multiline
        content={<span className="text-gray-200">grey body</span>}
      >
        <span>trigger</span>
      </Tooltip>,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0] as string).toContain('text-gray-200');
  });

  it('walks nested children to find the hardcoded class (dev mode)', () => {
    render(
      <Tooltip
        multiline
        content={
          <div className="space-y-1">
            <span className="font-semibold">Title</span>
            <div>
              <span className="text-white/70">nested invisible body</span>
            </div>
          </div>
        }
      >
        <span>trigger</span>
      </Tooltip>,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0] as string).toContain('text-white/70');
  });

  it('does NOT warn in production builds even with offending content', () => {
    vi.stubEnv('PROD', 'true');
    vi.stubEnv('MODE', 'production');
    render(
      <Tooltip
        multiline
        content={<div className="text-white/80">would-be-invisible</div>}
      >
        <span>trigger</span>
      </Tooltip>,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT warn for text-gray-500 (outside 100..400 band — fine on both surfaces)', () => {
    render(
      <Tooltip
        multiline
        content={<span className="text-gray-500">muted</span>}
      >
        <span>trigger</span>
      </Tooltip>,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
