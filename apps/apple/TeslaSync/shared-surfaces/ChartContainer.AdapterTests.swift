//
//  ChartContainer.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  Pure-core coverage for the ChartContainer surface — the annotation adapter (cached → projection),
//  the decision logic, the projection, the CSV serialiser, the writing-direction label anchor, the
//  accessibility builders, and the i18n key set. Everything here is Foundation-only and reads the pure
//  types directly (no store, no rendered view), so each web boolean / branch is asserted in isolation.
//  Runs in the TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter (web `toDataAnnotation` — cached → projection)

final class ChartContainerAnnotationAdapterTests: XCTestCase {
    private func row(
        id: Int64 = 42,
        vehicleID: Int64? = 7,
        category: String = "maintenance",
        scope: [String] = ["battery"],
        description: String? = "Rotated tires"
    ) -> ChartContainerAnnotationRow {
        ChartContainerAnnotationRow(
            id: id,
            vehicleID: vehicleID,
            occurredAt: "2026-05-02T10:00:00Z",
            category: category,
            title: "Tire rotation",
            description: description,
            scope: scope,
            createdAt: "2026-05-02T11:00:00Z",
            updatedAt: "2026-05-02T11:00:00Z"
        )
    }

    func testProjectMapsEveryField() {
        let annotation = ChartContainerAnnotationAdapter.project(row())
        XCTAssertEqual(annotation.id, "42") // web `String(row.id)`
        XCTAssertEqual(annotation.timestamp, "2026-05-02T10:00:00Z") // web `occurred_at`
        XCTAssertEqual(annotation.label, "Tire rotation") // web `title`
        XCTAssertEqual(annotation.description, "Rotated tires")
        XCTAssertEqual(annotation.category, .maintenance)
        XCTAssertEqual(annotation.context, "battery") // web `scope[0]`
        XCTAssertEqual(annotation.vehicleID, 7)
        XCTAssertEqual(annotation.createdAt, "2026-05-02T11:00:00Z")
    }

    func testProjectUnknownCategoryFallsBackToCustom() {
        XCTAssertEqual(ChartContainerAnnotationAdapter.project(row(category: "weird")).category, .custom)
    }

    func testProjectEmptyScopeYieldsEmptyContext() {
        XCTAssertEqual(ChartContainerAnnotationAdapter.project(row(scope: [])).context, "")
    }

    func testProjectNilVehicleMapsToNil() {
        XCTAssertNil(ChartContainerAnnotationAdapter.project(row(vehicleID: nil)).vehicleID)
    }

    func testProjectAllPreservesOrder() {
        let rows = [row(id: 1), row(id: 2), row(id: 3)]
        XCTAssertEqual(ChartContainerAnnotationAdapter.projectAll(rows).map(\.id), ["1", "2", "3"])
    }

    func testWireRowDecodesSnakeCase() throws {
        let json = Data("""
        {"id":9,"vehicle_id":3,"occurred_at":"2026-01-01T00:00:00Z","category":"trip",
         "title":"Road trip","scope":["mileage"],"created_at":"2026-01-01T00:00:00Z",
         "updated_at":"2026-01-01T00:00:00Z"}
        """.utf8)
        let decoded = try JSONDecoder().decode(ChartContainerAnnotationRow.self, from: json)
        XCTAssertEqual(decoded.vehicleID, 3)
        XCTAssertEqual(ChartContainerAnnotationAdapter.project(decoded).category, .trip)
    }
}

// MARK: - Category palette + labels

final class ChartContainerAnnotationCategoryTests: XCTestCase {
    func testColorHexMatchesWebPalette() {
        XCTAssertEqual(ChartContainerAnnotationCategory.milestone.colorHex, "#3b82f6")
        XCTAssertEqual(ChartContainerAnnotationCategory.issue.colorHex, "#ef4444")
        XCTAssertEqual(ChartContainerAnnotationCategory.custom.colorHex, "#94a3b8")
    }

