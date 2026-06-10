//
//  TourLauncher.Tests.swift
//  TeslaSync — P4 misc surface · 0001 · TourLauncher (Apple)
//
//  Adapter + projection + accessibility coverage for the TourLauncher surface:
//    • `TourRouteMatch` — the verbatim port of `isRecommendedForRoute` (string-prefix + RegExp).
//    • `TourCatalog` — the eight registry entries in `TOUR_ORDER` with their exact keys/versions.
//    • `TourLauncherProjection` — phase resolution + the per-row projection (completed +
//      recommended flags, localized strings, resolved Start / Replay action).
//    • `TourLauncherAccessibility` — the launcher summary + row + action VoiceOver content.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy
/// without a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Route match (web isRecommendedForRoute)

final class TourRouteMatchTests: XCTestCase {
    func testRootPrefixMatchesOnlyExactRoot() {
        let match = TourRouteMatch.prefix("/")
        XCTAssertTrue(match.matches(pathname: "/"))
        XCTAssertFalse(match.matches(pathname: "/vehicles"))
    }

    func testStringPrefixMatchesExactOrSlashChild() {
        let match = TourRouteMatch.prefix("/vehicles")
        XCTAssertTrue(match.matches(pathname: "/vehicles"))
        XCTAssertTrue(match.matches(pathname: "/vehicles/42"))
        // Not a prefix boundary: "/vehiclesXYZ" must not match (web startsWith(`${route}/`)).
        XCTAssertFalse(match.matches(pathname: "/vehiclesXYZ"))
    }

    func testAnchoredRegexMatchesFromStart() {
        let charging = TourRouteMatch.regex("^/(charging|cost-analysis|charging-curve|smart-charge)")
        XCTAssertTrue(charging.matches(pathname: "/charging"))
        XCTAssertTrue(charging.matches(pathname: "/cost-analysis"))
        XCTAssertTrue(charging.matches(pathname: "/smart-charge"))
        XCTAssertFalse(charging.matches(pathname: "/settings"))
    }

    func testNotificationsAlternationRegex() {
        let alerts = TourRouteMatch.regex("^/notifications/(alerts|studio)")
        XCTAssertTrue(alerts.matches(pathname: "/notifications/alerts"))
        XCTAssertTrue(alerts.matches(pathname: "/notifications/studio"))
        XCTAssertFalse(alerts.matches(pathname: "/notifications/logs"))
    }

    func testInvalidRegexNeverRecommends() {
        XCTAssertFalse(TourRouteMatch.regex("^/(").matches(pathname: "/anything"))
    }
}

// MARK: - Catalog (web TOURS + TOUR_ORDER)

final class TourCatalogTests: XCTestCase {
    func testCatalogOrderMatchesWebTourOrder() {
        XCTAssertEqual(
            TourCatalog.all.map(\.id),
            ["main", "vehicles", "drives", "charging", "alerts", "automations", "settings", "debugger"]
        )
    }

    func testCatalogVersionsMatchRegistry() {
        let versions = Dictionary(uniqueKeysWithValues: TourCatalog.all.map { ($0.id, $0.version) })
        XCTAssertEqual(versions["main"], 2)
        XCTAssertEqual(versions["vehicles"], 1)
        XCTAssertEqual(versions["debugger"], 1)
    }

    func testEveryEntryCarriesTitleAndDescriptionKeys() {
        for entry in TourCatalog.all {
            XCTAssertEqual(entry.titleKey, "tour.tours.\(entry.id).title")
            XCTAssertEqual(entry.descriptionKey, "tour.tours.\(entry.id).description")
            XCTAssertFalse(entry.titleFallback.isEmpty)
            XCTAssertFalse(entry.descriptionFallback.isEmpty)
        }
    }

    func testMainTourIsRecommendedOnlyOnRoot() {
        let main = TourCatalog.all[0]
        XCTAssertTrue(main.routeMatch.matches(pathname: "/"))
        XCTAssertFalse(main.routeMatch.matches(pathname: "/drives"))
    }
}

// MARK: - Projection: phase resolution

final class TourLauncherPhaseTests: XCTestCase {
    func testLoadingResolvesByTourPresence() {
        XCTAssertEqual(TourLauncherProjection.resolvePhase(status: .loading, tourCount: 0), .loading)
        XCTAssertEqual(TourLauncherProjection.resolvePhase(status: .loading, tourCount: 8), .content)
    }

    func testLoadedResolvesEmptyOrContent() {
        XCTAssertEqual(TourLauncherProjection.resolvePhase(status: .loaded, tourCount: 0), .empty)
        XCTAssertEqual(TourLauncherProjection.resolvePhase(status: .loaded, tourCount: 8), .content)
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(TourLauncherProjection.resolvePhase(status: .failed("boom"), tourCount: 0), .error("boom"))
        XCTAssertEqual(TourLauncherProjection.resolvePhase(status: .failed("boom"), tourCount: 8), .content)
    }
}

