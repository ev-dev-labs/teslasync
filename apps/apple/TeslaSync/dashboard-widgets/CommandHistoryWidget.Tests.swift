//
//  CommandHistoryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0029 · CommandHistoryWidget (Apple)
//
//  Unit coverage for the CommandHistoryWidget surface:
//    • Adapter (cached → projection) — `CommandStatusCatalog.kind`/`feedVisual`/
//      `compactTone`/`compactLabel`, `CommandNameFormatter.format`, and
//      `CommandFeedBuilder` parity with the web `STATUS_MAP` + `DEFAULT_STATUS`,
//      `formatCommandName`, the `feedItems` map, and the `WidgetEventFeed`
//      newest-first sort + `maxItems` cap.
//    • Layout — `CommandLayout.isCompact`/`feedLimit` parity with web
//      `isCompact = size.cols <= 1` and `maxItems={10}`.
//    • State holder — `CommandModel` phase resolution across loading / empty / error /
//      content, the source-order `latest` (web `list[0]`), plus the P1/S11
//      `view.opened` telemetry + source wiring.
//    • Registry — canonical `command-history` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for the feed + compact rows.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryCommandSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: status catalog (parity with STATUS_MAP / DEFAULT_STATUS)

@MainActor final class CommandStatusCatalogTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the value tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so tests can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testKindMatchesKnownStatusesVerbatim() {
        XCTAssertEqual(CommandStatusCatalog.kind(forRawStatus: "success"), .success)
        XCTAssertEqual(CommandStatusCatalog.kind(forRawStatus: "failed"), .failed)
        XCTAssertEqual(CommandStatusCatalog.kind(forRawStatus: "pending"), .pending)
    }

    func testKindFallsBackToUnknownForUnrecognizedOrNil() {
        // Web `STATUS_MAP[cmd.status]` is an exact, case-sensitive lookup.
        XCTAssertEqual(CommandStatusCatalog.kind(forRawStatus: "queued"), .unknown)
        XCTAssertEqual(CommandStatusCatalog.kind(forRawStatus: "Success"), .unknown)
        XCTAssertEqual(CommandStatusCatalog.kind(forRawStatus: ""), .unknown)
        XCTAssertEqual(CommandStatusCatalog.kind(forRawStatus: nil), .unknown)
    }

    func testFeedVisualIconAndSeverityPerKind() {
        XCTAssertEqual(CommandStatusCatalog.feedVisual(for: .success).systemImage, "checkmark.circle.fill")
        XCTAssertEqual(CommandStatusCatalog.feedVisual(for: .success).severity, .info)
        XCTAssertEqual(CommandStatusCatalog.feedVisual(for: .failed).systemImage, "xmark.circle.fill")
        XCTAssertEqual(CommandStatusCatalog.feedVisual(for: .failed).severity, .critical)
        XCTAssertEqual(CommandStatusCatalog.feedVisual(for: .pending).systemImage, "clock.fill")
        XCTAssertEqual(CommandStatusCatalog.feedVisual(for: .pending).severity, .warning)
        XCTAssertEqual(CommandStatusCatalog.feedVisual(for: .unknown).systemImage, "terminal.fill")
        XCTAssertEqual(CommandStatusCatalog.feedVisual(for: .unknown).severity, .info)
    }

    func testCompactToneMapsPendingAndUnknownToWarning() {
        XCTAssertEqual(CommandStatusCatalog.compactTone(for: .success), .success)
        XCTAssertEqual(CommandStatusCatalog.compactTone(for: .failed), .danger)
        XCTAssertEqual(CommandStatusCatalog.compactTone(for: .pending), .warning)
        XCTAssertEqual(CommandStatusCatalog.compactTone(for: .unknown), .warning)
    }

    func testCompactLabelValuesAndKeys() {
        XCTAssertEqual(CommandStatusCatalog.compactLabel(for: .success, localize: echo), "Success")
        XCTAssertEqual(CommandStatusCatalog.compactLabel(for: .failed, localize: echo), "Failed")
        XCTAssertEqual(CommandStatusCatalog.compactLabel(for: .pending, localize: echo), "Pending")
        XCTAssertEqual(CommandStatusCatalog.compactLabel(for: .unknown, localize: echo), "Pending")
        XCTAssertEqual(CommandStatusCatalog.compactLabel(for: .success, localize: keyTap), "L:widget.commandSuccess")
        XCTAssertEqual(CommandStatusCatalog.compactLabel(for: .failed, localize: keyTap), "L:widget.commandFailed")
        XCTAssertEqual(CommandStatusCatalog.compactLabel(for: .unknown, localize: keyTap), "L:widget.commandPending")
    }
}

// MARK: - Adapter: command-name formatter (web `formatCommandName`)

