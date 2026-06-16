import Foundation

/// Representative local seed used as the `ExplorePage` / preview default until the KMP-backed source
/// is injected at composition time. It is an API-response-shaped fixture (three linked vehicles,
/// ForwardAuth enabled, and a handful of recently visited routes) so the hub renders its populated
/// success state — every section visible, the recent strip present — out of the box.
public struct SampleExploreDataSource: ExploreDataSource {
    public init() {}

    public func useVehicles() async throws -> [ExploreVehicle] {
        [
            ExploreVehicle(id: 1, displayName: "Rocinante"),
            ExploreVehicle(id: 2, displayName: "Tachi"),
            ExploreVehicle(id: 3, displayName: "Razorback")
        ]
    }

    public func useIsForwardAuth() async -> Bool {
        true
    }

    public func recentRoutePaths() async -> [String] {
        [
            AppRoute.charging.path,
            AppRoute.driving.path,
            AppRoute.batteryHealth.path,
            AppRoute.analytics.path
        ]
    }
}

#if DEBUG
    /// Preview/test seam with no linked vehicles and no ForwardAuth — the vehicle-dependent and
    /// privileged features gate out, and the recent strip is hidden, exercising the gated catalog
    /// without collapsing the hub chrome.
    public struct EmptyExploreDataSource: ExploreDataSource {
        public init() {}

        public func useVehicles() async throws -> [ExploreVehicle] {
            []
        }

        public func useIsForwardAuth() async -> Bool {
            false
        }

        public func recentRoutePaths() async -> [String] {
            []
        }
    }

    /// Preview/test seam whose vehicle load fails — drives the retryable error region (web hooks
    /// degrade to empties; the native surface offers a retry instead of a blank hub).
    public struct FailingExploreDataSource: ExploreDataSource {
        public struct Failure: Error {}
        public init() {}

        public func useVehicles() async throws -> [ExploreVehicle] {
            throw Failure()
        }

        public func useIsForwardAuth() async -> Bool {
            false
        }

        public func recentRoutePaths() async -> [String] {
            []
        }
    }
#endif
