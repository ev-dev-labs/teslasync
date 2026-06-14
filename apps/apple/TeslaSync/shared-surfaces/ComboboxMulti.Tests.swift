//
//  ComboboxMulti.Tests.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  The SwiftUI + facade half of the coverage (the pure projection lives in
//  `ComboboxMulti.AdapterTests.swift` and the state-holder in `ComboboxMulti.ModelTests.swift`; split to
//  keep each file within the SwiftLint file-length budget):
//    • Views — the public surface (static + async + model inits) and every subview compose in each
//      listbox branch (populated / empty / loading / error / overflow) plus the chip, the freshness
//      chip, and the production announcer.
//    • Strings — every web `t()` key resolves through the P1/S10 facade with the byte-identical English
//      fallback + interpolation, and the native P4 leaf keys resolve too.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the construction is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Views (every branch composes)

@MainActor
final class ComboboxMultiViewTests: XCTestCase {
    private func items(_ count: Int) -> [ComboboxMultiItem] {
        (0 ..< count).map { ComboboxMultiItem(id: "k\($0)", label: "Fruit \($0)") }
    }

    func testPublicSurfaceComposesForEveryInitializer() {
        _ = ComboboxMulti(label: "Fruits", items: items(3), value: []) { _ in }
        _ = ComboboxMulti(
            label: "Fruits", items: items(60), value: [items(60)[0]], prompt: "Add",
            loading: false, connection: .stale, maxVisibleOptions: 5, maxItems: 3,
            noChevron: false, iconSystemName: "leaf", onChange: { _ in }
        )
        _ = ComboboxMulti(
            label: "Address", value: [],
            asyncOptions: { _ in [] }, prompt: "Search", onChange: { _ in }
        )
        XCTAssertEqual(ComboboxMulti.surfaceSlug, "ComboboxMulti")
    }

    func testSurfaceComposesFromInjectedModel() {
        let model = ComboboxMultiModel(
            config: ComboboxMultiConfig(label: "Fruits"),
            provider: .staticItems,
            source: InMemoryComboboxMultiSource(initial: ComboboxMultiSnapshot(staticItems: items(3))),
            telemetry: OSLogComboboxMultiTelemetry(),
            announcer: LiveComboboxMultiAnnouncer()
        )
        _ = ComboboxMulti(model: model)
    }

    func testListboxAndRowsComposeForEachBranch() {
        let model = ComboboxMultiModel(
            config: ComboboxMultiConfig(label: "Fruits", maxItems: 2),
            provider: .staticItems,
            source: InMemoryComboboxMultiSource(initial: ComboboxMultiSnapshot(staticItems: items(3)))
        )
        _ = ComboboxMultiListbox(model: model)
        _ = ComboboxMultiLabel(text: "Fruits", count: 1, maxItems: 2)
        _ = ComboboxMultiField(model: model)
        _ = ComboboxMultiFlowLayout()
        _ = ComboboxMultiChip(label: "Apple", removeLabel: ComboboxMultiStrings.removeChip("Apple")) {}
        _ = ComboboxMultiOptionRow(item: items(1)[0], isActive: true, disabled: true) {}
        _ = ComboboxMultiStatusRow(text: ComboboxMultiStrings.noResults)
        _ = ComboboxMultiStatusRow(text: ComboboxMultiStrings.loading, showsSpinner: true)
        _ = ComboboxMultiStatusRow(text: ComboboxMultiStrings.maxReached)
        _ = ComboboxMultiErrorRow(message: "boom") {}
        _ = ComboboxMultiMoreFooter(count: 7)
        _ = ComboboxMultiIconButton(systemName: "chevron.down", label: ComboboxMultiStrings.openListAria) {}
        _ = ComboboxMultiFreshnessChip(connection: .offline) {}
        _ = LiveComboboxMultiAnnouncer()
    }
}

// MARK: - Strings facade (P1/S10)

final class ComboboxMultiStringsTests: XCTestCase {
    func testWebKeyFallbacksAreByteIdentical() {
        XCTAssertEqual(ComboboxMultiStrings.noResults, "No results")
        XCTAssertEqual(ComboboxMultiStrings.loading, "Loading")
        XCTAssertEqual(ComboboxMultiStrings.maxReached, "Maximum reached")
        XCTAssertEqual(ComboboxMultiStrings.closeListAria, "Hide options")
        XCTAssertEqual(ComboboxMultiStrings.openListAria, "Show options")
        XCTAssertEqual(ComboboxMultiStrings.resultsCountOne, "1 result")
    }

    func testInterpolatedWebKeys() {
        XCTAssertEqual(ComboboxMultiStrings.resultsCount(0), "No results")
        XCTAssertEqual(ComboboxMultiStrings.resultsCount(1), "1 result")
        XCTAssertEqual(ComboboxMultiStrings.resultsCount(8), "8 results")
        XCTAssertEqual(ComboboxMultiStrings.moreHidden(3), "3 more — refine search")
        XCTAssertEqual(ComboboxMultiStrings.removeChip("Banana"), "Remove Banana")
        XCTAssertEqual(ComboboxMultiStrings.removedChip("Apple"), "Removed Apple")
    }

    func testNativeLeafKeyFallbacks() {
        XCTAssertEqual(ComboboxMultiStrings.optionsLabel, "Options")
        XCTAssertEqual(ComboboxMultiStrings.errorTitle, "Couldn't load options")
        XCTAssertEqual(ComboboxMultiStrings.retry, "Retry")
        XCTAssertEqual(ComboboxMultiStrings.live, "Live")
        XCTAssertEqual(ComboboxMultiStrings.stale, "Stale")
        XCTAssertEqual(ComboboxMultiStrings.offline, "Offline")
        XCTAssertEqual(ComboboxMultiStrings.staleA11y, "Stale — tap to refresh")
        XCTAssertEqual(ComboboxMultiStrings.offlineA11y, "Offline — showing the last loaded options")
    }
}
