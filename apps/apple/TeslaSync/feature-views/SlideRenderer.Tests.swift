//
//  SlideRenderer.Tests.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  Unit coverage for the SlideRenderer surface:
//    • Adapter — the gradient parser (Tailwind ×900 palette, from/via/to order, unknown fallback),
//      the kind parser (every web `slide.type` + unknown round-trip), the drive-highlight selection
//      the renderer owns (variant → label key + emoji + which drive), the per-kind projection values,
//      and the number / duration formatting parity.
//    • State holder — `SlideRendererModel` phase resolution, `select(index:)` clamp + reproject +
//      delegation, refresh delegation, the stale auto-refresh guard, connection / fetching tracking,
//      `currentContext`, and the P1/S11 `view.opened` telemetry (emitted exactly once).
//    • Accessibility — the flattened VoiceOver summaries per slide body.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store: the model is driven
//  by `InMemorySlideRendererSource`; strings resolve through an echoing localizer.
//

import XCTest
@testable import TeslaSync

// MARK: - Gradient adapter (web `bg-gradient-to-br ${slide.bg}`)

final class SlideRendererGradientTests: XCTestCase {
    func testParsesFromViaToInOrder() {
        let stops = SlideRendererGradient.stops(from: "from-blue-900 via-indigo-900 to-slate-900")
        XCTAssertEqual(stops.count, 3)
        XCTAssertEqual(stops[0], SlideRendererGradient.palette["blue-900"])
        XCTAssertEqual(stops[1], SlideRendererGradient.palette["indigo-900"])
        XCTAssertEqual(stops[2], SlideRendererGradient.palette["slate-900"])
    }

    func testTokensIgnoreNonGradientClasses() {
        let tokens = SlideRendererGradient.tokens(from: "bg-gradient-to-br from-cyan-900 to-blue-900")
        XCTAssertEqual(tokens, ["cyan-900", "blue-900"])
    }

    func testUnknownTokenFallsBackToSlate() {
        let stops = SlideRendererGradient.stops(from: "from-notacolor-900 to-blue-900")
        XCTAssertEqual(stops.count, 2)
        XCTAssertEqual(stops[0], SlideRendererGradient.fallback)
        XCTAssertEqual(stops[1], SlideRendererGradient.palette["blue-900"])
    }

    func testEmptyStringYieldsTwoFallbackStops() {
        let stops = SlideRendererGradient.stops(from: "")
        XCTAssertEqual(stops, [SlideRendererGradient.fallback, SlideRendererGradient.fallback])
    }

    func testSingleTokenIsDoubledForAWellFormedGradient() {
        let stops = SlideRendererGradient.stops(from: "from-rose-900")
        XCTAssertEqual(stops.count, 2)
        XCTAssertEqual(stops[0], SlideRendererGradient.palette["rose-900"])
        XCTAssertEqual(stops[1], SlideRendererGradient.palette["rose-900"])
    }

    func testEveryDeckPaletteTokenResolves() {
        // No slide in the web SLIDE_DEFS deck may fall back — the palette must cover them all.
        for slide in SlideRendererFixture.deck() {
            for token in SlideRendererGradient.tokens(from: slide.background) {
                XCTAssertNotNil(SlideRendererGradient.palette[token], "missing palette entry: \(token)")
            }
        }
    }
}

// MARK: - Kind parser (web `slide.type`)

final class SlideKindTests: XCTestCase {
    func testParsesEveryWebType() {
        XCTAssertEqual(SlideKind(type: "title"), .title)
        XCTAssertEqual(SlideKind(type: "stat-hero"), .statHero)
        XCTAssertEqual(SlideKind(type: "stat-chart"), .statChart)
        XCTAssertEqual(SlideKind(type: "drive-highlight"), .driveHighlight)
        XCTAssertEqual(SlideKind(type: "charging-breakdown"), .chargingBreakdown)
        XCTAssertEqual(SlideKind(type: "savings"), .savings)
        XCTAssertEqual(SlideKind(type: "environment"), .environment)
        XCTAssertEqual(SlideKind(type: "patterns"), .patterns)
        XCTAssertEqual(SlideKind(type: "comparisons"), .comparisons)
        XCTAssertEqual(SlideKind(type: "summary"), .summary)
    }

