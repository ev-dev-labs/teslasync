import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import postcss, { type Root, type Rule } from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import resolveConfig from 'tailwindcss/resolveConfig';
import { beforeAll, describe, it, expect } from 'vitest';
import { motion, neonColorMap, semanticToNeon, severityTokens, gaugeTone, glassCardClasses, chartTokens, typography } from '../tokens';

describe('restrained foundation presentation', () => {
  it('keeps unknown/neutral distinct from information', () => {
    expect(semanticToNeon.neutral).not.toBe(semanticToNeon.info);
    expect(neonColorMap[semanticToNeon.neutral].text).toBe('text-[var(--text-secondary)]');
  });

  describe('additive overlay geometry (MDC-024 / MDC-022)', () => {
    const config = loadConfig(resolve('tailwind.config.js'));
    const resolved = resolveConfig(config);
    const classes = [
      'z-overlay', 'z-[60]',
      'sm:max-w-modal-full', 'sm:max-w-[min(96vw,1100px)]',
      'max-w-tooltip-viewport', 'max-w-[calc(100vw-1.5rem)]',
      'sm:max-h-modal', 'sm:max-h-[90vh]',
      'h-dvh', 'h-[100dvh]', 'max-h-dvh', 'max-h-[100dvh]',
      'max-h-[calc(100dvh-var(--shell-chrome-bottom,0px))]',
      'max-w-none', 'sm:max-w-sm', 'sm:max-w-lg', 'sm:max-w-2xl',
    ];
    let css: Root;

    beforeAll(async () => {
      // Raw candidates avoid scanning the application while using its real plugins.
      const result = await postcss([tailwindcss({
        ...config,
        content: [{ raw: classes.join(' '), extension: 'html' }],
      })]).process('@tailwind utilities;', { from: undefined });
      css = result.root;
    });

    function ruleFor(className: string): Rule {
      const matches: Rule[] = [];
      css.walkRules((rule) => {
        const unescaped = rule.selector.replace(/\\2c /g, ',').replace(/\\(.)/g, '$1');
        if (unescaped === `.${className}`) matches.push(rule);
      });
      expect(matches, className).toHaveLength(1);
      return matches[0];
    }

    function declarations(rule: Rule) {
      const values: Record<string, string> = {};
      rule.walkDecls((declaration) => { values[declaration.prop] = declaration.value; });
      return values;
    }

    it('adds only the approved resolved roles and preserves every prior config entry', () => {
      expect(resolved.theme.zIndex).toHaveProperty('overlay', '60');
      expect(resolved.theme.maxWidth['modal-full']).toBe('min(96vw,1100px)');
      expect(resolved.theme.maxWidth['tooltip-viewport']).toBe('calc(100vw - 1.5rem)');
      expect(resolved.theme.maxHeight.modal).toBe('90vh');

      const previous = {
        ...resolved,
        theme: {
          ...resolved.theme,
          zIndex: { ...resolved.theme.zIndex },
          maxWidth: { ...resolved.theme.maxWidth },
          maxHeight: { ...resolved.theme.maxHeight },
        },
      };
      Reflect.deleteProperty(previous.theme.zIndex, 'overlay');
      delete previous.theme.maxWidth['modal-full'];
      delete previous.theme.maxWidth['tooltip-viewport'];
      delete previous.theme.maxHeight.modal;

      // Captured before this additive change: includes plugins, screens and all tokens.
      const canonical = JSON.stringify(previous, (_, value: unknown) => {
        if (typeof value === 'function') return value.toString();
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const entries = value as Record<string, unknown>;
          return Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));
        }
        return value;
      });
      expect(createHash('sha256').update(canonical).digest('hex'))
        .toBe('63d006e08dcb1f52224d56d3f7d7d1525736932525b32c951702ae968f7dc503');
    });

    it.each([
      ['z-overlay', 'z-[60]', 'z-index', '60'],
      ['sm:max-w-modal-full', 'sm:max-w-[min(96vw,1100px)]', 'max-width', 'min(96vw,1100px)'],
      ['max-w-tooltip-viewport', 'max-w-[calc(100vw-1.5rem)]', 'max-width', 'calc(100vw - 1.5rem)'],
      ['sm:max-h-modal', 'sm:max-h-[90vh]', 'max-height', '90vh'],
      ['h-dvh', 'h-[100dvh]', 'height', '100dvh'],
      ['max-h-dvh', 'max-h-[100dvh]', 'max-height', '100dvh'],
    ])('generates source-equivalent CSS for %s', (named, original, property, value) => {
      const namedRule = ruleFor(named);
      const originalRule = ruleFor(original);
      expect(declarations(namedRule)).toEqual({ [property]: value });
      // Tailwind formats commas in arbitrary values, but not named theme values.
      const normalized = (rule: Rule) => Object.fromEntries(
        Object.entries(declarations(rule)).map(([key, entry]) => [key, entry.replace(/,\s*/g, ',')]),
      );
      expect(normalized(namedRule)).toEqual(normalized(originalRule));
      expect(namedRule.parent?.type).toBe(originalRule.parent?.type);
      if (named.startsWith('sm:')) {
        expect(namedRule.parent).toMatchObject({ name: 'media', params: '(min-width: 640px)' });
        expect(originalRule.parent).toMatchObject({ name: 'media', params: '(min-width: 640px)' });
      } else {
        expect(namedRule.parent?.type).toBe('root');
      }
    });

    it('retains 640px responsive precedence, the shell cap and fullscreen distinction', () => {
      expect(resolved.theme.screens.sm).toBe('640px');
      expect(resolved.theme.height.dvh).toBe('100dvh');
      expect(resolved.theme.maxHeight.dvh).toBe('100dvh');
      const shellCap = ruleFor('max-h-[calc(100dvh-var(--shell-chrome-bottom,0px))]');
      expect(declarations(shellCap)).toEqual({
        'max-height': 'calc(100dvh - var(--shell-chrome-bottom,0px))',
      });
      expect(shellCap.parent?.type).toBe('root');
      const modalCap = ruleFor('sm:max-h-modal');
      const modalWidth = ruleFor('sm:max-w-modal-full');
      const fullscreenWidth = ruleFor('max-w-none');
      expect(declarations(fullscreenWidth)).toEqual({ 'max-width': 'none' });
      expect(declarations(modalWidth)).not.toEqual(declarations(fullscreenWidth));
      expect(css.nodes.findIndex((node) => node === modalCap.parent)).toBeGreaterThan(css.nodes.indexOf(shellCap));
      expect(css.nodes.findIndex((node) => node === modalWidth.parent)).toBeGreaterThan(css.nodes.indexOf(fullscreenWidth));
      for (const size of ['sm', 'lg', '2xl']) {
        const width = ruleFor(`sm:max-w-${size}`);
        expect(width.parent).toMatchObject({ name: 'media', params: '(min-width: 640px)' });
        expect(declarations(width)).toEqual({ 'max-width': resolved.theme.maxWidth[size] });
      }
    });
  });

  it('retains status meanings without colored shadows', () => {
    for (const variant of Object.values(neonColorMap)) {
      expect(variant.glow).toBe('shadow-none');
    }
    expect(severityTokens.critical.fg).toBe(neonColorMap.red.text);
    expect(severityTokens.success.fg).toBe(neonColorMap.green.text);
    expect(gaugeTone.warning).toBe('var(--semantic-warning)');
    expect(typography.role.error).toContain('--semantic-danger');
  });

  it('uses adaptive convenience surfaces and neutral chart chrome', () => {
    for (const surface of Object.values(glassCardClasses)) {
      expect(surface).toContain('var(--panel-bg)');
      expect(surface).not.toContain('white');
    }
    expect(chartTokens.brush.stroke).toBe('var(--text-secondary)');
    expect(chartTokens.cursor.stroke).toBe('var(--text-secondary)');
    expect(chartTokens.brush.travellerWidth).toBe(8);
    expect(chartTokens.brush.height).toBe(28);
  });
});

