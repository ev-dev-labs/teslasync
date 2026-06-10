//
//  PresetGallery.ModelTests.swift
//  TeslaSync — P4 feature view · 0085 · AutomationPresetGallery (Apple)
//
//  State-holder coverage for `AutomationPresetGalleryModel`: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across loading / loaded-empty / failed
//  (incl. the inline-error envelope when cached items survive a failed reload), the
//  Install navigation seam, the stale auto-refresh (once, re-armed on return to live),
//  and offline keeping cached items without refetching. Driven through the in-memory
//  source — no network.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable`
/// telemetry seam under Swift 6 strict concurrency.
private final class SpyAutomationPresetGalleryTelemetry: AutomationPresetGalleryTelemetry, @unchecked Sendable {
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

/// Records the preset ids handed to the install seam (web `useNavigate`). Lock-guarded for
/// the `Sendable` navigator seam.
private final class SpyAutomationPresetGalleryNavigator: AutomationPresetGalleryNavigator, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func installPreset(id: String) {
        lock.lock()
        storage.append(id)
        lock.unlock()
    }

    var installedIDs: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

private enum PresetGallerySamplePresets {
    static func one(id: String = "sentry-on-leave") -> AutomationPresetItem {
        AutomationPresetItem(
            id: id,
            name: "Sentry on leave",
            summary: "Arm Sentry when you drive away from home.",
            iconKey: "Shield",
            triggers: [.geofence],
            actionCount: 2
        )
    }

    static func two() -> [AutomationPresetItem] {
        [one(), one(id: "overnight-charge")]
    }
}

@MainActor final class AutomationPresetGalleryModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryAutomationPresetGallerySource,
        telemetry: SpyAutomationPresetGalleryTelemetry = SpyAutomationPresetGalleryTelemetry(),
        navigator: SpyAutomationPresetGalleryNavigator = SpyAutomationPresetGalleryNavigator()
    ) -> AutomationPresetGalleryModel {
        AutomationPresetGalleryModel(
            source: source,
            telemetry: telemetry,
            navigator: navigator,
            localize: passthroughLocalize
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyAutomationPresetGalleryTelemetry()
        let source = InMemoryAutomationPresetGallerySource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["PresetGallery"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryAutomationPresetGallerySource(initial: AutomationPresetGalleryUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AutomationPresetGalleryUpdate(status: .loaded, items: PresetGallerySamplePresets.two()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 2)
    }

    func testLoadedEmptyResolvesEmpty() {
        let source = InMemoryAutomationPresetGallerySource(initial: AutomationPresetGalleryUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedNoItemsResolvesError() {
        let source =
            InMemoryAutomationPresetGallerySource(initial: AutomationPresetGalleryUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithItemsKeepsContentAndSurfacesInlineError() {
        let items = PresetGallerySamplePresets.two()
        let source = InMemoryAutomationPresetGallerySource(initial: AutomationPresetGalleryUpdate(
            status: .loaded,
            items: items
        ))
        let model = makeModel(source: source)
        model.start()
        source.push(AutomationPresetGalleryUpdate(status: .failed("stale read"), items: items))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    func testInstallCallsNavigatorWithPresetID() {
        let source = InMemoryAutomationPresetGallerySource(initial: AutomationPresetGalleryUpdate(
            status: .loaded,
            items: PresetGallerySamplePresets.two()
        ))
        let navigator = SpyAutomationPresetGalleryNavigator()
        let model = makeModel(source: source, navigator: navigator)
        model.start()
        model.install(PresetGallerySamplePresets.one(id: "overnight-charge"))
        XCTAssertEqual(navigator.installedIDs, ["overnight-charge"])
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let items = PresetGallerySamplePresets.two()
        let source = InMemoryAutomationPresetGallerySource(initial: AutomationPresetGalleryUpdate(
            status: .loaded,
            items: items
        ))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(AutomationPresetGalleryUpdate(status: .loaded, items: items, connection: .stale))
        source.push(AutomationPresetGalleryUpdate(status: .loaded, items: items, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(AutomationPresetGalleryUpdate(status: .loaded, items: items, connection: .live))
        source.push(AutomationPresetGalleryUpdate(status: .loaded, items: items, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsItemsAndDoesNotRefresh() {
        let items = PresetGallerySamplePresets.two()
        let source = InMemoryAutomationPresetGallerySource(initial: AutomationPresetGalleryUpdate(
            status: .loaded,
            items: items
        ))
        let model = makeModel(source: source)
        model.start()
        source.push(AutomationPresetGalleryUpdate(status: .loaded, items: items, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRefreshDrivesSource() {
        let source =
            InMemoryAutomationPresetGallerySource(initial: AutomationPresetGalleryUpdate(status: .failed("boom")))
        let model = makeModel(source: source)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopHaltsSourceAndAllowsRestart() {
        let source = InMemoryAutomationPresetGallerySource()
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }
}