    func testUnknownTypePreservesRawValue() {
        XCTAssertEqual(SlideKind(type: "mystery"), .unknown("mystery"))
        XCTAssertEqual(SlideKind(type: "mystery").rawType, "mystery")
    }

    func testRawTypeRoundTrips() {
        for slide in SlideRendererFixture.deck() {
            XCTAssertEqual(SlideKind(type: slide.kind.rawType), slide.kind)
        }
    }
}

// MARK: - Drive-highlight selection (the slice the renderer owns)

final class SlideDriveHighlightTests: XCTestCase {
    func testLongestVariantUsesLongestDriveLabelAndEmoji() {
        let variant = DriveHighlightVariant(field: "longest")
        XCTAssertEqual(variant, .longest)
        XCTAssertEqual(variant.emoji, "🏔️")
        XCTAssertEqual(variant.labelKey, "yearReview.longestDrive")
        XCTAssertEqual(variant.labelFallback, "Longest Drive")
    }

    func testNonLongestFieldResolvesToMostEfficient() {
        XCTAssertEqual(DriveHighlightVariant(field: "efficient"), .mostEfficient)
        XCTAssertEqual(DriveHighlightVariant(field: nil), .mostEfficient)
        XCTAssertEqual(DriveHighlightVariant(field: "efficient").emoji, "🌿")
        XCTAssertEqual(DriveHighlightVariant(field: "efficient").labelFallback, "Most Efficient Drive")
    }

    func testLongestSlideProjectsLongestDrive() {
        let slide = SlideDefinitionInput(type: "drive-highlight", field: "longest", background: "from-amber-900")
        let projection = SlideRendererFixture.project(slide)
        guard case let .driveHighlight(hero) = projection.hero else {
            return XCTFail("expected driveHighlight hero")
        }
        XCTAssertEqual(hero.label, "Longest Drive")
        XCTAssertEqual(hero.emoji, "🏔️")
        XCTAssertTrue(hero.hasDrive)
        XCTAssertEqual(hero.startAddress, "San Francisco, CA")
        XCTAssertEqual(hero.endAddress, "Los Angeles, CA")
        XCTAssertEqual(hero.distanceText, "612")
        XCTAssertEqual(hero.durationText, "6h 14m")
        XCTAssertEqual(hero.efficiencyText, "168")
        XCTAssertEqual(hero.date, "2026-08-14")
    }

    func testEfficientSlideProjectsMostEfficientDrive() {
        let slide = SlideDefinitionInput(type: "drive-highlight", field: "efficient", background: "from-teal-900")
        let projection = SlideRendererFixture.project(slide)
        guard case let .driveHighlight(hero) = projection.hero else {
            return XCTFail("expected driveHighlight hero")
        }
        XCTAssertEqual(hero.label, "Most Efficient Drive")
        XCTAssertEqual(hero.emoji, "🌿")
        XCTAssertEqual(hero.distanceText, "84")
        XCTAssertEqual(hero.durationText, "1h 36m")
        XCTAssertEqual(hero.efficiencyText, "121")
    }

    func testMissingDriveRendersNoDataState() {
        var blank = SlideRendererFixture.recap()
        blank = YearReviewRecap(
            year: blank.year, vehicleName: blank.vehicleName, totalDrives: blank.totalDrives,
            totalDistanceKm: blank.totalDistanceKm, totalEnergyKwh: blank.totalEnergyKwh,
            totalChargeSessions: blank.totalChargeSessions, gasSavings: blank.gasSavings,
            co2OffsetKg: blank.co2OffsetKg, superchargerPct: blank.superchargerPct, dcFastPct: blank.dcFastPct,
            acOtherPct: blank.acOtherPct, avgChargeStartSoc: blank.avgChargeStartSoc,
            mostActiveDayOfWeek: blank.mostActiveDayOfWeek, mostActiveHour: blank.mostActiveHour,
            avgDrivesPerWeek: blank.avgDrivesPerWeek, longestDrive: nil, mostEfficientDrive: nil,
            comparisons: blank.comparisons
        )
        let slide = SlideDefinitionInput(type: "drive-highlight", field: "longest", background: "from-amber-900")
        let projection = SlideRendererFixture.project(slide, recap: blank)
        guard case let .driveHighlight(hero) = projection.hero else {
            return XCTFail("expected driveHighlight hero")
        }
        XCTAssertFalse(hero.hasDrive)
        XCTAssertEqual(hero.noDataText, "No drive data for this year")
    }

