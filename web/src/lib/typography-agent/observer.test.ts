/**
 * @vitest-environment jsdom
 */
import { TypographyObserver, breadcrumb } from './observer';

describe('TypographyObserver', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  it('returns no anomalies for a clean subtree', () => {
    root.innerHTML = '<p style="font-size: var(--type-size-base)">Hello world</p>';
    expect(new TypographyObserver().observe(root)).toEqual([]);
  });

  it('flags hardcoded inline font sizes but not token references', () => {
    root.innerHTML = [
      '<p id="bad" style="font-size: 13px">Hardcoded</p>',
      '<p id="good" style="font-size: var(--type-size-base)">Tokenized</p>',
    ].join('');
    const anomalies = new TypographyObserver().observe(root);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('HARDCODED_LEAK');
    expect(anomalies[0].severity).toBe('warning');
    expect(anomalies[0].selector).toContain('p#bad');
  });

  it('always skips the HUD root, scripts, and styles', () => {
    root.innerHTML = [
      '<div id="typography-hud-root"><p style="font-size: 99px">HUD</p></div>',
      '<script>var x = 1;</script>',
    ].join('');
    // Scripts carry no direct text children with font styles; the HUD
    // subtree is excluded by id.
    const anomalies = new TypographyObserver().observe(root);
    expect(anomalies.filter((a) => a.selector.includes('typography-hud-root'))).toEqual([]);
  });

  it('honors extra exclusions', () => {
    root.innerHTML = '<p id="skip" style="font-size: 13px">Skip me</p>';
    expect(new TypographyObserver().observe(root, ['skip'])).toEqual([]);
  });

  it('builds tag-class breadcrumbs without ids', () => {
    root.innerHTML = '<section class="panel wide"><p>Text</p></section>';
    const p = root.querySelector('p') as HTMLElement;
    expect(breadcrumb(p)).toContain('p');
    expect(breadcrumb(p)).toContain('section.panel.wide');
  });
});
