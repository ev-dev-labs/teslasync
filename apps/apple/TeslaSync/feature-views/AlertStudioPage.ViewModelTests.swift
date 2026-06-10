//
//  AlertStudioPage.ViewModelTests.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  Unit coverage for the AlertStudioPage surface (part 2): the templates catalog, the
//  `ASListPresentation` state projection, the read-model wiring, the view-model handlers
//  (guarded switch / coercion / bulk / test-channel / save-delete-test mutator flow), the
//  P1/S11 telemetry reporter, and the accessibility mapping. Run with in-memory sources +
//  recording doubles.
//

import Foundation
import XCTest

// MARK: - Templates catalog

final class AlertStudioTemplatesTests: XCTestCase {
    func testTemplateCount() {
        XCTAssertEqual(AlertStudioTemplates.all.count, 47)
    }

    func testCategoriesSortedAndComplete() {
        XCTAssertEqual(AlertStudioTemplates.categories, AlertStudioTemplates.categories.sorted())
        XCTAssertTrue(AlertStudioTemplates.categories.contains("Battery"))
        XCTAssertTrue(AlertStudioTemplates.categories.contains("Tire Pressure"))
        XCTAssertEqual(Set(AlertStudioTemplates.all.map(\.category)).count, AlertStudioTemplates.categories.count)
    }
}

// MARK: - State holder projection

final class AlertStudioPresentationTests: XCTestCase {
    func testLoadingNoCache() {
        let snapshot = ASListSnapshot<ASAlertRule>(status: .loading)
        XCTAssertEqual(ASListPresentation.resolve(snapshot), .loading)
    }

    func testLoadingWithCacheShowsContent() {
        let snapshot = ASListSnapshot(status: .loading, items: AlertStudioSamples.rules, connection: .stale)
        if case let .content(items, connection, refreshing) = ASListPresentation.resolve(snapshot) {
            XCTAssertEqual(items.count, AlertStudioSamples.rules.count)
            XCTAssertEqual(connection, .stale)
            XCTAssertTrue(refreshing)
        } else {
            XCTFail("expected content")
        }
    }

    func testLoadedEmptyFolds() {
        let snapshot = ASListSnapshot<ASAlertRule>(status: .loaded, items: [])
        XCTAssertEqual(ASListPresentation.resolve(snapshot), .empty(.live))
    }

    func testFailedOfflineNoCache() {
        let snapshot = ASListSnapshot<ASAlertRule>(status: .failed, error: .offline)
        XCTAssertEqual(ASListPresentation.resolve(snapshot), .offlineNoData)
    }

    func testFailedRetryableNoCache() {
        let snapshot = ASListSnapshot<ASAlertRule>(status: .failed, error: .network(message: "500"))
        XCTAssertEqual(ASListPresentation.resolve(snapshot), .error(retryable: true))
    }

    func testFailedWithCacheStaysVisibleStale() {
        let snapshot = ASListSnapshot(status: .failed, items: AlertStudioSamples.rules, error: .decode(message: "x"))
        if case let .content(_, connection, _) = ASListPresentation.resolve(snapshot) {
            XCTAssertEqual(connection, .stale)
        } else {
            XCTFail("expected cached content")
        }
    }
}

// MARK: - Models

@MainActor
final class AlertStudioModelTests: XCTestCase {
    func testRulesModelStartPushesInitial() {
        let source = ASInMemoryRulesSource(initial: .loaded(AlertStudioSamples.rules))
        let model = ASRulesModel(source: source)
        model.start()
        XCTAssertEqual(model.rules.count, AlertStudioSamples.rules.count)
        XCTAssertEqual(source.startCount, 1)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testMetricsModelLoadingFlag() {
        let model = ASMetricsModel(preview: ASListSnapshot(status: .loading))
        XCTAssertTrue(model.isLoading)
        let loaded = ASMetricsModel(preview: .loaded(AlertStudioSamples.metrics))
        XCTAssertFalse(loaded.isLoading)
        XCTAssertEqual(loaded.metrics.count, 2)
    }
}

// MARK: - View-model

@MainActor
final class AlertStudioViewModelTests: XCTestCase {
    private func makeViewModel(
        mutator: any AlertStudioMutator = OSLogAlertStudioMutator()
    ) -> AlertStudioViewModel {
        AlertStudioViewModel(
            rulesModel: ASRulesModel(preview: .loaded(AlertStudioSamples.rules)),
            channelsModel: ASChannelsModel(preview: .loaded(AlertStudioSamples.channels)),
            metricsModel: ASMetricsModel(preview: .loaded(AlertStudioSamples.metrics)),
            vehicles: AlertStudioSamples.vehicles,
            mutator: mutator,
            localize: .echo
        )
    }

