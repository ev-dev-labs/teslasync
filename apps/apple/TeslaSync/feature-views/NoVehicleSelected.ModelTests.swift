//
//  NoVehicleSelected.ModelTests.swift
//  TeslaSync — P4 feature view · 0193 · NoVehicleSelected (Apple)
//
//  State-holder coverage for `NoVehicleSelectedModel`: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across resolving / resolved-none /
//  resolved-some / failed, the onboarding navigation seam, the stale auto-refresh (once,
//  re-armed on return to live), offline keeping the cached selection without refetching,
//  and the empty-state copy overrides (web `pageTitle` / `title` / `description` props).
//  Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable`
/// telemetry seam under Swift 6 strict concurrency.
private final class SpyNoVehicleSelectedTelemetry: NoVehicleSelectedTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

/// Records the onboarding navigation intents (web `useNavigate`). Lock-guarded for the
/// `Sendable` navigator seam.
private final class SpyNoVehicleSelectedNavigator: NoVehicleSelectedNavigator, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func goToOnboarding() {
        lock.lock()
        count += 1
        lock.unlock()
    }

    var onboardingCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

private enum NoVehicleSelectedSampleSelection {
    static let vehicle = SelectedVehicleRef(id: "veh_1", displayName: "Midnight Model 3")
}

@MainActor
final class NoVehicleSelectedModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryNoVehicleSelectedSource,
        telemetry: SpyNoVehicleSelectedTelemetry = SpyNoVehicleSelectedTelemetry(),
        navigator: SpyNoVehicleSelectedNavigator = SpyNoVehicleSelectedNavigator(),
        pageTitle: String? = nil,
        title: String? = nil,
        description: String? = nil
    ) -> NoVehicleSelectedModel {
        NoVehicleSelectedModel(
            source: source,
            telemetry: telemetry,
            navigator: navigator,
            pageTitle: pageTitle,
            title: title,
            description: description,
            localize: passthroughLocalize
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyNoVehicleSelectedTelemetry()
        let source = InMemoryNoVehicleSelectedSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["NoVehicleSelected"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testResolvingThenEmpty() {
        let source = InMemoryNoVehicleSelectedSource(initial: NoVehicleSelectedUpdate(feed: .resolving))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(NoVehicleSelectedUpdate(feed: .resolved(nil)))
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selected)
    }

    func testResolvedSomeResolvesContentWithSelection() {
        let source = InMemoryNoVehicleSelectedSource(
            initial: NoVehicleSelectedUpdate(feed: .resolved(NoVehicleSelectedSampleSelection.vehicle))
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.selected, NoVehicleSelectedSampleSelection.vehicle)
        XCTAssertTrue(model.readyBody.contains("Midnight Model 3"))
    }

    func testFailedResolvesErrorWithMessage() {
        let source = InMemoryNoVehicleSelectedSource(
            initial: NoVehicleSelectedUpdate(feed: .failed(message: "token revoked"))
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("token revoked"))
        XCTAssertEqual(model.errorMessage, "token revoked")
    }

    func testGoToOnboardingDrivesNavigator() {
        let source = InMemoryNoVehicleSelectedSource(initial: NoVehicleSelectedUpdate(feed: .resolved(nil)))
        let navigator = SpyNoVehicleSelectedNavigator()
        let model = makeModel(source: source, navigator: navigator)
        model.start()
        model.goToOnboarding()
        XCTAssertEqual(navigator.onboardingCount, 1)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryNoVehicleSelectedSource(initial: NoVehicleSelectedUpdate(feed: .resolved(nil)))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(NoVehicleSelectedUpdate(feed: .resolved(nil), connection: .stale))
        source.push(NoVehicleSelectedUpdate(feed: .resolved(nil), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(NoVehicleSelectedUpdate(feed: .resolved(nil), connection: .live))
        source.push(NoVehicleSelectedUpdate(feed: .resolved(nil), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsSelectionAndDoesNotRefresh() {
        let source = InMemoryNoVehicleSelectedSource(
            initial: NoVehicleSelectedUpdate(feed: .resolved(NoVehicleSelectedSampleSelection.vehicle))
        )
        let model = makeModel(source: source)
        model.start()
        source.push(NoVehicleSelectedUpdate(
            feed: .resolved(NoVehicleSelectedSampleSelection.vehicle),
            connection: .offline
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.selected, NoVehicleSelectedSampleSelection.vehicle)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRefreshDrivesSource() {
        let source = InMemoryNoVehicleSelectedSource(
            initial: NoVehicleSelectedUpdate(feed: .failed(message: "boom"))
        )
        let model = makeModel(source: source)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopHaltsSourceAndAllowsRestart() {
        let source = InMemoryNoVehicleSelectedSource()
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testCopyDefaultsToWebStrings() {
        let source = InMemoryNoVehicleSelectedSource(initial: NoVehicleSelectedUpdate(feed: .resolved(nil)))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.emptyTitle, "No vehicle selected")
        XCTAssertEqual(model.emptyDescription, "Add a vehicle to your fleet to see data on this page.")
        XCTAssertEqual(model.actionLabel, "Set up TeslaSync")
    }

    func testCopyOverridesAreApplied() {
        let source = InMemoryNoVehicleSelectedSource(initial: NoVehicleSelectedUpdate(feed: .resolved(nil)))
        let model = makeModel(
            source: source,
            pageTitle: "Battery",
            title: "Pick a vehicle first",
            description: "Choose a vehicle to see its battery."
        )
        model.start()
        XCTAssertEqual(model.pageTitle, "Battery")
        XCTAssertEqual(model.emptyTitle, "Pick a vehicle first")
        XCTAssertEqual(model.emptyDescription, "Choose a vehicle to see its battery.")
    }
}
