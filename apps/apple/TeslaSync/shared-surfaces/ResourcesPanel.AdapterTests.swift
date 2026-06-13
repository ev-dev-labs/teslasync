//
//  ResourcesPanel.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0198 · ResourcesPanel (Apple)
//
//  Pure-core coverage for the server-resources panel (the model + view-composition half lives in
//  ResourcesPanel.Tests.swift; split to keep each file within the SwiftLint file-length budget). This is
//  the "adapter (cached → projection)" unit test the acceptance calls for: it drives the structural props
//  through ``ResourcesPanelProjector`` and asserts the verbatim port of the web `ResourcesPanel` +
//  `ResourceRowItem` render bodies, plus the value types they are built on:
//    • severity — the web `% threshold` classifier (warn ≥ 70, critical ≥ 90; nil → normal).
//    • row inputs / panel inputs — value equality (the `.onChange` key) across every field.
//    • slug — the diagnostics identity.
//    • project — severity, bar present/absent, clamped width, rounded a11y percent, meta/icon flags,
//                empty panel, footnote.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no model instance, so
//  each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - ResourcesPanelSurface (diagnostics identity)

final class ResourcesPanelSurfaceTests: XCTestCase {
    func testSlug() {
        XCTAssertEqual(ResourcesPanelSurface.slug, "ResourcesPanel")
    }
}

// MARK: - ResourceSeverity (web `% threshold` classifier)

final class ResourceSeverityTests: XCTestCase {
    func testThresholdsMatchWeb() {
        XCTAssertEqual(ResourceSeverity.warnThreshold, 70)
        XCTAssertEqual(ResourceSeverity.criticalThreshold, 90)
    }

    func testRawValues() {
        XCTAssertEqual(ResourceSeverity.normal.rawValue, "normal")
        XCTAssertEqual(ResourceSeverity.warn.rawValue, "warn")
        XCTAssertEqual(ResourceSeverity.critical.rawValue, "critical")
    }

    func testAllCases() {
        XCTAssertEqual(Set(ResourceSeverity.allCases), [.normal, .warn, .critical])
    }

    func testNilPercentIsNormal() {
        XCTAssertEqual(ResourceSeverity.classify(percent: nil), .normal)
    }

    func testBelowWarnIsNormal() {
        XCTAssertEqual(ResourceSeverity.classify(percent: 0), .normal)
        XCTAssertEqual(ResourceSeverity.classify(percent: 69.9), .normal)
        XCTAssertEqual(ResourceSeverity.classify(percent: -5), .normal)
    }

    func testWarnBand() {
        XCTAssertEqual(ResourceSeverity.classify(percent: 70), .warn, "70 is the inclusive warn boundary")
        XCTAssertEqual(ResourceSeverity.classify(percent: 89.9), .warn)
    }

    func testCriticalBand() {
        XCTAssertEqual(ResourceSeverity.classify(percent: 90), .critical, "90 is the inclusive critical boundary")
        XCTAssertEqual(ResourceSeverity.classify(percent: 100), .critical)
        XCTAssertEqual(ResourceSeverity.classify(percent: 150), .critical)
    }
}

// MARK: - ResourceRowInputs (the `.onChange` key)

final class ResourceRowInputsTests: XCTestCase {
    func testDefaults() {
        let inputs = ResourceRowInputs(label: "Memory", valueText: "1.8 GB")
        XCTAssertEqual(inputs.id, "Memory", "id defaults to the label (web key={row.label})")
        XCTAssertEqual(inputs.label, "Memory")
        XCTAssertEqual(inputs.valueText, "1.8 GB")
        XCTAssertNil(inputs.metaText)
        XCTAssertNil(inputs.percent)
        XCTAssertFalse(inputs.hasIcon)
    }

    func testExplicitIdOverridesLabel() {
        let inputs = ResourceRowInputs(id: "mem-row", label: "Memory", valueText: "1.8 GB")
        XCTAssertEqual(inputs.id, "mem-row")
    }

