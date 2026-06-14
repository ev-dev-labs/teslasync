import Foundation
import SwiftUI

// Value types + the data-source seam for the `AutomationBuilderPage` parity surface (web
// `web/src/features/automations/pages/AutomationBuilderPage.tsx`). Everything here is pure +
// Foundation/SwiftUI-only (no networking, no `Shared`) so the form model, the create/update
// payload assembly, and the web `validate()` rules unit-test without a bundle or a view. The
// trigger / condition / action value types are reused from the sibling editor surfaces
// (TriggerConfigurator / ConditionBuilder / ActionBuilder) so the composed editors and this
// page agree on one typed automation graph (DRY, ADR-004).

// MARK: - Mode (web `id` / `?preset=` params)

/// The three ways the builder is entered (web `isEdit` / `presetId` branching): a brand-new
/// automation, a new automation seeded from a preset, or editing an existing automation.
public enum AutomationBuilderMode: Equatable, Sendable {
    case create
    case preset(String)
    case edit(Int64)

    /// Web `isEdit = id != null`.
    public var isEdit: Bool {
        if case .edit = self { return true }
        return false
    }

    /// Web `presetId`.
    public var presetID: String? {
        if case let .preset(id) = self { return id }
        return nil
    }

    /// Web `automationId`.
    public var automationID: Int64? {
        if case let .edit(id) = self { return id }
        return nil
    }

    /// Web per-automation edit-lease key (`automation/{id}` | `automation/preset/{p}` | `automation/new`).
    public var leaseKey: String {
        switch self {
        case let .edit(id): "automation/\(id)"
        case let .preset(presetID): "automation/preset/\(presetID)"
        case .create: "automation/new"
        }
    }
}

// MARK: - Wire value types (web @/api/types)

/// The full automation graph returned by `GET /automations/{id}` and the create/update writes
/// (web `AutomationFull`). The trigger / condition / action arrays reuse the editor value types.
public struct AutomationFull: Identifiable, Sendable, Equatable {
    public let id: Int64
    public let name: String
    public let description: String?
    public let vehicleID: Int64?
    public let enabled: Bool
    public let triggers: [AutomationTrigger]
    public let conditions: [AutomationConditionInput]
    public let actions: [AutomationAction]

    public init(
        id: Int64,
        name: String,
        description: String?,
        vehicleID: Int64?,
        enabled: Bool,
        triggers: [AutomationTrigger],
        conditions: [AutomationConditionInput],
        actions: [AutomationAction]
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.vehicleID = vehicleID
        self.enabled = enabled
        self.triggers = triggers
        self.conditions = conditions
        self.actions = actions
    }
}

/// A typed automation template (web `GET /automations/presets/{id}` → `AutomationPreset`): the
/// pre-filled name/description and the typed trigger / condition / action seeds.
public struct AutomationPreset: Sendable, Equatable {
    public let name: String
    public let description: String
    public let triggers: [AutomationTrigger]
    public let conditions: [AutomationConditionInput]
    public let actions: [AutomationAction]

    public init(
        name: String,
        description: String,
        triggers: [AutomationTrigger],
        conditions: [AutomationConditionInput] = [],
        actions: [AutomationAction] = []
    ) {
        self.name = name
        self.description = description
        self.triggers = triggers
        self.conditions = conditions
        self.actions = actions
    }
}

/// The typed create/update payload (web `AutomationFullInput` → `POST`/`PUT /automations`).
public struct AutomationFullInput: Sendable, Equatable {
    public var name: String
    public var description: String
    public var vehicleID: Int64?
    public var enabled: Bool
    public var triggers: [AutomationTrigger]
    public var conditions: [AutomationConditionInput]
    public var actions: [AutomationAction]

    public init(
        name: String,
        description: String,
        vehicleID: Int64?,
        enabled: Bool,
        triggers: [AutomationTrigger],
        conditions: [AutomationConditionInput],
        actions: [AutomationAction]
    ) {
        self.name = name
        self.description = description
        self.vehicleID = vehicleID
        self.enabled = enabled
        self.triggers = triggers
        self.conditions = conditions
        self.actions = actions
    }
}

/// The identifier returned by a successful create/update write (web `result.id`).
public struct AutomationSaveResult: Sendable, Equatable {
    public let id: Int64

    public init(id: Int64) {
        self.id = id
    }
}

