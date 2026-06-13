//
//  Combobox.Tests.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  The SwiftUI + facade half of the coverage (the pure projection lives in `Combobox.AdapterTests.swift`
//  and the state-holder in `Combobox.ModelTests.swift`; split to keep each file within the SwiftLint
//  file-length budget):
//    • Views — the public surface (static + async + model inits) and every subview compose in each
//      listbox branch (populated / empty / loading / error / overflow) plus the freshness chip + the
//      production announcer.
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
final class ComboboxViewTests: XCTestCase {
    private func items(_ count: Int) -> [ComboboxItem] {
        (0 ..< count).map { ComboboxItem(id: "k\($0)", label: "Vehicle \($0)") }
    }

    func testPublicSurfaceComposesForEveryInitializer() {
        _ = Combobox(label: "Vehicle", items: items(3), selection: nil) { _ in }
        _ = Combobox(
            label: "Vehicle", items: items(60), selection: items(60)[0], prompt: "Search",
            loading: false, connection: .stale, allowFreeText: true, maxVisibleOptions: 5,
            noChevron: false, noClearButton: false, iconSystemName: "car", onChange: { _ in }
        )
        _ = Combobox(
            label: "Address", selection: nil,
            asyncOptions: { _ in [] }, prompt: "Search", onChange: { _ in }
        )
        XCTAssertEqual(Combobox.surfaceSlug, "Combobox")
    }

    func testSurfaceComposesFromInjectedModel() {
        let model = ComboboxModel(
            config: ComboboxConfig(label: "Vehicle"),
            provider: .staticItems,
            source: InMemoryComboboxSource(initial: ComboboxSnapshot(staticItems: items(3))),
            telemetry: OSLogComboboxTelemetry(),
            announcer: LiveComboboxAnnouncer()
        )
        _ = Combobox(model: model)
    }

    func testListboxAndRowsComposeForEachBranch() {
        let model = ComboboxModel(
            config: ComboboxConfig(label: "Vehicle"),
            provider: .staticItems,
            source: InMemoryComboboxSource(initial: ComboboxSnapshot(staticItems: items(3)))
        )
        _ = ComboboxListbox(model: model)
        _ = ComboboxLabel(text: "Vehicle")
        _ = ComboboxField(model: model)
        _ = ComboboxOptionRow(item: items(1)[0], isActive: true, isSelected: true) {}
        _ = ComboboxStatusRow(text: ComboboxStrings.noResults)
        _ = ComboboxStatusRow(text: ComboboxStrings.loading, showsSpinner: true)
        _ = ComboboxErrorRow(message: "boom") {}
        _ = ComboboxMoreFooter(count: 7)
        _ = ComboboxIconButton(systemName: "xmark", label: ComboboxStrings.clearAria) {}
        _ = ComboboxFreshnessChip(connection: .offline) {}
        _ = LiveComboboxAnnouncer()
    }
}

// MARK: - Strings facade (P1/S10)

final class ComboboxStringsTests: XCTestCase {
    func testWebKeyFallbacksAreByteIdentical() {
        XCTAssertEqual(ComboboxStrings.noResults, "No results")
        XCTAssertEqual(ComboboxStrings.loading, "Loading")
        XCTAssertEqual(ComboboxStrings.clearAria, "Clear selection")
        XCTAssertEqual(ComboboxStrings.closeListAria, "Hide options")
        XCTAssertEqual(ComboboxStrings.openListAria, "Show options")
        XCTAssertEqual(ComboboxStrings.resultsCountOne, "1 result")
    }

    func testInterpolatedWebKeys() {
        XCTAssertEqual(ComboboxStrings.resultsCount(0), "No results")
        XCTAssertEqual(ComboboxStrings.resultsCount(1), "1 result")
        XCTAssertEqual(ComboboxStrings.resultsCount(8), "8 results")
        XCTAssertEqual(ComboboxStrings.moreHidden(3), "3 more — refine search")
    }

    func testNativeLeafKeyFallbacks() {
        XCTAssertEqual(ComboboxStrings.optionsLabel, "Options")
        XCTAssertEqual(ComboboxStrings.errorTitle, "Couldn't load options")
        XCTAssertEqual(ComboboxStrings.retry, "Retry")
        XCTAssertEqual(ComboboxStrings.live, "Live")
        XCTAssertEqual(ComboboxStrings.stale, "Stale")
        XCTAssertEqual(ComboboxStrings.offline, "Offline")
        XCTAssertEqual(ComboboxStrings.staleA11y, "Stale — tap to refresh")
        XCTAssertEqual(ComboboxStrings.offlineA11y, "Offline — showing the last loaded options")
    }
}
