import { describe, expect, it } from 'vitest';
import { canonicalPreloadDependencies } from '../../scripts/preloadDependencies';

describe('canonical module preload hints', () => {
  it('canonicalizes equivalent script sets while preserving every stylesheet position and dependency', () => {
    const first = Object.freeze(['z.js', 'first.css', 'a.js', 'second.css', 'shared.js', 'font.woff2']);
    const second = Object.freeze(['shared.js', 'first.css', 'z.js', 'second.css', 'a.js', 'font.woff2']);
    const expected = ['a.js', 'first.css', 'shared.js', 'second.css', 'z.js', 'font.woff2'];
    expect(canonicalPreloadDependencies(first)).toEqual(expected);
    expect(canonicalPreloadDependencies(second)).toEqual(expected);
    expect([...expected].sort()).toEqual([...first].sort());
  });

  it('retains duplicate hints and leaves non-script dependencies untouched', () => {
    const dependencies = Object.freeze(['z.js', 'theme.css?version=1', 'a.js', 'a.js', 'icon.svg']);
    expect(canonicalPreloadDependencies(dependencies))
      .toEqual(['a.js', 'theme.css?version=1', 'a.js', 'z.js', 'icon.svg']);
    expect(canonicalPreloadDependencies(['first.css', 'second.css'])).toEqual(['first.css', 'second.css']);
    expect(canonicalPreloadDependencies([])).toEqual([]);
  });
});
