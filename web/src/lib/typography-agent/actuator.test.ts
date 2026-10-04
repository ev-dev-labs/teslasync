import { TypographyActuator } from './actuator';

describe('TypographyActuator', () => {
  afterEach(() => {
    TypographyActuator.clearTokens();
    document.documentElement.style.removeProperty('--type-size-base');
    document.documentElement.style.removeProperty('--font-scale');
  });

  it('applies dynamic root tokens without injecting a stylesheet', () => {
    const createElement = vi.spyOn(document, 'createElement');
    TypographyActuator.applyTokens({ '--type-size-base': 'clamp(14px, 1vw, 18px)' });
    expect(document.documentElement.style.getPropertyValue('--type-size-base')).toBe('clamp(14px, 1vw, 18px)');
    expect(document.documentElement.style.getPropertyValue('--type-system-active')).toBe('1');
    expect(createElement).not.toHaveBeenCalled();
    createElement.mockRestore();
  });

  it('replaces the token layer instead of retaining obsolete properties', () => {
    TypographyActuator.applyTokens({ '--type-size-base': '16px' });
    TypographyActuator.applyTokens({ '--type-size-lg': '24px' });
    expect(document.documentElement.style.getPropertyValue('--type-size-base')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--type-size-lg')).toBe('24px');
    TypographyActuator.clearTokens();
    expect(document.documentElement.style.getPropertyValue('--type-size-lg')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--type-system-active')).toBe('');
  });

  it('restores prior values and priorities while preserving unrelated settings', () => {
    const style = document.documentElement.style;
    style.setProperty('--type-size-base', '15px', 'important');
    style.setProperty('--font-scale', '1.2');
    TypographyActuator.applyTokens({ '--type-size-base': '18px' });
    TypographyActuator.clearTokens();
    expect(style.getPropertyValue('--type-size-base')).toBe('15px');
    expect(style.getPropertyPriority('--type-size-base')).toBe('important');
    expect(style.getPropertyValue('--font-scale')).toBe('1.2');
  });
});
