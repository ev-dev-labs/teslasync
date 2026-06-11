//
//  ExportModal.Tests.swift
//  TeslaSync — P4 modal / dialog · 0023 · ExportModal (Apple)
//
//  Adapter + projection + accessibility coverage for the ExportModal surface:
//    • `ExportProjection.prettyJSON` — valid, indented, carries the dashboard fields.
//    • `byteCount` / `formatByteSize` — the size badge (B / KB boundary + one-decimal KB).
//    • `minimalExportJSON` — the compact share payload (name / widgets / layouts; config spread).
//    • `toURLSafeBase64` — `+`/`/`/`=` stripping + a decode round-trip.
//    • `shareURL` — the `${origin}/dashboard#import=` composition + trailing-slash normalization.
//    • `isShareURLTooLong` — the 2000-character ceiling.
//    • `phase` / `inlineFailure` — the loading / loaded-empty / failed envelopes + the cached-reload
//      inline error.
//    • `miniGrid` — the 4-column geometry, the `max(y+h)` row span + the empty fallback, and the
//      dangling-layout-entry guard.
//    • `ExportAccessibility` — the dialog + summary VoiceOver content.
//
//  The state-holder coverage lives in ExportModal.ModelTests.swift. Pure, bundle-free: copy resolves
//  through an identity localizer.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum ProjectionSample {
    static let updated = Date(timeIntervalSince1970: 1_767_268_800)

    static func dashboard(
        name: String = "Garage",
        icon: String = "🔋",
        widgets: [ExportWidgetInstance]? = nil,
        layout: [ExportLayoutItem]? = nil
    ) -> DashboardExportDescriptor {
        DashboardExportDescriptor(
            id: "dash-1",
            name: name,
            icon: icon,
            widgets: widgets ?? defaultWidgets,
            layouts: ["lg": layout ?? defaultLayout],
            updatedAt: updated
        )
    }

    static let defaultWidgets = [
        ExportWidgetInstance(id: "w1", widgetID: "battery", config: .object(["vehicleId": .int(2)])),
        ExportWidgetInstance(id: "w2", widgetID: "speed")
    ]

    static let defaultLayout = [
        ExportLayoutItem(itemID: "w1", x: 0, y: 0, width: 2, height: 2),
        ExportLayoutItem(itemID: "w2", x: 2, y: 0, width: 2, height: 4)
    ]
}

final class ExportProjectionTests: XCTestCase {
    // MARK: prettyJSON

