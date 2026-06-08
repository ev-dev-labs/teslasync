//
//  AddressInput.Tests.swift
//  TeslaSync — P4 feature view · 0135 · AddressInput (Apple)
//
//  Unit coverage for the AddressInput surface:
//    • Adapter (cached → projection) — `AddressInputProjector` value parity with the web source's
//      option pipeline (the `getOptionKey` identity, the `getOptionLabel` row text, the `onSelect`
//      `{ lat, lng, name }` payload, blank-row drop, duplicate-key collapse, the `&limit=5` cap),
//      plus the menu-phase precedence (below-minimum idle / loading / error / empty / content).
//    • State holder — `AddressInputModel` query→search debounce + coalescing, the parent
//      `onChange` / `onSelect` forwarding, the post-select confirmation, phase resolution, the
//      P1/S11 `view.opened` telemetry, and the stale auto-refresh / offline wiring.
//    • Accessibility — the per-phase results summary + the suggestion role label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryAddressInputSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum AddressInputFixture {
    static let results: [GeocodeResultDTO] = [
        GeocodeResultDTO(displayName: "1600 Amphitheatre Pkwy", lat: 37.4221, lng: -122.0841),
        GeocodeResultDTO(displayName: "1 Infinite Loop", lat: 37.3318, lng: -122.0312),
        GeocodeResultDTO(displayName: "Tesla Factory, Fremont", lat: 37.4946, lng: -121.9456)
    ]

    static func project(_ rows: [GeocodeResultDTO]) -> AddressInputProjection {
        AddressInputProjector.project(results: rows, copy: .fallback)
    }
}

// MARK: - Adapter: cached results → projection (port parity with the web source)

@MainActor final class AddressInputAdapterTests: XCTestCase {
    func testProjectMapsResultsToSuggestions() {
        let projection = AddressInputFixture.project(AddressInputFixture.results)
        XCTAssertEqual(projection.suggestions.count, 3)

        let first = projection.suggestions[0]
        XCTAssertEqual(first.title, "1600 Amphitheatre Pkwy")
        XCTAssertEqual(
            first.id,
            AddressInputProjector.key(lat: 37.4221, lng: -122.0841, name: "1600 Amphitheatre Pkwy")
        )
        XCTAssertEqual(first.location, TripLocationDTO(lat: 37.4221, lng: -122.0841, name: "1600 Amphitheatre Pkwy"))
        XCTAssertEqual(first.accessibilityLabel, "Address suggestion: 1600 Amphitheatre Pkwy")
    }

    func testKeyMatchesWebGetOptionKeyFormat() {
        // Web `getOptionKey` = `${lat}-${lng}-${display_name}`.
        XCTAssertEqual(AddressInputProjector.key(lat: 1.5, lng: -2.25, name: "Main St"), "1.5--2.25-Main St")
    }

    func testProjectDeduplicatesByKey() {
        let dup = GeocodeResultDTO(displayName: "1 Infinite Loop", lat: 37.3318, lng: -122.0312)
        let projection = AddressInputFixture.project(AddressInputFixture.results + [dup])
        XCTAssertEqual(projection.suggestions.count, 3)
        XCTAssertEqual(projection.suggestions.count(where: { $0.title == "1 Infinite Loop" }), 1)
    }

    func testProjectDropsBlankDisplayName() {
        let blank = GeocodeResultDTO(displayName: "   ", lat: 1, lng: 2)
        let projection = AddressInputFixture.project([blank] + AddressInputFixture.results)
        XCTAssertEqual(projection.suggestions.count, 3)
        XCTAssertFalse(projection.suggestions.contains { $0.title.trimmingCharacters(in: .whitespaces).isEmpty })
    }

    func testProjectCapsAtResultLimit() {
        let many = (0 ..< 12).map { GeocodeResultDTO(displayName: "Addr \($0)", lat: Double($0), lng: 0) }
        let projection = AddressInputFixture.project(many)
        XCTAssertEqual(projection.suggestions.count, AddressInputConfig.resultLimit)
        XCTAssertEqual(projection.suggestions.first?.title, "Addr 0")
    }

