//
//  ImportPreviewModal.Tests.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  Adapter + projection + accessibility coverage for the ImportPreviewModal surface:
//    • `ImportPreviewTab` — id, label key + fallback.
//    • `ImportPreviewValidator` — the faithful `validateImportData` port (parse guards, required
//      fields, widget dedupe, registry availability split, layout clamp, dashboard build, name slice).
//    • `ImportPreviewURLDecoder` — the `fromUrlSafeBase64` round-trip + the `#import=` / `?import=`
//      extraction + the no-param / invalid-url arms.
//    • `ImportPreviewProjection` — the title, the count badges, the widget rows, the mini-grid math.
//    • `DefaultImportPreviewWidgetCatalog` — registry coverage + lookup hit/miss.
//    • `ImportPreviewAccessibility` — the dialog / close / widget-row VoiceOver content.
//
//  The state-holder coverage lives in ImportPreviewModal.ModelTests.swift. Pure, bundle-free: copy
//  resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// A tiny deterministic catalog so the projection/validator tests don't depend on the full registry.
private struct StubImportPreviewCatalog: ImportPreviewWidgetCatalog {
    let registryIDs: Set<String> = ["battery-gauge", "range-bar", "speed-profile"]

    func definition(forWidgetID widgetID: String) -> ImportPreviewWidgetDef? {
        switch widgetID {
        case "battery-gauge": ImportPreviewWidgetDef(name: "Battery Level", icon: "battery.100")
        case "range-bar": ImportPreviewWidgetDef(name: "Range Bar", icon: "gauge.medium")
        case "speed-profile": ImportPreviewWidgetDef(name: "Speed Profile", icon: "waveform.path.ecg")
        default: nil
        }
    }
}

