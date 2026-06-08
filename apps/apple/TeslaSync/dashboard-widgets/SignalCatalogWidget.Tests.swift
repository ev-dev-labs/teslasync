//
//  SignalCatalogWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0087 · SignalCatalogWidget (Apple)
//
//  Unit coverage for the SignalCatalogWidget surface:
//    • Adapter (cached → projection) — observation tally, search filter, category
//      grouping (alphabetical sort + within-category order + Uncategorized
//      fallback), compact split, phase / freshness / count / relative-time
//      resolution (port parity with the web source).
//    • State holder — SignalCatalogModel phase/freshness/connection tracking plus
//      the P1/S11 view.opened telemetry + source wiring.
//    • Registry — canonical "signal-catalog" metadata + size clamping.
//    • Accessibility — the VoiceOver row / group / freshness copy.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by InMemorySignalCatalogSource. The pure adapter
//  subset is additionally proven by an executed headless harness.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection

@MainActor final class SignalCatalogAdapterTests: XCTestCase {
    private func entry(
        _ name: String,
        module: String? = nil,
        unit: String? = nil,
        description: String? = nil
    ) -> SignalCatalogEntry {
        SignalCatalogEntry(name: name, sourceModule: module, unit: unit, description: description)
    }

    func testObservationCountsTally() {
        let counts = SignalCatalogBuilder.observationCounts(["Speed", "Speed", "Temp", "Speed"])
        XCTAssertEqual(counts["Speed"], 3)
        XCTAssertEqual(counts["Temp"], 1)
        XCTAssertNil(counts["Missing"])
    }

    func testObservationCountsEmpty() {
        XCTAssertTrue(SignalCatalogBuilder.observationCounts([]).isEmpty)
    }

    func testIsCompactMatchesWebThreshold() {
        XCTAssertTrue(SignalCatalogBuilder.isCompact(cols: 0))
        XCTAssertTrue(SignalCatalogBuilder.isCompact(cols: 1))
        XCTAssertFalse(SignalCatalogBuilder.isCompact(cols: 2))
        XCTAssertFalse(SignalCatalogBuilder.isCompact(cols: 4))
    }

    func testMatchesNameDescriptionAndModule() {
        let item = entry("BatteryLevel", module: "Charging", description: "State of charge")
        XCTAssertTrue(SignalCatalogBuilder.matches(item, query: "battery"))
        XCTAssertTrue(SignalCatalogBuilder.matches(item, query: "charge"))
        XCTAssertTrue(SignalCatalogBuilder.matches(item, query: "charging"))
        XCTAssertFalse(SignalCatalogBuilder.matches(item, query: "speed"))
    }

    func testMatchesHandlesMissingOptionalFields() {
        let item = entry("RawCounter")
        XCTAssertTrue(SignalCatalogBuilder.matches(item, query: "raw"))
        XCTAssertFalse(SignalCatalogBuilder.matches(item, query: "drive"))
    }

    func testFilterEmptySearchReturnsAll() {
        let entries = [entry("Alpha"), entry("Bravo")]
        XCTAssertEqual(SignalCatalogBuilder.filter(entries, search: "   ").map(\.name), ["Alpha", "Bravo"])
    }

    func testFilterIsCaseInsensitive() {
        let entries = [entry("VehicleSpeed", module: "Drive"), entry("BatteryLevel", module: "Charging")]
        XCTAssertEqual(SignalCatalogBuilder.filter(entries, search: "DRIVE").map(\.name), ["VehicleSpeed"])
    }

    func testCategoryFallsBackToUncategorized() {
        XCTAssertEqual(
            SignalCatalogBuilder.category(for: entry("X", module: "Drive"), uncategorized: "Uncategorized"),
            "Drive"
        )
        XCTAssertEqual(
            SignalCatalogBuilder.category(for: entry("X", module: ""), uncategorized: "Uncategorized"),
            "Uncategorized"
        )
        XCTAssertEqual(
            SignalCatalogBuilder.category(for: entry("X"), uncategorized: "Uncategorized"),
            "Uncategorized"
        )
    }

