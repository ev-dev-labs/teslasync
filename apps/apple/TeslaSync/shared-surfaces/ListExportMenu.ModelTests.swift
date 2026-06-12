//
//  ListExportMenu.ModelTests.swift
//  TeslaSync — P4 shared surface · 0155 · ListExportMenu (Apple)
//
//  Telemetry + export-dispatch coverage split out of `…Tests.swift` (one concern per file): the
//  P1/S11 `view.opened` emission seam (emitted exactly once on first appearance; never
//  double-counted), the stable diagnostics slug, and the `ListExportMenuModel` behaviour — the CSV /
//  JSON dispatch to the host callbacks with the chosen scope (the parity of the web
//  `onExportCsv(scope)` / `onExportJson(scope)` calls), through both the unified `onExport` sink and
//  the two-callback convenience initializer. Driven by spies; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Diagnostics emission seam (P1/S11 view.opened)

@MainActor final class ListExportMenuDiagnosticsTests: XCTestCase {
    func testOpenIfNeededEmitsOnce() {
        let spy = SpyListExportMenuTelemetry()
        let emitted = ListExportMenuDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [ListExportMenuMeta.surfaceSlug])
    }

    func testOpenIfNeededDoesNotDoubleEmit() {
        let spy = SpyListExportMenuTelemetry()
        var emitted = ListExportMenuDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        emitted = ListExportMenuDiagnostics.openIfNeeded(alreadyEmitted: emitted, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [ListExportMenuMeta.surfaceSlug])
    }

    func testModelMarkAppearedEmitsOnceAcrossRepeatedAppearances() {
        let spy = SpyListExportMenuTelemetry()
        let model = makeModel(telemetry: spy)
        model.markAppeared()
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, [ListExportMenuMeta.surfaceSlug])
    }

    func testSlugIsStable() {
        XCTAssertEqual(ListExportMenuMeta.surfaceSlug, "ListExportMenu")
        XCTAssertEqual(ListExportMenu.surfaceSlug, "ListExportMenu")
    }

    func testOSLogTelemetryIsInvokable() {
        OSLogListExportMenuTelemetry().viewOpened(surface: ListExportMenuMeta.surfaceSlug)
    }
}

// MARK: - Action model dispatch (web onExportCsv / onExportJson with the chosen scope)

@MainActor final class ListExportMenuModelTests: XCTestCase {
    func testExportCsvDispatchesToCsvHandlerWithScope() {
        let spy = ExportSpy()
        let model = makeModel(spy: spy)
        model.export(.csv, scope: .selected)
        XCTAssertEqual(spy.csv, [.selected])
        XCTAssertTrue(spy.json.isEmpty)
    }

    func testExportJsonDispatchesToJsonHandlerWithScope() {
        let spy = ExportSpy()
        let model = makeModel(spy: spy)
        model.export(.json, scope: .visible)
        XCTAssertEqual(spy.json, [.visible])
        XCTAssertTrue(spy.csv.isEmpty)
    }

    func testUnifiedExportSinkReceivesFormatAndScope() {
        var received: [(ListExportFormat, ListExportScope)] = []
        let model = ListExportMenuModel(
            onExport: { format, scope in received.append((format, scope)) },
            telemetry: SpyListExportMenuTelemetry()
        )
        model.export(.csv, scope: .visible)
        model.export(.json, scope: .selected)
        XCTAssertEqual(received.map(\.0), [.csv, .json])
        XCTAssertEqual(received.map(\.1), [.visible, .selected])
    }

    func testConvenienceInitRoutesEachFormatToItsHandler() {
        let spy = ExportSpy()
        let model = ListExportMenuModel(
            onExportCsv: { spy.csv.append($0) },
            onExportJson: { spy.json.append($0) },
            telemetry: SpyListExportMenuTelemetry()
        )
        model.export(.csv, scope: .visible)
        model.export(.json, scope: .selected)
        XCTAssertEqual(spy.csv, [.visible])
        XCTAssertEqual(spy.json, [.selected])
    }
}

// MARK: - Helpers + test doubles

@MainActor
private func makeModel(
    spy: ExportSpy = ExportSpy(),
    telemetry: any ListExportMenuTelemetry = OSLogListExportMenuTelemetry()
) -> ListExportMenuModel {
    ListExportMenuModel(
        onExportCsv: { spy.csv.append($0) },
        onExportJson: { spy.json.append($0) },
        telemetry: telemetry
    )
}

/// Records the scopes handed to each host export callback so the dispatch contract can be asserted.
@MainActor private final class ExportSpy {
    var csv: [ListExportScope] = []
    var json: [ListExportScope] = []
}

/// Records `view.opened` surfaces so the telemetry contract can be asserted.
private final class SpyListExportMenuTelemetry: ListExportMenuTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