    func testSelectRuleHydratesEditorWhenClean() {
        let viewModel = makeViewModel()
        viewModel.requestSelectRule(AlertStudioSamples.rules[1])
        XCTAssertEqual(viewModel.selectedID, 101)
        XCTAssertEqual(viewModel.editor.signalName, "Locked")
        XCTAssertFalse(viewModel.isDirty)
        XCTAssertNil(viewModel.pendingSwitch)
    }

    func testGuardedSwitchParksWhenDirty() {
        let viewModel = makeViewModel()
        viewModel.updateEditor { $0.name = "dirty" }
        XCTAssertTrue(viewModel.isDirty)
        viewModel.requestNewRule()
        // Parked, not applied.
        XCTAssertEqual(viewModel.pendingSwitch, .newRule)
        XCTAssertEqual(viewModel.editor.name, "dirty")
        // Confirm applies it.
        viewModel.confirmDiscardSwitch()
        XCTAssertNil(viewModel.pendingSwitch)
        XCTAssertEqual(viewModel.editor.name, "")
    }

    func testCancelDiscardKeepsEditing() {
        let viewModel = makeViewModel()
        viewModel.updateEditor { $0.name = "dirty" }
        viewModel.requestNewRule()
        viewModel.cancelDiscardSwitch()
        XCTAssertNil(viewModel.pendingSwitch)
        XCTAssertEqual(viewModel.editor.name, "dirty")
    }

    func testSignalChangeCoercesOperatorAndValueKind() {
        let viewModel = makeViewModel()
        viewModel.updateEditor { $0.op = .between }
        viewModel.handleSignalChange("Locked")
        // Locked is bool → range op coerced to `=`, value kind bool.
        XCTAssertEqual(viewModel.editor.op, .equal)
        XCTAssertEqual(viewModel.editor.valueKind, .bool)
    }

    func testSeverityChangeDropsInvalidEscalation() {
        let viewModel = makeViewModel()
        viewModel.updateEditor {
            $0.severity = .warn
            $0.escalationSeverity = .critical
        }
        viewModel.handleSeverityChange(.critical)
        // Escalation (critical) no longer strictly higher than base (critical) → cleared.
        XCTAssertNil(viewModel.editor.escalationSeverity)
    }

    func testTriggerModeOnceClearsEscalation() {
        let viewModel = makeViewModel()
        viewModel.updateEditor {
            $0.escalationEnabled = true
            $0.escalationAfterMin = "30"
            $0.escalationSeverity = .critical
        }
        viewModel.handleTriggerModeChange(.once)
        XCTAssertFalse(viewModel.editor.escalationEnabled)
        XCTAssertEqual(viewModel.editor.escalationAfterMin, "")
        XCTAssertNil(viewModel.editor.escalationSeverity)
    }

    func testBulkSelectionToggleAndPrune() {
        let viewModel = makeViewModel()
        viewModel.toggleBulkSelected(100, true)
        viewModel.toggleBulkSelected(101, true)
        XCTAssertEqual(viewModel.bulkSelected, [100, 101])
        viewModel.setRuleSearch("battery") // only rule 100 visible → 101 pruned
        XCTAssertEqual(viewModel.bulkSelected, [100])
    }

    func testTestChannelToggle() {
        let viewModel = makeViewModel()
        // Default: all selected (nil).
        XCTAssertTrue(viewModel.isTestChannelSelected(10))
        viewModel.toggleTestChannel(10) // deselect one → explicit subset
        XCTAssertFalse(viewModel.isTestChannelSelected(10))
        XCTAssertTrue(viewModel.isTestChannelSelected(11))
    }

    func testVehicleSelectionHelpers() {
        let viewModel = makeViewModel()
        XCTAssertTrue(viewModel.isAllVehicles)
        viewModel.toggleVehicle(1)
        XCTAssertFalse(viewModel.isAllVehicles)
        XCTAssertTrue(viewModel.isVehicleSelected(1))
        viewModel.toggleVehicle(1)
        XCTAssertTrue(viewModel.vehicleSelectionEmpty)
    }

    func testShowRecommendBannerAndForceChoose() {
        let viewModel = makeViewModel()
        viewModel.updateEditor {
            $0.kind = .signal
            $0.signalName = "BatteryLevel"
            $0.triggerMode = .unset
        }
        XCTAssertTrue(viewModel.showRecommendBanner)
        XCTAssertTrue(viewModel.triggerModeBlocked)
        viewModel.handleTriggerModeChange(.repeatMode)
        XCTAssertFalse(viewModel.triggerModeBlocked)
    }

