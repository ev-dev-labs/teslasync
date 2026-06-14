//
//  ReleaseNotes.Tests.swift
//  TeslaSync — P4 shared surface · 0135 · ReleaseNotes (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in ReleaseNotes.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • ReleaseNotesModel — the once-only `view.opened`, the `expandedVersion` seeding from the first
//      visible release, the single-open toggle (opening one closes the previous), and the props update
//      (re-derive + keep-valid-selection / reset-when-missing / no-op-when-unchanged).
//    • ReleaseNotesMotion — the toggle animation is nil under reduced motion and present otherwise.
//    • Palette + Views — the token map and the public surface + subviews compose in every real branch.
//    • Strings — the web `t()` keys + the a11y copy resolve through the P1/S10 facade with the fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func entry(_ version: String, badge: ReleaseNotesBadge = .stable) -> ReleaseNotesEntry {
        ReleaseNotesEntry(
            version: version,
            date: "2026-03-29",
            badge: badge,
            changes: [ReleaseNotesChange(type: .added, text: "x")]
        )
    }

    static let three: [ReleaseNotesEntry] = [entry("0.7.0", badge: .latest), entry("0.6.0"), entry("0.5.0")]

    static func input(_ entries: [ReleaseNotesEntry] = three, limit: Int = 3) -> ReleaseNotesInput {
        ReleaseNotesInput(entries: entries, limit: limit)
    }
}

// MARK: - ReleaseNotesModel (interaction state + routing)

@MainActor
final class ReleaseNotesModelTests: XCTestCase {
    private func model(
        _ input: ReleaseNotesInput = Fixture.input(),
        telemetry: ReleaseNotesTelemetry = OSLogReleaseNotesTelemetry()
    ) -> ReleaseNotesModel {
        ReleaseNotesModel(input: input, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [ReleaseNotesSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [ReleaseNotesSurface.slug], "view.opened fires once per instance")
    }

    func testSeedsExpandedToFirstVisibleRelease() {
        XCTAssertEqual(model().expandedVersion, "0.7.0")
    }

    func testSeedIsNilWhenNothingVisible() {
        XCTAssertNil(model(Fixture.input(limit: 0)).expandedVersion)
        XCTAssertNil(model(Fixture.input([], limit: 3)).expandedVersion)
    }

    func testToggleIsSingleOpen() {
        let holder = model()
        XCTAssertEqual(holder.expandedVersion, "0.7.0")
        holder.toggle(version: "0.6.0")
        XCTAssertEqual(holder.expandedVersion, "0.6.0", "opening one collapses the previous (single-open)")
        XCTAssertEqual(holder.projection.cards.filter(\.isExpanded).map(\.version), ["0.6.0"])
    }

    func testTogglingOpenCardCollapsesIt() {
        let holder = model()
        holder.toggle(version: "0.7.0")
        XCTAssertNil(holder.expandedVersion)
        XCTAssertTrue(holder.projection.cards.allSatisfy { !$0.isExpanded })
    }

    func testUpdateUnchangedInputIsNoOp() {
        let holder = model()
        holder.toggle(version: "0.6.0")
        holder.update(Fixture.input())
        XCTAssertEqual(holder.expandedVersion, "0.6.0", "an unchanged re-render keeps the selection")
    }

    func testUpdateKeepsSelectionWhenStillVisible() {
        let holder = model()
        holder.toggle(version: "0.6.0")
        holder.update(Fixture.input(limit: 2)) // 0.7.0 + 0.6.0 still visible
        XCTAssertEqual(holder.expandedVersion, "0.6.0")
    }

    func testUpdateResetsSelectionWhenNoLongerVisible() {
        let holder = model()
        holder.toggle(version: "0.6.0")
        holder.update(Fixture.input(limit: 1)) // only 0.7.0 visible now
        XCTAssertEqual(holder.expandedVersion, "0.7.0", "a missing selection falls back to the first release")
    }

    func testUpdateResetsToNilWhenNothingVisible() {
        let holder = model()
        holder.update(Fixture.input(limit: 0))
        XCTAssertNil(holder.expandedVersion)
        XCTAssertTrue(holder.projection.isEmpty)
    }
}

// MARK: - ReleaseNotesMotion (toggle animation honors Reduce Motion)

final class ReleaseNotesMotionTests: XCTestCase {
    func testToggleAnimationNilUnderReducedMotion() {
        XCTAssertNil(ReleaseNotesMotion.toggle(reduce: true))
    }