@MainActor final class CommandNameFormatterTests: XCTestCase {
    func testReplacesUnderscoresAndCapitalizesEachWord() {
        XCTAssertEqual(CommandNameFormatter.format("lock_doors"), "Lock Doors")
        XCTAssertEqual(CommandNameFormatter.format("wake_up"), "Wake Up")
        XCTAssertEqual(CommandNameFormatter.format("start_climate"), "Start Climate")
        XCTAssertEqual(CommandNameFormatter.format("flash_lights"), "Flash Lights")
    }

    func testCapitalizesOnlyAtWordBoundariesLeavingInteriorUntouched() {
        // `\b\w` only upper-cases the first word char of each run, like the web regex.
        XCTAssertEqual(CommandNameFormatter.format("HVAC_on"), "HVAC On")
        XCTAssertEqual(CommandNameFormatter.format("set_temp_72"), "Set Temp 72")
        XCTAssertEqual(CommandNameFormatter.format("wakeUp"), "WakeUp")
    }

    func testHandlesDashSentinelAndEmpty() {
        XCTAssertEqual(CommandNameFormatter.format("—"), "—")
        XCTAssertEqual(CommandNameFormatter.format(""), "")
    }
}

// MARK: - Adapter: feed projection (web `feedItems` map + WidgetEventFeed)

@MainActor final class CommandFeedBuilderTests: XCTestCase {
    private func command(
        id: Int64?,
        command: String?,
        status: String?,
        offset: TimeInterval,
        base: Date
    ) -> CommandInput {
        CommandInput(
            id: id,
            vehicleID: 7,
            command: command,
            status: status,
            createdAt: base.addingTimeInterval(offset)
        )
    }

    func testBuildProjectsTitleStatusAndSeverityInSourceOrder() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let items = CommandFeedBuilder.build(commands: [
            command(id: 1, command: "lock_doors", status: "success", offset: -10, base: base),
            command(id: 2, command: "flash_lights", status: "failed", offset: -20, base: base)
        ])
        // Source order is preserved (compact `latest` reads `[0]`, web `list[0]`).
        XCTAssertEqual(items.map(\.id), ["1", "2"])
        XCTAssertEqual(items[0].title, "Lock Doors")
        XCTAssertEqual(items[0].statusRaw, "success")
        XCTAssertEqual(items[0].severity, .info)
        XCTAssertEqual(items[1].title, "Flash Lights")
        XCTAssertEqual(items[1].severity, .critical)
    }

    func testBuildUsesDashFallbackForMissingCommandAndStatus() {
        let item = CommandFeedBuilder.build(commands: [
            CommandInput(id: 9, vehicleID: 7, command: nil, status: nil, createdAt: Date())
        ]).first
        XCTAssertEqual(item?.title, "—")
        XCTAssertEqual(item?.statusRaw, "—")
        XCTAssertEqual(item?.kind, .unknown)
    }

    func testBuildIdFallsBackToVehicleAndTimestampWhenIdNil() {
        let ts = Date(timeIntervalSince1970: 1_700_000_000)
        let withID = CommandInput(id: 42, vehicleID: 7, command: "wake_up", status: "success", createdAt: ts)
        let withoutID = CommandInput(id: nil, vehicleID: 7, command: "wake_up", status: "success", createdAt: ts)
        XCTAssertEqual(CommandFeedBuilder.build(commands: [withID]).first?.id, "42")
        XCTAssertEqual(CommandFeedBuilder.build(commands: [withoutID]).first?.id, "7-1700000000")
    }

    func testBuildTimestampFallsBackToEpochWhenCreatedAtNil() {
        let item = CommandFeedBuilder.build(commands: [
            CommandInput(id: 1, vehicleID: 7, command: "lock_doors", status: "success", createdAt: nil)
        ]).first
        XCTAssertEqual(item?.timestamp, Date(timeIntervalSince1970: 0))
    }

    func testFeedSortsNewestFirstAndHonorsLimit() {
        let base = Date(timeIntervalSince1970: 2_000_000)
        let items = CommandFeedBuilder.build(commands: (0 ..< 6).map {
            command(id: Int64($0), command: "cmd_\($0)", status: "success", offset: Double($0), base: base)
        })
        let feed = CommandFeedBuilder.feed(items: items, limit: 4)
        XCTAssertEqual(feed.count, 4)
        XCTAssertEqual(feed.map(\.id), ["5", "4", "3", "2"])
    }

    func testFeedCapMatchesWebTenItemDefault() {
        let base = Date()
        let items = CommandFeedBuilder.build(commands: (0 ..< 25).map {
            command(id: Int64($0), command: "cmd_\($0)", status: "success", offset: Double($0), base: base)
        })
        let feed = CommandFeedBuilder.feed(items: items, limit: CommandLayout.feedLimit)
        XCTAssertEqual(feed.count, 10)
    }
}

