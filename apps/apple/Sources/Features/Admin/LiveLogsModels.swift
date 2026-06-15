import Foundation

// MARK: - Log row (web `LogStreamEvent`)

/// One parsed log row — the native peer of the web `LogStreamEvent` from
/// `useLogStream`. `payload` is the raw zerolog JSON line (so arbitrary fields render
/// without pre-modelling, web `payload`); `message` + `fields` + `vehicleID` are the
/// lazily-decoded projections the web computes with `extractMessage` / `extractFields` /
/// `extractVehicleId`. `seq` is a monotonic counter assigned on receive so list identity
/// stays stable across reconciles even when two rows share a timestamp (web `seq`). Log
/// lines are unit-agnostic control-plane text — no SI conversion applies.
public struct LiveLogEntry: Identifiable, Sendable, Equatable {
    public let seq: Int
    public let receivedAt: Date
    public let payload: String
    public let level: String
    public let message: String
    public let fields: [LiveLogField]
    public let vehicleID: String?

    public var id: Int {
        seq
    }

    public init(
        seq: Int,
        receivedAt: Date,
        payload: String,
        level: String,
        message: String,
        fields: [LiveLogField],
        vehicleID: String?
    ) {
        self.seq = seq
        self.receivedAt = receivedAt
        self.payload = payload
        self.level = level
        self.message = message
        self.fields = fields
        self.vehicleID = vehicleID
    }

    /// The semantic severity of the row, derived from its `level` (web `levelBadgeVariant`).
    public var severity: LiveLogSeverity {
        LiveLogSeverity.from(level: level)
    }
}

/// One structured field from a log line — a `key=value` pair the web renders as a chip
/// (web `extractFields`, which skips `level`/`time`/`message`/`msg`). Values are
/// pre-stringified so the view holds no serialization logic.
public struct LiveLogField: Identifiable, Sendable, Equatable, Hashable {
    public let key: String
    public let value: String

    public var id: String {
        key
    }

    public init(key: String, value: String) {
        self.key = key
        self.value = value
    }
}

// MARK: - Severity (web `levelBadgeVariant`)

/// The semantic tone of a log row, mirroring the web `levelBadgeVariant` mapping
/// (debug/trace → neutral, info → info, warn → warning, error/fatal/panic → danger). The
/// view maps each case to a `TSTone`; kept here (SwiftUI-free) so it is unit-testable.
public enum LiveLogSeverity: String, Sendable, Equatable, CaseIterable {
    case neutral, info, warning, danger

    /// Web `levelBadgeVariant(level)` — an unknown level folds to `neutral`.
    public static func from(level: String) -> LiveLogSeverity {
        switch level.lowercased() {
        case "debug", "trace": .neutral
        case "info": .info
        case "warn", "warning": .warning
        case "error", "err", "fatal", "panic": .danger
        default: .neutral
        }
    }
}

// MARK: - Level filter (web `LogStreamLevel` + `LEVEL_OPTIONS`)

/// The server-side severity threshold (web `LogStreamLevel`). Changing it restarts the SSE
/// subscription, exactly like the web (the level is a query param on `/admin/logs/stream`).
public enum LiveLogLevel: String, CaseIterable, Identifiable, Sendable {
    case debug, info, warn, error

    public var id: String {
        rawValue
    }

    /// `Localizable.xcstrings` key for the dropdown label (web `LEVEL_OPTIONS[].i18nKey`).
    public var labelKey: String {
        "translation.liveLogs.level.\(rawValue)"
    }
}

// MARK: - Stream element (web SSE frame kinds)

/// One element yielded by the live log seam — the native peer of the web SSE frame kinds
/// the hook switches on (`connected` / `log` / `drop`, plus a terminal `failed`). The model
/// assigns `seq` + `receivedAt` when it ingests a `.log`, keeping the counter monotonic on
/// the main actor (web `nextSeq()`).
public enum LiveLogStreamElement: Sendable, Equatable {
    case connected
    case log(payload: String)
    case drop(count: Int)
    case failed(detail: String)
}

// MARK: - Connection status (web `ConnectionBadge`)

/// The connection chip state, mirroring the five web `ConnectionBadge` branches derived
/// from `hasError` / `enabled` / `isConnected` / `paused`. The model resolves the case; the
/// view maps it to a tone + localized label.
public enum LiveLogConnectionStatus: String, Sendable, Equatable {
    case error
    case disconnected
    case connecting
    case paused
    case connected

    /// `Localizable.xcstrings` key for the badge label (web `liveLogs.status.*`).
    public var labelKey: String {
        "translation.liveLogs.status.\(rawValue)"
    }

    /// The badge tone (web `Badge variant`): error→danger, disconnected→neutral,
    /// connecting→info, paused→warning, connected→success.
    public var severity: LiveLogSeverity {
        switch self {
        case .error: .danger
        case .disconnected: .neutral
        case .connecting: .info
        case .paused: .warning
        case .connected: .info
        }
    }
}

// MARK: - Table state (web table vs EmptyState branch)

/// The entries-panel render state — the native mirror of the web
/// `filteredEvents.length === 0 ? <EmptyState/> : <DataTable/>` branch. `.empty` is a
/// successful, connected buffer with nothing to show yet; `.success` carries rows.
public enum LiveLogsTableState: Sendable, Equatable {
    case empty
    case success
}

// MARK: - Subscription identity (drives `.task(id:)`)

/// The identity of a live subscription. A change restarts the page's `.task` (web effect
/// deps `[level, grep, enabled, endpoint]`). `paused` is intentionally excluded — pausing
/// holds the buffer without dropping the connection (web keeps the server fanning out).
/// `epoch` is bumped by `reconnect()` to force a fresh stream with unchanged filters.
public struct LiveLogSubscription: Hashable, Sendable {
    public let level: LiveLogLevel
    public let grep: String
    public let enabled: Bool
    public let epoch: Int

    public init(level: LiveLogLevel, grep: String, enabled: Bool, epoch: Int) {
        self.level = level
        self.grep = grep
        self.enabled = enabled
        self.epoch = epoch
    }
}

// MARK: - Errors

/// Thrown by a live source when the stream cannot be opened — the native peer of the web
/// `stream.error` branch that surfaces the "Could not connect to log stream" panel.
public struct LiveLogsLoadFailure: Error, Equatable {
    public let detail: String

    public init(detail: String) {
        self.detail = detail
    }
}
