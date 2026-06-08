//
//  SecurityStatusWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0085 · SecurityStatusWidget (Apple)
//
//  Unit coverage for the SecurityStatusWidget surface:
//    • Adapter (cached → projection) — `SecuritySignalParser` door/window parsing
//      and `SecurityCellsBuilder` cell projection parity with the web `useMemo`.
//    • State holder — `SecurityModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `security-status` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for the cells + grid.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemorySecuritySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: door / window parsing (port parity with the web useMemo)

@MainActor final class SecuritySignalParserTests: XCTestCase {
    func testOpenDoorCountTreatsNativeTrueAsOneOpenDoor() {
        XCTAssertEqual(SecuritySignalParser.openDoorCount(.boolean(true)), 1)
    }

    func testOpenDoorCountTreatsNativeFalseAsZero() {
        XCTAssertEqual(SecuritySignalParser.openDoorCount(.boolean(false)), 0)
    }

    func testOpenDoorCountCountsOnlyEntriesContainingOpen() {
        XCTAssertEqual(SecuritySignalParser.openDoorCount(.text("DriverFrontOpen,PassengerClosed")), 1)
        XCTAssertEqual(SecuritySignalParser.openDoorCount(.text("DriverFrontOpen,PassengerRearOpen")), 2)
    }

    func testOpenDoorCountIsCaseInsensitiveAndTrimsAndDropsEmpties() {
        XCTAssertEqual(SecuritySignalParser.openDoorCount(.text("  driveropen , ,  ")), 1)
        XCTAssertEqual(SecuritySignalParser.openDoorCount(.text("ALLCLOSED")), 0)
    }

    func testOpenDoorCountZeroForEmptyAndAbsent() {
        XCTAssertEqual(SecuritySignalParser.openDoorCount(.text("")), 0)
        XCTAssertEqual(SecuritySignalParser.openDoorCount(.absent), 0)
    }

    func testIsWindowOpenHonorsBooleanValues() {
        XCTAssertTrue(SecuritySignalParser.isWindowOpen(.boolean(true)))
        XCTAssertFalse(SecuritySignalParser.isWindowOpen(.boolean(false)))
    }

    func testIsWindowOpenTreatsClosedStringAsClosedCaseInsensitively() {
        XCTAssertFalse(SecuritySignalParser.isWindowOpen(.text("closed")))
        XCTAssertFalse(SecuritySignalParser.isWindowOpen(.text("CLOSED")))
        XCTAssertTrue(SecuritySignalParser.isWindowOpen(.text("vented")))
        XCTAssertTrue(SecuritySignalParser.isWindowOpen(.text("Open")))
    }

    func testIsWindowOpenTreatsEmptyAndAbsentAsClosed() {
        XCTAssertFalse(SecuritySignalParser.isWindowOpen(.text("")))
        XCTAssertFalse(SecuritySignalParser.isWindowOpen(.absent))
    }

    func testOpenWindowCountSumsTheFourFields() {
        let windows: [SecuritySignalValue] = [.boolean(true), .boolean(false), .text("closed"), .text("vented")]
        XCTAssertEqual(SecuritySignalParser.openWindowCount(windows), 2)
    }
}

// MARK: - Adapter: cell projection (port parity with the web `cells` useMemo)

@MainActor final class SecurityCellsBuilderTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    private func cells(_ input: SecurityLatestInput) -> [String: SecurityStatusCell] {
        let built = SecurityCellsBuilder.build(latest: input, localize: echo)
        return Dictionary(uniqueKeysWithValues: built.map { ($0.id, $0) })
    }

    func testBuildReturnsEmptyWhenNoLatestEvent() {
        XCTAssertTrue(SecurityCellsBuilder.build(latest: nil, localize: echo).isEmpty)
    }

    func testBuildProducesFourOrderedCells() {
        let built = SecurityCellsBuilder.build(
            latest: SecurityLatestInput(locked: true, sentryMode: true),
            localize: echo
        )
        XCTAssertEqual(built.map(\.id), ["lock", "sentry", "doors", "windows"])
    }

    func testLockedCellIsOkWithLockGlyph() {
        let lock = cells(SecurityLatestInput(locked: true, sentryMode: false))["lock"]
        XCTAssertEqual(lock?.status, .ok)
        XCTAssertEqual(lock?.value, "Locked")
        XCTAssertEqual(lock?.systemImage, "lock.fill")
    }

    func testUnlockedCellIsErrorWithOpenLockGlyph() {
        let lock = cells(SecurityLatestInput(locked: false, sentryMode: false))["lock"]
        XCTAssertEqual(lock?.status, .error)
        XCTAssertEqual(lock?.value, "Unlocked")
        XCTAssertEqual(lock?.systemImage, "lock.open.fill")
    }

    func testSentryOnCellIsOkAndOffCellIsInactive() {
        let on = cells(SecurityLatestInput(locked: true, sentryMode: true))["sentry"]
        XCTAssertEqual(on?.status, .ok)
        XCTAssertEqual(on?.value, "Active")
        XCTAssertEqual(on?.systemImage, "checkmark.shield.fill")

        let off = cells(SecurityLatestInput(locked: true, sentryMode: false))["sentry"]
        XCTAssertEqual(off?.status, .inactive)
        XCTAssertEqual(off?.value, "Off")
        XCTAssertEqual(off?.systemImage, "shield.fill")
    }

    func testDoorsCellOkWhenAllClosedWarningWhenOpen() {
        let closed = cells(SecurityLatestInput(locked: true, sentryMode: true, doorState: .text("AllClosed")))["doors"]
        XCTAssertEqual(closed?.status, .ok)
        XCTAssertEqual(closed?.value, "All Closed")

        let open = cells(SecurityLatestInput(
            locked: true, sentryMode: true,
            doorState: .text("DriverFrontOpen,PassengerRearOpen")
        ))["doors"]
        XCTAssertEqual(open?.status, .warning)
        XCTAssertEqual(open?.value, "2 Open")
    }

    func testWindowsCellOkWhenAllClosedWarningWhenOpen() {
        let closed = cells(SecurityLatestInput(locked: true, sentryMode: true))["windows"]
        XCTAssertEqual(closed?.status, .ok)
        XCTAssertEqual(closed?.value, "All Closed")

        let open = cells(SecurityLatestInput(
            locked: true, sentryMode: true,
            frontDriverWindow: .boolean(true),
            frontPassengerWindow: .text("vented")
        ))["windows"]
        XCTAssertEqual(open?.status, .warning)
        XCTAssertEqual(open?.value, "2 Open")
    }

    func testLabelsResolveThroughTheLocalizerKeys() {
        let built = SecurityCellsBuilder.build(
            latest: SecurityLatestInput(locked: true, sentryMode: true),
            localize: keyTap
        )
        XCTAssertEqual(built.map(\.label), [
            "L:widget.lock", "L:widget.sentry", "L:widget.doors", "L:widget.windows"
        ])
    }
}

