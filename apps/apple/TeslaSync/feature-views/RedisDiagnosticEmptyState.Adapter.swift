//
//  RedisDiagnosticEmptyState.Adapter.swift
//  TeslaSync — P4 feature view · 0039 · RedisDiagnosticEmptyState (Apple)
//
//  The testable projection core — the SwiftUI parity of
//  features/admin/components/RedisDiagnosticEmptyState.tsx. Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view) so the nine-branch
//  diagnostic ladder, the "other vehicles" key filtering, the timestamp formatting,
//  the docs-URL resolution, and the VoiceOver summaries are unit tested in isolation.
//
//  The web component branches on the `meta` block from GET /dev-tools/redis-signals
//  plus the upstream request error (typed ApiError / network failure). Error branches
//  win over meta branches so a backend outage is never disguised as an empty cache.
//

import Foundation
import SwiftUI

// MARK: - Wire value types (web @/api/devtools shapes + @/lib/resilience ApiError)

/// The live-signal-store mode reported in `meta.live_signal_store_mode` (web union
/// `'hybrid' | 'local'`). `hybrid` mirrors L1→Redis; `local` writes L1 only.
public enum RedisLiveStoreMode: String, Sendable, Equatable {
    case hybrid
    case local
}

/// The diagnostic `meta` block (web `RedisDiagnosticSignalsMeta`). Last-seen timestamps are
/// parsed `Date?`s (web ISO strings → `new Date(...)`); an absent timestamp is `nil`.
public struct RedisDiagnosticSignalsMeta: Sendable, Equatable {
    public var liveSignalStoreMode: RedisLiveStoreMode
    public var redisKey: String
    public var redisFieldCount: Int
    public var l1SignalCount: Int
    public var l1LastSeenAt: Date?
    public var l2LastSeenAt: Date?
    public var vehicleVin: String

    public init(
        liveSignalStoreMode: RedisLiveStoreMode,
        redisKey: String,
        redisFieldCount: Int,
        l1SignalCount: Int,
        vehicleVin: String,
        l1LastSeenAt: Date? = nil,
        l2LastSeenAt: Date? = nil
    ) {
        self.liveSignalStoreMode = liveSignalStoreMode
        self.redisKey = redisKey
        self.redisFieldCount = redisFieldCount
        self.l1SignalCount = l1SignalCount
        self.vehicleVin = vehicleVin
        self.l1LastSeenAt = l1LastSeenAt
        self.l2LastSeenAt = l2LastSeenAt
    }
}

/// One entry from GET /dev-tools/redis-signals/keys (web `RedisSignalKeyEntry`), used
/// for the "other vehicles with cached signals" chips.
public struct RedisSignalKeyEntry: Sendable, Equatable, Identifiable {
    public var vehicleId: Int
    public var fieldCount: Int
    public var vehicleVin: String?
    public var displayName: String?

    public var id: Int {
        vehicleId
    }

    public init(vehicleId: Int, fieldCount: Int, vehicleVin: String? = nil, displayName: String? = nil) {
        self.vehicleId = vehicleId
        self.fieldCount = fieldCount
        self.vehicleVin = vehicleVin
        self.displayName = displayName
    }
}

/// The typed upstream API error (web `ApiError` — an `Error` carrying the HTTP
/// `status`). Network-layer failures are modeled separately by a boolean flag.
public struct RedisApiError: Sendable, Equatable {
    public var status: Int
    public var message: String

    public init(status: Int, message: String) {
        self.status = status
        self.message = message
    }
}

// MARK: - Tone (web danger / warning / info / neutral border+fill tints)

/// The banner tone (web `tone` union). Drives the toned border + fill tint only — the
/// icon (web `text-[var(--text-secondary)]`), title, and body colors are tone-invariant.
public enum RedisDiagnosticTone: String, Sendable, Equatable {
    case danger
    case warning
    case info
    case neutral

