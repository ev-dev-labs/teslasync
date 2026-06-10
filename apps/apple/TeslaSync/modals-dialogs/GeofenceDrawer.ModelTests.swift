//
//  GeofenceDrawer.ModelTests.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  State-holder coverage for `GeofenceDrawerModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across loading / loaded-empty / failed (incl. the inline
//  error when a cached snapshot survives a failed reload), the resolved modes + draft-mode
//  reconcile, the interactive create (tap + radius → `onCreate`), edit (`beginEdit` → `onEdit`),
//  delete (`onDelete`), the stale auto-refresh (once, re-armed on return to live), and offline
//  keeping the surface. Driven through the in-memory source — no persistence.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyGeofenceTelemetry: GeofenceDrawerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }; return storage
    }
}

/// Records the create / edit / delete intents.
private final class SpyGeofenceController: GeofenceDrawerController, @unchecked Sendable {
    private let lock = NSLock()
    private(set) var created: [NewGeofence] = []
    private(set) var edited: [(id: String, geofence: NewGeofence)] = []
    private(set) var deleted: [String] = []

    func create(_ geofence: NewGeofence) {
        lock.lock(); created.append(geofence); lock.unlock()
    }

    func edit(id: String, geofence: NewGeofence) {
        lock.lock(); edited.append((id, geofence)); lock.unlock()
    }

    func delete(id: String) {
        lock.lock(); deleted.append(id); lock.unlock()
    }
}

@MainActor
final class GeofenceDrawerModelTests: XCTestCase {
    private let circle = GeofenceItem(id: "1", name: "Home", lat: 37.7, lng: -122.4, radius: 200)

    private func makeModel(
        source: InMemoryGeofenceDrawerSource,
        telemetry: SpyGeofenceTelemetry = SpyGeofenceTelemetry(),
        controller: SpyGeofenceController = SpyGeofenceController()
    ) -> GeofenceDrawerModel {
        GeofenceDrawerModel(
            source: source,
            telemetry: telemetry,
            controller: controller,
            localize: passthroughLocalize
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyGeofenceTelemetry()
        let source = InMemoryGeofenceDrawerSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["GeofenceDrawer"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContentPopulatesRenderablesAndRows() {
        let source = InMemoryGeofenceDrawerSource(initial: GeofenceDrawerUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(GeofenceDrawerUpdate(status: .loaded, fences: [circle]))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.renderables.count, 1)
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertTrue(model.rows[0].text.contains("Home"))
    }

    func testLoadedNoFencesResolvesEmpty() {
        let source = InMemoryGeofenceDrawerSource(initial: GeofenceDrawerUpdate(status: .loaded, fences: []))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedNoCacheResolvesError() {
        let source = InMemoryGeofenceDrawerSource(initial: GeofenceDrawerUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithCacheKeepsSurfaceAndSurfacesInlineError() {
        let loaded = GeofenceDrawerUpdate(status: .loaded, fences: [circle])
        let source = InMemoryGeofenceDrawerSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(GeofenceDrawerUpdate(status: .failed("stale read"), fences: [circle]))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    func testModesResolvedAndDraftModeReconciled() {
        let source = InMemoryGeofenceDrawerSource(
            initial: GeofenceDrawerUpdate(status: .loaded, fences: [], modes: [.polygon])
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.modes, [.polygon])
        XCTAssertEqual(model.draft.mode, .polygon) // .circle not allowed → reconciled
    }

    func testSelectModeResetsDraft() {
        let source = InMemoryGeofenceDrawerSource(
            initial: GeofenceDrawerUpdate(status: .loaded, fences: [], modes: [.circle, .polygon])
        )
        let model = makeModel(source: source)
        model.start()
        model.addPoint(GeofencePoint(lat: 1, lng: 1))
        model.selectMode(.polygon)
        XCTAssertEqual(model.draft.mode, .polygon)
        XCTAssertEqual(model.draft.pointCount, 0)
    }

    func testCommitCircleCreatesGeometryAndClearsDraft() {
        let controller = SpyGeofenceController()
        let source = InMemoryGeofenceDrawerSource(initial: GeofenceDrawerUpdate(status: .loaded, fences: []))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.selectMode(.circle)
        model.addPoint(GeofencePoint(lat: 10, lng: 20))
        model.setRadius(300)
        XCTAssertTrue(model.canCommitDraft)
        model.commitDraft()
        XCTAssertEqual(controller.created.count, 1)
        XCTAssertEqual(controller.created.first, NewGeofence(shape: .circle, lat: 10, lng: 20, radius: 300))
        XCTAssertEqual(model.draft.pointCount, 0)
    }

    func testCommitPolygonCreatesRing() {
        let controller = SpyGeofenceController()
        let source = InMemoryGeofenceDrawerSource(
            initial: GeofenceDrawerUpdate(status: .loaded, fences: [], modes: [.polygon])
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.addPoint(GeofencePoint(lat: 0, lng: 0))
        model.addPoint(GeofencePoint(lat: 0, lng: 1))
        model.addPoint(GeofencePoint(lat: 1, lng: 1))
        model.commitDraft()
        XCTAssertEqual(controller.created.first?.shape, .polygon)
        XCTAssertEqual(controller.created.first?.polygon?.count, 3)
    }

    func testCommitDoesNothingWhenDraftIncomplete() {
        let controller = SpyGeofenceController()
        let source = InMemoryGeofenceDrawerSource(initial: GeofenceDrawerUpdate(status: .loaded, fences: []))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.commitDraft()
        XCTAssertTrue(controller.created.isEmpty)
    }

    func testBeginEditLoadsDraftAndCommitEdits() {
        let controller = SpyGeofenceController()
        let source = InMemoryGeofenceDrawerSource(initial: GeofenceDrawerUpdate(status: .loaded, fences: [circle]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.beginEdit(id: "1")
        XCTAssertTrue(model.isEditing)
        XCTAssertEqual(model.draft.mode, .circle)
        XCTAssertEqual(model.focusedFenceID, "1")
        model.commitDraft()
        XCTAssertEqual(controller.edited.count, 1)
        XCTAssertEqual(controller.edited.first?.id, "1")
        XCTAssertTrue(controller.created.isEmpty)
        XCTAssertFalse(model.isEditing)
    }

    func testDeleteForwardsToController() {
        let controller = SpyGeofenceController()
        let source = InMemoryGeofenceDrawerSource(initial: GeofenceDrawerUpdate(status: .loaded, fences: [circle]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.deleteFence(id: "1")
        XCTAssertEqual(controller.deleted, ["1"])
    }

    func testFocusFenceSetsFocusedID() {
        let source = InMemoryGeofenceDrawerSource(initial: GeofenceDrawerUpdate(status: .loaded, fences: [circle]))
        let model = makeModel(source: source)
        model.start()
        model.focusFence(id: "1")
        XCTAssertEqual(model.focusedFenceID, "1")
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let loaded = GeofenceDrawerUpdate(status: .loaded, fences: [circle])
        let source = InMemoryGeofenceDrawerSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(GeofenceDrawerUpdate(status: .loaded, fences: [circle], connection: .stale))
        source.push(GeofenceDrawerUpdate(status: .loaded, fences: [circle], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(GeofenceDrawerUpdate(status: .loaded, fences: [circle], connection: .live))
        source.push(GeofenceDrawerUpdate(status: .loaded, fences: [circle], connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsSurfaceAndDoesNotRefresh() {
        let loaded = GeofenceDrawerUpdate(status: .loaded, fences: [circle])
        let source = InMemoryGeofenceDrawerSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(GeofenceDrawerUpdate(status: .loaded, fences: [circle], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
