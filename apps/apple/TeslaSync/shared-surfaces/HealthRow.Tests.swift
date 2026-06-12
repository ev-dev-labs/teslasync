//
//  HealthRow.Tests.swift
//  TeslaSync — P4 shared surface · 0197 · HealthRow (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value
//  types live in HealthRow.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • HealthRowModel — the once-only `view.opened`, the props update + identical-update guard, the
//      derived projection, the combined VoiceOver label, and the navigable/external/inert hint.
//    • HealthRowActivation — the kind / href / perform decomposition (web to / external / onClick).
//    • Status → tone — each status maps to the expected ``TSTone`` token, and the five are distinct.
//    • Views — the content view + the public surface compose in every branch.
//    • Strings — the native a11y label/hints resolve through the P1/S10 facade with the expected
//      fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - HealthRowModel (surface lifecycle + derivation)

@MainActor
final class HealthRowModelTests: XCTestCase {
    private func inputs(
        status: HealthRowStatus = .healthy,
        label: String = "Vehicles",
        summary: String = "12 / 12 healthy",
        activationKind: HealthRowActivationKind = .none,
        href: String? = nil
    ) -> HealthRowInputs {
        HealthRowInputs(
            status: status, label: label, summary: summary,
            activationKind: activationKind, href: href
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyHealthRowTelemetry()
        let model = HealthRowModel(inputs: inputs(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [HealthRowSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyHealthRowTelemetry()
        let model = HealthRowModel(inputs: inputs(), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [HealthRowSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInputs() {
        let model = HealthRowModel(inputs: inputs(status: .degraded, activationKind: .action))
        XCTAssertEqual(model.projection.status, .degraded)
        XCTAssertTrue(model.projection.isNavigable)
        XCTAssertTrue(model.projection.accessibilityIsButton)
    }

    func testUpdateChangesProjection() {
        let model = HealthRowModel(inputs: inputs())
        XCTAssertFalse(model.projection.isNavigable)
        model.update(inputs(activationKind: .link, href: "/vehicles"))
        XCTAssertTrue(model.projection.isNavigable)
        XCTAssertEqual(model.projection.href, "/vehicles")
    }

    func testUpdateWithIdenticalInputsIsNoOp() {
        let base = inputs(status: .maintenance)
        let model = HealthRowModel(inputs: base)
        model.update(base)
        XCTAssertEqual(model.projection.status, .maintenance)
    }

    func testAccessibilityLabelCombinesLabelAndSummary() {
        let model = HealthRowModel(inputs: inputs(label: "Vehicles", summary: "12 / 12 healthy"))
        XCTAssertEqual(model.accessibilityLabel, "Vehicles — 12 / 12 healthy")
    }

    func testNavigableInternalRowHasActivateHint() {
        let model = HealthRowModel(inputs: inputs(activationKind: .link, href: "/vehicles"))
        XCTAssertEqual(model.accessibilityHint, "Opens details")
    }

    func testActionRowHasActivateHint() {
        let model = HealthRowModel(inputs: inputs(activationKind: .action))
        XCTAssertEqual(model.accessibilityHint, "Opens details")
    }

    func testExternalRowHasExternalHint() {
        let model = HealthRowModel(inputs: inputs(activationKind: .externalLink, href: "https://x.test"))
        XCTAssertEqual(model.accessibilityHint, "Opens in your browser")
    }

    func testInertRowHasNoHint() {
        let model = HealthRowModel(inputs: inputs())
        XCTAssertNil(model.accessibilityHint, "non-navigable rows get no hint")
    }
}

// MARK: - HealthRowActivation (web to / external / onClick)

@MainActor
final class HealthRowActivationTests: XCTestCase {
    func testNoneHasNoKindHrefOrHandler() {
        let activation = HealthRowActivation.none
        XCTAssertEqual(activation.kind, .none)
        XCTAssertNil(activation.href)
        XCTAssertNil(activation.perform)
    }

    func testLinkCarriesHrefAndFiringHandler() {
        var fired = false
        let activation = HealthRowActivation.link(to: "/vehicles", perform: { fired = true })
        XCTAssertEqual(activation.kind, .link)
        XCTAssertEqual(activation.href, "/vehicles")
        activation.perform?()
        XCTAssertTrue(fired)
    }

    func testExternalLinkCarriesHrefAndFiringHandler() {
        var fired = false
        let activation = HealthRowActivation.externalLink(to: "https://x.test", perform: { fired = true })
        XCTAssertEqual(activation.kind, .externalLink)
        XCTAssertEqual(activation.href, "https://x.test")
        activation.perform?()
        XCTAssertTrue(fired)
    }

    func testActionHasHandlerButNoHref() {
        var fired = false
        let activation = HealthRowActivation.action(perform: { fired = true })
        XCTAssertEqual(activation.kind, .action)
        XCTAssertNil(activation.href)
        activation.perform?()
        XCTAssertTrue(fired)
    }
}

// MARK: - Status → tone tokens

@MainActor
final class HealthRowStatusToneTests: XCTestCase {
    func testStatusMapsToTone() {
        XCTAssertEqual(HealthRowStatus.healthy.tone, .success)
        XCTAssertEqual(HealthRowStatus.degraded.tone, .warning)
        XCTAssertEqual(HealthRowStatus.unhealthy.tone, .danger)
        XCTAssertEqual(HealthRowStatus.unknown.tone, .neutral)
        XCTAssertEqual(HealthRowStatus.maintenance.tone, .info)
    }

    func testStatusColorsAreDistinct() {
        let colors = HealthRowStatus.allCases.map(\.color)
        XCTAssertEqual(Set(colors.map { "\($0)" }).count, HealthRowStatus.allCases.count)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class HealthRowViewCompositionTests: XCTestCase {
    func testSurfaceComposesForFullRow() {
        _ = HealthRow(
            status: .healthy,
            label: "Vehicles",
            summary: "12 / 12 healthy",
            activation: .link(to: "/vehicles", perform: {}),
            icon: { Image(systemName: "car.fill") }
        )
        XCTAssertEqual(HealthRow.surfaceSlug, "HealthRow")
    }

    func testSurfaceComposesForMinimalRow() {
        _ = HealthRow(status: .unknown, label: "Uptime", summary: "—")
    }

    func testSurfaceComposesForEachActivation() {
        _ = HealthRow(
            status: .healthy, label: "Status", summary: "ok",
            activation: .externalLink(to: "https://x.test", perform: {})
        )
        _ = HealthRow(status: .degraded, label: "Check", summary: "now", activation: .action(perform: {}))
        _ = HealthRow(status: .maintenance, label: "DB", summary: "window")
    }

    func testContentViewComposesForEveryBranch() {
        let icon = AnyView(Image(systemName: "car.fill"))
        for kind in HealthRowActivationKind.allCases {
            for status in HealthRowStatus.allCases {
                let projection = HealthRowProjector.resolve(inputs: HealthRowInputs(
                    status: status, label: "Label", summary: "Summary",
                    hasIcon: true,
                    activationKind: kind,
                    href: kind == .link || kind == .externalLink ? "/x" : nil
                ))
                var activate: (@MainActor () -> Void)?
                if projection.isNavigable {
                    activate = {}
                }
                _ = HealthRowContentView(
                    projection: projection,
                    accessibilityLabel: "Label — Summary",
                    accessibilityHint: projection.isNavigable ? "Opens details" : nil,
                    icon: icon,
                    perform: activate
                )
            }
        }
    }
}

// MARK: - Strings facade (P1/S10)

final class HealthRowStringsTests: XCTestCase {
    func testAccessibilityLabelFormatsLabelAndSummary() {
        XCTAssertEqual(
            HealthRowStrings.accessibilityLabel(label: "Vehicles", summary: "12 / 12 healthy"),
            "Vehicles — 12 / 12 healthy"
        )
    }

    func testActivateHintResolvesToFallback() {
        XCTAssertEqual(HealthRowStrings.activateHint, "Opens details")
    }

    func testExternalHintResolvesToFallback() {
        XCTAssertEqual(HealthRowStrings.externalHint, "Opens in your browser")
    }

    func testTableName() {
        XCTAssertEqual(HealthRowStrings.table, "HealthRow")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyHealthRowTelemetry: HealthRowTelemetry, @unchecked Sendable {
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
