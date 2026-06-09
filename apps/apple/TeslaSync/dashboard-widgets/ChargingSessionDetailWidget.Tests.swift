//
//  ChargingSessionDetailWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0024 · ChargingSessionDetailWidget (Apple)
//
//  Unit coverage for the ChargingSessionDetailWidget surface:
//    • Adapter (cached → projection) — `ChargingSessionDetailProjection` latest-session
//      selection, the `classifyCharger` switch, watt→kW points, peak power, duration
//      minutes, the summary, the dual-axis scale, plus `ChargingSessionDetailFormat`.
//    • State holder — `ChargingSessionDetailModel` phase + empty-reason resolution
//      across loading / loaded / failed / cached / no-session, plus the P1/S11
//      `view.opened` telemetry + source wiring.
//    • Registry — canonical `charging-session-detail` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for the chart + stats.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryChargingSessionDetailSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (parity with web stats/chartData)

@MainActor final class ChargingSessionDetailAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the format/a11y tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Deterministic locale so formatted numbers are stable across runners.
    private let enUS = Locale(identifier: "en_US")

    private func sample(
        minutesAgo: Double,
        power: Double?,
        soc: Double?,
        now: Date = Date(timeIntervalSince1970: 1_700_000_000)
    ) -> ChargingSessionDetailSampleInput {
        ChargingSessionDetailSampleInput(
            timestamp: now.addingTimeInterval(-minutesAgo * 60),
            powerW: power,
            socPercent: soc
        )
    }

    func testLatestSessionPicksNewestByStartedAt() {
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let refs = [
            ChargingSessionRef(id: 1, startedAt: base),
            ChargingSessionRef(id: 2, startedAt: base.addingTimeInterval(3600)),
            ChargingSessionRef(id: 3, startedAt: base.addingTimeInterval(-3600))
        ]
        XCTAssertEqual(ChargingSessionDetailProjection.latestSessionID(from: refs), 2)
    }

    func testLatestSessionNilWhenEmpty() {
        XCTAssertNil(ChargingSessionDetailProjection.latestSessionID(from: []))
    }

    func testClassifyChargerMatchesWebSwitch() {
        XCTAssertEqual(ChargingSessionDetailProjection.classifyCharger(nil), .acHome)
        XCTAssertEqual(ChargingSessionDetailProjection.classifyCharger(""), .acHome)
        XCTAssertEqual(ChargingSessionDetailProjection.classifyCharger("Tesla Supercharger V3"), .supercharger)
        XCTAssertEqual(ChargingSessionDetailProjection.classifyCharger("supercharger"), .supercharger)
        XCTAssertEqual(ChargingSessionDetailProjection.classifyCharger("Tesla"), .supercharger)
        XCTAssertEqual(ChargingSessionDetailProjection.classifyCharger("CCS"), .dcFast)
        XCTAssertEqual(ChargingSessionDetailProjection.classifyCharger("CHAdeMO"), .dcFast)
        XCTAssertEqual(ChargingSessionDetailProjection.classifyCharger("<invalid>"), .acHome)
    }

    func testChargerToneParity() {
        XCTAssertEqual(ChargingSessionDetailCharger.supercharger.tone, .warning)
        XCTAssertEqual(ChargingSessionDetailCharger.dcFast.tone, .warning)
        XCTAssertEqual(ChargingSessionDetailCharger.acHome.tone, .neutral)
        XCTAssertEqual(ChargingSessionDetailCharger.acHome.localizedLabel(echo), "AC / Home")
    }

    func testPointsConvertWattsToKilowattsAndPassSoc() {
        let points = ChargingSessionDetailProjection.points(from: [
            sample(minutesAgo: 1, power: 192_000, soc: 42)
        ])
        XCTAssertEqual(points.count, 1)
        XCTAssertEqual(points[0].powerKw ?? -1, 192.0, accuracy: 0.0001)
        XCTAssertEqual(points[0].soc ?? -1, 42, accuracy: 0.0001)
    }

    func testPointsPreserveNulls() {
        let points = ChargingSessionDetailProjection.points(from: [
            sample(minutesAgo: 1, power: nil, soc: nil)
        ])
        XCTAssertNil(points[0].powerKw)
        XCTAssertNil(points[0].soc)
    }

    func testPeakPowerIsMaxKilowatts() {
        let peak = ChargingSessionDetailProjection.peakPowerKw(from: [
            sample(minutesAgo: 3, power: 95000, soc: 24),
            sample(minutesAgo: 2, power: 192_000, soc: 42),
            sample(minutesAgo: 1, power: nil, soc: 60)
        ])
        XCTAssertEqual(peak, 192.0, accuracy: 0.0001)
    }

    func testPeakPowerZeroWhenEmpty() {
        XCTAssertEqual(ChargingSessionDetailProjection.peakPowerKw(from: []), 0)
    }

    func testDurationMinutesFromSeconds() {
        XCTAssertEqual(ChargingSessionDetailProjection.durationMinutes(fromSeconds: 3900), 65)
        XCTAssertEqual(ChargingSessionDetailProjection.durationMinutes(fromSeconds: 59), 0)
        XCTAssertEqual(ChargingSessionDetailProjection.durationMinutes(fromSeconds: 0), 0)
        XCTAssertEqual(ChargingSessionDetailProjection.durationMinutes(fromSeconds: -10), 0)
        XCTAssertEqual(ChargingSessionDetailProjection.durationMinutes(fromSeconds: .nan), 0)
    }

    func testSummaryProjection() {
        let detail = ChargingSessionDetailInput(
            energyAddedWh: 42300,
            durationS: 3900,
            chargerType: "Tesla Supercharger"
        )
        let summary = ChargingSessionDetailProjection.summary(
            detail: detail,
            samples: [
                sample(minutesAgo: 2, power: 192_000, soc: 42),
                sample(minutesAgo: 1, power: 78000, soc: 69)
            ]
        )
        XCTAssertEqual(summary.energyKwh, 42.3, accuracy: 0.0001)
        XCTAssertEqual(summary.durationMinutes, 65)
        XCTAssertEqual(summary.peakPowerKw, 192.0, accuracy: 0.0001)
        XCTAssertEqual(summary.charger, .supercharger)
    }

    func testScaleMapsSocIntoPowerSpace() {
        let scale = ChargingSessionDetailScale(peakPowerKw: 192)
        XCTAssertEqual(scale.powerMax, 197, accuracy: 0.0001) // dataMax + 5
        XCTAssertEqual(scale.socToPower(0), 0, accuracy: 0.0001)
        XCTAssertEqual(scale.socToPower(50), 98.5, accuracy: 0.0001)
        XCTAssertEqual(scale.socToPower(100), 197, accuracy: 0.0001)
        XCTAssertEqual(scale.powerToSoc(197), 100, accuracy: 0.0001)
    }

    func testHasSeriesDistinguishesAllNull() {
        let nulls = ChargingSessionDetailProjection.points(from: [sample(minutesAgo: 1, power: nil, soc: nil)])
        XCTAssertFalse(ChargingSessionDetailProjection.hasSeries(nulls))
        let signal = ChargingSessionDetailProjection.points(from: [sample(minutesAgo: 1, power: nil, soc: 55)])
        XCTAssertTrue(ChargingSessionDetailProjection.hasSeries(signal))
    }

    func testDecimal1FormatsOneDecimal() {
        XCTAssertEqual(ChargingSessionDetailFormat.decimal1(42.3, locale: enUS), "42.3")
        XCTAssertEqual(ChargingSessionDetailFormat.decimal1(192, locale: enUS), "192.0")
        XCTAssertEqual(ChargingSessionDetailFormat.decimal1(1234.5, locale: enUS), "1,234.5")
    }

    func testDecimal1NonFiniteRendersDash() {
        XCTAssertEqual(ChargingSessionDetailFormat.decimal1(.infinity, locale: enUS), "—")
        XCTAssertEqual(ChargingSessionDetailFormat.decimal1(.nan, locale: enUS), "—")
    }

    func testDurationLabelMatchesWeb() {
        XCTAssertEqual(ChargingSessionDetailFormat.duration(minutes: 0, localize: echo), "0m")
        XCTAssertEqual(ChargingSessionDetailFormat.duration(minutes: 45, localize: echo), "45m")
        XCTAssertEqual(ChargingSessionDetailFormat.duration(minutes: 60, localize: echo), "1h")
        XCTAssertEqual(ChargingSessionDetailFormat.duration(minutes: 65, localize: echo), "1h 5m")
        XCTAssertEqual(ChargingSessionDetailFormat.duration(minutes: 125, localize: echo), "2h 5m")
    }

    func testShortTimeZeroPadsTwentyFourHour() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let date = calendar.date(from: DateComponents(year: 2024, month: 1, day: 1, hour: 9, minute: 5))
        XCTAssertEqual(ChargingSessionDetailFormat.shortTime(date ?? Date(), calendar: calendar), "09:05")
    }
}

