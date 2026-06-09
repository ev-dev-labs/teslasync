//
//  CommandQuickActionsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0030 · CommandQuickActionsWidget (Apple)
//
//  Unit coverage for the CommandQuickActionsWidget surface:
//    • Adapter (catalog → projection) — `CommandQuickAction` catalog parity with the
//      web `COMMANDS` array (order, ids, API command strings, i18n keys, fallbacks,
//      icons, tones + exact web hex), the size → layout ladder, the item builder, and
//      the success/failure feedback resolver (web `useVehicleCommand` toast).
//    • State holder — `CommandQuickActionsModel` phase resolution across loading /
//      empty / error / content, the P1/S11 `view.opened` telemetry + source wiring,
//      stale auto-refresh, and the command-dispatch lifecycle (web `activeCommand` +
//      `mutation` + `onSettled`: in-flight running state, settle, re-entrancy guard,
//      no-vehicle guard, success/failure outcome).
//    • Registry — canonical `command-quick-actions` metadata + size clamping.
//    • Accessibility — the VoiceOver hint / running label / outcome announcement.
//    • Per-state render smoke — every phase rasterizes (snapshot) without crashing.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryCommandQuickActionsSource`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Adapter: catalog parity (port of the web `COMMANDS`)

@MainActor final class CommandQuickActionsCatalogTests: XCTestCase {
    func testCatalogMatchesWebOrder() {
        XCTAssertEqual(
            CommandQuickActionsCatalog.all,
            [.lock, .unlock, .climateOn, .climateOff, .frunk, .honk, .flash, .trunk]
        )
        XCTAssertEqual(CommandQuickActionsCatalog.all.count, 8)
    }

    func testStableIDsMatchWebCommandIds() {
        XCTAssertEqual(
            CommandQuickActionsCatalog.all.map(\.id),
            ["lock", "unlock", "climate_on", "climate_off", "frunk", "honk", "flash", "trunk"]
        )
    }

    func testAPICommandStringsMatchWebSource() {
        XCTAssertEqual(CommandQuickAction.lock.command, "lock")
        XCTAssertEqual(CommandQuickAction.unlock.command, "unlock")
        XCTAssertEqual(CommandQuickAction.climateOn.command, "climate_on")
        XCTAssertEqual(CommandQuickAction.climateOff.command, "climate_off")
        XCTAssertEqual(CommandQuickAction.frunk.command, "actuate_frunk")
        XCTAssertEqual(CommandQuickAction.honk.command, "honk_horn")
        XCTAssertEqual(CommandQuickAction.flash.command, "flash_lights")
        XCTAssertEqual(CommandQuickAction.trunk.command, "actuate_trunk")
    }

    func testI18nKeysMatchWebSource() {
        XCTAssertEqual(CommandQuickAction.lock.labelKey, "widget.quickActions.lock")
        XCTAssertEqual(CommandQuickAction.unlock.labelKey, "widget.quickActions.unlock")
        XCTAssertEqual(CommandQuickAction.climateOn.labelKey, "widget.quickActions.climateOn")
        XCTAssertEqual(CommandQuickAction.climateOff.labelKey, "widget.quickActions.climateOff")
        XCTAssertEqual(CommandQuickAction.frunk.labelKey, "widget.quickActions.frunk")
        XCTAssertEqual(CommandQuickAction.honk.labelKey, "widget.quickActions.horn")
        XCTAssertEqual(CommandQuickAction.flash.labelKey, "widget.quickActions.flash")
        XCTAssertEqual(CommandQuickAction.trunk.labelKey, "widget.quickActions.trunk")
    }

    func testEnglishFallbacksMatchWebDefaults() {
        XCTAssertEqual(
            CommandQuickActionsCatalog.all.map(\.labelFallback),
            ["Lock", "Unlock", "Climate On", "Climate Off", "Frunk", "Horn", "Flash", "Trunk"]
        )
    }

    func testEachCommandHasDistinctNonEmptyIcon() {
        let icons = CommandQuickActionsCatalog.all.map(\.systemImage)
        XCTAssertEqual(Set(icons).count, icons.count)
        XCTAssertFalse(icons.contains(where: \.isEmpty))
    }

    func testTonesMatchWebColorMapping() {
        XCTAssertEqual(CommandQuickAction.lock.tone, .green)
        XCTAssertEqual(CommandQuickAction.unlock.tone, .red)
        XCTAssertEqual(CommandQuickAction.climateOn.tone, .cyan)
        XCTAssertEqual(CommandQuickAction.climateOff.tone, .blue)
        XCTAssertEqual(CommandQuickAction.frunk.tone, .purple)
        XCTAssertEqual(CommandQuickAction.honk.tone, .amber)
        XCTAssertEqual(CommandQuickAction.flash.tone, .yellow)
        XCTAssertEqual(CommandQuickAction.trunk.tone, .indigo)
    }

