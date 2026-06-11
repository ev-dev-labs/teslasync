//
//  ChartContainer.Tests.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  State-holder + view coverage for the ChartContainer surface: the model's lifecycle (start
//  idempotence + the once-only `view.opened` telemetry that fires on appear), the annotation
//  projection + persisted hide toggle, the connectivity axis with the one-shot stale auto-refresh
//  (re-armed on return to live) and offline never auto-refreshing, the validated add/remove
//  forwarding, the live source binding, and the every-state view composition (signature contract).
//  Runs in the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class ChartContainerModelTests: XCTestCase {
    private struct Harness {
        let model: ChartContainerModel
        let source: InMemoryChartContainerSource
        let store: InMemoryChartContainerHiddenStore
        let spy: SpyChartContainerTelemetry
    }

    private func makeHarness(
        _ input: ChartContainerInput,
        annotationsEnabled: Bool = false,
        seedHidden: Bool = false
    ) -> Harness {
        let source = InMemoryChartContainerSource(initial: input)
        let store = InMemoryChartContainerHiddenStore(seed: seedHidden ? ["battery": true] : [:])
        let spy = SpyChartContainerTelemetry()
        let content = ChartContainerContent(
            title: "Trend",
            ariaLabel: "Trend",
            annotationsEnabled: annotationsEnabled,
            annotationKey: "battery",
            scope: .battery,
            vehicleID: 7
        )
        let model = ChartContainerModel(content: content, source: source, telemetry: spy, hiddenStore: store)
        return Harness(model: model, source: source, store: store, spy: spy)
    }

    func testStartIsIdempotent() {
        let env = makeHarness(ChartContainerInput())
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let env = makeHarness(ChartContainerInput())
        env.model.start()
        XCTAssertEqual(env.spy.surfaces, [ChartContainerMeta.surfaceSlug])
        env.source.push(ChartContainerInput(connection: .stale))
        XCTAssertEqual(env.spy.surfaces, [ChartContainerMeta.surfaceSlug])
    }

    func testViewOpenedStaysOnceAcrossStopStart() {
        let env = makeHarness(ChartContainerInput())
        env.model.start()
        env.model.stop()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
        XCTAssertEqual(env.spy.surfaces, [ChartContainerMeta.surfaceSlug])
    }

    func testApplyProjectsAnnotationsWhenEnabled() {
        let env = makeHarness(ChartContainerInput(annotations: [sampleRow()]), annotationsEnabled: true)
        env.model.start()
        XCTAssertEqual(env.model.fetchedAnnotations.count, 1)
        XCTAssertEqual(env.model.fetchedAnnotations.first?.category, .maintenance)
    }

    func testApplyDropsAnnotationsWhenDisabled() {
        let env = makeHarness(ChartContainerInput(annotations: [sampleRow()]), annotationsEnabled: false)
        env.model.start()
        XCTAssertTrue(env.model.fetchedAnnotations.isEmpty)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let env = makeHarness(ChartContainerInput(connection: .live))
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)
        env.source.push(ChartContainerInput(connection: .stale))
        XCTAssertEqual(env.model.connection, .stale)
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(ChartContainerInput(connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let env = makeHarness(ChartContainerInput(connection: .live))
        env.model.start()
        env.source.push(ChartContainerInput(connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(ChartContainerInput(connection: .live))
        env.source.push(ChartContainerInput(connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineNeverAutoRefreshes() {
        let env = makeHarness(ChartContainerInput(connection: .live))
        env.model.start()
        env.source.push(ChartContainerInput(connection: .offline))
        XCTAssertEqual(env.model.connection, .offline)
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let env = makeHarness(ChartContainerInput())
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testToggleHiddenPersistsAndReloads() {
        let env = makeHarness(ChartContainerInput(), annotationsEnabled: true)
        XCTAssertFalse(env.model.hidden)
        env.model.toggleHidden()
        XCTAssertTrue(env.model.hidden)
        XCTAssertTrue(env.store.isHidden("battery"))
        // A fresh model bound to the same store reads the persisted preference (web readHiddenPref).
        let reloaded = ChartContainerModel(
            content: ChartContainerContent(
                title: "Trend",
                ariaLabel: "Trend",
                annotationsEnabled: true,
                annotationKey: "battery"
            ),
            source: InMemoryChartContainerSource(),
            hiddenStore: env.store
        )
        XCTAssertTrue(reloaded.hidden)
    }

    func testToggleHiddenNoOpWhenDisabled() {
        let env = makeHarness(ChartContainerInput(), annotationsEnabled: false)
        env.model.toggleHidden()
        XCTAssertFalse(env.model.hidden)
        XCTAssertFalse(env.store.isHidden("battery"))
    }

    func testAddAnnotationValidatesStampsAndCloses() {
        let env = makeHarness(ChartContainerInput(), annotationsEnabled: true)
        env.model.start()
        env.model.setAddFormOpen(true)
        env.model.addAnnotation(
            label: "Tire",
            category: .maintenance,
            description: " ",
            occurredAt: "2026-01-01T00:00:00Z"
        )
        XCTAssertEqual(env.source.created.count, 1)
        let draft = try? XCTUnwrap(env.source.created.first)
        XCTAssertEqual(draft?.title, "Tire")
        XCTAssertEqual(draft?.scope, .battery) // stamped from content
        XCTAssertEqual(draft?.vehicleID, 7)
        XCTAssertFalse(env.model.addFormOpen)
    }

    func testAddAnnotationRejectsInvalid() {
        let env = makeHarness(ChartContainerInput(), annotationsEnabled: true)
        env.model.addAnnotation(label: " ", category: .trip, description: nil, occurredAt: "2026-01-01T00:00:00Z")
        env.model.addAnnotation(label: "Trip", category: .trip, description: nil, occurredAt: "")
        XCTAssertTrue(env.source.created.isEmpty)
    }

    func testRemoveAnnotationValidatesNumericPositive() {
        let env = makeHarness(ChartContainerInput(), annotationsEnabled: true)
        env.model.removeAnnotation(id: "42")
        env.model.removeAnnotation(id: "0")
        env.model.removeAnnotation(id: "nope")
        XCTAssertEqual(env.source.deleted, [42])
    }

    func testResolvedFoldsBodyProps() {
        let env = makeHarness(ChartContainerInput())
        env.model.start()
        XCTAssertEqual(
            env.model.resolved(loading: true, empty: false, hasError: false, rowCount: 0, columnCount: 0).status,
            .loading
        )
        XCTAssertEqual(
            env.model.resolved(loading: false, empty: true, hasError: false, rowCount: 0, columnCount: 0).status,
            .empty
        )
        XCTAssertEqual(
            env.model.resolved(loading: false, empty: false, hasError: true, rowCount: 0, columnCount: 0).status,
            .error
        )
        XCTAssertEqual(
            env.model.resolved(loading: false, empty: false, hasError: false, rowCount: 0, columnCount: 0).status,
            .ready
        )
    }
}

// MARK: - Live source (production binding)

@MainActor
final class LiveChartContainerSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheBoundSnapshot() {
        let input = ChartContainerInput(connection: .stale, annotations: [sampleRow()])
        let source = LiveChartContainerSource(input: input, onCreate: { _ in }, onDelete: { _ in })
        var emissions: [ChartContainerInput] = []
        source.onUpdate = { emissions.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [input, input])
    }

    func testCreateAndDeleteForwardToHandlers() {
        var created: [ChartContainerAnnotationDraft] = []
        var deleted: [Int64] = []
        let source = LiveChartContainerSource(
            input: ChartContainerInput(),
            onCreate: { created.append($0) },
            onDelete: { deleted.append($0) }
        )
        source.create(
            ChartContainerAnnotationDraft(
                vehicleID: 7,
                occurredAt: "2026-01-01T00:00:00Z",
                category: .issue,
                title: "Fault",
                description: nil,
                scope: .drivetrain
            )
        )
        source.delete(id: 5)
        XCTAssertEqual(created.count, 1)
        XCTAssertEqual(deleted, [5])
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class ChartContainerViewTests: XCTestCase {
    private func content(annotationsEnabled: Bool = false) -> ChartContainerContent {
        ChartContainerContent(
            title: "Trend",
            subtitle: "Last 30 days",
            ariaLabel: "Trend",
            hasExportData: true,
            fullscreen: true,
            annotationsEnabled: annotationsEnabled,
            annotationKey: "battery",
            scope: .battery
        )
    }

    func testChromeSubviewsCompose() {
        _ = ChartContainerConnectivityChip(connection: .stale) {}
        _ = ChartContainerConnectivityBanner(connection: .offline)
        _ = ChartContainerExportMenu(hasCsv: true, renderImage: { nil }, csv: { "a,b" })
        _ = ChartContainerFullscreenButton(expanded: .constant(false))
        _ = ChartContainerErrorState {}
        _ = ChartContainerMarkerRow(annotations: [sampleAnnotationT()])
        _ = ChartContainerAnnotationList(annotations: [sampleAnnotationT()]) { _ in }
        _ = ChartContainerAddAnnotationForm(onAdd: { _, _, _, _ in }, onCancel: {})
        _ = ChartContainerFallbackTable(
            title: "Trend",
            ariaDescription: "Prose",
            columns: [ChartContainerDataColumn(key: "k", label: "K")],
            rows: [["k": .number(1)]]
        )
    }

    func testSurfaceComposesForEveryBodyState() {
        let states: [ChartContainerBodyState] = [
            ChartContainerBodyState(loading: true),
            ChartContainerBodyState(empty: true),
            ChartContainerBodyState(hasError: true),
            ChartContainerBodyState()
        ]
        for state in states {
            let model = ChartContainerModel(content: content(), source: InMemoryChartContainerSource())
            _ = ChartContainer(
                model: model,
                loading: state.loading,
                empty: state.empty,
                hasError: state.hasError
            ) { _ in
                Color.clear
            }
        }
    }

    func testSurfaceComposesAcrossConnectivityAndAnnotations() {
        for connection in ChartContainerConnection.allCases {
            let model = ChartContainerModel(
                content: content(annotationsEnabled: true),
                source: InMemoryChartContainerSource(
                    initial: ChartContainerInput(connection: connection, annotations: [sampleRow()])
                )
            )
            _ = ChartContainer(
                model: model,
                data: [["k": .number(1)]],
                dataColumns: [ChartContainerDataColumn(key: "k", label: "K")]
            ) { _ in Color.clear } action: {
                Text(verbatim: "Action")
            }
        }
    }
}

// MARK: - Test doubles + fixtures

private final class SpyChartContainerTelemetry: ChartContainerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }
}

private func sampleRow() -> ChartContainerAnnotationRow {
    ChartContainerAnnotationRow(
        id: 1,
        vehicleID: 7,
        occurredAt: "2026-05-02T10:00:00Z",
        category: "maintenance",
        title: "Tire rotation",
        description: "Rotated tires",
        scope: ["battery"],
        createdAt: "2026-05-02T11:00:00Z",
        updatedAt: "2026-05-02T11:00:00Z"
    )
}

private func sampleAnnotationT() -> ChartContainerAnnotation {
    ChartContainerAnnotationAdapter.project(sampleRow())
}