// MARK: - State holder: phases + empty reasons + telemetry + source wiring

@MainActor final class ChargingSessionDetailModelTests: XCTestCase {
    private func makeModel(
        _ update: ChargingSessionDetailUpdate,
        telemetry: ChargingSessionDetailTelemetry = OSLogChargingSessionDetailTelemetry()
    ) -> (ChargingSessionDetailModel, InMemoryChargingSessionDetailSource) {
        let source = InMemoryChargingSessionDetailSource(initial: update)
        let model = ChargingSessionDetailModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private let detail = ChargingSessionDetailInput(
        energyAddedWh: 42300,
        durationS: 3900,
        chargerType: "Tesla Supercharger"
    )

    private func samples(now: Date = Date()) -> [ChargingSessionDetailSampleInput] {
        [
            ChargingSessionDetailSampleInput(timestamp: now.addingTimeInterval(-120), powerW: 192_000, socPercent: 42),
            ChargingSessionDetailSampleInput(timestamp: now.addingTimeInterval(-60), powerW: 78000, socPercent: 69)
        ]
    }

    func testLoadingWithoutContentShowsLoading() {
        let (model, _) = makeModel(ChargingSessionDetailUpdate(status: .loading, detail: nil, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutSessionShowsEmpty() {
        let (model, _) = makeModel(ChargingSessionDetailUpdate(status: .loaded, detail: nil, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.emptyReason, .noSessions)
        XCTAssertNil(model.summary)
    }

    func testLoadedWithSessionShowsContent() {
        let (model, _) = makeModel(ChargingSessionDetailUpdate(status: .loaded, detail: detail, samples: samples()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.emptyReason)
        XCTAssertEqual(model.summary?.charger, .supercharger)
        XCTAssertEqual(model.points.count, 2)
        XCTAssertEqual(model.summary?.peakPowerKw ?? 0, 192.0, accuracy: 0.0001)
    }

    func testLoadingWithCachedContentStaysContent() {
        let (model, _) = makeModel(ChargingSessionDetailUpdate(status: .loading, detail: detail, samples: samples()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.emptyReason)
    }

    func testFailedShowsError() {
        let (model, _) = makeModel(ChargingSessionDetailUpdate(status: .failed("boom"), detail: nil, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyChargingSessionDetailTelemetry()
        let (model, source) = makeModel(ChargingSessionDetailUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargingSessionDetailWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargingSessionDetailUpdate(
            status: .loaded,
            detail: detail,
            samples: samples()
        ))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(ChargingSessionDetailUpdate(status: .loading, detail: nil, samples: []))
        model.start()
        source.push(
            ChargingSessionDetailUpdate(
                status: .loaded,
                connection: .offline,
                detail: detail,
                samples: samples(),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.emptyReason)
        XCTAssertEqual(model.points.count, 2)
    }

    func testResolvePhaseDirectly() {
        XCTAssertEqual(ChargingSessionDetailModel.resolvePhase(status: .loading, hasContent: false), .loading)
        XCTAssertEqual(ChargingSessionDetailModel.resolvePhase(status: .loading, hasContent: true), .content)
        XCTAssertEqual(ChargingSessionDetailModel.resolvePhase(status: .loaded, hasContent: false), .content)
        XCTAssertEqual(ChargingSessionDetailModel.resolvePhase(status: .failed("x"), hasContent: true), .error("x"))
    }
}

// MARK: - Registry parity

@MainActor final class ChargingSessionDetailRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ChargingSessionDetailWidget.registration
        XCTAssertEqual(registration.id, "charging-session-detail")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(ChargingSessionDetailWidget.surfaceSlug, "ChargingSessionDetailWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = ChargingSessionDetailWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 8)),
            DashboardWidgetSize(cols: 2, rows: 8)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class ChargingSessionDetailAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let enUS = Locale(identifier: "en_US")

    func testSummaryIncludesTitleAndStats() {
        let summary = ChargingSessionDetailSummary(
            energyKwh: 42.3,
            durationMinutes: 65,
            peakPowerKw: 192,
            charger: .supercharger
        )
        let spoken = ChargingSessionDetailAccessibility.summary(summary, localize: echo, locale: enUS)
        XCTAssertTrue(spoken.contains("Charge Session Detail"))
        XCTAssertTrue(spoken.contains("Energy Added: 42.3 kWh"))
        XCTAssertTrue(spoken.contains("Duration: 1h 5m"))
        XCTAssertTrue(spoken.contains("Peak Power: 192.0 kW"))
        XCTAssertTrue(spoken.contains("Charger: Supercharger"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargingSessionDetailTelemetry: ChargingSessionDetailTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
