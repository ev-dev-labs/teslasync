import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { TypographyAgentLoop, DEFAULT_TYPOGRAPHY_SPEC } from '@/lib/typography-agent/orchestrator';
import type {
  DensityMode,
  TypographySpec,
  VerificationResult,
} from '@/lib/typography-agent/types';
import { broadcast, useBroadcast } from '@/lib/broadcast';
import { TOPICS } from '@/lib/broadcastTopics';
import { useSettings } from '@/hooks/useSettings';

// The HUD pulls route-only UI primitives (Select, Slider, GlassPanel) that
// must stay out of the entry chunk (CLEAN-06): only the token subscription
// is eager, the toggle-only UI loads on first open — same split as
// AchievementUnlockListener / AchievementUnlockedToast.
const AmbientTypographyHUD = lazy(() =>
  import('./AmbientTypographyHUD').then((m) => ({ default: m.AmbientTypographyHUD })),
);

// ─────────────────────────────────────────────────────────────────────────────
// TypographyAgentProvider — hosts the connected-typography OHAV loop.
//
// A single module-level agent instance is shared by the ambient HUD and the
// Settings → Typography section so both drive the same dispatch() store.
// On mount the provider applies the persisted spec (or seeds density from
// the workspace settings), then keeps peer tabs in sync over broadcast:
// local dispatches emit `typography.spec.changed`, and incoming hints
// reload + re-apply. HUD visibility toggles with Cmd/Ctrl+Shift+T.
// ─────────────────────────────────────────────────────────────────────────────

/** Maps the workspace density scale onto the agent's leading model. */
export function mapWorkspaceDensity(density: string): DensityMode {
  if (density === 'compact') return 'compact';
  if (density === 'spacious') return 'relaxed';
  return 'comfortable';
}

let sharedAgent: TypographyAgentLoop | null = null;

function getSharedAgent(): TypographyAgentLoop {
  if (!sharedAgent) {
    sharedAgent = new TypographyAgentLoop(
      TypographyAgentLoop.loadPersisted() ?? DEFAULT_TYPOGRAPHY_SPEC,
    );
  }
  return sharedAgent;
}

/** Test-only reset for the module singleton. */
export function __resetTypographyAgentForTests(): void {
  sharedAgent = null;
}

export interface TypographyAgentContextValue {
  agent: TypographyAgentLoop;
  spec: TypographySpec;
  verification: VerificationResult | null;
  hudOpen: boolean;
  setHudOpen: (open: boolean) => void;
  dispatch: (patch: Partial<TypographySpec>) => Promise<VerificationResult>;
}

const TypographyAgentContext = createContext<TypographyAgentContextValue | null>(null);

export function useTypographyAgent(): TypographyAgentContextValue {
  const ctx = useContext(TypographyAgentContext);
  if (!ctx) throw new Error('useTypographyAgent must be used inside TypographyAgentProvider');
  return ctx;
}

/**
 * Null-safe variant for surfaces (e.g. isolated settings tests) that may
 * render outside the provider. Returns null instead of throwing.
 */
export function useTypographyAgentOptional(): TypographyAgentContextValue | null {
  return useContext(TypographyAgentContext);
}

export function TypographyAgentProvider({ children }: { children: ReactNode }) {
  const agent = useMemo(getSharedAgent, []);
  const [spec, setSpec] = useState<TypographySpec>(agent.currentSpec);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  // Deep-link affordance: ?typography-lab=1 opens the HUD on load so a
  // tuning session can be shared / smoke-tested without the hotkey.
  const [hudOpen, setHudOpen] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('typography-lab') === '1',
  );
  const seededDensity = useRef(false);
  const settings = useSettings();

  const dispatch = useCallback(
    async (patch: Partial<TypographySpec>): Promise<VerificationResult> => {
      const result = await agent.dispatch(patch);
      broadcast({ type: TOPICS.TYPOGRAPHY_SPEC_CHANGED });
      return result;
    },
    [agent],
  );

  // Mirror agent state into React + apply the persisted spec on mount.
  useEffect(() => agent.subscribe((next, result) => {
    setSpec({ ...next });
    setVerification(result);
  }), [agent]);

  useEffect(() => {
    void agent.refresh();
  }, [agent]);

  // Seed the agent density from workspace settings until the user picks
  // their own in the HUD or Settings (persisted spec always wins).
  useEffect(() => {
    if (seededDensity.current) return;
    if (TypographyAgentLoop.loadPersisted()) {
      seededDensity.current = true;
      return;
    }
    const density = (settings as { density?: string } | undefined)?.density;
    if (!density) return;
    seededDensity.current = true;
    void agent.dispatch({ density: mapWorkspaceDensity(density) });
  }, [agent, settings]);

  // Peer tabs: a hint means "reload + re-apply", never trust a payload.
  useBroadcast(
    useCallback(
      (msg) => {
        if (msg.type !== TOPICS.TYPOGRAPHY_SPEC_CHANGED) return;
        const persisted = TypographyAgentLoop.loadPersisted();
        if (persisted) void agent.dispatch(persisted);
      },
      [agent],
    ),
  );

  // Opener capture must happen in the toggle handler, not in an effect:
  // with a warm lazy chunk the HUD mounts in the same commit, and child
  // effects (the panel's autofocus) run before the parent's — an effect
  // would capture the panel itself instead of the opener.
  const lastFocused = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  // Global hotkey: Cmd/Ctrl+Shift+T toggles the ambient HUD.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        if (!hudOpen) {
          lastFocused.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          wasOpen.current = true;
        }
        setHudOpen(!hudOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hudOpen]);

  // Escape closes an open HUD (hotkey, X button, and Escape all funnel
  // through hudOpen, so focus restoration below covers every path).
  useEffect(() => {
    if (!hudOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setHudOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hudOpen]);

  // Return focus to the opener on close, however the HUD was dismissed.
  // (Deep-link opens never captured an opener, so there is nothing to restore.)
  useEffect(() => {
    if (!hudOpen && wasOpen.current) {
      wasOpen.current = false;
      lastFocused.current?.focus();
    }
  }, [hudOpen]);

  const value = useMemo<TypographyAgentContextValue>(
    () => ({ agent, spec, verification, hudOpen, setHudOpen, dispatch }),
    [agent, spec, verification, hudOpen, dispatch],
  );

  return (
    <TypographyAgentContext.Provider value={value}>
      {children}
      {hudOpen && typeof document !== 'undefined'
        ? createPortal(
            <Suspense fallback={null}>
              <AmbientTypographyHUD />
            </Suspense>,
            document.body,
          )
        : null}
    </TypographyAgentContext.Provider>
  );
}
