//
//  ScheduledMaintenanceCard.Tests.swift
//  TeslaSync — P4 feature view · 0251 · ScheduledMaintenanceCard (Apple)
//
//  Unit coverage for the ScheduledMaintenanceCard surface:
//    • State holder — `ScheduledMaintenanceProjection` across loading / error / active (countdown,
//      within-24h, elapsed) / scheduler, the dynamic ring tone, and the header flags.
//    • View model — the `ScheduledMaintenanceModel` wiring, the P1/S11 `view.opened` telemetry, the
//      schedule / clear mutations (request assembly + toast feedback + validation guards), and the
//      stale auto-refresh.
//    • Accessibility — the VoiceOver card-label composition.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryScheduledMaintenanceSource`, and the formatter + `now` are injected.
//

import XCTest
@testable import TeslaSync

private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

private struct FixedFormatter: MaintenanceDateFormatting {
    let stamp: String
    func dateTime(_: Date) -> String {
        stamp
    }
}

private func activeInput(
    untilOffset: TimeInterval?,
    message: String = "Upgrade",
    connection: ScheduledMaintenanceConnection = .live
) -> ScheduledMaintenanceInput {
    let until = untilOffset.map { MaintenanceInstant.iso(from: fixedNow.addingTimeInterval($0)) }
    return ScheduledMaintenanceInput(
        snapshot: MaintenanceSnapshot(mode: .maintenance, message: message, until: until),
        connection: connection,
        now: fixedNow
    )
}

// MARK: - Projection phases

final class ScheduledMaintenanceProjectionPhaseTests: XCTestCase {
    private let fixed = FixedFormatter(stamp: "STAMP")

    func testErrorTakesPrecedenceEvenWithSnapshot() {
        let input = ScheduledMaintenanceInput(snapshot: .ok, errorMessage: "boom")
        XCTAssertEqual(ScheduledMaintenanceProjection.resolve(input, formatter: fixed).phase, .error("boom"))
    }

    func testLoadingOnlyWhenNoSnapshot() {
        let loading = ScheduledMaintenanceProjection.resolve(
            ScheduledMaintenanceInput(isLoading: true), formatter: fixed
        )
        XCTAssertEqual(loading.phase, .loading)
        // A refetch with a snapshot present is NOT the loading branch — it renders the resolved body.
        let refetch = ScheduledMaintenanceProjection.resolve(
            ScheduledMaintenanceInput(snapshot: .ok, isLoading: true), formatter: fixed
        )
        XCTAssertEqual(refetch.phase, .scheduler)
    }

    func testSchedulerWhenNotActive() {
        for mode in [MaintenanceMode.ok, .degraded] {
            let input = ScheduledMaintenanceInput(snapshot: MaintenanceSnapshot(mode: mode))
            XCTAssertEqual(ScheduledMaintenanceProjection.resolve(input, formatter: fixed).phase, .scheduler)
        }
    }

    func testNilSnapshotNotLoadingFallsToScheduler() {
        let input = ScheduledMaintenanceInput(snapshot: nil, isLoading: false)
        XCTAssertEqual(ScheduledMaintenanceProjection.resolve(input, formatter: fixed).phase, .scheduler)
    }

    func testActiveWhenMaintenance() {
        let resolved = ScheduledMaintenanceProjection.resolve(activeInput(untilOffset: 3600), formatter: fixed)
        guard case .active = resolved.phase else { return XCTFail("expected active phase") }
        XCTAssertTrue(resolved.headerActive)
    }
}

// MARK: - Projection active body + ring tone

final class ScheduledMaintenanceProjectionActiveTests: XCTestCase {
    private let fixed = FixedFormatter(stamp: "STAMP")

    private func content(_ resolved: ScheduledMaintenanceResolved) -> MaintenanceActiveContent? {
        guard case let .active(content) = resolved.phase else { return nil }
        return content
    }

    func testWithin24hAmberRingAndCountdownLine() {
        let resolved = ScheduledMaintenanceProjection.resolve(activeInput(untilOffset: 3600), formatter: fixed)
        XCTAssertEqual(content(resolved)?.untilText, "Active until STAMP (60 min remaining)")
        XCTAssertEqual(resolved.ringTone, .imminent)
        XCTAssertTrue(resolved.headerWithin24h)
    }

