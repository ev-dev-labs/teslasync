//
//  EnvironmentalImpact.Tests.swift
//  TeslaSync — P4 feature view · 0112 · EnvironmentalImpact (Apple)
//
//  Unit coverage for the EnvironmentalImpact surface: the Adapter projections
//  (the web `coreStats ? loaded : noData` conditional, the cache-then-network
//  `resolve`, the freshness connection + chip), the locale-aware number
//  formatting (web `fmtNumber` incl. its non-finite guard), the primary +
//  secondary stat tiles, the interpolated description sentence, the VoiceOver
//  summaries, the i18n key parity (referenced == the web keys), and the P1/S11
//  `view.opened` telemetry. No network, no real store, no rendering host — the
//  pure projections are exercised directly.
//
//  These run in the TeslaSync(/-macOS) XCTest targets.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum EnvironmentalImpactFixture {
    static let locale = Locale(identifier: "en_US")

    static let sample = EnvironmentalImpactData(
        co2SavedKg: 1284.6,
        treeEquiv: 21.4,
        gallonsEquiv: 146.2,
        savings: 1830
    )

    static let echo = EnvironmentalImpactLocalizer.echo
}

/// A localizer that records every key it is asked to resolve, so the tests can
/// assert the surface references exactly the web keys.
private final class RecordingLocalizer: @unchecked Sendable {
    private let lock = NSLock()
    private var keys: [String] = []

    var requested: [String] {
        lock.lock(); defer { lock.unlock() }
        return keys
    }

    func record(_ key: String) {
        lock.lock(); keys.append(key); lock.unlock()
    }

    var localizer: EnvironmentalImpactLocalizer {
        EnvironmentalImpactLocalizer(
            string: { key, fallback in self.record(key); return fallback },
            format: { key, fallbackFormat, argument in
                self.record(key)
                return String(format: fallbackFormat, argument)
            }
        )
    }
}

// MARK: - Adapter: state / resolve / connection

@MainActor final class EnvironmentalImpactProjectionTests: XCTestCase {
    func testStateFromCoreStatsMirrorsWebConditional() {
        XCTAssertEqual(EnvironmentalImpactProjection.state(from: nil), .empty)
        XCTAssertEqual(
            EnvironmentalImpactProjection.state(from: EnvironmentalImpactFixture.sample),
            .loaded(EnvironmentalImpactFixture.sample)
        )
    }

    func testConnectionPrecedence() {
        XCTAssertEqual(EnvironmentalImpactProjection.connection(stale: false, offline: false), .live)
        XCTAssertEqual(EnvironmentalImpactProjection.connection(stale: true, offline: false), .stale)
        XCTAssertEqual(EnvironmentalImpactProjection.connection(stale: false, offline: true), .offline)
        // Offline wins over stale.
        XCTAssertEqual(EnvironmentalImpactProjection.connection(stale: true, offline: true), .offline)
    }

    func testResolveKeepsCachedValueWhileLoading() {
        let resolved = EnvironmentalImpactProjection.resolve(value: EnvironmentalImpactFixture.sample, phase: .loading)
        XCTAssertEqual(resolved.state, .loaded(EnvironmentalImpactFixture.sample))
        XCTAssertEqual(resolved.connection, .live)
    }

    func testResolveShowsSkeletonWhenLoadingWithoutCache() {
        let resolved = EnvironmentalImpactProjection.resolve(value: nil, phase: .loading)
        XCTAssertEqual(resolved.state, .loading)
    }

    func testResolveLoadedFallsBackToEmptyWithoutValue() {
        XCTAssertEqual(EnvironmentalImpactProjection.resolve(value: nil, phase: .loaded).state, .empty)
        XCTAssertEqual(EnvironmentalImpactProjection.resolve(value: nil, phase: .empty).state, .empty)
    }

