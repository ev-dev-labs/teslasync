//
//  AlertStudioPage.Adapter.Logic.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The pure projection core for the AlertStudioPage surface (part 2) — the
//  vehicle-selection hydration + wire builder, the rule→editor + template→editor
//  hydration, the typed-value + computed-metric + `canSave` validation gates, the
//  `buildSavePayload` wire builder, the test-target builder, the `recommendedTriggerMode`
//  smart default, the template / rule search filters, and the preview vehicle-name
//  resolver. Kept apart from the core enum (AlertStudioPage.Adapter.swift) for the lint
//  length budget. No SwiftUI and no I/O.
//

import Foundation

public extension AlertStudioAdapter {
    // MARK: - Vehicle selection (web `hydrateVehicleSelection` / `buildVehiclePayload`)

    /// Web `hydrateVehicleSelection(rule)`.
    static func hydrateVehicleSelection(_ rule: ASAlertRule) -> ASVehicleSelection {
        if let allVehicles = rule.allVehicles {
            if allVehicles { return .allSticky }
            return .specific(vehicleIDs: dedupSort(rule.vehicleIDs ?? []))
        }
        guard let legacy = rule.vehicleID else { return .allSticky }
        return .specific(vehicleIDs: [legacy])
    }

    /// Web `buildVehiclePayload(sel)`: always emits both `all_vehicles` + `vehicle_ids`,
    /// deduped + sorted (Decision D14).
    static func buildVehiclePayload(_ selection: ASVehicleSelection) -> ASVehiclePayload {
        switch selection {
        case .allSticky: ASVehiclePayload(allVehicles: true, vehicleIDs: [])
        case let .specific(ids): ASVehiclePayload(allVehicles: false, vehicleIDs: dedupSort(ids))
        }
    }

    internal static func dedupSort(_ ids: [Int64]) -> [Int64] {
        Array(Set(ids)).sorted()
    }

    // MARK: - Hydration (web `ruleToEditor` / `templateToEditor`)

    /// Web `ruleToEditor(rule)`: hydrate the editor from a persisted rule.
    static func ruleToEditor(_ rule: ASAlertRule) -> EditorState {
        EditorState(
            id: rule.id,
            name: rule.name,
            enabled: rule.enabled,
            vehicleSelection: hydrateVehicleSelection(rule),
            signalName: rule.signalName,
            op: rule.op,
            valueKind: inferValueKind(rule),
            valueNum: valueToInput(rule.valueNum),
            valueText: rule.valueText ?? "",
            valueBool: rule.valueBool ?? true,
            valueMin: valueToInput(rule.valueMin),
            valueMax: valueToInput(rule.valueMax),
            severity: normalizeSeverity(rule.severity.rawValue),
            cooldownMin: rule.cooldownMin,
            triggerMode: rule.triggerMode == .once ? .once : .repeatMode,
            maxFiresPerResolution: rule.maxFiresPerResolution.map(String.init) ?? "",
            escalationEnabled: rule.escalationAfterMin != nil && rule.escalationSeverity != nil,
            escalationAfterMin: rule.escalationAfterMin.map(String.init) ?? "",
            escalationSeverity: rule.escalationSeverity,
            message: rule.signalName.isEmpty ? "" : "\(rule.name): {{\(rule.signalName)}}",
            msgTemplate: rule.msgTemplate ?? "",
            includeTitle: rule.includeTitle ?? true,
            kind: rule.kind ?? .signal,
            metricID: rule.metricID ?? "",
            metricWindow: rule.metricWindow ?? "",
            metricOp: rule.metricOp ?? .greaterThan,
            metricThreshold: valueToInput(rule.metricThreshold)
        )
    }

    /// Web `templateToEditor(template, name, message)`: seed a fresh editor from a curated
    /// template (resolved name + message supplied by the localizer).
    static func templateToEditor(_ template: RuleTemplate, name: String, message: String) -> EditorState {
        var editor = EditorState.fresh()
        editor.name = name
        editor.signalName = template.signalName
        editor.op = template.op
        editor.valueKind = inferTemplateValueKind(template)
        editor.valueNum = valueToInput(template.valueNum)
        editor.valueText = template.valueText ?? ""
        editor.valueBool = template.valueBool ?? true
        editor.valueMin = valueToInput(template.valueMin)
        editor.valueMax = valueToInput(template.valueMax)
        editor.severity = template.severity
        editor.cooldownMin = template.cooldownMin
        editor.message = message
        editor.msgTemplate = message
        editor.includeTitle = true
        return editor
    }

    // MARK: - Validation (web `hasRequiredTypedValue` / `hasComputedMetricInputs` / `canSave`)

