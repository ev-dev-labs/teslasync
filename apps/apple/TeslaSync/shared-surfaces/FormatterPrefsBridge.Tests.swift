//
//  FormatterPrefsBridge.Tests.swift
//  TeslaSync — P4 shared surface · 0146 · FormatterPrefsBridge (Apple)
//
//  Coverage for the surface above the pure adapter (see AdapterTests) and the model (see ModelTests):
//    • Projection — every render phase (loading / unavailable / usingDefaults / applied) including the
//      resolved locale + precision, the explicit-vs-defaults decision, the `?? defaultPrecision`
//      fallback, the offline decoration, and the `applied` / `isResolved` conveniences.
//    • Live + in-memory sources — start / refresh emit the snapshot; update mutates the lifecycle;
//      the in-memory double records its call counts.
//    • Views — every state's subview composes (signature contract) + the surface composes for every
//      input.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure projection / source / view construction directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let resolveFallback: FormatterPrefsBridgeResolve = { _, fallback in fallback }

private enum InputFixture {
    static let loading = FormatterPrefsBridgeInput(status: .loading)
    static let failed = FormatterPrefsBridgeInput(status: .failed)
    static let defaults = FormatterPrefsBridgeInput(status: .resolved)
    static let explicitLocale = FormatterPrefsBridgeInput(
        status: .resolved,
        settings: FormatterPrefsBridgeSettings(locale: "de-DE", decimalPrecision: nil)
    )
    static let explicitPrecision = FormatterPrefsBridgeInput(
        status: .resolved,
        settings: FormatterPrefsBridgeSettings(locale: nil, decimalPrecision: 4)
    )
    static let both = FormatterPrefsBridgeInput(
        status: .resolved,
        settings: FormatterPrefsBridgeSettings(locale: "fr-FR", decimalPrecision: 0)
    )
    static let offline = FormatterPrefsBridgeInput(
        status: .resolved,
        settings: FormatterPrefsBridgeSettings(locale: "fr-FR", decimalPrecision: 0),
        connection: .offline
    )
}

// MARK: - Projection (render phases + leaf contract)

final class FormatterPrefsBridgeProjectionTests: XCTestCase {
    private func resolve(_ input: FormatterPrefsBridgeInput) -> FormatterPrefsBridgeResolved {
        FormatterPrefsBridgeProjection.resolve(input, strings: resolveFallback)
    }

    func testLoadingPhase() {
        XCTAssertEqual(resolve(InputFixture.loading).phase, .loading)
        XCTAssertNil(resolve(InputFixture.loading).applied)
        XCTAssertFalse(resolve(InputFixture.loading).isResolved)
    }

    func testFailedPhaseIsUnavailable() {
        XCTAssertEqual(resolve(InputFixture.failed).phase, .unavailable)
        XCTAssertNil(resolve(InputFixture.failed).applied)
    }

    func testResolvedWithNothingConfiguredIsUsingDefaults() {
        let resolved = resolve(InputFixture.defaults)
        XCTAssertEqual(resolved.phase, .usingDefaults(FormatterPrefsBridgeApplied(locale: "en-US", precision: 2)))
        XCTAssertEqual(resolved.applied, FormatterPrefsBridgeApplied(locale: "en-US", precision: 2))
        XCTAssertTrue(resolved.isResolved)
    }

    func testExplicitLocaleAloneIsApplied() {
        let resolved = resolve(InputFixture.explicitLocale)
        // Locale set, precision absent → applied, precision falls back to the web `?? 2` default.
        XCTAssertEqual(resolved.phase, .applied(FormatterPrefsBridgeApplied(locale: "de-DE", precision: 2)))
    }

    func testExplicitPrecisionAloneIsApplied() {
        let resolved = resolve(InputFixture.explicitPrecision)
        // Precision set, locale absent → applied, locale falls back to the web `resolveLocale` en-US.
        XCTAssertEqual(resolved.phase, .applied(FormatterPrefsBridgeApplied(locale: "en-US", precision: 4)))
    }

    func testBothExplicitIsApplied() {
        XCTAssertEqual(
            resolve(InputFixture.both).phase,
            .applied(FormatterPrefsBridgeApplied(locale: "fr-FR", precision: 0))
        )
    }

