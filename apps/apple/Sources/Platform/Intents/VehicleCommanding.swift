import Foundation

/// A confirmed request to run one vehicle command, enqueued by an intent / menu
/// for the app to execute in the foreground.
///
/// `vehicleID` is the app's **opaque** vehicle identifier (never a VIN) or `nil`
/// to mean "the currently-selected vehicle". `id` is an idempotency key so a
/// re-delivered request is not executed twice.
public struct VehicleCommandRequest: Codable, Equatable, Sendable {
    public let id: String
    public let kind: VehicleCommandKind
    public let vehicleID: String?
    public let requestedAt: Date

    public init(
        id: String = UUID().uuidString,
        kind: VehicleCommandKind,
        vehicleID: String? = nil,
        requestedAt: Date = Date()
    ) {
        self.id = id
        self.kind = kind
        self.vehicleID = vehicleID
        self.requestedAt = requestedAt
    }
}

/// The result of attempting a vehicle command. Carries no PII — `failed` holds a
/// short, already-localizable reason key, never a raw server body.
public enum VehicleCommandOutcome: Equatable, Sendable {
    /// Accepted and dispatched (the app foregrounded to run it).
    case started
    /// Completed successfully.
    case success
    /// No valid session.
    case needsAuthentication
    /// The backend declined the command for this user.
    case notPermitted
    /// No command executor is wired yet (honest default).
    case unavailable
    /// The command failed; `reasonKey` is a localization key, not a raw message.
    case failed(reasonKey: String)

    /// A localization key describing the outcome for a result banner/alert.
    public var messageKey: String {
        switch self {
        case .started: "command.outcome.started"
        case .success: "command.outcome.success"
        case .needsAuthentication: "command.outcome.needsAuth"
        case .notPermitted: "command.outcome.notPermitted"
        case .unavailable: "command.outcome.unavailable"
        case let .failed(reasonKey): reasonKey
        }
    }
}

/// The in-app seam that actually performs a vehicle command against the
/// authenticated facade. Implementations live where the session + networking do
/// (the app process); intents only ever *enqueue* requests via `IntentBridge`.
public protocol VehicleCommanding: Sendable {
    func perform(_ request: VehicleCommandRequest) async -> VehicleCommandOutcome
}

/// The honest default until the command facade is wired: every command reports
/// `.unavailable` rather than silently succeeding.
public struct UnavailableVehicleCommanding: VehicleCommanding {
    public init() {}

    public func perform(_: VehicleCommandRequest) async -> VehicleCommandOutcome {
        .unavailable
    }
}

/// A scriptable executor for previews and tests. Records every request it receives
/// and returns a configurable outcome, so command flows can be asserted without a
/// network or the App Intents runtime.
public final class PreviewVehicleCommanding: VehicleCommanding, @unchecked Sendable {
    private let lock = NSLock()
    private var _received: [VehicleCommandRequest] = []
    private let outcome: VehicleCommandOutcome

    public init(outcome: VehicleCommandOutcome = .success) {
        self.outcome = outcome
    }

    /// Every request handed to `perform`, in order.
    public var received: [VehicleCommandRequest] {
        lock.lock(); defer { lock.unlock() }
        return _received
    }

    public func perform(_ request: VehicleCommandRequest) async -> VehicleCommandOutcome {
        record(request)
        return outcome
    }

    private func record(_ request: VehicleCommandRequest) {
        lock.lock()
        _received.append(request)
        lock.unlock()
    }
}
