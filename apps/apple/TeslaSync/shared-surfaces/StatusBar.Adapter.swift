//
//  StatusBar.Adapter.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The testable, dependency-light core for the always-on footer status bar — the SwiftUI parity of
//  components/layout/StatusBar.tsx and its six ./status-bar/ segment children (Connection, LiveTelemetry,
//  ActiveVehicle, BackgroundWork, Help, Version). StatusBar.tsx itself is presentational chrome (it reads
//  only the persisted prefs + the viewport width); the data each segment shows comes from a dedicated hook,
//  so the bar's "data" is the union of those segment inputs.
//
//  This file is the Foundation-only heart of the native peer:
//    • the surface slug (P1/S11 diagnostics),
//    • the i18n facade typealias (P1/S10) — `(key, fallback) -> String`, the native peer of `t(key, def)`,
//    • `StatusBarInterpolation` — the native peer of i18next `{{slot}}` interpolation,
//    • the segment status enums (web `ApiHealthStatus` / `LiveConnectionStatus` / `BackgroundJobKind`),
//    • `StatusBarTone` — the semantic tone each state pairs with an SF Symbol so color is never the sole
//      encoder (the web's `text-emerald-300` / `amber` / `rose` / muted intent, token-resolved in the view),
//    • the value-type peers of the segment data (`StatusBarVehicleRef` / `StatusBarJob` /
//      `StatusBarVersionInfo` / `StatusBarUpdateCheck`),
//    • `StatusBarFormat` — the VERBATIM ports of `ageSecondsLabel`, `convertDistanceFromSI` (+ round) and
//      `uptimeLabel`.
//
//  No SwiftUI, no @Observable model, no networking — every branch is unit testable in isolation. The i18n
//  lookup is injected as a closure so the core stays Foundation-only and the tests stay deterministic; the
//  live `@Observable` model + the SwiftUI tree live in the Model / view files.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). The
/// prompt assigns this surface the canonical slug `StatusBar`, kept here (SwiftUI-free) so the state-holder
/// can emit telemetry without depending on the view layer.
public enum StatusBarSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "StatusBar"
}

// MARK: - Localization facade typealias (P1/S10)

/// The i18n lookup the surface uses to resolve its copy — `(key, fallback) -> String`, the native peer of
/// the web `t(key, default)`. Injected so the pure core stays Foundation-only and deterministic in tests
/// (pass `{ _, fallback in fallback }`). `@Sendable` so it crosses isolation boundaries cleanly under
/// Swift 6 strict concurrency.
public typealias StatusBarLocalize = @Sendable (String, String) -> String

// MARK: - StatusBarInterpolation (web i18next `t(key, { age, count, uptime })`)

/// Substitutes `{{name}}` slots in a localized template — the native peer of i18next interpolation. The web
/// composes labels like `t('statusBar.live.lastMessage', { age })`; here the localizer returns the template
/// (localized or the fallback) and this fills the slots, so the whole label stays translatable with no
/// hardcoded English in the view.
public enum StatusBarInterpolation {
    /// Replaces each `{{key}}` in `template` with its value. Distinct slot keys make order irrelevant; an
    /// unreferenced slot is left untouched (i18next behaviour).
    public static func format(_ template: String, _ values: [String: String]) -> String {
        values.reduce(template) { partial, pair in
            partial.replacingOccurrences(of: "{{\(pair.key)}}", with: pair.value)
        }
    }
}

// MARK: - Segment status enums (web hook statuses)

/// API connection health — the value-type peer of the web `ApiHealthStatus` (`useApiHealth`).
public enum StatusBarApiHealth: String, Sendable, Equatable, CaseIterable {
    case ok, degraded, offline, unknown
}

/// Live telemetry stream status — the value-type peer of the web `LiveConnectionStatus`
/// (`useLiveConnection`). `stale` is the open-but-past-the-freshness-window state (ADR-013) the bar flags
/// without dropping the stream.
public enum StatusBarLiveStatus: String, Sendable, Equatable, CaseIterable {
    case connected, reconnecting, disconnected, stale, unknown
}