    func testEquality() {
        let base = ResourceRowInputs(
            label: "DB pool", valueText: "18", metaText: "of 25", percent: 72, hasIcon: true
        )
        XCTAssertEqual(base, ResourceRowInputs(
            label: "DB pool", valueText: "18", metaText: "of 25", percent: 72, hasIcon: true
        ))
    }

    func testEveryFieldParticipatesInEquality() {
        let base = ResourceRowInputs(
            label: "DB pool", valueText: "18", metaText: "of 25", percent: 72, hasIcon: true
        )
        XCTAssertNotEqual(base, ResourceRowInputs(
            id: "other", label: "DB pool", valueText: "18", metaText: "of 25", percent: 72, hasIcon: true
        ))
        XCTAssertNotEqual(base, ResourceRowInputs(
            label: "Other", valueText: "18", metaText: "of 25", percent: 72, hasIcon: true
        ))
        XCTAssertNotEqual(base, ResourceRowInputs(
            label: "DB pool", valueText: "19", metaText: "of 25", percent: 72, hasIcon: true
        ))
        XCTAssertNotEqual(base, ResourceRowInputs(
            label: "DB pool", valueText: "18", metaText: "of 30", percent: 72, hasIcon: true
        ))
        XCTAssertNotEqual(base, ResourceRowInputs(
            label: "DB pool", valueText: "18", metaText: "of 25", percent: 80, hasIcon: true
        ))
        XCTAssertNotEqual(base, ResourceRowInputs(
            label: "DB pool", valueText: "18", metaText: "of 25", percent: 72, hasIcon: false
        ))
    }
}

// MARK: - ResourcesPanelInputs (the panel `.onChange` key)

final class ResourcesPanelInputsTests: XCTestCase {
    func testDefaults() {
        let inputs = ResourcesPanelInputs(rows: [])
        XCTAssertTrue(inputs.rows.isEmpty)
        XCTAssertFalse(inputs.hasFootnote)
    }

    func testEquality() {
        let rows = [ResourceRowInputs(label: "Memory", valueText: "1.8 GB", percent: 22)]
        XCTAssertEqual(
            ResourcesPanelInputs(rows: rows, hasFootnote: true),
            ResourcesPanelInputs(rows: rows, hasFootnote: true)
        )
    }

    func testFootnoteAndRowsParticipateInEquality() {
        let rows = [ResourceRowInputs(label: "Memory", valueText: "1.8 GB", percent: 22)]
        XCTAssertNotEqual(
            ResourcesPanelInputs(rows: rows, hasFootnote: true),
            ResourcesPanelInputs(rows: rows, hasFootnote: false)
        )
        XCTAssertNotEqual(
            ResourcesPanelInputs(rows: rows),
            ResourcesPanelInputs(rows: [])
        )
    }
}

// MARK: - ResourcesPanelProjector (web `ResourceRowItem` + `ResourcesPanel` render bodies)

final class ResourcesPanelProjectorTests: XCTestCase {
    private func row(
        label: String = "Memory",
        valueText: String = "1.8 GB",
        metaText: String? = nil,
        percent: Double? = nil,
        hasIcon: Bool = false
    ) -> ResourceRowProjection {
        ResourcesPanelProjector.resolveRow(ResourceRowInputs(
            label: label, valueText: valueText, metaText: metaText, percent: percent, hasIcon: hasIcon
        ))
    }

    func testRowWithoutPercentHidesBar() {
        let projection = row(percent: nil)
        XCTAssertEqual(projection.severity, .normal)
        XCTAssertFalse(projection.showsBar, "web renders the bar only when percent != null")
        XCTAssertEqual(projection.barWidthPercent, 0)
        XCTAssertNil(projection.accessibilityPercent)
    }

