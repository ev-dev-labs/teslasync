//
//  InlineCallout.Tests.swift
//  TeslaSync — P4 shared surface · 0124 · InlineCallout (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value
//  types live in InlineCallout.AdapterTests.swift; split to keep each file within the SwiftLint
//  file-length budget):
//    • InlineCalloutModel — the once-only `view.opened`, the props update guard, the derived
//      projection, and the forwarded in-app `activate()` (web `action.onClick`).
//    • Views — the container + the public surface compose in every variant / interaction / init branch;
//      the variant → token colour projections resolve.
//    • Strings — the severity words resolve through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - InlineCalloutModel (surface lifecycle + derivation)

@MainActor
final class InlineCalloutModelTests: XCTestCase {
    private func model(
        _ input: InlineCalloutInput,
        onActivate: (@MainActor () -> Void)? = nil,
        telemetry: InlineCalloutTelemetry = OSLogInlineCalloutTelemetry()
    ) -> InlineCalloutModel {
        InlineCalloutModel(input: input, onActivate: onActivate, telemetry: telemetry)
    }

    private func input(
        _ variant: InlineCalloutVariant = .info,
        message: String = "Up to date",
        actionLabel: String? = nil,
        interaction: InlineCalloutInteraction = .status
    ) -> InlineCalloutInput {
        InlineCalloutInput(variant: variant, message: message, actionLabel: actionLabel, interaction: interaction)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyInlineCalloutTelemetry()
        let callout = model(input(), telemetry: spy)
        callout.start()
        callout.start()
        XCTAssertEqual(spy.surfaces, [InlineCalloutSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyInlineCalloutTelemetry()
        let callout = model(input(), telemetry: spy)
        callout.start()
        callout.stop()
        callout.start()
        XCTAssertEqual(spy.surfaces, [InlineCalloutSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInput() {
        let callout = model(input(.warning, message: "1 anomaly", actionLabel: "View", interaction: .button))
        XCTAssertEqual(callout.projection.variant, .warning)
        XCTAssertEqual(callout.projection.trailingLabel, "View")
        XCTAssertEqual(callout.projection.accessibilityLabel, "Warning: 1 anomaly, View")
        XCTAssertTrue(callout.projection.isInteractive)
    }

    func testUpdateChangesProjectionAndGuardsIdentical() {
        let initial = input(.info, message: "A")
        let callout = model(initial)
        callout.update(initial)
        XCTAssertEqual(callout.projection.message, "A")
        callout.update(input(.danger, message: "B"))
        XCTAssertEqual(callout.projection.variant, .danger)
        XCTAssertEqual(callout.projection.message, "B")
    }

    func testActivateForwardsToHandler() {
        let counter = ActivationCounter()
        let callout = model(input(interaction: .button), onActivate: { counter.bump() })
        callout.activate()
        callout.activate()
        XCTAssertEqual(counter.count, 2)
    }

    func testActivateIsNoOpWithoutHandler() {
        let callout = model(input())
        callout.activate()
        XCTAssertNil(callout.onActivate)
    }
}

// MARK: - Views (every branch composes + token projections)

@MainActor
final class InlineCalloutViewTests: XCTestCase {
    private let url = URL(string: "https://teslasync.local/drives")!

    func testSurfaceComposesForEveryVariantAndInteraction() {
        _ = InlineCallout(.info, message: "Up to date", icon: "info.circle.fill")
        _ = InlineCallout(.success, message: "Synced")
        _ = InlineCallout(
            .warning,
            message: "1 anomaly",
            icon: "exclamationmark.triangle.fill",
            action: .link("View", url: url)
        )
        _ = InlineCallout(.danger, message: "Offline", action: .button("Fix") {})
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = InlineCalloutModel(
            input: InlineCalloutInput(variant: .info, message: "Up to date"),
            telemetry: SpyInlineCalloutTelemetry()
        )
        _ = InlineCallout(model: injected)
        XCTAssertEqual(InlineCallout.surfaceSlug, "InlineCallout")
    }

    func testContainerComposesForEveryInteraction() {
        let interactions: [InlineCalloutInteraction] = [.status, .link(url), .button]
        for interaction in interactions {
            _ = InlineCalloutContainer(
                variant: .info,
                iconSystemName: "info.circle.fill",
                trailingLabel: "View",
                interaction: interaction,
                accessibilityLabel: "Info: hello, View",
                onActivate: {},
                content: { Text(verbatim: "hello") }
            )
        }
    }

    func testVariantTintProjections() {
        XCTAssertEqual(InlineCalloutVariant.info.tint, Color.TS.statusInfo)
        XCTAssertEqual(InlineCalloutVariant.success.tint, Color.TS.statusSuccess)
        XCTAssertEqual(InlineCalloutVariant.warning.tint, Color.TS.statusWarning)
        XCTAssertEqual(InlineCalloutVariant.danger.tint, Color.TS.statusDanger)
    }

    func testVariantBodyColorProjections() {
        XCTAssertEqual(InlineCalloutVariant.info.bodyColor, Color.TS.textSecondary)
        XCTAssertEqual(InlineCalloutVariant.success.bodyColor, Color.TS.textSecondary)
        XCTAssertEqual(InlineCalloutVariant.warning.bodyColor, Color.TS.statusWarning)
        XCTAssertEqual(InlineCalloutVariant.danger.bodyColor, Color.TS.statusDanger)
    }
}

// MARK: - Strings facade (P1/S10)

final class InlineCalloutStringsTests: XCTestCase {
    func testSeverityFallbacks() {
        XCTAssertEqual(InlineCalloutStrings.severity(for: .info), "Info")
        XCTAssertEqual(InlineCalloutStrings.severity(for: .success), "Success")
        XCTAssertEqual(InlineCalloutStrings.severity(for: .warning), "Warning")
        XCTAssertEqual(InlineCalloutStrings.severity(for: .danger), "Danger")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyInlineCalloutTelemetry: InlineCalloutTelemetry, @unchecked Sendable {
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