/// In-flight background work kind — the value-type peer of the web `BackgroundJobKind`
/// (`useBackgroundJobs`): a CSV export, a settings mutation, or an ad-hoc registered job.
public enum StatusBarJobKind: String, Sendable, Equatable, CaseIterable {
    case export, mutation, custom
}

// MARK: - StatusBarTone (color paired with an icon — never color-only)

/// The semantic tone a segment state carries. The web pairs a Tailwind color (`emerald` / `amber` / `rose`
/// / muted) with a distinct icon so the state is legible to color-vision-deficient users; this tone is the
/// vendor-neutral intent, resolved to a design token + an SF Symbol in the view layer (P1/S9).
public enum StatusBarTone: String, Sendable, Equatable {
    /// Healthy / connected — web `emerald`.
    case positive
    /// Degraded / reconnecting / stale / pending work — web `amber`.
    case caution
    /// Offline / disconnected — web `rose`.
    case critical
    /// Unknown / idle / informational — web muted.
    case neutral

    /// The tone for an API-health state — web Connection variant map.
    public static func forApiHealth(_ status: StatusBarApiHealth) -> StatusBarTone {
        switch status {
        case .ok: .positive
        case .degraded: .caution
        case .offline: .critical
        case .unknown: .neutral
        }
    }

    /// The tone for a live-telemetry state — web LiveTelemetry variant map (`stale` is amber like the
    /// reconnecting state — values stay usable but flagged).
    public static func forLiveStatus(_ status: StatusBarLiveStatus) -> StatusBarTone {
        switch status {
        case .connected: .positive
        case .reconnecting, .stale: .caution
        case .disconnected: .critical
        case .unknown: .neutral
        }
    }
}

// MARK: - StatusBarDistanceUnit (web user distance preference)

/// The user's distance unit — the native peer of `useUnits().unitPrefs.distance`. Drives both the metrics
/// conversion and the unit suffix on the active-vehicle chip.
public enum StatusBarDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case km, mi

    /// The display suffix shown after the converted value (web appends `distanceLabel`).
    public var symbol: String {
        rawValue
    }
}

// MARK: - StatusBarFormat (verbatim ports of the segment formatters)

/// The segments' pure display formatters, ported verbatim so each is unit-tested without a clock or a view:
/// `ageSecondsLabel` (s/m/h), `convertDistanceFromSI` + round, and `uptimeLabel` (d/h/m).
public enum StatusBarFormat {
    /// The em-dash sentinel the web shows when an age can't be computed (`ageSecondsLabel` early return).
    public static let dash = "—"

    /// `ageSecondsLabel` — collapses an elapsed second-count to `Ns` / `Nm` / `Nh`. Negative / non-finite
    /// inputs yield the em-dash sentinel (web `ms < 0` guard).
    public static func ageLabel(secondsAgo: Int) -> String {
        guard secondsAgo >= 0 else { return dash }
        if secondsAgo < 60 { return "\(secondsAgo)s" }
        let minutes = secondsAgo / 60
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h"
    }

    /// `ageSecondsLabel` over a timestamp + a reference `now` — the native peer of `Date.now() - iso`.
    /// Returns the em-dash sentinel when `date` is in the future (web `ms < 0`).
    public static func ageLabel(since date: Date, now: Date) -> String {
        ageLabel(secondsAgo: Int(now.timeIntervalSince(date).rounded(.down)))
    }

    /// `convertDistanceFromSI(meters, unit)` + `Math.round` — meters → km (÷1000) or mi (÷1609.344),
    /// rounded to the nearest whole unit (the chip shows no decimals).
    public static func distance(meters: Double, unit: StatusBarDistanceUnit) -> Int {
        guard meters.isFinite else { return 0 }
        let value = unit == .mi ? meters / 1609.344 : meters / 1000
        return Int(value.rounded())
    }

