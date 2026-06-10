//
//  SignalCategoryTree.Tests.swift
//  TeslaSync — P4 feature view · 0265 · SignalCategoryTree (Apple)
//
//  Unit coverage for the SignalCategoryTree surface:
//    • Adapter (catalog → projection) — `SignalCategoryCatalog` ranking +
//      `SignalCategoryTreeBuilder` grouping / leaf-sort / group-order / search
//      filter parity with the web `groups` useMemo + TreeSelect `filterGroups`.
//    • Selection — `SignalCategorySelection` tri-state / counts / toggle transforms
//      and the `SignalCategorySelectAllLabel` shapes (web TreeSelect callbacks).
//    • State holder — `SignalCategoryTreeModel` phase resolution, P1/S11
//      `view.opened` telemetry, refresh/stop wiring, stale auto-refresh, the live
//      search filter, expansion, and the selection mutations.
//    • Accessibility — the VoiceOver tree summary + group / leaf labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySignalCategoryTreeSource`. The pure
//  adapter subset is additionally proven by an executed host harness (gate log).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: catalog + projection + filter

final class SignalCategoryTreeBuilderTests: XCTestCase {
    func testCatalogRankOrdersKnownThenUnknown() {
        XCTAssertEqual(SignalCategoryCatalog.rank("charging"), 0)
        XCTAssertEqual(SignalCategoryCatalog.rank("driving"), 1)
        XCTAssertEqual(SignalCategoryCatalog.rank("metadata"), 11)
        XCTAssertEqual(SignalCategoryCatalog.rank("not_a_category"), SignalCategoryCatalog.order.count)
    }

    func testFriendlyLabelFallsBackToRawId() {
        XCTAssertEqual(SignalCategoryTreeBuilder.friendlyLabel("safety_security"), "Safety & Security")
        XCTAssertEqual(SignalCategoryTreeBuilder.friendlyLabel("mystery"), "mystery")
    }

    func testBuildProjectionGroupsOrdersAndSortsLeaves() {
        let projection = SignalCategoryTreeBuilder.buildProjection(from: sampleDescriptors())
        // Groups ordered by category rank.
        XCTAssertEqual(
            projection.groups.map(\.id),
            ["charging", "driving", "powertrain", "climate", "location", "safety_security"]
        )
        // Charging leaves sorted by name ascending.
        let charging = projection.groups.first { $0.id == "charging" }
        XCTAssertEqual(charging?.leafIDs, ["battery_level", "charge_state", "charger_power"])
        XCTAssertEqual(charging?.label, "Charging")
        XCTAssertEqual(projection.totalLeafCount, 10)
        XCTAssertTrue(projection.hasData)
    }

    func testBuildProjectionEmptyHasNoData() {
        XCTAssertFalse(SignalCategoryTreeBuilder.buildProjection(from: []).hasData)
        XCTAssertEqual(SignalCategoryTreeProjection.empty.groups, [])
    }

    func testFilterGroupLabelMatchKeepsAllLeaves() {
        let groups = SignalCategoryTreeBuilder.buildProjection(from: sampleDescriptors()).groups
        let filtered = SignalCategoryTreeBuilder.filter(groups, query: "driv")
        XCTAssertEqual(filtered.map(\.id), ["driving"])
        XCTAssertEqual(filtered.first?.leaves.count, 3)
    }

    func testFilterLeafMatchKeepsOnlyMatchingLeaves() {
        let groups = SignalCategoryTreeBuilder.buildProjection(from: sampleDescriptors()).groups
        let filtered = SignalCategoryTreeBuilder.filter(groups, query: "speed")
        XCTAssertEqual(filtered.map(\.id), ["driving"])
        XCTAssertEqual(filtered.first?.leafIDs, ["vehicle_speed"])
    }

    func testFilterIsTrimmedCaseInsensitiveAndBlankReturnsInput() {
        let groups = SignalCategoryTreeBuilder.buildProjection(from: sampleDescriptors()).groups
        XCTAssertEqual(SignalCategoryTreeBuilder.filter(groups, query: "  CHARGING ").map(\.id), ["charging"])
        XCTAssertEqual(SignalCategoryTreeBuilder.filter(groups, query: "   ").count, groups.count)
        XCTAssertTrue(SignalCategoryTreeBuilder.filter(groups, query: "zzzzz").isEmpty)
    }
}

// MARK: - Adapter: tri-state + counts + selection transforms

final class SignalCategorySelectionTests: XCTestCase {
    func testStateReflectsCoverage() {
        XCTAssertEqual(SignalCategorySelection.state(of: ["a1", "b2"], in: ["a1", "b2"]), .all)
        XCTAssertEqual(SignalCategorySelection.state(of: ["a1", "b2"], in: ["a1"]), .partial)
        XCTAssertEqual(SignalCategorySelection.state(of: ["a1", "b2"], in: []), .none)
        XCTAssertEqual(SignalCategorySelection.state(of: [], in: ["a1"]), .none)
    }

