//
//  CommandSearch.Tests.swift
//  TeslaSync — P4 feature view · 0225 · CommandSearch (Apple)
//
//  Unit coverage for the CommandSearch surface:
//    • Adapter (cached → projection) — `CommandSearchProjector` value parity with the web source's
//      filter (the `title.toLowerCase().includes(q) || category.includes(q) || command.includes(q)`
//      predicate, the untrimmed-lowercased needle, catalog-order preservation, the empty-box idle
//      guard) plus the result-phase precedence (failed / loading / idle / content / empty) and the
//      stale-age label.
//    • State holder — `CommandSearchModel` query→project recompute, the parent `onChange` forwarding,
//      the `onActivate` selection, phase resolution, the P1/S11 `view.opened` telemetry, and the
//      stale auto-refresh / offline wiring.
//    • Accessibility — the per-phase results summary + the command-row role label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryCommandSearchSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum CommandSearchFixture {
    static let commands: [CommandDTO] = [
        CommandDTO(
            id: "flash_lights",
            command: "flash_lights",
            title: "Flash Lights",
            subtitle: "Flash the headlights once",
            category: "security"
        ),
        CommandDTO(id: "honk_horn", command: "honk_horn", title: "Honk Horn", category: "security"),
        CommandDTO(
            id: "climate_on",
            command: "auto_conditioning_start",
            title: "Start Climate",
            category: "climate"
        ),
        CommandDTO(id: "charge_start", command: "charge_start", title: "Start Charging", category: "charging"),
        CommandDTO(id: "door_lock", command: "door_lock", title: "Lock Doors", category: "doors")
    ]

    static func project(_ query: String) -> CommandSearchProjection {
        CommandSearchProjector.project(commands: commands, query: query, copy: .fallback)
    }
}

// MARK: - Adapter: catalog → projection (port parity with the web filter)

final class CommandSearchAdapterTests: XCTestCase {
    func testProjectMatchesByTitle() {
        let projection = CommandSearchFixture.project("lock")
        XCTAssertEqual(projection.matches.map(\.id), ["door_lock"])
    }

    func testProjectMatchesByCategory() {
        let projection = CommandSearchFixture.project("security")
        XCTAssertEqual(projection.matches.map(\.id), ["flash_lights", "honk_horn"])
    }

    func testProjectMatchesByCommandToken() {
        // Only the raw command token contains the needle (web `c.command.includes(q)`).
        let projection = CommandSearchFixture.project("auto_conditioning")
        XCTAssertEqual(projection.matches.map(\.id), ["climate_on"])
    }

    func testProjectEmptyQueryYieldsEmptyProjection() {
        // Web `if (!search.trim()) return null` — the empty box does not search.
        XCTAssertEqual(CommandSearchFixture.project(""), .empty)
        XCTAssertFalse(CommandSearchFixture.project("").hasMatches)
    }

    func testProjectWhitespaceQueryYieldsEmptyProjection() {
        XCTAssertEqual(CommandSearchFixture.project("   "), .empty)
    }

    func testProjectIsCaseInsensitive() {
        let projection = CommandSearchFixture.project("FLASH")
        XCTAssertEqual(projection.matches.map(\.id), ["flash_lights"])
    }

    func testProjectPreservesCatalogOrder() {
        // "start" matches Start Climate then Start Charging — in catalog order.
        let projection = CommandSearchFixture.project("start")
        XCTAssertEqual(projection.matches.map(\.id), ["climate_on", "charge_start"])
    }

    func testNeedleIsLowercasedNotTrimmed() {
        // Web `const q = search.toLowerCase()` — lowercased, never trimmed.
        XCTAssertEqual(CommandSearchProjector.needle(" Flash"), " flash")
    }

    func testIsSearchingTrimsOnlyForTheDecision() {
        XCTAssertFalse(CommandSearchProjector.isSearching("   "))
        XCTAssertTrue(CommandSearchProjector.isSearching(" a "))
    }