    /// `uptimeLabel(seconds)` — `Nd Nh` / `Nh Nm` / `Nm`. `nil` for a non-positive / non-finite / missing
    /// uptime (web early `return null`).
    public static func uptime(seconds: Double?) -> String? {
        guard let seconds, seconds.isFinite, seconds > 0 else { return nil }
        let total = Int(seconds)
        let days = total / 86400
        let hours = (total % 86400) / 3600
        let minutes = (total % 3600) / 60
        if days > 0 { return "\(days)d \(hours)h" }
        if hours > 0 { return "\(hours)h \(minutes)m" }
        return "\(minutes)m"
    }
}

// MARK: - Value-type peers of the segment data

/// One vehicle on the account — the value-type peer of the web `vehicle` (`useSelectedVehicle`). The
/// display name resolves through the web fallback chain: `display_name || vin || "Vehicle {id}"`.
public struct StatusBarVehicleRef: Sendable, Equatable, Identifiable {
    public let id: Int
    public let displayName: String?
    public let vin: String?
    public let model: String?

    public init(id: Int, displayName: String? = nil, vin: String? = nil, model: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
        self.model = model
    }

    /// The resolved label — web `display_name || vin || \`Vehicle ${id}\``. `vehicleFallback` is the
    /// localized "Vehicle" word so the `Vehicle {id}` branch stays translatable.
    public func resolvedName(vehicleFallback: String) -> String {
        if let name = displayName, !name.isEmpty { return name }
        if let vin, !vin.isEmpty { return vin }
        return "\(vehicleFallback) \(id)"
    }
}

/// One in-flight background job — the value-type peer of the web background job record.
public struct StatusBarJob: Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: StatusBarJobKind
    public let label: String
    public let detail: String?

    public init(id: String, kind: StatusBarJobKind, label: String, detail: String? = nil) {
        self.id = id
        self.kind = kind
        self.label = label
        self.detail = detail
    }
}

/// The running-build provenance — the value-type peer of the web `VersionInfo` (`/system/version`). The
/// app version resolves server-truth → build-time → `dev`, captured upstream into `appVersion`.
public struct StatusBarVersionInfo: Sendable, Equatable {
    public let appVersion: String
    public let sha: String
    public let chartVersion: String?
    public let goVersion: String?
    public let os: String?
    public let arch: String?
    public let uptimeSeconds: Double?

    public init(
        appVersion: String,
        sha: String,
        chartVersion: String? = nil,
        goVersion: String? = nil,
        os: String? = nil,
        arch: String? = nil,
        uptimeSeconds: Double? = nil
    ) {
        self.appVersion = appVersion
        self.sha = sha
        self.chartVersion = chartVersion
        self.goVersion = goVersion
        self.os = os
        self.arch = arch
        self.uptimeSeconds = uptimeSeconds
    }

    /// The joined `os/arch` platform string — web `[os, arch].filter(Boolean).join('/')`. `nil` when both
    /// are absent (the row is hidden).
    public var platform: String? {
        let parts = [os, arch].compactMap { value -> String? in
            guard let value, !value.isEmpty else { return nil }
            return value
        }
        return parts.isEmpty ? nil : parts.joined(separator: "/")
    }

    /// Whether the SHA is a real commit (web hides the `dev` sentinel).
    public var hasRealSHA: Bool {
        !sha.isEmpty && sha != "dev"
    }
}

/// The update-availability probe — the value-type peer of the web `UpdateCheckResult`
/// (`/system/update-check`).
public struct StatusBarUpdateCheck: Sendable, Equatable {
    public let updateAvailable: Bool
    public let latest: String?
    public let message: String?

    public init(updateAvailable: Bool = false, latest: String? = nil, message: String? = nil) {
        self.updateAvailable = updateAvailable
        self.latest = latest
        self.message = message
    }

    /// The empty probe — no update (web default).
    public static let none = StatusBarUpdateCheck()
}
