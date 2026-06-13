import Foundation

/// A representative local seed used as the `AutomationsListPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production data — it is an
/// API-response-shaped fixture (a small fleet of automations spanning the active / disabled /
/// auto-disabled statuses, two vehicles, a pin, and a live activity feed) so the surface renders
/// its populated success state out of the box, mirroring the sibling pages' sample sources. The
/// mutation methods are reference no-ops (the production source performs the REST calls).
public struct SampleAutomationsListDataSource: AutomationsListDataSource {
    public init() {}

    public func useAutomations() async throws -> [AutomationListItem] {
        Self.sampleItems
    }

    private static let sampleItems: [AutomationListItem] = [
        AutomationListItem(
            id: 1,
            name: "Precondition at 7 AM",
            description: "Warm the cabin before the weekday morning commute",
            vehicleID: 1,
            enabled: true,
            executionCount: 142,
            failureCount: 0,
            lastTriggeredAt: Date(timeIntervalSinceNow: -8 * 60),
            nextFireTime: Date(timeIntervalSinceNow: 16 * 3600)
        ),
        AutomationListItem(
            id: 2,
            name: "Charge to 80% overnight",
            description: "Cap charging at 80% on weeknights for battery longevity",
            vehicleID: 1,
            enabled: true,
            executionCount: 64,
            failureCount: 0,
            lastTriggeredAt: Date(timeIntervalSinceNow: -11 * 3600)
        ),
        AutomationListItem(
            id: 3,
            name: "Lock when away",
            description: "Auto-lock the doors when leaving home",
            vehicleID: 2,
            enabled: false,
            executionCount: 30,
            failureCount: 1,
            lastTriggeredAt: Date(timeIntervalSinceNow: -3 * 24 * 3600)
        ),
        AutomationListItem(
            id: 4,
            name: "Sentry on departure",
            description: "Enable Sentry Mode when parked away from home",
            vehicleID: nil,
            enabled: false,
            autoDisabled: true,
            autoDisabledReason: "Disabled after 5 consecutive failures",
            executionCount: 12,
            failureCount: 5,
            conflicts: [
                AutomationConflictInfo(
                    id: "c1",
                    automationName: "Lock when away",
                    reason: "both act on the doors when you leave",
                    severity: .warning
                )
            ]
        ),
        AutomationListItem(
            id: 5,
            name: "Precondition before sunset",
            description: "Cool the cabin ahead of the evening drive home",
            vehicleID: 2,
            enabled: true,
            executionCount: 8
        )
    ]

    public func useVehicles() async throws -> [AutomationVehicleRef] {
        [
            AutomationVehicleRef(id: 1, displayName: "Rocinante"),
            AutomationVehicleRef(id: 2, displayName: "Tachi")
        ]
    }

    public func usePinned(_: String) async throws -> [AutomationPin] {
        [AutomationPin(itemID: "2", position: 0)]
    }

    public func useAutomationHistory(limit _: Int) async throws -> AutomationLiveFeed? {
        let snapshot = AutomationActivityFeedSnapshot(
            runs: [
                AutomationActivityRun(
                    id: "r1",
                    name: "Precondition at 7 AM",
                    status: .success,
                    triggeredAt: Date(timeIntervalSinceNow: -8 * 60),
                    durationMs: 1840,
                    actionsTotal: 3,
                    actionsSucceeded: 3
                ),
                AutomationActivityRun(
                    id: "r2",
                    name: "Charge to 80% overnight",
                    status: .partial,
                    triggeredAt: Date(timeIntervalSinceNow: -42 * 60),
                    durationMs: 920,
                    actionsTotal: 2,
                    actionsSucceeded: 1
                ),
                AutomationActivityRun(
                    id: "r3",
                    name: "Sentry on departure",
                    status: .failed,
                    error: "Vehicle unreachable",
                    triggeredAt: Date(timeIntervalSinceNow: -3 * 3600),
                    durationMs: 450,
                    actionsTotal: 1,
                    actionsSucceeded: 0
                )
            ],
            stats: AutomationActivityStats(totalRuns: 142, successRate: 93, avgDurationMs: 1320),
            liveEvents: [
                AutomationActivityLiveEvent(
                    id: "ae-1",
                    type: "automation.triggered",
                    automationId: 1,
                    name: "Precondition at 7 AM"
                )
            ],
            connection: .connected
        )
        return AutomationLiveFeed(snapshot: snapshot, firingIDs: [1])
    }

    public func useToggleAutomation(id _: Int64, enabled _: Bool) async throws {}
    public func useReEnableAutomation(id _: Int64) async throws {}
    public func useDeleteAutomation(id _: Int64) async throws {}
    public func useTestRunAutomation(id _: Int64) async throws {}
    public func importAutomations(_: AutomationImportEnvelope) async throws {}
}

#if DEBUG
    /// Preview/test seam yielding zero automations — drives the page's no-data empty state (web
    /// `items.length === 0`) with the create CTA, and an empty activity feed.
    public struct EmptyAutomationsListDataSource: AutomationsListDataSource {
        public init() {}

        public func useAutomations() async throws -> [AutomationListItem] {
            []
        }

        public func useVehicles() async throws -> [AutomationVehicleRef] {
            []
        }

        public func usePinned(_: String) async throws -> [AutomationPin] {
            []
        }

        public func useAutomationHistory(limit _: Int) async throws -> AutomationLiveFeed? {
            AutomationLiveFeed(snapshot: AutomationActivityFeedSnapshot())
        }

        public func useToggleAutomation(id _: Int64, enabled _: Bool) async throws {}
        public func useReEnableAutomation(id _: Int64) async throws {}
        public func useDeleteAutomation(id _: Int64) async throws {}
        public func useTestRunAutomation(id _: Int64) async throws {}
        public func importAutomations(_: AutomationImportEnvelope) async throws {}
    }

    /// Preview/test seam whose primary `useAutomations` load fails — drives the page error state.
    public struct FailingAutomationsListDataSource: AutomationsListDataSource {
        public struct Failure: Error {}
        public init() {}

        public func useAutomations() async throws -> [AutomationListItem] {
            throw Failure()
        }

        public func useVehicles() async throws -> [AutomationVehicleRef] {
            []
        }

        public func usePinned(_: String) async throws -> [AutomationPin] {
            []
        }

        public func useAutomationHistory(limit _: Int) async throws -> AutomationLiveFeed? {
            nil
        }

        public func useToggleAutomation(id _: Int64, enabled _: Bool) async throws {}
        public func useReEnableAutomation(id _: Int64) async throws {}
        public func useDeleteAutomation(id _: Int64) async throws {}
        public func useTestRunAutomation(id _: Int64) async throws {}
        public func importAutomations(_: AutomationImportEnvelope) async throws {}
    }
#endif