    func testProjectEmptyYieldsNoSuggestions() {
        let projection = AddressInputFixture.project([])
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.hasSuggestions)
    }

    func testMeetsMinimumLength() {
        XCTAssertFalse(AddressInputProjector.meetsMinimumLength("ab"))
        XCTAssertTrue(AddressInputProjector.meetsMinimumLength("abc"))
    }

    func testResolvePhaseMatrix() {
        // Below-minimum query is idle regardless of status (web hook disabled).
        XCTAssertEqual(AddressInputProjector.resolvePhase(.loaded, queryLength: 2, hasResults: true), .idle)
        XCTAssertEqual(AddressInputProjector.resolvePhase(.loading, queryLength: 0, hasResults: false), .idle)

        // At/above minimum: loading (and the transient idle-with-query) short-circuit to loading.
        XCTAssertEqual(AddressInputProjector.resolvePhase(.loading, queryLength: 3, hasResults: false), .loading)
        XCTAssertEqual(AddressInputProjector.resolvePhase(.idle, queryLength: 3, hasResults: false), .loading)

        // Failure wins over cache; loaded resolves content/empty on row presence.
        XCTAssertEqual(AddressInputProjector.resolvePhase(.failed("x"), queryLength: 5, hasResults: true), .error("x"))
        XCTAssertEqual(AddressInputProjector.resolvePhase(.loaded, queryLength: 5, hasResults: true), .content)
        XCTAssertEqual(AddressInputProjector.resolvePhase(.loaded, queryLength: 5, hasResults: false), .empty)
    }
}

// MARK: - State holder: query → search, callbacks, phase, telemetry

