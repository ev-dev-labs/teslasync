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
    const currentConfig = loadConfig(resolve('tailwind.config.js'));
    const shellGeometry = [
      ['zIndex', 'shell-panel', '80'],
      ['zIndex', 'map-control', '1000'],
      ['width', 'theme-switcher', '22rem'],
      ['width', 'connection-diagnostics', 'min(92vw, 320px)'],
      ['width', 'presentation-menu', 'min(92vw, 340px)'],
      ['width', 'workspace-context', 'min(92vw, 27rem)'],
      ['maxWidth', 'shell-panel-viewport', 'calc(100vw - 1rem)'],
      ['maxWidth', 'breadcrumb-label', '200px'],
      ['maxHeight', 'notification-panel', 'calc(100vh - 6rem)'],
      ['maxHeight', 'workspace-context', 'min(80vh, 38rem)'],
    ] as const;
    const historicalExtensions = {
      ...currentConfig.theme?.extend,
      zIndex: { ...currentConfig.theme?.extend?.zIndex },
      width: { ...currentConfig.theme?.extend?.width },
      maxWidth: { ...currentConfig.theme?.extend?.maxWidth },
      maxHeight: { ...currentConfig.theme?.extend?.maxHeight },
    };
    const config: typeof currentConfig = {
      ...currentConfig,
      theme: {
        ...currentConfig.theme,
        extend: historicalExtensions,
      },
    };
    // Historical fingerprints exclude only these separately verified MDC-043 additions.
    for (const [group, name, value] of shellGeometry) {
      expect(currentConfig.theme?.extend?.[group]).toHaveProperty(name, value);
      Reflect.deleteProperty(historicalExtensions[group], name);
    }
    const resolved = resolveConfig(config);
    const classes = [
      'z-overlay', 'z-[60]',
      'sm:max-w-modal-full', 'sm:max-w-[min(96vw,1100px)]',
      'max-w-tooltip-viewport', 'max-w-[calc(100vw-1.5rem)]',
      'sm:max-h-modal', 'sm:max-h-[90vh]',
      'h-dvh', 'h-[100dvh]', 'max-h-dvh', 'max-h-[100dvh]',
      'max-h-[calc(100dvh-var(--shell-chrome-bottom,0px))]',
      'max-w-none', 'sm:max-w-sm', 'sm:max-w-lg', 'sm:max-w-2xl',
      ...['', 'sm:', 'xl:', '2xl:'].flatMap((variant) => [
        `${variant}w-side-panel`, `${variant}w-[420px]`,
        `${variant}max-w-side-panel-viewport`, `${variant}max-w-[40vw]`,
        `${variant}min-h-side-panel-header`, `${variant}min-h-[4.5rem]`,
      ]),
      ...['', 'sm:', 'md:', 'xl:', 'forced-colors:'].flatMap((variant) => [
        `${variant}text-size-inherit`, `${variant}text-[length:inherit]`,
        `${variant}text-inherit`,
      ]),
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
        const unescaped = rule.selector
          .replace(/\\([\da-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
          .replace(/\\(.)/g, '$1');
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

    it('adds only the ten approved shell geometry roles to the full accepted config', () => {
      const current = resolveConfig(currentConfig);
      const expected = {
        ...resolved,
        theme: {
          ...resolved.theme,
          zIndex: { ...resolved.theme.zIndex },
          width: { ...resolved.theme.width },
          maxWidth: { ...resolved.theme.maxWidth },
          maxHeight: { ...resolved.theme.maxHeight },
        },
      };
      expect(shellGeometry).toHaveLength(10);
      for (const [group, name, value] of shellGeometry) {
        expect(resolved.theme[group]).not.toHaveProperty(name);
        expect(current.theme[group]).toHaveProperty(name, value);
        Reflect.set(expected.theme[group], name, value);
      }
      expect(current).toEqual(expected);
      const canonical = JSON.stringify(resolved, (_, value: unknown) => {
        if (typeof value === 'function') return value.toString();
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const entries = value as Record<string, unknown>;
          return Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));
        }
        return value;
      });
      expect(createHash('sha256').update(canonical).digest('hex'))
        .toBe('6429653abd11b06c328e4abe19051203bf9727eaf153ecbfc13a700508408d85');
    });

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
          width: { ...resolved.theme.width },
          minHeight: { ...resolved.theme.minHeight },
          fontSize: { ...resolved.theme.fontSize },
        },
      };
      Reflect.deleteProperty(previous.theme.zIndex, 'overlay');
      delete previous.theme.maxWidth['modal-full'];
      delete previous.theme.maxWidth['tooltip-viewport'];
      delete previous.theme.maxHeight.modal;
      // Strip only this later approved additive geometry before the frozen overlay fingerprint.
      delete previous.theme.width['side-panel'];
      delete previous.theme.maxWidth['side-panel-viewport'];
      delete previous.theme.minHeight['side-panel-header'];
      Reflect.deleteProperty(previous.theme.fontSize, 'size-inherit');

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

    it('adds only the three docked geometry names without prior resolved-name collisions', () => {
      const priorConfig = {
        ...config,
        theme: {
          ...config.theme,
          extend: {
            ...config.theme?.extend,
            width: { ...config.theme?.extend?.width },
            maxWidth: { ...config.theme?.extend?.maxWidth },
            minHeight: { ...config.theme?.extend?.minHeight },
            fontSize: { ...config.theme?.extend?.fontSize },
          },
        },
      };
      Reflect.deleteProperty(priorConfig.theme.extend.width, 'side-panel');
      Reflect.deleteProperty(priorConfig.theme.extend.maxWidth, 'side-panel-viewport');
      Reflect.deleteProperty(priorConfig.theme.extend.minHeight, 'side-panel-header');
      Reflect.deleteProperty(priorConfig.theme.extend.fontSize, 'size-inherit');
      const prior = resolveConfig(priorConfig);
      expect(prior.theme.width).not.toHaveProperty('side-panel');
      expect(prior.theme.maxWidth).not.toHaveProperty('side-panel-viewport');
      expect(prior.theme.minHeight).not.toHaveProperty('side-panel-header');
      expect(resolved).toEqual({
        ...prior,
        theme: {
          ...prior.theme,
          width: { ...prior.theme.width, 'side-panel': '420px' },
          maxWidth: { ...prior.theme.maxWidth, 'side-panel-viewport': '40vw' },
          minHeight: { ...prior.theme.minHeight, 'side-panel-header': '4.5rem' },
          fontSize: { ...prior.theme.fontSize, 'size-inherit': 'inherit' },
        },
      });
      const canonical = JSON.stringify(prior, (_, value: unknown) => {
        if (typeof value === 'function') return value.toString();
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const entries = value as Record<string, unknown>;
          return Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));
        }
        return value;
      });
      // Full dispatch fingerprint, including the previously accepted overlay additions/plugins.
      expect(createHash('sha256').update(canonical).digest('hex'))
        .toBe('9da0b97a5e67e5717e4c1767411cad4b7d682bd8048016e0a4447c2164e016ba');
    });

    it('adds only font-size inheritance to the full accepted dispatch config', () => {
      const priorConfig = {
        ...config,
        theme: {
          ...config.theme,
          extend: {
            ...config.theme?.extend,
            fontSize: { ...config.theme?.extend?.fontSize },
          },
        },
      };
      Reflect.deleteProperty(priorConfig.theme.extend.fontSize, 'size-inherit');
      const prior = resolveConfig(priorConfig);
      expect(prior.theme.fontSize).not.toHaveProperty('size-inherit');
      expect(resolved).toEqual({
        ...prior,
        theme: {
          ...prior.theme,
          fontSize: { ...prior.theme.fontSize, 'size-inherit': 'inherit' },
        },
      });
      const canonical = JSON.stringify(prior, (_, value: unknown) => {
        if (typeof value === 'function') return value.toString();
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const entries = value as Record<string, unknown>;
          return Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));
        }
        return value;
      });
      expect(createHash('sha256').update(canonical).digest('hex'))
        .toBe('14fb24118b45d5c77912cb0e86a20e10572577a76f8a9453027e6dc6f797caf4');
      expect(typography.size.inherit).toBe('text-size-inherit');
    });

    it.each([
      ['', null], ['sm:', resolved.theme.screens.sm],
      ['md:', resolved.theme.screens.md], ['xl:', resolved.theme.screens.xl],
      ['forced-colors:', '(forced-colors: active)'],
    ])(
      'generates only source-equivalent font-size inheritance for variant %s',
      (variant, breakpoint) => {
        const named = ruleFor(`${variant}${typography.size.inherit}`);
        const arbitrary = ruleFor(`${variant}text-[length:inherit]`);
        expect(declarations(named)).toEqual({ 'font-size': 'inherit' });
        expect(declarations(arbitrary)).toEqual(declarations(named));
        const signature = (rule: Rule) => rule.nodes.map((node) => {
          expect(node.type).toBe('decl');
          if (node.type !== 'decl') throw new Error('Expected a CSS declaration');
          return { property: node.prop, value: node.value, important: node.important ?? false };
        });
        expect(signature(named)).toEqual(signature(arbitrary));
        expect(named.parent?.type).toBe(arbitrary.parent?.type);
        if (variant) {
          const params = variant === 'forced-colors:'
            ? breakpoint
            : `(min-width: ${breakpoint})`;
          expect(named.parent).toMatchObject({ name: 'media', params });
          expect(arbitrary.parent).toMatchObject({ name: 'media', params });
        } else {
          expect(named.parent?.type).toBe('root');
        }
        expect(declarations(ruleFor(`${variant}text-inherit`))).toEqual({ color: 'inherit' });
      },
    );

    it.each([
      ['', null], ['sm:', resolved.theme.screens.sm],
      ['xl:', resolved.theme.screens.xl], ['2xl:', resolved.theme.screens['2xl']],
    ])(
      'generates exactly source-equivalent docked geometry declarations for variant %s',
      (variant, breakpoint) => {
        for (const [named, original, property, value] of [
          ['w-side-panel', 'w-[420px]', 'width', '420px'],
          ['max-w-side-panel-viewport', 'max-w-[40vw]', 'max-width', '40vw'],
          ['min-h-side-panel-header', 'min-h-[4.5rem]', 'min-height', '4.5rem'],
        ]) {
          const namedRule = ruleFor(`${variant}${named}`);
          const originalRule = ruleFor(`${variant}${original}`);
          expect(declarations(namedRule)).toEqual({ [property]: value });
          expect(declarations(namedRule)).toEqual(declarations(originalRule));
          if (variant) {
            expect(namedRule.parent).toMatchObject({
              name: 'media', params: `(min-width: ${breakpoint})`,
            });
            expect(originalRule.parent).toMatchObject({
              name: 'media', params: `(min-width: ${breakpoint})`,
            });
          } else {
            expect(namedRule.parent?.type).toBe('root');
            expect(originalRule.parent?.type).toBe('root');
          }
        }
      },
    );

    it('retains pixel width, viewport cap and growing rem-based header minimum numerically', () => {
      const width = Number.parseFloat(declarations(ruleFor('w-side-panel')).width);
      const cap = Number.parseFloat(declarations(ruleFor('max-w-side-panel-viewport'))['max-width']);
      const header = Number.parseFloat(declarations(ruleFor('min-h-side-panel-header'))['min-height']);
      for (const viewport of [1280, 1440, 1920, 2560]) {
        expect(Math.min(width, viewport * cap / 100)).toBe(420);
      }
      expect(Math.min(width, 1000 * cap / 100)).toBe(400);
      expect(header * 16).toBe(72);
      expect(header * 20).toBe(90);
      expect(declarations(ruleFor('min-h-side-panel-header'))).not.toHaveProperty('height');
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
