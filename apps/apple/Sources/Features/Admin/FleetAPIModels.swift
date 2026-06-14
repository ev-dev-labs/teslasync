import Foundation

// MARK: - Wire value types (web `AppSettings` / `PollingConfig` / `CaptureStats` / `VersionInfo`)

/// The slice of the web `AppSettings` the Fleet API page reads — whether Tesla Fleet API
/// polling is globally suspended (`internal/api/settings_handler.go`). Control-plane data,
/// no SI units.
public struct FleetAPISettings: Equatable, Sendable {
    public var apiSuspended: Bool

    public init(apiSuspended: Bool) {
        self.apiSuspended = apiSuspended
    }
}

/// The per-endpoint polling toggles + telemetry-capture retention (web `PollingConfig`,
/// `GET/PUT /settings/polling-config`). The web type is a typed record with a string index
/// signature; the page reads/writes individual endpoints by key, so the native peer keeps a
/// keyed `flags` map plus the typed retention window. Counts of days carry no SI conversion.
public struct PollingConfig: Equatable, Sendable {
    /// The 21 endpoint booleans keyed by their snake_case wire name.
    public var flags: [String: Bool]
    /// `telemetry_capture_retention_days` — auto-delete window for captured signals.
    public var retentionDays: Int

    public init(flags: [String: Bool], retentionDays: Int) {
        self.flags = flags
        self.retentionDays = retentionDays
    }

    /// Web `!!pollingConfig[key]` — a missing flag reads as off.
    public subscript(key: String) -> Bool {
        flags[key] ?? false
    }

    /// Web `{ ...pollingConfig, [key]: !pollingConfig[key] }` — returns a flipped copy.
    public func toggling(_ key: String) -> PollingConfig {
        var copy = self
        copy.flags[key] = !(flags[key] ?? false)
        return copy
    }

    /// Web `{ ...pollingConfig, telemetry_capture_retention_days: days }`.
    public func settingRetention(_ days: Int) -> PollingConfig {
        var copy = self
        copy.retentionDays = days
        return copy
    }
}

/// Telemetry-capture (MongoDB) status (web `CaptureStats`,
/// `GET /dev-tools/telemetry-capture/stats`).
public struct CaptureStats: Equatable, Sendable {
    public var mongoEnabled: Bool
    public var totalDocuments: Int
    public var distinctVINs: [String]

    public init(mongoEnabled: Bool, totalDocuments: Int, distinctVINs: [String]) {
        self.mongoEnabled = mongoEnabled
        self.totalDocuments = totalDocuments
        self.distinctVINs = distinctVINs
    }
}

/// Server build + configured-URL info (web `VersionInfo`, `GET /system/version`). The
/// `endpoints` map is rendered verbatim (URLs aren't localized).
public struct VersionInfo: Equatable, Sendable {
    public var chartVersion: String
    public var goVersion: String
    public var os: String
    public var arch: String
    public var endpoints: [String: String]

    public init(chartVersion: String, goVersion: String, os: String, arch: String, endpoints: [String: String]) {
        self.chartVersion = chartVersion
        self.goVersion = goVersion
        self.os = os
        self.arch = arch
        self.endpoints = endpoints
    }

    /// Web `` `v${chart_version} · ${go_version} · ${os}/${arch}` `` — a verbatim build line.
    public var summary: String {
        "v\(chartVersion) · \(goVersion) · \(os)/\(arch)"
    }
}

/// One read of all four Fleet API query feeds. Each is optional because the web treats every
/// query independently (a panel renders its own empty state when its feed is absent).
public struct FleetAPISnapshot: Equatable, Sendable {
    public var settings: FleetAPISettings?
    public var polling: PollingConfig?
    public var capture: CaptureStats?
    public var version: VersionInfo?

    public init(
        settings: FleetAPISettings? = nil,
        polling: PollingConfig? = nil,
        capture: CaptureStats? = nil,
        version: VersionInfo? = nil
    ) {
        self.settings = settings
        self.polling = polling
        self.capture = capture
        self.version = version
    }
}

// MARK: - Data source seam (web `useSettings` / `usePollingConfig` / `useCaptureStats` /

//                          `useVersionInfo` / `useToggleAPISuspend` / `useUpdatePollingConfig`)

/// Supplies the four read feeds and performs the two mutations the page drives. The
/// production implementation binds the shared KMP settings endpoints (`GET /settings`,
/// `GET /settings/polling-config`, `GET /dev-tools/telemetry-capture/stats`,
/// `GET /system/version`, `POST /settings/suspend-api`, `PUT /settings/polling-config`,
/// ADR-004 — the view holds no networking); previews and tests inject doubles to drive every
/// data state. Mirrors the sibling `FeatureFlagsDataSource` seam.
public protocol FleetAPIDataSource: Sendable {
    /// Reads all four feeds (web `useSettings` + `usePollingConfig` + `useCaptureStats` +
    /// `useVersionInfo`).
    func load() async throws -> FleetAPISnapshot
    /// Web `useToggleAPISuspend → POST /settings/suspend-api`.
    func setAPISuspended(_ suspended: Bool) async throws
    /// Web `useUpdatePollingConfig → PUT /settings/polling-config`.
    func updatePollingConfig(_ config: PollingConfig) async throws
}

// MARK: - Page state (web query phases) + transient notices (web `useToast`)

/// The page load state (web's combined `settings` / `pollingConfig` / `captureStats` /
/// `version` query phases): `.error` is a retryable failure, `.loaded` carries the snapshot
/// whose panels each surface their own empty state.
public enum FleetAPILoadState: Equatable, Sendable {
    case loading
    case error(String)
    case loaded(FleetAPISnapshot)
}

/// The transient outcome of a mutation, surfaced as a dismissible banner (web `useToast`
/// success / info / error). Each case maps to its web title/body string at the view boundary.
public enum FleetAPINotice: Equatable, Sendable {
    /// Web `toast.info('API suspended', 'All Tesla API calls have been paused')`.
    case apiSuspended
    /// Web `toast.success('API resumed', 'Tesla API polling has been re-enabled')`.
    case apiResumed
    /// Web `toast.error('Failed', 'Could not toggle API suspension')`.
    case suspendFailed
    /// Web `toast.success('Polling config updated')`.
    case pollingUpdated
    /// Web `toast.error('Failed to update polling config')`.
    case pollingFailed
}

// MARK: - Display-boundary formatter (web `numberFormat.ts` `fmtInt`)

/// Pure, testable display formatters ported from the web. Fleet API metadata carries no SI
/// units, so this only group-formats the captured-document count.
public enum FleetAPIFormat {
    /// Web `fmtInt(value)` — grouped integer (e.g. `152,340`).
    public static func int(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US")
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}
