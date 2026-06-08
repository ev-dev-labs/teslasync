import SwiftUI
import XCTest
@testable import TeslaSync

/// Pure-logic tests for the component library (no rendering / framework needed).
@MainActor
final class ComponentLogicTests: XCTestCase {
    private struct SortRow: Identifiable {
        let id: Int
        let key: Int
    }

    private func keyComparator(_ lhs: SortRow, _ rhs: SortRow) -> ComparisonResult {
        if lhs.key == rhs.key { return .orderedSame }
        return lhs.key < rhs.key ? .orderedAscending : .orderedDescending
    }

    func testTableSortAscendingDescending() {
        let rows = [SortRow(id: 1, key: 3), SortRow(id: 2, key: 1), SortRow(id: 3, key: 2)]
        let asc = TSTableSort.sorted(rows, by: keyComparator, ascending: true).map(\.key)
        XCTAssertEqual(asc, [1, 2, 3])
        let desc = TSTableSort.sorted(rows, by: keyComparator, ascending: false).map(\.key)
        XCTAssertEqual(desc, [3, 2, 1])
    }

    func testTableSortIsStableOnTies() {
        let rows = [SortRow(id: 1, key: 1), SortRow(id: 2, key: 1), SortRow(id: 3, key: 0)]
        let sorted = TSTableSort.sorted(rows, by: keyComparator, ascending: true).map(\.id)
        // key 0 first (id 3), then the two key-1 rows in their original order (1, 2).
        XCTAssertEqual(sorted, [3, 1, 2])
    }

    func testCommandFilter() {
        let commands = [
            TSCommand(id: "a", title: "a", searchText: "Open Dashboard") {},
            TSCommand(id: "b", title: "b", searchText: "Close Drawer") {},
            TSCommand(id: "c", title: "c", searchText: "Open Settings") {}
        ]
        XCTAssertEqual(TSCommandFilter.filter(commands, query: "").count, 3)
        XCTAssertEqual(TSCommandFilter.filter(commands, query: "open").map(\.id), ["a", "c"])
        XCTAssertEqual(TSCommandFilter.filter(commands, query: "  DRAWER ").map(\.id), ["b"])
        XCTAssertTrue(TSCommandFilter.filter(commands, query: "zzz").isEmpty)
    }

    func testCommandNavigationClamps() {
        XCTAssertEqual(TSCommandNavigation.move(0, by: -1, count: 3), 0)
        XCTAssertEqual(TSCommandNavigation.move(2, by: 1, count: 3), 2)
        XCTAssertEqual(TSCommandNavigation.move(1, by: 1, count: 3), 2)
        XCTAssertEqual(TSCommandNavigation.move(5, by: 0, count: 0), 0)
    }

    func testMaskedValueMasking() {
        XCTAssertEqual(TSMaskedValue.mask("abcd").count, 4)
        XCTAssertEqual(TSMaskedValue.mask(""), "•")
        XCTAssertFalse(TSMaskedValue.mask("secret").contains("s"))
    }

    func testAppearanceColorSchemeMapping() {
        XCTAssertNil(TSAppearance.system.colorScheme)
        XCTAssertEqual(TSAppearance.light.colorScheme, .light)
        XCTAssertEqual(TSAppearance.dark.colorScheme, .dark)
    }
}
