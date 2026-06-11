//
//  AchievementUnlockListener.Projection.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state — the native port of the
//  web listener's render branches (`AchievementUnlockListener` + the `AchievementUnlockedToastStack`
//  it returns) wrapped in the P4 leaf contract (loading / unavailable chrome + the two friendly empty
//  states + the offline decoration around the toast stack). The view is a pure function of this value;
//  every branch is unit tested.
//

import Foundation

// MARK: - Source input (P1/S8 — the unlock feed + prefs + its fetch lifecycle)

/// One coalesced snapshot of the surface's inputs — the SSE fetch lifecycle (web
/// `useAchievementUnlocks` subscription state), the de-duped newest-first unlock queue (web `recent`),
/// the celebration prefs (web `useAchievementCelebrationPrefs`), and the P4 connectivity bit. The view
/// binds the model over this; the resolved render is a pure function of it plus the static config.
public struct AchievementUnlockListenerInput: Sendable, Equatable {
    public var status: AchievementUnlockListenerStatus
    public var events: [AchievementUnlockListenerEvent]
    public var prefs: AchievementUnlockListenerPrefs
    public var connection: AchievementUnlockListenerConnection

    public init(
        status: AchievementUnlockListenerStatus = .loading,
        events: [AchievementUnlockListenerEvent] = [],
        prefs: AchievementUnlockListenerPrefs = .default,
        connection: AchievementUnlockListenerConnection = .live
    ) {
        self.status = status
        self.events = events
        self.prefs = prefs
        self.connection = connection
    }
}

// MARK: - Static configuration (web non-data props)

/// The static presentation config — the web props that are not data. `autoDismissSeconds` is the
/// per-toast lifetime (web `AchievementUnlockedToast` `durationMs` default of 6000 ms); it defaults to
/// the web default of 6 seconds.
public struct AchievementUnlockListenerConfig: Sendable, Equatable {
    public var autoDismissSeconds: Int

    public init(autoDismissSeconds: Int = AchievementUnlockListenerLimits.autoDismissSeconds) {
        self.autoDismissSeconds = autoDismissSeconds
    }

    public static let `default` = AchievementUnlockListenerConfig()
}

// MARK: - Resolved per-toast view-state (web `AchievementUnlockedToast`)

/// One resolved celebration toast — the achievement glyph plus the localized eyebrow, name,
/// description, View affordance label + its deep link, the dismiss label, and the composed VoiceOver
/// label. Everything one toast row needs to render with no further string work.
public struct AchievementUnlockListenerToast: Sendable, Equatable, Identifiable {
    public let id: String
    public let icon: String
    public let eyebrow: String
    public let name: String
    public let detail: String
    public let viewLabel: String
    public let dismissLabel: String
    public let route: String
    public let accessibilityLabel: String

    public init(
        id: String,
        icon: String,
        eyebrow: String,
        name: String,
        detail: String,
        viewLabel: String,
        dismissLabel: String,
        route: String,
        accessibilityLabel: String
    ) {
        self.id = id
        self.icon = icon
        self.eyebrow = eyebrow
        self.name = name
        self.detail = detail
        self.viewLabel = viewLabel
        self.dismissLabel = dismissLabel
        self.route = route
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// Why the surface is showing an empty state — the two web "no visible toast" branches: the queue is
/// empty (`recent.length === 0`, the steady state) or the user has switched celebrations off
/// (`!prefs.showToasts`). Both render a friendly empty state natively rather than the web's collapsed
/// `null`, per the P4 leaf "never a blank box" contract.
public enum AchievementUnlockListenerEmptyReason: String, Sendable, Equatable, CaseIterable {
    case noUnlocks
    case celebrationsOff
}

/// The resolved, view-ready state — `phase` selects the rendered body while `offline` decorates the
/// toast stack with the connectivity marker and `connection` drives the freshness chip. A pure value
/// so the view is a function of it and snapshot tests assert it directly.
public struct AchievementUnlockListenerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// SSE feed still resolving → skeleton toast chrome.
        case loading
        /// Feed failed → a retry tile (the `QueryError` peer).
        case unavailable
        /// Resolved, nothing to celebrate → a friendly empty state (never a blank box).
        case empty(AchievementUnlockListenerEmptyReason)
        /// Resolved with queued unlocks (and toasts enabled) → the celebration toast stack.
        case ready([AchievementUnlockListenerToast])
    }

