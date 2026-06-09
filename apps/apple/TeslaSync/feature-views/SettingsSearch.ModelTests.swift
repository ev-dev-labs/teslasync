//
//  SettingsSearch.ModelTests.swift
//  TeslaSync — P4 feature view · 0215 · SettingsSearch (Apple)
//
//  State-holder + accessibility coverage for the SettingsSearch surface, split out of
//  SettingsSearch.Tests.swift (which owns the adapter / ranker / destination coverage) to keep each
//  file focused:
//    • `SettingsSearchModel` query→project recompute, the `commit` → `onNavigate` forwarding with the
//      parsed deep-link destination, phase resolution, the P1/S11 `view.opened` telemetry, and the
//      stale auto-refresh / offline freshness wiring.
//    • The per-phase VoiceOver results summary + the setting-row role label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets, driven by `InMemorySettingsSearchSource` (no
//  network, no real store). The shared `SettingsSearchFixture` lives in SettingsSearch.Tests.swift.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: query → project, navigation, telemetry, freshness

@MainActor final class SettingsSearchModelTests: XCTestCase {
    private func makeModel(
        query: String,
        initial: SettingsSearchUpdate,
        telemetry: SettingsSearchTelemetry = OSLogSettingsSearchTelemetry(),
        onNavigate: @escaping @MainActor (SettingsDestination) -> Void = { _ in }
    ) -> (SettingsSearchModel, InMemorySettingsSearchSource) {
        let source = InMemorySettingsSearchSource(initial: initial)
        let model = SettingsSearchModel(
            source: source,
            telemetry: telemetry,
            copy: .fallback,
            initialQuery: query,
            onNavigate: onNavigate
        )
        return (model, source)
    }

    private func loaded(connection: SettingsSearchConnection = .live) -> SettingsSearchUpdate {
        SettingsSearchUpdate(
            status: .loaded,
            entries: SettingsSearchFixture.entries,
            connection: connection,
            updatedAt: Date()
        )
    }

    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let spy = SpySettingsSearchTelemetry()
        let (model, source) = makeModel(query: "", initial: SettingsSearchUpdate(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SettingsSearch.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testSetQueryProjectsMatches() {
        let (model, _) = makeModel(query: "", initial: loaded())
        model.start()
        model.setQuery("language")
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.matches.map(\.id), ["language", "language-region"])
    }

    func testEmptyQueryShowsIdleWhenLoaded() {
        let (model, _) = makeModel(query: "", initial: loaded())
        model.start()
        XCTAssertEqual(model.phase, .idle)
        XCTAssertFalse(model.isSearching)
    }

    func testSearchingNoMatchShowsEmpty() {
        let (model, _) = makeModel(query: "zzzzz", initial: loaded())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingStatusShowsLoading() {
        let (model, _) = makeModel(query: "", initial: SettingsSearchUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedShowsError() {
        let (model, source) = makeModel(query: "language", initial: loaded())
        model.start()
        source.push(SettingsSearchUpdate(status: .failed("boom"), entries: SettingsSearchFixture.entries))
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCommitForwardsParsedDestinationAndClearsQuery() {
        var navigated: SettingsDestination?
        let (model, _) = makeModel(query: "theme", initial: loaded(), onNavigate: { navigated = $0 })
        model.start()
        let match = model.projection.matches[0]
        model.commit(match)
        XCTAssertEqual(navigated?.path, "/settings")
        XCTAssertEqual(navigated?.fragment, "appearance")
        XCTAssertEqual(model.query, "")
        XCTAssertEqual(model.phase, .idle)
    }

    func testCommitUnknownMatchDoesNotNavigate() {
        var called = false
        let (model, _) = makeModel(query: "theme", initial: loaded(), onNavigate: { _ in called = true })
        model.start()
        let ghost = SettingsMatch(
            id: "nope", title: "Ghost", section: "x", href: "/x", accessibilityLabel: "Setting: Ghost"
        )
        model.commit(ghost)
        XCTAssertFalse(called)
    }

    func testClearResetsQuery() {
        let (model, _) = makeModel(query: "language", initial: loaded())
        model.start()
        model.clear()
        XCTAssertEqual(model.query, "")
        XCTAssertEqual(model.phase, .idle)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(query: "", initial: SettingsSearchUpdate(connection: .live))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLive() {
        let (model, source) = makeModel(query: "", initial: loaded(connection: .live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(loaded(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(loaded(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        source.push(loaded(connection: .live))
        source.push(loaded(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentWithoutRefresh() {
        let (model, source) = makeModel(query: "language", initial: loaded())
        model.start()
        source.push(loaded(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testCatalogCountReflectsSource() {
        let (model, _) = makeModel(query: "", initial: loaded())
        model.start()
        XCTAssertEqual(model.catalogCount, SettingsSearchFixture.entries.count)
    }
}

// MARK: - Accessibility summaries

@MainActor final class SettingsSearchAccessibilityTests: XCTestCase {
    private let fallback: (String, String) -> String = { _, value in value }

    func testResultsSummaryForEachPhase() {
        XCTAssertTrue(summary(.idle).contains("Type to search"))
        XCTAssertEqual(summary(.loading), "Loading settings")
        XCTAssertEqual(summary(.content, count: 3), "3 settings match your search")
        // The empty state speaks the verbatim web `settings.search.noResults` string.
        XCTAssertEqual(summary(.empty), "No matching settings.")
        XCTAssertEqual(summary(.error("x")), "Couldn't load settings")
    }

    func testMatchAccessibilityLabelHasRolePrefix() {
        let match = SettingsSearchFixture.project("currency").matches[0]
        XCTAssertEqual(match.accessibilityLabel, "Setting: Currency, Currency symbol used in displays.")
    }

    func testModelFieldAndResultsAccessibility() {
        let source = InMemorySettingsSearchSource(
            initial: SettingsSearchUpdate(status: .loaded, entries: SettingsSearchFixture.entries)
        )
        let model = SettingsSearchModel(source: source, copy: .fallback, initialQuery: "currency")
        model.start()
        XCTAssertEqual(model.fieldAccessibilityLabel, "Search settings")
        XCTAssertEqual(model.resultsAccessibilitySummary, "1 settings match your search")
    }

    private func summary(_ phase: SettingsSearchPhase, count: Int = 0) -> String {
        SettingsSearchAccessibility.resultsSummary(for: phase, count: count, localize: fallback)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySettingsSearchTelemetry: SettingsSearchTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
