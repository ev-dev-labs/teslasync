//
//  DraftRestorePrompt.Tests.swift
//  TeslaSync — P4 shared surface · 0117 · DraftRestorePrompt (Apple)
//
//  Adapter + projection coverage for the DraftRestorePrompt surface:
//    • DraftEntry — the `label || fallback` display label (web row label).
//    • DraftIndex — the web reducers: the mount-time `surfaced` filter (active-key exclusion + de-dupe),
//      per-row `removing`, the `subscribeDraftIndex` `reconcile`, and snapshot `normalize`.
//    • Relative time — the verbatim port of the web `formatRelativeTime` buckets (just now / m / h /
//      absolute), driven by a fixed `now` so every boundary is asserted.
//    • Interpolation — the i18next `{{token}}` substitution (tight + spaced).
//    • Prompt body — the count-pluralised `_one` / `_other` selection + `{{count}}` substitution.
//    • Saved-at — the "Saved {{when}}" composition.
//    • Resume route — the `entry.route` "/" fallback.
//    • Accessibility — the composed status label + the per-row action label.
//    • Projection — every render branch across loading / empty / loaded / failed, the active-key filter,
//      and cached drafts surviving a transient failure (the P4 leaf contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private let identity: DraftRestoreResolve = { _, fallback in fallback }

private func entry(
    _ key: String,
    label: String = "Draft",
    route: String = "/x",
    savedAt: Date = Date(timeIntervalSince1970: 1_000_000)
) -> DraftEntry {
    DraftEntry(storageKey: key, label: label, route: route, savedAt: savedAt)
}

// MARK: - DraftEntry

final class DraftEntryTests: XCTestCase {
    func testDisplayLabelUsesProvidedLabel() {
        XCTAssertEqual(entry("a", label: "Alert rule").displayLabel(identity), "Alert rule")
    }

    func testDisplayLabelFallsBackWhenEmptyOrBlank() {
        XCTAssertEqual(entry("a", label: "").displayLabel(identity), "Unsaved draft")
        XCTAssertEqual(entry("a", label: "   ").displayLabel(identity), "Unsaved draft")
        XCTAssertEqual(DraftRestoreConstants.fallbackLabel, "Unsaved draft")
    }

    func testIDIsTheStorageKey() {
        XCTAssertEqual(entry("teslasync:draft:v1:x").id, "teslasync:draft:v1:x")
    }
}

// MARK: - DraftIndex reducers

final class DraftIndexTests: XCTestCase {
    func testSurfacedExcludesActivelyEditedKeys() {
        let surfaced = DraftIndex.surfaced(
            all: [entry("a"), entry("b"), entry("c")],
            activeKeys: ["b"]
        )
        XCTAssertEqual(surfaced.map(\.storageKey), ["a", "c"])
    }

    func testSurfacedDeDupesByKeyPreservingOrder() {
        let surfaced = DraftIndex.surfaced(all: [entry("a"), entry("b"), entry("a")], activeKeys: [])
        XCTAssertEqual(surfaced.map(\.storageKey), ["a", "b"])
    }

    func testSurfacedEmptyWhenAllActive() {
        XCTAssertTrue(DraftIndex.surfaced(all: [entry("a")], activeKeys: ["a"]).isEmpty)
    }

    func testRemovingDropsOnlyTheMatchingKey() {
        let next = DraftIndex.removing(storageKey: "a", from: [entry("a"), entry("b")])
        XCTAssertEqual(next.map(\.storageKey), ["b"])
    }

    func testReconcileDropsVanishedRowsKeepingOrder() {
        let previous = [entry("a"), entry("b"), entry("c")]
        let fresh = [entry("c"), entry("a")] // b discarded elsewhere; order differs
        let next = DraftIndex.reconcile(previous: previous, fresh: fresh)
        XCTAssertEqual(next.map(\.storageKey), ["a", "c"]) // keeps on-screen order, drops b
    }

    func testReconcileUsesFreshCopyOfStillPresentRow() {
        let previous = [entry("a", label: "Old")]
        let fresh = [entry("a", label: "New")]
        XCTAssertEqual(DraftIndex.reconcile(previous: previous, fresh: fresh).first?.label, "New")
    }

    func testNormalizeDeDupes() {
        XCTAssertEqual(
            DraftIndex.normalize([entry("a"), entry("a"), entry("b")]).map(\.storageKey),
            ["a", "b"]
        )
    }
}

// MARK: - Relative time (web `formatRelativeTime`)

final class DraftRestoreRelativeTimeTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func string(secondsAgo: TimeInterval) -> String {
        DraftRestoreRelativeTime.string(
            for: now.addingTimeInterval(-secondsAgo),
            now: now,
            resolve: identity,
            locale: Locale(identifier: "en_US"),
            timeZone: TimeZone(identifier: "UTC") ?? .current
        )
    }

    func testUnderAMinuteIsJustNow() {
        XCTAssertEqual(string(secondsAgo: 30), "Just now")
    }

    func testUnderAnHourIsMinutesAgo() {
        XCTAssertEqual(string(secondsAgo: 5 * 60), "5m ago")
        XCTAssertEqual(string(secondsAgo: 59 * 60), "59m ago")
    }

    func testUnderADayIsHoursAgo() {
        XCTAssertEqual(string(secondsAgo: 60 * 60), "1h ago")
        XCTAssertEqual(string(secondsAgo: 3 * 60 * 60), "3h ago")
        XCTAssertEqual(string(secondsAgo: 23 * 60 * 60), "23h ago")
    }

    func testADayOrMoreIsAbsoluteDate() {
        let absolute = string(secondsAgo: 48 * 60 * 60)
        XCTAssertFalse(absolute.contains("ago"))
        XCTAssertNotEqual(absolute, "Just now")
        XCTAssertFalse(absolute.isEmpty)
    }
}

