//
//  ActionBuilder.Tests.swift
//  TeslaSync — P4 feature view · 0080 · ActionBuilder (Apple)
//
//  Unit coverage for the ActionBuilder projection core:
//    • JSON — the order-preserving `JSON.parse` / `JSON.stringify(_, null, 2)`
//      round-trip used for `command_params`, plus number canonicalization.
//    • Adapter — default-action factory, default-channel rule, channel/command
//      option projections, set-setting value coercion, and the JS parseFloat/parseInt.
//    • Catalog — the action types + command catalog shape.
//    • Accessibility — the VoiceOver row label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure, driven directly.
//

import XCTest
@testable import TeslaSync

// MARK: - JSON engine (JSON.parse / JSON.stringify(_, null, 2))

final class ActionJSONTests: XCTestCase {
    func testParsePreservesObjectKeyOrder() throws {
        let value = try ActionJSONParser.parse("{\"b\": 1, \"a\": 2}")
        guard case let .object(members) = value else { return XCTFail("expected object") }
        XCTAssertEqual(members.map(\.key), ["b", "a"])
        XCTAssertTrue(value.isObject)
    }

    func testPrettyObjectIndentedAndOrdered() {
        let value = ActionJSON.object([
            ActionJSONMember("name", .string("Low battery")),
            ActionJSONMember("threshold", .number("20")),
            ActionJSONMember("enabled", .bool(true))
        ])
        let expected = [
            "{",
            "  \"name\": \"Low battery\",",
            "  \"threshold\": 20,",
            "  \"enabled\": true",
            "}"
        ].joined(separator: "\n")
        XCTAssertEqual(ActionJSONFormatter.pretty(value), expected)
    }

    func testPrettyNestedAndEmptyCollapse() {
        let value = ActionJSON.object([
            ActionJSONMember("a", .array([.number("1"), .number("2")])),
            ActionJSONMember("b", .object([]))
        ])
        let expected = [
            "{",
            "  \"a\": [",
            "    1,",
            "    2",
            "  ],",
            "  \"b\": {}",
            "}"
        ].joined(separator: "\n")
        XCTAssertEqual(ActionJSONFormatter.pretty(value), expected)
        XCTAssertEqual(ActionJSONFormatter.pretty(.array([])), "[]")
    }

    func testStringAndControlEscaping() {
        XCTAssertEqual(ActionJSONFormatter.pretty(.string("he \"hi\"\n\t")), "\"he \\\"hi\\\"\\n\\t\"")
        XCTAssertEqual(ActionJSONFormatter.pretty(.string("\u{01}")), "\"\\u0001\"")
    }

    func testNumberCanonicalization() throws {
        XCTAssertEqual(try ActionJSONParser.parse("1.0"), .number("1"))
        XCTAssertEqual(try ActionJSONParser.parse("1e2"), .number("100"))
        XCTAssertEqual(try ActionJSONParser.parse("0.50"), .number("0.5"))
        XCTAssertEqual(ActionJSONNumber.canonical(80), "80")
        XCTAssertEqual(ActionJSONNumber.canonical(80.5), "80.5")
    }

    func testParseScalarsAndUnicodeEscape() throws {
        XCTAssertEqual(try ActionJSONParser.parse("true"), .bool(true))
        XCTAssertEqual(try ActionJSONParser.parse("null"), .null)
        XCTAssertEqual(try ActionJSONParser.parse("\"\\u0041\""), .string("A"))
        XCTAssertFalse(try ActionJSONParser.parse("[1, 2]").isObject)
    }

    func testParseRejectsMalformedAndTrailingGarbage() {
        XCTAssertThrowsError(try ActionJSONParser.parse(""))
        XCTAssertThrowsError(try ActionJSONParser.parse("{"))
        XCTAssertThrowsError(try ActionJSONParser.parse("{\"a\": }"))
        XCTAssertThrowsError(try ActionJSONParser.parse("[1,]"))
        XCTAssertThrowsError(try ActionJSONParser.parse("{} trailing"))
    }

    func testRoundTripReformatsToPretty() throws {
        let parsed = try ActionJSONParser.parse("{\"temp\":21}")
        XCTAssertEqual(ActionJSONFormatter.pretty(parsed), "{\n  \"temp\": 21\n}")
    }
}

// MARK: - Adapter (defaults / channels / commands / coercions)

