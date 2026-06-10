//
//  SessionExpiredModal.Adapter.swift
//  TeslaSync — P4 modal/dialog · 0008 · SessionExpiredModal (Apple)
//
//  The testable projection core for the session-expired hard block — the faithful port of
//  components/feedback/SessionExpiredModal.tsx. The web source reads `useSessionMonitor()` for
//  `{ mode, hasExpired }`, latches a `teslasync:session-expired` document event (the "a 401 fired
//  between polls" path), suppresses itself entirely in `mode === 'open'`, and otherwise opens a
//  non-dismissible Modal (`open = hasExpired || eventTriggered`) whose only action is "Sign in
//  again" (web `navigateToReauth`). Everything here is pure and dependency-free (Foundation only)
//  so the projection — the activation rule, the render-phase resolution, and the freshness model —
//  can be unit-tested without a store, a bundle, or a rendered view.
//
//  Web parity notes:
//    • `mode === 'open' → return null`            → `.empty` (no session to protect; event ignored).
//    • `open = hasExpired || eventTriggered`      → `SessionExpiredProjection.shouldBlock(_:)`.
//    • the always-mounted Modal (`open=false` hidden) widens into the prompt-required
//      loading / empty / error / dormant envelopes so no state is ever a blank panel.
//    • `navigateToReauth()`                       → `SessionReauthController.signIn()` (Seams).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core
/// so the projection's unit tests can reach it.
public enum SessionExpiredSurface {
    public static let slug = "SessionExpiredModal"
}

// MARK: - Deployment mode (web `useSessionMonitor().mode`)

/// The resolved ForwardAuth deployment mode. `open` means there is no auth provider — the surface
/// must treat "session timeout doesn't apply" and render nothing blocking (web `mode === 'open'`).
/// `unknown` is the not-yet-resolved branch (web `deriveSessionState(null)`); `session` is a live
/// auth provider whose cookie can expire.
public enum SessionMode: String, Sendable, Equatable {
    case open
    case session
    case unknown
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the `/auth/session` poll. The web reads the monitor
/// synchronously; the native surface models the poll lifecycle here so every state renders.
public enum SessionLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the connectivity banner so the
/// surface clearly labels when the session verdict came from a cached read rather than a live poll.
public enum SessionConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface renders at the top level. The web only ever shows the (non-dismissible) block
/// when expired and otherwise nothing; the loading / empty / error / dormant envelopes are added so
/// the first-poll, open-mode, poll-failure, and healthy-session cases never render a blank panel.
public enum SessionExpiredPhase: Sendable, Equatable {
    /// The initial `/auth/session` poll is in flight and no cached verdict exists yet.
    case loading
    /// Open mode — no auth provider, so there is no session to protect (web `return null`).
    case empty
    /// Session mode and not expired — the block is not engaged (web Modal `open=false`).
    case dormant
    /// Expired (or the 401 event latched) — THE hard block (web Modal `open=true`).
    case expired
    /// The `/auth/session` poll failed with no cached verdict to fall back on.
    case error(String)
}

// MARK: - Session context (web `useSessionMonitor` slice the surface consumes)

/// The resolved session slice a source pushes. The web `SessionExpiredModal` only consumes `mode`
/// and `hasExpired`, plus the latched `teslasync:session-expired` event; this models exactly that
/// triplet so the projection stays a pure value type.
public struct SessionContext: Sendable, Equatable {
    public let mode: SessionMode
    public let hasExpired: Bool
    /// Whether the `teslasync:session-expired` event has fired (web `eventTriggered`). The model
    /// latches this; carried here so an in-memory source can simulate the 401 path.
    public let eventTriggered: Bool

    public init(mode: SessionMode, hasExpired: Bool, eventTriggered: Bool = false) {
        self.mode = mode
        self.hasExpired = hasExpired
        self.eventTriggered = eventTriggered
    }

    /// A copy with the latched event flag folded in (web `open = hasExpired || eventTriggered`,
    /// where `eventTriggered` is sticky once the document event fired).
    public func latchingEvent(_ latched: Bool) -> SessionContext {
        SessionContext(mode: mode, hasExpired: hasExpired, eventTriggered: eventTriggered || latched)
    }
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model and the views: the activation predicate (web
/// `open`), the render-phase resolution, and the freshness mapping.
public enum SessionExpiredProjection {
    /// The web block predicate: a live auth session that has expired OR the latched 401 event.
    /// Open mode never blocks (web suppresses + ignores the event there); unknown mode has no
    /// verdict yet so it cannot block.
    public static func shouldBlock(_ context: SessionContext) -> Bool {
        guard context.mode == .session else { return false }
        return context.hasExpired || context.eventTriggered
    }

    /// Resolves the render phase. Loading shows only before any verdict resolves; once a cached
    /// context is on hand the resolved phase stays (a failed reload keeps the last verdict rather
    /// than flashing the error envelope), and a first-poll failure with no cached verdict shows the
    /// error state.
    public static func resolvePhase(
        status: SessionLoadStatus,
        context: SessionContext?
    ) -> SessionExpiredPhase {
        switch status {
        case .loading:
            guard let context else { return .loading }
            return resolved(context)
        case .loaded:
            guard let context else { return .dormant }
            return resolved(context)
        case let .failed(message):
            guard let context else { return .error(message) }
            return resolved(context)
        }
    }

    /// Maps a resolved context to its phase: open mode → empty (nothing to protect), unknown → the
    /// dormant "no verdict" surface, session → the block when expired/latched else dormant.
    public static func resolved(_ context: SessionContext) -> SessionExpiredPhase {
        switch context.mode {
        case .open:
            .empty
        case .unknown:
            .dormant
        case .session:
            shouldBlock(context) ? .expired : .dormant
        }
    }
}
