//
//  UnixPermissionTool.Tests.swift
//  TeslaSync — P4 feature view · 0022 · UnixPermissionTool (Apple)
//
//  Unit coverage for the UnixPermissionTool surface:
//    • Adapter (input → projection) — PERMS table, `[0-7]{3}` validation, and the
//      exact symbolic strings the web tool produces for every preset.
//    • State holder — phase resolution across valid / invalid edits, preset
//      selection, and the P1/S11 `view.opened` telemetry (emitted once).
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets at integration. They have
//  no network and no real store — the surface is a synchronous client-side tool.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: input → projection (port parity with the web tool)

final class UnixPermissionProjectorTests: XCTestCase {
    /// Pins the PERMS map verbatim against the web `constants.ts` table.
    func testPermsTableMatchesWebConstants() {
        XCTAssertEqual(UnixPermissionPerms.triad(for: "0"), "---")
        XCTAssertEqual(UnixPermissionPerms.triad(for: "1"), "--x")
        XCTAssertEqual(UnixPermissionPerms.triad(for: "2"), "-w-")
        XCTAssertEqual(UnixPermissionPerms.triad(for: "3"), "-wx")
        XCTAssertEqual(UnixPermissionPerms.triad(for: "4"), "r--")
        XCTAssertEqual(UnixPermissionPerms.triad(for: "5"), "r-x")
        XCTAssertEqual(UnixPermissionPerms.triad(for: "6"), "rw-")
        XCTAssertEqual(UnixPermissionPerms.triad(for: "7"), "rwx")
        // Unknown digit falls back to "---" exactly as `PERMS[d] ?? '---'`.
        XCTAssertEqual(UnixPermissionPerms.triad(for: "9"), "---")
    }

    /// Mirrors `octal.length === 3 && /^[0-7]{3}$/.test(octal)`.
    func testValidationMatchesWebRegex() {
        XCTAssertTrue(UnixPermissionProjector.isValid("755"))
        XCTAssertTrue(UnixPermissionProjector.isValid("000"))
        XCTAssertTrue(UnixPermissionProjector.isValid("777"))
        XCTAssertFalse(UnixPermissionProjector.isValid(""))
        XCTAssertFalse(UnixPermissionProjector.isValid("75"))
        XCTAssertFalse(UnixPermissionProjector.isValid("7555"))
        XCTAssertFalse(UnixPermissionProjector.isValid("758")) // 8 is out of range
        XCTAssertFalse(UnixPermissionProjector.isValid("7a5"))
        XCTAssertFalse(UnixPermissionProjector.isValid("   "))
    }

    /// Pins the exact symbolic strings for every preset (and the zero case).
    func testProjectKnownValues() throws {
        let perm755 = try XCTUnwrap(UnixPermissionProjector.project(octal: "755"))
        XCTAssertEqual(perm755.symbolic, "rwxr-xr-x")
        XCTAssertEqual(perm755.owner, "rwx")
        XCTAssertEqual(perm755.group, "r-x")
        XCTAssertEqual(perm755.other, "r-x")

        XCTAssertEqual(UnixPermissionProjector.project(octal: "644")?.symbolic, "rw-r--r--")
        XCTAssertEqual(UnixPermissionProjector.project(octal: "700")?.symbolic, "rwx------")
        XCTAssertEqual(UnixPermissionProjector.project(octal: "600")?.symbolic, "rw-------")
        XCTAssertEqual(UnixPermissionProjector.project(octal: "777")?.symbolic, "rwxrwxrwx")
        XCTAssertEqual(UnixPermissionProjector.project(octal: "444")?.symbolic, "r--r--r--")
        XCTAssertEqual(UnixPermissionProjector.project(octal: "000")?.symbolic, "---------")
    }

    /// Invalid input yields `nil` (web `symbolic` is `null` → breakdown hidden).
    func testProjectInvalidReturnsNil() {
        XCTAssertNil(UnixPermissionProjector.project(octal: "75"))
        XCTAssertNil(UnixPermissionProjector.project(octal: "789"))
        XCTAssertNil(UnixPermissionProjector.project(octal: ""))
    }

    /// Presets match the web `Select` options in source order, with derived
    /// `octal (symbolic)` labels.
    func testPresetsMatchSourceOrderAndLabels() {
        let all = UnixPermissionPreset.all
        XCTAssertEqual(all.map(\.octal), ["755", "644", "700", "600", "777", "444"])
        XCTAssertEqual(all[0].label, "755 (rwxr-xr-x)")
        XCTAssertEqual(all[1].label, "644 (rw-r--r--)")
        XCTAssertEqual(all[2].label, "700 (rwx------)")
        XCTAssertEqual(all[3].label, "600 (rw-------)")
        XCTAssertEqual(all[4].label, "777 (rwxrwxrwx)")
        XCTAssertEqual(all[5].label, "444 (r--r--r--)")
    }
}

// MARK: - State holder: phases + preset selection + telemetry

@MainActor
final class UnixPermissionToolModelTests: XCTestCase {
    func testInitialPhaseContentForDefault() {
        let model = UnixPermissionToolModel()
        XCTAssertEqual(model.octal, "755")
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.symbolic, "rwxr-xr-x")
    }

    func testInvalidOctalYieldsEmptyPhase() {
        let model = UnixPermissionToolModel(octal: "755")
        model.octal = "9"
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testEditingBackToValidRestoresContent() {
        let model = UnixPermissionToolModel(octal: "9")
        XCTAssertEqual(model.phase, .empty)
        model.octal = "644"
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.symbolic, "rw-r--r--")
    }

    func testSelectPresetUpdatesOctalAndProjection() {
        let model = UnixPermissionToolModel()
        model.select(preset: UnixPermissionPreset(octal: "444"))
        XCTAssertEqual(model.octal, "444")
        XCTAssertEqual(model.projection?.symbolic, "r--r--r--")
    }

    func testStartEmitsViewOpenedOnceWithSurfaceSlug() {
        let spy = RecordingUnixPermissionToolTelemetry()
        let model = UnixPermissionToolModel(octal: "755", telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [UnixPermissionToolSurface.slug])
        XCTAssertEqual(spy.surfaces, ["UnixPermissionTool"])
    }
}

// MARK: - Accessibility summary content

final class UnixPermissionAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryTriadAndSymbolic() throws {
        let projection = try XCTUnwrap(UnixPermissionProjector.project(octal: "755"))
        let summary = UnixPermissionAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Owner rwx"))
        XCTAssertTrue(summary.contains("Group r-x"))
        XCTAssertTrue(summary.contains("Other r-x"))
        XCTAssertTrue(summary.contains("rwxr-xr-x"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class RecordingUnixPermissionToolTelemetry: UnixPermissionToolTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
