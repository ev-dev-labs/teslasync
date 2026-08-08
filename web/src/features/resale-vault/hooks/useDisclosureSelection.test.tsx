import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDisclosureSelection } from './useDisclosureSelection';
import { DISCLOSURE_PROFILE_SECTIONS } from '../lib/constants';

describe('useDisclosureSelection', () => {
  it('defaults to the resale profile, VIN excluded, day precision', () => {
    const { result } = renderHook(() => useDisclosureSelection());
    expect(result.current.selection.profileId).toBe('resale');
    expect(result.current.selection.sections).toEqual(DISCLOSURE_PROFILE_SECTIONS.resale);
    expect(result.current.selection.sensitive).toEqual({ vinDisclosure: 'excluded', exactTimestamps: false });
  });

  it('setProfile("warranty") resets sections to the warranty profile default', () => {
    const { result } = renderHook(() => useDisclosureSelection());
    act(() => result.current.setProfile('warranty'));
    expect(result.current.selection.profileId).toBe('warranty');
    expect(result.current.selection.sections).toEqual(DISCLOSURE_PROFILE_SECTIONS.warranty);
  });

  it('toggleSection switches to "custom" and adds/removes the given section', () => {
    const { result } = renderHook(() => useDisclosureSelection());
    // The default "resale" profile already includes every section, so the
    // first toggle removes it; the second toggle adds it back.
    act(() => result.current.toggleSection('security_incidents'));
    expect(result.current.selection.profileId).toBe('custom');
    expect(result.current.selection.sections).not.toContain('security_incidents');

    act(() => result.current.toggleSection('security_incidents'));
    expect(result.current.selection.sections).toContain('security_incidents');
  });

  it('setVinDisclosure/setExactTimestamps update only the sensitive sub-object', () => {
    const { result } = renderHook(() => useDisclosureSelection());
    act(() => result.current.setVinDisclosure('masked'));
    expect(result.current.selection.sensitive.vinDisclosure).toBe('masked');
    act(() => result.current.setExactTimestamps(true));
    expect(result.current.selection.sensitive).toEqual({ vinDisclosure: 'masked', exactTimestamps: true });
  });

  it('reset() restores the default selection', () => {
    const { result } = renderHook(() => useDisclosureSelection());
    act(() => {
      result.current.setProfile('warranty');
      result.current.setVinDisclosure('full');
      result.current.setExactTimestamps(true);
    });
    act(() => result.current.reset());
    expect(result.current.selection.profileId).toBe('resale');
    expect(result.current.selection.sensitive).toEqual({ vinDisclosure: 'excluded', exactTimestamps: false });
  });
});