    func testToggleAnimationPresentWhenMotionAllowed() {
        XCTAssertNotNil(ReleaseNotesMotion.toggle(reduce: false))
    }
}

// MARK: - Palette (web tint maps)

final class ReleaseNotesPaletteTests: XCTestCase {
    func testBadgeAndChangeTintsResolveForEveryCase() {
        for badge in ReleaseNotesBadge.allCases {
            _ = ReleaseNotesPalette.badge(badge)
        }
        for type in ReleaseNotesChangeType.allCases {
            _ = ReleaseNotesPalette.change(type)
        }
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class ReleaseNotesViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = ReleaseNotes()
        _ = ReleaseNotes(entries: Fixture.three, limit: 2)
        _ = ReleaseNotes(entries: [], limit: 3) // empty state
        _ = ReleaseNotes(
            entries: [Fixture.entry("0.2.0")],
            limit: 3,
            telemetry: SpyTelemetry()
        )
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = ReleaseNotesModel(input: Fixture.input(), telemetry: SpyTelemetry())
        _ = ReleaseNotes(model: injected)
        XCTAssertEqual(ReleaseNotes.surfaceSlug, "ReleaseNotes")
    }

    func testSubviewsCompose() {
        let card = ReleaseNotesProjector.card(Fixture.entry("0.7.0", badge: .latest), isExpanded: true)
        _ = ReleaseCard(card: card, onToggle: {}, reduceMotion: false)
        _ = ReleaseBadgeChip(badge: .latest)
        _ = ReleaseChangeRow(row: ReleaseNotesChangeRow(id: 0, type: .security, text: "x"))
        _ = ReleaseNotesEmptyChanges()
        _ = ReleaseNotesEmptyState()
    }
}

// MARK: - Strings facade (P1/S10)

final class ReleaseNotesStringsTests: XCTestCase {
    func testWebKeyFallbacks() {
        XCTAssertEqual(ReleaseNotesStrings.heading, "What's New")
        XCTAssertEqual(ReleaseNotesStrings.badgeLabel(.latest), "Latest")
        XCTAssertEqual(ReleaseNotesStrings.badgeLabel(.stable), "Stable")
        XCTAssertEqual(ReleaseNotesStrings.badgeLabel(.beta), "Beta")
    }

    func testChangeTypeLabelFallbacks() {
        XCTAssertEqual(ReleaseNotesStrings.changeTypeLabel(.added), "Added")
        XCTAssertEqual(ReleaseNotesStrings.changeTypeLabel(.deprecated), "Deprecated")
        XCTAssertEqual(ReleaseNotesStrings.changeTypeLabel(.security), "Security")
    }

    func testA11yAndEmptyFallbacks() {
        XCTAssertEqual(ReleaseNotesStrings.expandHint, "Show release notes")
        XCTAssertEqual(ReleaseNotesStrings.collapseHint, "Hide release notes")
        XCTAssertEqual(ReleaseNotesStrings.expandedValue, "Expanded")
        XCTAssertEqual(ReleaseNotesStrings.collapsedValue, "Collapsed")
        XCTAssertEqual(ReleaseNotesStrings.emptyTitle, "No release notes yet")
        XCTAssertEqual(ReleaseNotesStrings.emptyChangesTitle, "No changes recorded")
    }

    func testToggleHintAndStateValueTrackExpandedState() {
        XCTAssertEqual(ReleaseNotesStrings.toggleHint(isExpanded: true), "Hide release notes")
        XCTAssertEqual(ReleaseNotesStrings.toggleHint(isExpanded: false), "Show release notes")
        XCTAssertEqual(ReleaseNotesStrings.stateValue(isExpanded: true), "Expanded")
        XCTAssertEqual(ReleaseNotesStrings.stateValue(isExpanded: false), "Collapsed")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: ReleaseNotesTelemetry, @unchecked Sendable {
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
