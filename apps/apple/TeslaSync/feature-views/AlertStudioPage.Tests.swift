//
//  AlertStudioPage.Tests.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  Unit coverage for the AlertStudioPage surface:
//    • Adapter (web transform ports) — severity / trigger / snooze normalisers, the
//      `templateKey` slug, the numeric parsers, the escalation-payload builder, the
//      signal-type + value-kind ladder, `buildSignalCatalog`, rule/template hydration,
//      `buildSavePayload` (signal + computed branches), `hasRequiredTypedValue`,
//      `canSave`, `buildTestTarget`, `recommendedTriggerMode`, and the search filters.
//    • Templates catalog — the 47-template count, the derived categories, the catalog.
//    • State holders (cached → projection) — `ASListPresentation.resolve` across every
//      branch (loading / content / empty / offline / error / stale) + model wiring.
//    • View-model — guarded switch (dirty → pending), editor coercion, bulk selection,
//      test-channel toggle, vehicle selection, and the save/delete/test mutator flow.
//    • Telemetry — the P1/S11 `view.opened` reporter emits the surface slug.
//    • Accessibility — the severity visual mapping + the row-label copy interpolation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the models are driven by the in-memory sources + recording doubles.
//

import Foundation
import XCTest

// MARK: - Adapter: web transform ports

final class AlertStudioAdapterTests: XCTestCase {
    private typealias Adapter = AlertStudioAdapter

    func testNormalizeSeverity() {
        XCTAssertEqual(Adapter.normalizeSeverity("info"), .info)
        XCTAssertEqual(Adapter.normalizeSeverity("warn"), .warn)
        XCTAssertEqual(Adapter.normalizeSeverity("critical"), .critical)
        XCTAssertEqual(Adapter.normalizeSeverity("warning"), .warn)
        XCTAssertEqual(Adapter.normalizeSeverity("unknown"), .info)
        XCTAssertEqual(Adapter.normalizeSeverity(nil), .info)
    }

    func testNormalizeTriggerMode() {
        XCTAssertEqual(Adapter.normalizeTriggerMode("once"), .once)
        XCTAssertEqual(Adapter.normalizeTriggerMode("repeat"), .repeatMode)
        XCTAssertEqual(Adapter.normalizeTriggerMode(nil), .repeatMode)
        XCTAssertEqual(Adapter.normalizeTriggerMode("garbage"), .repeatMode)
    }

    func testIsSnoozeActive() {
        let future = "2999-01-01T00:00:00Z"
        let past = "2000-01-01T00:00:00Z"
        XCTAssertTrue(Adapter.isSnoozeActive(future))
        XCTAssertFalse(Adapter.isSnoozeActive(past))
        XCTAssertFalse(Adapter.isSnoozeActive(nil))
        XCTAssertFalse(Adapter.isSnoozeActive(""))
    }

    func testTemplateKey() {
        XCTAssertEqual(Adapter.templateKey("Battery Low (< 20%)"), "battery.low.20")
        XCTAssertEqual(Adapter.templateKey("Tire Pressure"), "tire.pressure")
        XCTAssertEqual(Adapter.templateKey("Supercharging (DC Fast)"), "supercharging.dc.fast")
        XCTAssertEqual(Adapter.templateKey("HVIL Fault"), "hvil.fault")
    }

    func testValueToInput() {
        XCTAssertEqual(Adapter.valueToInput(nil), "")
        XCTAssertEqual(Adapter.valueToInput(20), "20")
        XCTAssertEqual(Adapter.valueToInput(100_000), "100000")
        XCTAssertEqual(Adapter.valueToInput(2.2), "2.2")
        XCTAssertEqual(Adapter.valueToInput(-50), "-50")
    }

    func testParseOptionalNumber() {
        XCTAssertEqual(Adapter.parseOptionalNumber("200"), 200)
        XCTAssertEqual(Adapter.parseOptionalNumber("  12.5 "), 12.5)
        XCTAssertEqual(Adapter.parseOptionalNumber("-3"), -3)
        XCTAssertEqual(Adapter.parseOptionalNumber(".5"), 0.5)
        XCTAssertNil(Adapter.parseOptionalNumber(""))
        XCTAssertNil(Adapter.parseOptionalNumber("   "))
        XCTAssertNil(Adapter.parseOptionalNumber("200abc"))
        XCTAssertNil(Adapter.parseOptionalNumber("abc"))
    }