    func testGroupsSortCategoriesAlphabeticallyAndKeepRowOrder() {
        let entries = [
            entry("Bravo", module: "Drive"),
            entry("Alpha", module: "Drive"),
            entry("Cosmos", module: "Charging"),
            entry("Delta")
        ]
        let groups = SignalCatalogBuilder.groups(
            entries: entries,
            search: "",
            counts: ["Bravo": 3],
            uncategorized: "Uncategorized"
        )
        XCTAssertEqual(groups.map(\.category), ["Charging", "Drive", "Uncategorized"])
        // Within "Drive", catalog order is preserved (not alphabetized).
        let drive = groups.first { $0.category == "Drive" }
        XCTAssertEqual(drive?.rows.map(\.name), ["Bravo", "Alpha"])
        XCTAssertEqual(drive?.rows.first?.observationCount, 3)
        XCTAssertEqual(drive?.rows.last?.observationCount, 0)
        XCTAssertEqual(drive?.count, 2)
    }

    func testGroupsRespectSearch() {
        let entries = [
            entry("VehicleSpeed", module: "Drive"),
            entry("BatteryLevel", module: "Charging")
        ]
        let groups = SignalCatalogBuilder.groups(
            entries: entries,
            search: "battery",
            counts: [:],
            uncategorized: "Uncategorized"
        )
        XCTAssertEqual(groups.map(\.category), ["Charging"])
        XCTAssertEqual(groups.first?.rows.map(\.name), ["BatteryLevel"])
    }

    func testResolvePhase() {
        XCTAssertEqual(SignalCatalogBuilder.resolvePhase(status: .loading, entryCount: 0), .loading)
        XCTAssertEqual(SignalCatalogBuilder.resolvePhase(status: .loaded, entryCount: 0), .empty)
        XCTAssertEqual(SignalCatalogBuilder.resolvePhase(status: .empty, entryCount: 0), .empty)
        XCTAssertEqual(SignalCatalogBuilder.resolvePhase(status: .failed("x"), entryCount: 0), .error("x"))
        XCTAssertEqual(SignalCatalogBuilder.resolvePhase(status: .loaded, entryCount: 5), .content)
        XCTAssertEqual(SignalCatalogBuilder.resolvePhase(status: .loading, entryCount: 5), .content)
    }

    func testResolveFreshnessPrecedence() {
        func freshness(
            connection: CatalogConnection,
            isFetching: Bool,
            isError: Bool
        ) -> CatalogFreshness {
            SignalCatalogBuilder.resolveFreshness(
                SignalCatalogUpdate(connection: connection, isFetching: isFetching, isError: isError)
            )
        }
        XCTAssertEqual(freshness(connection: .offline, isFetching: true, isError: true), .offline)
        XCTAssertEqual(freshness(connection: .live, isFetching: true, isError: true), .error)
        XCTAssertEqual(freshness(connection: .live, isFetching: true, isError: false), .fetching)
        XCTAssertEqual(freshness(connection: .stale, isFetching: false, isError: false), .stale)
        XCTAssertEqual(freshness(connection: .live, isFetching: false, isError: false), .fresh)
    }

    func testFormatInt() {
        XCTAssertEqual(SignalCatalogBuilder.formatInt(0), "0")
        XCTAssertEqual(SignalCatalogBuilder.formatInt(7), "7")
        XCTAssertTrue(SignalCatalogBuilder.formatInt(412).contains("412"))
        XCTAssertFalse(SignalCatalogBuilder.formatInt(1_234_567).isEmpty)
    }

    func testRelativeTimeBuckets() {
        let now = Date()
        XCTAssertTrue(SignalCatalogBuilder.relativeTime(since: now, now: now).contains("just"))
        XCTAssertTrue(
            SignalCatalogBuilder.relativeTime(since: now.addingTimeInterval(-120), now: now).contains("2m")
        )
        XCTAssertTrue(
            SignalCatalogBuilder.relativeTime(since: now.addingTimeInterval(-7200), now: now).contains("2h")
        )
        XCTAssertTrue(
            SignalCatalogBuilder.relativeTime(since: now.addingTimeInterval(-172_800), now: now).contains("2d")
        )
        XCTAssertTrue(
            SignalCatalogBuilder.relativeTime(since: now.addingTimeInterval(-691_200), now: now).contains("1w")
        )
    }
}

// MARK: - State holder: phase / freshness / telemetry / wiring