// MARK: - Adapter: status → tone mapping

@MainActor final class SecurityCellStatusTests: XCTestCase {
    func testToneMapping() {
        XCTAssertEqual(SecurityCellStatus.ok.tone, .success)
        XCTAssertEqual(SecurityCellStatus.warning.tone, .warning)
        XCTAssertEqual(SecurityCellStatus.error.tone, .danger)
        XCTAssertEqual(SecurityCellStatus.inactive.tone, .neutral)
        XCTAssertEqual(SecurityCellStatus.unknown.tone, .neutral)
    }

    func testTintingMatchesWebStatusStyles() {
        XCTAssertTrue(SecurityCellStatus.ok.isTinted)
        XCTAssertTrue(SecurityCellStatus.warning.isTinted)
        XCTAssertTrue(SecurityCellStatus.error.isTinted)
        XCTAssertFalse(SecurityCellStatus.inactive.isTinted)
        XCTAssertFalse(SecurityCellStatus.unknown.isTinted)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class SecurityModelTests: XCTestCase {
    private func makeModel(
        _ update: SecurityUpdate,
        telemetry: SecurityTelemetry = OSLogSecurityTelemetry()
    ) -> (SecurityModel, InMemorySecuritySource) {
        let source = InMemorySecuritySource(initial: update)
        let model = SecurityModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SecurityUpdate(status: .loading, latest: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.cells.isEmpty)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(SecurityUpdate(status: .loaded, latest: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(SecurityUpdate(status: .failed("boom"), latest: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let latest = SecurityLatestInput(locked: true, sentryMode: true)
        let (loading, _) = makeModel(SecurityUpdate(status: .loading, latest: latest))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertEqual(loading.cells.count, 4)

        let (failed, _) = makeModel(SecurityUpdate(status: .failed("net"), latest: latest))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySecurityTelemetry()
        let (model, source) = makeModel(SecurityUpdate(status: .loading, latest: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SecurityStatusWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SecurityUpdate(status: .loaded, latest: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndCellsTrackUpdates() {
        let (model, source) = makeModel(SecurityUpdate(status: .loading, latest: nil))
        model.start()
        source.push(
            SecurityUpdate(
                status: .loaded,
                connection: .offline,
                latest: SecurityLatestInput(
                    locked: false,
                    sentryMode: true,
                    doorState: .boolean(true),
                    frontDriverWindow: .text("vented")
                ),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cells.count, 4)
        XCTAssertEqual(model.cells.first(where: { $0.id == "lock" })?.status, .error)
        XCTAssertEqual(model.cells.first(where: { $0.id == "doors" })?.value, "1 Open")
    }
}

// MARK: - Registry parity

@MainActor final class SecurityRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SecurityStatusWidget.registration
        XCTAssertEqual(registration.id, "security-status")
        XCTAssertEqual(registration.category, "security")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 2, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SecurityStatusWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 2, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 10)),
            DashboardWidgetSize(cols: 2, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class SecurityAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCellSummaryCombinesLabelValueAndStatusWord() {
        let cell = SecurityStatusCell(
            id: "lock", label: "Lock", value: "Locked", systemImage: "lock.fill", status: .ok
        )
        XCTAssertEqual(SecurityAccessibility.cellSummary(for: cell, localize: echo), "Lock, Locked, OK")
    }

    func testGridSummaryJoinsEveryCell() {
        let cells = SecurityCellsBuilder.build(
            latest: SecurityLatestInput(locked: true, sentryMode: false),
            localize: echo
        )
        let summary = SecurityAccessibility.gridSummary(for: cells, localize: echo)
        XCTAssertTrue(summary.hasPrefix("Security."))
        XCTAssertTrue(summary.contains("Lock: Locked"))
        XCTAssertTrue(summary.contains("Sentry: Off"))
    }

    func testGridSummaryFallsBackToEmptyMessage() {
        let summary = SecurityAccessibility.gridSummary(for: [], localize: echo)
        XCTAssertEqual(summary, "Security. No security data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySecurityTelemetry: SecurityTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
