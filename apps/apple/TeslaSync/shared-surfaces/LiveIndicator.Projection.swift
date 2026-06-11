//
//  LiveIndicator.Projection.swift
//  TeslaSync — P4 shared surface · 0094 · LiveIndicator (Apple)
//
//  The pure projection layer for the live-pipeline-health indicator — the SwiftUI-free core of the
//  parity port of `web/src/components/data-display/LiveIndicator.tsx`. It carries the four-state
//  connection taxonomy (the web `LiveConnectionStatus` union), the snapshot the indicator consumes
//  (the web `useLiveConnection` return value: `status` + `lastMessageAt`), the derivation that maps a
//  raw transport reading to that snapshot (the faithful port of the web hook's compute step including
//  the 10-second reconnecting grace), and the resolved view-state the SwiftUI layer renders. Keeping
//  the branch selection, the tone / icon / label choice, and the freshness gating here (rather than in
//  the view) lets every render branch be asserted deterministically without a view or a bundle.
//
//  The web component renders exactly one of four statuses — there is no skeleton / spinner-only gate
//  in the source, so `unknown` IS the initial (never-connected) state, `disconnected` IS the offline /
//  hard-error state, and staleness is surfaced through an aging freshness stamp on a still-connected
//  pill (the web `sseState` stays `connected`; only the timestamp ages). That mapping is reproduced
//  faithfully here rather than inventing chrome the web source does not have.
//

import Foundation

// MARK: - Connection status taxonomy (web `LiveConnectionStatus`)

/// The overall live-data pipeline health — the parity of the web `LiveConnectionStatus` union
/// (`'connected' | 'reconnecting' | 'disconnected' | 'unknown'`). This is the surface's source of
/// truth: the visual tone, icon, label, and freshness gating are all a pure function of it.
public enum LiveConnectionStatus: String, Sendable, Equatable, CaseIterable {
    case connected
    case reconnecting
    case disconnected
    case unknown
}

// MARK: - Raw transport phase (web `sseManager.getState()`)

/// The raw two-state SSE-transport signal the web hook reads (`'connected' | 'reconnecting'`) before
/// it derives the richer four-state status. The native peer of the web `sseManager` pushes this to
/// the production source; the surface never reads the transport itself.
public enum LiveConnectionTransport: String, Sendable, Equatable {
    case connected
    case reconnecting
}

// MARK: - Status derivation (web `useLiveConnection` compute step)

public extension LiveConnectionStatus {
    /// The grace window after entering `reconnecting` before the indicator promotes to
    /// `disconnected` — the parity of the web `RECONNECTING_GRACE_MS = 10_000`.
    static let reconnectingGrace: TimeInterval = 10

    /// Derive the overall status from the raw transport signal, the connection history, and the dwell
    /// time in the current transport phase — the faithful port of the web `useLiveConnection`
    /// compute step:
    ///
    ///     if connected            → connected
    ///     else if !everConnected  → unknown      (brand-new load, never seen the wire)
    ///     else if dwell < grace   → reconnecting (amber, within the 10s grace)
    ///     else                    → disconnected (red, promoted after the grace)
    static func derive(
        transport: LiveConnectionTransport,
        hasEverConnected: Bool,
        dwell: TimeInterval,
        grace: TimeInterval = reconnectingGrace
    ) -> LiveConnectionStatus {
        if transport == .connected { return .connected }
        if !hasEverConnected { return .unknown }
        if dwell < grace { return .reconnecting }
        return .disconnected
    }
}

// MARK: - Snapshot (web `{ status, lastMessageAt }`)

/// One coalesced reading of the live pipeline — the native mirror of the web `useLiveConnection`
/// return value the indicator consumes (`status` + `lastMessageAt`). The web `channels.sse` field is
/// backend-internal and never rendered by `LiveIndicator`, so it is intentionally not carried here.
public struct LiveConnectionSnapshot: Sendable, Equatable {
    public var status: LiveConnectionStatus
    /// When the last live message of any kind arrived (web `lastMessageAt`); `nil` until the first.
    public var lastMessageAt: Date?

    public init(status: LiveConnectionStatus = .unknown, lastMessageAt: Date? = nil) {
        self.status = status
        self.lastMessageAt = lastMessageAt
    }
}

// MARK: - Transport reading (host input → derived snapshot)

/// A raw transport reading the host (the app shell observing the native SSE transport) hands to the
/// production source. `LiveConnectionSnapshot.make(from:now:)` applies the web hook derivation to it,
/// so the host pushes facts (the wire phase, whether it has ever connected, when the phase was
/// entered, the last message time) and the surface owns the status math.
public struct LiveConnectionReading: Sendable, Equatable {
    public var transport: LiveConnectionTransport
    public var hasEverConnected: Bool
    public var stateEnteredAt: Date
    public var lastMessageAt: Date?

    public init(
        transport: LiveConnectionTransport,
        hasEverConnected: Bool,
        stateEnteredAt: Date,
        lastMessageAt: Date? = nil
    ) {
        self.transport = transport
        self.hasEverConnected = hasEverConnected
        self.stateEnteredAt = stateEnteredAt
        self.lastMessageAt = lastMessageAt
    }
}

public extension LiveConnectionSnapshot {
    /// Build a snapshot from a raw transport reading — the end-to-end parity of the web hook turning
    /// the `sseManager` state + the grace clock into `{ status, lastMessageAt }`.
    static func make(
        from reading: LiveConnectionReading,
        now: Date,
        grace: TimeInterval = LiveConnectionStatus.reconnectingGrace
    ) -> LiveConnectionSnapshot {
        let dwell = now.timeIntervalSince(reading.stateEnteredAt)
        let status = LiveConnectionStatus.derive(
            transport: reading.transport,
            hasEverConnected: reading.hasEverConnected,
            dwell: dwell,
            grace: grace
        )
        return LiveConnectionSnapshot(status: status, lastMessageAt: reading.lastMessageAt)
    }
}