    func testSelectedCount() {
        XCTAssertEqual(SignalCategorySelection.selectedCount(of: ["a1", "b2", "c3"], in: ["a1", "c3"]), 2)
    }

    func testToggleLeafAddsAndRemoves() {
        XCTAssertEqual(SignalCategorySelection.toggleLeaf("a1", in: []), ["a1"])
        XCTAssertEqual(SignalCategorySelection.toggleLeaf("a1", in: ["a1"]), [])
    }

    func testToggleAllSelectsThenClearsAndPreservesOutside() {
        // Partial → add all.
        XCTAssertEqual(SignalCategorySelection.toggleAll(["a1", "b2"], in: ["a1"]), ["a1", "b2"])
        // All → remove all, keeping unrelated selections.
        XCTAssertEqual(SignalCategorySelection.toggleAll(["a1", "b2"], in: ["a1", "b2", "x9"]), ["x9"])
        // Empty id list is a no-op.
        XCTAssertEqual(SignalCategorySelection.toggleAll([], in: ["x9"]), ["x9"])
    }

    func testSelectAllLabelResolvesEveryShape() {
        XCTAssertEqual(
            SignalCategorySelectAllLabel.resolve(isSearching: false, allVisibleSelected: false, visibleCount: 8),
            .selectAll
        )
        XCTAssertEqual(
            SignalCategorySelectAllLabel.resolve(isSearching: false, allVisibleSelected: true, visibleCount: 8),
            .clearAll
        )
        XCTAssertEqual(
            SignalCategorySelectAllLabel.resolve(isSearching: true, allVisibleSelected: false, visibleCount: 3),
            .selectVisible(3)
        )
        XCTAssertEqual(
            SignalCategorySelectAllLabel.resolve(isSearching: true, allVisibleSelected: true, visibleCount: 3),
            .clearVisible(3)
        )
    }
}

// MARK: - State holder: phases + telemetry + filter/expand/select wiring

