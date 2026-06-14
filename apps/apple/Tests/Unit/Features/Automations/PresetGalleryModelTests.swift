import XCTest
@testable import TeslaSync

/// File-scope failure used by the failing data-source double (kept out of the nested doubles to
/// satisfy the one-level type-nesting rule).
private struct PresetGalleryLoadFailure: Error {}

/// State-machine + projection tests for `PresetGalleryModel` — every render state the gallery
/// resolves (loading / empty / success / error), the refresh re-fetch, the `useAutomationPresets`
/// category passthrough, and the render-ready preset projections (web `iconMap` + `triggerLabels`).
@MainActor final class PresetGalleryModelTests: XCTestCase {
    private struct StubPresets: PresetGalleryDataSource {
        let presets: [PresetGalleryItem]

        func useAutomationPresets(category _: String?) async throws -> PresetGalleryResponse {
            PresetGalleryResponse(presets: presets)
        }
    }

    private struct FailingStub: PresetGalleryDataSource {
        func useAutomationPresets(category _: String?) async throws -> PresetGalleryResponse {
            throw PresetGalleryLoadFailure()
        }
    }

    private func preset(
        _ id: String,
        category: String = "",
        icon: String = "Shield",
        trigger: PresetTriggerKind? = .schedule,
        actions: Int = 1
    ) -> PresetGalleryItem {
        PresetGalleryItem(
            id: id,
            name: id.capitalized,
            description: "Sample description for \(id)",
            category: category,
            icon: icon,
            triggerKind: trigger,
            actionCount: actions
        )
    }

    // MARK: - States

    func testInitialStateIsLoading() {
        let sut = PresetGalleryModel(dataSource: StubPresets(presets: []))
        XCTAssertEqual(sut.galleryState, .loading)
        XCTAssertTrue(sut.presets.isEmpty)
    }

    func testLoadResolvesSuccess() async {
        let sut = PresetGalleryModel(dataSource: StubPresets(presets: [preset("a"), preset("b")]))
        await sut.load()
        XCTAssertEqual(sut.galleryState, .success)
        XCTAssertEqual(sut.presets.count, 2)
    }

    func testLoadWithNoPresetsYieldsEmpty() async {
        let sut = PresetGalleryModel(dataSource: StubPresets(presets: []))
        await sut.load()
        XCTAssertEqual(sut.galleryState, .empty)
        XCTAssertTrue(sut.presets.isEmpty)
    }

    func testLoadFailureYieldsError() async {
        let sut = PresetGalleryModel(dataSource: FailingStub())
        await sut.load()
        if case .error = sut.galleryState {} else { XCTFail("expected error state") }
        if case .error = sut.phase {} else { XCTFail("expected error phase") }
    }

    func testRefreshReloads() async {
        let sut = PresetGalleryModel(dataSource: StubPresets(presets: [preset("a")]))
        await sut.refresh()
        XCTAssertEqual(sut.galleryState, .success)
        XCTAssertEqual(sut.presets.count, 1)
    }

    func testDefaultSampleSourceProducesSuccess() async {
        let sut = PresetGalleryModel()
        await sut.load()
        XCTAssertEqual(sut.galleryState, .success)
        XCTAssertFalse(sut.presets.isEmpty)
    }

    // MARK: - Category passthrough (web `useAutomationPresets(category)`)

    func testCategoryFiltersSampleSource() async {
        let sut = PresetGalleryModel(category: "security", dataSource: SamplePresetGalleryDataSource())
        await sut.load()
        XCTAssertEqual(sut.galleryState, .success)
        XCTAssertFalse(sut.presets.isEmpty)
        XCTAssertTrue(sut.presets.allSatisfy { $0.category == "security" })
    }

    func testUnknownCategoryYieldsEmpty() async {
        let sut = PresetGalleryModel(category: "does-not-exist", dataSource: SamplePresetGalleryDataSource())
        await sut.load()
        XCTAssertEqual(sut.galleryState, .empty)
    }

    func testNilCategoryReturnsEntireCatalog() async {
        let sut = PresetGalleryModel(dataSource: SamplePresetGalleryDataSource())
        await sut.load()
        XCTAssertEqual(sut.galleryState, .success)
        XCTAssertGreaterThan(sut.presets.count, 1)
    }

    // MARK: - Preset projection (web `iconMap` + `triggerLabels`)

    func testSystemImageMapsKnownIcons() {
        XCTAssertEqual(preset("a", icon: "Lock").systemImage, "lock.fill")
        XCTAssertEqual(preset("a", icon: "Sun").systemImage, "sun.max.fill")
        XCTAssertEqual(preset("a", icon: "CarFront").systemImage, "car.fill")
        XCTAssertEqual(preset("a", icon: "ShieldCheck").systemImage, "checkmark.shield.fill")
    }

    func testSystemImageFallsBackToShield() {
        XCTAssertEqual(preset("a", icon: "Unknown").systemImage, "shield.fill")
    }

    func testTriggerLabelKeyResolvesKind() {
        XCTAssertEqual(preset("a", trigger: .geofence).triggerLabelKey, "automations.builder.triggerGeofence")
        XCTAssertEqual(preset("a", trigger: .signal).triggerLabelKey, "automations.builder.triggerSignal")
    }

    func testTriggerLabelKeyFallsBackToNoTrigger() {
        XCTAssertEqual(preset("a", trigger: nil).triggerLabelKey, "automations.builder.noTrigger")
    }

    func testTriggerKindRawValuesMatchWebDiscriminators() {
        XCTAssertEqual(PresetTriggerKind.schedule.rawValue, "trigger_schedule")
        XCTAssertEqual(PresetTriggerKind.event.rawValue, "trigger_event")
        XCTAssertEqual(PresetTriggerKind(rawValue: "trigger_signal"), .signal)
    }

    func testActionCountClampsNegative() {
        XCTAssertEqual(preset("a", actions: -4).actionCount, 0)
    }
}
