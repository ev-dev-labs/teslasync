//
//  ChartExportMenu.ModelTests.swift
//  TeslaSync — P4 shared surface · 0066 · ChartExportMenu (Apple)
//
//  Telemetry + action-dispatch coverage split out of `…Tests.swift` (one concern per file): the
//  P1/S11 `view.opened` emission seam (emitted exactly once on first appearance; never
//  double-counted), the stable diagnostics slug, and the `ChartExportMenuModel` behaviour — the
//  CSV / PNG / SVG / Copy dispatch to the host callbacks and the clipboard-outcome → toast
//  announcement (incl. the graceful no-presenter degrade, the web `if (!toast) return`). Driven by
//  spies; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Diagnostics emission seam (P1/S11 view.opened)

@MainActor final class ChartExportMenuDiagnosticsTests: XCTestCase {
    func testOpenIfNeededEmitsOnce() {
        let spy = SpyChartExportMenuTelemetry()
        let emitted = ChartExportMenuDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [ChartExportMenuMeta.surfaceSlug])
    }

    func testOpenIfNeededDoesNotDoubleEmit() {
        let spy = SpyChartExportMenuTelemetry()
        var emitted = ChartExportMenuDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        emitted = ChartExportMenuDiagnostics.openIfNeeded(alreadyEmitted: emitted, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [ChartExportMenuMeta.surfaceSlug])
    }

    func testModelMarkAppearedEmitsOnceAcrossRepeatedAppearances() {
        let spy = SpyChartExportMenuTelemetry()
        let model = makeModel(telemetry: spy)
        model.markAppeared()
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, [ChartExportMenuMeta.surfaceSlug])
    }

    func testSlugIsStable() {
        XCTAssertEqual(ChartExportMenuMeta.surfaceSlug, "ChartExportMenu")
        XCTAssertEqual(ChartExportMenu.surfaceSlug, "ChartExportMenu")
    }

    func testOSLogTelemetryIsInvokable() {
        OSLogChartExportMenuTelemetry().viewOpened(surface: ChartExportMenuMeta.surfaceSlug)
    }
}

// MARK: - Action model dispatch + toast announcement

@MainActor final class ChartExportMenuModelTests: XCTestCase {
    func testHasCsvReflectsHandlerPresence() {
        XCTAssertTrue(makeModel(includeCsv: true).hasCsv)
        XCTAssertFalse(makeModel(includeCsv: false).hasCsv)
    }

    func testPerformCsvInvokesHandler() {
        let spy = ExportCallbackSpy()
        let model = makeModel(spy: spy, includeCsv: true)
        model.perform(.csv)
        XCTAssertEqual(spy.csvCount, 1)
    }

    func testExportPngAwaitsHandler() async {
        let spy = ExportCallbackSpy()
        let model = makeModel(spy: spy)
        await model.exportPNG()
        XCTAssertEqual(spy.pngCount, 1)
    }

    func testExportSvgAwaitsHandler() async {
        let spy = ExportCallbackSpy()
        let model = makeModel(spy: spy)
        await model.exportSVG()
        XCTAssertEqual(spy.svgCount, 1)
    }

    func testCopyImageAnnouncesSuccessToast() async {
        let toast = SpyChartExportMenuToast()
        let spy = ExportCallbackSpy(outcome: .copied)
        let model = makeModel(spy: spy, toast: toast)
        await model.copyImage()
        XCTAssertEqual(spy.copyCount, 1)
        XCTAssertEqual(toast.events.count, 1)
        XCTAssertEqual(toast.events.first?.severity, .success)
        XCTAssertEqual(toast.events.first?.message, "Chart image copied to clipboard")
    }

    func testCopyImageAnnouncesInfoToastOnFallback() async {
        let toast = SpyChartExportMenuToast()
        let model = makeModel(spy: ExportCallbackSpy(outcome: .fallback), toast: toast)
        await model.copyImage()
        XCTAssertEqual(toast.events.first?.severity, .info)
        XCTAssertEqual(
            toast.events.first?.message,
            "Clipboard not available — image downloaded instead"
        )
    }

    func testCopyImageAnnouncesErrorToastOnFailure() async {
        let toast = SpyChartExportMenuToast()
        let model = makeModel(spy: ExportCallbackSpy(outcome: .failed), toast: toast)
        await model.copyImage()
        XCTAssertEqual(toast.events.first?.severity, .error)
        XCTAssertEqual(toast.events.first?.message, "Failed to copy chart image")
    }

    func testCopyImageWithoutPresenterStillRunsAndIsSilent() async {
        let spy = ExportCallbackSpy(outcome: .copied)
        let model = makeModel(spy: spy, toast: nil)
        await model.copyImage()
        XCTAssertEqual(spy.copyCount, 1, "copy side effect runs even without a toast presenter")
    }
}

// MARK: - Helpers + test doubles

@MainActor
private func makeModel(
    spy: ExportCallbackSpy = ExportCallbackSpy(),
    toast: (any ChartExportMenuToastPresenter)? = nil,
    telemetry: any ChartExportMenuTelemetry = OSLogChartExportMenuTelemetry(),
    includeCsv: Bool = true
) -> ChartExportMenuModel {
    let png: @MainActor () async -> Void = { spy.pngCount += 1 }
    let svg: @MainActor () async -> Void = { spy.svgCount += 1 }
    let copy: @MainActor () async -> ChartExportClipboardOutcome = {
        spy.copyCount += 1
        return spy.outcome
    }
    let csvAction: @MainActor () -> Void = { spy.csvCount += 1 }
    let csv: (@MainActor () -> Void)? = includeCsv ? csvAction : nil
    return ChartExportMenuModel(
        onExportPNG: png,
        onExportSVG: svg,
        onCopyImage: copy,
        onExportCsv: csv,
        toast: toast,
        telemetry: telemetry
    )
}

/// Records the host export callbacks the model dispatches to, and supplies the copy outcome.
@MainActor private final class ExportCallbackSpy {
    var pngCount = 0
    var svgCount = 0
    var csvCount = 0
    var copyCount = 0
    let outcome: ChartExportClipboardOutcome

    init(outcome: ChartExportClipboardOutcome = .copied) {
        self.outcome = outcome
    }
}

/// Records `view.opened` surfaces so the telemetry contract can be asserted.
private final class SpyChartExportMenuTelemetry: ChartExportMenuTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the toast announcements the model emits so the copy-outcome mapping can be asserted.
@MainActor private final class SpyChartExportMenuToast: ChartExportMenuToastPresenter {
    private(set) var events: [(severity: ChartExportToastSeverity, message: String)] = []
    func presentToast(severity: ChartExportToastSeverity, message: String) {
        events.append((severity, message))
    }
}
