import Foundation

/// A representative local seed used as the `AutomationListPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production data — it is an
/// API-response-shaped fixture (a small fleet of automations spanning enabled / disabled states) so
/// the bulk table renders its populated success state out of the box, mirroring the sibling pages'
/// sample sources. The bulk method echoes a plausible outcome (the production source performs the
/// REST call).
public struct SampleAutomationListDataSource: AutomationListDataSource {
    public init() {}

    public func useAutomations() async throws -> [AutomationListItem] {
        Self.sampleItems
    }

    public func useBulkAutomationsUpdate(
        ids: [Int64],
        op: AutomationBulkOperation
    ) async throws -> AutomationBulkOutcome {
        switch op {
        case .delete: AutomationBulkOutcome(deleted: ids.count)
        case .enable, .disable: AutomationBulkOutcome(updated: ids.count)
        }
    }

    private static let sampleItems: [AutomationListItem] = [
        AutomationListItem(
            id: 1,
            name: "Precondition at 7 AM",
            description: "Warm the cabin before the weekday morning commute",
            vehicleID: 1,
            enabled: true,
            executionCount: 142
        ),
        AutomationListItem(
            id: 2,
            name: "Charge to 80% overnight",
            description: "Cap charging at 80% on weeknights for battery longevity",
            vehicleID: 1,
            enabled: true,
            executionCount: 64
        ),
        AutomationListItem(
            id: 3,
            name: "Lock when away",
            description: "Auto-lock the doors when leaving home",
            vehicleID: 2,
            enabled: false,
            executionCount: 30
        ),
        AutomationListItem(
            id: 4,
            name: "Sentry on departure",
            vehicleID: nil,
            enabled: false,
            executionCount: 12
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
}

#if DEBUG
    /// Preview/test seam yielding zero automations — drives the no-data empty state (web
    /// `automations.length === 0`) with the open-builder CTA.
    public struct EmptyAutomationListDataSource: AutomationListDataSource {
        public init() {}

        public func useAutomations() async throws -> [AutomationListItem] {
            []
        }

        public func useBulkAutomationsUpdate(
            ids _: [Int64],
            op _: AutomationBulkOperation
        ) async throws -> AutomationBulkOutcome {
            AutomationBulkOutcome()
        }
    }

    /// Preview/test seam whose `useAutomations` load fails — drives the page error state.
    public struct FailingAutomationListDataSource: AutomationListDataSource {
        public struct Failure: Error {}
        public init() {}

        public func useAutomations() async throws -> [AutomationListItem] {
            throw Failure()
        }

        public func useBulkAutomationsUpdate(
            ids _: [Int64],
            op _: AutomationBulkOperation
        ) async throws -> AutomationBulkOutcome {
            throw Failure()
        }
    }
#endif
