import Foundation

/// What a live subscription is scoped to. Each target resolves to a backend SSE
/// path (the resilient client adds the `/api/v1` prefix; see the shared
/// `DEFAULT_SSE_PATH = "/events"`). Targets are vehicle-agnostic at the transport
/// level — the server fans one `/events` pipe out; the typed cases let callers
/// (and the diagnostics log) describe intent and let page-scoped consumers filter.
///
/// Mirrors the web consumers: `useRealtimeEvents` (the global pipe), the
/// notification/command surfaces, and `useLiveSignalStream` (vehicle/field-scoped).
public enum LiveStreamTarget: Equatable, Sendable, Hashable {
    /// The whole fleet/event firehose (`/events`) — vehicle updates, alerts,
    /// export status, achievements. The shared pipe every live surface rides.
    case fleet

    /// Live state for a single vehicle. Page consumers filter the fleet pipe to
    /// this `vehicleID`; the path is unchanged (the server streams all vehicles).
    case vehicle(id: Int64)

    /// A page-scoped signal stream: a vehicle plus the subset of signal fields a
    /// chart/tail cares about (`useLiveSignalStream`). An empty `fields` set means
    /// "all signals for the vehicle".
    case signals(vehicleID: Int64, fields: Set<String>)

    /// The notifications/alerts stream.
    case notifications

    /// Command-status updates for a queued vehicle command.
    case commandStatus(vehicleID: Int64)

    /// The backend SSE path this target subscribes to. The shared SSE client adds
    /// the `/api/v1` prefix, so paths here are prefix-free (ADR rule #7).
    public var path: String {
        // The server multiplexes everything over one `/events` pipe; scope/filter
        // happens client-side. Distinct query scopes are kept so the transport and
        // the diagnostics log can describe intent without leaking precise data.
        switch self {
        case .fleet, .vehicle:
            "/events"
        case .notifications:
            "/events"
        case let .signals(vehicleID, _):
            "/events?vehicle_id=\(vehicleID)"
        case let .commandStatus(vehicleID):
            "/events?vehicle_id=\(vehicleID)"
        }
    }

    /// The vehicle this target is scoped to, if any — used to filter the shared
    /// fleet pipe down to the relevant vehicle for page consumers.
    public var vehicleID: Int64? {
        switch self {
        case .fleet, .notifications:
            nil
        case let .vehicle(id):
            id
        case let .signals(vehicleID, _):
            vehicleID
        case let .commandStatus(vehicleID):
            vehicleID
        }
    }

    /// A short, redaction-safe label for connection diagnostics (never includes a
    /// VIN — the numeric vehicle id is a non-identifying surrogate key).
    public var diagnosticLabel: String {
        switch self {
        case .fleet:
            "fleet"
        case let .vehicle(id):
            "vehicle#\(id)"
        case let .signals(vehicleID, fields):
            "signals#\(vehicleID)(\(fields.count) fields)"
        case .notifications:
            "notifications"
        case let .commandStatus(vehicleID):
            "command-status#\(vehicleID)"
        }
    }
}