@MainActor
final class SignalCategoryTreeModelTests: XCTestCase {
    func testResolvePhaseTable() {
        typealias Model = SignalCategoryTreeModel
        XCTAssertEqual(Model.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(Model.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(Model.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(Model.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(Model.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(Model.resolvePhase(status: .failed("boom"), hasData: false), .error("boom"))
        XCTAssertEqual(Model.resolvePhase(status: .failed("boom"), hasData: true), .content)
    }

    func testLoadingEmptyErrorContentFromSnapshots() {
        let (loading, _) = makeModel(SignalCategoryTreeUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)
        XCTAssertTrue(loading.isFetching)

        let (empty, _) = makeModel(SignalCategoryTreeUpdate(status: .loaded))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (failed, _) = makeModel(SignalCategoryTreeUpdate(status: .failed("net down")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("net down"))

        let (content, _) = makeModel(loadedUpdate())
        content.start()
        XCTAssertEqual(content.phase, .content)
        XCTAssertEqual(content.projection.groups.count, 6)
        XCTAssertEqual(content.totalLeafCount, 10)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = RecordingTelemetry()
        let (model, source) = makeModel(SignalCategoryTreeUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SignalCategoryTreeSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegateToSource() {
        let (model, source) = makeModel(SignalCategoryTreeUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.stop()
        model.start()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
    }

    func testStaleAutoRefreshFiresOnceUntilLiveAgain() {
        let (model, source) = makeModel(SignalCategoryTreeUpdate(status: .loading))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loadedUpdate(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loadedUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "second stale snapshot must not re-fire the guarded refresh")
        source.push(loadedUpdate(connection: .live))
        source.push(loadedUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "returning to live re-arms the one-shot")
    }

    func testSearchFilterNarrowsGroups() {
        let (model, _) = makeModel(loadedUpdate())
        model.start()
        model.setSearch("driv")
        XCTAssertTrue(model.isSearching)
        XCTAssertEqual(model.filteredGroups.map(\.id), ["driving"])
        model.setSearch("")
        XCTAssertEqual(model.filteredGroups.count, 6)
    }

    func testExpansionTogglesAndIsForcedWhileSearching() {
        let (model, _) = makeModel(loadedUpdate())
        model.start()
        XCTAssertFalse(model.isExpanded("charging"))
        model.toggleExpanded("charging")
        XCTAssertTrue(model.isExpanded("charging"))
        model.toggleExpanded("charging")
        XCTAssertFalse(model.isExpanded("charging"))
        // While searching every group is force-expanded and toggling is a no-op.
        model.setSearch("driv")
        XCTAssertTrue(model.isExpanded("driving"))
        model.toggleExpanded("driving")
        model.setSearch("")
        XCTAssertFalse(model.isExpanded("driving"))
    }

    func testSelectionMutations() throws {
        let (model, _) = makeModel(loadedUpdate())
        model.start()
        XCTAssertEqual(model.selectAllState, .none)
        XCTAssertEqual(model.selectAllLabel, .selectAll)

        model.toggleGroup("charging")
        let charging = try XCTUnwrap(model.filteredGroups.first { $0.id == "charging" })
        XCTAssertEqual(model.selectionState(of: charging), .all)
        XCTAssertEqual(model.selectedCount(in: charging), 3)
        XCTAssertEqual(model.selectedCount, 3)

        model.toggleLeaf("battery_level")
        XCTAssertEqual(model.selectionState(of: charging), .partial)

        model.toggleAllVisible()
        XCTAssertEqual(model.selectAllState, .all)
        XCTAssertEqual(model.selectAllLabel, .clearAll)
        XCTAssertEqual(model.selectedCount, model.totalLeafCount)

        model.clearAllSelected()
        XCTAssertEqual(model.selectedCount, 0)
    }

    // MARK: Fixtures

    private func makeModel(
        _ update: SignalCategoryTreeUpdate,
        telemetry: SignalCategoryTreeTelemetry = OSLogSignalCategoryTreeTelemetry()
    ) -> (SignalCategoryTreeModel, InMemorySignalCategoryTreeSource) {
        let source = InMemorySignalCategoryTreeSource(initial: update)
        let model = SignalCategoryTreeModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loadedUpdate(connection: SignalCategoryTreeConnection = .live) -> SignalCategoryTreeUpdate {
        SignalCategoryTreeUpdate(
            status: .loaded,
            connection: connection,
            descriptors: sampleDescriptors(),
            updatedAt: Date()
        )
    }
}

// MARK: - Accessibility

final class SignalCategoryTreeAccessibilityTests: XCTestCase {
    func testTreeSummaryFallsBackToEmptyMessageWhenNoCatalog() {
        XCTAssertEqual(
            SignalCategoryTreeAccessibility.treeSummary(selectedCount: 0, totalLeafCount: 0),
            SignalCategoryTreeStrings.emptyMessage
        )
    }

    func testTreeSummaryIncludesCounts() {
        let summary = SignalCategoryTreeAccessibility.treeSummary(selectedCount: 2, totalLeafCount: 13)
        XCTAssertTrue(summary.contains("2"))
        XCTAssertTrue(summary.contains("13"))
    }

    func testGroupLabelIncludesLabelAndCounts() {
        let group = SignalCategoryGroup(
            id: "charging",
            label: "Charging",
            leaves: [leaf("battery_level", .int), leaf("charge_state", .string), leaf("charger_power", .float)]
        )
        let label = SignalCategoryTreeAccessibility.groupLabel(group, selectedCount: 1)
        XCTAssertTrue(label.contains("Charging"))
        XCTAssertTrue(label.contains("1"))
        XCTAssertTrue(label.contains("3"))
    }

    func testLeafLabelReflectsSelectionAndKind() {
        let selected = SignalCategoryTreeAccessibility.leafLabel(leaf("charger_power", .float), isSelected: true)
        XCTAssertTrue(selected.contains("charger_power"))
        XCTAssertTrue(selected.contains("float"))
        XCTAssertFalse(selected.contains("not selected"))

        let unselected = SignalCategoryTreeAccessibility.leafLabel(leaf("locked", .bool), isSelected: false)
        XCTAssertTrue(unselected.contains("not selected"))
    }

    private func leaf(_ name: String, _ kind: SignalValueKind) -> SignalCategoryLeaf {
        SignalCategoryLeaf(descriptor: SignalDescriptor(name: name, category: "charging", valueKind: kind))
    }
}

// MARK: - Shared fixtures + doubles

private func sampleDescriptors() -> [SignalDescriptor] {
    [
        SignalDescriptor(name: "charger_power", category: "charging", valueKind: .float, unitKind: .charge),
        SignalDescriptor(name: "charge_state", category: "charging", valueKind: .string),
        SignalDescriptor(name: "battery_level", category: "charging", valueKind: .int, unitKind: .charge),
        SignalDescriptor(name: "vehicle_speed", category: "driving", valueKind: .float, unitKind: .speed),
        SignalDescriptor(name: "odometer", category: "driving", valueKind: .float, unitKind: .distance),
        SignalDescriptor(name: "shift_state", category: "driving", valueKind: .string),
        SignalDescriptor(name: "motor_rpm", category: "powertrain", valueKind: .int),
        // Single-leaf groups exercise the rank-then-label group ordering.
        SignalDescriptor(name: "inside_temp", category: "climate", valueKind: .float, unitKind: .temperature),
        SignalDescriptor(name: "latitude", category: "location", valueKind: .float),
        SignalDescriptor(name: "sentry_mode", category: "safety_security", valueKind: .bool)
    ]
}

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class RecordingTelemetry: SignalCategoryTreeTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