// MARK: - Projection: per-row

final class TourLauncherRowProjectionTests: XCTestCase {
    private var vehicles: TourCatalogEntry {
        TourCatalog.all.first { $0.id == "vehicles" }!
    }

    func testRowResolvesCompletedRecommendedAndReplayAction() {
        let row = TourLauncherProjection.row(
            entry: vehicles,
            completedIDs: ["vehicles"],
            pathname: "/vehicles/7",
            localize: passthroughLocalize
        )
        XCTAssertEqual(row.id, "vehicles")
        XCTAssertEqual(row.title, "Vehicles & sharing")
        XCTAssertEqual(row.description, "Browse fleet, open a vehicle, share access.")
        XCTAssertTrue(row.completed)
        XCTAssertTrue(row.recommended)
        XCTAssertEqual(row.action, .replay)
    }

    func testRowResolvesIncompleteAndStartActionOffRoute() {
        let row = TourLauncherProjection.row(
            entry: vehicles,
            completedIDs: [],
            pathname: "/dashboard",
            localize: passthroughLocalize
        )
        XCTAssertFalse(row.completed)
        XCTAssertFalse(row.recommended)
        XCTAssertEqual(row.action, .start)
    }

    func testRowsPreserveCatalogOrderAndApplyCompletion() {
        let rows = TourLauncherProjection.rows(
            entries: TourCatalog.all,
            completedIDs: ["drives", "settings"],
            pathname: "/drives",
            localize: passthroughLocalize
        )
        XCTAssertEqual(rows.map(\.id), TourCatalog.all.map(\.id))
        XCTAssertEqual(rows.filter(\.completed).map(\.id).sorted(), ["drives", "settings"])
        XCTAssertEqual(rows.filter(\.recommended).map(\.id), ["drives"])
    }
}

// MARK: - Action kind (web Start / Replay)

final class TourActionKindTests: XCTestCase {
    func testStartKeysAndFallbacks() {
        XCTAssertEqual(TourActionKind.start.titleKey, "tour.launcher.start")
        XCTAssertEqual(TourActionKind.start.titleFallback, "Start")
        XCTAssertEqual(TourActionKind.start.accessibilityKey, "tour.launcher.startAria")
        XCTAssertEqual(TourActionKind.start.accessibilityFallback, "Start tour: {{0}}")
    }

    func testReplayKeysAndFallbacks() {
        XCTAssertEqual(TourActionKind.replay.titleKey, "tour.launcher.replay")
        XCTAssertEqual(TourActionKind.replay.titleFallback, "Replay")
        XCTAssertEqual(TourActionKind.replay.accessibilityKey, "tour.launcher.replayAria")
        XCTAssertEqual(TourActionKind.replay.accessibilityFallback, "Replay tour: {{0}}")
    }
}

// MARK: - Accessibility

final class TourLauncherAccessibilityTests: XCTestCase {
    private func row(completed: Bool, recommended: Bool, action: TourActionKind) -> TourRow {
        TourRow(
            id: "vehicles",
            title: "Vehicles & sharing",
            description: "Browse fleet, open a vehicle, share access.",
            completed: completed,
            recommended: recommended,
            action: action
        )
    }

    func testSummary() {
        XCTAssertEqual(
            TourLauncherAccessibility.summary(count: 8, localize: passthroughLocalize),
            "Take a tour: 8"
        )
    }

    func testRowLabelIncludesStatusAndDescription() {
        let label = TourLauncherAccessibility.rowLabel(
            row(completed: true, recommended: true, action: .replay),
            localize: passthroughLocalize
        )
        XCTAssertTrue(label.contains("Vehicles & sharing"))
        XCTAssertTrue(label.contains("Recommended for this page"))
        XCTAssertTrue(label.contains("Completed"))
        XCTAssertTrue(label.contains("Browse fleet, open a vehicle, share access."))
    }

    func testRowLabelOmitsAbsentStatus() {
        let label = TourLauncherAccessibility.rowLabel(
            row(completed: false, recommended: false, action: .start),
            localize: passthroughLocalize
        )
        XCTAssertFalse(label.contains("Recommended for this page"))
        XCTAssertFalse(label.contains("Completed"))
    }

    func testActionLabelSubstitutesTitle() {
        XCTAssertEqual(
            TourLauncherAccessibility.actionLabel(
                row(completed: false, recommended: true, action: .start),
                localize: passthroughLocalize
            ),
            "Start tour: Vehicles & sharing"
        )
        XCTAssertEqual(
            TourLauncherAccessibility.actionLabel(
                row(completed: true, recommended: false, action: .replay),
                localize: passthroughLocalize
            ),
            "Replay tour: Vehicles & sharing"
        )
    }
}
