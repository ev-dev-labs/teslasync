//
//  SessionExpiringModal.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0009 · SessionExpiringModal (Apple)
//
//  The testable, dependency-free projection core for the session-expiring warning dialog — the
//  faithful port of components/feedback/SessionExpiringModal.tsx and the `useSessionMonitor`
//  state it binds to. Everything here is pure Foundation so the derived session state (the
//  verbatim port of the web `deriveSessionState`), the countdown formatter (`formatCountdown`),
//  the open/visibility predicate, the body phase, and the unsaved-draft projection are all
//  unit-tested without a bundle, a clock, or a rendered view.
//
//  Web parity notes:
//    • The web modal opens only while `mode === 'session' && isExpiringSoon && !hasExpired`; it
//      renders nothing otherwise (open mode, not-near-expiry, already-expired, first load). The
//      `resolveVisibility` machine reproduces that, and a `pinned` flag suppresses the ambient
//      hide so an intentionally-presented dialog still renders loading / empty / error chrome
//      (engineering guideline #6 — never a blank surface).
//    • `deriveSessionState(data, nowMs)` → `SessionExpiringProjection.derive(_:now:)`, against an
//      injected clock so the countdown + expiry thresholds are deterministic in tests.
//    • `formatCountdown(seconds)` → `SessionCountdownFormatter.string(seconds:)`.
//    • The localStorage `teslasync:draft:v*` registry → `[SessionDraft]`, sorted most-recent-first
//      and capped to five rows with a "+N more" overflow (web `drafts.slice(0, 5)` + remainder).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core
/// so the projection's unit tests can reach it.
public enum SessionExpiringSurface {
    public static let slug = "SessionExpiringModal"
}

// MARK: - Auth mode (web `SessionInfo['mode']` + the derived mode)