    func testLabelFallbackMatchesWeb() {
        XCTAssertEqual(ChartContainerAnnotationCategory.maintenance.labelFallback, "Maintenance")
        XCTAssertEqual(ChartContainerAnnotationCategory.upgrade.labelFallback, "Upgrade")
    }

    func testParseFallsBackToCustom() {
        XCTAssertEqual(ChartContainerAnnotationCategory.parse("issue"), .issue)
        XCTAssertEqual(ChartContainerAnnotationCategory.parse(""), .custom)
    }
}

// MARK: - Writing direction + label anchor (web `useChartLabelAnchor` / `textAnchorForDir`)

final class ChartContainerLabelAnchorTests: XCTestCase {
    func testDirectionResolvesRtlPrimarySubtags() {
        XCTAssertEqual(ChartContainerDirection.resolve("ar-SA"), .rtl)
        XCTAssertEqual(ChartContainerDirection.resolve("he"), .rtl)
        XCTAssertEqual(ChartContainerDirection.resolve("en-US"), .ltr)
        XCTAssertEqual(ChartContainerDirection.resolve(nil), .ltr)
        XCTAssertEqual(ChartContainerDirection.resolve(""), .ltr)
    }

    func testAnchorFlipsOnYAxisOnly() {
        // Web `textAnchorForDir`: x always middle; y flips end (LTR) / start (RTL).
        XCTAssertEqual(ChartContainerLabelAnchor.anchor(axis: .x, direction: .ltr), .middle)
        XCTAssertEqual(ChartContainerLabelAnchor.anchor(axis: .x, direction: .rtl), .middle)
        XCTAssertEqual(ChartContainerLabelAnchor.anchor(axis: .y, direction: .ltr), .end)
        XCTAssertEqual(ChartContainerLabelAnchor.anchor(axis: .y, direction: .rtl), .start)
    }
}

// MARK: - Cell text (web `format ?? (null → —)`)

final class ChartContainerCellTests: XCTestCase {
    func testMissingRendersEmDash() {
        XCTAssertEqual(ChartContainerLogic.cellText(.missing, format: nil), "—")
    }

    func testTextRendersVerbatim() {
        XCTAssertEqual(ChartContainerLogic.cellText(.text("Mon"), format: nil), "Mon")
    }

    func testIntegralNumberHasNoTrailingDecimal() {
        XCTAssertEqual(ChartContainerLogic.cellText(.number(92), format: nil), "92")
    }

    func testFormatterOverridesDefault() {
        let format: (ChartContainerCell) -> String = { _ in "94.0 kWh" }
        XCTAssertEqual(ChartContainerLogic.cellText(.number(94), format: format), "94.0 kWh")
    }
}

// MARK: - Logic (web `ChartContainer` booleans)

final class ChartContainerLogicTests: XCTestCase {
    func testShowExportMenuMirrorsWeb() {
        XCTAssertTrue(ChartContainerLogic.showExportMenu(exportable: true, loading: false, empty: false))
        XCTAssertFalse(ChartContainerLogic.showExportMenu(exportable: false, loading: false, empty: false))
        XCTAssertFalse(ChartContainerLogic.showExportMenu(exportable: true, loading: true, empty: false))
        XCTAssertFalse(ChartContainerLogic.showExportMenu(exportable: true, loading: false, empty: true))
    }

    func testHasFallbackTableRequiresBoth() {
        XCTAssertTrue(ChartContainerLogic.hasFallbackTable(rowCount: 3, columnCount: 2))
        XCTAssertFalse(ChartContainerLogic.hasFallbackTable(rowCount: 0, columnCount: 2))
        XCTAssertFalse(ChartContainerLogic.hasFallbackTable(rowCount: 3, columnCount: 0))
    }

    func testVisibleAnnotationsCollapseWhenHiddenOrDisabled() {
        let fetched = [sampleAnnotation()]
        XCTAssertEqual(ChartContainerLogic.visibleAnnotations(enabled: true, hidden: false, fetched: fetched), fetched)
        XCTAssertTrue(ChartContainerLogic.visibleAnnotations(enabled: true, hidden: true, fetched: fetched).isEmpty)
        XCTAssertTrue(ChartContainerLogic.visibleAnnotations(enabled: false, hidden: false, fetched: fetched).isEmpty)
    }

