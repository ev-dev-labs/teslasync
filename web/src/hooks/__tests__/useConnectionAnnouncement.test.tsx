/**
 * Live-connection announcement contract (A11Y-06).
 *
 * The rules that matter here are the negative ones: no announcement on
 * mount, none for a re-render at the same status, and none while
 * resolving the initial `unknown` state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useConnectionAnnouncement } from '@/hooks/useConnectionAnnouncement';
import { __resetStatusAnnouncerForTests } from '@/hooks/useStatusAnnouncer';
import {
  subscribeAnnouncer,
  __resetAnnouncerForTests,
  type AnnouncerPriority,
} from '@/hooks/useAnnouncer';
import { __resetAnnouncePolicyForTests } from '@/lib/announcePolicy';
import type { LiveConnectionStatus } from '@/hooks/useLiveConnection';

describe('useConnectionAnnouncement', () => {
  let spoken: { message: string; priority: AnnouncerPriority }[];
  let stop: () => void;

  beforeEach(() => {
    __resetAnnouncerForTests();
    __resetAnnouncePolicyForTests();
    __resetStatusAnnouncerForTests();
    spoken = [];
    stop = subscribeAnnouncer((message, priority) => {
      spoken.push({ message: message.replace(/\u200B+$/, ''), priority });
    });
  });

  afterEach(() => {
    stop();
    __resetStatusAnnouncerForTests();
  });

  function renderStatus(initial: LiveConnectionStatus) {
    return renderHook(
      ({ status }: { status: LiveConnectionStatus }) =>
        useConnectionAnnouncement(status, { label: 'Live data' }),
      { initialProps: { status: initial } },
    );
  }

  it('says nothing on mount', () => {
    renderStatus('connected');
    expect(spoken).toHaveLength(0);
  });

  it('says nothing when the status is unchanged across re-renders', () => {
    const { rerender } = renderStatus('connected');
    rerender({ status: 'connected' });
    rerender({ status: 'connected' });
    expect(spoken).toHaveLength(0);
  });

  it('announces a drop assertively', () => {
    const { rerender } = renderStatus('connected');
    rerender({ status: 'disconnected' });
    expect(spoken).toHaveLength(1);
    expect(spoken[0].priority).toBe('assertive');
  });

  it('announces a reconnect attempt politely', () => {
    const { rerender } = renderStatus('connected');
    rerender({ status: 'reconnecting' });
    expect(spoken[0].priority).toBe('polite');
  });

  it('stays silent while resolving the initial unknown state', () => {
    const { rerender } = renderStatus('unknown');
    rerender({ status: 'connected' });
    expect(spoken).toHaveLength(0);
  });

  it('never announces the unknown status itself', () => {
    const { rerender } = renderStatus('connected');
    rerender({ status: 'unknown' });
    expect(spoken).toHaveLength(0);
  });

  it('respects enabled={false}', () => {
    const { rerender } = renderHook(
      ({ status }: { status: LiveConnectionStatus }) =>
        useConnectionAnnouncement(status, { enabled: false }),
      { initialProps: { status: 'connected' as LiveConnectionStatus } },
    );
    rerender({ status: 'disconnected' });
    expect(spoken).toHaveLength(0);
  });
});
