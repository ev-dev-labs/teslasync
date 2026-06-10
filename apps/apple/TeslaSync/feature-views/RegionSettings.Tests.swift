//
//  RegionSettings.Tests.swift
//  TeslaSync — P4 feature view · 0211 · RegionSettings (Apple)
//
//  Unit coverage for the RegionSettings surface:
//    • Adapter — the `formatDateTime` port (nil → em-dash, known date → locale
//      string), the region trimming, and the Fleet-API-URL `?? '—'` fallback.
//    • State holder — `RegionSettingsProjection` across loading / empty / error /
//      data and the timestamp / refreshing flags, plus the `RegionSettingsModel`
//      wiring, the P1/S11 `view.opened` telemetry, the stale auto-refresh
//      transition, and the refresh-outcome toast routing (web `useToast()`).
//    • Accessibility — the VoiceOver cell + "Synced …" label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryRegionSettingsSource`, and the
//  locale + time zone are injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let utc = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0)!

private func makeDate(
    year: Int,
    month: Int,
    day: Int,
    hour: Int,
    minute: Int
) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    components.minute = minute
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utc
    return calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
}

private let sampleRecord = RegionRecord(
    region: "na",
    fleetAPIBaseURL: "https://fleet-api.prd.na.vn.cloud.tesla.com",
    fetchedAt: makeDate(year: 2026, month: 4, day: 4, hour: 14, minute: 30)
)

// MARK: - Adapter: date formatting (port of dateFormat.ts formatDateTime)

@MainActor final class RegionFormatDateTests: XCTestCase {
    func testNilDateFallsBackToDash() {
        XCTAssertEqual(RegionFormat.dateTime(nil, locale: enUS, timeZone: utc), RegionFormat.dash)
    }

    func testKnownDateRendersAbbreviatedMonthYearAndTime() {
        let date = makeDate(year: 2026, month: 4, day: 4, hour: 14, minute: 30)
        let rendered = RegionFormat.dateTime(date, locale: enUS, timeZone: utc)
        XCTAssertNotEqual(rendered, RegionFormat.dash)
        XCTAssertTrue(rendered.contains("2026"), rendered)
        XCTAssertTrue(rendered.contains("Apr"), rendered)
        XCTAssertTrue(rendered.contains("PM"), rendered)
        XCTAssertTrue(rendered.contains("2:30"), rendered)
    }

    func testRenderIsStableForTheSameInput() {
        let date = makeDate(year: 2026, month: 4, day: 4, hour: 14, minute: 30)
        XCTAssertEqual(
            RegionFormat.dateTime(date, locale: enUS, timeZone: utc),
            RegionFormat.dateTime(date, locale: enUS, timeZone: utc)
        )
    }
}

// MARK: - Adapter: region + Fleet API URL shaping

@MainActor final class RegionFormatValueTests: XCTestCase {
    func testRegionTrimsWhitespace() {
        XCTAssertEqual(RegionFormat.region("  na  "), "na")
        XCTAssertEqual(RegionFormat.region("eu"), "eu")
    }

    func testRegionNilOrBlankBecomesEmpty() {
        XCTAssertEqual(RegionFormat.region(nil), "")
        XCTAssertEqual(RegionFormat.region("   "), "")
    }

    func testFleetURLTrimsAndKeepsValue() {
        XCTAssertEqual(RegionFormat.fleetURL("  https://example.com  "), "https://example.com")
    }

