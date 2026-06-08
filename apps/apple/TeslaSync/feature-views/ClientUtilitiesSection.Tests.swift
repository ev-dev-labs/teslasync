//
//  ClientUtilitiesSection.Tests.swift
//  TeslaSync — P4 feature view · 0003 · ClientUtilitiesSection (Apple)
//
//  Unit coverage for the ClientUtilitiesSection surface:
//    • Adapter (catalog → projection) — `ClientUtilitiesCatalog` parity with the
//      web `useToolList`, `ToolFilter` parity with the web `filtered`, and the
//      `ToolDisclosure` single-open toggle (web `expandedId`).
//    • State holder — `ClientUtilitiesModel` phase resolution across loading /
//      empty / error / content, the search projection, the single-open accordion,
//      and the P1/S11 `view.opened` telemetry + source wiring.
//    • Accessibility — the VoiceOver card summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryToolCatalogSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: catalog parity (port of useToolList)

@MainActor
final class ClientUtilitiesCatalogTests: XCTestCase {
    /// English-fallback localizer (bundle-free) mirroring the display boundary.
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCatalogHasFifteenToolsInWebOrder() {
        let ids = ClientUtilitiesCatalog.defaultTools.map(\.id)
        XCTAssertEqual(ids, [
            "vin", "jwt", "timestamp", "base64", "url", "json", "uuid", "hash",
            "bytes", "color", "cron", "http", "tesla-api", "regex", "unix-perm"
        ])
    }

    func testCatalogIdsAreUnique() {
        let ids = ClientUtilitiesCatalog.defaultTools.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
    }

    func testEveryToolHasNonEmptyKeysSymbolAndTint() {
        for tool in ClientUtilitiesCatalog.defaultTools {
            XCTAssertFalse(tool.nameKey.isEmpty, "name key empty for \(tool.id)")
            XCTAssertFalse(tool.nameFallback.isEmpty, "name fallback empty for \(tool.id)")
            XCTAssertFalse(tool.descriptionKey.isEmpty, "desc key empty for \(tool.id)")
            XCTAssertFalse(tool.descriptionFallback.isEmpty, "desc fallback empty for \(tool.id)")
            XCTAssertFalse(tool.systemImage.isEmpty, "symbol empty for \(tool.id)")
            XCTAssertTrue(ToolTint.allCases.contains(tool.tint))
        }
    }

    func testBase64UsesTheWebKeyedStringsWithDefaults() {
        let base64 = ClientUtilitiesCatalog.defaultTools.first { $0.id == "base64" }
        XCTAssertEqual(base64?.nameKey, "devtools.utils.base64")
        XCTAssertEqual(base64?.nameFallback, "Base64")
        XCTAssertEqual(base64?.descriptionKey, "devtools.utils.base64Desc")
        XCTAssertEqual(base64?.descriptionFallback, "Base64Desc")
    }

    func testTintParityForRepresentativeTools() {
        func tint(_ id: String) -> ToolTint? {
            ClientUtilitiesCatalog.defaultTools.first { $0.id == id }?.tint
        }
        XCTAssertEqual(tint("vin"), .cyan)
        XCTAssertEqual(tint("jwt"), .purple)
        XCTAssertEqual(tint("timestamp"), .green)
        XCTAssertEqual(tint("base64"), .amber)
        XCTAssertEqual(tint("hash"), .red)
    }

    func testLocalizedAccessorsResolveThroughTheFacade() {
        let vin = ClientUtilitiesCatalog.defaultTools[0]
        XCTAssertEqual(vin.localizedName(echo), "Vin Decoder")
        XCTAssertEqual(vin.localizedDescription(echo), "Vin Decoder Desc")
    }
}

// MARK: - Adapter: search filter (port of `filtered`)

@MainActor
final class ToolFilterTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private var tools: [ToolDescriptor] {
        ClientUtilitiesCatalog.defaultTools
    }

    func testEmptyQueryReturnsEveryTool() {
        XCTAssertEqual(ToolFilter.filter(tools, query: "", localize: echo).count, 15)
    }

    func testWhitespaceQueryReturnsEveryTool() {
        XCTAssertEqual(ToolFilter.filter(tools, query: "   ", localize: echo).count, 15)
    }

    func testQueryMatchesByNameCaseInsensitively() {
        let result = ToolFilter.filter(tools, query: "DECODER", localize: echo).map(\.id)
        XCTAssertEqual(result, ["vin", "jwt"])
    }

    func testQueryMatchesByDescription() {
        // "base64" appears in both the base64 name and its description.
        let result = ToolFilter.filter(tools, query: "base64", localize: echo).map(\.id)
        XCTAssertEqual(result, ["base64"])
    }

    func testNoMatchReturnsEmpty() {
        XCTAssertTrue(ToolFilter.filter(tools, query: "no-such-tool", localize: echo).isEmpty)
    }
}

// MARK: - Adapter: single-open accordion (port of `setExpandedId`)