    func testZeroEfficiencyShowsDash() {
        let drive = YearReviewRecapDrive(
            driveID: 9, date: "2026-01-01", distanceKm: 40, durationMin: 30,
            startAddress: "A", endAddress: "B", efficiencyWhKm: 0
        )
        let recap = YearReviewRecap(
            year: 2026, vehicleName: "Y", totalDrives: 1, totalDistanceKm: 1, totalEnergyKwh: 1,
            totalChargeSessions: 1, gasSavings: 1, co2OffsetKg: 1, superchargerPct: 1, dcFastPct: 1,
            acOtherPct: 1, avgChargeStartSoc: 1, mostActiveDayOfWeek: "Mon", mostActiveHour: 1,
            avgDrivesPerWeek: 1, longestDrive: drive, mostEfficientDrive: drive, comparisons: []
        )
        let slide = SlideDefinitionInput(type: "drive-highlight", field: "longest", background: "from-amber-900")
        let projection = SlideRendererFixture.project(slide, recap: recap)
        guard case let .driveHighlight(hero) = projection.hero else {
            return XCTFail("expected driveHighlight hero")
        }
        XCTAssertEqual(hero.efficiencyText, "—")
    }
}

// MARK: - Per-kind projection (web dispatch parity)

final class SlideRendererProjectionTests: XCTestCase {
    private struct StatHeroValues {
        let emoji: String
        let value: String?
        let unit: String?
    }

    private func stat(_ slide: SlideDefinitionInput) -> StatHeroValues? {
        let hero = SlideRendererFixture.project(slide).hero
        guard case let .stat(emoji, _, value, unit, _) = hero else { return nil }
        return StatHeroValues(emoji: emoji, value: value, unit: unit)
    }

    func testTitleProjectsGroupedYearAndVehicle() {
        let hero = SlideRendererFixture.project(
            SlideDefinitionInput(type: "title", background: "from-blue-900")
        ).hero
        guard case let .stat(emoji, title, value, _, caption) = hero else { return XCTFail("stat") }
        XCTAssertEqual(emoji, "🚗")
        XCTAssertEqual(value, "2,026")
        XCTAssertEqual(title, "Year in Review")
        XCTAssertEqual(caption, "Model 3 Performance")
    }

    func testStatHeroDistanceAndEnergy() throws {
        let distance = try XCTUnwrap(stat(
            SlideDefinitionInput(type: "stat-hero", field: "distance", background: "from-emerald-900")
        ))
        XCTAssertEqual(distance.emoji, "🛣️")
        XCTAssertEqual(distance.value, "18,450")
        XCTAssertEqual(distance.unit, "km")

        let energy = try XCTUnwrap(stat(
            SlideDefinitionInput(type: "stat-hero", field: "energy", background: "from-cyan-900")
        ))
        XCTAssertEqual(energy.emoji, "⚡")
        XCTAssertEqual(energy.value, "3,120")
        XCTAssertEqual(energy.unit, "kWh")
    }

    func testStatHeroDefaultsToDistanceWhenFieldMissing() throws {
        let defaulted = try XCTUnwrap(stat(SlideDefinitionInput(type: "stat-hero", background: "from-emerald-900")))
        XCTAssertEqual(defaulted.emoji, "🛣️")
        XCTAssertEqual(defaulted.value, "18,450")
    }

    func testStatChartSavingsEnvironmentPatterns() throws {
        XCTAssertEqual(
            try XCTUnwrap(stat(SlideDefinitionInput(type: "stat-chart", background: "from-purple-900"))).value,
            "342"
        )
        XCTAssertEqual(
            try XCTUnwrap(stat(SlideDefinitionInput(type: "savings", background: "from-emerald-900"))).value,
            "2,480"
        )
        let environment = try XCTUnwrap(stat(SlideDefinitionInput(type: "environment", background: "from-green-900")))
        XCTAssertEqual(environment.value, "1,450")
        XCTAssertEqual(environment.unit, "kg")
        XCTAssertEqual(
            try XCTUnwrap(stat(SlideDefinitionInput(type: "patterns", background: "from-indigo-900"))).value,
            "Saturday"
        )
    }

