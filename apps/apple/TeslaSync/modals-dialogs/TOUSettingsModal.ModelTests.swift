//
//  TOUSettingsModal.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  State-holder coverage for `TOUSettingsModel`: the P1/S11 `view.opened` telemetry (once + idempotent),
//  the phase transitions across loading / loaded-empty (no TOU-capable site) / failed (incl. the
//  inline-error envelope when a cached context survives a failed reload), the `getPayload` validation
//  wiring to the shared error line, the submit lifecycle (pending → success closes + refreshes site info,
//  failure surfaces the message), the cancel guard while pending (web `handleClose`), the stale
//  auto-refresh (once, re-armed on return to live), and offline keeping the form. Driven through the
//  in-memory source + spy controller — no network.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under
/// Swift 6 strict concurrency.
private final class SpyTOUSettingsTelemetry: TOUSettingsTelemetry, @unchecked Sendable {
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

/// Records the update calls + the cancel calls, and lets a test drive the deferred mutation result.
@MainActor
private final class SpyTOUSettingsController: TOUSettingsController {
    var onResult: (@MainActor (TOUSubmitResult) -> Void)?
    private(set) var updates: [(payload: TOUSettingsPayload, siteId: Int)] = []
    private(set) var cancelCount = 0

    func update(payload: TOUSettingsPayload, siteId: Int) {
        updates.append((payload, siteId))
    }

    func cancel() {
        cancelCount += 1
    }

