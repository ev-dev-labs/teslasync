import Foundation

/// ActivityKit attributes for an active **drive / trip-replay status** Live
/// Activity. Live values are SI (speed in m/s, distance in meters, duration in
/// seconds); the widget formats them at the render boundary.
public struct DriveActivityAttributes: Codable, Hashable, Sendable {
    public let vehicleName: String

    public init(vehicleName: String) {
        self.vehicleName = vehicleName
    }

    public struct ContentState: Codable, Hashable, Sendable {
        /// Current speed in meters per second (SI), if known.
        public var speedMps: Double?
        /// Distance travelled so far, in meters (SI).
        public var distanceMeters: Double
        /// Elapsed drive time, in seconds (SI).
        public var durationSeconds: Int
        /// Battery state of charge as a 0…1 fraction.
        public var batteryLevel: Double
        public var destination: String?

        public init(
            speedMps: Double? = nil,
            distanceMeters: Double,
            durationSeconds: Int,
            batteryLevel: Double,
            destination: String? = nil
        ) {
            self.speedMps = speedMps
            self.distanceMeters = distanceMeters
            self.durationSeconds = durationSeconds
            self.batteryLevel = batteryLevel
            self.destination = destination
        }
    }
}

#if os(iOS)
    import ActivityKit

    @available(iOS 16.1, *)
    extension DriveActivityAttributes: ActivityAttributes {}
#endif