    func testResolveKeepsCachedValueOnFailure() {
        let cached = EnvironmentalImpactProjection.resolve(
            value: EnvironmentalImpactFixture.sample,
            phase: .failed(message: "boom")
        )
        XCTAssertEqual(cached.state, .loaded(EnvironmentalImpactFixture.sample))

        let nocache = EnvironmentalImpactProjection.resolve(value: nil, phase: .failed(message: "boom"))
        XCTAssertEqual(nocache.state, .error(message: "boom"))
    }

    func testResolveCarriesFreshness() {
        let stale = EnvironmentalImpactProjection.resolve(
            value: EnvironmentalImpactFixture.sample,
            phase: .loaded,
            stale: true
        )
        XCTAssertEqual(stale.connection, .stale)
        let offline = EnvironmentalImpactProjection.resolve(
            value: EnvironmentalImpactFixture.sample,
            phase: .loaded,
            offline: true
        )
        XCTAssertEqual(offline.connection, .offline)
    }

    func testStateDataAccessor() {
        XCTAssertEqual(
            EnvironmentalImpactState.loaded(EnvironmentalImpactFixture.sample).data,
            EnvironmentalImpactFixture.sample
        )
        XCTAssertNil(EnvironmentalImpactState.loading.data)
        XCTAssertNil(EnvironmentalImpactState.empty.data)
        XCTAssertNil(EnvironmentalImpactState.error(message: nil).data)
    }

    func testMetricTonsDerivation() {
        XCTAssertEqual(EnvironmentalImpactFixture.sample.metricTonsCo2, 1.2846, accuracy: 0.0001)
    }

    func testConnectionHasUsableDataNeverBlanks() {
        XCTAssertTrue(EnvironmentalImpactConnection.live.hasUsableData)
        XCTAssertTrue(EnvironmentalImpactConnection.stale.hasUsableData)
        XCTAssertTrue(EnvironmentalImpactConnection.offline.hasUsableData)
    }
}

// MARK: - Number formatting (web `fmtNumber`)

@MainActor final class EnvironmentalImpactFormatTests: XCTestCase {
    func testFixedPrecisionAndGrouping() {
        XCTAssertEqual(
            EnvironmentalImpactFormat.number(1284.6, decimals: 1, locale: EnvironmentalImpactFixture.locale),
            "1,284.6"
        )
        XCTAssertEqual(
            EnvironmentalImpactFormat.number(21.4, decimals: 1, locale: EnvironmentalImpactFixture.locale),
            "21.4"
        )
        XCTAssertEqual(
            EnvironmentalImpactFormat.number(1.2846, decimals: 2, locale: EnvironmentalImpactFixture.locale),
            "1.28"
        )
        XCTAssertEqual(
            EnvironmentalImpactFormat.number(1830, decimals: 0, locale: EnvironmentalImpactFixture.locale),
            "1,830"
        )
        XCTAssertEqual(
            EnvironmentalImpactFormat.number(1284.6, decimals: 0, locale: EnvironmentalImpactFixture.locale),
            "1,285"
        )
    }

    func testNonFiniteGuardRendersZero() {
        XCTAssertEqual(
            EnvironmentalImpactFormat.number(.nan, decimals: 1, locale: EnvironmentalImpactFixture.locale),
            "0.0"
        )
        XCTAssertEqual(
            EnvironmentalImpactFormat.number(.infinity, decimals: 0, locale: EnvironmentalImpactFixture.locale),
            "0"
        )
        XCTAssertEqual(
            EnvironmentalImpactFormat.number(-.infinity, decimals: 2, locale: EnvironmentalImpactFixture.locale),
            "0.00"
        )
    }
}

// MARK: - Stat tiles (web primary + secondary figures)

