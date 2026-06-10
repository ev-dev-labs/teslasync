//
//  AlertStudioPage.ViewModel.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The `@Observable` orchestration layer for the AlertStudioPage surface — the native
//  port of the web component's stateful logic. It owns the three read models (rules /
//  channels / metrics), the fleet vehicles, the editor draft + dirty tracking (web
//  `useFormDraft` / `useDirtyForm` / `useNavigationGuard`), the rule + bulk selection,
//  the template browser UI state, the URL-backed rule search (web `useUrlString`), the
//  test-channel selection, and every handler (select / new / clone / signal+operator
//  coercion / save / delete / test / snooze / toggle / bulk). All mutations flow
//  through the `AlertStudioMutator` seam; the view never talks to the network. The
//  dirty-switch + delete confirmations are surfaced as pending state the view presents
//  as native dialogs (web `useConfirm`).
//

import Foundation
import Observation

// MARK: - Draft store seam (web `useFormDraft`)

/// One recovered in-progress new-rule draft (web `useFormDraft` localStorage value).
public struct ASDraft: Sendable, Equatable {
    public let editor: EditorState
    public let savedAt: Date

    public init(editor: EditorState, savedAt: Date) {
        self.editor = editor
        self.savedAt = savedAt
    }
}

/// Persists the in-progress new-rule editor so a tab close / reload / auth redirect
/// doesn't destroy the user's work (web `useFormDraft`). Production injects a
/// `UserDefaults`/file-backed store; previews/tests use `ASInMemoryDraftStore`.
@MainActor
public protocol AlertStudioDraftStore: AnyObject {
    /// The recovered draft for a brand-new rule, if one was persisted.
    func load() -> ASDraft?
    /// Persist the in-progress new-rule editor (web debounced autosave).
    func save(_ editor: EditorState)
    /// Drop the persisted draft (web `discardDraft`).
    func discard()
}

/// In-memory draft store for previews + unit tests. Seeds an optional recovered draft.
@MainActor
public final class ASInMemoryDraftStore: AlertStudioDraftStore {
    public private(set) var saved: EditorState?
    public private(set) var saveCount = 0
    public private(set) var discardCount = 0
    private var recovered: ASDraft?

    public init(recovered: ASDraft? = nil) {
        self.recovered = recovered
    }

    public func load() -> ASDraft? {
        recovered
    }

    public func save(_ editor: EditorState) {
        saved = editor
        saveCount += 1
    }

    public func discard() {
        recovered = nil
        saved = nil
        discardCount += 1
    }
}

// MARK: - Pending switch (web `guardSwitch` targets)

/// A deferred editor switch awaiting the discard confirmation (web `guardSwitch`). When
/// the editor is dirty, the requested switch is parked here until the user confirms.
public enum ASPendingSwitch: Equatable {
    case selectRule(ASAlertRule)
    case newRule
    case cloneTemplate(RuleTemplate)
}

// MARK: - View-model

@MainActor
@Observable
public final class AlertStudioViewModel {
    // Read models (web `useAlertRules` / `useNotificationChannels` / `useAlertMetrics`).
    public let rulesModel: ASRulesModel
    public let channelsModel: ASChannelsModel
    public let metricsModel: ASMetricsModel

    /// Fleet vehicles (web `useVehicles` → `vehicles ?? []`).
    public var vehicles: [ASVehicle]
    /// The AI panels' target vehicle (web `useSelectedVehicle`).
    public var aiVehicleID: Int64?

    // Editor + dirty tracking.
    public internal(set) var editor: EditorState
    var initialEditor: EditorState
    public internal(set) var selectedID: Int64?
    public internal(set) var formError: String?

    // Draft recovery (web `useFormDraft`).
    public internal(set) var hasDraft: Bool
    public internal(set) var draftSavedAt: Date?

    // Selection + browser UI state.
    public internal(set) var bulkSelected: Set<Int64> = []
    public var showTemplates = false
    public var templateSearch = ""
    public var templateCategory: String?
    public var ruleSearch: String
    public internal(set) var testChannelIDs: [Int64]?
    public var snoozeTargetID: Int64?

    // Deferred confirmations (web `useConfirm`).
    public internal(set) var pendingSwitch: ASPendingSwitch?
    public var pendingDelete: ASAlertRule?

    // In-flight mutation flags (web `*.isPending`).
    public internal(set) var savePending = false
    public internal(set) var testPending = false
    public internal(set) var deletePending = false
    public internal(set) var snoozePending = false

    @ObservationIgnored let mutator: any AlertStudioMutator
    @ObservationIgnored let draftStore: any AlertStudioDraftStore
    @ObservationIgnored let localize: ASLocalizer
    @ObservationIgnored let dates: any AlertStudioDateFormatting
    @ObservationIgnored let telemetry: any AlertStudioTelemetry
    @ObservationIgnored let urlSearchSink: @MainActor (String) -> Void

