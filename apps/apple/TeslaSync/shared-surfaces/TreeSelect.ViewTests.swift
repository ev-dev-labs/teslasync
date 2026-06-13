//
//  TreeSelect.ViewTests.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  Per-state view-render smoke tests for the tree multi-select: every render state (loading / error /
//  empty / no-results / populated-collapsed / populated-expanded / searching / with a disabled leaf /
//  stale / offline) materializes through `ImageRenderer`, plus accessibility-label assertions that the
//  interactive controls expose composed VoiceOver text. The model is driven by `InMemoryTreeSelectSource`,
//  so the tests run with no network and no real store.
//

#if canImport(UIKit) || canImport(AppKit)
    import SwiftUI
    import XCTest
    @testable import TeslaSync

    @MainActor
    final class TreeSelectViewStateTests: XCTestCase {
        private func leaf(_ id: String, _ label: String, disabled: Bool = false) -> TreeSelectLeaf {
            TreeSelectLeaf(id: id, label: label, isDisabled: disabled, disabledReason: disabled ? "n/a" : nil)
        }

        private func groups() -> [TreeSelectGroup] {
            [
                TreeSelectGroup(id: "g1", label: "Battery", leaves: [
                    leaf("a", "State of charge"),
                    leaf("b", "Pack voltage"),
                    leaf("c", "Cell temperature")
                ]),
                TreeSelectGroup(id: "g2", label: "Drive", leaves: [
                    leaf("d", "Vehicle speed"),
                    leaf("e", "Motor torque", disabled: true)
                ])
            ]
        }

        private func snapshot(
            empty: Bool = false,
            selected: [String] = [],
            search: String = "",
            expanded: [String]? = nil,
            isLoading: Bool = false,
            errorMessage: String? = nil,
            connection: TreeSelectConnection = .live
        ) -> TreeSelectSnapshot {
            TreeSelectSnapshot(
                groups: empty ? [] : groups(),
                selectedIDs: selected,
                searchValue: search,
                expandedGroupIDs: expanded,
                isLoading: isLoading,
                errorMessage: errorMessage,
                connection: connection
            )
        }

        private func renders(_ input: TreeSelectSnapshot) -> Bool {
            let source = InMemoryTreeSelectSource(initial: input)
            let model = TreeSelectModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: TreeSelect(model: model).frame(width: 380, height: 480))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        // MARK: Per-state render smoke tests

        func testLoadingRenders() {
            XCTAssertTrue(renders(snapshot(isLoading: true)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(snapshot(errorMessage: "offline")))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(snapshot(empty: true)))
        }

        func testNoResultsRenders() {
            XCTAssertTrue(renders(snapshot(search: "zzz")))
        }

        func testPopulatedCollapsedRenders() {
            XCTAssertTrue(renders(snapshot(selected: ["a"], expanded: [])))
        }

        func testPopulatedExpandedRenders() {
            XCTAssertTrue(renders(snapshot(selected: ["a", "b"], expanded: ["g1", "g2"])))
        }

        func testSearchingRenders() {
            XCTAssertTrue(renders(snapshot(selected: ["a"], search: "temp")))
        }

        func testDisabledLeafRenders() {
            XCTAssertTrue(renders(snapshot(selected: ["d"], expanded: ["g2"])))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(snapshot(selected: ["a"], connection: .stale)))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(snapshot(selected: ["a"], connection: .offline)))
        }

        // MARK: Accessibility labels (every interactive control exposes composed text)

        func testGroupAccessibilityLabelComposesCountedSummary() {
            let label = TreeSelectStrings.groupA11y(label: "Battery", selected: 2, total: 3)
            XCTAssertTrue(label.contains("Battery"))
            XCTAssertTrue(label.contains("2"))
            XCTAssertTrue(label.contains("3"))
        }

        func testToggleGroupLabelNamesTheGroup() {
            XCTAssertTrue(TreeSelectStrings.toggleGroup(label: "Drive").contains("Drive"))
        }

        func testExpandCollapseLabelsNameTheGroup() {
            XCTAssertTrue(TreeSelectStrings.expand(label: "Battery").contains("Battery"))
            XCTAssertTrue(TreeSelectStrings.collapse(label: "Battery").contains("Battery"))
        }

        func testDisabledLeafLabelFoldsInReason() {
            let label = TreeSelectStrings.leafReason(label: "Motor torque", reason: "Not on this trim")
            XCTAssertTrue(label.contains("Motor torque"))
            XCTAssertTrue(label.contains("Not on this trim"))
        }

        func testSearchAndClearLabelsPresent() {
            XCTAssertFalse(TreeSelectStrings.filterA11y.isEmpty)
            XCTAssertFalse(TreeSelectStrings.clearSearch.isEmpty)
        }

        func testSummaryReflectsSelectionAndVisibility() {
            XCTAssertTrue(TreeSelectStrings.summary(selected: 1, total: 5).contains("1"))
            let visible = TreeSelectStrings.summaryVisible(selected: 1, total: 5, visible: 2)
            XCTAssertTrue(visible.contains("2"))
        }

        func testModelExposesSummaryValueForContainer() {
            let source = InMemoryTreeSelectSource(initial: snapshot(selected: ["a"]))
            let model = TreeSelectModel(source: source)
            model.start()
            XCTAssertFalse(model.summaryText.isEmpty)
        }
    }
#endif
