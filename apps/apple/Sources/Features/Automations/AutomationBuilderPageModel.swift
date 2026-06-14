import Foundation
import Observation
import SwiftUI

// The `@Observable` state holder for the `AutomationBuilderPage` parity surface (web
// `AutomationBuilderPage.tsx`). Owns the editable automation form, the vehicle + notification-
// channel lookups, the page load phase (web `PageContainer` loading / error / not-found), and the
// save / test-run writes. All data flows through the injected `AutomationBuilderDataSource` — no
// networking in the view (ADR-004). The trigger / condition / action editors compose the sibling
// surfaces, seeded from `form` and writing back through the setters here.

// MARK: - Form state (web `FormState`)

/// The controlled form value (web `FormState`). A single optional `trigger` mirrors the web
/// `triggers[0]` single-trigger UI; the payload re-expands it to a `triggers` array.
public struct AutomationBuilderForm: Sendable, Equatable {
    public var name: String
    public var description: String
    public var vehicleID: Int64?
    public var enabled: Bool
    public var trigger: AutomationTrigger?
    public var conditions: [AutomationConditionInput]
    public var actions: [AutomationAction]

    public init(
        name: String = "",
        description: String = "",
        vehicleID: Int64? = nil,
        enabled: Bool = true,
        trigger: AutomationTrigger? = nil,
        conditions: [AutomationConditionInput] = [],
        actions: [AutomationAction] = [.command(commandName: "climate_on", params: nil)]
    ) {
        self.name = name
        self.description = description
        self.vehicleID = vehicleID
        self.enabled = enabled
        self.trigger = trigger
        self.conditions = conditions
        self.actions = actions
    }

    /// Web `getInitialForm()` — empty name/description, enabled, one default command action.
    public static var initial: AutomationBuilderForm {
        AutomationBuilderForm()
    }
}

// MARK: - Page phase (web `PageContainer` loading / error / not-found / content)

/// The builder's terminal page phase. `.notFound` is the web edit-mode "Automation not found"
/// empty state; `.error` is a retryable load failure (never a blank region, ADR-013).
public enum AutomationBuilderPhase: Equatable, Sendable {
    case loading
    case error(String)
    case notFound
    case ready
}

// MARK: - Page model

@MainActor
@Observable
public final class AutomationBuilderPageModel {
    public let mode: AutomationBuilderMode
    // `internal(set)`: read-only to external callers, mutated by the same-module load/save
    // extension (`AutomationBuilderPageModel.Logic.swift`) and the field setters below.
    public internal(set) var phase: AutomationBuilderPhase
    public internal(set) var form: AutomationBuilderForm = .initial
    public internal(set) var vehicles: [AutomationVehicleRef] = []
    public internal(set) var channels: [NotificationChannelSummary] = []
    public internal(set) var conflicts: [AutomationConflict] = []
    public internal(set) var saveError: String?
    public internal(set) var savedID: Int64?
    public internal(set) var existingName: String?
    public internal(set) var isSaving = false
    public internal(set) var isTestRunning = false
    public internal(set) var testRunStarted = false
    public internal(set) var dirty = false
    /// Web `hasDraft` (restored autosaved draft) — surfaced as the draft-recovery banner.
    public private(set) var hasDraft = false
    /// Web `EditConflictBanner` visibility (a second tab editing the same automation).
    public private(set) var hasEditConflict = false
    /// Bumps whenever the channel list changes so the composed `ActionBuilder` reseeds its model.
    public internal(set) var channelRevision = 0

    @ObservationIgnored let dataSource: any AutomationBuilderDataSource

    public init(
        mode: AutomationBuilderMode,
        dataSource: any AutomationBuilderDataSource,
        hasDraft: Bool = false,
        hasEditConflict: Bool = false
    ) {
        self.mode = mode
        self.dataSource = dataSource
        self.hasDraft = hasDraft
        self.hasEditConflict = hasEditConflict
        phase = mode.isEdit ? .loading : .ready
    }

    // MARK: Derived copy (web title / breadcrumb / button labels)

    /// Web `usePageTitle` (tab title): edit → editTitle, preset → presetTitle, new → createTitle.
    public var pageTitleKey: LocalizedStringKey {
        switch mode {
        case .edit: "automations.builder.editTitle"
        case .preset: "automations.builder.presetTitle"
        case .create: "automations.builder.createTitle"
        }
    }

    /// Web `PageContainer title` (on-page header): edit → editTitle, otherwise → createTitle.
    public var headerTitleKey: LocalizedStringKey {
        mode.isEdit ? "automations.builder.editTitle" : "automations.builder.createTitle"
    }

    /// Web primary button label: edit → save, otherwise → create.
    public var saveButtonKey: LocalizedStringKey {
        mode.isEdit ? "automations.builder.save" : "automations.builder.create"
    }

    /// Web breadcrumb `Edit: {{name}}` — only when editing a loaded automation.
    public var editBreadcrumb: String? {
        guard mode.isEdit, let name = existingName, !name.isEmpty else { return nil }
        return String(format: String(localized: "automations.builder.editBreadcrumb"), name)
    }

    /// Web vehicle option label: the display name, or the `Vehicle {{id}}` fallback.
    public func vehicleLabel(_ vehicle: AutomationVehicleRef) -> String {
        if !vehicle.displayName.isEmpty { return vehicle.displayName }
        return String(format: String(localized: "automations.builder.vehicleFallback"), vehicle.id)
    }

    /// Web Test-Run visibility (`savedId ?? automationId`).
    public var testRunTargetID: Int64? {
        savedID ?? mode.automationID
    }

    /// Web preset-hint panel gate (`!isEdit`).
    public var showsPresetHint: Bool {
        !mode.isEdit
    }

    // MARK: Field setters (web `update(key, value)` — each marks the form dirty)

    public func setName(_ value: String) {
        form.name = value; dirty = true
    }

    public func setDescription(_ value: String) {
        form.description = value; dirty = true
    }

    public func setVehicle(_ value: Int64?) {
        form.vehicleID = value; dirty = true
    }

    public func setEnabled(_ value: Bool) {
        form.enabled = value; dirty = true
    }

    public func setConditions(_ value: [AutomationConditionInput]) {
        form.conditions = value; dirty = true
    }

    public func setActions(_ value: [AutomationAction]) {
        form.actions = value; dirty = true
    }

    /// Web `onChange` from the trigger configurator — replace the edited trigger.
    public func setTrigger(_ trigger: AutomationTrigger) {
        form.trigger = trigger; dirty = true
    }

    /// Web `handleTriggerKindChange` — seed a default trigger for the picked kind (or clear it).
    public func setTriggerKind(_ kind: TriggerKind?) {
        form.trigger = kind.map(AutomationTrigger.createDefault)
        dirty = true
    }

    public func clearSaveError() {
        saveError = nil
    }

    public func markTestRunSeen() {
        testRunStarted = false
    }

    /// Web `DraftRecoveryBanner` discard (`discardDraft(); setDirty(false)`).
    public func discardDraft() {
        hasDraft = false
        dirty = false
    }

    /// Web `EditConflictBanner` reload affordance — dismiss the conflict notice.
    public func dismissEditConflict() {
        hasEditConflict = false
    }
}
