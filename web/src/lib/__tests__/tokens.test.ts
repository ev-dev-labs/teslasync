import { describe, it, expect } from 'vitest';
import { motion, neonColorMap, semanticToNeon, severityTokens, gaugeTone, glassCardClasses, chartTokens, typography } from '../tokens';

describe('restrained foundation presentation', () => {
  it('keeps unknown/neutral distinct from information', () => {
    expect(semanticToNeon.neutral).not.toBe(semanticToNeon.info);
    expect(neonColorMap[semanticToNeon.neutral].text).toBe('text-[var(--text-secondary)]');
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