// MARK: - Layout: size → compact / feed cap (web parity)

@MainActor final class CommandLayoutTests: XCTestCase {
    func testIsCompactOnlyAtOneColumn() {
        XCTAssertTrue(CommandLayout.isCompact(for: DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertTrue(CommandLayout.isCompact(for: DashboardWidgetSize(cols: 1, rows: 40)))
        XCTAssertFalse(CommandLayout.isCompact(for: DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertFalse(CommandLayout.isCompact(for: DashboardWidgetSize(cols: 4, rows: 4)))
    }

    func testFeedLimitMatchesWebConstant() {
        XCTAssertEqual(CommandLayout.feedLimit, 10)
    }
}

// MARK: - State holder: phases + latest + telemetry + source wiring

@MainActor final class CommandModelTests: XCTestCase {
    private func makeModel(
        _ update: CommandUpdate,
        telemetry: CommandTelemetry = OSLogCommandTelemetry()
    ) -> (CommandModel, InMemoryCommandSource) {
        let source = InMemoryCommandSource(initial: update)
        let model = CommandModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleCommand(_ name: String = "lock_doors", status: String = "success") -> CommandInput {
        CommandInput(id: 1, vehicleID: 7, command: name, status: status, createdAt: Date())
    }

    func testLoadingWithoutCommandsShowsLoading() {
        let (model, _) = makeModel(CommandUpdate(status: .loading, commands: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutCommandsShowsEmpty() {
        let (model, _) = makeModel(CommandUpdate(status: .loaded, commands: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCommandsShowsError() {
        let (model, _) = makeModel(CommandUpdate(status: .failed("boom"), commands: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCommandsPresentShowContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(CommandUpdate(status: .loading, commands: [sampleCommand()]))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(CommandUpdate(status: .failed("net"), commands: [sampleCommand()]))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testLatestIsSourceOrderFirst() {
        let base = Date(timeIntervalSince1970: 3_000_000)
        // The first source row is OLDER than the second; web compact uses `list[0]`
        // verbatim (not the newest), so `latest` must echo the source order.
        let (model, _) = makeModel(CommandUpdate(
            status: .loaded,
            commands: [
                CommandInput(
                    id: 1,
                    vehicleID: 7,
                    command: "lock_doors",
                    status: "success",
                    createdAt: base.addingTimeInterval(-1000)
                ),
                CommandInput(
                    id: 2,
                    vehicleID: 7,
                    command: "wake_up",
                    status: "failed",
                    createdAt: base
                )
            ]
        ))
        model.start()
        XCTAssertEqual(model.latest?.id, "1")
        XCTAssertEqual(model.latest?.title, "Lock Doors")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyCommandTelemetry()
        let (model, source) = makeModel(CommandUpdate(status: .loading, commands: []), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CommandHistoryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(CommandUpdate(status: .loaded, commands: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(CommandUpdate(status: .loading, commands: []))
        model.start()
        source.push(
            CommandUpdate(
                status: .loaded,
                connection: .offline,
                commands: [CommandInput(
                    id: 9,
                    vehicleID: 7,
                    command: "flash_lights",
                    status: "failed",
                    createdAt: Date()
                )],
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 1)
        XCTAssertEqual(model.items.first?.kind, .failed)
        XCTAssertEqual(model.items.first?.title, "Flash Lights")
    }
}

// MARK: - Registry parity

@MainActor final class CommandRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = CommandHistoryWidget.registration
        XCTAssertEqual(registration.id, "command-history")
        XCTAssertEqual(registration.category, "commands")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = CommandHistoryWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 12)),
            DashboardWidgetSize(cols: 2, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class CommandAccessibilityTests: XCTestCase {
    private func item(title: String, statusRaw: String) -> CommandFeedItem {
        CommandFeedItem(
            id: "1",
            kind: .success,
            title: title,
            statusRaw: statusRaw,
            timestamp: Date(),
            severity: .info
        )
    }

    func testFeedSummaryIncludesStatusWhenPresent() {
        let summary = CommandAccessibility.feedSummary(for: item(title: "Lock Doors", statusRaw: "success"))
        XCTAssertEqual(summary, "Lock Doors. success")
    }

    func testFeedSummaryOmitsDashSentinelStatus() {
        let summary = CommandAccessibility.feedSummary(for: item(title: "Lock Doors", statusRaw: "—"))
        XCTAssertEqual(summary, "Lock Doors")
    }

    func testCompactSummaryPairsCommandAndLabel() {
        let summary = CommandAccessibility.compactSummary(command: "Start Climate", statusLabel: "Pending")
        XCTAssertEqual(summary, "Start Climate. Pending")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCommandTelemetry: CommandTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
