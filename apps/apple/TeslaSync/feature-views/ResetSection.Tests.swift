//
//  ResetSection.Tests.swift
//  TeslaSync — P4 feature view · 0212 · ResetSection (Apple)
//
//  Unit coverage for the `ResetSectionModel` state holder, driven by the in-memory +
//  controllable seams:
//    • phase resolution across loading / ready + the cached-catalog fallback on failure,
//    • the per-section confirm → reset flow (busy, cache flush, success toast, silent
//      SUDO-cancel, failure toast),
//    • the danger-zone typed-confirmation gating + the global reset flow,
//    • the stale one-shot auto-refresh + offline no-refresh,
//    • the P1/S11 `view.opened` telemetry + seam wiring.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store. The pure adapter is covered by ResetSection.AdapterTests.swift.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Harness

@MainActor
private struct ResetHarness {
    let model: ResetSectionModel
    let source: InMemoryResetSectionsSource
    let resetter: InMemorySettingsResetting
}

@MainActor
private func makeHarness(
    initial: ResetSectionsUpdate? = ResetSectionsUpdate(status: .loaded),
    outcome: InMemorySettingsResetting.Outcome = .success(
        SettingsResetReceipt(reset: 3, sections: ["general"])
    ),
    telemetry: ResetTelemetry = OSLogResetTelemetry(),
    start: Bool = true
) -> ResetHarness {
    let source = InMemoryResetSectionsSource(initial: initial)
    let resetter = InMemorySettingsResetting(outcome: outcome)
    let model = ResetSectionModel(
        source: source,
        resetter: resetter,
        telemetry: telemetry,
        localize: { _, fallback in fallback }
    )
    if start { model.start() }
    return ResetHarness(model: model, source: source, resetter: resetter)
}

@MainActor
private struct ControllableResetHarness {
    let model: ResetSectionModel
    let source: InMemoryResetSectionsSource
    let resetter: ControllableSettingsResetting
}

@MainActor
private func makeControllableHarness(
    initial: ResetSectionsUpdate? = ResetSectionsUpdate(status: .loaded)
) -> ControllableResetHarness {
    let source = InMemoryResetSectionsSource(initial: initial)
    let resetter = ControllableSettingsResetting()
    let model = ResetSectionModel(
        source: source,
        resetter: resetter,
        telemetry: OSLogResetTelemetry(),
        localize: { _, fallback in fallback }
    )
    model.start()
    return ControllableResetHarness(model: model, source: source, resetter: resetter)
}

@MainActor
private func waitUntil(_ condition: () -> Bool) async {
    for _ in 0 ..< 50 where !condition() {
        await Task.yield()
    }
}

// MARK: - Phases + freshness + telemetry

@MainActor final class ResetModelLifecycleTests: XCTestCase {
    func testStartsInLoadingUntilListResolves() {
        let harness = makeHarness(initial: ResetSectionsUpdate(status: .loading))
        XCTAssertEqual(harness.model.phase, .loading)

        harness.source.push(ResetSectionsUpdate(status: .loaded))
        XCTAssertEqual(harness.model.phase, .ready)
        XCTAssertEqual(harness.model.sections.count, ResetCatalog.defaultSections.count)
    }

    func testFailedListRevealsSurfaceWithCachedCatalog() {
        let harness = makeHarness(
            initial: ResetSectionsUpdate(status: .failed("net"), sections: ResetCatalog.defaultSections)
        )
        XCTAssertEqual(harness.model.phase, .ready)
        XCTAssertEqual(harness.model.status, .failed("net"))
        XCTAssertEqual(harness.model.sections.map(\.id), ResetCatalog.defaultSections.map(\.id))
        XCTAssertEqual(harness.model.denied.count, ResetCatalog.deniedSections.count)
    }

    func testStartEmitsViewOpenedOnceAndWiresSource() {
        let spy = SpyResetTelemetry()
        let harness = makeHarness(telemetry: spy, start: false)
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(spy.surfaces, [ResetDiagnostics.surface])
        XCTAssertEqual(ResetDiagnostics.surface, "ResetSection")
        XCTAssertEqual(harness.source.startCount, 1)
    }