    func testShowMarkerRow() {
        XCTAssertTrue(ChartContainerLogic.showMarkerRow(enabled: true, hidden: false, visibleCount: 2))
        XCTAssertFalse(ChartContainerLogic.showMarkerRow(enabled: true, hidden: true, visibleCount: 2))
        XCTAssertFalse(ChartContainerLogic.showMarkerRow(enabled: true, hidden: false, visibleCount: 0))
    }

    func testHiddenStorageKeyMatchesWebPrefix() {
        XCTAssertEqual(ChartContainerLogic.hiddenStorageKey("battery"), "teslasync-annotations-hidden:battery")
    }

    func testIsValidNewAnnotation() {
        XCTAssertTrue(ChartContainerLogic.isValidNewAnnotation(label: "Tire", occurredAt: "2026-01-01T00:00:00Z"))
        XCTAssertFalse(ChartContainerLogic.isValidNewAnnotation(label: " ", occurredAt: "2026-01-01T00:00:00Z"))
        XCTAssertFalse(ChartContainerLogic.isValidNewAnnotation(label: "Tire", occurredAt: ""))
    }

    func testIsRemovableID() {
        XCTAssertTrue(ChartContainerLogic.isRemovableID("42"))
        XCTAssertFalse(ChartContainerLogic.isRemovableID("0"))
        XCTAssertFalse(ChartContainerLogic.isRemovableID("-3"))
        XCTAssertFalse(ChartContainerLogic.isRemovableID("abc"))
    }
}

// MARK: - CSV serialiser (web `objectsToCSV`)

final class ChartContainerCsvTests: XCTestCase {
    private let columns = [
        ChartContainerDataColumn(key: "day", label: "Day"),
        ChartContainerDataColumn(key: "soh", label: "SoH")
    ]

    func testHeaderAndRows() {
        let rows: [ChartContainerDataRow] = [
            ["day": .text("Mon"), "soh": .number(92)],
            ["day": .text("Tue"), "soh": .missing]
        ]
        XCTAssertEqual(ChartContainerCsv.serialize(columns: columns, rows: rows), "Day,SoH\nMon,92\nTue,—")
    }

    func testEscapesCommaQuoteNewline() {
        let rows: [ChartContainerDataRow] = [["day": .text("a,\"b\"\nc"), "soh": .number(1)]]
        XCTAssertEqual(ChartContainerCsv.serialize(columns: columns, rows: rows), "Day,SoH\n\"a,\"\"b\"\"\nc\",1")
    }

    func testEmptyColumnsYieldsEmptyString() {
        XCTAssertEqual(ChartContainerCsv.serialize(columns: [], rows: []), "")
    }
}

// MARK: - Accessibility (web figure / figcaption strings)

final class ChartContainerAccessibilityTests: XCTestCase {
    func testFigureLabelSuffixesFreshnessOffLive() {
        XCTAssertEqual(
            ChartContainerAccessibility.figureLabel(ariaLabel: "Trend", freshnessNote: "Stale", isLive: true),
            "Trend"
        )
        XCTAssertEqual(
            ChartContainerAccessibility.figureLabel(ariaLabel: "Trend", freshnessNote: "Stale", isLive: false),
            "Trend, Stale"
        )
    }

    func testFallbackTableLabelInterpolatesTitle() {
        XCTAssertEqual(
            ChartContainerAccessibility.fallbackTableLabel(template: "{{title}} — data table", title: "SoH"),
            "SoH — data table"
        )
    }

    func testSummaryFallsBackWhenTemplateLacksToken() {
        // A resolved template missing the token uses the interpolated English fallback (never a raw template).
        XCTAssertEqual(ChartContainerAccessibility.summary(template: "Chart", title: "SoH"), "Chart: SoH")
    }
}

// MARK: - Projection + chart status (web render precedence)