    func testComparisonsProjectsAllItems() {
        let hero = SlideRendererFixture.project(
            SlideDefinitionInput(type: "comparisons", background: "from-pink-900")
        ).hero
        guard case let .comparisons(emoji, title, items) = hero else { return XCTFail("comparisons") }
        XCTAssertEqual(emoji, "✨")
        XCTAssertEqual(title, "Fun facts about your year")
        XCTAssertEqual(items.count, 2)
        XCTAssertEqual(items.first?.emoji, "🌍")
    }

    func testChargingBreakdownFiltersZeroShares() {
        let hero = SlideRendererFixture.project(
            SlideDefinitionInput(type: "charging-breakdown", background: "from-orange-900"),
            recap: SlideRendererFixture.recap(acOtherPct: 0)
        ).hero
        guard case let .chargingBreakdown(charging) = hero else { return XCTFail("chargingBreakdown") }
        XCTAssertEqual(charging.sessionsValue, "96")
        XCTAssertEqual(charging.socCaption, "Average plug-in at 34% battery")
        XCTAssertEqual(charging.shares.count, 2)
        XCTAssertEqual(charging.shares.first?.percentText, "62%")
    }

    func testUnknownKindProjectsNoBody() {
        let hero = SlideRendererFixture.project(
            SlideDefinitionInput(type: "mystery", background: "from-blue-900")
        ).hero
        XCTAssertEqual(hero, .none)
    }

    func testProjectionCarriesGradientAndIndex() {
        let projection = SlideRendererFixture.project(
            SlideDefinitionInput(type: "title", background: "from-blue-900 to-slate-900"),
            index: 7
        )
        XCTAssertEqual(projection.index, 7)
        XCTAssertEqual(projection.kind, .title)
        XCTAssertEqual(projection.gradient.count, 2)
    }
}

// MARK: - Formatting parity

final class SlideRendererFormatTests: XCTestCase {
    func testGroupedNumber() {
        XCTAssertEqual(SlideRendererFormat.number(18450, decimals: 0, localeIdentifier: "en_US"), "18,450")
        XCTAssertEqual(SlideRendererFormat.integer(2026, localeIdentifier: "en_US"), "2,026")
    }

    func testNonFiniteCollapsesToZero() {
        XCTAssertEqual(SlideRendererFormat.number(.nan, decimals: 0, localeIdentifier: "en_US"), "0")
        XCTAssertEqual(SlideRendererFormat.number(.infinity, decimals: 0, localeIdentifier: "en_US"), "0")
    }

    func testDurationFormat() {
        XCTAssertEqual(SlideRendererFormat.duration(minutes: 374), "6h 14m")
        XCTAssertEqual(SlideRendererFormat.duration(minutes: 45), "45m")
        XCTAssertEqual(SlideRendererFormat.duration(minutes: 60), "1h 0m")
        XCTAssertEqual(SlideRendererFormat.duration(minutes: -5), "0m")
    }
}

// MARK: - Accessibility summaries

final class SlideRendererAccessibilityTests: XCTestCase {
    private let echo = SlideRendererFixture.echo

    func testStatSummaryDropsMissingUnit() {
        let hero = SlideHero.stat(emoji: "🚗", title: "Year in Review", value: "2,026", unit: nil, caption: "Model 3")
        XCTAssertEqual(
            SlideRendererAccessibility.summary(for: hero, localize: echo),
            "2,026, Year in Review, Model 3"
        )
    }

    func testDriveHighlightSummarySpeaksRouteAndStats() {
        let projection = SlideRendererFixture.project(
            SlideDefinitionInput(type: "drive-highlight", field: "longest", background: "from-amber-900")
        )
        XCTAssertEqual(
            projection.accessibilityLabel,
            "Longest Drive, San Francisco, CA to Los Angeles, CA, 612 km, 6h 14m duration"
        )
    }

    func testComparisonsSummaryListsFacts() {
        let hero = SlideHero.comparisons(
            emoji: "✨",
            title: "Fun facts about your year",
            items: [YearReviewRecapComparison(label: "Trees planted", value: "66", emoji: "🌳")]
        )
        XCTAssertEqual(
            SlideRendererAccessibility.summary(for: hero, localize: echo),
            "Fun facts about your year, Trees planted 66"
        )
    }

    func testNoneSummaryIsEmpty() {
        XCTAssertEqual(SlideRendererAccessibility.summary(for: .none, localize: echo), "")
    }
}