    func testProjectBuildsAccessibilityLabelWithRoleAndSubtitle() {
        let match = CommandSearchFixture.project("flash").matches[0]
        XCTAssertEqual(match.accessibilityLabel, "Command: Flash Lights, Flash the headlights once")
    }

    func testProjectAccessibilityLabelWithoutSubtitle() {
        let match = CommandSearchFixture.project("honk").matches[0]
        XCTAssertEqual(match.accessibilityLabel, "Command: Honk Horn")
    }

    func testResolvePhaseMatrix() {
        // Failure wins over any cache.
        XCTAssertEqual(
            CommandSearchProjector.resolvePhase(.failed("x"), isSearching: true, hasMatches: true),
            .error("x")
        )
        // An unresolved catalog is loading regardless of the box.
        XCTAssertEqual(
            CommandSearchProjector.resolvePhase(.idle, isSearching: false, hasMatches: false),
            .loading
        )
        XCTAssertEqual(
            CommandSearchProjector.resolvePhase(.loading, isSearching: true, hasMatches: true),
            .loading
        )
        // A resolved catalog: idle when the box is empty, else content/empty on matches.
        XCTAssertEqual(
            CommandSearchProjector.resolvePhase(.loaded, isSearching: false, hasMatches: false),
            .idle
        )
        XCTAssertEqual(
            CommandSearchProjector.resolvePhase(.loaded, isSearching: true, hasMatches: true),
            .content
        )
        XCTAssertEqual(
            CommandSearchProjector.resolvePhase(.loaded, isSearching: true, hasMatches: false),
            .empty
        )
    }
}

// MARK: - Adapter: stale-age label

final class CommandSearchAgeTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    func testCompactLabelBuckets() {
        XCTAssertEqual(label(secondsAgo: nil), "unknown")
        XCTAssertEqual(label(secondsAgo: 0), "just now")
        XCTAssertEqual(label(secondsAgo: 59), "just now")
        XCTAssertEqual(label(secondsAgo: 300), "5 min")
        XCTAssertEqual(label(secondsAgo: 7200), "2 hr")
        XCTAssertEqual(label(secondsAgo: 172_800), "2 days")
    }

    func testCompactLabelClampsFutureTimestamp() {
        XCTAssertEqual(CommandSearchAge.compactLabel(since: now.addingTimeInterval(120), relativeTo: now), "just now")
    }

    private func label(secondsAgo: TimeInterval?) -> String {
        let date = secondsAgo.map { now.addingTimeInterval(-$0) }
        return CommandSearchAge.compactLabel(since: date, relativeTo: now)
    }
}

// MARK: - State holder: query → project, callbacks, phase, telemetry

@MainActor
final class CommandSearchModelTests: XCTestCase {
    private func makeModel(
        query: String,
        initial: CommandSearchUpdate,
        telemetry: CommandSearchTelemetry = OSLogCommandSearchTelemetry(),
        onChange: @escaping @MainActor (String) -> Void = { _ in },
        onActivate: @escaping @MainActor (CommandDTO) -> Void = { _ in }
    ) -> (CommandSearchModel, InMemoryCommandSearchSource) {
        let source = InMemoryCommandSearchSource(initial: initial)
        let model = CommandSearchModel(
            source: source,
            telemetry: telemetry,
            copy: .fallback,
            initialQuery: query,
            onChange: onChange,
            onActivate: onActivate
        )
        return (model, source)
    }