    func testSaveFlowInvokesMutatorAndResets() async {
        let mutator = ASRecordingMutator()
        let viewModel = makeViewModel(mutator: mutator)
        viewModel.updateEditor {
            $0.name = "Rule"
            $0.signalName = "BatteryLevel"
            $0.op = .lessThan
            $0.valueKind = .number
            $0.valueNum = "20"
            $0.triggerMode = .repeatMode
        }
        XCTAssertTrue(viewModel.canSave)
        viewModel.save()
        XCTAssertTrue(viewModel.savePending)
        await waitUntil { !viewModel.savePending }
        let saved = await mutator.savedInputs
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.name, "Rule")
        // Editor resets to fresh after a successful save.
        XCTAssertNil(viewModel.selectedID)
        XCTAssertEqual(viewModel.editor.name, "")
    }

    func testDeleteFlowInvokesMutator() async {
        let mutator = ASRecordingMutator()
        let viewModel = makeViewModel(mutator: mutator)
        viewModel.requestDelete(AlertStudioSamples.rules[0])
        XCTAssertEqual(viewModel.pendingDelete?.id, 100)
        viewModel.confirmDelete()
        await waitUntil { !viewModel.deletePending }
        let deleted = await mutator.deletedIDs
        XCTAssertEqual(deleted, [100])
    }

    func testTestFlowSendsDefaultMessageWhenBlank() async {
        let mutator = ASRecordingMutator()
        let viewModel = makeViewModel(mutator: mutator)
        viewModel.updateEditor { $0.name = "Rule" }
        viewModel.test()
        await waitUntil { !viewModel.testPending }
        let requests = await mutator.testRequests
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?.message, "Test notification from Alert Studio")
    }

    private func waitUntil(_ condition: @MainActor () -> Bool) async {
        for _ in 0 ..< 200 where !condition() {
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
    }
}

// MARK: - Telemetry + accessibility

@MainActor
final class AlertStudioTelemetryTests: XCTestCase {
    func testReportOpenEmitsSlug() {
        let telemetry = ASRecordingTelemetry()
        AlertStudioSurface.reportOpen(to: telemetry)
        XCTAssertEqual(telemetry.surfaces, ["AlertStudioPage"])
        XCTAssertEqual(AlertStudioSurface.slug, "AlertStudioPage")
    }

    func testStartReportsOpen() {
        let telemetry = ASRecordingTelemetry()
        let viewModel = AlertStudioViewModel(
            rulesModel: ASRulesModel(preview: .loaded(AlertStudioSamples.rules)),
            channelsModel: ASChannelsModel(preview: .loaded([])),
            metricsModel: ASMetricsModel(preview: .loaded([])),
            localize: .echo,
            telemetry: telemetry
        )
        viewModel.start()
        XCTAssertEqual(telemetry.surfaces, ["AlertStudioPage"])
    }

    func testSeverityVisualMapping() {
        XCTAssertEqual(ASSeverityVisual.tone(.info), .info)
        XCTAssertEqual(ASSeverityVisual.tone(.warn), .warning)
        XCTAssertEqual(ASSeverityVisual.tone(.critical), .danger)
        XCTAssertEqual(ASSeverityVisual.systemImage(.critical), "exclamationmark.octagon.fill")
    }

    func testRowLabelCopyInterpolates() {
        let label = ASLocalizer.echo.format(ASCopy.rulesSelectRow, "name", "Battery Low")
        XCTAssertEqual(label, "Select rule Battery Low")
    }
}

// MARK: - Test doubles

/// Records the mutations the view-model drives so the save/delete/test flows are
/// assertable without a network.
actor ASRecordingMutator: AlertStudioMutator {
    private(set) var savedInputs: [ASAlertRuleInput] = []
    private(set) var deletedIDs: [Int64] = []
    private(set) var testRequests: [ASAlertTestRequest] = []
    private(set) var snoozes: [Int64] = []

    func save(_ input: ASAlertRuleInput) async -> Bool {
        savedInputs.append(input)
        return true
    }

    func delete(id: Int64) async -> Bool {
        deletedIDs.append(id)
        return true
    }

    func toggle(id _: Int64, enabled _: Bool) async -> Bool {
        true
    }

    func test(_ request: ASAlertTestRequest) async -> Bool {
        testRequests.append(request)
        return true
    }

    func snooze(id: Int64, minutes _: Int) async -> Bool {
        snoozes.append(id)
        return true
    }

    func bulkEnable(ids _: [Int64]) async -> Bool {
        true
    }

    func bulkDisable(ids _: [Int64]) async -> Bool {
        true
    }
}

/// Captures the P1/S11 `view.opened` slugs the surface emits.
final class ASRecordingTelemetry: AlertStudioTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

@testable import TeslaSync