// MARK: - Interpolation / body / saved-at / route

final class DraftRestoreFormattingTests: XCTestCase {
    func testInterpolationSubstitutesTightAndSpacedTokens() {
        XCTAssertEqual(
            DraftRestoreInterpolation.substitute("a {{count}} b", token: "count", value: "3"),
            "a 3 b"
        )
        XCTAssertEqual(
            DraftRestoreInterpolation.substitute("a {{ count }} b", token: "count", value: "3"),
            "a 3 b"
        )
    }

    func testPromptBodySelectsSingularForOne() {
        XCTAssertEqual(
            DraftRestorePromptBody.text(count: 1, resolve: identity),
            "You have 1 unsaved draft from a previous session."
        )
    }

    func testPromptBodySelectsPluralOtherwise() {
        XCTAssertEqual(
            DraftRestorePromptBody.text(count: 3, resolve: identity),
            "You have 3 unsaved drafts from a previous session."
        )
        XCTAssertTrue(DraftRestorePromptBody.text(count: 0, resolve: identity).contains("drafts"))
    }

    func testSavedAtComposesRelativeWhen() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let text = DraftRestoreSavedAt.text(
            for: now.addingTimeInterval(-5 * 60),
            now: now,
            resolve: identity
        )
        XCTAssertEqual(text, "Saved 5m ago")
    }

    func testResumeRouteFallsBackToRoot() {
        XCTAssertEqual(DraftRestoreResumeRoute.normalize("/settings"), "/settings")
        XCTAssertEqual(DraftRestoreResumeRoute.normalize(""), "/")
        XCTAssertEqual(DraftRestoreResumeRoute.normalize("   "), "/")
        XCTAssertEqual(DraftRestoreResumeRoute.normalize(for: entry("a", route: "")), "/")
        XCTAssertEqual(DraftRestoreConstants.fallbackRoute, "/")
    }
}

// MARK: - Accessibility

final class DraftRestoreAccessibilityTests: XCTestCase {
    func testPromptLabelJoinsTitleAndBody() {
        let label = DraftRestoreAccessibility.promptLabel(
            title: "Unsaved drafts restored",
            body: "You have 2 unsaved drafts from a previous session."
        )
        XCTAssertEqual(
            label,
            "Unsaved drafts restored. You have 2 unsaved drafts from a previous session."
        )
    }

    func testPromptLabelDoesNotDoubleTerminalPunctuation() {
        let label = DraftRestoreAccessibility.promptLabel(title: "Saved.", body: "Body")
        XCTAssertEqual(label, "Saved. Body")
    }

    func testActionLabelNamesTheDraft() {
        XCTAssertEqual(
            DraftRestoreAccessibility.actionLabel(action: "Resume", label: "Alert rule draft"),
            "Resume Alert rule draft"
        )
    }

    func testActionLabelFallsBackToBareActionWhenUnlabelled() {
        XCTAssertEqual(DraftRestoreAccessibility.actionLabel(action: "Discard", label: "  "), "Discard")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class DraftRestoreProjectionTests: XCTestCase {
    func testLoadingWithNoDraftsIsLoading() {
        let resolved = DraftRestoreProjection.resolve(status: .loading, drafts: [], activeKeys: [])
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.drafts.isEmpty)
    }

    func testLoadingWithCachedDraftsShowsData() {
        let resolved = DraftRestoreProjection.resolve(status: .loading, drafts: [entry("a")], activeKeys: [])
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.drafts.map(\.storageKey), ["a"])
    }

    func testEmptyStatusIsEmpty() {
        XCTAssertEqual(
            DraftRestoreProjection.resolve(status: .empty, drafts: [], activeKeys: []).phase,
            .empty
        )
    }

    func testLoadedWithNoSurfacedDraftsIsEmpty() {
        // The only draft is being actively edited elsewhere → filtered out → empty.
        let resolved = DraftRestoreProjection.resolve(status: .loaded, drafts: [entry("a")], activeKeys: ["a"])
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testLoadedWithSurfacedDraftsIsData() {
        let resolved = DraftRestoreProjection.resolve(
            status: .loaded, drafts: [entry("a"), entry("b")], activeKeys: ["b"]
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.drafts.map(\.storageKey), ["a"])
    }

    func testFailedWithNoDraftsIsError() {
        let resolved = DraftRestoreProjection.resolve(status: .failed("boom"), drafts: [], activeKeys: [])
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testFailedWithCachedDraftsKeepsShowingData() {
        let resolved = DraftRestoreProjection.resolve(
            status: .failed("boom"), drafts: [entry("a")], activeKeys: [], connection: .offline
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.drafts.map(\.storageKey), ["a"])
    }

    func testProjectionDeDupesDuplicateDrafts() {
        let resolved = DraftRestoreProjection.resolve(
            status: .loaded, drafts: [entry("a"), entry("a")], activeKeys: []
        )
        XCTAssertEqual(resolved.drafts.map(\.storageKey), ["a"])
    }
}