    func testStaleTriggersExactlyOneAutoRefreshPerEpisode() {
        let harness = makeHarness()
        XCTAssertEqual(harness.source.refreshCount, 0)

        harness.source.push(ResetSectionsUpdate(status: .loaded, freshness: .stale))
        harness.source.push(ResetSectionsUpdate(status: .loaded, freshness: .stale))
        XCTAssertEqual(harness.source.refreshCount, 1)

        harness.source.push(ResetSectionsUpdate(status: .loaded, freshness: .fresh))
        harness.source.push(ResetSectionsUpdate(status: .loaded, freshness: .stale))
        XCTAssertEqual(harness.source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let harness = makeHarness()
        harness.source.push(ResetSectionsUpdate(status: .loaded, freshness: .offline))
        XCTAssertEqual(harness.source.refreshCount, 0)
        XCTAssertEqual(harness.model.freshness, .offline)
    }

    func testRefreshDelegatesToSource() {
        let harness = makeHarness()
        harness.model.refresh()
        harness.model.refresh()
        XCTAssertEqual(harness.source.refreshCount, 2)
    }

    func testStopStopsSource() {
        let harness = makeHarness()
        harness.model.stop()
        XCTAssertEqual(harness.source.stopCount, 1)
    }
}

// MARK: - Per-section reset flow

@MainActor final class ResetSectionFlowTests: XCTestCase {
    func testRequestPresentsSectionSheet() {
        let harness = makeHarness()
        let row = ResetCatalog.defaultSections[2]
        harness.model.requestResetSection(row)
        XCTAssertEqual(harness.model.pendingSection?.id, row.id)
        XCTAssertEqual(harness.resetter.resetSectionCount, 0)
    }

    func testCancelDismissesSectionSheet() {
        let harness = makeHarness()
        harness.model.requestResetSection(ResetCatalog.defaultSections[0])
        harness.model.cancelResetSection()
        XCTAssertNil(harness.model.pendingSection)
        XCTAssertEqual(harness.resetter.resetSectionCount, 0)
    }

    func testConfirmSectionSucceedsTogglesBusyInvalidatesAndToasts() async {
        let harness = makeControllableHarness()
        let model = harness.model
        let resetter = harness.resetter
        let row = ResetCatalog.defaultSections[0]
        model.requestResetSection(row)

        let task = Task { await model.confirmResetSection() }
        await waitUntil { model.resettingSectionID == row.id }
        XCTAssertTrue(model.isSectionBusy(row.id))
        XCTAssertEqual(model.pendingSection?.id, row.id)

        resetter.complete(SettingsResetReceipt(reset: 4, sections: ["general", "appearance"]))
        await task.value

        XCTAssertNil(model.resettingSectionID)
        XCTAssertNil(model.pendingSection)
        XCTAssertEqual(model.toast?.kind, .success)
        XCTAssertEqual(model.toast?.title, "Section reset")
        XCTAssertEqual(model.toast?.detail, "4 item(s) reset across 2 section(s).")
        XCTAssertEqual(resetter.resetSectionCount, 1)
        XCTAssertEqual(resetter.invalidateCount, 1)
        XCTAssertEqual(resetter.lastSection, "general")
    }

    func testConfirmSectionSilentOnSudoCancel() async {
        let harness = makeHarness(outcome: .failure(.canceled))
        harness.model.requestResetSection(ResetCatalog.defaultSections[0])
        await harness.model.confirmResetSection()
        XCTAssertNil(harness.model.toast)
        XCTAssertNil(harness.model.pendingSection)
        XCTAssertEqual(harness.resetter.invalidateCount, 0)
    }

    func testConfirmSectionToastsOnFailure() async {
        let harness = makeHarness(outcome: .failure(.failed(message: "SECTION_DENIED")))
        harness.model.requestResetSection(ResetCatalog.defaultSections[0])
        await harness.model.confirmResetSection()
        XCTAssertEqual(harness.model.toast?.kind, .error)
        XCTAssertEqual(harness.model.toast?.title, "Failed to reset section")
        XCTAssertEqual(harness.model.toast?.detail, "SECTION_DENIED")
        XCTAssertEqual(harness.resetter.invalidateCount, 0)
    }