    /// The stroke color for the banner border (web `border-{tone}-500/30`).
    public var strokeColor: Color {
        switch self {
        case .danger: Color.TS.statusDanger.opacity(0.3)
        case .warning: Color.TS.statusWarning.opacity(0.3)
        case .info: Color.TS.statusInfo.opacity(0.3)
        case .neutral: Color.TS.border
        }
    }

    /// The fill tint for the banner background (web `bg-{tone}-500/5` / `surface-2`).
    public var fillColor: Color {
        switch self {
        case .danger: Color.TS.statusDanger.opacity(0.06)
        case .warning: Color.TS.statusWarning.opacity(0.06)
        case .info: Color.TS.statusInfo.opacity(0.06)
        case .neutral: Color.TS.surfaceGlass
        }
    }
}

// MARK: - Localizable text (web `t(key, default)` + i18next `{{name}}` interpolation)

/// A localizable string: the i18n `key`, the web English `fallback`, and any
/// `{{name}}` interpolation values. Resolved through the P1/S10 facade at render time
/// (and through a fake localizer in tests) so the view holds no English literals.
public struct RDText: Sendable, Equatable {
    public let key: String
    public let fallback: String
    public let args: [String: String]

    public init(_ key: String, _ fallback: String, args: [String: String] = [:]) {
        self.key = key
        self.fallback = fallback
        self.args = args
    }

    /// Localizes the key (with the English fallback) and applies `{{name}}` substitution.
    public func resolved(_ localize: (String, String) -> String) -> String {
        RDInterpolate.apply(localize(key, fallback), args)
    }
}

/// One call-to-action affordance (web `<a href><Button>{cta}</Button></a>`): a
/// localizable label plus the app-relative docs `path` it opens.
public struct RDCTA: Sendable, Equatable {
    public let label: RDText
    public let path: String

    public init(label: RDText, path: String) {
        self.label = label
        self.path = path
    }
}

/// i18next-style `{{name}}` token replacement (parity with the web interpolation).
public enum RDInterpolate {
    public static func apply(_ template: String, _ args: [String: String]) -> String {
        guard !args.isEmpty else { return template }
        var output = template
        for (name, value) in args {
            output = output.replacingOccurrences(of: "{{\(name)}}", with: value)
        }
        return output
    }
}

// MARK: - Resolved branch (the nine web render branches)

/// The resolved diagnostic branch — the native mirror of the web component's nine
/// mutually-exclusive render branches. `legacyEmpty` renders the generic empty state
/// (web `EmptyState`); every other kind renders a `DiagnosticBanner`.
public struct RedisDiagnosticResolved: Sendable, Equatable {
    /// The mutually-exclusive branches (web error ladder → no-meta fallback → meta ladder).
    public enum Kind: String, Sendable, Equatable {
        case cacheNotWired
        case unreachable
        case requestFailed
        case networkError
        case legacyEmpty
        case modeLocal
        case mirrorBroken
        case noTelemetry
        case fallthroughEmpty
    }

    public let kind: Kind
    public let tone: RedisDiagnosticTone
    public let iconSystemName: String
    public let title: RDText
    public let body: RDText
    public let cta: RDCTA?
    /// Whether the meta detail list renders (web `{meta && <DiagnosticMetaList/>}`).
    public let showsMeta: Bool
    /// Whether the "other vehicles" chips render (web passes `otherKeys` to this branch).
    public let showsOtherKeys: Bool
    /// Whether the branch is an upstream failure (gets the native retry affordance).
    public let isError: Bool

    public init(
        kind: Kind,
        tone: RedisDiagnosticTone,
        iconSystemName: String,
        title: RDText,
        body: RDText,
        cta: RDCTA? = nil,
        showsMeta: Bool = false,
        showsOtherKeys: Bool = false,
        isError: Bool = false
    ) {
        self.kind = kind
        self.tone = tone
        self.iconSystemName = iconSystemName
        self.title = title
        self.body = body
        self.cta = cta
        self.showsMeta = showsMeta
        self.showsOtherKeys = showsOtherKeys
        self.isError = isError
    }
}