// MARK: - Data-source seam (web hooks — names kept at the Swift call sites)

/// Supplies every datum the builder reads and performs the create/update/test-run writes. The
/// production implementation binds the shared KMP repositories / generated client (ADR-004);
/// previews + tests inject doubles to drive the loading / empty / error / success states. Method
/// names mirror the ported web hooks verbatim so the parity mapping is visible at the call sites.
public protocol AutomationBuilderDataSource: Sendable {
    /// web `useAutomation(id)` → `GET /automations/{id}`
    func useAutomation(id: Int64) async throws -> AutomationFull?
    /// web `useAutomationPreset(id)` → `GET /automations/presets/{id}`
    func useAutomationPreset(id: String) async throws -> AutomationPreset?
    /// web `useVehicles` → `GET /vehicles`
    func useVehicles() async throws -> [AutomationVehicleRef]
    /// web `useNotificationChannels` → `GET /notifications`
    func useNotificationChannels() async throws -> [NotificationChannelSummary]
    /// web `useCreateAutomationFull` → `POST /automations`
    func useCreateAutomationFull(_ input: AutomationFullInput) async throws -> AutomationSaveResult
    /// web `useUpdateAutomationFull` → `PUT /automations/{id}`
    func useUpdateAutomationFull(id: Int64, input: AutomationFullInput) async throws -> AutomationSaveResult
    /// web `useTestRunAutomation` → `POST /automations/{id}/test-run`
    func useTestRunAutomation(id: Int64) async throws
}

// MARK: - Validation (web `validate()`)

/// The first failing form-validation rule (web `validate()` early-returns), each mapped to its
/// `automations.builder.error*` message key so the save-error banner renders localized copy.
public enum AutomationBuilderValidationError: Equatable, Sendable {
    case name
    case trigger
    case triggerPlace
    case conditionPlace
    case actions
    case actionDetails

    /// The `automations.builder.error*` key the banner resolves from `Localizable.xcstrings`.
    public var messageKey: LocalizedStringKey {
        switch self {
        case .name: "automations.builder.errorName"
        case .trigger: "automations.builder.errorTrigger"
        case .triggerPlace: "automations.builder.errorTriggerPlace"
        case .conditionPlace: "automations.builder.errorConditionPlace"
        case .actions: "automations.builder.errorActions"
        case .actionDetails: "automations.builder.errorActionDetails"
        }
    }
}

/// The pure web `validate()` logic, ported over the native value types so it is unit-tested in
/// isolation. Returns the first failing rule (web early-return order) or `nil` when valid.
public enum AutomationBuilderValidation {
    /// Web `triggerNeedsPlace` — a geofence trigger with no place chosen yet.
    public static func triggerNeedsPlace(_ trigger: AutomationTrigger) -> Bool {
        if case let .geofence(placeID, _, _) = trigger { return placeID <= 0 }
        return false
    }

    /// Web `conditionNeedsPlace` — a geofence condition with no place chosen yet.
    public static func conditionNeedsPlace(_ condition: AutomationConditionInput) -> Bool {
        if case let .geofence(geofence) = condition.body { return geofence.placeId <= 0 }
        return false
    }

    /// Web `actionIsIncomplete` — a partially-filled action that cannot be saved.
    public static func actionIsIncomplete(_ action: AutomationAction) -> Bool {
        switch action {
        case let .command(commandName, _):
            commandName.trimmingCharacters(in: .whitespaces).isEmpty
        case let .notify(channelID, template):
            channelID <= 0 || template.trimmingCharacters(in: .whitespaces).isEmpty
        case let .setSetting(key, _):
            key.trimmingCharacters(in: .whitespaces).isEmpty
        case let .callAutomation(targetID):
            targetID <= 0
        }
    }

    /// Web `validate()` — the ordered rule checks; the first failure is surfaced.
    public static func validate(_ form: AutomationBuilderForm) -> AutomationBuilderValidationError? {
        if form.name.trimmingCharacters(in: .whitespaces).isEmpty { return .name }
        if form.trigger == nil { return .trigger }
        if let trigger = form.trigger, triggerNeedsPlace(trigger) { return .triggerPlace }
        if form.conditions.contains(where: conditionNeedsPlace) { return .conditionPlace }
        if form.actions.isEmpty { return .actions }
        if form.actions.contains(where: actionIsIncomplete) { return .actionDetails }
        return nil
    }
}