    func testConfirmSectionNoOpWithoutPending() async {
        let harness = makeHarness()
        await harness.model.confirmResetSection()
        XCTAssertEqual(harness.resetter.resetSectionCount, 0)
        XCTAssertNil(harness.model.toast)
    }
}

// MARK: - Danger-zone global reset flow

@MainActor final class ResetAllFlowTests: XCTestCase {
    func testRequestOpensSheetAndClearsInput() {
        let harness = makeHarness()
        harness.model.resetAllInput = "stale"
        harness.model.requestResetAll()
        XCTAssertTrue(harness.model.resetAllPresented)
        XCTAssertEqual(harness.model.resetAllInput, "")
    }

    func testCancelClosesAndClearsInput() {
        let harness = makeHarness()
        harness.model.requestResetAll()
        harness.model.resetAllInput = "RESET"
        harness.model.cancelResetAll()
        XCTAssertFalse(harness.model.resetAllPresented)
        XCTAssertEqual(harness.model.resetAllInput, "")
    }

    func testConfirmIsGatedByTypedInput() async {
        let harness = makeHarness()
        harness.model.requestResetAll()
        harness.model.resetAllInput = "nope"
        await harness.model.confirmResetAll()
        XCTAssertEqual(harness.resetter.resetAllCount, 0)
        XCTAssertTrue(harness.model.resetAllPresented)

        harness.model.resetAllInput = "RESET"
        await harness.model.confirmResetAll()
        XCTAssertEqual(harness.resetter.resetAllCount, 1)
        XCTAssertFalse(harness.model.resetAllPresented)
        XCTAssertEqual(harness.model.resetAllInput, "")
    }

    func testConfirmAllSucceedsTogglesBusyInvalidatesAndToasts() async {
        let harness = makeControllableHarness()
        let model = harness.model
        let resetter = harness.resetter
        model.requestResetAll()
        model.resetAllInput = "RESET"

        let task = Task { await model.confirmResetAll() }
        await waitUntil { model.isResettingAll }
        XCTAssertTrue(model.isResettingAll)
        XCTAssertTrue(model.resetAllPresented)

        resetter.complete(SettingsResetReceipt(reset: 20, sections: ["a", "b", "c"]))
        await task.value

        XCTAssertFalse(model.isResettingAll)
        XCTAssertFalse(model.resetAllPresented)
        XCTAssertEqual(model.resetAllInput, "")
        XCTAssertEqual(model.toast?.kind, .success)
        XCTAssertEqual(model.toast?.title, "All settings reset")
        XCTAssertEqual(model.toast?.detail, "20 item(s) reset across 3 section(s).")
        XCTAssertEqual(resetter.resetAllCount, 1)
        XCTAssertEqual(resetter.invalidateCount, 1)
    }

    func testConfirmAllSilentOnSudoCancel() async {
        let harness = makeHarness(outcome: .failure(.canceled))
        harness.model.requestResetAll()
        harness.model.resetAllInput = "RESET"
        await harness.model.confirmResetAll()
        XCTAssertNil(harness.model.toast)
        XCTAssertFalse(harness.model.resetAllPresented)
        XCTAssertEqual(harness.resetter.invalidateCount, 0)
    }

    func testConfirmAllToastsOfflineDetailOnFailure() async {
        let harness = makeHarness(outcome: .failure(.offline))
        harness.model.requestResetAll()
        harness.model.resetAllInput = "RESET"
        await harness.model.confirmResetAll()
        XCTAssertEqual(harness.model.toast?.kind, .error)
        XCTAssertEqual(harness.model.toast?.title, "Failed to reset all settings")
        XCTAssertEqual(
            harness.model.toast?.detail,
            "You appear to be offline. Check your connection and try again."
        )
        XCTAssertEqual(harness.resetter.invalidateCount, 0)
    }
}

// MARK: - Toast

@MainActor final class ResetToastTests: XCTestCase {
    func testDismissToastClearsIt() async {
        let harness = makeHarness()
        harness.model.requestResetSection(ResetCatalog.defaultSections[0])
        await harness.model.confirmResetSection()
        XCTAssertNotNil(harness.model.toast)
        harness.model.dismissToast()
        XCTAssertNil(harness.model.toast)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyResetTelemetry: ResetTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