    func testToneHexMatchesWebPalette() {
        XCTAssertEqual(CommandQuickActionsTone.green.hex, "#10b981")
        XCTAssertEqual(CommandQuickActionsTone.red.hex, "#ef4444")
        XCTAssertEqual(CommandQuickActionsTone.cyan.hex, "#00f0ff")
        XCTAssertEqual(CommandQuickActionsTone.blue.hex, "#60a5fa")
        XCTAssertEqual(CommandQuickActionsTone.purple.hex, "#c084fc")
        XCTAssertEqual(CommandQuickActionsTone.amber.hex, "#fbbf24")
        XCTAssertEqual(CommandQuickActionsTone.yellow.hex, "#facc15")
        XCTAssertEqual(CommandQuickActionsTone.indigo.hex, "#818cf8")
    }

    func testToneRGBComponentsMatchHex() {
        assertRGB(.green, 0.063, 0.725, 0.506)
        assertRGB(.red, 0.937, 0.267, 0.267)
        assertRGB(.cyan, 0.000, 0.941, 1.000)
        assertRGB(.blue, 0.376, 0.647, 0.980)
        assertRGB(.purple, 0.753, 0.518, 0.988)
        assertRGB(.amber, 0.984, 0.749, 0.141)
        assertRGB(.yellow, 0.980, 0.800, 0.082)
        assertRGB(.indigo, 0.506, 0.549, 0.973)
    }

    private func assertRGB(
        _ tone: CommandQuickActionsTone,
        _ red: Double, _ green: Double, _ blue: Double,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        XCTAssertEqual(tone.rgb.red, red, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(tone.rgb.green, green, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(tone.rgb.blue, blue, accuracy: 0.001, file: file, line: line)
    }
}

// MARK: - Adapter: layout ladder (web isCompact / isWide)

@MainActor final class CommandQuickActionsLayoutTests: XCTestCase {
    func testResolveMatchesWebBreakpoints() {
        XCTAssertEqual(CommandQuickActionsLayout.resolve(DashboardWidgetSize(cols: 1, rows: 1)), .compact)
        XCTAssertEqual(CommandQuickActionsLayout.resolve(DashboardWidgetSize(cols: 2, rows: 2)), .standard)
        XCTAssertEqual(CommandQuickActionsLayout.resolve(DashboardWidgetSize(cols: 3, rows: 2)), .wide)
        XCTAssertEqual(CommandQuickActionsLayout.resolve(DashboardWidgetSize(cols: 4, rows: 3)), .wide)
    }

    func testColumnsMatchWebGrid() {
        XCTAssertEqual(CommandQuickActionsLayout.compact.columns, 2)
        XCTAssertEqual(CommandQuickActionsLayout.standard.columns, 3)
        XCTAssertEqual(CommandQuickActionsLayout.wide.columns, 4)
    }

    func testVisibleCountMatchesWebSlice() {
        XCTAssertEqual(CommandQuickActionsLayout.compact.visibleCount, 4)
        XCTAssertEqual(CommandQuickActionsLayout.standard.visibleCount, 6)
        XCTAssertEqual(CommandQuickActionsLayout.wide.visibleCount, 8)
    }

    func testCompactHidesLabelsAndHeader() {
        XCTAssertFalse(CommandQuickActionsLayout.compact.showsLabels)
        XCTAssertFalse(CommandQuickActionsLayout.compact.showsHeader)
        XCTAssertTrue(CommandQuickActionsLayout.standard.showsLabels)
        XCTAssertTrue(CommandQuickActionsLayout.standard.showsHeader)
        XCTAssertTrue(CommandQuickActionsLayout.wide.showsLabels)
    }

    func testVisibleSliceMatchesLayout() {
        XCTAssertEqual(CommandQuickActionsCatalog.visible(for: .compact), [.lock, .unlock, .climateOn, .climateOff])
        XCTAssertEqual(
            CommandQuickActionsCatalog.visible(for: .standard),
            [.lock, .unlock, .climateOn, .climateOff, .frunk, .honk]
        )
        XCTAssertEqual(CommandQuickActionsCatalog.visible(for: .wide), CommandQuickActionsCatalog.all)
    }
}

// MARK: - Adapter: item builder

@MainActor final class CommandQuickActionsBuilderTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testBuildPreservesOrderAndCount() {
        let items = CommandQuickActionItemBuilder.build(localize: echo)
        XCTAssertEqual(items.map(\.id), CommandQuickActionsCatalog.all.map(\.id))
        XCTAssertEqual(items.count, 8)
    }

    func testBuildResolvesLabelViaLocalizer() {
        let items = CommandQuickActionItemBuilder.build(actions: [.lock], localize: keyTap)
        XCTAssertEqual(items.first?.label, "L:widget.quickActions.lock")
    }

    func testBuildCarriesCommandIconAndTone() {
        let items = CommandQuickActionItemBuilder.build(actions: [.frunk], localize: echo)
        let frunk = items[0]
        XCTAssertEqual(frunk.command, "actuate_frunk")
        XCTAssertEqual(frunk.systemImage, CommandQuickAction.frunk.systemImage)
        XCTAssertEqual(frunk.tone, .purple)
    }

    func testBuildPreBuildsAccessibilityCopy() {
        let items = CommandQuickActionItemBuilder.build(actions: [.honk], localize: echo)
        let horn = items[0]
        XCTAssertEqual(horn.accessibilityLabel, "Horn")
        XCTAssertEqual(horn.accessibilityHint, "Sends the Horn command")
    }

    func testBuildHandlesEmptyActions() {
        XCTAssertTrue(CommandQuickActionItemBuilder.build(actions: [], localize: echo).isEmpty)
    }
}

// MARK: - Adapter: command feedback (web useVehicleCommand toast)

@MainActor final class CommandFeedbackTests: XCTestCase {
    func testServerMessageWinsWhenPresent() {
        let result = CommandDispatchResult(success: true, message: "Doors locked")
        XCTAssertEqual(CommandFeedback.message(for: result), "Doors locked")
    }