    public init(
        rulesModel: ASRulesModel,
        channelsModel: ASChannelsModel,
        metricsModel: ASMetricsModel,
        vehicles: [ASVehicle] = [],
        aiVehicleID: Int64? = nil,
        mutator: any AlertStudioMutator = OSLogAlertStudioMutator(),
        draftStore: any AlertStudioDraftStore = ASInMemoryDraftStore(),
        localize: ASLocalizer = .bundle,
        dates: any AlertStudioDateFormatting = DefaultAlertStudioDateFormatting(),
        telemetry: any AlertStudioTelemetry = OSLogAlertStudioTelemetry(),
        initialRuleSearch: String = "",
        urlSearchSink: @escaping @MainActor (String) -> Void = { _ in }
    ) {
        self.rulesModel = rulesModel
        self.channelsModel = channelsModel
        self.metricsModel = metricsModel
        self.vehicles = vehicles
        self.aiVehicleID = aiVehicleID
        self.mutator = mutator
        self.draftStore = draftStore
        self.localize = localize
        self.dates = dates
        self.telemetry = telemetry
        ruleSearch = initialRuleSearch
        self.urlSearchSink = urlSearchSink

        let recovered = draftStore.load()
        let startingEditor = recovered?.editor ?? EditorState.fresh()
        editor = startingEditor
        initialEditor = startingEditor
        hasDraft = recovered != nil
        draftSavedAt = recovered?.savedAt
    }

    // MARK: Lifecycle

    public func start() {
        rulesModel.start()
        channelsModel.start()
        metricsModel.start()
        AlertStudioSurface.reportOpen(to: telemetry)
    }

    public func stop() {
        rulesModel.stop()
        channelsModel.stop()
        metricsModel.stop()
    }

    // MARK: Derived state (web memos)

    public var isNewRule: Bool {
        selectedID == nil
    }

    public var isEditing: Bool {
        selectedID != nil
    }

    /// Web `isDirty = JSON.stringify(editor) !== initialEditorRef`.
    public var isDirty: Bool {
        editor != initialEditor
    }

    public var rules: [ASAlertRule] {
        rulesModel.rules
    }

    public var channels: [ASNotificationChannel] {
        channelsModel.channels
    }

    public var metrics: [ASComputedMetricSummary] {
        metricsModel.metrics
    }

    public var allChannelIDs: [Int64] {
        channels.map(\.id)
    }

    /// Web `filteredRules`.
    public var filteredRules: [ASAlertRule] {
        AlertStudioAdapter.filterRules(rules, search: ruleSearch)
    }

    /// Web `filteredTemplates`.
    public var filteredTemplates: [RuleTemplate] {
        AlertStudioAdapter.filterTemplates(
            AlertStudioTemplates.all,
            category: templateCategory,
            search: templateSearch,
            resolvers: ASTemplateResolvers(
                name: templateName(_:),
                message: templateMessage(_:),
                category: templateCategoryLabel(_:)
            )
        )
    }

    /// Web `canSave`.
    public var canSave: Bool {
        AlertStudioAdapter.canSave(editor, isNewRule: isNewRule, metrics: metrics)
    }

    /// Web `recommendedMode`.
    public var recommendedMode: ASTriggerMode {
        AlertStudioAdapter.recommendedTriggerMode(editor.op)
    }

    /// Web `showRecommendBanner`.
    public var showRecommendBanner: Bool {
        isNewRule
            && editor.triggerMode == .unset
            && editor.kind == .signal
            && !editor.signalName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// Web `triggerModeBlocked`.
    public var triggerModeBlocked: Bool {
        isNewRule && editor.triggerMode == .unset
    }

    /// Web `selectedSignal` — the catalog entry, or a synthesized custom one.
    public var selectedSignal: SignalDefinition? {
        if let known = AlertStudioTemplates.signalCatalogByName[editor.signalName] { return known }
        let trimmed = editor.signalName.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return nil }
        return SignalDefinition(
            name: trimmed,
            category: AlertStudioAdapter.customSignalCategory,
            valueType: AlertStudioAdapter.signalTypeForValueKind(editor.valueKind)
        )
    }

    /// Web `selectedSignalType`.
    public var selectedSignalType: ASSignalValueType {
        selectedSignal?.valueType ?? .numeric
    }

    /// Web `operatorSelectOptions` raw ops (labels resolved in the view).
    public var allowedOperators: [ASRuleOp] {
        AlertStudioAdapter.allowedOpsForSignalType(selectedSignalType)
    }

    /// Web `previewVehicleName`.
    public var previewVehicleName: String? {
        AlertStudioAdapter.previewVehicleName(selection: editor.vehicleSelection, vehicles: vehicles)
    }

    /// Web `snoozeTargetRule`.
    public var snoozeTargetRule: ASAlertRule? {
        guard let snoozeTargetID else { return nil }
        return rules.first { $0.id == snoozeTargetID }
    }

    /// Web `snoozeTargetActive`.
    public var snoozeTargetActive: Bool {
        AlertStudioAdapter.isSnoozeActive(snoozeTargetRule?.snoozedUntil)
    }

    // MARK: Template localization (web `getTemplate*`)

    public func templateName(_ template: RuleTemplate) -> String {
        let key = "notifications.alertStudio.templates.\(AlertStudioAdapter.templateKey(template.name)).name"
        return localize.string(ASText(key, template.name))
    }

    public func templateMessage(_ template: RuleTemplate) -> String {
        let key = "notifications.alertStudio.templates.\(AlertStudioAdapter.templateKey(template.name)).message"
        return localize.string(ASText(key, template.message))
    }

    public func templateCategoryLabel(_ category: String) -> String {
        let key = "notifications.alertStudio.templateCategories.\(AlertStudioAdapter.templateKey(category))"
        return localize.string(ASText(key, category))
    }

    /// Web `getSignalCategoryLabel`.
    public func signalCategoryLabel(_ category: String) -> String {
        if category == AlertStudioAdapter.customSignalCategory {
            return localize.string(ASText("notifications.alertStudio.signalCategories.custom", "Custom"))
        }
        return templateCategoryLabel(category)
    }
}
