import Foundation
import Shared

/// Live-stream connection lifecycle, mirroring the shared core's `Connection`
/// (`io.teslasync.shared.core.net.sse.Connection`). Drives the "live / stale /
/// reconnecting" badge every real-time surface shows (ADR-013).
public enum LiveConnectionState: Equatable, Sendable {
    case connecting
    case open
    case reconnecting
    /// Open but no event/heartbeat within the freshness window — values stay
    /// visible but flagged stale; the stream is NOT dropped.
    case stale
    case closed

    /// Maps the shared enum by its Kotlin entry name (robust to interop casing).
    public init?(_ connection: Shared.Connection) {
        switch connection.name {
        case "Connecting": self = .connecting
        case "Open": self = .open
        case "Reconnecting": self = .reconnecting
        case "Stale": self = .stale
        case "Closed": self = .closed
        default: return nil
        }
    }

    /// Whether last-known values should still be treated as usable.
    public var hasUsableData: Bool {
        switch self {
        case .open, .stale, .reconnecting: true
        case .connecting, .closed: false
        }
    }
}

/// Discriminator over the shared `LiveEvent` taxonomy
/// (`io.teslasync.shared.core.net.sse.LiveEvent`). The strongly-typed payloads
/// stay on the underlying `Shared.LiveEvent`; this kind lets SwiftUI route an
/// event without re-parsing it.
public enum LiveEventKind: Equatable, Sendable {
    case connected
    case heartbeat
    case vehicleUpdate
    case alert
    case exportStatus
    case achievementUnlocked
    case signal
    case unknown
}

/// Swift projection of a shared `LiveEvent`: its SSE `id` plus a routing `kind`,
/// with the original Kotlin event retained for payload access.
public struct LiveEvent {
    public let id: String?
    public let kind: LiveEventKind
    public let raw: Shared.LiveEvent

    public init(_ event: Shared.LiveEvent) {
        id = event.id
        raw = event
        kind = Self.classify(event)
    }

    private static func classify(_ event: Shared.LiveEvent) -> LiveEventKind {
        switch event {
        case is Shared.LiveEventConnected: .connected
        case is Shared.LiveEventHeartbeat: .heartbeat
        case is Shared.LiveEventVehicleUpdate: .vehicleUpdate
        case is Shared.LiveEventAlert: .alert
        case is Shared.LiveEventExportStatus: .exportStatus
        case is Shared.LiveEventAchievementUnlocked: .achievementUnlocked
        case is Shared.LiveEventSignal: .signal
        default: .unknown
        }
    }
}