/// The resolved deployment auth mode (web `mode`). `open` means there is no auth provider, so the
/// session-timeout warning never applies; `session` is the ForwardAuth case the modal serves;
/// `unknown` is the pre-first-response state.
public enum SessionAuthMode: String, Sendable, Equatable, CaseIterable {
    case open
    case session
    case unknown
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the `/auth/session` poll (web `isLoading` / resolved /
/// failure). The endpoint never 401s, so a failure means a deeper network problem (web note).
public enum SessionExpiringLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so a
/// countdown driven by a cached poll is clearly labeled while reconnecting / offline.
public enum SessionExpiringConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface renders at the top level. The web early-returns `null` when the modal is not
/// open; `hidden` models that, and `presented` shows the panel (whose body switches over `phase`).
public enum SessionExpiringVisibility: Sendable, Equatable {
    case hidden
    case presented
}

/// What the presented panel body renders. The web only ever shows the countdown form; the
/// loading + empty + error envelopes are added so an intentionally-presented dialog is never a
/// blank box.
public enum SessionExpiringPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Session snapshot (web `SessionInfo`)

/// The `/auth/session` response projection the source resolves (web `SessionInfo`). Times are
/// parsed `Date`s (the web carries the RFC3339 `expires_at` string); `expiresIn` is the
/// server-computed snapshot fallback. The native surface models the load lifecycle around this so
/// every state renders.
public struct SessionSnapshot: Sendable, Equatable {
    public let mode: SessionAuthMode
    public let authenticated: Bool
    public let expiresAt: Date?
    public let expiresIn: Int?
    public let renewable: Bool

    public init(
        mode: SessionAuthMode,
        authenticated: Bool,
        expiresAt: Date? = nil,
        expiresIn: Int? = nil,
        renewable: Bool = false
    ) {
        self.mode = mode
        self.authenticated = authenticated
        self.expiresAt = expiresAt
        self.expiresIn = expiresIn
        self.renewable = renewable
    }
}

/// The derived session state computed against the live clock — the native parity of the web
/// `deriveSessionState` return (the subset the modal consumes).
public struct SessionDerivedState: Sendable, Equatable {
    public let mode: SessionAuthMode
    public let expiresInSeconds: Int?
    public let isExpiringSoon: Bool
    public let hasExpired: Bool
    public let renewable: Bool

    public init(
        mode: SessionAuthMode,
        expiresInSeconds: Int?,
        isExpiringSoon: Bool,
        hasExpired: Bool,
        renewable: Bool
    ) {
        self.mode = mode
        self.expiresInSeconds = expiresInSeconds
        self.isExpiringSoon = isExpiringSoon
        self.hasExpired = hasExpired
        self.renewable = renewable
    }

    /// The pre-first-response state (web "no data" branch).
    public static let unknown = SessionDerivedState(
        mode: .unknown,
        expiresInSeconds: nil,
        isExpiringSoon: false,
        hasExpired: false,
        renewable: false
    )
}

// MARK: - Unsaved draft (web `DraftSummary`)

/// One unsaved form draft surfaced so the user knows what a forced sign-out would strand (web
/// `DraftSummary` read from the `teslasync:draft:v*` localStorage registry). `savedAt` is `nil`
/// when the stored envelope is unparseable (web "corrupt envelope — still surface the key").
public struct SessionDraft: Sendable, Equatable, Identifiable {
    public let label: String
    public let savedAt: Date?

    public init(label: String, savedAt: Date? = nil) {
        self.label = label
        self.savedAt = savedAt
    }

    /// The web list key (`key={d.label}`).
    public var id: String {
        label
    }
}

// MARK: - Countdown formatter (port of web `formatCountdown`)

/// The faithful port of the web `formatCountdown(seconds)` used by the body line: `m:ss`, clamped
/// to `0:00` at or below zero. The `m:ss` shape is locale-neutral, exactly as the web util emits.
public enum SessionCountdownFormatter {
    public static func string(seconds: Int) -> String {
        guard seconds > 0 else { return "0:00" }
        let minutes = seconds / 60
        let remainder = seconds % 60
        return "\(minutes):\(twoDigits(remainder))"
    }

    /// Zero-padded two-digit seconds, matching JS `String(secs).padStart(2, '0')`.
    private static func twoDigits(_ value: Int) -> String {
        String(format: "%02d", value)
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution shared by the model and tests: the derived session state, the
/// open/visibility predicate, the body phase, the inline-failure envelope, and the draft list.
public enum SessionExpiringProjection {
    /// The window (seconds) before expiry that the modal opens (web `SESSION_EXPIRING_THRESHOLD_S`).
    public static let expiringThresholdSeconds = 60

    /// The default cap on listed drafts before the "+N more" overflow (web `drafts.slice(0, 5)`).
    public static let defaultDraftCap = 5

    /// Verbatim port of the web `deriveSessionState(data, nowMs)` for the fields the modal reads.
    /// Computes the remaining seconds against the live clock from `expiresAt` (clock-skew-safe),
    /// falling back to the server `expiresIn` snapshot, exactly as the web hook does.
    public static func derive(_ snapshot: SessionSnapshot?, now: Date) -> SessionDerivedState {
        guard let snapshot else { return .unknown }

        if snapshot.mode == .open {
            return SessionDerivedState(
                mode: .open,
                expiresInSeconds: nil,
                isExpiringSoon: false,
                hasExpired: false,
                renewable: false
            )
        }

        if !snapshot.authenticated {
            return SessionDerivedState(
                mode: .session,
                expiresInSeconds: nil,
                isExpiringSoon: false,
                hasExpired: true,
                renewable: false
            )
        }

        var expiresInSeconds: Int?
        if let expiresAt = snapshot.expiresAt {
            expiresInSeconds = Int(floor(expiresAt.timeIntervalSince(now)))
        }
        if expiresInSeconds == nil, let snapshotSeconds = snapshot.expiresIn {
            expiresInSeconds = snapshotSeconds
        }

        guard let seconds = expiresInSeconds else {
            return SessionDerivedState(
                mode: .session,
                expiresInSeconds: nil,
                isExpiringSoon: false,
                hasExpired: false,
                renewable: snapshot.renewable
            )
        }

        return SessionDerivedState(
            mode: .session,
            expiresInSeconds: seconds,
            isExpiringSoon: seconds > 0 && seconds < expiringThresholdSeconds,
            hasExpired: seconds <= 0,
            renewable: snapshot.renewable
        )
    }

    /// The web `open` predicate: a session-mode deployment that is near expiry but not yet expired
    /// (the hard-expired branch is owned by the companion `SessionExpiredModal`).
    public static func isOpen(_ derived: SessionDerivedState) -> Bool {
        derived.mode == .session && derived.isExpiringSoon && !derived.hasExpired
    }

    /// The web early-return resolved to a rendered surface. `pinned` models an intentionally-
    /// presented dialog: it suppresses the ambient hide so loading / empty / error chrome still
    /// renders rather than vanishing (engineering guideline #6).
    public static func resolveVisibility(
        derived: SessionDerivedState,
        pinned: Bool
    ) -> SessionExpiringVisibility {
        (pinned || isOpen(derived)) ? .presented : .hidden
    }

    /// The presented panel's body phase. A usable countdown shows the content; otherwise the
    /// loading / empty / error envelope renders so the dialog is never blank.
    public static func resolvePhase(
        status: SessionExpiringLoadStatus,
        hasCountdown: Bool
    ) -> SessionExpiringPhase {
        switch status {
        case .loading:
            hasCountdown ? .content : .loading
        case .loaded:
            hasCountdown ? .content : .empty
        case let .failed(message):
            hasCountdown ? .content : .error(message)
        }
    }

    /// The failure message kept on screen while a cached countdown survives a failed reload (the
    /// inline error shown above the content), else `nil`.
    public static func inlineFailure(
        status: SessionExpiringLoadStatus,
        hasCountdown: Bool
    ) -> String? {
        guard hasCountdown, case let .failed(message) = status else { return nil }
        return message
    }

    /// The drafts sorted most-recent-first (web `out.sort((a,b) => bMs - aMs)`, an absent
    /// `savedAt` treated as the oldest).
    public static func sortedDrafts(_ drafts: [SessionDraft]) -> [SessionDraft] {
        drafts.sorted { lhs, rhs in
            lhs.savedAt?.timeIntervalSince1970 ?? 0 > rhs.savedAt?.timeIntervalSince1970 ?? 0
        }
    }

    /// The first `cap` drafts shown as list rows (web `drafts.slice(0, 5)`).
    public static func visibleDrafts(_ drafts: [SessionDraft], cap: Int) -> [SessionDraft] {
        Array(drafts.prefix(max(0, cap)))
    }

    /// The "+N more" overflow count (web `drafts.length - 5`), zero when within the cap.
    public static func overflowCount(_ drafts: [SessionDraft], cap: Int) -> Int {
        max(0, drafts.count - max(0, cap))
    }
}
