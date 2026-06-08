import SwiftUI
import XCTest
@testable import TeslaSync

/// Spy diagnostics that records every `view.opened` surface it receives.
@MainActor
private final class DestinationETADiagnosticsSpy: DestinationETADiagnostics {
    private(set) var openedSurfaces: [String] = []

    func recordViewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}

@MainActor final class DestinationETAWidgetTests: XCTestCase {
    // MARK: - Data adapter (cached JSON → projection)

    func testProjectionMapsNavigatingSnapshot() {
        let json: [String: Any] = [
            "destination_name": "Home Depot",
            "miles_to_arrival": 12500.0,
            "minutes_to_arrival": 17.0,
            "located_at_home": false,
            "located_at_work": true,
            "located_at_favorite": false
        ]
        let snapshot = DestinationETASnapshot.from(json: json)
        XCTAssertEqual(snapshot.destinationName, "Home Depot")
        XCTAssertEqual(snapshot.metersToArrival, 12500)
        XCTAssertEqual(snapshot.minutesToArrival, 17)
        XCTAssertFalse(snapshot.locatedAtHome)
        XCTAssertTrue(snapshot.locatedAtWork)
        XCTAssertFalse(snapshot.locatedAtFavorite)
    }

    func testProjectionToleratesMissingAndIntegerFields() {
        let snapshot = DestinationETASnapshot.from(json: ["minutes_to_arrival": 5])
        XCTAssertNil(snapshot.destinationName)
        XCTAssertNil(snapshot.metersToArrival)
        XCTAssertEqual(snapshot.minutesToArrival, 5)
        XCTAssertFalse(snapshot.locatedAtHome)
    }

    func testSharedJSONBridgeParsesObjectText() {
        let text = """
        {"destination_name":"Office","miles_to_arrival":3000,"minutes_to_arrival":6,"located_at_favorite":true}
        """
        let snapshot = DestinationETASnapshot.fromSharedJSON(text)
        XCTAssertEqual(snapshot?.destinationName, "Office")
        XCTAssertEqual(snapshot?.metersToArrival, 3000)
        XCTAssertTrue(snapshot?.locatedAtFavorite ?? false)
    }

    func testSharedJSONBridgeReturnsNilForNullSnapshot() {
        XCTAssertNil(DestinationETASnapshot.fromSharedJSON("null"))
        XCTAssertNil(DestinationETASnapshot.fromSharedJSON("\"unexpected\""))
    }

    // MARK: - View-state derivation

    func testViewStateNavigatingDerivations() {
        let snapshot = DestinationETASnapshot(
            destinationName: "Supercharger",
            metersToArrival: 9000,
            minutesToArrival: 85
        )
        let viewState = DestinationETAViewState(snapshot: snapshot)
        XCTAssertTrue(viewState.isNavigating)
        XCTAssertEqual(viewState.destinationName, "Supercharger")
        XCTAssertEqual(viewState.roundedMinutes, 85)
        XCTAssertEqual(viewState.etaText, "1h 25m")
        XCTAssertEqual(viewState.location, .other)
        XCTAssertGreaterThan(viewState.progressFraction, 0)
        XCTAssertLessThanOrEqual(viewState.progressFraction, 1)
    }

    func testViewStateEtaUnderOneHour() {
        let snapshot = DestinationETASnapshot(destinationName: "Cafe", metersToArrival: 500, minutesToArrival: 9)
        let viewState = DestinationETAViewState(snapshot: snapshot)
        XCTAssertEqual(viewState.etaText, "9m")
    }

    func testViewStateIdleWhenNoDestination() {
        let snapshot = DestinationETASnapshot(destinationName: "", locatedAtHome: true)
        let viewState = DestinationETAViewState(snapshot: snapshot)
        XCTAssertFalse(viewState.isNavigating)
        XCTAssertEqual(viewState.destinationName, "—")
        XCTAssertEqual(viewState.progressFraction, 0)
        XCTAssertEqual(viewState.location, .home)
    }

    func testLocationKindPriorityAndMetadata() {
        XCTAssertEqual(DestinationETALocationKind(snapshot: .init(locatedAtHome: true, locatedAtWork: true)), .home)
        XCTAssertEqual(DestinationETALocationKind(snapshot: .init(locatedAtWork: true)), .work)
        XCTAssertEqual(DestinationETALocationKind(snapshot: .init(locatedAtFavorite: true)), .favorite)
        XCTAssertEqual(DestinationETALocationKind(snapshot: .init()), .other)
        XCTAssertEqual(DestinationETALocationKind.home.symbol, "🏠")
        XCTAssertEqual(DestinationETALocationKind.other.tone, .warning)
    }

    // MARK: - Freshness derivation

    func testFreshnessClassification() {
        XCTAssertEqual(DestinationETAFreshness(state: .loaded(.init(), stale: false)), .live)
        XCTAssertEqual(DestinationETAFreshness(state: .loaded(.init(), stale: true)), .stale)
        XCTAssertEqual(
            DestinationETAFreshness(state: .failed(.offline, cached: .init(), stale: true)),
            .offline
        )
        XCTAssertEqual(
            DestinationETAFreshness(state: .failed(
                .api(status: 500, code: nil, body: nil),
                cached: .init(),
                stale: false
            )),
            .stale
        )
    }

    // MARK: - Model state mapping (one assertion set per rendered state)

    func testModelLoadingState() {
        let model = DestinationETAWidgetModel(state: .loading(cached: nil, stale: false))
        XCTAssertTrue(model.isInitialLoading)
        XCTAssertNil(model.viewState)
        XCTAssertNil(model.blockingError)
    }

    func testModelEmptyState() {
        let model = DestinationETAWidgetModel(state: .empty(stale: false))
        XCTAssertFalse(model.isInitialLoading)
        XCTAssertNil(model.viewState)
        XCTAssertNil(model.blockingError)
    }

