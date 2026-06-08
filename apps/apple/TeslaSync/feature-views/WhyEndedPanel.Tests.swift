//
//  WhyEndedPanel.Tests.swift
//  TeslaSync — P4 feature view · 0152 · WhyEndedPanel (Apple)
//
//  Unit coverage for the WhyEndedPanel surface:
//    • Adapter (records → projection) — `WhyEndedPanelFormat` + `…Builder` parity
//      with the web title compose / `trigger: {{trigger}}` interpolation / signal
//      keying, plus the `DataTable` pagination math (`WhyEndedSignalPaging`).
//    • State holder — `WhyEndedPanelModel` phase resolution across loading / empty
//      / error / content, the P1/S11 `view.opened` telemetry, the lazy disclosure
//      → `setEnabled`, the window selector → `setWindow`, and the pagination state.
//    • Accessibility — the row + count VoiceOver summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryWhyEndedPanelSource`. The pure
//  adapter subset is additionally proven by an executed host harness (gate log).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: formatting (title / trigger / timestamp)

final class WhyEndedPanelFormatTests: XCTestCase {
    func testTransitionTitleComposesWithArrow() {
        let title = WhyEndedPanelFormat.transitionTitle(fsmName: "drive", fromState: "driving", toState: "parked")
        XCTAssertEqual(title, "drive: driving → parked")
    }

    func testTriggerValueFallsBackToEmDash() {
        XCTAssertEqual(WhyEndedPanelFormat.triggerValue("shift_to_park"), "shift_to_park")
        XCTAssertEqual(WhyEndedPanelFormat.triggerValue(""), "—")
    }

    func testInterpolateTriggerSubstitutesToken() {
        XCTAssertEqual(
            WhyEndedPanelFormat.interpolateTrigger(template: "trigger: {{trigger}}", trigger: "speed_low"),
            "trigger: speed_low"
        )
        XCTAssertEqual(
            WhyEndedPanelFormat.interpolateTrigger(template: "trigger: {{trigger}}", trigger: ""),
            "trigger: —"
        )
    }

    func testParseTimestampHandlesIsoVariantsAndJunk() {
        XCTAssertNotNil(WhyEndedPanelFormat.parseTimestamp("2026-06-07T19:00:00Z"))
        XCTAssertNotNil(WhyEndedPanelFormat.parseTimestamp("2026-06-07T19:00:00.500Z"))
        XCTAssertNil(WhyEndedPanelFormat.parseTimestamp(""))
        XCTAssertNil(WhyEndedPanelFormat.parseTimestamp("not-a-date"))
    }

    func testAbsoluteRendersEmDashForNilAndTextForDate() {
        XCTAssertEqual(WhyEndedPanelFormat.absolute(from: nil), "—")
        let date = WhyEndedPanelFormat.parseTimestamp("2026-06-07T19:00:00Z")
        let text = WhyEndedPanelFormat.absolute(from: date, locale: Locale(identifier: "en_US"))
        XCTAssertFalse(text.isEmpty)
        XCTAssertNotEqual(text, "—")
    }
}

// MARK: - Adapter: builder (transition / signal rows + projection)

final class WhyEndedPanelBuilderTests: XCTestCase {
    func testTransitionRowCarriesTitleTriggerAndTime() {
        let data = DriveDiagnosticTransitionData(
            id: 7,
            timestampRaw: "2026-06-07T19:00:00Z",
            fsmName: "drive",
            fromState: "moving",
            toState: "driving",
            trigger: "below_threshold"
        )
        let row = WhyEndedPanelBuilder.transitionRow(from: data, locale: Locale(identifier: "en_US"))
        XCTAssertEqual(row.id, 7)
        XCTAssertEqual(row.title, "drive: moving → driving")
        XCTAssertEqual(row.triggerValue, "below_threshold")
        XCTAssertNotNil(row.timestamp)
        XCTAssertNotEqual(row.timestampText, "—")
    }

    func testTransitionRowEmptyTriggerBecomesEmDash() {
        let data = DriveDiagnosticTransitionData(
            id: 1,
            timestampRaw: "",
            fsmName: "session",
            fromState: "active",
            toState: "idle",
            trigger: ""
        )
        let row = WhyEndedPanelBuilder.transitionRow(from: data)
        XCTAssertEqual(row.triggerValue, "—")
        XCTAssertNil(row.timestamp)
        XCTAssertEqual(row.timestampText, "—")
    }

    func testSignalRowKeyIncludesIndexForStableIdentity() {
        let data = DriveDiagnosticSignalData(timestampRaw: "2026-06-07T19:00:00Z", field: "vehicle_speed", value: "42")
        let first = WhyEndedPanelBuilder.signalRow(from: data, index: 0)
        let second = WhyEndedPanelBuilder.signalRow(from: data, index: 1)
        XCTAssertEqual(first.id, "2026-06-07T19:00:00Z-vehicle_speed-0")
        XCTAssertEqual(second.id, "2026-06-07T19:00:00Z-vehicle_speed-1")
        XCTAssertNotEqual(first.id, second.id, "re-emitted ts+field must keep distinct identity")
        XCTAssertEqual(first.field, "vehicle_speed")
        XCTAssertEqual(first.value, "42")
    }