private func urlSafeBase64(_ value: String) -> String {
    Data(value.utf8).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

final class ImportPreviewModalAdapterTests: XCTestCase {
    private let registry: Set<String> = ["battery-gauge", "range-bar", "speed-profile"]

    private func validate(_ raw: String) -> ImportPreviewValidation {
        ImportPreviewValidator.validate(
            raw,
            registryIDs: registry,
            localize: passthroughLocalize,
            instanceID: { "gen" },
            dashboardID: { "import-fixed" }
        )
    }

    // MARK: Tab

    func testTabLabelKeysAndFallbacks() {
        XCTAssertEqual(ImportPreviewTab.file.id, "file")
        XCTAssertEqual(ImportPreviewTab.file.labelKey, "import.fromFile")
        XCTAssertEqual(ImportPreviewTab.file.labelFallback, "From File")
        XCTAssertEqual(ImportPreviewTab.paste.labelKey, "import.fromClipboard")
        XCTAssertEqual(ImportPreviewTab.paste.labelFallback, "Paste JSON")
        XCTAssertEqual(ImportPreviewTab.url.labelKey, "import.fromUrl")
        XCTAssertEqual(ImportPreviewTab.url.labelFallback, "From URL")
        XCTAssertEqual(ImportPreviewTab.allCases.count, 3)
    }

    // MARK: Validator — parse + required-field guards

    func testInvalidJSONReturnsInvalid() {
        let result = validate("{ not json")
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors, ["Invalid JSON format"])
        XCTAssertNil(result.dashboard)
    }

    func testNonObjectJSONReturnsExpectedObject() {
        let result = validate("[1, 2, 3]")
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors, ["Expected a JSON object"])
    }

    func testMissingRequiredFieldsCollectsEveryError() {
        let result = validate("{}")
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors, [
            #"Missing or invalid "name" field"#,
            #"Missing or invalid "widgets" array"#,
            #"Missing or invalid "layouts" object"#
        ])
        XCTAssertNil(result.dashboard)
    }

    // MARK: Validator — availability

    func testValidImportResolvesDashboardAndAvailability() {
        let result = validate(#"""
        {
          "name": "Trip",
          "widgets": [
            { "id": "w1", "widgetId": "battery-gauge" },
            { "id": "w2", "widgetId": "range-bar" }
          ],
          "layouts": { "lg": [ { "i": "w1", "x": 0, "y": 0, "w": 1, "h": 2 } ] }
        }
        """#)
        XCTAssertTrue(result.isValid)
        XCTAssertEqual(result.availableWidgets, ["battery-gauge", "range-bar"])
        XCTAssertTrue(result.missingWidgets.isEmpty)
        XCTAssertEqual(result.dashboard?.name, "Trip")
        XCTAssertEqual(result.dashboard?.id, "import-fixed")
        XCTAssertEqual(result.dashboard?.layout(for: "lg").count, 1)
    }

    func testUnknownWidgetWarnsAndIsSkipped() {
        let result = validate(#"""
        {
          "name": "Mix",
          "widgets": [
            { "id": "w1", "widgetId": "battery-gauge" },
            { "id": "w2", "widgetId": "legacy-mystery" }
          ],
          "layouts": {}
        }
        """#)
        XCTAssertTrue(result.isValid)
        XCTAssertEqual(result.availableWidgets, ["battery-gauge"])
        XCTAssertEqual(result.missingWidgets, ["legacy-mystery"])
        XCTAssertEqual(result.warnings, ["1 widget(s) not available and will be skipped"])
    }

    func testNoCompatibleWidgetsResolvesEmptyDashboard() {
        let result = validate(#"""
        { "name": "Broken", "widgets": [{ "id": "w1", "widgetId": "nope" }], "layouts": {} }
        """#)
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors, ["No compatible widgets found in this layout"])
        XCTAssertNil(result.dashboard)
        XCTAssertEqual(result.missingWidgets, ["nope"])
    }

    // MARK: Validator — layout clamp + dedupe + name slice

    func testLayoutCoordinatesAreClampedIntoTheGrid() throws {
        let result = validate(#"""
        {
          "name": "Clamp",
          "widgets": [{ "id": "w1", "widgetId": "battery-gauge" }],
          "layouts": { "lg": [ { "i": "w1", "x": 99, "y": -3, "w": 99, "h": 99 } ] }
        }
        """#)
        let item = try XCTUnwrap(result.dashboard?.layout(for: "lg").first)
        XCTAssertEqual(item.x, 3) // clamped to cols-1 (lg = 4)
        XCTAssertEqual(item.y, 0) // negative → 0
        XCTAssertEqual(item.widthUnits, 4) // clamped to cols
        XCTAssertEqual(item.heightUnits, 8) // clamped to max 8
    }

    func testLayoutItemsForUnknownInstanceAreDropped() {
        let result = validate(#"""
        {
          "name": "Stray",
          "widgets": [{ "id": "w1", "widgetId": "battery-gauge" }],
          "layouts": { "lg": [ { "i": "ghost", "x": 0, "y": 0, "w": 1, "h": 1 } ] }
        }
        """#)
        XCTAssertEqual(result.dashboard?.layout(for: "lg").count, 0)
    }

    func testDuplicateWidgetIDsAreDeduped() {
        var counter = 0
        let result = ImportPreviewValidator.validate(#"""
        {
          "name": "Dupes",
          "widgets": [
            { "id": "w1", "widgetId": "battery-gauge" },
            { "id": "w1", "widgetId": "range-bar" }
          ],
          "layouts": {}
        }
        """#, registryIDs: registry, localize: passthroughLocalize, instanceID: {
            counter += 1
            return "gen\(counter)"
        }, dashboardID: { "import-fixed" })
        let ids = result.dashboard?.widgets.map(\.id)
        XCTAssertEqual(ids?.count, 2)
        XCTAssertEqual(ids?.first, "w1")
        XCTAssertNotEqual(ids?.last, "w1") // second occurrence deduped
    }

    func testNameIsSlicedToHundredCharacters() {
        let longName = String(repeating: "a", count: 250)
        let result = validate(#"""
        { "name": "\#(longName)", "widgets": [{ "id": "w1", "widgetId": "battery-gauge" }], "layouts": {} }
        """#)
        XCTAssertEqual(result.dashboard?.name.count, 100)
    }

    // MARK: URL decoder

    func testURLSafeBase64RoundTrips() {
        let json = #"{"name":"Demo +/ test"}"#
        XCTAssertEqual(ImportPreviewURLDecoder.fromURLSafeBase64(urlSafeBase64(json)), json)
    }

    func testExtractFromHashImport() {
        let json = #"{"name":"Hashed"}"#
        let url = "https://teslasync.example.com/dashboard#import=\(urlSafeBase64(json))"
        XCTAssertEqual(ImportPreviewURLDecoder.extract(url), .json(json))
    }

    func testExtractFromQueryImport() {
        let json = #"{"name":"Queried"}"#
        let url = "https://teslasync.example.com/dashboard?import=\(urlSafeBase64(json))"
        XCTAssertEqual(ImportPreviewURLDecoder.extract(url), .json(json))
    }

    func testExtractNoParamAndInvalidURL() {
        XCTAssertEqual(ImportPreviewURLDecoder.extract("https://teslasync.example.com/dashboard"), .noParam)
        XCTAssertEqual(ImportPreviewURLDecoder.extract("not a url"), .invalidURL)
        XCTAssertEqual(ImportPreviewURLDecoder.extract("https://x.example/#import=@@@@"), .invalidURL)
    }

    // MARK: Projection — title + badges + rows + grid

    func testTitleSwitchesOnPreview() {
        let input = ImportPreviewProjection.title(isPreview: false, localize: passthroughLocalize)
        let preview = ImportPreviewProjection.title(isPreview: true, localize: passthroughLocalize)
        XCTAssertEqual(input, "Import Dashboard")
        XCTAssertEqual(preview, "Import Preview")
    }

    func testBadgesIncludeSkippedOnlyWhenMissing() {
        let clean = ImportPreviewValidation(
            isValid: true, errors: [], warnings: [], dashboard: nil,
            missingWidgets: [], availableWidgets: ["a", "b"]
        )
        let cleanBadges = ImportPreviewProjection.badges(for: clean, localize: passthroughLocalize)
        XCTAssertEqual(cleanBadges.map(\.text), ["2 widgets"])

        let mixed = ImportPreviewValidation(
            isValid: true, errors: [], warnings: [], dashboard: nil,
            missingWidgets: ["x"], availableWidgets: ["a", "b"]
        )
        let mixedBadges = ImportPreviewProjection.badges(for: mixed, localize: passthroughLocalize)
        XCTAssertEqual(mixedBadges.map(\.text), ["2 widgets", "1 skipped"])
        XCTAssertEqual(mixedBadges.map(\.kind), [.available, .skipped])
    }

    func testWidgetRowsResolveNamesIconsAndAvailability() {
        let validation = ImportPreviewValidation(
            isValid: true, errors: [], warnings: [], dashboard: nil,
            missingWidgets: ["legacy-mystery"], availableWidgets: ["battery-gauge"]
        )
        let rows = ImportPreviewProjection.widgetRows(for: validation, catalog: StubImportPreviewCatalog())
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].name, "Battery Level")
        XCTAssertEqual(rows[0].icon, "battery.100")
        XCTAssertTrue(rows[0].available)
        XCTAssertEqual(rows[1].name, "legacy-mystery")
        XCTAssertNil(rows[1].icon)
        XCTAssertFalse(rows[1].available)
    }

    func testGridMathProducesFractionalTilesAndAspectRatio() {
        let dashboard = ImportPreviewDashboard(
            id: "d",
            name: "Grid",
            widgets: [ImportPreviewWidgetInstance(id: "w1", widgetID: "battery-gauge")],
            layouts: ["lg": [ImportPreviewLayoutItem(identifier: "w1", x: 2, y: 1, widthUnits: 2, heightUnits: 3)]]
        )
        let grid = ImportPreviewProjection.grid(for: dashboard, catalog: StubImportPreviewCatalog())
        XCTAssertEqual(grid.columns, 4)
        XCTAssertEqual(grid.rows, 4) // maxY = y + h = 1 + 3
        XCTAssertFalse(grid.isEmpty)
        let tile = grid.tiles[0]
        XCTAssertEqual(tile.originX, 0.5, accuracy: 0.0001) // 2/4
        XCTAssertEqual(tile.width, 0.5, accuracy: 0.0001)
        XCTAssertEqual(tile.height, 0.75, accuracy: 0.0001) // 3/4
        XCTAssertEqual(tile.systemImage, "battery.100")
    }

    func testEmptyGridUsesFallbackRows() {
        let dashboard = ImportPreviewDashboard(id: "d", name: "Empty", widgets: [], layouts: [:])
        let grid = ImportPreviewProjection.grid(for: dashboard, catalog: StubImportPreviewCatalog())
        XCTAssertTrue(grid.isEmpty)
        XCTAssertEqual(grid.rows, 2) // fallback
        XCTAssertEqual(grid.aspectRatio, 2, accuracy: 0.0001) // 4 / 2
    }

    // MARK: Catalog

    func testDefaultCatalogCoversTheFullRegistry() {
        let catalog = DefaultImportPreviewWidgetCatalog()
        XCTAssertEqual(DefaultImportPreviewWidgetCatalog.coverage, 118)
        XCTAssertEqual(catalog.registryIDs.count, 118)
        XCTAssertEqual(catalog.definition(forWidgetID: "battery-gauge")?.name, "Battery Level")
        XCTAssertEqual(catalog.definition(forWidgetID: "battery-gauge")?.icon, "battery.100")
        XCTAssertNil(catalog.definition(forWidgetID: "does-not-exist"))
    }

    // MARK: Accessibility

    func testAccessibilityLabels() {
        XCTAssertEqual(
            ImportPreviewAccessibility.dialogLabel(isPreview: false, localize: passthroughLocalize),
            "Import Dashboard"
        )
        XCTAssertEqual(ImportPreviewAccessibility.closeLabel(localize: passthroughLocalize), "Close")
        let available = ImportPreviewWidgetRow(
            id: "ok-0-a", widgetID: "a", name: "Battery Level", icon: "battery.100", available: true
        )
        XCTAssertEqual(
            ImportPreviewAccessibility.widgetRowLabel(available, localize: passthroughLocalize),
            "Battery Level, available"
        )
        let missing = ImportPreviewWidgetRow(
            id: "no-0-x", widgetID: "x", name: "x", icon: nil, available: false
        )
        XCTAssertEqual(
            ImportPreviewAccessibility.widgetRowLabel(missing, localize: passthroughLocalize),
            "x, Not available"
        )
    }
}