@MainActor final class EnvironmentalImpactStatTests: XCTestCase {
    func testPrimaryStats() {
        let stats = EnvironmentalImpactProjection.primaryStats(
            EnvironmentalImpactFixture.sample,
            locale: EnvironmentalImpactFixture.locale
        )
        XCTAssertEqual(stats.map(\.id), ["co2SavedKg", "treeEquiv"])
        XCTAssertEqual(stats[0].value, "1,284.6")
        XCTAssertEqual(stats[0].labelKey, "costAnalysis.environment.kgCo2")
        XCTAssertEqual(stats[0].labelFallback, "kg CO₂ saved")
        XCTAssertEqual(stats[1].value, "21.4")
        XCTAssertEqual(stats[1].labelKey, "costAnalysis.environment.treeEquiv")
        XCTAssertEqual(stats[1].labelFallback, "tree-years equivalent")
    }

    func testSecondaryStats() {
        let stats = EnvironmentalImpactProjection.secondaryStats(
            EnvironmentalImpactFixture.sample,
            locale: EnvironmentalImpactFixture.locale
        )
        XCTAssertEqual(stats.map(\.id), ["gallonsEquiv", "metricTons", "savings"])
        XCTAssertEqual(stats[0].value, "146.2")
        XCTAssertEqual(stats[0].labelKey, "costAnalysis.environment.gallons")
        XCTAssertEqual(stats[1].value, "1.28")
        XCTAssertEqual(stats[1].labelKey, "costAnalysis.environment.metricTons")
        XCTAssertEqual(stats[1].labelFallback, "metric tons CO₂")
        XCTAssertEqual(stats[2].value, "1,830")
        XCTAssertEqual(stats[2].labelKey, "costAnalysis.environment.dollarsSaved")
        XCTAssertEqual(stats[2].labelFallback, "$ saved total")
    }
}

// MARK: - Description sentence (web interpolated `<p>`)

@MainActor final class EnvironmentalImpactDescriptionTests: XCTestCase {
    func testDescriptionSegments() {
        let desc = EnvironmentalImpactDescription.build(
            EnvironmentalImpactFixture.sample,
            locale: EnvironmentalImpactFixture.locale,
            localize: EnvironmentalImpactFixture.echo
        )
        XCTAssertEqual(
            desc.lead,
            "By driving electric instead of a gas car, you have avoided the equivalent of"
        )
        XCTAssertTrue(desc.co2Highlight.contains("1,285"), desc.co2Highlight)
        XCTAssertTrue(desc.co2Highlight.contains("kg"), desc.co2Highlight)
        XCTAssertTrue(desc.middle.contains("of CO₂ emissions."), desc.middle)
        XCTAssertTrue(desc.middle.contains("That's the same as"), desc.middle)
        XCTAssertEqual(desc.treeHighlight, "21.4")
        XCTAssertEqual(desc.trailing, "trees absorbing carbon for a full year.")
    }

    func testDescriptionAccessibilityLabelReadsWholeSentence() {
        let desc = EnvironmentalImpactDescription.build(
            EnvironmentalImpactFixture.sample,
            locale: EnvironmentalImpactFixture.locale,
            localize: EnvironmentalImpactFixture.echo
        )
        let label = desc.accessibilityLabel
        XCTAssertTrue(label.contains("By driving electric"), label)
        XCTAssertTrue(label.contains("1,285 kg"), label)
        XCTAssertTrue(label.contains("21.4"), label)
        XCTAssertTrue(label.contains("trees absorbing carbon for a full year."), label)
    }

    /// Guards that the description references exactly the web i18n keys.
    func testDescriptionReferencesWebKeys() {
        let recorder = RecordingLocalizer()
        _ = EnvironmentalImpactDescription.build(
            EnvironmentalImpactFixture.sample,
            locale: EnvironmentalImpactFixture.locale,
            localize: recorder.localizer
        )
        let requested = Set(recorder.requested)
        XCTAssertTrue(requested.contains("costAnalysis.environment.desc"))
        XCTAssertTrue(requested.contains("costAnalysis.environment.ofCo2"))
        XCTAssertTrue(requested.contains("costAnalysis.environment.treeNote"))
        XCTAssertTrue(requested.contains("costAnalysis.environment.treesAbsorbing"))
        XCTAssertTrue(requested.contains("costAnalysis.environment.kgValue"))
    }
}

// MARK: - Freshness chip