    public let phase: Phase
    public let offline: Bool
    public let connection: AchievementUnlockListenerConnection

    public init(phase: Phase, offline: Bool, connection: AchievementUnlockListenerConnection) {
        self.phase = phase
        self.offline = offline
        self.connection = connection
    }

    /// The resolved toasts when presenting the stack, else `[]` — a convenience for the view + the
    /// model's auto-dismiss arming (timers run only while toasts are actually visible).
    public var toasts: [AchievementUnlockListenerToast] {
        if case let .ready(toasts) = phase { return toasts }
        return []
    }

    /// Whether the surface is presenting the visible toast stack (used to gate the auto-dismiss clock,
    /// matching the web per-toast timer that only mounts when the stack renders).
    public var isPresentingToasts: Bool {
        if case .ready = phase { return true }
        return false
    }
}

// MARK: - Projection (input + config + strings → resolved)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// listener's render logic in order: a feed failure surfaces as `unavailable`; an in-flight fetch as
/// `loading`; `!prefs.showToasts` as the `celebrationsOff` empty state (the web early `return null`,
/// which precedes — and so takes priority over — any queued unlocks); an empty queue as the
/// `noUnlocks` empty state; otherwise the celebration stack (web `AchievementUnlockedToastStack`). The
/// connectivity bit rides through unchanged for the freshness chip + offline decoration.
public enum AchievementUnlockListenerProjection {
    public static func resolve(
        _ input: AchievementUnlockListenerInput,
        config _: AchievementUnlockListenerConfig = .default,
        strings: AchievementUnlockListenerResolve
    ) -> AchievementUnlockListenerResolved {
        let phase = phase(for: input, strings: strings)
        return AchievementUnlockListenerResolved(
            phase: phase,
            offline: input.connection == .offline,
            connection: input.connection
        )
    }

    private static func phase(
        for input: AchievementUnlockListenerInput,
        strings: AchievementUnlockListenerResolve
    ) -> AchievementUnlockListenerResolved.Phase {
        switch input.status {
        case .failed:
            return .unavailable
        case .loading:
            return .loading
        case .resolved:
            break
        }
        // Web `if (!prefs.showToasts) return null` — the opt-out precedes the queue, so it wins even
        // when unlocks are queued (they keep draining in the background; we just show no celebration).
        guard input.prefs.showToasts else { return .empty(.celebrationsOff) }
        guard !input.events.isEmpty else { return .empty(.noUnlocks) }
        return .ready(input.events.map { toast(for: $0, strings: strings) })
    }

    private static func toast(
        for event: AchievementUnlockListenerEvent,
        strings: AchievementUnlockListenerResolve
    ) -> AchievementUnlockListenerToast {
        let eyebrow = strings("achievements.toastEyebrow", "Achievement Unlocked")
        let name = event.achievement.name
        let detail = event.achievement.detail
        return AchievementUnlockListenerToast(
            id: event.achievement.id,
            icon: event.achievement.icon,
            eyebrow: eyebrow,
            name: name,
            detail: detail,
            viewLabel: strings("achievements.view", "View"),
            dismissLabel: strings("achievements.dismiss", "Dismiss achievement notification"),
            route: AchievementUnlockListenerRoute.lifetime(achievementID: event.achievement.id),
            accessibilityLabel: AchievementUnlockListenerAccessibility.toastLabel(
                eyebrow: eyebrow,
                name: name,
                detail: detail
            )
        )
    }
}
