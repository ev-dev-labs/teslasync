//
//  ScrollRestoration.Projection.swift
//  TeslaSync — P4 shared surface · 0173 · ScrollRestoration (Apple)
//
//  The pure restore decision — the Foundation-only port of the web `useLayoutEffect` that runs on every
//  navigation (components/layout/ScrollRestoration.tsx, lines 113-124). Given the navigation action, the
//  saved offset for the destination key, and whether the session store is usable, it derives the target
//  scroll offset to apply AND the resolved ``ScrollRestorationPhase`` the status surface renders. The
//  model + the scroll modifier are pure functions of this decision; every branch is unit tested.
//
//  This is the surface's "cached → projection" adapter in the sense the acceptance criteria call for:
//  it takes the cached saved offset (the native peer of the value `readSaved` pulls from
//  `sessionStorage`) plus the navigation context and projects the view-ready restore decision —
//  collapsing the POP-restore / PUSH-or-REPLACE-top / nothing-saved / store-disabled branches exactly
//  as the web effect does.
//

import Foundation

// MARK: - ScrollRestorationPhase (the leaf states — mapped to the web branches)

/// The resolved restoration phase the status surface renders — every case maps to a REAL branch of the
/// web component (there are no fabricated fetch states; the source reads no remote data). The mapping to
/// the generic P4 leaf contract is documented per case so the surface honors "render every state"
/// without inventing chrome the web source does not have.
public enum ScrollRestorationPhase: String, Sendable, Equatable, CaseIterable {
    /// Before the first navigation resolves — the surface is mounted but has not yet acted (loading
    /// peer). The web component is likewise inert until its first `useLayoutEffect` runs.
    case preparing
    /// A POP (back / forward) with a finite saved offset → the view returns to it (data / loaded peer).
    /// The verbatim port of `setScrollTop(target, saved)` in the web `navType === 'POP'` branch.
    case restored
    /// A PUSH / REPLACE → a fresh navigation that starts at the top (empty peer). The port of the web
    /// `else { setScrollTop(target, 0) }` branch.
    case freshTop
    /// A POP with nothing saved yet (first visit to the entry) → starts at the top (empty peer). The
    /// port of the web `saved ?? 0` fallback when `readSaved` returns `null`.
    case noSavedTop
    /// The session store is unavailable (private mode / quota exceeded) → the surface still tops on a
    /// fresh navigation but cannot persist or restore (error / offline peer). The port of the web
    /// `try/catch` degrade where "the user just loses scroll restoration for that visit".
    case unavailable

    /// Whether this phase returned the view to a previously saved offset (only ``restored``).
    public var restoredSavedOffset: Bool {
        self == .restored
    }

    /// Whether this phase reflects the degraded, can't-persist store (only ``unavailable``).
    public var isDegraded: Bool {
        self == .unavailable
    }

    /// Whether this phase settles the scroll at the top (everything that is not a successful restore,
    /// once a navigation has resolved). ``preparing`` is pre-navigation and excluded.
    public var settlesAtTop: Bool {
        switch self {
        case .freshTop, .noSavedTop, .unavailable: true
        case .preparing, .restored: false
        }
    }
}

// MARK: - ScrollRestorationDecision (the web `useLayoutEffect` result)

/// The resolved outcome of a navigation — the target scroll offset to apply plus the phase it produced.
/// The native peer of what the web `useLayoutEffect` computes before it calls `setScrollTop`.
public struct ScrollRestorationDecision: Sendable, Equatable {
    /// The scroll offset to apply, in points (web `setScrollTop` argument). `0` is the top.
    public let targetOffset: Double
    /// The phase this navigation resolved to (drives the status surface).
    public let phase: ScrollRestorationPhase

    public init(targetOffset: Double, phase: ScrollRestorationPhase) {
        self.targetOffset = targetOffset
        self.phase = phase
    }
}

// MARK: - ScrollRestorationProjection (cached saved offset + nav context → decision)

/// The pure decision logic — the verbatim port of the web `useLayoutEffect` restore branch. It is a
/// total function over the navigation action, the saved offset for the destination key, and whether the
/// store is usable, so the model + the modifier stay pure functions of it and every branch is tested.
public enum ScrollRestorationProjection {
    /// Projects a navigation into its restore decision — the native peer of the web effect:
    ///
    /// ```text
    /// if (!storeAvailable)         → (0, .unavailable)   // web try/catch degrade
    /// if (navType === 'POP') {
    ///   const saved = readSaved(key)
    ///   setScrollTop(target, saved ?? 0)                 // (.restored when finite, else .noSavedTop)
    /// } else {
    ///   setScrollTop(target, 0)                          // (.freshTop) — PUSH / REPLACE
    /// }
    /// ```
    ///
    /// - Parameters:
    ///   - action: the navigation type (web `useNavigationType()`).
    ///   - savedOffset: the saved offset for the destination key (web `readSaved(key)`); `nil` (or a
    ///     non-finite value, defensively re-checked here) means nothing restorable is stored.
    ///   - isStoreAvailable: whether the session store can persist (web sessionStorage usable).
    public static func decide(
        action: ScrollNavigationAction,
        savedOffset: Double?,
        isStoreAvailable: Bool
    ) -> ScrollRestorationDecision {
        guard isStoreAvailable else {
            return ScrollRestorationDecision(targetOffset: 0, phase: .unavailable)
        }
        guard action.restoresSavedOffset else {
            return ScrollRestorationDecision(targetOffset: 0, phase: .freshTop)
        }
        guard let saved = savedOffset, saved.isFinite else {
            return ScrollRestorationDecision(targetOffset: 0, phase: .noSavedTop)
        }
        return ScrollRestorationDecision(targetOffset: saved, phase: .restored)
    }
}
