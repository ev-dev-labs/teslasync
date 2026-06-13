//
//  ResourcesPanel.Tests.swift
//  TeslaSync — P4 shared surface · 0198 · ResourcesPanel (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in ResourcesPanel.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • ResourcesPanelModel — the once-only `view.opened`, the props update + identical-update guard, the
//      derived projection, and the localized title + empty message.
//    • Severity → tone / value colour — the web bar vs text decision (normal: green bar BUT primary text).
//    • Strings — the title / empty message / usage format / combined a11y value resolve through P1/S10.
//    • Views — the content view, row view, usage bar, and empty view compose in every branch.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - ResourcesPanelModel (surface lifecycle + derivation)

@MainActor
final class ResourcesPanelModelTests: XCTestCase {
    private func inputs(rows: [ResourceRowInputs] = [], hasFootnote: Bool = false) -> ResourcesPanelInputs {
        ResourcesPanelInputs(rows: rows, hasFootnote: hasFootnote)
    }

    private var sampleRow: ResourceRowInputs {
        ResourceRowInputs(label: "Memory", valueText: "1.8 GB", metaText: "of 8 GB", percent: 22)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyResourcesPanelTelemetry()
        let model = ResourcesPanelModel(inputs: inputs(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ResourcesPanelSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyResourcesPanelTelemetry()
        let model = ResourcesPanelModel(inputs: inputs(), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [ResourcesPanelSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInputs() {
        let model = ResourcesPanelModel(inputs: inputs(rows: [sampleRow]))
        XCTAssertFalse(model.projection.isEmpty)
        XCTAssertEqual(model.projection.rows.first?.label, "Memory")
        XCTAssertEqual(model.projection.rows.first?.severity, .normal)
    }

    func testUpdateChangesProjection() {
        let model = ResourcesPanelModel(inputs: inputs())
        XCTAssertTrue(model.projection.isEmpty)
        model.update(inputs(rows: [sampleRow]))
        XCTAssertFalse(model.projection.isEmpty)
        XCTAssertEqual(model.projection.rows.count, 1)
    }

    func testUpdateWithIdenticalInputsIsNoOp() {
        let base = inputs(rows: [sampleRow], hasFootnote: true)
        let model = ResourcesPanelModel(inputs: base)
        model.update(base)
        XCTAssertEqual(model.projection.rows.count, 1)
        XCTAssertTrue(model.projection.hasFootnote)
    }

    func testTitleAndEmptyMessageResolve() {
        let model = ResourcesPanelModel(inputs: inputs())
        XCTAssertEqual(model.title, "Resources")
        XCTAssertEqual(model.emptyMessage, "No resources to report")
    }
}

// MARK: - Severity → tone / value colour (web bar vs text decision)

@MainActor
final class ResourceSeverityToneTests: XCTestCase {
    func testBarToneMapsToSemanticTone() {
        XCTAssertEqual(ResourceSeverity.normal.barTone, .success)
        XCTAssertEqual(ResourceSeverity.warn.barTone, .warning)
        XCTAssertEqual(ResourceSeverity.critical.barTone, .danger)
    }

    func testBarTonesAreDistinct() {
        let colors = ResourceSeverity.allCases.map(\.barTone.color)
        XCTAssertEqual(Set(colors.map { "\($0)" }).count, ResourceSeverity.allCases.count)
    }

    func testNormalValueTextIsPrimaryNotGreen() {
        XCTAssertEqual(ResourceSeverity.normal.valueColor, Color.TS.textPrimary)
        XCTAssertNotEqual(
            ResourceSeverity.normal.valueColor,
            ResourceSeverity.normal.barTone.color,
            "web parity: the normal value text stays primary while the bar is green"
        )
    }

    func testWarnAndCriticalValueTextMatchTheirBar() {
        XCTAssertEqual(ResourceSeverity.warn.valueColor, ResourceSeverity.warn.barTone.color)
        XCTAssertEqual(ResourceSeverity.critical.valueColor, ResourceSeverity.critical.barTone.color)
    }
}

// MARK: - Strings facade (P1/S10)

final class ResourcesPanelStringsTests: XCTestCase {
    func testTitleResolvesToFallback() {
        XCTAssertEqual(ResourcesPanelStrings.title, "Resources")
    }

    func testEmptyMessageResolvesToFallback() {
        XCTAssertEqual(ResourcesPanelStrings.emptyMessage, "No resources to report")
    }

    func testUsageValueFormatsPercent() {
        XCTAssertEqual(ResourcesPanelStrings.usageValue(percent: 73), "73% used")
    }

    func testRowAccessibilityValueCombinesValueMetaAndPercent() {
        XCTAssertEqual(
            ResourcesPanelStrings.rowAccessibilityValue(value: "1.8 GB", meta: "of 8 GB", percent: 22),
            "1.8 GB, of 8 GB, 22% used"
        )
    }

    func testRowAccessibilityValueWithValueOnly() {
        XCTAssertEqual(
            ResourcesPanelStrings.rowAccessibilityValue(value: "248", meta: nil, percent: nil),
            "248"
        )
    }

    func testRowAccessibilityValueSkipsEmptyMeta() {
        XCTAssertEqual(
            ResourcesPanelStrings.rowAccessibilityValue(value: "12d 4h", meta: "  ", percent: nil),
            "12d 4h"
        )
    }

    func testTableName() {
        XCTAssertEqual(ResourcesPanelStrings.table, "ResourcesPanel")
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class ResourcesPanelViewCompositionTests: XCTestCase {
    func testSurfaceComposesWithRows() {
        _ = ResourcesPanel(rows: [
            ResourceRow(
                label: "Memory", valueText: "1.8 GB", metaText: "of 8 GB", percent: 22,
                icon: { Image(systemName: "memorychip") }
            ),
            ResourceRow(label: "Uptime", valueText: "12d 4h")
        ])
        XCTAssertEqual(ResourcesPanel.surfaceSlug, "ResourcesPanel")
    }

    func testSurfaceComposesEmpty() {
        _ = ResourcesPanel(rows: [])
    }

    func testSurfaceComposesWithFootnoteAndIdentifier() {
        _ = ResourcesPanel(
            rows: [ResourceRow(label: "Disk", valueText: "94 GB", percent: 94)],
            accessibilityIdentifier: "resources-panel"
        ) {
            Text(verbatim: "CPU % not yet exposed")
        }
    }

    func testContentViewComposesForEveryBranch() {
        for severityPercent in [nil, 22, 72, 94] as [Double?] {
            for hasIcon in [true, false] {
                let row = ResourceRow(
                    label: "Row", valueText: "value", metaText: "meta", percent: severityPercent,
                    icon: { hasIcon ? AnyView(Image(systemName: "gauge")) : AnyView(EmptyView()) }
                )
                let projection = ResourcesPanelProjector.resolve(
                    inputs: ResourcesPanelInputs(rows: [row.inputs])
                )
                _ = ResourcesPanelContentView(
                    projection: projection,
                    rows: [row],
                    title: "Resources",
                    emptyMessage: "No resources to report",
                    footnote: nil,
                    accessibilityIdentifier: nil
                )
            }
        }
    }

    func testContentViewComposesEmpty() {
        let projection = ResourcesPanelProjector.resolve(inputs: ResourcesPanelInputs(rows: []))
        _ = ResourcesPanelContentView(
            projection: projection,
            rows: [],
            title: "Resources",
            emptyMessage: "No resources to report",
            footnote: AnyView(Text(verbatim: "footnote")),
            accessibilityIdentifier: "panel"
        )
    }

    func testRowViewComposesWithAndWithoutBar() {
        let withBar = ResourcesPanelProjector.resolveRow(
            ResourceRowInputs(label: "Disk", valueText: "94 GB", metaText: "of 100 GB", percent: 94)
        )
        _ = ResourceRowView(projection: withBar, icon: AnyView(Image(systemName: "internaldrive")))

        let noBar = ResourcesPanelProjector.resolveRow(
            ResourceRowInputs(label: "Uptime", valueText: "12d 4h")
        )
        _ = ResourceRowView(projection: noBar, icon: nil)
    }

    func testUsageBarComposesForEachTone() {
        for severity in ResourceSeverity.allCases {
            _ = ResourceUsageBar(widthPercent: 55, tone: severity.barTone)
        }
    }

    func testEmptyViewComposes() {
        _ = ResourcesPanelEmptyView(message: "No resources to report")
    }
}

// MARK: - ResourceRow slot erasure (web `icon` ReactNode → AnyView?)

@MainActor
final class ResourceRowSlotTests: XCTestCase {
    func testIconBuilderPresenceMapsToHasIcon() {
        let withIcon = ResourceRow(
            label: "Memory", valueText: "1.8 GB", icon: { Image(systemName: "memorychip") }
        )
        XCTAssertTrue(withIcon.inputs.hasIcon, "a real icon builder erases to a non-nil slot")

        let withoutIcon = ResourceRow(label: "Uptime", valueText: "12d 4h")
        XCTAssertFalse(withoutIcon.inputs.hasIcon, "the default EmptyView icon builder erases to nil")
    }

    func testRowPropsCarryIntoInputs() {
        let row = ResourceRow(label: "Disk", valueText: "94 GB", metaText: "of 100 GB", percent: 94)
        XCTAssertEqual(row.id, "Disk", "id defaults to the label (web key={row.label})")
        XCTAssertEqual(row.inputs.label, "Disk")
        XCTAssertEqual(row.inputs.valueText, "94 GB")
        XCTAssertEqual(row.inputs.metaText, "of 100 GB")
        XCTAssertEqual(row.inputs.percent, 94)
    }

    func testExplicitIdOverridesLabel() {
        let row = ResourceRow(id: "disk-row", label: "Disk", valueText: "94 GB")
        XCTAssertEqual(row.id, "disk-row")
        XCTAssertEqual(row.inputs.id, "disk-row")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyResourcesPanelTelemetry: ResourcesPanelTelemetry, @unchecked Sendable {
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