describe('motion tokens (Phase-45 / Prompt 21)', () => {
  describe('motion.duration', () => {
    it('exposes three semantic buckets', () => {
      expect(Object.keys(motion.duration).sort()).toEqual(['fast', 'normal', 'slow']);
    });

    it('fast = 150ms (hover, focus, micro-feedback)', () => {
      expect(motion.duration.fast).toBe('150ms');
    });

    it('normal = 250ms (entrance, exit, panel transitions)', () => {
      expect(motion.duration.normal).toBe('250ms');
    });

    it('slow = 400ms (page transitions, large layout shifts)', () => {
      expect(motion.duration.slow).toBe('400ms');
    });

    it('values are strictly ordered fast < normal < slow', () => {
      const ms = (s: string) => Number.parseInt(s.replace('ms', ''), 10);
      expect(ms(motion.duration.fast)).toBeLessThan(ms(motion.duration.normal));
      expect(ms(motion.duration.normal)).toBeLessThan(ms(motion.duration.slow));
    });
  });

  describe('motion.easing', () => {
    it('exposes standard, accelerate, decelerate cubic-bezier curves', () => {
      expect(Object.keys(motion.easing).sort()).toEqual([
        'accelerate',
        'decelerate',
        'standard',
      ]);
    });

    it('every easing is a cubic-bezier(...) string', () => {
      for (const v of Object.values(motion.easing)) {
        expect(v).toMatch(/^cubic-bezier\(/);
      }
    });
  });

  describe('motion.twDuration', () => {
    it('maps the same buckets to Tailwind utility class names', () => {
      expect(motion.twDuration.fast).toBe('duration-fast');
      expect(motion.twDuration.normal).toBe('duration-normal');
      expect(motion.twDuration.slow).toBe('duration-slow');
    });

    it('class names are kebab-case Tailwind tokens (no raw numbers)', () => {
      for (const v of Object.values(motion.twDuration)) {
        // The whole point of the token system is to keep raw `duration-NNN`
        // numeric utilities out of the codebase — assert that here.
        expect(v).not.toMatch(/duration-\d+/);
      }
    });
  });
});
