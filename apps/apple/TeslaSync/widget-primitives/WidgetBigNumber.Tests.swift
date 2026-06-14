//
//  WidgetBigNumber.Tests.swift
//  TeslaSync — P4 widget primitive · 0001 · WidgetBigNumber (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in WidgetBigNumber.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • WidgetBigNumberModel — the once-only `view.opened`, the props `update` re-derivation (null value →
//      value), and the projection reflecting the resolved value slot.
//    • Views — the public surface + the subviews compose in every real branch (animated / static /
//      null value, with and without chrome), via both the prop initializer and the injected-model seam.
//    • Strings — the value-with-unit join + the combined a11y reading resolve through the P1/S10 facade.
//    • Tone mapping — the badge variant resolves to the shared ``TSTone`` (web `badgeVariantMap`).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static let locale = Locale(identifier: "en_US")

    static func input(
        value: Double?,
        unit: String? = nil,
        label: String? = nil,
        animated: Bool = true
    ) -> WidgetBigNumberInput {
        WidgetBigNumberInput(value: value, unit: unit, label: label, animated: animated, locale: locale)
    }
}

// MARK: - WidgetBigNumberModel (telemetry + derivation)

@MainActor
final class WidgetBigNumberModelTests: XCTestCase {
    private func model(
        _ input: WidgetBigNumberInput,
        telemetry: WidgetBigNumberTelemetry = OSLogWidgetBigNumberTelemetry()
    ) -> WidgetBigNumberModel {
        WidgetBigNumberModel(input: input, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.input(value: 1), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetBigNumberSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.input(value: 1), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetBigNumberSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsAnimatedValueBranch() {
        let holder = model(Fixture.input(value: 1420, animated: true))
        XCTAssertEqual(
            holder.projection.value,
            .animated(raw: 1420, settled: "1,420", tone: .primary, locale: Fixture.locale)
        )
    }

    func testProjectionReflectsNullValueBranch() {
        let holder = model(Fixture.input(value: nil))
        XCTAssertEqual(holder.projection.value, .nullDisplay(text: "—"))
    }

    func testUpdateReDerivesProjectionFromNullToValue() {
        let holder = model(Fixture.input(value: nil))
        XCTAssertEqual(holder.projection.value, .nullDisplay(text: "—"))
        holder.update(Fixture.input(value: 42, animated: false))
        XCTAssertEqual(holder.projection.value, .staticValue(text: "42", tone: .primary))
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class WidgetBigNumberViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = WidgetBigNumber(value: 1420, unit: "mi", label: "Range", locale: Fixture.locale)
        _ = WidgetBigNumber(value: 87, unit: "%", animated: false, locale: Fixture.locale)
        _ = WidgetBigNumber(value: nil, label: "Energy", locale: Fixture.locale)
        _ = WidgetBigNumber(
            value: 5,
            badge: BigNumberBadge(text: "Optimal", variant: .success),
            locale: Fixture.locale
        )
        _ = WidgetBigNumber(value: 42, locale: Fixture.locale)
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = WidgetBigNumberModel(input: Fixture.input(value: 1), telemetry: SpyTelemetry())
        _ = WidgetBigNumber(model: injected)
        XCTAssertEqual(WidgetBigNumber.surfaceSlug, "WidgetBigNumber")
    }

    func testSubviewsComposeInEveryBranch() {
        let projection = WidgetBigNumberProjector.resolve(
            WidgetBigNumberInput(
                value: 1420,
                unit: "mi",
                label: "Range",
                subtitle: "EPA",
                badge: BigNumberBadge(text: "Optimal", variant: .success),
                locale: Fixture.locale
            )
        )
        _ = BigNumberStack(projection: projection)
        _ = BigNumberValueLine(value: projection.value, unit: projection.unit)
        _ = BigNumberValueView(display: .animated(raw: 1, settled: "1", tone: .primary, locale: Fixture.locale))
        _ = BigNumberValueView(display: .staticValue(text: "2", tone: .success))
        _ = BigNumberValueView(display: .nullDisplay(text: "—"))
        _ = BigNumberBadgeView(badge: BigNumberBadge(text: "Optimal", variant: .neutral))
    }
}

// MARK: - Tone mapping (web `badgeVariantMap`)

final class WidgetBigNumberToneTests: XCTestCase {
    private func name(_ tone: TSTone) -> String {
        switch tone {
        case .neutral: "neutral"
        case .accent: "accent"
        case .success: "success"
        case .warning: "warning"
        case .danger: "danger"
        case .info: "info"
        }
    }

    func testBadgeVariantMapsToSharedTone() {
        XCTAssertEqual(name(BigNumberBadgeVariant.success.tone), "success")
        XCTAssertEqual(name(BigNumberBadgeVariant.warning.tone), "warning")
        XCTAssertEqual(name(BigNumberBadgeVariant.error.tone), "danger", "web badgeVariantMap maps error → danger")
        XCTAssertEqual(name(BigNumberBadgeVariant.neutral.tone), "neutral")
    }
}

// MARK: - Strings facade (P1/S10)

final class WidgetBigNumberStringsTests: XCTestCase {
    func testValueWithUnitJoinsWhenPresentAndOmitsWhenAbsent() {
        XCTAssertEqual(WidgetBigNumberStrings.valueWithUnit(value: "1,420", unit: "mi"), "1,420 mi")
        XCTAssertEqual(WidgetBigNumberStrings.valueWithUnit(value: "42", unit: nil), "42")
        XCTAssertEqual(WidgetBigNumberStrings.valueWithUnit(value: "42", unit: ""), "42")
    }

    func testAccessibilityLabelComposesPresentParts() {
        let reading = WidgetBigNumberStrings.accessibilityLabel(
            value: "1,420",
            unit: "mi",
            label: "Range",
            subtitle: "EPA estimate",
            badge: "Optimal"
        )
        XCTAssertEqual(reading, "1,420 mi, Range, EPA estimate, Optimal")
    }

    func testAccessibilityLabelSkipsAbsentAndEmptyParts() {
        let reading = WidgetBigNumberStrings.accessibilityLabel(
            value: "—",
            unit: nil,
            label: "",
            subtitle: nil,
            badge: nil
        )
        XCTAssertEqual(reading, "—")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: WidgetBigNumberTelemetry, @unchecked Sendable {
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
