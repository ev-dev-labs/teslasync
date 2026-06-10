//
//  GasPriceSettings.ModelTests.swift
//  TeslaSync — P4 feature view · 0206 · GasPriceSettings (Apple)
//
//  State-holder unit coverage for the GasPriceSettings surface, split out of
//  `GasPriceSettings.Tests.swift` so each file stays within the 400-line budget. Covers
//  the `GasPriceSettingsModel` wiring, the P1/S11 `view.opened` telemetry, the three
//  mutations (toggle / interval / poll) + their toast routing (web `useToast()`), the
//  poll-spinner guard, the stale auto-refresh transition, and the formatting injection.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryGasPriceSettingsSource`, and the locale +
//  time zone + formatting are injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let utc = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0)!
private let usd = GasPriceFormatting(currencySymbol: "$", gasUnit: "gallon", decimals: 2)

private func makeDate(year: Int, month: Int, day: Int, hour: Int, minute: Int) -> Date {
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

private let polledDate = makeDate(year: 2026, month: 4, day: 4, hour: 14, minute: 30)

private let runningRecord = GasPriceRecord(
    enabled: true,
    pollInterval: .weekly,
    currentPrice: 3.45,
    lastPollTime: polledDate
)

// MARK: - State holder: wiring, telemetry, mutations, toasts, freshness

@MainActor
final class GasPriceSettingsModelTests: XCTestCase {
    private func makeModel(
        _ input: GasPriceSettingsInput,
        outcome: GasPriceActionOutcome? = nil,
        telemetry: GasPriceSettingsTelemetry = OSLogGasPriceSettingsTelemetry(),
        toast: GasPriceSettingsToast = OSLogGasPriceSettingsToast()
    ) -> (GasPriceSettingsModel, InMemoryGasPriceSettingsSource) {
        let source = InMemoryGasPriceSettingsSource(initial: input, outcome: outcome)
        let model = GasPriceSettingsModel(
            source: source,
            formatting: usd,
            telemetry: telemetry,
            toast: toast,
            locale: enUS,
            timeZone: utc
        )
        return (model, source)
    }

    private var dataInput: GasPriceSettingsInput {
        GasPriceSettingsInput(status: runningRecord)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = GasPriceSettingsSpyTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.currentPriceLabel, "$3.45/gal")
        XCTAssertEqual(spy.surfaces, [GasPriceSettings.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(GasPriceSettingsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(GasPriceSettingsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testToggleSendsNegatedEnabled() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.toggleAutoPoll()
        XCTAssertEqual(source.toggleCount, 1)
        XCTAssertEqual(source.lastToggled, false)
    }

    func testToggleFromDisabledSendsEnabled() {
        let stopped = GasPriceRecord(enabled: false, pollInterval: .daily, currentPrice: 0, lastPollTime: nil)
        let (model, source) = makeModel(GasPriceSettingsInput(status: stopped))
        model.start()
        model.toggleAutoPoll()
        XCTAssertEqual(source.lastToggled, true)
    }

    func testSelectIntervalDelegatesAndDedupes() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.selectInterval(.monthly)
        XCTAssertEqual(source.lastInterval, .monthly)
        // Selecting the already-resolved value is a no-op (web idle re-emit guard).
        model.selectInterval(.weekly)
        XCTAssertEqual(source.lastInterval, .monthly)
    }

    func testPollNowSetsSpinnerAndGuardsReentry() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertFalse(model.isPolling)
        model.pollNow()
        XCTAssertTrue(model.isPolling)
        XCTAssertEqual(source.pollCount, 1)
        model.pollNow()
        XCTAssertEqual(source.pollCount, 1)
    }

    func testToggledOutcomeRoutesInfoToast() {
        let toast = GasPriceSettingsSpyToast()
        let (model, source) = makeModel(dataInput, toast: toast)
        model.start()
        source.pushOutcome(.toggled(enabled: true))
        source.pushOutcome(.toggled(enabled: false))
        XCTAssertEqual(toast.infos, ["Auto-poll enabled", "Auto-poll disabled"])
        XCTAssertTrue(toast.errors.isEmpty)
    }

    func testIntervalOutcomeRoutesInfoToast() {
        let toast = GasPriceSettingsSpyToast()
        let (model, source) = makeModel(dataInput, toast: toast)
        model.start()
        source.pushOutcome(.intervalUpdated)
        XCTAssertEqual(toast.infos, ["Poll interval updated"])
    }

    func testPolledOutcomeRoutesInfoToastAndClearsSpinner() {
        let toast = GasPriceSettingsSpyToast()
        let (model, source) = makeModel(dataInput, toast: toast)
        model.start()
        model.pollNow()
        XCTAssertTrue(model.isPolling)
        source.pushOutcome(.polled)
        XCTAssertFalse(model.isPolling)
        XCTAssertEqual(toast.infos, ["Gas price poll triggered"])
    }

    func testPollFailureRoutesErrorToastAndClearsSpinner() {
        let toast = GasPriceSettingsSpyToast()
        let (model, source) = makeModel(dataInput, toast: toast)
        model.start()
        model.pollNow()
        source.pushOutcome(.failed(.poll, "timeout"))
        XCTAssertFalse(model.isPolling)
        XCTAssertEqual(toast.errors, ["Failed to poll gas prices"])
        XCTAssertTrue(toast.infos.isEmpty)
    }

    func testToggleAndIntervalFailureMessages() {
        let toast = GasPriceSettingsSpyToast()
        let (model, source) = makeModel(dataInput, toast: toast)
        model.start()
        source.pushOutcome(.failed(.toggle, "x"))
        source.pushOutcome(.failed(.interval, "y"))
        XCTAssertEqual(toast.errors, [
            "Failed to toggle gas price tracking",
            "Failed to update gas price config"
        ])
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)
        source.push(GasPriceSettingsInput(status: runningRecord, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(GasPriceSettingsInput(status: runningRecord, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(GasPriceSettingsInput(status: runningRecord, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegates() {
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

    func testFormattingInjectionReflectedInPriceLabel() {
        let source = InMemoryGasPriceSettingsSource(initial: dataInput)
        let model = GasPriceSettingsModel(
            source: source,
            formatting: GasPriceFormatting(currencySymbol: "€", gasUnit: "liter", decimals: 2),
            locale: enUS,
            timeZone: utc
        )
        model.start()
        XCTAssertEqual(model.resolved.currentPriceLabel, "€3.45/L")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(GasPriceSettings.surfaceSlug, "GasPriceSettings")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class GasPriceSettingsSpyTelemetry: GasPriceSettingsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the toast messages so the mutation-outcome routing can be asserted.
private final class GasPriceSettingsSpyToast: GasPriceSettingsToast, @unchecked Sendable {
    private(set) var infos: [String] = []
    private(set) var errors: [String] = []

    func info(_ message: String) {
        infos.append(message)
    }

    func error(_ message: String) {
        errors.append(message)
    }
}
