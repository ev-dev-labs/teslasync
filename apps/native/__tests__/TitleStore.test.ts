import {
  __resetTitleStoreForTests,
  getBasePrefix,
  getBaseTitle,
  getComposedTitle,
  getFlashPrefix,
  isNativeTitleBarAvailable,
  setBasePrefix,
  setBaseTitle,
  setFlashPrefix,
  subscribeTitle,
} from '../src/web-parity/lib/titleStore';

// Native parity port of web/src/lib/__tests__/titleStore.test.ts. The web suite
// asserted against `document.title`; React Native has no DOM, so the composed
// surface is read back via getComposedTitle() (which records exactly what the
// web wrote to document.title).
describe('web-parity titleStore', () => {
  beforeEach(() => {
    __resetTitleStoreForTests();
  });

  it('starts with the default base title and no prefixes', () => {
    expect(getBaseTitle()).toBe('TeslaSync');
    expect(getBasePrefix()).toBe('');
    expect(getFlashPrefix()).toBe('');
    expect(getComposedTitle()).toBe('TeslaSync');
  });

  it('writes the base title to the composed surface', () => {
    setBaseTitle('Dashboard — TeslaSync');
    expect(getComposedTitle()).toBe('Dashboard — TeslaSync');
    expect(getBaseTitle()).toBe('Dashboard — TeslaSync');
  });

  it('prepends the base prefix to the title', () => {
    setBaseTitle('Dashboard — TeslaSync');
    setBasePrefix('(3) ');
    expect(getComposedTitle()).toBe('(3) Dashboard — TeslaSync');
  });

  it('flash prefix overrides base prefix when both are set', () => {
    setBaseTitle('Dashboard — TeslaSync');
    setBasePrefix('(3) ');
    setFlashPrefix('(!) ALERT — ');
    expect(getComposedTitle()).toBe('(!) ALERT — Dashboard — TeslaSync');
  });

  it('clearing the flash prefix restores the base prefix', () => {
    setBaseTitle('Dashboard — TeslaSync');
    setBasePrefix('(3) ');
    setFlashPrefix('(!) ALERT — ');
    setFlashPrefix('');
    expect(getComposedTitle()).toBe('(3) Dashboard — TeslaSync');
  });

  it('clearing the base prefix removes the prefix entirely', () => {
    setBaseTitle('Dashboard — TeslaSync');
    setBasePrefix('(3) ');
    setBasePrefix('');
    expect(getComposedTitle()).toBe('Dashboard — TeslaSync');
  });

  it('changing the base title preserves the active prefix', () => {
    setBasePrefix('(7) ');
    setBaseTitle('Drives — TeslaSync');
    expect(getComposedTitle()).toBe('(7) Drives — TeslaSync');
    setBaseTitle('Charging — TeslaSync');
    expect(getComposedTitle()).toBe('(7) Charging — TeslaSync');
  });

  it('handles empty flash prefix as not active (falls back to base prefix)', () => {
    setBaseTitle('App');
    setBasePrefix('(1) ');
    setFlashPrefix('');
    expect(getComposedTitle()).toBe('(1) App');
  });

  it('reset helper restores defaults and the composed surface', () => {
    setBaseTitle('Foo');
    setBasePrefix('(9) ');
    setFlashPrefix('(!) ');
    __resetTitleStoreForTests();
    expect(getBaseTitle()).toBe('TeslaSync');
    expect(getBasePrefix()).toBe('');
    expect(getFlashPrefix()).toBe('');
    expect(getComposedTitle()).toBe('TeslaSync');
  });

  it('reports the OS title bar as unavailable on native (rule 7)', () => {
    expect(isNativeTitleBarAvailable()).toBe(false);
  });

  it('subscribeTitle replays the current title and streams updates', () => {
    setBaseTitle('Dashboard — TeslaSync');
    const seen: string[] = [];
    const unsubscribe = subscribeTitle(t => seen.push(t));

    // Immediate replay with the current composed title.
    expect(seen).toEqual(['Dashboard — TeslaSync']);

    setBasePrefix('(2) ');
    setFlashPrefix('(!) ');
    expect(seen).toEqual([
      'Dashboard — TeslaSync',
      '(2) Dashboard — TeslaSync',
      '(!) Dashboard — TeslaSync',
    ]);

    // Unsubscribe stops further delivery.
    unsubscribe();
    setBaseTitle('Other — TeslaSync');
    expect(seen).toHaveLength(3);
  });

  it('reset clears the native listener registry', () => {
    const seen: string[] = [];
    subscribeTitle(t => seen.push(t));
    seen.length = 0;

    __resetTitleStoreForTests();
    setBaseTitle('After Reset');
    // Listener was cleared by reset, so no further pushes arrive.
    expect(seen).toEqual([]);
  });
});