    func testZeroPrecisionCountsAsExplicit() {
        // 0 is a valid user choice (distinct from `nil`), so it must NOT collapse to usingDefaults.
        let input = FormatterPrefsBridgeInput(
            status: .resolved,
            settings: FormatterPrefsBridgeSettings(locale: nil, decimalPrecision: 0)
        )
        XCTAssertEqual(resolve(input).phase, .applied(FormatterPrefsBridgeApplied(locale: "en-US", precision: 0)))
    }

    func testCustomDefaultPrecisionIsHonored() {
        let config = FormatterPrefsBridgeConfig(defaultPrecision: 5)
        let resolved = FormatterPrefsBridgeProjection.resolve(InputFixture.defaults, config: config)
        XCTAssertEqual(resolved.applied?.precision, 5)
    }

    func testOfflineDecorationCarried() {
        XCTAssertTrue(resolve(InputFixture.offline).offline)
        XCTAssertEqual(resolve(InputFixture.offline).connection, .offline)
        XCTAssertFalse(resolve(InputFixture.both).offline)
    }
}

// MARK: - Live source (production binding)

@MainActor
final class LiveFormatterPrefsBridgeSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheSnapshot() {
        let source = LiveFormatterPrefsBridgeSource(
            status: .resolved,
            settings: FormatterPrefsBridgeSettings(locale: "de-DE", decimalPrecision: 3)
        )
        var emissions: [String?] = []
        source.onUpdate = { emissions.append($0.settings.locale) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, ["de-DE", "de-DE"])
    }

    func testUpdateMutatesLifecycle() {
        let source = LiveFormatterPrefsBridgeSource(status: .loading)
        var latest: FormatterPrefsBridgeInput?
        source.onUpdate = { latest = $0 }
        source.update(
            status: .resolved,
            settings: FormatterPrefsBridgeSettings(locale: "es-ES", decimalPrecision: 1),
            connection: .stale
        )
        XCTAssertEqual(latest?.status, .resolved)
        XCTAssertEqual(latest?.settings.locale, "es-ES")
        XCTAssertEqual(latest?.settings.decimalPrecision, 1)
        XCTAssertEqual(latest?.connection, .stale)
    }
}

// MARK: - In-memory source (preview/test double)

@MainActor
final class InMemoryFormatterPrefsBridgeSourceTests: XCTestCase {
    func testRecordsCountsAndEmitsPushedSnapshots() {
        let source = InMemoryFormatterPrefsBridgeSource(initial: InputFixture.both)
        var emissions = 0
        source.onUpdate = { _ in emissions += 1 }
        source.start()
        source.refresh()
        source.push(InputFixture.defaults)
        source.stop()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(emissions, 3)
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class FormatterPrefsBridgeViewTests: XCTestCase {
    func testEveryStateSubviewComposes() {
        let applied = FormatterPrefsBridgeApplied(locale: "de-DE", precision: 3)
        _ = FormatterPrefsBridgeLoadingView()
        _ = FormatterPrefsBridgeDefaultsView(applied: FormatterPrefsBridgeApplied(locale: "en-US", precision: 2))
        _ = FormatterPrefsBridgeUnavailableView {}
        _ = FormatterPrefsBridgeAppliedView(applied: applied, offline: false)
        _ = FormatterPrefsBridgeAppliedView(applied: applied, offline: true)
        _ = FormatterPrefsBridgeValueGrid(applied: applied)
        _ = FormatterPrefsBridgeValueRow(label: "Locale", value: "de-DE")
        _ = FormatterPrefsBridgeFreshnessChip(connection: .stale) {}
        _ = FormatterPrefsBridgeFreshnessChip(connection: .offline) {}
    }

    func testSurfaceComposesForEveryInput() {
        let inputs: [FormatterPrefsBridgeInput] = [
            InputFixture.loading,
            InputFixture.failed,
            InputFixture.defaults,
            InputFixture.explicitLocale,
            InputFixture.both,
            InputFixture.offline,
            FormatterPrefsBridgeInput(
                status: .resolved,
                settings: FormatterPrefsBridgeSettings(locale: "fr-FR", decimalPrecision: 0),
                connection: .stale
            )
        ]
        for input in inputs {
            _ = FormatterPrefsBridge(input: input)
        }
        _ = FormatterPrefsBridge(input: InputFixture.both, applier: RecordingFormatterPrefsBridgeApplier())
    }
}
