import Foundation

/// ActivityKit attributes for an ongoing **charging** session Live Activity. The
/// static `vehicleName` is fixed for the session; the live values live in
/// `ContentState`. All measurements are SI (battery as a 0…1 fraction, range in
/// meters, power in watts) — the widget formats at the render boundary.
///
/// The `ActivityAttributes` conformance is added only where ActivityKit exists
/// (iOS 16.1+); on macOS / unsupported OSes the plain struct still compiles so the
/// controller's seam and tests are platform-agnostic.
public struct ChargingActivityAttributes: Codable, Hashable, Sendable {
    public let vehicleName: String

    public init(vehicleName: String) {
        self.vehicleName = vehicleName
    }

    public struct ContentState: Codable, Hashable, Sendable {
        /// Battery state of charge as a 0…1 fraction.
        public var batteryLevel: Double
        /// The session's target charge limit as a 0…1 fraction.
        public var chargeLimit: Double
        /// Instantaneous charge power in watts (SI), if known.
        public var powerW: Double?
        /// Rated range added so far, in meters (SI), if known.
        public var addedRangeMeters: Double?
        /// Projected finish time, for an ActivityKit live timer, if known.
        public var finishBy: Date?
        public var isCharging: Bool

        public init(
            batteryLevel: Double,
            chargeLimit: Double,
            powerW: Double? = nil,
            addedRangeMeters: Double? = nil,
            finishBy: Date? = nil,
            isCharging: Bool = true
        ) {
            self.batteryLevel = batteryLevel
            self.chargeLimit = chargeLimit
            self.powerW = powerW
            self.addedRangeMeters = addedRangeMeters
            self.finishBy = finishBy
            self.isCharging = isCharging
        }
    }
}

#if os(iOS)
    import ActivityKit

    @available(iOS 16.1, *)
    extension ChargingActivityAttributes: ActivityAttributes {}
#endif