    func testBuildProjectionMapsBothFeedsAndReportsData() {
        let projection = WhyEndedPanelBuilder.buildProjection(
            transitions: [
                DriveDiagnosticTransitionData(
                    id: 1,
                    timestampRaw: "2026-06-07T19:00:00Z",
                    fsmName: "drive",
                    fromState: "a",
                    toState: "b",
                    trigger: "t"
                )
            ],
            signals: [
                DriveDiagnosticSignalData(timestampRaw: "2026-06-07T19:00:00Z", field: "f1", value: "1"),
                DriveDiagnosticSignalData(timestampRaw: "2026-06-07T19:00:01Z", field: "f2", value: "2")
            ]
        )
        XCTAssertEqual(projection.transitions.count, 1)
        XCTAssertEqual(projection.signals.count, 2)
        XCTAssertTrue(projection.hasData)
    }

    func testEmptyProjectionHasNoData() {
        XCTAssertFalse(WhyEndedPanelProjection.empty.hasData)
        XCTAssertFalse(WhyEndedPanelBuilder.buildProjection(transitions: [], signals: []).hasData)
    }
}

// MARK: - Adapter: pagination math (web DataTable pagination)

final class WhyEndedSignalPagingTests: XCTestCase {
    func testPageCountRoundsUpAndFloorsAtOne() {
        XCTAssertEqual(WhyEndedSignalPaging.pageCount(total: 0, pageSize: 25), 1)
        XCTAssertEqual(WhyEndedSignalPaging.pageCount(total: 25, pageSize: 25), 1)
        XCTAssertEqual(WhyEndedSignalPaging.pageCount(total: 26, pageSize: 25), 2)
        XCTAssertEqual(WhyEndedSignalPaging.pageCount(total: 120, pageSize: 50), 3)
    }

    func testClampKeepsPageInRange() {
        XCTAssertEqual(WhyEndedSignalPaging.clamp(page: -3, total: 100, pageSize: 25), 0)
        XCTAssertEqual(WhyEndedSignalPaging.clamp(page: 99, total: 100, pageSize: 25), 3)
        XCTAssertEqual(WhyEndedSignalPaging.clamp(page: 2, total: 100, pageSize: 25), 2)
    }

    func testPageSlicesTheRequestedWindow() {
        let rows = Array(0 ..< 60)
        XCTAssertEqual(WhyEndedSignalPaging.page(rows, page: 0, pageSize: 25), Array(0 ..< 25))
        XCTAssertEqual(WhyEndedSignalPaging.page(rows, page: 2, pageSize: 25), Array(50 ..< 60))
        XCTAssertEqual(WhyEndedSignalPaging.page(rows, page: 9, pageSize: 25), Array(50 ..< 60), "out-of-range clamps")
        XCTAssertTrue(WhyEndedSignalPaging.page([Int](), page: 0, pageSize: 25).isEmpty)
    }

    func testPageSizeOptionsMatchWebContract() {
        XCTAssertEqual(WhyEndedSignalPaging.defaultPageSize, 25)
        XCTAssertEqual(WhyEndedSignalPaging.pageSizeOptions, [25, 50, 100])
    }
}

// MARK: - State holder: phase resolution

final class WhyEndedPanelPhaseTests: XCTestCase {
    func testLoadingWithoutDataShowsLoading() {
        XCTAssertEqual(WhyEndedPanelModel.resolvePhase(status: .loading, hasData: false), .loading)
    }

    func testLoadingWithDataKeepsContent() {
        XCTAssertEqual(WhyEndedPanelModel.resolvePhase(status: .loading, hasData: true), .content)
    }

    func testResolvedAlwaysContentSoSectionsOwnEmpties() {
        XCTAssertEqual(WhyEndedPanelModel.resolvePhase(status: .loaded, hasData: false), .content)
        XCTAssertEqual(WhyEndedPanelModel.resolvePhase(status: .empty, hasData: false), .content)
    }

    func testFailedWithoutCacheShowsErrorElseContent() {
        XCTAssertEqual(WhyEndedPanelModel.resolvePhase(status: .failed("boom"), hasData: false), .error("boom"))
        XCTAssertEqual(WhyEndedPanelModel.resolvePhase(status: .failed("boom"), hasData: true), .content)
    }
}

// MARK: - State holder: model wiring

