//
//  Label.Tests.swift
//  TeslaSync — P4 shared surface · 0218 · Label (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in Label.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • LabelModel — the once-only `view.opened` (idempotent + stop/start), the projection derived through
//      the P1/S10 facade, and the props update (reassign-on-change, no spurious invalidation).
//    • Views — the public `FormLabel` surface + the subviews compose in every real branch.
//    • Strings — the `form.required` web key + the empty-leaf a11y copy resolve through the P1/S10 facade
//      with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - LabelModel (lifecycle + derivation)

@MainActor
final class LabelModelTests: XCTestCase {
    private func model(
        _ input: LabelInput,
        telemetry: LabelTelemetry = OSLogLabelTelemetry()
    ) -> LabelModel {
        LabelModel(input: input, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(LabelInput(text: "Email"), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [LabelSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(LabelInput(text: "Email"), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [LabelSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionDerivesFromInput() {
        let holder = model(LabelInput(text: "Email", isRequired: true))
        XCTAssertEqual(holder.projection.displayText, "Email")
        XCTAssertTrue(holder.projection.showsRequiredMarker)
        XCTAssertEqual(holder.projection.accessibilityLabel, "Email required")
    }

    func testProjectionUsesEmptyFallbackForBlankInput() {
        let holder = model(LabelInput(text: ""))
        XCTAssertTrue(holder.projection.isEmpty)
        XCTAssertEqual(holder.projection.displayText, LabelStrings.emptyLabel)
    }

    func testUpdateReplacesInputAndReDerivesProjection() {
        let holder = model(LabelInput(text: "Email"))
        XCTAssertFalse(holder.projection.showsRequiredMarker)
        holder.update(LabelInput(text: "Email", isRequired: true))
        XCTAssertTrue(holder.input.isRequired)
        XCTAssertTrue(holder.projection.showsRequiredMarker)
        XCTAssertEqual(holder.projection.accessibilityLabel, "Email required")
    }

    func testUpdateIsNoOpForUnchangedInput() {
        let holder = model(LabelInput(text: "Email", isRequired: true))
        holder.update(LabelInput(text: "Email", isRequired: true))
        XCTAssertEqual(holder.input, LabelInput(text: "Email", isRequired: true))
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class LabelViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = FormLabel("Email")
        _ = FormLabel("Email", required: true)
        _ = FormLabel("Email", required: true, fieldIdentifier: "email")
        _ = FormLabel("")
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = LabelModel(
            input: LabelInput(text: "Email", isRequired: true),
            telemetry: SpyTelemetry()
        )
        _ = FormLabel(model: injected)
        XCTAssertEqual(FormLabel.surfaceSlug, "Label")
    }

    func testSubviewsCompose() {
        let projection = LabelProjector.resolve(
            input: LabelInput(text: "Email", isRequired: true, fieldIdentifier: "email"),
            requiredWord: "required",
            emptyFallback: "Unlabeled field"
        )
        _ = LabelBody(projection: projection)
        _ = LabelRequiredMarker(glyph: "*")
    }
}

// MARK: - Strings facade (P1/S10)

final class LabelStringsTests: XCTestCase {
    func testWebKeyFallback() {
        XCTAssertEqual(LabelStrings.required, "required")
    }

    func testEmptyLeafFallback() {
        XCTAssertEqual(LabelStrings.emptyLabel, "Unlabeled field")
    }

    func testTableName() {
        XCTAssertEqual(LabelStrings.table, "Label")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: LabelTelemetry, @unchecked Sendable {
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