final class ChartContainerProjectionTests: XCTestCase {
    func testChartStatusPrecedence() {
        XCTAssertEqual(ChartContainerChartStatus.resolve(loading: true, hasError: true, empty: true), .loading)
        XCTAssertEqual(ChartContainerChartStatus.resolve(loading: false, hasError: true, empty: true), .error)
        XCTAssertEqual(ChartContainerChartStatus.resolve(loading: false, hasError: false, empty: true), .empty)
        XCTAssertEqual(ChartContainerChartStatus.resolve(loading: false, hasError: false, empty: false), .ready)
    }

    func testResolveGatesAnnotationsExportAndTable() {
        let content = ChartContainerContent(
            title: "Trend",
            ariaLabel: "Trend",
            exportable: true,
            annotationsEnabled: true,
            annotationKey: "battery"
        )
        let resolved = ChartContainerProjection.resolve(
            content: content,
            connection: .stale,
            body: ChartContainerBodyState(rowCount: 2, columnCount: 2),
            hidden: false,
            fetched: [sampleAnnotation()]
        )
        XCTAssertEqual(resolved.status, .ready)
        XCTAssertEqual(resolved.connection, .stale)
        XCTAssertFalse(resolved.isLive)
        XCTAssertEqual(resolved.visibleAnnotations.count, 1)
        XCTAssertTrue(resolved.showMarkerRow)
        XCTAssertTrue(resolved.showExportMenu)
        XCTAssertTrue(resolved.hasFallbackTable)
        XCTAssertTrue(resolved.showAnnotationList)
    }

    func testResolveHidesAnnotationArtifactsWhenDisabled() {
        let content = ChartContainerContent(title: "Trend", ariaLabel: "Trend")
        let resolved = ChartContainerProjection.resolve(
            content: content,
            connection: .live,
            body: ChartContainerBodyState(),
            hidden: false,
            fetched: [sampleAnnotation()]
        )
        XCTAssertTrue(resolved.fetchedAnnotations.isEmpty)
        XCTAssertFalse(resolved.showAnnotationList)
        XCTAssertFalse(resolved.showMarkerRow)
        XCTAssertFalse(resolved.hasFallbackTable)
    }
}

// MARK: - Content config (web `annotationKey = chartId ?? title`)

final class ChartContainerContentTests: XCTestCase {
    func testAnnotationKeyDefaultsToTitle() {
        XCTAssertEqual(ChartContainerContent(title: "Trend", ariaLabel: "Trend").annotationKey, "Trend")
    }

    func testAnnotationKeyUsesExplicitChartId() {
        let content = ChartContainerContent(title: "Trend", ariaLabel: "Trend", annotationKey: "battery-trend")
        XCTAssertEqual(content.annotationKey, "battery-trend")
    }
}

// MARK: - Meta + i18n key set (web source keys present in the catalog)

final class ChartContainerMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(ChartContainerMeta.surfaceSlug, "ChartContainer")
        XCTAssertEqual(ChartContainer<EmptyView, EmptyView>.surfaceSlug, "ChartContainer")
    }

    func testWebSourceKeysResolve() {
        let expected: [String: String] = [
            "annotations.add": "Add annotation",
            "annotations.show": "Show annotations",
            "annotations.hide": "Hide annotations",
            "annotations.markerRow": "Annotations on this chart",
            "chart.noData": "No data available",
            "errors.section.chartTitle": "This chart failed to load"
        ]
        for (key, english) in expected {
            XCTAssertEqual(ChartContainerStrings.string(key, english), english, "key \(key)")
            XCTAssertFalse(ChartContainerStrings.string(key, english).isEmpty, "key \(key) empty")
        }
    }
}

// MARK: - Shared fixtures

private func sampleAnnotation(id: String = "1") -> ChartContainerAnnotation {
    ChartContainerAnnotation(
        id: id,
        timestamp: "2026-05-02T10:00:00Z",
        label: "Tire rotation",
        description: "Rotated tires",
        category: .maintenance,
        context: "battery",
        vehicleID: 7,
        createdAt: "2026-05-02T11:00:00Z"
    )
}