    func testPrettyJSONIsValidIndentedAndCarriesFields() throws {
        let json = ExportProjection.prettyJSON(for: ProjectionSample.dashboard())
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
        )
        XCTAssertEqual(object["name"] as? String, "Garage")
        XCTAssertEqual(object["icon"] as? String, "🔋")
        XCTAssertNotNil(object["widgets"])
        XCTAssertNotNil(object["layouts"])
        XCTAssertTrue(json.contains("\n  "), "pretty JSON should be 2-space indented")
    }

    func testByteCountMatchesUTF8LengthOfPrettyJSON() {
        let dashboard = ProjectionSample.dashboard()
        let json = ExportProjection.prettyJSON(for: dashboard)
        XCTAssertEqual(ExportProjection.byteCount(for: dashboard), json.utf8.count)
    }

    // MARK: formatByteSize

    func testFormatByteSizeBelowKilobyteUsesBytes() {
        XCTAssertEqual(ExportProjection.formatByteSize(0), "0 B")
        XCTAssertEqual(ExportProjection.formatByteSize(500), "500 B")
        XCTAssertEqual(ExportProjection.formatByteSize(1023), "1023 B")
    }

    func testFormatByteSizeAtOrAboveKilobyteUsesOneDecimalKB() {
        XCTAssertEqual(ExportProjection.formatByteSize(1024), "1.0 KB")
        XCTAssertEqual(ExportProjection.formatByteSize(1536), "1.5 KB")
        XCTAssertEqual(ExportProjection.formatByteSize(2048), "2.0 KB")
    }

    // MARK: minimalExportJSON

    func testMinimalExportIsCompactAndCarriesShareFields() {
        let json = ExportProjection.minimalExportJSON(for: ProjectionSample.dashboard())
        XCTAssertFalse(json.contains("\n"), "minimal share payload should be compact")
        XCTAssertTrue(json.contains("\"name\""))
        XCTAssertTrue(json.contains("\"widgets\""))
        XCTAssertTrue(json.contains("\"layouts\""))
    }

    func testMinimalExportOmitsIconAndKeepsPresentConfig() {
        let json = ExportProjection.minimalExportJSON(for: ProjectionSample.dashboard())
        XCTAssertFalse(json.contains("\"icon\""), "minimal payload drops the icon (web buildMinimalExport)")
        XCTAssertTrue(json.contains("\"config\""), "minimal payload keeps a present widget config")
    }

    func testMinimalExportOmitsConfigWhenAbsent() {
        let dashboard = ProjectionSample.dashboard(
            widgets: [ExportWidgetInstance(id: "only", widgetID: "speed")]
        )
        let json = ExportProjection.minimalExportJSON(for: dashboard)
        XCTAssertFalse(json.contains("\"config\""), "no config key when the widget has none")
    }

    // MARK: toURLSafeBase64

    func testURLSafeBase64StripsNonURLCharacters() {
        let encoded = ExportProjection.toURLSafeBase64("Hello, world!?/+=")
        XCTAssertFalse(encoded.contains("+"))
        XCTAssertFalse(encoded.contains("/"))
        XCTAssertFalse(encoded.contains("="))
    }

    func testURLSafeBase64RoundTrips() throws {
        let original = "{\"name\":\"Garáge ⚡\"}"
        let encoded = ExportProjection.toURLSafeBase64(original)
        var padded = encoded
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while padded.count % 4 != 0 {
            padded += "="
        }
        let data = try XCTUnwrap(Data(base64Encoded: padded))
        XCTAssertEqual(String(bytes: data, encoding: .utf8), original)
    }

    // MARK: shareURL + over-length

    func testShareURLComposesAndNormalizesTrailingSlash() {
        let url = ExportProjection.shareURL(for: ProjectionSample.dashboard(), origin: "https://app.teslasync.io/")
        XCTAssertTrue(url.hasPrefix("https://app.teslasync.io/dashboard#import="))
        XCTAssertFalse(url.contains("io//dashboard"), "trailing slash should be normalized")
    }

    func testIsShareURLTooLongHonorsTheCeiling() {
        XCTAssertFalse(ExportProjection.isShareURLTooLong(String(repeating: "a", count: 2000)))
        XCTAssertTrue(ExportProjection.isShareURLTooLong(String(repeating: "a", count: 2001)))
    }

    // MARK: phase + inline failure

    func testPhaseLoading() {
        XCTAssertEqual(ExportProjection.phase(status: .loading, hasDashboard: false), .loading)
        XCTAssertEqual(ExportProjection.phase(status: .loading, hasDashboard: true), .populated)
    }

    func testPhaseLoaded() {
        XCTAssertEqual(ExportProjection.phase(status: .loaded, hasDashboard: false), .empty)
        XCTAssertEqual(ExportProjection.phase(status: .loaded, hasDashboard: true), .populated)
    }

    func testPhaseFailed() {
        XCTAssertEqual(ExportProjection.phase(status: .failed("x"), hasDashboard: false), .error("x"))
        XCTAssertEqual(ExportProjection.phase(status: .failed("x"), hasDashboard: true), .populated)
    }

    func testInlineFailureOnlyWithCachedDashboard() {
        XCTAssertEqual(ExportProjection.inlineFailure(status: .failed("x"), hasDashboard: true), "x")
        XCTAssertNil(ExportProjection.inlineFailure(status: .failed("x"), hasDashboard: false))
        XCTAssertNil(ExportProjection.inlineFailure(status: .loaded, hasDashboard: true))
    }

    // MARK: miniGrid

    func testMiniGridGeometry() {
        let grid = ExportProjection.miniGrid(for: ProjectionSample.dashboard())
        XCTAssertEqual(grid.columns, 4)
        XCTAssertEqual(grid.rows, 4) // max(y + h) over the sample layout
        XCTAssertEqual(grid.cells.count, 2)
        XCTAssertEqual(grid.aspectRatio, 1.0, accuracy: 0.0001)
        let first = try? XCTUnwrap(grid.cells.first)
        XCTAssertEqual(first?.widthFraction ?? 0, 0.5, accuracy: 0.0001) // 2 / 4 columns
        XCTAssertEqual(first?.hasWidget, true)
    }

    func testMiniGridEmptyLayoutFallsBackToTwoRows() {
        let dashboard = DashboardExportDescriptor(
            id: "empty", name: "Empty", widgets: [], layouts: [:], updatedAt: ProjectionSample.updated
        )
        XCTAssertEqual(ExportProjection.miniGrid(for: dashboard).rows, ExportProjection.fallbackRows)
    }

    func testMiniGridDanglingLayoutEntryHasNoWidget() {
        let dashboard = ProjectionSample.dashboard(
            widgets: [ExportWidgetInstance(id: "present", widgetID: "speed")],
            layout: [ExportLayoutItem(itemID: "ghost", x: 0, y: 0, width: 1, height: 1)]
        )
        let grid = ExportProjection.miniGrid(for: dashboard)
        XCTAssertEqual(grid.cells.first?.hasWidget, false)
    }

    // MARK: Constants

    func testConstantsMatchWeb() {
        XCTAssertEqual(ExportConstants.shareURLMaxLength, 2000)
        XCTAssertEqual(ExportConstants.bytesPerKilobyte, 1024)
        XCTAssertEqual(DashboardExportDescriptor.defaultIcon, "📊")
        XCTAssertEqual(DashboardExportDescriptor.previewBreakpoint, "lg")
    }

    func testPreviewLayoutReadsTheLGBreakpoint() {
        XCTAssertEqual(ProjectionSample.dashboard().previewLayout.count, 2)
        let other = DashboardExportDescriptor(
            id: "x", name: "X", widgets: [], layouts: ["md": []], updatedAt: ProjectionSample.updated
        )
        XCTAssertTrue(other.previewLayout.isEmpty)
    }
}

final class ExportAccessibilityTests: XCTestCase {
    func testDialogLabel() {
        XCTAssertEqual(
            ExportAccessibility.dialogLabel(localize: passthroughLocalize),
            "Export Dashboard"
        )
    }

    func testSummaryLabelJoinsNameCountAndSize() {
        XCTAssertEqual(
            ExportAccessibility.summaryLabel(name: "Garage", widgetCount: "2 widgets", size: "1.2 KB"),
            "Garage, 2 widgets, 1.2 KB"
        )
    }
}