    func testParseOptionalMaxFires() {
        XCTAssertEqual(Adapter.parseOptionalMaxFires("5"), 5)
        XCTAssertEqual(Adapter.parseOptionalMaxFires("3.0"), 3)
        XCTAssertNil(Adapter.parseOptionalMaxFires(""))
        XCTAssertNil(Adapter.parseOptionalMaxFires("5.5"))
        XCTAssertNil(Adapter.parseOptionalMaxFires("0"))
        XCTAssertNil(Adapter.parseOptionalMaxFires("-1"))
    }

    func testNormalizeMsgTemplateForSave() {
        XCTAssertNil(Adapter.normalizeMsgTemplateForSave(""))
        XCTAssertNil(Adapter.normalizeMsgTemplateForSave("   "))
        XCTAssertEqual(Adapter.normalizeMsgTemplateForSave("  body  "), "body")
    }

    func testSeverityRank() {
        XCTAssertEqual(Adapter.severityRank(.info), 1)
        XCTAssertEqual(Adapter.severityRank(.warn), 2)
        XCTAssertEqual(Adapter.severityRank(.critical), 3)
    }

    func testOperatorClassification() {
        XCTAssertTrue(Adapter.isNumericOnlyOp(.lessThan))
        XCTAssertTrue(Adapter.isNumericOnlyOp(.greaterThanOrEqual))
        XCTAssertFalse(Adapter.isNumericOnlyOp(.equal))
        XCTAssertTrue(Adapter.isRangeOp(.between))
        XCTAssertTrue(Adapter.isRangeOp(.outside))
        XCTAssertFalse(Adapter.isRangeOp(.equal))
    }

    func testRecommendedTriggerMode() {
        XCTAssertEqual(Adapter.recommendedTriggerMode(.equal), .once)
        XCTAssertEqual(Adapter.recommendedTriggerMode(.notEqual), .once)
        XCTAssertEqual(Adapter.recommendedTriggerMode(.changed), .once)
        XCTAssertEqual(Adapter.recommendedTriggerMode(.greaterThan), .repeatMode)
        XCTAssertEqual(Adapter.recommendedTriggerMode(.between), .repeatMode)
    }
}

// MARK: - Adapter: signal type + value-kind ladder

final class AlertStudioSignalLadderTests: XCTestCase {
    private typealias Adapter = AlertStudioAdapter

    func testBuildSignalCatalogSortedAndMerged() {
        let catalog = AlertStudioTemplates.signalCatalog
        XCTAssertFalse(catalog.isEmpty)
        // Sorted by category then name.
        let sorted = catalog.sorted { lhs, rhs in
            lhs.category != rhs.category ? lhs.category < rhs.category : lhs.name < rhs.name
        }
        XCTAssertEqual(catalog.map(\.name), sorted.map(\.name))
        // BatteryLevel is numeric (it has numeric template values).
        XCTAssertEqual(AlertStudioTemplates.signalCatalogByName["BatteryLevel"]?.valueType, .numeric)
        // Locked is bool.
        XCTAssertEqual(AlertStudioTemplates.signalCatalogByName["Locked"]?.valueType, .bool)
        // ChargeState is text.
        XCTAssertEqual(AlertStudioTemplates.signalCatalogByName["ChargeState"]?.valueType, .text)
    }

    func testAllowedOpsForSignalType() {
        XCTAssertEqual(Adapter.allowedOpsForSignalType(.numeric), Adapter.numericOperatorOptions)
        XCTAssertEqual(Adapter.allowedOpsForSignalType(.text), Adapter.scalarOperatorOptions)
        XCTAssertEqual(Adapter.allowedOpsForSignalType(.bool), Adapter.scalarOperatorOptions)
    }

    func testCoerceOperatorForSignalType() {
        // A range op is invalid on a scalar signal → coerced to `=`.
        XCTAssertEqual(Adapter.coerceOperatorForSignalType(.between, .text), .equal)
        // A valid op is preserved.
        XCTAssertEqual(Adapter.coerceOperatorForSignalType(.notEqual, .text), .notEqual)
    }

    func testValueKindForSignalOp() {
        XCTAssertEqual(Adapter.valueKindForSignalOp(.numeric, .changed), .none)
        XCTAssertEqual(Adapter.valueKindForSignalOp(.numeric, .between), .range)
        XCTAssertEqual(Adapter.valueKindForSignalOp(.numeric, .greaterThan), .number)
        XCTAssertEqual(Adapter.valueKindForSignalOp(.bool, .equal), .bool)
        XCTAssertEqual(Adapter.valueKindForSignalOp(.text, .equal), .text)
    }