@MainActor final class EnvironmentalFreshnessChipTests: XCTestCase {
    func testChipProjection() {
        XCTAssertNil(EnvironmentalFreshnessChip.project(.live))
        XCTAssertEqual(EnvironmentalFreshnessChip.project(.stale), .stale)
        XCTAssertEqual(EnvironmentalFreshnessChip.project(.offline), .offline)
    }

    func testChipMetadata() {
        XCTAssertEqual(EnvironmentalFreshnessChip.stale.labelKey, "costAnalysis.environment.freshness.stale")
        XCTAssertEqual(EnvironmentalFreshnessChip.stale.labelFallback, "Stale")
        XCTAssertEqual(EnvironmentalFreshnessChip.stale.tone, .warning)
        XCTAssertEqual(EnvironmentalFreshnessChip.stale.systemImage, "clock.arrow.circlepath")
        XCTAssertEqual(EnvironmentalFreshnessChip.offline.labelKey, "costAnalysis.environment.freshness.offline")
        XCTAssertEqual(EnvironmentalFreshnessChip.offline.labelFallback, "Offline")
        XCTAssertEqual(EnvironmentalFreshnessChip.offline.tone, .neutral)
        XCTAssertEqual(EnvironmentalFreshnessChip.offline.systemImage, "wifi.slash")
    }
}

// MARK: - Accessibility + i18n key parity

@MainActor final class EnvironmentalImpactAccessibilityTests: XCTestCase {
    func testStatLabelComposesValueAndLabel() {
        let stats = EnvironmentalImpactProjection.primaryStats(
            EnvironmentalImpactFixture.sample,
            locale: EnvironmentalImpactFixture.locale
        )
        XCTAssertEqual(
            EnvironmentalImpactAccessibility.statLabel(stats[0], localize: EnvironmentalImpactFixture.echo),
            "1,284.6 kg CO₂ saved"
        )
    }

    func testHeaderLabelWithAndWithoutChip() {
        XCTAssertEqual(
            EnvironmentalImpactAccessibility.headerLabel(chip: nil, localize: EnvironmentalImpactFixture.echo),
            "Environmental Impact"
        )
        XCTAssertEqual(
            EnvironmentalImpactAccessibility.headerLabel(chip: .stale, localize: EnvironmentalImpactFixture.echo),
            "Environmental Impact, Stale"
        )
    }

    /// Guards that the figure tiles reference exactly the web keys — a regression
    /// here means the folded catalog would miss a string.
    func testStatLabelKeysMatchWebKeys() {
        let primary = EnvironmentalImpactProjection.primaryStats(
            EnvironmentalImpactFixture.sample,
            locale: EnvironmentalImpactFixture.locale
        )
        let secondary = EnvironmentalImpactProjection.secondaryStats(
            EnvironmentalImpactFixture.sample,
            locale: EnvironmentalImpactFixture.locale
        )
        XCTAssertEqual(
            primary.map(\.labelKey) + secondary.map(\.labelKey),
            [
                "costAnalysis.environment.kgCo2",
                "costAnalysis.environment.treeEquiv",
                "costAnalysis.environment.gallons",
                "costAnalysis.environment.metricTons",
                "costAnalysis.environment.dollarsSaved"
            ]
        )
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

@MainActor final class EnvironmentalImpactTelemetryTests: XCTestCase {
    private final class Recorder: EnvironmentalImpactTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var stored: [String] = []
        var surfaces: [String] {
            lock.lock(); defer { lock.unlock() }
            return stored
        }

        func viewOpened(surface: String) {
            lock.lock(); stored.append(surface); lock.unlock()
        }
    }

    func testReportOpenEmitsSlug() {
        let recorder = Recorder()
        EnvironmentalImpactSurface.reportOpen(to: recorder)
        XCTAssertEqual(recorder.surfaces, ["EnvironmentalImpact"])
        XCTAssertEqual(EnvironmentalImpact.surfaceSlug, "EnvironmentalImpact")
    }
}