@MainActor
final class WhyEndedPanelModelTests: XCTestCase {
    private func makeModel(
        _ update: WhyEndedPanelUpdate? = nil,
        telemetry: WhyEndedPanelTelemetry = OSLogWhyEndedPanelTelemetry()
    ) -> (WhyEndedPanelModel, InMemoryWhyEndedPanelSource) {
        let source = InMemoryWhyEndedPanelSource(initial: update)
        let model = WhyEndedPanelModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func signals(_ count: Int) -> [DriveDiagnosticSignalData] {
        (0 ..< count).map { index in
            DriveDiagnosticSignalData(
                timestampRaw: "2026-06-07T19:00:0\(index % 10)Z",
                field: "f\(index)",
                value: "\(index)"
            )
        }
    }

    func testStartsCollapsedWithDefaultWindow() {
        let (model, _) = makeModel()
        XCTAssertFalse(model.expanded)
        XCTAssertEqual(model.window, .s60)
        XCTAssertEqual(DriveDiagnosticWindow.default, .s60)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyWhyEndedPanelTelemetry()
        let (model, source) = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [WhyEndedPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testToggleExpandedDrivesLazyEnableGate() {
        let (model, source) = makeModel(
            WhyEndedPanelUpdate(status: .loaded, transitions: [], signals: signals(3))
        )
        model.start()
        XCTAssertNil(source.lastEnabled, "query stays lazy until expanded")
        model.toggleExpanded()
        XCTAssertTrue(model.expanded)
        XCTAssertEqual(source.lastEnabled, true)
        XCTAssertEqual(model.phase, .content, "the enable push delivered the resolved snapshot")
        model.toggleExpanded()
        XCTAssertFalse(model.expanded)
        XCTAssertEqual(source.lastEnabled, false)
        XCTAssertEqual(source.enabledCount, 2)
    }

    func testSelectWindowReQueriesAndResetsSignalPage() {
        let (model, source) = makeModel(WhyEndedPanelUpdate(status: .loaded, signals: signals(60)))
        model.start()
        model.setExpanded(true)
        model.goToSignalPage(2)
        XCTAssertEqual(model.signalPage, 2)
        model.selectWindow(.m5)
        XCTAssertEqual(model.window, .m5)
        XCTAssertEqual(source.lastWindow, .m5)
        XCTAssertEqual(model.signalPage, 0, "changing the window resets pagination")
        model.selectWindow(.m5)
        XCTAssertEqual(source.lastWindow, .m5, "re-selecting the same window is a no-op")
    }

    func testPaginationSlicesAndClamps() {
        let (model, source) = makeModel()
        model.start()
        source.push(WhyEndedPanelUpdate(status: .loaded, signals: signals(60)))
        XCTAssertEqual(model.signalPageCount, 3)
        XCTAssertEqual(model.pagedSignals.count, 25)
        model.goToSignalPage(2)
        XCTAssertEqual(model.pagedSignals.count, 10)
        model.setSignalPageSize(50)
        XCTAssertEqual(model.signalPageSize, 50)
        XCTAssertEqual(model.signalPageCount, 2)
        XCTAssertLessThanOrEqual(model.signalPage, model.signalPageCount - 1)
    }

    func testApplyTracksConnectionProjectionAndFetching() {
        let (model, source) = makeModel()
        model.start()
        source.push(WhyEndedPanelUpdate(
            status: .loaded,
            connection: .offline,
            transitions: [],
            signals: signals(2),
            updatedAt: Date()
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.signals.count, 2)
        XCTAssertFalse(model.isFetching)
    }

    func testRefreshAndStopDelegateToSource() {
        let (model, source) = makeModel()
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        model.start()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
    }

    func testFailureWithoutCacheSurfacesRetryableError() {
        let (model, source) = makeModel()
        model.start()
        source.push(WhyEndedPanelUpdate(status: .failed("timeout")))
        XCTAssertEqual(model.phase, .error("timeout"))
    }
}

// MARK: - Accessibility

final class WhyEndedPanelAccessibilityTests: XCTestCase {
    func testTransitionRowLabelJoinsTitleSubtitleTime() {
        let row = WhyEndedTransitionRow(
            id: 1,
            title: "drive: a → b",
            triggerValue: "t",
            timestampText: "Jun 7, 2026, 7:00 PM",
            timestamp: nil
        )
        let label = WhyEndedPanelAccessibility.transitionRowLabel(for: row, subtitle: "trigger: t")
        XCTAssertEqual(label, "drive: a → b, trigger: t, Jun 7, 2026, 7:00 PM")
    }

    func testSignalRowLabelIsColumnOrdered() {
        let row = WhyEndedSignalRow(
            id: "k",
            timestampText: "Jun 7, 2026, 7:00 PM",
            field: "vehicle_speed",
            value: "42",
            timestamp: nil
        )
        let label = WhyEndedPanelAccessibility.signalRowLabel(for: row)
        XCTAssertEqual(label, "Jun 7, 2026, 7:00 PM, vehicle_speed, 42")
    }

    func testSignalCountSummaryFormats() {
        XCTAssertTrue(WhyEndedPanelAccessibility.signalCountSummary(7, format: "%lld signals").contains("7"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyWhyEndedPanelTelemetry: WhyEndedPanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
