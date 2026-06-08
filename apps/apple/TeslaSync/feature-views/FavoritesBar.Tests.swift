//
//  FavoritesBar.Tests.swift
//  TeslaSync — P4 feature view · 0227 · FavoritesBar (Apple)
//
//  Unit coverage for the FavoritesBar adapter core:
//    • Projection (`FavoritesProjection`) — the favorite filter (web
//      `commands.filter(c => favorites.includes(c.id))`): registry order preserved,
//      missing ids ignored, each command once; and phase resolution across loading /
//      loaded / failed × cached-or-not.
//    • The responsive column math (`FavoritesLayout`) at the web Tailwind breakpoints.
//    • The VoiceOver summary (`FavoritesAccessibility`).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no bundle:
//  the adapter is pure and resolves copy through an echo localizer.
//

import XCTest
@testable import TeslaSync

// MARK: - Sample data

private enum FavoritesTestData {
    static func commands() -> [FavoriteCommand] {
        [
            command(id: "wake", label: "Wake"),
            command(id: "lock", label: "Lock"),
            command(id: "climate", label: "Climate"),
            command(id: "honk", label: "Honk")
        ]
    }

    static func command(id: String, label: String) -> FavoriteCommand {
        FavoriteCommand(
            id: id,
            command: id,
            labelKey: "commands.\(id).label",
            labelFallback: label,
            systemImage: "bolt.fill"
        )
    }
}

// MARK: - Projection: favorite filter

@MainActor
final class FavoritesProjectionFilterTests: XCTestCase {
    func testKeepsRegistryOrderNotFavoritesOrder() {
        let result = FavoritesProjection.favoriteCommands(
            favorites: ["climate", "wake"],
            commands: FavoritesTestData.commands()
        )
        XCTAssertEqual(result.map(\.id), ["wake", "climate"])
    }

    func testIgnoresFavoriteIDsAbsentFromRegistry() {
        let result = FavoritesProjection.favoriteCommands(
            favorites: ["lock", "does-not-exist"],
            commands: FavoritesTestData.commands()
        )
        XCTAssertEqual(result.map(\.id), ["lock"])
    }

    func testYieldsEachCommandAtMostOnceDespiteDuplicateFavorites() {
        let result = FavoritesProjection.favoriteCommands(
            favorites: ["lock", "lock", "lock"],
            commands: FavoritesTestData.commands()
        )
        XCTAssertEqual(result.map(\.id), ["lock"])
    }

    func testEmptyFavoritesYieldNoCommands() {
        let result = FavoritesProjection.favoriteCommands(
            favorites: [],
            commands: FavoritesTestData.commands()
        )
        XCTAssertTrue(result.isEmpty)
    }
}

// MARK: - Projection: phase resolution

@MainActor
final class FavoritesProjectionPhaseTests: XCTestCase {
    func testResolvePhaseWithoutCache() {
        XCTAssertEqual(FavoritesProjection.resolvePhase(.loading, favoriteCount: 0), .loading)
        XCTAssertEqual(FavoritesProjection.resolvePhase(.loaded, favoriteCount: 0), .empty)
        XCTAssertEqual(FavoritesProjection.resolvePhase(.failed("boom"), favoriteCount: 0), .error("boom"))
    }

    func testResolvePhaseWithCachedFavoritesAlwaysContent() {
        XCTAssertEqual(FavoritesProjection.resolvePhase(.loading, favoriteCount: 3), .content)
        XCTAssertEqual(FavoritesProjection.resolvePhase(.loaded, favoriteCount: 3), .content)
        XCTAssertEqual(FavoritesProjection.resolvePhase(.failed("x"), favoriteCount: 3), .content)
    }
}

// MARK: - Responsive column math

@MainActor
final class FavoritesLayoutTests: XCTestCase {
    func testColumnCountAcrossTailwindBreakpoints() {
        XCTAssertEqual(FavoritesLayout.columnCount(forWidth: 0), 2)
        XCTAssertEqual(FavoritesLayout.columnCount(forWidth: 639), 2)
        XCTAssertEqual(FavoritesLayout.columnCount(forWidth: 640), 3)
        XCTAssertEqual(FavoritesLayout.columnCount(forWidth: 1023), 3)
        XCTAssertEqual(FavoritesLayout.columnCount(forWidth: 1024), 4)
        XCTAssertEqual(FavoritesLayout.columnCount(forWidth: 2000), 4)
    }
}

// MARK: - Accessibility summary

@MainActor
final class FavoritesAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSummaryWithNoFavorites() {
        let summary = FavoritesAccessibility.summary(count: 0, localize: echo)
        XCTAssertEqual(summary, "Quick Actions: no favorites yet")
    }

    func testSummaryWithFavorites() {
        let summary = FavoritesAccessibility.summary(count: 4, localize: echo)
        XCTAssertEqual(summary, "Quick Actions: 4 favorites")
    }
}

// MARK: - Surface identity

@MainActor
final class FavoritesSurfaceTests: XCTestCase {
    func testSlugIsStable() {
        XCTAssertEqual(FavoritesSurface.slug, "FavoritesBar")
    }

    func testReportOpenEmitsSlug() {
        let telemetry = SpyFavoritesTelemetry()
        FavoritesSurface.reportOpen(to: telemetry)
        XCTAssertEqual(telemetry.surfaces, ["FavoritesBar"])
    }
}

// MARK: - Test doubles (shared with FavoritesBar.ModelTests)

final class SpyFavoritesTelemetry: FavoritesTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

final class SpyFavoritesActionSink: FavoritesActionSink, @unchecked Sendable {
    private(set) var executed: [String] = []
    private(set) var toggled: [String] = []

    func execute(_ command: FavoriteCommand) {
        executed.append(command.id)
    }

    func toggleFavorite(_ command: FavoriteCommand) {
        toggled.append(command.id)
    }
}
