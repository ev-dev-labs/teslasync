import Foundation

/// The display state derived from the cached vehicle summary — the watch's coarse
/// "what is the car doing" badge. `unknown` is shown honestly when nothing is
/// cached yet rather than guessing.
public enum WatchVehicleState: String, Equatable, Sendable {
    case charging
    case plugged
    case parked
    case unknown

    public init(snapshot: TeslaSyncWidgetSnapshot?) {
        guard let vehicle = snapshot?.vehicle else {
            self = .unknown
            return
        }
        if vehicle.isCharging {
            self = .charging
        } else if vehicle.isPluggedIn {
            self = .plugged
        } else {
            self = .parked
        }
    }

    /// Localization key for the state label (reuses the widget's parked/plugged/
    /// charging keys so phone and watch stay in lockstep).
    public var titleKey: String {
        switch self {
        case .charging: "widget.vehicle.charging"
        case .plugged: "widget.vehicle.plugged"
        case .parked: "widget.vehicle.parked"
        case .unknown: "watch.state.unknown"
        }
    }

    public var systemImage: String {
        switch self {
        case .charging: "bolt.fill"
        case .plugged: "powerplug.fill"
        case .parked: "parkingsign"
        case .unknown: "questionmark.circle"
        }
    }
}

/// A flattened, already-display-formatted view model the watch glance binds to.
/// All strings arrive pre-converted to the user's units from the phone (ADR-016),
/// so the watch performs no SI conversion. `init?` returns `nil` when there is no
/// cached vehicle, which the UI renders as its honest empty/offline state.
public struct WatchGlanceData: Equatable, Sendable {
    public let vehicleName: String
    public let batteryFraction: Double
    public let batteryDisplay: String
    public let rangeDisplay: String
    public let state: WatchVehicleState
    public let isCharging: Bool
    public let chargeFinishBy: Date?
    public let chargeAddedDisplay: String?
    public let isLocked: Bool?
    public let isClimateOn: Bool?
    public let isSentryOn: Bool?
    public let insideTempDisplay: String?
    public let locationLabel: String?

    public init?(snapshot: TeslaSyncWidgetSnapshot?) {
        guard let snapshot, let vehicle = snapshot.vehicle else { return nil }
        vehicleName = vehicle.vehicleName
        batteryFraction = vehicle.batteryFraction
        batteryDisplay = vehicle.batteryDisplay
        rangeDisplay = vehicle.rangeDisplay
        state = WatchVehicleState(snapshot: snapshot)
        isCharging = vehicle.isCharging
        chargeFinishBy = snapshot.charging?.isActive == true ? snapshot.charging?.finishBy : nil
        chargeAddedDisplay = snapshot.charging?.isActive == true ? snapshot.charging?.addedDisplay : nil
        isLocked = snapshot.climateSecurity?.isLocked
        isClimateOn = snapshot.climateSecurity?.isClimateOn
        isSentryOn = snapshot.climateSecurity?.isSentryOn
        insideTempDisplay = snapshot.climateSecurity?.insideTempDisplay
        locationLabel = vehicle.locationLabel
    }
}
