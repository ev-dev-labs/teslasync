import XCTest
@testable import TeslaSync

/// Pure-logic tests for forms helpers.
final class FormsLogicTests: XCTestCase {
    func testTreeNodeOptionalChildren() {
        let leaf = TSTreeNode(id: "leaf", label: "leaf")
        XCTAssertNil(leaf.optionalChildren)

        let parent = TSTreeNode(id: "parent", label: "parent", children: [leaf])
        XCTAssertEqual(parent.optionalChildren?.count, 1)
    }

    func testVehicleOptionMapsToComboOption() {
        let vehicle = TSVehicleOption(id: "v1", name: "Model 3", nameText: "Model 3")
        XCTAssertEqual(vehicle.comboOption.value, "v1")
        XCTAssertEqual(vehicle.comboOption.searchText, "Model 3")
    }
}