@MainActor
final class ToolDisclosureTests: XCTestCase {
    func testSelectingFromNoneOpensThatTool() {
        XCTAssertEqual(ToolDisclosure.toggled(current: nil, selecting: "vin"), "vin")
    }

    func testSelectingTheOpenToolClosesIt() {
        XCTAssertNil(ToolDisclosure.toggled(current: "vin", selecting: "vin"))
    }

    func testSelectingAnotherToolSwitchesOpenState() {
        XCTAssertEqual(ToolDisclosure.toggled(current: "vin", selecting: "jwt"), "jwt")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class ClientUtilitiesModelTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func makeModel(
        _ update: ToolCatalogUpdate,
        telemetry: ClientUtilitiesTelemetry = OSLogClientUtilitiesTelemetry()
    ) -> (ClientUtilitiesModel, InMemoryToolCatalogSource) {
        let source = InMemoryToolCatalogSource(initial: update)
        let model = ClientUtilitiesModel(source: source, telemetry: telemetry, localize: echo)
        return (model, source)
    }

    func testLoadingWithoutToolsShowsLoading() {
        let (model, _) = makeModel(ToolCatalogUpdate(status: .loading, tools: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testEmptyStatusShowsCatalogEmpty() {
        let (model, _) = makeModel(ToolCatalogUpdate(status: .empty, tools: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithoutToolsShowsCatalogEmpty() {
        let (model, _) = makeModel(ToolCatalogUpdate(status: .loaded, tools: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutToolsShowsError() {
        let (model, _) = makeModel(ToolCatalogUpdate(status: .failed("boom"), tools: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testToolsPresentShowContentEvenWhileLoadingOrFailed() {
        let tools = ClientUtilitiesCatalog.defaultTools
        let (loading, _) = makeModel(ToolCatalogUpdate(status: .loading, tools: tools))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(ToolCatalogUpdate(status: .failed("net"), tools: tools))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyClientUtilitiesTelemetry()
        let (model, source) = makeModel(ToolCatalogUpdate(status: .loading, tools: []), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ClientUtilitiesSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ToolCatalogUpdate(status: .loaded, tools: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testSearchProjectionFiltersAndReportsSearchEmpty() {
        let (model, _) = makeModel(
            ToolCatalogUpdate(status: .loaded, tools: ClientUtilitiesCatalog.defaultTools)
        )
        model.start()
        XCTAssertEqual(model.filteredTools.count, 15)
        XCTAssertFalse(model.isSearchEmpty)

        model.setSearch("decoder")
        XCTAssertEqual(model.filteredTools.map(\.id), ["vin", "jwt"])
        XCTAssertFalse(model.isSearchEmpty)

        model.setSearch("no-such-tool")
        XCTAssertTrue(model.filteredTools.isEmpty)
        XCTAssertTrue(model.isSearchEmpty)

        model.setSearch("")
        XCTAssertEqual(model.filteredTools.count, 15)
    }

    func testToggleHasSingleOpenSemantics() {
        let (model, _) = makeModel(
            ToolCatalogUpdate(status: .loaded, tools: ClientUtilitiesCatalog.defaultTools)
        )
        model.start()
        XCTAssertNil(model.expandedID)
        model.toggle("vin")
        XCTAssertEqual(model.expandedID, "vin")
        model.toggle("jwt")
        XCTAssertEqual(model.expandedID, "jwt")
        model.toggle("jwt")
        XCTAssertNil(model.expandedID)
    }

    func testApplyClearsExpansionWhenToolDisappears() {
        let (model, source) = makeModel(
            ToolCatalogUpdate(status: .loaded, tools: ClientUtilitiesCatalog.defaultTools)
        )
        model.start()
        model.toggle("vin")
        XCTAssertEqual(model.expandedID, "vin")

        let withoutVin = ClientUtilitiesCatalog.defaultTools.filter { $0.id != "vin" }
        source.push(ToolCatalogUpdate(status: .loaded, tools: withoutVin))
        XCTAssertNil(model.expandedID)
        XCTAssertEqual(model.phase, .content)
    }

    func testConnectionTracksUpdates() {
        let (model, source) = makeModel(ToolCatalogUpdate(status: .loading, tools: []))
        model.start()
        source.push(
            ToolCatalogUpdate(
                status: .loaded,
                connection: .offline,
                tools: ClientUtilitiesCatalog.defaultTools,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
    }
}

// MARK: - Accessibility summary content

@MainActor
final class ClientUtilitiesAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCardSummaryIncludesNameStateAndDescription() {
        let vin = ClientUtilitiesCatalog.defaultTools[0]
        let collapsed = ClientUtilitiesAccessibility.cardSummary(for: vin, expanded: false, localize: echo)
        XCTAssertTrue(collapsed.contains("Vin Decoder"))
        XCTAssertTrue(collapsed.contains("Collapsed"))
        XCTAssertTrue(collapsed.contains("Vin Decoder Desc"))

        let expanded = ClientUtilitiesAccessibility.cardSummary(for: vin, expanded: true, localize: echo)
        XCTAssertTrue(expanded.contains("Expanded"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyClientUtilitiesTelemetry: ClientUtilitiesTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
