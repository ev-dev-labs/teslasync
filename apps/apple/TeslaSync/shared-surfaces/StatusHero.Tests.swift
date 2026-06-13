//
//  StatusHero.Tests.swift
//  TeslaSync — P4 shared surface · 0199 · StatusHero (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in StatusHero.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • StatusHeroModel — the once-only `view.opened`, the props update guard, the derived projection,
//      and the forwarded CTA `activate()` (web `cta.onClick`).
//    • Views — the public surface + the subviews compose in every status / branch; the status → token
//      tint + glow projections resolve.
//    • Strings — the per-status headlines + the "Live" word resolve through the P1/S10 facade with the
//      English fallbacks (byte-identical to the web copy).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - StatusHeroModel (surface lifecycle + derivation)

@MainActor
final class StatusHeroModelTests: XCTestCase {
    private func model(
        _ input: StatusHeroInput,
        onActivate: (@MainActor () -> Void)? = nil,
        telemetry: StatusHeroTelemetry = OSLogStatusHeroTelemetry()
    ) -> StatusHeroModel {
        StatusHeroModel(input: input, onActivate: onActivate, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyStatusHeroTelemetry()
        let hero = model(StatusHeroInput(status: .healthy), telemetry: spy)
        hero.start()
        hero.start()
        XCTAssertEqual(spy.surfaces, [StatusHeroSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyStatusHeroTelemetry()
        let hero = model(StatusHeroInput(status: .healthy), telemetry: spy)
        hero.start()
        hero.stop()
        hero.start()
        XCTAssertEqual(spy.surfaces, [StatusHeroSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInput() {
        let hero = model(StatusHeroInput(status: .unhealthy, subline: "Offline", isLive: true, ctaLabel: "Fix"))
        XCTAssertEqual(hero.projection.status, .unhealthy)
        XCTAssertEqual(hero.projection.headline, "Service outage")
        XCTAssertEqual(hero.projection.subline, "Offline")
        XCTAssertTrue(hero.projection.showsLive)
        XCTAssertTrue(hero.projection.showsCTA)
    }

    func testUpdateChangesProjectionAndGuardsIdentical() {
        let initial = StatusHeroInput(status: .healthy)
        let hero = model(initial)
        hero.update(initial)
        XCTAssertEqual(hero.projection.status, .healthy)
        hero.update(StatusHeroInput(status: .maintenance))
        XCTAssertEqual(hero.projection.status, .maintenance)
        XCTAssertEqual(hero.projection.headline, "Scheduled maintenance")
    }

    func testActivateForwardsToHandler() {
        let counter = ActivationCounter()
        let hero = model(StatusHeroInput(status: .healthy, ctaLabel: "Go"), onActivate: { counter.bump() })
        hero.activate()
        hero.activate()
        XCTAssertEqual(counter.count, 2)
    }

    func testActivateIsNoOpWithoutHandler() {
        let hero = model(StatusHeroInput(status: .healthy))
        hero.activate()
        XCTAssertNil(hero.onActivate)
    }
}

// MARK: - Views (every branch composes + token projections)

@MainActor
final class StatusHeroViewTests: XCTestCase {
    func testSurfaceComposesForEveryStatus() {
        for status in HeroStatus.allCases {
            _ = StatusHero(status: status)
        }
    }

    func testSurfaceComposesForEveryBranch() {
        _ = StatusHero(status: .healthy, subline: "8 services", live: true)
        _ = StatusHero(status: .degraded, headline: "Custom", subline: "1 down")
        _ = StatusHero(status: .unhealthy, subline: "Offline", cta: StatusHeroAction(label: "Retry") {})
        _ = StatusHero(
            status: .maintenance,
            subline: "Upgrading",
            cta: StatusHeroAction(label: "Refreshing", isLoading: true) {}
        )
        _ = StatusHero(status: .unknown, anchorID: "system-status-hero")
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = StatusHeroModel(
            input: StatusHeroInput(status: .healthy),
            telemetry: SpyStatusHeroTelemetry()
        )
        _ = StatusHero(model: injected)
        XCTAssertEqual(StatusHero.surfaceSlug, "StatusHero")
    }

    func testSubviewsCompose() {
        let projection = StatusHeroProjector.resolve(
            StatusHeroInput(status: .healthy, subline: "8 services", isLive: true, ctaLabel: "Go"),
            defaultHeadline: StatusHeroStrings.defaultHeadline(for:),
            liveLabel: StatusHeroStrings.live
        )
        _ = StatusHeroMedallion(status: .healthy)
        _ = StatusHeroTextBlock(projection: projection, alignment: .leading)
        _ = StatusHeroTextBlock(projection: projection, alignment: .center)
        _ = StatusHeroCTAButton(label: "Go", isLoading: false, onTap: {})
        _ = StatusHeroContainer(projection: projection, onActivate: {})
    }

    func testStatusTintProjections() {
        XCTAssertEqual(HeroStatus.healthy.tint, Color.TS.statusSuccess)
        XCTAssertEqual(HeroStatus.degraded.tint, Color.TS.statusWarning)
        XCTAssertEqual(HeroStatus.unhealthy.tint, Color.TS.statusDanger)
        XCTAssertEqual(HeroStatus.unknown.tint, Color.TS.textMuted)
        XCTAssertEqual(HeroStatus.maintenance.tint, Color.TS.statusInfo)
    }

    func testGlowOpacityIsMutedForUnknown() {
        XCTAssertEqual(HeroStatus.unknown.glowOpacity, 0.25, accuracy: 0.0001)
        for status in HeroStatus.allCases where status != .unknown {
            XCTAssertEqual(status.glowOpacity, 0.35, accuracy: 0.0001)
        }
    }
}

// MARK: - Strings facade (P1/S10)

final class StatusHeroStringsTests: XCTestCase {
    func testPerStatusHeadlineFallbacks() {
        XCTAssertEqual(StatusHeroStrings.defaultHeadline(for: .healthy), "All systems operational")
        XCTAssertEqual(StatusHeroStrings.defaultHeadline(for: .degraded), "Degraded performance")
        XCTAssertEqual(StatusHeroStrings.defaultHeadline(for: .unhealthy), "Service outage")
        XCTAssertEqual(StatusHeroStrings.defaultHeadline(for: .unknown), "Status unknown")
        XCTAssertEqual(StatusHeroStrings.defaultHeadline(for: .maintenance), "Scheduled maintenance")
    }

    func testLiveFallback() {
        XCTAssertEqual(StatusHeroStrings.live, "Live")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyStatusHeroTelemetry: StatusHeroTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// A `@MainActor` activation counter for the `activate()` forwarding test.
@MainActor
private final class ActivationCounter {
    private(set) var count = 0
    func bump() {
        count += 1
    }
}