    /// Delivers the deferred mutation result (web `onSuccess` / `onError`).
    func complete(_ result: TOUSubmitResult) {
        onResult?(result)
    }
}

@MainActor
final class TOUSettingsModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryTOUSettingsSource,
        telemetry: SpyTOUSettingsTelemetry = SpyTOUSettingsTelemetry(),
        controller: SpyTOUSettingsController = SpyTOUSettingsController()
    ) -> TOUSettingsModel {
        TOUSettingsModel(
            source: source,
            telemetry: telemetry,
            controller: controller,
            localize: passthroughLocalize
        )
    }

    private func context(_ touCapable: Bool = true, siteId: Int = 42) -> TOUSettingsContext {
        TOUSettingsContext(siteId: siteId, siteName: "Home", touCapable: touCapable)
    }

    private func loaded(_ touCapable: Bool = true, siteId: Int = 42) -> TOUSettingsUpdate {
        TOUSettingsUpdate(status: .loaded, context: context(touCapable, siteId: siteId))
    }

    // MARK: Lifecycle / phases

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTOUSettingsTelemetry()
        let source = InMemoryTOUSettingsSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["TOUSettingsModal"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryTOUSettingsSource(initial: TOUSettingsUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(loaded())
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedWithoutTouCapableSiteResolvesEmpty() {
        let source = InMemoryTOUSettingsSource(initial: loaded(false))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedNoContextResolvesError() {
        let source = InMemoryTOUSettingsSource(initial: TOUSettingsUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineLoadError)
    }

    func testFailedWithContextKeepsContentAndSurfacesInlineError() {
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source)
        model.start()
        source.push(TOUSettingsUpdate(status: .failed("stale read"), context: context()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineLoadError, "stale read")
    }

    // MARK: Submit (getPayload + mutation lifecycle)

    func testSubmitPresetEntersSubmittingAndDelegatesPayload() {
        let controller = SpyTOUSettingsController()
        let source = InMemoryTOUSettingsSource(initial: loaded(true, siteId: 7))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.selectedPreset = "pge-ev2a"
        model.submit()
        XCTAssertTrue(model.isSubmitting)
        XCTAssertNil(model.formError)
        XCTAssertEqual(controller.updates.count, 1)
        XCTAssertEqual(controller.updates.first?.siteId, 7)
        XCTAssertEqual(controller.updates.first?.payload, TOUSettingsCatalog.settings(id: "pge-ev2a"))
        XCTAssertFalse(model.didFinish)
    }

    func testSubmitSuccessRefreshesSiteInfoAndFinishes() {
        let controller = SpyTOUSettingsController()
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.selectedPreset = "sce-tou-d"
        model.submit()
        XCTAssertEqual(source.refreshCount, 0)
        controller.complete(.success)
        XCTAssertFalse(model.isSubmitting)
        XCTAssertTrue(model.didFinish)
        XCTAssertEqual(source.refreshCount, 1) // web refreshSiteInfo.mutate(siteId)
    }

    func testSubmitFailureSurfacesErrorAndStaysOpen() {
        let controller = SpyTOUSettingsController()
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.selectedPreset = "pge-ev2a"
        model.submit()
        controller.complete(.failure("Server rejected the tariff"))
        XCTAssertFalse(model.isSubmitting)
        XCTAssertEqual(model.formError, "Server rejected the tariff")
        XCTAssertFalse(model.didFinish)
    }

    func testSubmitWithoutPresetSetsValidationErrorAndDoesNotCall() {
        let controller = SpyTOUSettingsController()
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.submit()
        XCTAssertEqual(model.formError, "Please select a rate plan")
        XCTAssertFalse(model.isSubmitting)
        XCTAssertTrue(controller.updates.isEmpty)
    }

    func testSubmitCustomEmptyAndInvalidSetErrors() {
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source)
        model.start()
        model.activeTab = .custom
        model.submit()
        XCTAssertEqual(model.formError, "Please enter the TOU settings JSON")
        model.customJSON = "{ broken"
        model.submit()
        XCTAssertEqual(model.formError, "Invalid JSON — please check syntax")
    }

    func testSubmitCustomValidDelegatesWrappedPayload() {
        let controller = SpyTOUSettingsController()
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.activeTab = .custom
        model.customJSON = "{\"optimization_strategy\": \"economics\"}"
        model.submit()
        XCTAssertEqual(
            controller.updates.first?.payload.root,
            .object([
                TOUJSONField("tou_settings", .object([TOUJSONField("optimization_strategy", .string("economics"))]))
            ])
        )
    }

    func testSubmitGuardedWhilePending() {
        let controller = SpyTOUSettingsController()
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.selectedPreset = "pge-ev2a"
        model.submit()
        model.submit()
        XCTAssertEqual(controller.updates.count, 1)
    }

    // MARK: Cancel (web handleClose)

    func testCancelClearsErrorDelegatesAndFinishes() {
        let controller = SpyTOUSettingsController()
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.submit() // no preset → sets formError
        XCTAssertNotNil(model.formError)
        model.cancel()
        XCTAssertNil(model.formError)
        XCTAssertTrue(model.didFinish)
        XCTAssertEqual(controller.cancelCount, 1)
    }

    func testCancelGuardedWhilePending() {
        let controller = SpyTOUSettingsController()
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.selectedPreset = "pge-ev2a"
        model.submit() // pending
        model.cancel()
        XCTAssertFalse(model.didFinish)
        XCTAssertEqual(controller.cancelCount, 0)
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(TOUSettingsUpdate(status: .loaded, context: context(), connection: .stale))
        source.push(TOUSettingsUpdate(status: .loaded, context: context(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(TOUSettingsUpdate(status: .loaded, context: context(), connection: .live))
        source.push(TOUSettingsUpdate(status: .loaded, context: context(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source)
        model.start()
        source.push(TOUSettingsUpdate(status: .loaded, context: context(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Derived display

    func testTabTitlesAndAccessibility() {
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.tabTitle(.preset), "Preset Tariff")
        XCTAssertEqual(model.tabTitle(.custom), "Custom JSON")
        XCTAssertEqual(model.tabAccessibilityLabel(.preset), "Preset Tariff, selected")
        XCTAssertEqual(model.tabAccessibilityLabel(.custom), "Custom JSON")
    }

    func testPresetPreviewAndDisplayReflectSelection() {
        let source = InMemoryTOUSettingsSource(initial: loaded())
        let model = makeModel(source: source)
        model.start()
        XCTAssertNil(model.selectedPresetPreview)
        XCTAssertFalse(model.hasPresetSelected)
        XCTAssertEqual(model.selectedPresetDisplay, "Choose a rate plan…")
        model.selectedPreset = "pge-ev2a"
        XCTAssertNotNil(model.selectedPresetPreview)
        XCTAssertTrue(model.hasPresetSelected)
        XCTAssertEqual(model.selectedPresetDisplay, "PG&E EV2-A — Pacific Gas & Electric")
    }
}