final class ActionBuilderAdapterTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testDefaultActionPerKind() {
        XCTAssertEqual(ActionBuilderAdapter.defaultAction(.command), .command(commandName: "climate_on", params: nil))
        XCTAssertEqual(ActionBuilderAdapter.defaultAction(.notify, channelID: 9), .notify(channelID: 9, template: ""))
        XCTAssertEqual(ActionBuilderAdapter.defaultAction(.setSetting), .setSetting(key: "", value: .text("")))
        XCTAssertEqual(ActionBuilderAdapter.defaultAction(.callAutomation), .callAutomation(targetID: 0))
    }

    func testDefaultChannelIDPrefersEnabledThenFirstThenZero() {
        let mixed = [
            NotificationChannelSummary(id: 1, name: "A", kind: .email, enabled: false),
            NotificationChannelSummary(id: 2, name: "B", kind: .slack, enabled: true)
        ]
        XCTAssertEqual(ActionBuilderAdapter.defaultChannelID(in: mixed), 2)
        let disabled = [NotificationChannelSummary(id: 5, name: "C", kind: .ntfy, enabled: false)]
        XCTAssertEqual(ActionBuilderAdapter.defaultChannelID(in: disabled), 5)
        XCTAssertEqual(ActionBuilderAdapter.defaultChannelID(in: []), 0)
    }

    func testChannelOptionsProjection() {
        let channels = [
            NotificationChannelSummary(id: 1, name: "Phone", kind: .pushover, enabled: true),
            NotificationChannelSummary(id: 2, name: "Family", kind: .telegram, enabled: false)
        ]
        let options = ActionBuilderAdapter.channelOptions(channels)
        XCTAssertEqual(options[0], ChannelOption(id: 1, label: "Phone (pushover)", disabled: false))
        XCTAssertEqual(options[1], ChannelOption(id: 2, label: "Family (telegram)", disabled: true))
    }

    func testCommandOptionsSentinelAndLabels() {
        let options = ActionBuilderAdapter.commandOptions(localize: echo)
        XCTAssertEqual(options.count, 30)
        XCTAssertEqual(options.first, CommandOption(value: "", label: "Select command..."))
        XCTAssertEqual(options[1], CommandOption(value: "lock", label: "Security & Access - Lock Doors"))
        XCTAssertEqual(options.last, CommandOption(value: "wake_up", label: "Drive & Software - Wake Up"))
    }

    func testActionWithSettingValueCoercion() {
        XCTAssertEqual(
            ActionBuilderAdapter.actionWithSettingValue(key: "k", kind: .number, value: "80"),
            .setSetting(key: "k", value: .number(80))
        )
        XCTAssertEqual(
            ActionBuilderAdapter.actionWithSettingValue(key: "k", kind: .number, value: ""),
            .setSetting(key: "k", value: .number(0))
        )
        XCTAssertEqual(
            ActionBuilderAdapter.actionWithSettingValue(key: "k", kind: .boolean, value: "true"),
            .setSetting(key: "k", value: .bool(true))
        )
        XCTAssertEqual(
            ActionBuilderAdapter.actionWithSettingValue(key: "k", kind: .text, value: "on"),
            .setSetting(key: "k", value: .text("on"))
        )
    }

    func testDisplaySettingValueAndSeed() {
        XCTAssertEqual(ActionBuilderAdapter.displaySettingValue(.number(80)), "80")
        XCTAssertEqual(ActionBuilderAdapter.displaySettingValue(.number(80.5)), "80.5")
        XCTAssertEqual(ActionBuilderAdapter.displaySettingValue(.bool(false)), "false")
        XCTAssertEqual(ActionBuilderAdapter.displaySettingValue(.text("x")), "x")
        XCTAssertEqual(ActionBuilderAdapter.commandParamsSeed(nil), "")
        let params = ActionJSON.object([ActionJSONMember("ok", .bool(true))])
        XCTAssertEqual(ActionBuilderAdapter.commandParamsSeed(params), "{\n  \"ok\": true\n}")
    }

    func testTargetIDFieldValueAndJSCoercions() {
        XCTAssertEqual(ActionBuilderAdapter.targetIDFieldValue(0), "")
        XCTAssertEqual(ActionBuilderAdapter.targetIDFieldValue(7), "7")
        XCTAssertEqual(ActionBuilderAdapter.jsParseFloatOrZero("80abc"), 80)
        XCTAssertEqual(ActionBuilderAdapter.jsParseFloatOrZero(""), 0)
        XCTAssertEqual(ActionBuilderAdapter.jsParseFloatOrZero("-3.5"), -3.5)
        XCTAssertEqual(ActionBuilderAdapter.jsParseIntOrZero("7abc"), 7)
        XCTAssertEqual(ActionBuilderAdapter.jsParseIntOrZero("3.9"), 3)
        XCTAssertEqual(ActionBuilderAdapter.jsParseIntOrZero(""), 0)
    }

    func testSettingValueKind() {
        XCTAssertEqual(SettingValue.number(1).kind, .number)
        XCTAssertEqual(SettingValue.bool(true).kind, .boolean)
        XCTAssertEqual(SettingValue.text("").kind, .text)
    }
}

// MARK: - Catalog (action types + command catalog)

final class ActionCatalogTests: XCTestCase {
    func testActionTypesShape() {
        XCTAssertEqual(
            ActionCatalog.actionTypes,
            [.command, .notify, .setSetting, .callAutomation]
        )
        XCTAssertEqual(AutomationActionKind.command.labelKey, "automations.actions.command")
        XCTAssertEqual(AutomationActionKind.command.fallback, "Vehicle Command")
        XCTAssertEqual(AutomationActionKind.parse("action_notify"), .notify)
        XCTAssertNil(AutomationActionKind.parse("action_unknown"))
    }

    func testCommandCatalogShape() {
        XCTAssertEqual(ActionCatalog.commandGroups.count, 7)
        let total = ActionCatalog.commandGroups.reduce(0) { $0 + $1.commands.count }
        XCTAssertEqual(total, 29)
        XCTAssertEqual(ActionCatalog.commandGroups.first?.fallback, "Security & Access")
        XCTAssertEqual(ActionCatalog.commandGroups.first?.commands.first?.value, "lock")
    }
}

// MARK: - Accessibility (VoiceOver row label)

final class ActionBuilderAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testRowLabelIsOneBased() {
        XCTAssertEqual(ActionBuilderAccessibility.rowLabel(index: 0, localize: echo), "Action 1")
        XCTAssertEqual(ActionBuilderAccessibility.rowLabel(index: 4, localize: echo), "Action 5")
    }
}