// MARK: - SF Symbols (web lucide icons → Apple HIG symbols)

/// SF Symbol names mapping the web lucide icons (ServerCrash / AlertTriangle / Zap /
/// Radio / Database) to their closest Apple HIG counterparts.
enum RedisDiagnosticIcon {
    static let serverCrash = "externaldrive.badge.xmark"
    static let alert = "exclamationmark.triangle.fill"
    static let telemetry = "bolt.fill"
    static let radio = "dot.radiowaves.left.and.right"
    static let database = "externaldrive"
}

// MARK: - Projection (pure 1:1 port of the web if-ladder)

/// Pure projection from the diagnostic inputs to the resolved branch — the native port
/// of the web component's error ladder (cacheNotWired / unreachable / requestFailed /
/// networkError) → no-meta fallback → meta ladder (modeLocal / mirrorBroken /
/// noTelemetry / fallthrough). Error branches always win. Unit tested across every branch.
public enum RedisDiagnosticProjection {
    /// The Redis TTL window (web `SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000`).
    public static let sevenDays: TimeInterval = 7 * 24 * 60 * 60

    /// HTTP statuses the "unreachable" branch accepts (web `503 || 502 || 504`).
    private static let gatewayStatuses: Set<Int> = [502, 503, 504]

    /// The generic pre-meta fallback (web `EmptyState` with the Database icon).
    public static let legacyEmpty = RedisDiagnosticResolved(
        kind: .legacyEmpty,
        tone: .neutral,
        iconSystemName: RedisDiagnosticIcon.database,
        title: RedisDiagnosticCopy.legacyEmptyMessage,
        body: RedisDiagnosticCopy.legacyEmptyMessage
    )