    func testFleetURLNilOrBlankFallsBackToDash() {
        XCTAssertEqual(RegionFormat.fleetURL(nil), RegionFormat.dash)
        XCTAssertEqual(RegionFormat.fleetURL("   "), RegionFormat.dash)
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

@MainActor final class RegionSettingsProjectionTests: XCTestCase {
    private func resolve(_ input: RegionSettingsInput) -> RegionSettingsResolved {
        RegionSettingsProjection.resolve(input, locale: enUS, timeZone: utc)
    }

    func testErrorTakesPrecedence() {
        let resolved = resolve(RegionSettingsInput(config: sampleRecord, errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlaggedOrNoSnapshot() {
        XCTAssertEqual(resolve(RegionSettingsInput(isLoading: true)).phase, .loading)
        XCTAssertEqual(resolve(RegionSettingsInput(config: nil)).phase, .loading)
    }

    func testEmptyWhenNoRegion() {
        let blank = RegionRecord(region: "  ", fleetAPIBaseURL: nil, fetchedAt: nil)
        XCTAssertEqual(resolve(RegionSettingsInput(config: blank)).phase, .empty)
    }

    func testDataWhenRegionPresentShapesCells() {
        let resolved = resolve(RegionSettingsInput(config: sampleRecord))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.region, "na")
        XCTAssertEqual(resolved.fleetAPIBaseURL, "https://fleet-api.prd.na.vn.cloud.tesla.com")
    }

    func testDataWithMissingURLUsesDash() {
        let record = RegionRecord(region: "eu", fleetAPIBaseURL: nil, fetchedAt: nil)
        let resolved = resolve(RegionSettingsInput(config: record))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.fleetAPIBaseURL, RegionFormat.dash)
    }

    func testFetchedAtLabelComputedWhenPresent() {
        let resolved = resolve(RegionSettingsInput(config: sampleRecord))
        XCTAssertNotNil(resolved.fetchedAtLabel)
        XCTAssertTrue((resolved.fetchedAtLabel ?? "").contains("2026"))
    }

    func testFetchedAtLabelNilWhenNeverSynced() {
        let record = RegionRecord(region: "na", fleetAPIBaseURL: "x", fetchedAt: nil)
        XCTAssertNil(resolve(RegionSettingsInput(config: record)).fetchedAtLabel)
    }

    func testRefreshingFlagIsPropagated() {
        let resolved = resolve(RegionSettingsInput(config: sampleRecord, isRefreshing: true))
        XCTAssertTrue(resolved.isRefreshing)
        XCTAssertFalse(resolve(RegionSettingsInput(config: sampleRecord)).isRefreshing)
    }
}

// MARK: - State holder: wiring, telemetry, freshness, toast

@MainActor final class RegionSettingsModelTests: XCTestCase {
    private func makeModel(
        _ input: RegionSettingsInput,
        telemetry: RegionSettingsTelemetry = OSLogRegionSettingsTelemetry(),
        toast: RegionSettingsToast = OSLogRegionSettingsToast()
    ) -> (RegionSettingsModel, InMemoryRegionSettingsSource) {
        let source = InMemoryRegionSettingsSource(initial: input)
        let model = RegionSettingsModel(
            source: source,
            telemetry: telemetry,
            toast: toast,
            locale: enUS,
            timeZone: utc
        )
        return (model, source)
    }

    private var dataInput: RegionSettingsInput {
        RegionSettingsInput(config: sampleRecord)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = RegionSettingsSpyTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.region, "na")
        XCTAssertEqual(spy.surfaces, [RegionSettings.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(RegionSettingsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(RegionSettingsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testRefreshingFlagSurfaces() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertFalse(model.isRefreshing)
        source.push(RegionSettingsInput(config: sampleRecord, isRefreshing: true))
        XCTAssertTrue(model.isRefreshing)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RegionSettingsInput(config: sampleRecord, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(RegionSettingsInput(config: sampleRecord, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(RegionSettingsInput(config: sampleRecord, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testRefreshSuccessRoutesToToast() {
        let toast = RegionSettingsSpyToast()
        let (model, source) = makeModel(dataInput, toast: toast)
        model.start()
        source.completeRefresh(.succeeded)
        XCTAssertEqual(toast.successes, ["Region info refreshed"])
        XCTAssertTrue(toast.errors.isEmpty)
    }

    func testRefreshFailureRoutesToToast() {
        let toast = RegionSettingsSpyToast()
        let (model, source) = makeModel(dataInput, toast: toast)
        model.start()
        source.completeRefresh(.failed("Network request timed out"))
        XCTAssertEqual(toast.errors.count, 1)
        XCTAssertEqual(toast.errors.first?.title, "Failed to refresh region")
        XCTAssertEqual(toast.errors.first?.detail, "Network request timed out")
        XCTAssertTrue(toast.successes.isEmpty)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(RegionSettings.surfaceSlug, "RegionSettings")
    }
}

// MARK: - Accessibility summary content

@MainActor final class RegionAccessibilityTests: XCTestCase {
    func testInfoLabelJoinsParts() {
        XCTAssertEqual(
            RegionAccessibility.infoLabel(label: "Region", value: "na"),
            "Region, na"
        )
    }

    func testSyncedLabelJoinsParts() {
        XCTAssertEqual(
            RegionAccessibility.syncedLabel(prefix: "Synced", timestamp: "Apr 4, 2026, 2:30 PM"),
            "Synced, Apr 4, 2026, 2:30 PM"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class RegionSettingsSpyTelemetry: RegionSettingsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the toast messages so the refresh-outcome routing can be asserted.
private final class RegionSettingsSpyToast: RegionSettingsToast, @unchecked Sendable {
    private(set) var successes: [String] = []
    private(set) var errors: [(title: String, detail: String)] = []

    func success(_ message: String) {
        successes.append(message)
    }

    func error(_ title: String, _ detail: String) {
        errors.append((title: title, detail: detail))
    }
}
