import Foundation

/// A representative in-memory seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production data — it exists so the
/// surface renders its populated state out of the box (mirroring the sibling
/// `SampleFeatureFlagsDataSource`) and so the suspend + endpoint toggles visibly mutate the
/// config in previews. An `actor` so its mutable state stays isolated + `Sendable`. Production
/// replaces it with the settings adapter over the shared core.
public actor SampleFleetAPIDataSource: FleetAPIDataSource {
    private var suspended: Bool
    private var polling: PollingConfig
    private let capture: CaptureStats
    private let version: VersionInfo

    public init() {
        suspended = false
        polling = PollingConfig(flags: Self.seedFlags, retentionDays: 7)
        capture = CaptureStats(
            mongoEnabled: true,
            totalDocuments: 152_340,
            distinctVINs: ["5YJ3E1EA7KF000111", "7SAYGDEE8PF000222"]
        )
        version = VersionInfo(
            chartVersion: "6.4.2",
            goVersion: "go1.25.1",
            os: "linux",
            arch: "amd64",
            endpoints: [
                "api": "https://teslasync.local/api",
                "web": "https://teslasync.local",
                "oauth_callback": "https://teslasync.local/auth/callback",
                "tesla_api": "https://fleet-api.prd.na.vn.cloud.tesla.com"
            ]
        )
    }

    public func load() async throws -> FleetAPISnapshot {
        FleetAPISnapshot(
            settings: FleetAPISettings(apiSuspended: suspended),
            polling: polling,
            capture: capture,
            version: version
        )
    }

    public func setAPISuspended(_ suspended: Bool) async throws {
        self.suspended = suspended
    }

    public func updatePollingConfig(_ config: PollingConfig) async throws {
        polling = config
    }

    /// All 21 toggle keys seeded mostly-on (three off) so the enabled count reads `18/21`.
    static let seedFlags: [String: Bool] = {
        var flags: [String: Bool] = [:]
        for key in FleetAPIPageModel.allEndpointKeys {
            flags[key] = true
        }
        flags["nearby_charging_sites"] = false
        flags["release_notes"] = false
        flags["service_data"] = false
        return flags
    }()
}