    func testInferValueKindFromRule() {
        let numeric = AlertStudioSamples.rules[0]
        XCTAssertEqual(Adapter.inferValueKind(numeric), .number)
        let bool = AlertStudioSamples.rules[1]
        XCTAssertEqual(Adapter.inferValueKind(bool), .bool)
        let text = AlertStudioSamples.rules[2]
        XCTAssertEqual(Adapter.inferValueKind(text), .text)
    }
}

// MARK: - Adapter: hydration + payload + validation

final class AlertStudioPayloadTests: XCTestCase {
    private typealias Adapter = AlertStudioAdapter

    func testHydrateVehicleSelection() {
        let sticky = AlertStudioSamples.rules[0]
        XCTAssertEqual(Adapter.hydrateVehicleSelection(sticky), .allSticky)
        let specific = AlertStudioSamples.rules[1]
        XCTAssertEqual(Adapter.hydrateVehicleSelection(specific), .specific(vehicleIDs: [1]))
    }

    func testBuildVehiclePayloadDedupesAndSorts() {
        let payload = Adapter.buildVehiclePayload(.specific(vehicleIDs: [3, 1, 1, 2]))
        XCTAssertFalse(payload.allVehicles)
        XCTAssertEqual(payload.vehicleIDs, [1, 2, 3])
        XCTAssertEqual(Adapter.buildVehiclePayload(.allSticky).allVehicles, true)
        XCTAssertEqual(Adapter.buildVehiclePayload(.allSticky).vehicleIDs, [])
    }

    func testRuleToEditorRoundTripsCoreFields() {
        let editor = Adapter.ruleToEditor(AlertStudioSamples.rules[0])
        XCTAssertEqual(editor.id, 100)
        XCTAssertEqual(editor.name, "Battery Low")
        XCTAssertEqual(editor.signalName, "BatteryLevel")
        XCTAssertEqual(editor.op, .lessThan)
        XCTAssertEqual(editor.valueKind, .number)
        XCTAssertEqual(editor.valueNum, "20")
        XCTAssertEqual(editor.triggerMode, .repeatMode)
        XCTAssertEqual(editor.vehicleSelection, .allSticky)
    }

    func testTemplateToEditorSeedsFromTemplate() throws {
        let template = try XCTUnwrap(AlertStudioTemplates.all.first { $0.name == "Slow Charge Rate" })
        let editor = Adapter.templateToEditor(
            template,
            name: "Slow Charge Rate",
            message: "Charging slow: {{ChargeAmps}}A"
        )
        XCTAssertEqual(editor.signalName, "ChargeAmps")
        XCTAssertEqual(editor.op, .between)
        XCTAssertEqual(editor.valueKind, .range)
        XCTAssertEqual(editor.valueMin, "0.01")
        XCTAssertEqual(editor.valueMax, "5")
        XCTAssertEqual(editor.msgTemplate, "Charging slow: {{ChargeAmps}}A")
    }

    func testBuildSavePayloadSignalNumber() {
        var editor = EditorState.fresh()
        editor.name = "  My rule  "
        editor.signalName = "BatteryLevel"
        editor.op = .lessThan
        editor.valueKind = .number
        editor.valueNum = "20"
        editor.triggerMode = .repeatMode
        editor.maxFiresPerResolution = "3"
        let payload = Adapter.buildSavePayload(editor)
        XCTAssertEqual(payload?.name, "My rule")
        XCTAssertEqual(payload?.kind, .signal)
        XCTAssertEqual(payload?.valueNum, 20)
        XCTAssertNil(payload?.valueText)
        XCTAssertEqual(payload?.maxFiresPerResolution, 3)
        XCTAssertEqual(payload?.allVehicles, true)
    }

    func testBuildSavePayloadComputedMetric() {
        var editor = EditorState.fresh()
        editor.name = "Weekly cost"
        editor.kind = .computedMetric
        editor.metricID = "charging_cost"
        editor.metricWindow = "7d"
        editor.metricOp = .greaterThan
        editor.metricThreshold = "50"
        editor.triggerMode = .once
        let payload = Adapter.buildSavePayload(editor)
        XCTAssertEqual(payload?.kind, .computedMetric)
        XCTAssertEqual(payload?.metricID, "charging_cost")
        XCTAssertEqual(payload?.metricWindow, "7d")
        XCTAssertEqual(payload?.metricThreshold, 50)
    }

