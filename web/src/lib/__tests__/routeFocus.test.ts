/**
 * Route-focus policy contract (A11Y-03).
 *
 * The decision function is pure, so every suppression rule is asserted
 * here without a router, a layout, or a real navigation. The component
 * integration (does focus actually land on the `<h1>`?) is covered by
 * `RouteFocusManager.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import {
  decideRouteFocus,
  isInsideModalSurface,
  isTextEntryElement,
  ROUTE_FOCUS_FALLBACK_SELECTOR,
  ROUTE_FOCUS_TARGET_ATTR,
  ROUTE_FOCUS_TARGET_SELECTOR,
  type RouteFocusContext,
} from '../routeFocus';

/** A context that would be ALLOWED, so each test can vary one field. */
function allowedContext(over: Partial<RouteFocusContext> = {}): RouteFocusContext {
  return {
    navigationKind: 'PUSH',
    isFirstRender: false,
    isSamePath: false,
    documentHasFocus: true,
    activeElement: null,
    scheduledFromElement: null,
    ...over,
  };
}

describe('routeFocus selectors', () => {
  it('derives the target selector from the attribute name', () => {
    expect(ROUTE_FOCUS_TARGET_SELECTOR).toBe(`[${ROUTE_FOCUS_TARGET_ATTR}]`);
  });

  it('falls back to the main landmark id used by Layout', () => {
    expect(ROUTE_FOCUS_FALLBACK_SELECTOR).toBe('#main-content');
  });
});

describe('decideRouteFocus', () => {
  it('allows a plain forward navigation to a new path', () => {
    expect(decideRouteFocus(allowedContext())).toEqual({
      shouldFocus: true,
      reason: 'allowed',
    });
  });

  it('never focuses on first render (the browser already did)', () => {
    expect(decideRouteFocus(allowedContext({ isFirstRender: true }))).toEqual({
      shouldFocus: false,
      reason: 'first-render',
    });
  });

  it('never focuses on history navigation so ScrollRestoration wins', () => {
    expect(decideRouteFocus(allowedContext({ navigationKind: 'POP' }))).toEqual({
      shouldFocus: false,
      reason: 'history-navigation',
    });
  });

  it('focuses on REPLACE when the path genuinely changed', () => {
    expect(
      decideRouteFocus(allowedContext({ navigationKind: 'REPLACE' })).shouldFocus,
    ).toBe(true);
  });

  it('ignores query-only navigations on the same path', () => {
    expect(decideRouteFocus(allowedContext({ isSamePath: true }))).toEqual({
      shouldFocus: false,
      reason: 'same-path',
    });
  });

  it('stays silent when the document is not focused', () => {
    expect(
      decideRouteFocus(allowedContext({ documentHasFocus: false })),
    ).toEqual({ shouldFocus: false, reason: 'document-not-focused' });
  });

  it('does not steal focus from an open dialog', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.appendChild(button);
    document.body.appendChild(dialog);

    expect(
      decideRouteFocus(
        allowedContext({ activeElement: button, scheduledFromElement: button }),
      ),
    ).toEqual({ shouldFocus: false, reason: 'dialog-open' });

    document.body.removeChild(dialog);
  });

  it('does not steal focus while the user is typing', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    expect(
      decideRouteFocus(
        allowedContext({ activeElement: input, scheduledFromElement: input }),
      ),
    ).toEqual({ shouldFocus: false, reason: 'text-entry-in-progress' });

    document.body.removeChild(input);
  });

  it('still focuses when the navigation was triggered from a button', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);

    expect(
      decideRouteFocus(
        allowedContext({ activeElement: button, scheduledFromElement: button }),
      ).shouldFocus,
    ).toBe(true);

    document.body.removeChild(button);
  });

  it('yields when something else claimed focus during the delay', () => {
    const link = document.createElement('a');
    const claimed = document.createElement('button');
    document.body.append(link, claimed);

    expect(
      decideRouteFocus(
        allowedContext({ activeElement: claimed, scheduledFromElement: link }),
      ),
    ).toEqual({ shouldFocus: false, reason: 'focus-moved-since-scheduled' });

    link.remove();
    claimed.remove();
  });

  it('treats a drop to <body> as "nobody owns focus", not a claim', () => {
    const link = document.createElement('a');
    document.body.appendChild(link);

    expect(
      decideRouteFocus(
        allowedContext({
          activeElement: document.body,
          scheduledFromElement: link,
        }),
      ).shouldFocus,
    ).toBe(true);

    link.remove();
  });
});

describe('isTextEntryElement', () => {
  it.each([
    ['input', undefined],
    ['textarea', undefined],
    ['select', undefined],
  ])('treats <%s> as text entry', (tag) => {
    const el = document.createElement(tag);
    expect(isTextEntryElement(el)).toBe(true);
  });

  it.each(['checkbox', 'radio', 'button', 'submit', 'range'])(
    'treats input[type=%s] as a discrete control, not text entry',
    (type) => {
      const el = document.createElement('input');
      el.type = type;
      expect(isTextEntryElement(el)).toBe(false);
    },
  );

  it.each(['combobox', 'searchbox', 'spinbutton'])(
    'treats role=%s as text entry',
    (role) => {
      const el = document.createElement('div');
      el.setAttribute('role', role);
      expect(isTextEntryElement(el)).toBe(true);
    },
  );

  it('returns false for null', () => {
    expect(isTextEntryElement(null)).toBe(false);
  });
});

describe('isInsideModalSurface', () => {
  it.each(['dialog', 'alertdialog'])('detects role=%s ancestors', (role) => {
    const host = document.createElement('div');
    host.setAttribute('role', role);
    const child = document.createElement('button');
    host.appendChild(child);
    expect(isInsideModalSurface(child)).toBe(true);
  });

  it('detects aria-modal ancestors', () => {
    const host = document.createElement('div');
    host.setAttribute('aria-modal', 'true');
    const child = document.createElement('button');
    host.appendChild(child);
    expect(isInsideModalSurface(child)).toBe(true);
  });

  it('returns false outside any modal surface', () => {
    const child = document.createElement('button');
    document.body.appendChild(child);
    expect(isInsideModalSurface(child)).toBe(false);
    child.remove();
  });
});