// MARK: - Visual tone + icon (token / SF-symbol selectors, kept SwiftUI-free)

/// The semantic tone for a status — a token selector the Views layer maps to a `Color.TS` value, so
/// the projection stays SwiftUI-free and the tone choice is unit-testable. Mirrors the web
/// emerald / amber / rose / muted mapping.
public enum LiveIndicatorTone: String, Sendable, Equatable {
    case success
    case warning
    case danger
    case muted
}

/// The glyph for a status — an SF-symbol selector the Views layer maps to a system image. Mirrors the
/// web lucide icons: `wifi` (connected), a spinning loader (reconnecting), `wifi.slash`
/// (disconnected / unknown).
public enum LiveIndicatorIcon: String, Sendable, Equatable {
    case wifi
    case reconnecting
    case wifiSlash
}

// MARK: - Resolved view-state (web `VariantConfig` + render branch)

/// The resolved, view-ready state — every field is already chosen / localized, so the SwiftUI layer
/// is a pure function of this value. `variant` selects the dot vs. chip body; `freshness` is non-nil
/// only on the pill variant when connected with a known last-message time (the web `· {relative}`
/// span).
public struct LiveIndicatorResolved: Sendable, Equatable {
    public let variant: LiveIndicatorVariant
    public let status: LiveConnectionStatus
    public let tone: LiveIndicatorTone
    public let icon: LiveIndicatorIcon
    /// Whether the icon should spin (the web `Loader2` `animate-spin`). The Views layer still gates
    /// the actual animation on Reduce Motion.
    public let isSpinning: Bool
    public let label: String
    /// The freshness stamp (web `formatRelativeTime(lastMessageAt)`), or `nil` when not shown.
    public let freshness: String?
    public let accessibilityLabel: String
    public let accessibilityValue: String?

    public init(
        variant: LiveIndicatorVariant,
        status: LiveConnectionStatus,
        tone: LiveIndicatorTone,
        icon: LiveIndicatorIcon,
        isSpinning: Bool,
        label: String,
        freshness: String?,
        accessibilityLabel: String,
        accessibilityValue: String?
    ) {
        self.variant = variant
        self.status = status
        self.tone = tone
        self.icon = icon
        self.isSpinning = isSpinning
        self.label = label
        self.freshness = freshness
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityValue = accessibilityValue
    }
}

// MARK: - Projection (web `cfg[status]` + variant render branch)

/// Pure projection from a snapshot + variant to the resolved view-state — the native port of the web
/// `cfg` lookup table and the variant render branch (`dot` vs. the chip, and the pill-only freshness
/// stamp). Deterministic: the relative clock, locale, and string facade are all injected.
public enum LiveIndicatorProjection {
    public static func resolve(
        snapshot: LiveConnectionSnapshot,
        variant: LiveIndicatorVariant,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent,
        strings: LiveIndicatorResolve = LiveIndicatorStrings.string
    ) -> LiveIndicatorResolved {
        let status = snapshot.status
        let label = label(for: status, strings: strings)
        let freshness = freshness(
            for: snapshot,
            variant: variant,
            now: now,
            locale: locale,
            strings: strings
        )
        return LiveIndicatorResolved(
            variant: variant,
            status: status,
            tone: tone(for: status),
            icon: icon(for: status),
            isSpinning: status == .reconnecting,
            label: label,
            freshness: freshness,
            accessibilityLabel: label,
            accessibilityValue: freshness
        )
    }

    /// The freshness stamp — present only on the pill variant when connected with a known
    /// last-message time (the web `variant === 'pill' && status === 'connected' && lastMessageAt`).
    static func freshness(
        for snapshot: LiveConnectionSnapshot,
        variant: LiveIndicatorVariant,
        now: Date,
        locale: Locale,
        strings: LiveIndicatorResolve
    ) -> String? {
        guard variant == .pill, snapshot.status == .connected, let instant = snapshot.lastMessageAt
        else { return nil }
        return LiveIndicatorRelativeTime.string(for: instant, now: now, locale: locale, strings: strings)
    }

    static func tone(for status: LiveConnectionStatus) -> LiveIndicatorTone {
        switch status {
        case .connected: .success
        case .reconnecting: .warning
        case .disconnected: .danger
        case .unknown: .muted
        }
    }

    static func icon(for status: LiveConnectionStatus) -> LiveIndicatorIcon {
        switch status {
        case .connected: .wifi
        case .reconnecting: .reconnecting
        case .disconnected, .unknown: .wifiSlash
        }
    }

    static func label(for status: LiveConnectionStatus, strings: LiveIndicatorResolve) -> String {
        switch status {
        case .connected: strings("live.connected", "Live")
        case .reconnecting: strings("live.reconnecting", "Reconnecting…")
        case .disconnected: strings("live.disconnected", "Offline")
        case .unknown: strings("live.unknown", "Unknown")
        }
    }
}

// MARK: - Surface metadata

/// Static, non-identifying surface constants — the diagnostics slug (P1/S11 `view.opened`) and the
/// locale-neutral fallback glyph shared with the relative-time formatter.
public enum LiveIndicatorMeta {
    public static let surfaceSlug = "LiveIndicator"
    /// The em-dash sentinel (the web `formatRelativeTime` null return), used only when a relative
    /// time is requested for a missing instant.
    public static let fallback = "—"
}
