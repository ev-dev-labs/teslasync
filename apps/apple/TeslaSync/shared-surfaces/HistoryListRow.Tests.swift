//
//  HistoryListRow.Tests.swift
//  TeslaSync — P4 shared surface · 0091 · HistoryListRow (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value
//  types live in HistoryListRow.AdapterTests.swift; split to keep each file within the SwiftLint
//  file-length budget):
//    • HistoryListRowModel — the once-only `view.opened`, the props update + identical-update guard,
//      the derived projection, and the navigable-vs-inert VoiceOver hint.
//    • HistoryListRowActivation — the kind / href / perform decomposition (web href xor onClick).
//    • Views — the content view + the public surface compose in every branch; the glow → token color
//      projection is distinct + resolvable.
//    • Strings — the native a11y hint resolves through the P1/S10 facade with the expected fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - HistoryListRowModel (surface lifecycle + derivation)

@MainActor
final class HistoryListRowModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyHistoryListRowTelemetry()
        let model = HistoryListRowModel(inputs: HistoryListRowInputs(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [HistoryListRowSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyHistoryListRowTelemetry()
        let model = HistoryListRowModel(inputs: HistoryListRowInputs(), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [HistoryListRowSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInputs() {
        let inputs = HistoryListRowInputs(glow: .green, selected: true, hasLeading: true, actionCount: 2)
        let model = HistoryListRowModel(inputs: inputs)
        XCTAssertEqual(model.projection.glow, .green)
        XCTAssertTrue(model.projection.isSelected)
        XCTAssertTrue(model.projection.showsLeading)
        XCTAssertTrue(model.projection.showsActions)
    }

    func testUpdateChangesProjection() {
        let model = HistoryListRowModel(inputs: HistoryListRowInputs())
        XCTAssertFalse(model.projection.isNavigable)
        model.update(HistoryListRowInputs(activationKind: .link, href: "/drives/9"))
        XCTAssertTrue(model.projection.isNavigable)
        XCTAssertEqual(model.projection.href, "/drives/9")
    }

    func testUpdateWithIdenticalInputsIsNoOp() {
        let inputs = HistoryListRowInputs(hasRoute: true)
        let model = HistoryListRowModel(inputs: inputs)
        model.update(inputs)
        XCTAssertTrue(model.projection.showsRoute)
    }

    func testNavigableRowHasActivateHint() {
        let model = HistoryListRowModel(inputs: HistoryListRowInputs(activationKind: .action))
        XCTAssertEqual(model.accessibilityHint, "Opens details")
    }

    func testInertRowHasNoHint() {
        let model = HistoryListRowModel(inputs: HistoryListRowInputs())
        XCTAssertNil(model.accessibilityHint, "non-navigable rows get no hint")
    }
}

// MARK: - HistoryListRowActivation (web href xor onClick)

@MainActor
final class HistoryListRowActivationTests: XCTestCase {
    func testNoneHasNoKindHrefOrHandler() {
        let activation = HistoryListRowActivation.none
        XCTAssertEqual(activation.kind, .none)
        XCTAssertNil(activation.href)
        XCTAssertNil(activation.perform)
    }

    func testLinkCarriesHrefAndFiringHandler() {
        var fired = false
        let activation = HistoryListRowActivation.link(href: "/drives/7", perform: { fired = true })
        XCTAssertEqual(activation.kind, .link)
        XCTAssertEqual(activation.href, "/drives/7")
        activation.perform?()
        XCTAssertTrue(fired)
    }

    func testActionHasHandlerButNoHref() {
        var fired = false
        let activation = HistoryListRowActivation.action(perform: { fired = true })
        XCTAssertEqual(activation.kind, .action)
        XCTAssertNil(activation.href)
        activation.perform?()
        XCTAssertTrue(fired)
    }
}

// MARK: - Glow → design tokens

@MainActor
final class HistoryListRowGlowColorTests: XCTestCase {
    func testGlowMapsToTokens() {
        XCTAssertEqual(HistoryListRowGlow.cyan.color, Color.TS.accent)
        XCTAssertEqual(HistoryListRowGlow.green.color, Color.TS.statusSuccess)
        XCTAssertEqual(HistoryListRowGlow.purple.color, Color.TS.chartSeriesPower)
    }

    func testNoneHasNoGlow() {
        XCTAssertNil(HistoryListRowGlow.none.color)
    }

    func testColoredGlowsAreDistinct() {
        let colors = [HistoryListRowGlow.cyan, .green, .purple].compactMap(\.color)
        XCTAssertEqual(Set(colors.map { "\($0)" }).count, 3)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class HistoryListRowViewCompositionTests: XCTestCase {
    func testSurfaceComposesForFullRow() {
        _ = HistoryListRow(
            glow: .cyan,
            selected: true,
            activation: .link(href: "/drives/1", perform: {}),
            actions: [AnyView(Button("a") {})],
            primary: { Text(verbatim: "3:45 PM") },
            checkbox: { Image(systemName: "square") },
            leading: { Text(verbatim: "95") },
            route: { Text(verbatim: "Home → Office") },
            metrics: { Text(verbatim: "42 mph") },
            insight: { Text(verbatim: "Low efficiency") }
        )
        XCTAssertEqual(HistoryListRow.surfaceSlug, "HistoryListRow")
    }

    func testSurfaceComposesForMinimalRow() {
        _ = HistoryListRow(primary: { Text(verbatim: "Idle") })
    }

    func testSurfaceComposesForActionAndInert() {
        _ = HistoryListRow(activation: .action(perform: {}), primary: { Text(verbatim: "Tap") })
        _ = HistoryListRow(glow: .none, hideChevron: true, primary: { Text(verbatim: "Inert") })
    }

    func testContentViewComposesForEveryBranch() {
        let bundle = HistoryListRowSlotViews(
            checkbox: AnyView(Image(systemName: "square")),
            leading: AnyView(Text(verbatim: "95")),
            primary: AnyView(Text(verbatim: "3:45 PM")),
            route: AnyView(Text(verbatim: "Home → Office")),
            metrics: AnyView(Text(verbatim: "42 mph")),
            insight: AnyView(Text(verbatim: "Low efficiency")),
            actions: [AnyView(Button("a") {})]
        )
        for kind in HistoryListRowActivationKind.allCases {
            let projection = HistoryListRowProjector.resolve(inputs: HistoryListRowInputs(
                selected: kind == .link,
                activationKind: kind,
                href: kind == .link ? "/d/1" : nil,
                hasCheckbox: true, hasLeading: true, hasRoute: true,
                hasMetrics: true, hasInsight: true, actionCount: 1
            ))
            var activate: (@MainActor () -> Void)?
            if projection.isNavigable {
                activate = {}
            }
            _ = HistoryListRowContentView(
                projection: projection,
                accessibilityHint: projection.isNavigable ? "Opens details" : nil,
                slots: bundle,
                perform: activate
            )
        }
    }
}

// MARK: - Strings facade (P1/S10)

final class HistoryListRowStringsTests: XCTestCase {
    func testActivateHintResolvesToFallback() {
        XCTAssertEqual(HistoryListRowStrings.activateHint, "Opens details")
    }

    func testTableName() {
        XCTAssertEqual(HistoryListRowStrings.table, "HistoryListRow")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyHistoryListRowTelemetry: HistoryListRowTelemetry, @unchecked Sendable {
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