    private func loaded(connection: CommandSearchConnection = .live) -> CommandSearchUpdate {
        CommandSearchUpdate(
            status: .loaded,
            commands: CommandSearchFixture.commands,
            connection: connection,
            updatedAt: Date()
        )
    }

    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let spy = SpyCommandSearchTelemetry()
        let (model, source) = makeModel(query: "", initial: CommandSearchUpdate(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CommandSearch.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testSetQueryForwardsOnChangeAndProjects() {
        var changes: [String] = []
        let (model, _) = makeModel(query: "", initial: loaded(), onChange: { changes.append($0) })
        model.start()
        model.setQuery("lock")
        XCTAssertEqual(changes, ["lock"])
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.matches.map(\.id), ["door_lock"])
    }

    func testEmptyQueryShowsIdleWhenLoaded() {
        let (model, _) = makeModel(query: "", initial: loaded())
        model.start()
        XCTAssertEqual(model.phase, .idle)
        XCTAssertFalse(model.isSearching)
    }

    func testSearchingNoMatchShowsEmpty() {
        let (model, _) = makeModel(query: "teleport", initial: loaded())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingStatusShowsLoading() {
        let (model, _) = makeModel(query: "", initial: CommandSearchUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedShowsError() {
        let (model, source) = makeModel(query: "lock", initial: loaded())
        model.start()
        source.push(CommandSearchUpdate(status: .failed("boom"), commands: CommandSearchFixture.commands))
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testClearResetsQueryAndForwardsOnChange() {
        var changes: [String] = []
        let (model, _) = makeModel(query: "lock", initial: loaded(), onChange: { changes.append($0) })
        model.start()
        model.clear()
        XCTAssertEqual(model.query, "")
        XCTAssertEqual(changes.last, "")
        XCTAssertEqual(model.phase, .idle)
    }

    func testActivateForwardsUnderlyingCommand() {
        var activated: CommandDTO?
        let (model, _) = makeModel(query: "lock", initial: loaded(), onActivate: { activated = $0 })
        model.start()
        let match = model.projection.matches[0]
        model.activate(match)
        XCTAssertEqual(activated?.id, "door_lock")
        XCTAssertEqual(activated?.command, "door_lock")
    }

    func testActivateUnknownMatchDoesNotCallback() {
        var called = false
        let (model, _) = makeModel(query: "lock", initial: loaded(), onActivate: { _ in called = true })
        model.start()
        let ghost = CommandMatch(id: "nope", title: "Ghost", category: "x", accessibilityLabel: "Command: Ghost")
        model.activate(ghost)
        XCTAssertFalse(called)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(query: "", initial: CommandSearchUpdate(connection: .live))
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
        let (model, source) = makeModel(query: "charge", initial: loaded())
        model.start()
        source.push(loaded(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testCatalogCountReflectsSource() {
        let (model, _) = makeModel(query: "", initial: loaded())
        model.start()
        XCTAssertEqual(model.catalogCount, CommandSearchFixture.commands.count)
    }
}

// MARK: - Accessibility summaries

final class CommandSearchAccessibilityTests: XCTestCase {
    private let fallback: (String, String) -> String = { _, value in value }

    func testResultsSummaryForEachPhase() {
        XCTAssertTrue(summary(.idle).contains("Type to search"))
        XCTAssertEqual(summary(.loading), "Loading commands")
        XCTAssertEqual(summary(.content, count: 3), "3 commands match your search")
        XCTAssertEqual(summary(.empty), "No commands match your search")
        XCTAssertEqual(summary(.error("x")), "Couldn't load commands")
    }

    func testMatchAccessibilityLabelHasRolePrefix() {
        let match = CommandSearchFixture.project("flash").matches[0]
        XCTAssertEqual(match.accessibilityLabel, "Command: Flash Lights, Flash the headlights once")
    }

    @MainActor
    func testModelFieldAndResultsAccessibility() {
        let source = InMemoryCommandSearchSource(
            initial: CommandSearchUpdate(status: .loaded, commands: CommandSearchFixture.commands)
        )
        let model = CommandSearchModel(source: source, copy: .fallback, initialQuery: "lock")
        model.start()
        XCTAssertEqual(model.fieldAccessibilityLabel, "Search commands")
        XCTAssertEqual(model.resultsAccessibilitySummary, "1 commands match your search")
    }

    private func summary(_ phase: CommandSearchPhase, count: Int = 0) -> String {
        CommandSearchAccessibility.resultsSummary(for: phase, count: count, localize: fallback)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCommandSearchTelemetry: CommandSearchTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