    /// Web `hasRequiredTypedValue(state)`.
    static func hasRequiredTypedValue(_ state: EditorState) -> Bool {
        switch valueKindForState(state) {
        case .none: return state.op == .changed
        case .bool: return true
        case .text: return !state.valueText.trimmingCharacters(in: .whitespaces).isEmpty
        case .number: return parseOptionalNumber(state.valueNum) != nil
        case .range:
            guard let lower = parseOptionalNumber(state.valueMin),
                  let upper = parseOptionalNumber(state.valueMax)
            else {
                return false
            }
            return lower <= upper
        }
    }

    /// Web `hasComputedMetricInputs(state, metrics)`.
    static func hasComputedMetricInputs(_ state: EditorState, metrics: [ASComputedMetricSummary]) -> Bool {
        if state.metricID.isEmpty || state.metricWindow.isEmpty { return false }
        if parseOptionalNumber(state.metricThreshold) == nil { return false }
        guard let def = metrics.first(where: { $0.id == state.metricID }) else { return false }
        if !def.windows.contains(state.metricWindow) { return false }
        if !def.ops.contains(state.metricOp) { return false }
        return true
    }

    /// The escalation arm of `canSave` (web escalation guards). `true` when escalation is
    /// off, or on + repeat-mode + a parseable after-minutes + a strictly-higher severity.
    static func escalationValidForSave(_ editor: EditorState) -> Bool {
        guard editor.escalationEnabled else { return true }
        if editor.triggerMode != .repeatMode { return false }
        if parseOptionalMaxFires(editor.escalationAfterMin) == nil { return false }
        guard let escSeverity = editor.escalationSeverity else { return false }
        return severityRank(escSeverity) > severityRank(editor.severity)
    }

    /// The computed-metric arm of `canSave`.
    static func computedMetricValidForSave(_ editor: EditorState, metrics: [ASComputedMetricSummary]) -> Bool {
        if editor.metricID.isEmpty || editor.metricWindow.isEmpty { return false }
        if parseOptionalNumber(editor.metricThreshold) == nil { return false }
        if !metrics.isEmpty, !hasComputedMetricInputs(editor, metrics: metrics) { return false }
        return true
    }

    /// Web `canSave` memo: every guard that blocks the Save button.
    static func canSave(_ editor: EditorState, isNewRule: Bool, metrics: [ASComputedMetricSummary]) -> Bool {
        if editor.name.trimmingCharacters(in: .whitespaces).isEmpty { return false }
        if editor.cooldownMin <= 0 { return false }
        if isNewRule, editor.triggerMode == .unset { return false }
        if case let .specific(ids) = editor.vehicleSelection, ids.isEmpty { return false }
        if !escalationValidForSave(editor) { return false }
        if editor.kind == .computedMetric { return computedMetricValidForSave(editor, metrics: metrics) }
        return !editor.signalName.trimmingCharacters(in: .whitespaces).isEmpty
            && isOperatorAllowedForState(editor)
            && hasRequiredTypedValue(editor)
    }

    // MARK: - Save payload (web `buildSavePayload`)

    /// Web `buildSavePayload(state)`. Precondition: `trigger_mode` has been chosen
    /// (`canSave` blocks otherwise); returns `nil` if still unset rather than throwing, so
    /// the view-model can treat it as "not ready" without a crash.
    static func buildSavePayload(_ state: EditorState) -> ASAlertRuleInput? {
        guard let triggerMode = state.triggerMode.mode else { return nil }
        let vehicle = buildVehiclePayload(state.vehicleSelection)
        let escalation = buildEscalationPayload(state, triggerMode: triggerMode)
        if state.kind == .computedMetric {
            return computedPayload(state, triggerMode: triggerMode, vehicle: vehicle, escalation: escalation)
        }
        return signalPayload(state, triggerMode: triggerMode, vehicle: vehicle, escalation: escalation)
    }

    private static func computedPayload(
        _ state: EditorState,
        triggerMode: ASTriggerMode,
        vehicle: ASVehiclePayload,
        escalation: (afterMin: Int?, severity: ASSeverity?)
    ) -> ASAlertRuleInput {
        ASAlertRuleInput(
            id: state.id,
            name: state.name.trimmingCharacters(in: .whitespaces),
            enabled: state.enabled,
            allVehicles: vehicle.allVehicles,
            vehicleIDs: vehicle.vehicleIDs,
            severity: state.severity,
            cooldownMin: state.cooldownMin,
            triggerMode: triggerMode,
            kind: .computedMetric,
            includeTitle: state.includeTitle,
            maxFiresPerResolution: parseOptionalMaxFires(state.maxFiresPerResolution),
            escalationAfterMin: escalation.afterMin,
            escalationSeverity: escalation.severity,
            metricID: state.metricID.isEmpty ? nil : state.metricID,
            metricWindow: state.metricWindow.isEmpty ? nil : state.metricWindow,
            metricOp: state.metricOp,
            metricThreshold: parseOptionalNumber(state.metricThreshold),
            msgTemplate: normalizeMsgTemplateForSave(state.msgTemplate)
        )
    }

