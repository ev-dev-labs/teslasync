import { describe, it, expect } from 'vitest';
import { motion } from '../tokens';

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
