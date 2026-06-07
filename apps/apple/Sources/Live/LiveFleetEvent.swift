import Foundation

/// A discriminated, `Sendable`/`Equatable` primitive carried by live payloads.
///
/// This is the Swift-native projection of the shared core's `SignalValue`
/// (and the JSON scalars inside `VehicleUpdate`/`Alert` payloads). Keeping it
/// Shared-free lets the live store, its tests, previews, and the demo screen
/// construct events without any KMP object — the production adapter decodes the
/// Kotlin payloads into these (see `SharedLiveStreamProvider`).
public enum LiveScalar: Equatable, Sendable {
    case number(Double)
    case string(String)
    case bool(Bool)
    case null

    /// The value as a `Double` when numeric (or a bool as 0/1), else `nil`.
    public var doubleValue: Double? {
        switch self {
        case let .number(value): value
        case let .bool(value): value ? 1 : 0
        case .string, .null: nil
        }
    }

    /// A display string for the value (`"—"` for `null`).
    public var displayValue: String {
        switch self {
        case let .number(value): Self.format(value)
        case let .string(value): value
        case let .bool(value): value ? "true" : "false"
        case .null: "—"
        }
    }

    private static func format(_ value: Double) -> String {
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }
}

/// A single live signal sample, mirroring the shared `SignalEnvelope`.
public struct LiveSignalSample: Equatable, Sendable {
    public let vehicleID: Int64
    public let field: String
    public let value: LiveScalar
    public let timestamp: Date?

    public init(vehicleID: Int64, field: String, value: LiveScalar, timestamp: Date? = nil) {
        self.vehicleID = vehicleID
        self.field = field
        self.value = value
        self.timestamp = timestamp
    }
}

/// A fired alert payload projected for live consumers.
public struct LiveAlert: Equatable, Sendable {
    public let id: String?
    public let severity: String?
    public let message: String?
    public let vehicleID: Int64?

    public init(id: String?, severity: String?, message: String?, vehicleID: Int64? = nil) {
        self.id = id
        self.severity = severity
        self.message = message
        self.vehicleID = vehicleID
    }
}

/// Native, Shared-free projection of the shared `LiveEvent` taxonomy. Page
/// consumers and the live store reduce these into their own snapshot; the
/// production adapter maps each `Shared.LiveEvent` case into one of these.
///
/// The `kind` discriminator on `LiveEnvelope` is derived from this so callers can
/// route without a full pattern match when they only need the category.
public enum LiveFleetEvent: Equatable, Sendable {
    case connected(clientID: String)
    case heartbeat(time: Date?)
    case vehicleUpdate(vehicleID: Int64?, signals: [String: LiveScalar])
    case alert(LiveAlert)
    case exportStatus(jobID: String?, progress: Double?, status: String?)
    case achievementUnlocked(id: String?, title: String?)
    case signal(LiveSignalSample)
    case unknown(event: String)

    /// The category of this event, matching the facade's `LiveEventKind`.
    public var kind: LiveEventKind {
        switch self {
        case .connected: .connected
        case .heartbeat: .heartbeat
        case .vehicleUpdate: .vehicleUpdate
        case .alert: .alert
        case .exportStatus: .exportStatus
        case .achievementUnlocked: .achievementUnlocked
        case .signal: .signal
        case .unknown: .unknown
        }
    }

    /// The vehicle this event pertains to, when it carries one — lets a
    /// vehicle/signal-scoped consumer filter the shared fleet pipe.
    public var vehicleID: Int64? {
        switch self {
        case let .vehicleUpdate(vehicleID, _): vehicleID
        case let .alert(alert): alert.vehicleID
        case let .signal(sample): sample.vehicleID
        case .connected, .heartbeat, .exportStatus, .achievementUnlocked, .unknown: nil
        }
    }

    /// Whether this event advances data freshness. Heartbeats keep the connection
    /// fresh but carry no data; everything else is a real data update. Both reset
    /// the staleness clock (matching the shared client's freshness watchdog).
    public var isDataBearing: Bool {
        switch self {
        case .connected, .heartbeat: false
        case .vehicleUpdate, .alert, .exportStatus, .achievementUnlocked, .signal, .unknown: true
        }
    }
}