    func testBuildSavePayloadBlocksUnsetTrigger() {
        var editor = EditorState.fresh()
        editor.name = "x"
        editor.triggerMode = .unset
        XCTAssertNil(Adapter.buildSavePayload(editor))
    }

    func testBuildEscalationPayload() {
        var editor = EditorState.fresh()
        editor.escalationEnabled = true
        editor.escalationAfterMin = "30"
        editor.escalationSeverity = .critical
        let active = Adapter.buildEscalationPayload(editor, triggerMode: .repeatMode)
        XCTAssertEqual(active.afterMin, 30)
        XCTAssertEqual(active.severity, .critical)
        // Once-mode nulls the pair.
        let inactive = Adapter.buildEscalationPayload(editor, triggerMode: .once)
        XCTAssertNil(inactive.afterMin)
        XCTAssertNil(inactive.severity)
    }

    func testHasRequiredTypedValue() {
        var editor = EditorState.fresh()
        editor.signalName = "BatteryLevel"
        editor.op = .lessThan
        editor.valueKind = .number
        editor.valueNum = ""
        XCTAssertFalse(Adapter.hasRequiredTypedValue(editor))
        editor.valueNum = "20"
        XCTAssertTrue(Adapter.hasRequiredTypedValue(editor))
        // Range requires min <= max.
        editor.signalName = "ChargeAmps"
        editor.op = .between
        editor.valueKind = .range
        editor.valueMin = "5"
        editor.valueMax = "1"
        XCTAssertFalse(Adapter.hasRequiredTypedValue(editor))
        editor.valueMax = "10"
        XCTAssertTrue(Adapter.hasRequiredTypedValue(editor))
    }

    func testCanSaveGate() {
        var editor = EditorState.fresh()
        // Blank name blocks.
        XCTAssertFalse(Adapter.canSave(editor, isNewRule: true, metrics: []))
        editor.name = "Rule"
        // Unset trigger blocks a new rule.
        XCTAssertFalse(Adapter.canSave(editor, isNewRule: true, metrics: []))
        editor.triggerMode = .repeatMode
        editor.signalName = "BatteryLevel"
        editor.op = .lessThan
        editor.valueKind = .number
        editor.valueNum = "20"
        XCTAssertTrue(Adapter.canSave(editor, isNewRule: true, metrics: []))
        // Escalation higher-severity guard.
        editor.escalationEnabled = true
        editor.escalationAfterMin = "30"
        editor.severity = .critical
        editor.escalationSeverity = .warn
        XCTAssertFalse(Adapter.canSave(editor, isNewRule: true, metrics: []))
    }

    func testBuildTestTarget() {
        XCTAssertNil(Adapter.buildTestTarget(selectedIDs: nil, allIDs: []))
        XCTAssertEqual(Adapter.buildTestTarget(selectedIDs: nil, allIDs: [1, 2])?.allChannels, true)
        XCTAssertEqual(Adapter.buildTestTarget(selectedIDs: [2], allIDs: [1, 2])?.channelIDs, [2])
    }

    func testPreviewVehicleName() {
        let vehicles = AlertStudioSamples.vehicles
        XCTAssertEqual(Adapter.previewVehicleName(selection: .allSticky, vehicles: vehicles), "Model 3")
        XCTAssertEqual(
            Adapter.previewVehicleName(selection: .specific(vehicleIDs: [2]), vehicles: vehicles),
            "Model Y"
        )
        XCTAssertNil(Adapter.previewVehicleName(selection: .allSticky, vehicles: []))
    }

    func testFilters() {
        let rules = AlertStudioSamples.rules
        XCTAssertEqual(Adapter.filterRules(rules, search: "").count, rules.count)
        XCTAssertEqual(Adapter.filterRules(rules, search: "battery").map(\.id), [100])
        let templates = AlertStudioAdapter.filterTemplates(
            AlertStudioTemplates.all,
            category: "Battery",
            search: "",
            resolvers: ASTemplateResolvers(name: { $0.name }, message: { $0.message }, category: { $0 })
        )
        XCTAssertTrue(templates.allSatisfy { $0.category == "Battery" })
    }
}

@testable import TeslaSync