    private static func signalPayload(
        _ state: EditorState,
        triggerMode: ASTriggerMode,
        vehicle: ASVehiclePayload,
        escalation: (afterMin: Int?, severity: ASSeverity?)
    ) -> ASAlertRuleInput {
        var payload = ASAlertRuleInput(
            id: state.id,
            name: state.name.trimmingCharacters(in: .whitespaces),
            enabled: state.enabled,
            allVehicles: vehicle.allVehicles,
            vehicleIDs: vehicle.vehicleIDs,
            severity: state.severity,
            cooldownMin: state.cooldownMin,
            triggerMode: triggerMode,
            kind: .signal,
            includeTitle: state.includeTitle,
            signalName: state.signalName.trimmingCharacters(in: .whitespaces),
            op: state.op,
            maxFiresPerResolution: parseOptionalMaxFires(state.maxFiresPerResolution),
            escalationAfterMin: escalation.afterMin,
            escalationSeverity: escalation.severity,
            msgTemplate: normalizeMsgTemplateForSave(state.msgTemplate)
        )
        switch valueKindForState(state) {
        case .number: payload.valueNum = parseOptionalNumber(state.valueNum)
        case .text: payload.valueText = state.valueText.trimmingCharacters(in: .whitespaces)
        case .bool: payload.valueBool = state.valueBool
        case .range:
            payload.valueMin = parseOptionalNumber(state.valueMin)
            payload.valueMax = parseOptionalNumber(state.valueMax)
        case .none: break
        }
        return payload
    }

    // MARK: - Test target + smart default (web `buildTestTarget` / `recommendedTriggerMode`)

    /// Web `buildTestTarget(selectedIds, allIds)`.
    static func buildTestTarget(selectedIDs: [Int64]?, allIDs: [Int64]) -> ASAlertTestTarget? {
        if allIDs.isEmpty { return nil }
        guard let selectedIDs else { return ASAlertTestTarget(allChannels: true) }
        return ASAlertTestTarget(channelIDs: selectedIDs)
    }

    /// Web `recommendedTriggerMode(op)`: `once` for state-confirmation operators, `repeat`
    /// for threshold/safety operators.
    static func recommendedTriggerMode(_ op: ASRuleOp) -> ASTriggerMode {
        switch op {
        case .equal, .notEqual, .changed: .once
        case .lessThan, .lessThanOrEqual, .greaterThan, .greaterThanOrEqual, .between, .outside: .repeatMode
        }
    }

    // MARK: - Search filters + preview (web `filteredTemplates` / `filteredRules`)

    /// Web `filteredTemplates`: optional category filter + case-insensitive search over the
    /// resolved name / message / category label.
    static func filterTemplates(
        _ templates: [RuleTemplate],
        category: String?,
        search: String,
        resolvers: ASTemplateResolvers
    ) -> [RuleTemplate] {
        var list = templates
        if let category { list = list.filter { $0.category == category } }
        let query = search.lowercased()
        if !query.isEmpty {
            list = list.filter { template in
                resolvers.name(template).lowercased().contains(query)
                    || resolvers.message(template).lowercased().contains(query)
                    || resolvers.category(template.category).lowercased().contains(query)
            }
        }
        return list
    }

    /// Web `filteredRules`: case-insensitive search over the rule name.
    static func filterRules(_ rules: [ASAlertRule], search: String) -> [ASAlertRule] {
        let query = search.lowercased()
        if query.isEmpty { return rules }
        return rules.filter { $0.name.lowercased().contains(query) }
    }

    /// Web `previewVehicleName`: the first explicitly-selected vehicle's display name, else
    /// the first fleet vehicle's, else `nil`.
    static func previewVehicleName(selection: ASVehicleSelection, vehicles: [ASVehicle]) -> String? {
        guard case let .specific(ids) = selection, let firstID = ids.first else {
            return vehicles.first?.displayName
        }
        if let match = vehicles.first(where: { $0.id == firstID }), !match.displayName.isEmpty {
            return match.displayName
        }
        return vehicles.first?.displayName
    }
}
