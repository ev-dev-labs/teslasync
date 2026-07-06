/**
 * getErrorMessage helper tests.
 *
 * getErrorMessage() is the single normaliser every error boundary and
 * React Query `error` render path funnels through, so it has to turn any
 * `unknown` into a non-empty, human-readable string. These tests cover
 * each branch (Error, string, object-shaped rejection, unknown value),
 * the blank-message fallback that prevents a dangling "Failed to load: "
 * in the UI, and the localisable `fallback` override.
 */

import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './errorMessage';
import { ApiError, RateLimitError } from './resilience';

const DEFAULT_FALLBACK = 'An unexpected error occurred';

describe('getErrorMessage', () => {
  describe('Error instances', () => {
    it('returns the message of a plain Error', () => {
      expect(getErrorMessage(new Error('Boom'))).toBe('Boom');
    });

    it('returns the message of a TypeError subclass', () => {
      expect(getErrorMessage(new TypeError('Cannot read x of undefined'))).toBe(
        'Cannot read x of undefined',
      );
    });

    it('returns the message of the production ApiError subclass', () => {
      const err = new ApiError('Vehicle not found', 404, 'NOT_FOUND');
      expect(getErrorMessage(err)).toBe('Vehicle not found');
    });

    it('returns the message of a deeply-derived error (RateLimitError)', () => {
      const err = new RateLimitError('Too many requests', 30, 'vehicles');
      expect(getErrorMessage(err)).toBe('Too many requests');
    });

    it('preserves the exact message content, including internal whitespace', () => {
      expect(getErrorMessage(new Error('a  b\tc'))).toBe('a  b\tc');
    });

    it('falls back when an Error carries an empty message (blank-panel bug)', () => {
      expect(getErrorMessage(new Error(''))).toBe(DEFAULT_FALLBACK);
    });

    it('falls back when an Error message is only whitespace', () => {
      expect(getErrorMessage(new Error('   \t\n'))).toBe(DEFAULT_FALLBACK);
    });

    it('uses a caller-supplied fallback for an empty Error message', () => {
      expect(getErrorMessage(new Error(''), 'Une erreur est survenue')).toBe(
        'Une erreur est survenue',
      );
    });
  });

  describe('string errors', () => {
    it('returns a non-empty thrown string verbatim', () => {
      expect(getErrorMessage('something exploded')).toBe('something exploded');
    });

    it('falls back for an empty string', () => {
      expect(getErrorMessage('')).toBe(DEFAULT_FALLBACK);
    });

    it('falls back for a whitespace-only string', () => {
      expect(getErrorMessage('    ')).toBe(DEFAULT_FALLBACK);
    });
  });

  describe('object-shaped rejections', () => {
    it('surfaces a string `message` field from a non-Error object', () => {
      expect(getErrorMessage({ message: 'Backend down' })).toBe('Backend down');
    });

    it('surfaces a string `error` field when there is no `message`', () => {
      expect(getErrorMessage({ error: 'invalid_grant' })).toBe('invalid_grant');
    });

    it('prefers `message` over `error` when both are present', () => {
      expect(getErrorMessage({ message: 'primary', error: 'secondary' })).toBe('primary');
    });

    it('falls through to `error` when `message` is present but not a string', () => {
      expect(getErrorMessage({ message: 42, error: 'real reason' })).toBe('real reason');
    });

    it('falls back when the `message` field is an empty string', () => {
      expect(getErrorMessage({ message: '   ' })).toBe(DEFAULT_FALLBACK);
    });

    it('falls back for an object with no message/error fields', () => {
      expect(getErrorMessage({ code: 500, detail: 'nope' })).toBe(DEFAULT_FALLBACK);
    });

    it('falls back for an empty object', () => {
      expect(getErrorMessage({})).toBe(DEFAULT_FALLBACK);
    });
  });

  describe('unknown / primitive values', () => {
    it('falls back for null', () => {
      expect(getErrorMessage(null)).toBe(DEFAULT_FALLBACK);
    });

    it('falls back for undefined', () => {
      expect(getErrorMessage(undefined)).toBe(DEFAULT_FALLBACK);
    });

    it('falls back for a number', () => {
      expect(getErrorMessage(500)).toBe(DEFAULT_FALLBACK);
    });

    it('falls back for a boolean', () => {
      expect(getErrorMessage(false)).toBe(DEFAULT_FALLBACK);
    });

    it('honours a caller-supplied (localised) fallback for unknown values', () => {
      expect(getErrorMessage(null, 'خطأ غير متوقع')).toBe('خطأ غير متوقع');
    });
  });

  describe('invariants', () => {
    it('always returns a non-empty string across a matrix of inputs', () => {
      const inputs: unknown[] = [
        new Error('x'),
        new Error(''),
        'msg',
        '',
        { message: 'm' },
        { error: 'e' },
        {},
        null,
        undefined,
        42,
        true,
        [],
      ];
      for (const input of inputs) {
        const result = getErrorMessage(input);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });
  });
});
