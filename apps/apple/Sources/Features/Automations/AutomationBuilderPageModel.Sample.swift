import Foundation

// Preview / test data sources for `AutomationBuilderPage`. The production app binds the real
// `AutomationBuilderDataSource` over the shared KMP repositories / generated client (ADR-004);
// these in-memory doubles drive the loading / empty / error / success states without networking.

/// A generic failure for the failing double (web TanStack `error`).
public struct AutomationBuilderSampleError: LocalizedError {
    public let message: String
    public init(message: String = "Sample failure") {
        self.message = message
    }

    public var errorDescription: String? {
        message
    }
}

/// Populated double — a sample automation (for edit mode), a preset, vehicles, and channels.
public struct SampleAutomationBuilderDataSource: AutomationBuilderDataSource {
    public init() {}

    public func useAutomation(id: Int64) async throws -> AutomationFull? {
        AutomationFull(
            id: id,
            name: "Morning Precondition",
            description: "Warm the cabin before the commute",
            vehicleID: 1,
            enabled: true,
            triggers: [.signal(SignalTrigger(signal: "battery_level", op: .lessThan, value: .number(40)))],
            conditions: [],
            actions: [.command(commandName: "climate_on", params: nil)]
        )
    }

    public func useAutomationPreset(id _: String) async throws -> AutomationPreset? {
        AutomationPreset(
            name: "Scheduled Preheat",
            description: "Precondition the cabin on a morning schedule",
            triggers: [.schedule(cronExpr: "0 8 * * *", timezone: "UTC")],
            conditions: [],
            actions: [.command(commandName: "climate_on", params: nil)]
        )
    }

    public func useVehicles() async throws -> [AutomationVehicleRef] {
        [
            AutomationVehicleRef(id: 1, displayName: "Model 3"),
            AutomationVehicleRef(id: 2, displayName: "")
        ]
    }

    public func useNotificationChannels() async throws -> [NotificationChannelSummary] {
        [
            NotificationChannelSummary(id: 1, name: "Alerts", kind: .discord, enabled: true),
            NotificationChannelSummary(id: 2, name: "Ops", kind: .slack, enabled: false)
        ]
    }

    public func useCreateAutomationFull(_: AutomationFullInput) async throws -> AutomationSaveResult {
        AutomationSaveResult(id: 101)
    }

    public func useUpdateAutomationFull(id: Int64, input _: AutomationFullInput) async throws -> AutomationSaveResult {
        AutomationSaveResult(id: id)
    }

    public func useTestRunAutomation(id _: Int64) async throws {}
}

/// Empty double — no existing automation (web edit-mode "not found"), no vehicles / channels.
public struct EmptyAutomationBuilderDataSource: AutomationBuilderDataSource {
    public init() {}
    public func useAutomation(id _: Int64) async throws -> AutomationFull? {
        nil
    }

    public func useAutomationPreset(id _: String) async throws -> AutomationPreset? {
        nil
    }

    public func useVehicles() async throws -> [AutomationVehicleRef] {
        []
    }

    public func useNotificationChannels() async throws -> [NotificationChannelSummary] {
        []
    }

    public func useCreateAutomationFull(_: AutomationFullInput) async throws -> AutomationSaveResult {
        AutomationSaveResult(id: 1)
    }

    public func useUpdateAutomationFull(id: Int64, input _: AutomationFullInput) async throws -> AutomationSaveResult {
        AutomationSaveResult(id: id)
    }

    public func useTestRunAutomation(id _: Int64) async throws {}
}

/// Failing double — the automation load throws (web edit-mode `loadError` → retryable error state).
public struct FailingAutomationBuilderDataSource: AutomationBuilderDataSource {
    public init() {}
    public func useAutomation(id _: Int64) async throws -> AutomationFull? {
        throw AutomationBuilderSampleError(message: "Could not load automation")
    }

    public func useAutomationPreset(id _: String) async throws -> AutomationPreset? {
        nil
    }

    public func useVehicles() async throws -> [AutomationVehicleRef] {
        []
    }

    public func useNotificationChannels() async throws -> [NotificationChannelSummary] {
        []
    }

    public func useCreateAutomationFull(_: AutomationFullInput) async throws -> AutomationSaveResult {
        throw AutomationBuilderSampleError(message: "Could not save automation")
    }

    public func useUpdateAutomationFull(
        id _: Int64,
        input _: AutomationFullInput
    ) async throws -> AutomationSaveResult {
        throw AutomationBuilderSampleError(message: "Could not save automation")
    }

    public func useTestRunAutomation(id _: Int64) async throws {}
}