    /// Resolves the active branch. Error inputs take precedence over `meta`; with no
    /// error and no meta the legacy empty state is returned (web back-compat fallback).
    public static func resolve(
        meta: RedisDiagnosticSignalsMeta?,
        serverError: RedisApiError?,
        networkError: Bool,
        now: Date = Date(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> RedisDiagnosticResolved {
        let showsMeta = meta != nil
        if let error = errorBranch(serverError: serverError, networkError: networkError, showsMeta: showsMeta) {
            return error
        }
        guard let meta else { return legacyEmpty }
        return metaBranch(meta, now: now, locale: locale, timeZone: timeZone)
    }

    /// Filters the cached-signal keys to the "other vehicles" set (web
    /// `keys.filter(k => k.vehicle_id !== vehicleId && k.field_count > 0)`).
    public static func otherKeys(_ keys: [RedisSignalKeyEntry], excluding vehicleId: Int) -> [RedisSignalKeyEntry] {
        keys.filter { $0.vehicleId != vehicleId && $0.fieldCount > 0 }
    }

    // MARK: Error ladder (web branches 0.A – 0.D)

    private static func errorBranch(
        serverError: RedisApiError?,
        networkError: Bool,
        showsMeta: Bool
    ) -> RedisDiagnosticResolved? {
        if let error = serverError, error.status == 503, contains(error.message, "not available") {
            return RedisDiagnosticResolved(
                kind: .cacheNotWired, tone: .danger, iconSystemName: RedisDiagnosticIcon.serverCrash,
                title: RedisDiagnosticCopy.cacheNotWiredTitle, body: RedisDiagnosticCopy.cacheNotWiredBody,
                cta: RedisDiagnosticCopy.cacheNotWiredCTA, showsMeta: showsMeta, isError: true
            )
        }
        if let error = serverError, isUnreachable(error) {
            return RedisDiagnosticResolved(
                kind: .unreachable, tone: .danger, iconSystemName: RedisDiagnosticIcon.serverCrash,
                title: RedisDiagnosticCopy.unreachableTitle, body: RedisDiagnosticCopy.unreachableBody,
                showsMeta: showsMeta, isError: true
            )
        }
        if let error = serverError {
            return RedisDiagnosticResolved(
                kind: .requestFailed, tone: .warning, iconSystemName: RedisDiagnosticIcon.alert,
                title: RedisDiagnosticCopy.requestFailedTitle,
                body: RedisDiagnosticCopy.requestFailedBody(status: error.status, message: error.message),
                showsMeta: showsMeta, isError: true
            )
        }
        if networkError {
            return RedisDiagnosticResolved(
                kind: .networkError, tone: .warning, iconSystemName: RedisDiagnosticIcon.alert,
                title: RedisDiagnosticCopy.networkErrorTitle, body: RedisDiagnosticCopy.networkErrorBody,
                showsMeta: showsMeta, isError: true
            )
        }
        return nil
    }

    // MARK: Meta ladder (web branches 1 – 4)

    private static func metaBranch(
        _ meta: RedisDiagnosticSignalsMeta,
        now: Date,
        locale: Locale,
        timeZone: TimeZone
    ) -> RedisDiagnosticResolved {
        if meta.liveSignalStoreMode == .local {
            return RedisDiagnosticResolved(
                kind: .modeLocal, tone: .danger, iconSystemName: RedisDiagnosticIcon.serverCrash,
                title: RedisDiagnosticCopy.modeLocalTitle, body: RedisDiagnosticCopy.modeLocalBody,
                cta: RedisDiagnosticCopy.modeLocalCTA, showsMeta: true
            )
        }
        if meta.l1SignalCount > 0, meta.redisFieldCount == 0 {
            return RedisDiagnosticResolved(
                kind: .mirrorBroken, tone: .warning, iconSystemName: RedisDiagnosticIcon.alert,
                title: RedisDiagnosticCopy.mirrorBrokenTitle,
                body: RedisDiagnosticCopy.mirrorBrokenBody(count: meta.l1SignalCount),
                showsMeta: true, showsOtherKeys: true
            )
        }
        let ttlSuspected = meta.l1LastSeenAt.map { now.timeIntervalSince($0) > sevenDays } ?? true
        if meta.l1SignalCount == 0, ttlSuspected {
            return RedisDiagnosticResolved(
                kind: .noTelemetry, tone: .info, iconSystemName: RedisDiagnosticIcon.telemetry,
                title: RedisDiagnosticCopy.noTelemetryTitle,
                body: noTelemetryBody(meta.l1LastSeenAt, locale: locale, timeZone: timeZone),
                showsMeta: true, showsOtherKeys: true
            )
        }
        return RedisDiagnosticResolved(
            kind: .fallthroughEmpty, tone: .neutral, iconSystemName: RedisDiagnosticIcon.radio,
            title: RedisDiagnosticCopy.fallthroughTitle, body: RedisDiagnosticCopy.fallthroughBody,
            showsMeta: true, showsOtherKeys: true
        )
    }

    private static func noTelemetryBody(_ lastSeen: Date?, locale: Locale, timeZone: TimeZone) -> RDText {
        guard let lastSeen else { return RedisDiagnosticCopy.noTelemetryAbsentBody }
        let dateText = RedisDiagnosticFormat.dateTime(lastSeen, locale: locale, timeZone: timeZone)
        return RedisDiagnosticCopy.noTelemetryStaleBody(dateText: dateText)
    }

    /// Case-insensitive substring test (web `/needle/i.test(message)`).
    private static func contains(_ message: String, _ needle: String) -> Bool {
        message.range(of: needle, options: .caseInsensitive) != nil
    }

    /// Whether a typed API error is a gateway/unreachable failure (web branch 0.B).
    private static func isUnreachable(_ error: RedisApiError) -> Bool {
        gatewayStatuses.contains(error.status)
            && (contains(error.message, "unreachable") || contains(error.message, "upstream"))
    }
}
