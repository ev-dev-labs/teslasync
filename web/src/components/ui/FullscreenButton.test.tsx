/**
 * Phase-46 / Prompt 56 — `<FullscreenButton>` contract tests.
 *
 * Stubs the browser Fullscreen API on the JSDOM `document` /
 * `Element.prototype` so we can verify:
 *
 *   - The button is hidden when `document.fullscreenEnabled` is
 *     false (Safari iOS / sandboxed iframe parity).
 *   - Clicking the button calls `requestFullscreen()` on the
 *     `targetRef.current` element.
 *   - Clicking again while in fullscreen calls `exitFullscreen()`.
 *   - State syncs from the `fullscreenchange` event (Esc-out
 *     pathway), not the click handler — so the icon / aria-label /
 *     aria-pressed all flip even when the user uses Esc, the Mac
 *     menu bar exit button, or a sibling component.
 *   - When some other element is already fullscreen the button
 *     exits it first then enters its own target (avoids the
 *     "already fullscreen elsewhere" silent rejection).
 *
 * `@testing-library/user-event` is not installed in this repo, so
 * we drive interactions via `fireEvent` from
 * `@testing-library/react` — matches every other component test
 * here (Lightbox, EditableText, TagInput, ContextMenu, focusTrap).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      let template: string;
      let interpolations: Record<string, unknown> | undefined;
      if (typeof defaultOrOpts === 'string') {
        template = defaultOrOpts || key;
        interpolations = opts;
      } else {
        template = key;
        interpolations = defaultOrOpts;
      }
      if (!interpolations) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String(interpolations?.[name] ?? `{{${name}}}`),
      );
    },
  }),
}));

import { FullscreenButton } from './FullscreenButton';

// ─────────────────────────────────────────────────────────────────
// Fullscreen API stubs.
//
// JSDOM ships none of the Fullscreen API. We install a deliberately
// minimal-but-faithful mock here: a single mutable "current
// fullscreen element" variable that `requestFullscreen` / `exitFullscreen`
// update, plus a real `fullscreenchange` event dispatched on every
// transition so the component's listener fires exactly the way it
// would in a real browser.
// ─────────────────────────────────────────────────────────────────

interface FullscreenStub {
  enabled: boolean;
  current: Element | null;
  request: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
}

let stub: FullscreenStub;

function installFullscreenStub(enabled: boolean): FullscreenStub {
  const local: FullscreenStub = {
    enabled,
    current: null,
    request: vi.fn(),
    exit: vi.fn(),
  };

  Object.defineProperty(document, 'fullscreenEnabled', {
    configurable: true,
    get: () => local.enabled,
  });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => local.current,
  });

  local.request.mockImplementation(function (this: Element) {
    local.current = this;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  local.exit.mockImplementation(() => {
    local.current = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });

  Element.prototype.requestFullscreen = function (this: Element) {
    return local.request.call(this);
  } as Element['requestFullscreen'];
  document.exitFullscreen = local.exit as Document['exitFullscreen'];

  return local;
}

function uninstallFullscreenStub() {
  // Use `delete` via cast — `configurable: true` above lets us
  // remove the descriptors without leaving stale state on the
  // shared JSDOM document between tests.
  delete (document as unknown as { fullscreenEnabled?: boolean }).fullscreenEnabled;
  delete (document as unknown as { fullscreenElement?: Element | null }).fullscreenElement;
  delete (Element.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen;
  delete (document as unknown as { exitFullscreen?: unknown }).exitFullscreen;
}

beforeEach(() => {
  stub = installFullscreenStub(true);
});

afterEach(() => {
  cleanup();
  uninstallFullscreenStub();
});

// ─────────────────────────────────────────────────────────────────
// Test harness — wires a real DOM `<div>` to a `useRef` and renders
// the button against it. Mirrors the production usage from
// ChartContainer (figure ref) and MapTileLayer (leaflet container).
// ─────────────────────────────────────────────────────────────────

function Harness({
  testHookSupported,
  ariaLabelEnter,
  ariaLabelExit,
  detached,
}: {
  testHookSupported?: boolean;
  ariaLabelEnter?: string;
  ariaLabelExit?: string;
  detached?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div>
      {!detached && <div ref={ref} data-testid="target" style={{ width: 100, height: 100 }} />}
      <FullscreenButton
        targetRef={ref}
        testHookSupported={testHookSupported}
        ariaLabelEnter={ariaLabelEnter}
        ariaLabelExit={ariaLabelExit}
      />
    </div>
  );
}

function getButton(): HTMLButtonElement {
  return screen.getByTestId('fullscreen-button') as HTMLButtonElement;
}

function dispatchFullscreenChange() {
  act(() => {
    document.dispatchEvent(new Event('fullscreenchange'));
  });
}

describe('FullscreenButton — support detection', () => {
  it('renders the button when document.fullscreenEnabled is true', () => {
    render(<Harness />);
    expect(screen.getByTestId('fullscreen-button')).toBeInTheDocument();
  });

  it('renders nothing when document.fullscreenEnabled is false', () => {
    uninstallFullscreenStub();
    stub = installFullscreenStub(false);
    render(<Harness />);
    expect(screen.queryByTestId('fullscreen-button')).toBeNull();
  });

  it('honours testHookSupported=false even when the browser supports fullscreen', () => {
    render(<Harness testHookSupported={false} />);
    expect(screen.queryByTestId('fullscreen-button')).toBeNull();
  });

  it('honours testHookSupported=true even when the browser disables fullscreen', () => {
    uninstallFullscreenStub();
    stub = installFullscreenStub(false);
    render(<Harness testHookSupported />);
    expect(screen.getByTestId('fullscreen-button')).toBeInTheDocument();
  });
});

describe('FullscreenButton — initial state', () => {
  it('starts in the "Enter fullscreen" state with aria-pressed=false', () => {
    render(<Harness />);
    const btn = getButton();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Enter fullscreen');
    expect(btn.getAttribute('title')).toBe('Enter fullscreen');
    expect(btn.getAttribute('data-fullscreen-state')).toBe('off');
  });

  it('uses the custom ariaLabelEnter override when provided', () => {
    render(<Harness ariaLabelEnter="Expand chart" />);
    const btn = getButton();
    expect(btn.getAttribute('aria-label')).toBe('Expand chart');
    expect(btn.getAttribute('title')).toBe('Expand chart');
  });
});

describe('FullscreenButton — click → enter', () => {
  it('calls Element.requestFullscreen on the targetRef.current and flips state', async () => {
    render(<Harness />);
    const target = screen.getByTestId('target');
    const btn = getButton();

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(stub.request).toHaveBeenCalledTimes(1);
    expect(stub.request.mock.instances[0]).toBe(target);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('Exit fullscreen');
    expect(btn.getAttribute('title')).toBe('Exit fullscreen');
    expect(btn.getAttribute('data-fullscreen-state')).toBe('on');
  });

  it('does nothing when targetRef.current is null', async () => {
    render(<Harness detached />);
    const btn = getButton();
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(stub.request).not.toHaveBeenCalled();
  });
});

describe('FullscreenButton — click → exit', () => {
  it('calls document.exitFullscreen when already in fullscreen on the same target', async () => {
    render(<Harness />);
    const btn = getButton();

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(stub.exit).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Enter fullscreen');
    expect(btn.getAttribute('data-fullscreen-state')).toBe('off');
  });
});

describe('FullscreenButton — fullscreenchange sync', () => {
  it('flips back to "Enter fullscreen" when the user presses Esc (synthetic fullscreenchange to no-element)', async () => {
    render(<Harness />);
    const btn = getButton();

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    // Simulate the browser exiting fullscreen via Esc — the live
    // current-element flips to null and a fullscreenchange event
    // fires. The component listener must pick this up.
    stub.current = null;
    dispatchFullscreenChange();

    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Enter fullscreen');
  });

  it('reflects fullscreen entered by an external trigger (no click required)', async () => {
    render(<Harness />);
    const target = screen.getByTestId('target');
    const btn = getButton();
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    // External code (e.g. a sibling button in the same toolbar)
    // requested fullscreen on the same target. We surface that
    // by flipping the icon, label, and aria-pressed.
    stub.current = target;
    dispatchFullscreenChange();

    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('Exit fullscreen');
  });

  it('reports fullscreen when a descendant of the target is the fullscreen element', async () => {
    render(<Harness />);
    const target = screen.getByTestId('target');
    const child = document.createElement('span');
    target.appendChild(child);
    const btn = getButton();

    stub.current = child;
    dispatchFullscreenChange();

    // The card-as-a-whole is not the live element but visually it
    // contains it — we still report fullscreen so the icon stays
    // honest.
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('FullscreenButton — cross-target arbitration', () => {
  it('exits an unrelated fullscreen element first, then requests on its own target', async () => {
    render(<Harness />);
    const target = screen.getByTestId('target');
    const btn = getButton();

    // A sibling component is currently fullscreen on a different
    // element. The button must release that first then request
    // its own target — otherwise the browser silently rejects.
    const someoneElse = document.createElement('div');
    document.body.appendChild(someoneElse);
    stub.current = someoneElse;

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(stub.exit).toHaveBeenCalledTimes(1);
    expect(stub.request).toHaveBeenCalledTimes(1);
    expect(stub.request.mock.instances[0]).toBe(target);
  });
});

describe('FullscreenButton — error handling', () => {
  it('swallows requestFullscreen rejections and leaves the UI un-flipped', async () => {
    render(<Harness />);
    const btn = getButton();

    stub.request.mockImplementation(() => Promise.reject(new Error('user gesture required')));
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Enter fullscreen');

    consoleWarnSpy.mockRestore();
  });
});