    func testModelErrorState() {
        let model = DestinationETAWidgetModel(state: .failed(
            .api(status: 500, code: nil, body: nil),
            cached: nil,
            stale: false
        ))
        XCTAssertEqual(model.blockingError, .api(status: 500, code: nil, body: nil))
        XCTAssertNil(model.viewState)
    }

    func testModelOfflineKeepsCachedValue() {
        let cached = DestinationETASnapshot(destinationName: "Home", metersToArrival: 100, minutesToArrival: 2)
        let model = DestinationETAWidgetModel(state: .failed(.offline, cached: cached, stale: true))
        XCTAssertNil(model.blockingError, "Offline with cache must keep showing content, not the error view")
        XCTAssertEqual(model.freshness, .offline)
        XCTAssertEqual(model.viewState?.isNavigating, true)
    }

    func testModelLoadedNavigatingState() {
        let snapshot = DestinationETASnapshot(destinationName: "Work", metersToArrival: 4000, minutesToArrival: 12)
        let model = DestinationETAWidgetModel(state: .loaded(snapshot, stale: false))
        XCTAssertEqual(model.viewState?.isNavigating, true)
        XCTAssertEqual(model.freshness, .live)
        XCTAssertFalse(model.isInitialLoading)
    }

    func testDisplayDistanceConvertsFromSI() {
        let model = DestinationETAWidgetModel(state: .empty(stale: false), unitPreferences: .metric)
        XCTAssertEqual(model.displayDistance(meters: 1500), 1.5, accuracy: 0.0001)
    }

    // MARK: - Diagnostics (view.opened)

    func testStartEmitsViewOpenedOncePerSurface() {
        let spy = DestinationETADiagnosticsSpy()
        let model = DestinationETAWidgetModel(state: .empty(stale: false), diagnostics: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.openedSurfaces, ["DestinationETAWidget"])
    }

    // MARK: - Registry metadata

    func testRegistryMatchesWebSource() {
        let registry = DestinationETAWidget.registry
        XCTAssertEqual(registry.id, "destination-eta")
        XCTAssertEqual(registry.category, "maps")
        XCTAssertEqual(registry.surfaceSlug, "DestinationETAWidget")
        XCTAssertEqual(registry.defaultSize, .init(cols: 2, rows: 2))
        XCTAssertEqual(registry.minSize, .init(cols: 1, rows: 2))
        XCTAssertEqual(registry.maxSize, .init(cols: 3, rows: 40))
    }

    func testRegistryClampHonorsBounds() {
        let registry = DestinationETAWidget.registry
        XCTAssertEqual(registry.clamp(.init(cols: 0, rows: 1)), .init(cols: 1, rows: 2))
        XCTAssertEqual(registry.clamp(.init(cols: 9, rows: 99)), .init(cols: 3, rows: 40))
        XCTAssertEqual(registry.clamp(.init(cols: 2, rows: 3)), .init(cols: 2, rows: 3))
    }

    // MARK: - Accessibility label keys present

    func testAccessibilityLabelKeysResolveToCatalogKeys() {
        XCTAssertEqual(DestinationETALocationKind.home.labelKeyString, "translation.widget.destinationETA.home")
        XCTAssertEqual(DestinationETALocationKind.work.labelKeyString, "translation.widget.destinationETA.work")
        XCTAssertEqual(DestinationETALocationKind.favorite.labelKeyString, "translation.widget.destinationETA.favorite")
        XCTAssertEqual(DestinationETALocationKind.other.labelKeyString, "translation.widget.destinationETA.other")
    }

    // MARK: - Per-state render smoke (evaluates the SwiftUI body via ImageRenderer)

    func testWidgetRendersEveryStandardState() {
        let navigating = DestinationETASnapshot(
            destinationName: "Supercharger",
            metersToArrival: 18000,
            minutesToArrival: 23
        )
        let states: [LoadableState<DestinationETASnapshot>] = [
            .loading(cached: nil, stale: false),
            .empty(stale: false),
            .loaded(navigating, stale: false),
            .loaded(.init(destinationName: "", locatedAtHome: true), stale: false),
            .loaded(navigating, stale: true),
            .failed(.offline, cached: navigating, stale: true),
            .failed(.api(status: 503, code: nil, body: nil), cached: nil, stale: false)
        ]
        for state in states {
            let widget = DestinationETAWidget(
                model: DestinationETAWidgetModel(state: state),
                size: .init(cols: 2, rows: 2)
            )
            XCTAssertTrue(rendersToImage(widget, width: 240, height: 220), "Standard state failed to render: \(state)")
        }
    }

    func testWidgetRendersCompactStates() {
        let navigating = DestinationETASnapshot(destinationName: "Cafe", metersToArrival: 800, minutesToArrival: 4)
        let states: [LoadableState<DestinationETASnapshot>] = [
            .loaded(navigating, stale: false),
            .loaded(.init(destinationName: "", locatedAtFavorite: true), stale: false),
            .empty(stale: false)
        ]
        for state in states {
            let widget = DestinationETAWidget(
                model: DestinationETAWidgetModel(state: state),
                size: .init(cols: 1, rows: 2)
            )
            XCTAssertTrue(rendersToImage(widget, width: 130, height: 200), "Compact state failed to render: \(state)")
        }
    }

    private func rendersToImage(_ view: some View, width: CGFloat, height: CGFloat) -> Bool {
        let renderer = ImageRenderer(content: view.frame(width: width, height: height))
        #if canImport(UIKit)
            return renderer.uiImage != nil
        #elseif canImport(AppKit)
            return renderer.nsImage != nil
        #else
            return renderer.cgImage != nil
        #endif
    }
}