@MainActor final class SignalCatalogModelTests: XCTestCase {
    private func makeModel(
        _ update: SignalCatalogUpdate,
        telemetry: SignalCatalogTelemetry = OSLogSignalCatalogTelemetry()
    ) -> (SignalCatalogModel, InMemorySignalCatalogSource) {
        let source = InMemorySignalCatalogSource(initial: update)
        let model = SignalCatalogModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutEntriesShowsLoading() {
        let (model, _) = makeModel(SignalCatalogUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutEntriesShowsEmpty() {
        let (model, _) = makeModel(SignalCatalogUpdate(status: .loaded, entries: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutEntriesShowsError() {
        let (model, _) = makeModel(SignalCatalogUpdate(status: .failed("boom"), entries: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testEntriesPresentShowContentAndTotal() {
        let (model, _) = makeModel(
            SignalCatalogUpdate(
                status: .loaded,
                entries: [SignalCatalogEntry(name: "VehicleSpeed", sourceModule: "Drive")]
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.totalCount, 1)
    }

    func testObservationCountsTracked() {
        let (model, _) = makeModel(
            SignalCatalogUpdate(
                status: .loaded,
                entries: [SignalCatalogEntry(name: "Speed", sourceModule: "Drive")],
                observations: ["Speed", "Speed"]
            )
        )
        model.start()
        XCTAssertEqual(model.observationCounts["Speed"], 2)
    }

    func testFreshnessTracksUpdate() {
        let (model, source) = makeModel(SignalCatalogUpdate(status: .loading))
        model.start()
        source.push(SignalCatalogUpdate(status: .loaded, connection: .offline, updatedAt: Date()))
        XCTAssertEqual(model.freshness, .offline)
        XCTAssertEqual(model.connection, .offline)

        source.push(SignalCatalogUpdate(status: .loaded, isError: true))
        XCTAssertEqual(model.freshness, .error)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySignalCatalogTelemetry()
        let (model, source) = makeModel(SignalCatalogUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SignalCatalogWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SignalCatalogUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testProjectionTracksUpdates() {
        let (model, source) = makeModel(SignalCatalogUpdate(status: .loading))
        model.start()
        let stamp = Date()
        source.push(
            SignalCatalogUpdate(
                status: .loaded,
                connection: .live,
                entries: [
                    SignalCatalogEntry(name: "VehicleSpeed", sourceModule: "Drive"),
                    SignalCatalogEntry(name: "InsideTemp", sourceModule: "Climate")
                ],
                observations: ["VehicleSpeed"],
                updatedAt: stamp
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.totalCount, 2)
        XCTAssertEqual(model.observationCounts["VehicleSpeed"], 1)
        XCTAssertEqual(model.updatedAt, stamp)
    }
}

// MARK: - Registry parity

@MainActor final class SignalCatalogRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SignalCatalogWidget.registration
        XCTAssertEqual(registration.id, "signal-catalog")
        XCTAssertEqual(registration.category, "telemetry")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SignalCatalogWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)),
            DashboardWidgetSize(cols: 2, rows: 4)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }

    func testSurfaceSlugMatchesDiagnosticsContract() {
        XCTAssertEqual(SignalCatalogWidget.surfaceSlug, "SignalCatalogWidget")
    }
}

// MARK: - Accessibility copy

@MainActor final class SignalCatalogAccessibilityTests: XCTestCase {
    func testRowLabelIncludesNameUnitAndCount() {
        let row = SignalCatalogRow(name: "ChargeRate", unit: "W", observationCount: 128)
        let label = SignalCatalogAccessibility.rowLabel(for: row)
        XCTAssertTrue(label.contains("ChargeRate"))
        XCTAssertTrue(label.contains("W"))
        XCTAssertTrue(label.contains("128"))
        XCTAssertTrue(label.contains("observations"))
    }

    func testRowLabelOmitsMissingUnit() {
        let row = SignalCatalogRow(name: "Gear", unit: nil, observationCount: 0)
        let label = SignalCatalogAccessibility.rowLabel(for: row)
        XCTAssertTrue(label.contains("Gear"))
        XCTAssertTrue(label.contains("0"))
    }

    func testGroupLabelIncludesCategoryAndCount() {
        let group = SignalCatalogGroup(
            category: "Drive",
            rows: [SignalCatalogRow(name: "A"), SignalCatalogRow(name: "B")]
        )
        let label = SignalCatalogAccessibility.groupLabel(for: group)
        XCTAssertTrue(label.contains("Drive"))
        XCTAssertTrue(label.contains("2"))
        XCTAssertTrue(label.contains("signals"))
    }

    func testFreshnessCopy() {
        XCTAssertEqual(SignalCatalogAccessibility.freshnessLabel(.offline), "Offline")
        XCTAssertEqual(SignalCatalogAccessibility.freshnessLabel(.fresh), "Live")
        XCTAssertEqual(SignalCatalogAccessibility.freshnessLabel(.stale), "Stale")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySignalCatalogTelemetry: SignalCatalogTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
