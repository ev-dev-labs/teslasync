import XCTest
@testable import TeslaSync

/// Tests the menu catalogue: completeness across all seven categories, keyboard
/// shortcut uniqueness, and shortcut rendering.
final class MenuCommandCatalogTests: XCTestCase {
    func testCoversAllSevenCategories() {
        XCTAssertEqual(AppMenuCategory.allCases.count, 7)
        XCTAssertTrue(MenuCommandCatalog.coversAllCategories)
        for category in AppMenuCategory.allCases {
            XCTAssertFalse(MenuCommandCatalog.commands(in: category).isEmpty, "\(category) has no commands")
        }
    }

    func testShortcutsAreUnique() {
        XCTAssertTrue(MenuCommandCatalog.hasUniqueShortcuts, "two commands share a keyboard shortcut")
    }

    func testNavigationShortcutsMapPrimaryTabs() {
        XCTAssertEqual(MenuCommandCatalog.navigationShortcuts[.dashboard], MenuShortcut("1"))
        XCTAssertEqual(MenuCommandCatalog.navigationShortcuts[.vehicles], MenuShortcut("2"))
        XCTAssertEqual(MenuCommandCatalog.navigationShortcuts[.charging], MenuShortcut("3"))
        XCTAssertEqual(MenuCommandCatalog.navigationShortcuts[.analytics], MenuShortcut("4"))
    }

    func testNavigateCommandsCoverEveryRoute() {
        let navigateRoutes = MenuCommandCatalog.commands(in: .navigate).compactMap(\.route)
        XCTAssertEqual(Set(navigateRoutes), Set(AppRoute.allCases))
    }

    func testCommandsMenuCoversEveryVehicleCommand() {
        let kinds = MenuCommandCatalog.commands(in: .commands).compactMap(\.command)
        XCTAssertEqual(Set(kinds), Set(VehicleCommandKind.allCases))
    }

    func testShortcutDisplaySymbols() {
        XCTAssertEqual(MenuShortcut("1").displaySymbols, "⌘1")
        XCTAssertEqual(MenuShortcut("r", [.shift, .command]).displaySymbols, "⇧⌘R")
        XCTAssertEqual(MenuShortcut("s", [.control, .command]).displaySymbols, "⌃⌘S")
    }

    func testAppCommandsExcludeSystemProvided() {
        let appFile = MenuCommandCatalog.appCommands(in: .file)
        XCTAssertTrue(appFile.contains { $0.id == "file.export" })
        XCTAssertFalse(appFile.contains { $0.id == "file.newWindow" }, "system items are not re-declared")
    }
}