    func testBeyond24hBlueRingAndCountdownLine() {
        let resolved = ScheduledMaintenanceProjection.resolve(activeInput(untilOffset: 48 * 3600), formatter: fixed)
        XCTAssertEqual(content(resolved)?.untilText, "Active until STAMP (2880 min remaining)")
        XCTAssertEqual(resolved.ringTone, .active)
        XCTAssertFalse(resolved.headerWithin24h)
    }

    func testElapsedWindowUsesUntilLine() {
        let resolved = ScheduledMaintenanceProjection.resolve(activeInput(untilOffset: -3600), formatter: fixed)
        XCTAssertEqual(content(resolved)?.untilText, "Until STAMP")
        XCTAssertEqual(resolved.ringTone, .active)
        XCTAssertFalse(resolved.headerWithin24h)
    }

    func testBlankMessageBecomesNil() {
        let resolved = ScheduledMaintenanceProjection.resolve(
            activeInput(untilOffset: 3600, message: ""), formatter: fixed
        )
        XCTAssertNil(content(resolved)?.message)
    }

    func testMissingUntilOmitsLine() {
        let input = ScheduledMaintenanceInput(
            snapshot: MaintenanceSnapshot(mode: .maintenance, message: "x", until: nil), now: fixedNow
        )
        let resolved = ScheduledMaintenanceProjection.resolve(input, formatter: fixed)
        XCTAssertEqual(content(resolved)?.message, "x")
        XCTAssertNil(content(resolved)?.untilText)
    }
}

// MARK: - View model: wiring, telemetry, freshness