    func testSuccessDefaultWhenMessageEmpty() {
        XCTAssertEqual(
            CommandFeedback.message(for: CommandDispatchResult(success: true, message: "")),
            "Command sent successfully"
        )
    }

    func testFailureDefaultWhenMessageEmpty() {
        XCTAssertEqual(
            CommandFeedback.message(for: CommandDispatchResult(success: false, message: "   ")),
            "Command failed"
        )
    }

    func testOutcomeCarriesCommandSuccessAndMessage() {
        let outcome = CommandFeedback.outcome(
            command: "flash_lights",
            result: CommandDispatchResult(success: true, message: "Flashed")
        )
        XCTAssertEqual(outcome.command, "flash_lights")
        XCTAssertTrue(outcome.success)
        XCTAssertEqual(outcome.message, "Flashed")
    }
}

// MARK: - Registry parity

@MainActor final class CommandQuickActionsRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = CommandQuickActionsWidget.registration
        XCTAssertEqual(registration.id, "command-quick-actions")
        XCTAssertEqual(registration.category, "commands")
        XCTAssertEqual(registration.nameKey, "widget.quickActions.title")
        XCTAssertEqual(registration.descriptionKey, "widget.quickActions.description")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = CommandQuickActionsWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 3, rows: 5)), DashboardWidgetSize(cols: 3, rows: 5))
    }
}

// MARK: - Accessibility content

@MainActor final class CommandQuickActionsAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testButtonHintFormatsSendsLabel() {
        XCTAssertEqual(
            CommandQuickActionsAccessibility.buttonHint(label: "Frunk", localize: echo),
            "Sends the Frunk command"
        )
    }

    func testRunningLabelFormatsSending() {
        XCTAssertEqual(
            CommandQuickActionsAccessibility.runningLabel(label: "Lock", localize: echo),
            "Sending Lock…"
        )
    }

    func testOutcomeAnnouncementIsMessage() {
        let outcome = CommandDispatchOutcome(command: "lock", success: true, message: "Doors locked")
        XCTAssertEqual(CommandQuickActionsAccessibility.outcomeAnnouncement(outcome), "Doors locked")
    }
}

// MARK: - Per-state render smoke (snapshot)

@MainActor final class CommandQuickActionsWidgetRenderTests: XCTestCase {
    private func render(_ update: CommandQuickActionsUpdate, size: DashboardWidgetSize) -> CGImage? {
        let source = InMemoryCommandQuickActionsSource(initial: update)
        let model = CommandQuickActionsModel(source: source)
        model.start()
        let widget = CommandQuickActionsWidget(model: model, size: size)
            .frame(width: 360, height: 220)
        return ImageRenderer(content: widget).cgImage
    }

    func testContentStateRendersWide() {
        XCTAssertNotNil(render(
            CommandQuickActionsUpdate(status: .loaded, vehicleID: 7),
            size: DashboardWidgetSize(cols: 4, rows: 3)
        ))
    }

    func testContentStateRendersStandard() {
        XCTAssertNotNil(render(
            CommandQuickActionsUpdate(status: .loaded, vehicleID: 7),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        ))
    }

    func testLoadingStateRenders() {
        XCTAssertNotNil(render(
            CommandQuickActionsUpdate(status: .loading, vehicleID: nil),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        ))
    }

    func testEmptyStateRenders() {
        XCTAssertNotNil(render(
            CommandQuickActionsUpdate(status: .loaded, vehicleID: 0),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        ))
    }

    func testErrorStateRenders() {
        XCTAssertNotNil(render(
            CommandQuickActionsUpdate(status: .failed("Network unavailable"), vehicleID: nil),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        ))
    }

    func testOfflineCachedStateRenders() {
        XCTAssertNotNil(render(
            CommandQuickActionsUpdate(status: .loaded, connection: .offline, vehicleID: 7, updatedAt: Date()),
            size: DashboardWidgetSize(cols: 4, rows: 3)
        ))
    }
}