    func testRowWithPercentShowsBarAndSeverity() {
        let projection = row(percent: 72)
        XCTAssertEqual(projection.severity, .warn)
        XCTAssertTrue(projection.showsBar)
        XCTAssertEqual(projection.barWidthPercent, 72)
        XCTAssertEqual(projection.accessibilityPercent, 72)
    }

    func testBarWidthClampsHigh() {
        let projection = row(percent: 150)
        XCTAssertEqual(projection.barWidthPercent, 100, "width clamps to 100 (web Math.min)")
        XCTAssertEqual(projection.accessibilityPercent, 150, "aria-valuenow is the unclamped round (web)")
    }

    func testBarWidthClampsLow() {
        let projection = row(percent: -10)
        XCTAssertEqual(projection.barWidthPercent, 0, "width clamps to 0 (web Math.max)")
        XCTAssertEqual(projection.accessibilityPercent, -10)
    }

    func testAccessibilityPercentRounds() {
        XCTAssertEqual(row(percent: 72.4).accessibilityPercent, 72)
        XCTAssertEqual(row(percent: 72.6).accessibilityPercent, 73)
    }

    func testMetaShownWhenNonEmpty() {
        XCTAssertTrue(row(metaText: "of 8 GB").showsMeta)
    }

    func testMetaHiddenWhenNilOrEmptyOrWhitespace() {
        XCTAssertFalse(row(metaText: nil).showsMeta)
        XCTAssertFalse(row(metaText: "").showsMeta, "web `{row.metaText && …}` — empty string is falsy")
        XCTAssertFalse(row(metaText: "   ").showsMeta)
    }

    func testIconPresenceDrivesRenderFlag() {
        XCTAssertTrue(row(hasIcon: true).showsIcon)
        XCTAssertFalse(row(hasIcon: false).showsIcon)
    }

    func testValueAndLabelPassThrough() {
        let projection = row(label: "Disk", valueText: "94 GB", metaText: "of 100 GB", percent: 94)
        XCTAssertEqual(projection.label, "Disk")
        XCTAssertEqual(projection.valueText, "94 GB")
        XCTAssertEqual(projection.metaText, "of 100 GB")
        XCTAssertEqual(projection.severity, .critical)
    }

    func testPanelMapsEveryRowInOrder() {
        let inputs = ResourcesPanelInputs(rows: [
            ResourceRowInputs(label: "Memory", valueText: "1.8 GB", percent: 22),
            ResourceRowInputs(label: "Disk", valueText: "94 GB", percent: 94)
        ])
        let projection = ResourcesPanelProjector.resolve(inputs: inputs)
        XCTAssertFalse(projection.isEmpty)
        XCTAssertEqual(projection.rows.map(\.id), ["Memory", "Disk"])
        XCTAssertEqual(projection.rows.map(\.severity), [.normal, .critical])
    }

    func testEmptyPanelFlagsEmpty() {
        let projection = ResourcesPanelProjector.resolve(inputs: ResourcesPanelInputs(rows: []))
        XCTAssertTrue(projection.isEmpty)
        XCTAssertTrue(projection.rows.isEmpty)
    }

    func testFootnoteFlagPassesThrough() {
        let rows = [ResourceRowInputs(label: "Memory", valueText: "1.8 GB")]
        XCTAssertTrue(ResourcesPanelProjector.resolve(
            inputs: ResourcesPanelInputs(rows: rows, hasFootnote: true)
        ).hasFootnote)
        XCTAssertFalse(ResourcesPanelProjector.resolve(
            inputs: ResourcesPanelInputs(rows: rows, hasFootnote: false)
        ).hasFootnote)
    }

    func testProjectionIsEquatableForIdenticalInputs() {
        let inputs = ResourcesPanelInputs(rows: [
            ResourceRowInputs(label: "Memory", valueText: "1.8 GB", metaText: "of 8 GB", percent: 22)
        ], hasFootnote: true)
        XCTAssertEqual(
            ResourcesPanelProjector.resolve(inputs: inputs),
            ResourcesPanelProjector.resolve(inputs: inputs)
        )
    }
}