@MainActor final class AddressInputModelTests: XCTestCase {
    private func makeModel(
        query: String,
        initial: AddressInputUpdate,
        telemetry: AddressInputTelemetry = OSLogAddressInputTelemetry(),
        onChange: @escaping @MainActor (String) -> Void = { _ in },
        onSelect: @escaping @MainActor (TripLocationDTO) -> Void = { _ in }
    ) -> (AddressInputModel, InMemoryAddressInputSource) {
        let source = InMemoryAddressInputSource(initial: initial)
        let model = AddressInputModel(
            source: source,
            telemetry: telemetry,
            copy: .fallback,
            initialQuery: query,
            debounceInterval: 0,
            onChange: onChange,
            onSelect: onSelect
        )
        return (model, source)
    }

    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let spy = SpyAddressInputTelemetry()
        let (model, source) = makeModel(query: "", initial: AddressInputUpdate(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [AddressInput.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStartWithSeededQueryTriggersImmediateSearch() {
        let (model, source) = makeModel(query: "Main St", initial: AddressInputUpdate(status: .loading))
        model.start()
        XCTAssertEqual(source.searchedQueries, ["Main St"])
    }

    func testSetQueryForwardsOnChangeAndSearchesWhenLongEnough() {
        var changes: [String] = []
        let (model, source) = makeModel(
            query: "",
            initial: AddressInputUpdate(),
            onChange: { changes.append($0) }
        )
        model.start()
        model.setQuery("Mai")
        XCTAssertEqual(changes, ["Mai"])
        XCTAssertEqual(source.searchedQueries, ["Mai"])
    }

    func testSetQueryShortDoesNotSearchAndIsIdle() {
        var changes: [String] = []
        let (model, source) = makeModel(
            query: "",
            initial: AddressInputUpdate(),
            onChange: { changes.append($0) }
        )
        model.start()
        model.setQuery("Ma")
        XCTAssertTrue(source.searchedQueries.isEmpty)
        XCTAssertEqual(model.phase, .idle)
        XCTAssertEqual(changes, ["Ma"])
    }

    func testCrossingMinimumLengthFlipsIdleToLoading() {
        let (model, _) = makeModel(query: "", initial: AddressInputUpdate())
        model.start()
        model.setQuery("Ma")
        XCTAssertEqual(model.phase, .idle)
        model.setQuery("Mai")
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithResultsShowsContent() {
        let (model, _) = makeModel(
            query: "Amphitheatre",
            initial: AddressInputUpdate(status: .loaded, results: AddressInputFixture.results)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.suggestions.count, 3)
    }

    func testLoadedNoResultsShowsEmpty() {
        let (model, _) = makeModel(
            query: "Nowhereville",
            initial: AddressInputUpdate(status: .loaded, results: [])
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedShowsErrorEvenWithCachedRows() {
        let (model, source) = makeModel(
            query: "Amphitheatre",
            initial: AddressInputUpdate(status: .loaded, results: AddressInputFixture.results)
        )
        model.start()
        source.push(AddressInputUpdate(status: .failed("boom"), results: AddressInputFixture.results))
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testSelectFiresCallbacksSetsQueryAndSelected() {
        var changes: [String] = []
        var picked: TripLocationDTO?
        let (model, _) = makeModel(
            query: "Amphitheatre",
            initial: AddressInputUpdate(status: .loaded, results: AddressInputFixture.results),
            onChange: { changes.append($0) },
            onSelect: { picked = $0 }
        )
        model.start()
        let suggestion = model.projection.suggestions[0]
        model.select(suggestion)
        XCTAssertEqual(model.query, suggestion.title)
        XCTAssertEqual(model.selected, suggestion.location)
        XCTAssertEqual(changes.last, suggestion.title)
        XCTAssertEqual(picked, suggestion.location)
    }

    func testEditingAfterSelectClearsSelected() {
        let (model, _) = makeModel(
            query: "Amphitheatre",
            initial: AddressInputUpdate(status: .loaded, results: AddressInputFixture.results)
        )
        model.start()
        model.select(model.projection.suggestions[0])
        XCTAssertNotNil(model.selected)
        model.setQuery("Different Street")
        XCTAssertNil(model.selected)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(query: "", initial: AddressInputUpdate(connection: .live))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLive() {
        let live = AddressInputUpdate(status: .loaded, results: AddressInputFixture.results, connection: .live)
        let (model, source) = makeModel(query: "", initial: live)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AddressInputUpdate(status: .loaded, results: AddressInputFixture.results, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(AddressInputUpdate(status: .loaded, results: AddressInputFixture.results, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        source.push(live)
        source.push(AddressInputUpdate(status: .loaded, results: AddressInputFixture.results, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentWithoutRefresh() {
        let (model, source) = makeModel(
            query: "Amphitheatre",
            initial: AddressInputUpdate(status: .loaded, results: AddressInputFixture.results)
        )
        model.start()
        source.push(
            AddressInputUpdate(status: .loaded, results: AddressInputFixture.results, connection: .offline)
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testDebounceCoalescesToLastQuery() async {
        let source = InMemoryAddressInputSource()
        let model = AddressInputModel(source: source, copy: .fallback, debounceInterval: 0.05)
        model.setQuery("Main")
        model.setQuery("Main S")
        model.setQuery("Main St")
        XCTAssertTrue(source.searchedQueries.isEmpty)
        try? await Task.sleep(for: .seconds(0.25))
        XCTAssertEqual(source.searchedQueries, ["Main St"])
    }
}

// MARK: - Accessibility summaries

@MainActor final class AddressInputAccessibilityTests: XCTestCase {
    private let fallback: (String, String) -> String = { _, value in value }

    func testResultsSummaryForEachPhase() {
        XCTAssertTrue(summary(.idle).contains("Type at least 3"))
        XCTAssertEqual(summary(.loading), "Searching addresses")
        XCTAssertEqual(summary(.content, count: 3), "3 address suggestions")
        XCTAssertEqual(summary(.empty), "No matching addresses")
        XCTAssertEqual(summary(.error("x")), "Couldn't search addresses")
    }

    func testSuggestionAccessibilityLabelHasRolePrefix() {
        let suggestion = AddressInputFixture.project(AddressInputFixture.results)[0]
        XCTAssertEqual(suggestion.accessibilityLabel, "Address suggestion: 1600 Amphitheatre Pkwy")
    }

    @MainActor
    func testModelFieldAndResultsAccessibility() {
        let source = InMemoryAddressInputSource(
            initial: AddressInputUpdate(status: .loaded, results: AddressInputFixture.results)
        )
        let model = AddressInputModel(
            source: source,
            copy: .fallback,
            initialQuery: "Amphitheatre",
            debounceInterval: 0
        )
        model.start()
        XCTAssertEqual(model.fieldAccessibilityLabel, "Address")
        XCTAssertEqual(model.resultsAccessibilitySummary, "3 address suggestions")
    }

    private func summary(_ phase: AddressSuggestionsPhase, count: Int = 0) -> String {
        AddressInputAccessibility.resultsSummary(for: phase, count: count, localize: fallback)
    }
}

private extension AddressInputProjection {
    subscript(index: Int) -> AddressSuggestion {
        suggestions[index]
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAddressInputTelemetry: AddressInputTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
