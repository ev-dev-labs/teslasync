import { renderHook, waitFor } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import i18n from './index';

vi.unmock('react-i18next');

describe('feature-bound production translations', () => {
  it.each([
    { key: 'widget.chargeCost.sessions', fallback: '{{count}} sessions', count: 1, expected: '1 session' },
    { key: 'widget.chargeCost.sessions', fallback: '{{count}} sessions', count: 2, expected: '2 sessions' },
    { key: 'widget.speedHeatmap.drives', fallback: '{{count}} drives', count: 1, expected: '1 drive' },
    { key: 'widget.speedHeatmap.drives', fallback: '{{count}} drives', count: 2, expected: '2 drives' },
  ])('hydrates and pluralizes $key with count $count', async ({ key, fallback, count, expected }) => {
    const { result } = renderHook(() => useTranslation('dashboard'));

    await waitFor(() => {
      expect(result.current.t(key, fallback, { count })).toBe(expected);
      expect(i18n.getResource('en', 'translation', `${key}_one`)).toBe(
        key === 'widget.chargeCost.sessions' ? '{{count}} session' : '{{count}} drive',
      );
    });
  });
});