@MainActor
final class ScheduledMaintenanceModelTests: XCTestCase {
    private func makeModel(
        _ input: ScheduledMaintenanceInput,
        telemetry: ScheduledMaintenanceTelemetry = OSLogScheduledMaintenanceTelemetry(),
        toast: ScheduledMaintenanceToasting = OSLogScheduledMaintenanceToast(),
        result: MaintenanceMutationResult = .success(.ok)
    ) -> (ScheduledMaintenanceModel, InMemoryScheduledMaintenanceSource) {
        let source = InMemoryScheduledMaintenanceSource(initial: input, mutationResult: result)
        let model = ScheduledMaintenanceModel(
            source: source, telemetry: telemetry, toast: toast, formatter: FixedFormatter(stamp: "STAMP")
        )
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = ScheduledMaintenanceCardSpyTelemetry()
        let (model, source) = makeModel(ScheduledMaintenanceInput(snapshot: .ok), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .scheduler)
        XCTAssertEqual(spy.surfaces, [ScheduledMaintenanceCard.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(ScheduledMaintenanceInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(activeInput(untilOffset: 3600))
        guard case .active = model.phase else { return XCTFail("expected active") }
        XCTAssertEqual(model.ringTone, .imminent)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(ScheduledMaintenanceInput(snapshot: .ok))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ScheduledMaintenanceInput(snapshot: .ok, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ScheduledMaintenanceInput(snapshot: .ok, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndLiveReArms() {
        let (model, source) = makeModel(ScheduledMaintenanceInput(snapshot: .ok))
        model.start()
        source.push(ScheduledMaintenanceInput(snapshot: .ok, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ScheduledMaintenanceInput(snapshot: .ok, connection: .stale)) // refresh 1
        source.push(ScheduledMaintenanceInput(snapshot: .ok, connection: .live)) // re-arm
        source.push(ScheduledMaintenanceInput(snapshot: .ok, connection: .stale)) // refresh 2
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testManualRefreshAndStopDelegate() {
        let (model, source) = makeModel(ScheduledMaintenanceInput(snapshot: .ok))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ScheduledMaintenanceCard.surfaceSlug, "ScheduledMaintenanceCard")
    }
}

// MARK: - View model: schedule / clear mutations

@MainActor
final class ScheduledMaintenanceMutationTests: XCTestCase {
    private struct Harness {
        let model: ScheduledMaintenanceModel
        let source: InMemoryScheduledMaintenanceSource
        let toast: ScheduledMaintenanceCardSpyToast
    }

    private func makeHarness(result: MaintenanceMutationResult = .success(.ok)) -> Harness {
        let toast = ScheduledMaintenanceCardSpyToast()
        let source = InMemoryScheduledMaintenanceSource(
            initial: ScheduledMaintenanceInput(snapshot: .ok), mutationResult: result
        )
        let model = ScheduledMaintenanceModel(
            source: source, toast: toast, formatter: FixedFormatter(stamp: "STAMP")
        )
        model.start()
        return Harness(model: model, source: source, toast: toast)
    }

    func testScheduleSubmitsMaintenanceRequestAndToasts() async {
        let harness = makeHarness()
        let scheduled = await harness.model.schedule(start: fixedNow, durationText: "90", message: "Upgrade DB")
        XCTAssertTrue(scheduled)
        XCTAssertEqual(harness.source.submitCount, 1)
        XCTAssertEqual(harness.source.lastRequest?.mode, .maintenance)
        XCTAssertEqual(harness.source.lastRequest?.message, "Upgrade DB")
        XCTAssertEqual(
            harness.source.lastRequest?.until,
            MaintenanceInstant.iso(from: fixedNow.addingTimeInterval(90 * 60))
        )
        XCTAssertEqual(harness.toast.successes, ["Maintenance window scheduled."])
        XCTAssertFalse(harness.model.isMutating)
    }

    func testScheduleUsesDefaultMessageWhenBlank() async {
        let harness = makeHarness()
        _ = await harness.model.schedule(start: fixedNow, durationText: "", message: "   ")
        XCTAssertEqual(harness.source.lastRequest?.message, "Scheduled maintenance · ends STAMP")
        XCTAssertEqual(
            harness.source.lastRequest?.until,
            MaintenanceInstant.iso(from: fixedNow.addingTimeInterval(3600))
        )
    }

    func testScheduleValidationFailureToastsAndDoesNotSubmit() async {
        let harness = makeHarness()
        let scheduled = await harness.model.schedule(start: nil, durationText: "60", message: "")
        XCTAssertFalse(scheduled)
        XCTAssertEqual(harness.source.submitCount, 0)
        XCTAssertEqual(harness.toast.errors, ["Pick a start time."])
    }

    func testScheduleMutationFailureSurfacesBackendMessage() async {
        let harness = makeHarness(result: .failure("boom"))
        let scheduled = await harness.model.schedule(start: fixedNow, durationText: "60", message: "x")
        XCTAssertFalse(scheduled)
        XCTAssertEqual(harness.toast.errors, ["boom"])
    }

    func testClearSubmitsClearRequestAndToasts() async {
        let harness = makeHarness()
        let cleared = await harness.model.clear()
        XCTAssertTrue(cleared)
        XCTAssertEqual(harness.source.lastRequest, .clear)
        XCTAssertEqual(harness.toast.successes, ["Maintenance cleared."])
    }

    func testClearFailureUsesFallbackWhenMessageEmpty() async {
        let harness = makeHarness(result: .failure(""))
        let cleared = await harness.model.clear()
        XCTAssertFalse(cleared)
        XCTAssertEqual(harness.toast.errors, ["Failed to clear maintenance"])
    }
}

// MARK: - Accessibility

final class ScheduledMaintenanceAccessibilityTests: XCTestCase {
    func testCardLabelJoinsPresentQualifiers() {
        XCTAssertEqual(
            ScheduledMaintenanceAccessibility.cardLabel(
                title: "Scheduled maintenance", active: "Maintenance active", within24h: "Within 24h"
            ),
            "Scheduled maintenance, Maintenance active, Within 24h"
        )
    }

    func testCardLabelOmitsAbsentQualifiers() {
        XCTAssertEqual(
            ScheduledMaintenanceAccessibility.cardLabel(title: "Scheduled maintenance", active: nil, within24h: nil),
            "Scheduled maintenance"
        )
    }
}

// MARK: - Test doubles

private final class ScheduledMaintenanceCardSpyTelemetry: ScheduledMaintenanceTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

private final class ScheduledMaintenanceCardSpyToast: ScheduledMaintenanceToasting, @unchecked Sendable {
    private(set) var successes: [String] = []
    private(set) var errors: [String] = []
    func success(_ message: String) {
        successes.append(message)
    }

    func error(_ message: String) {
        errors.append(message)
    }
}
