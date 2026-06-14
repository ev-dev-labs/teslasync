import XCTest
@testable import TeslaSync

/// State-machine + mutation + validation tests for `ActionBuilderPageModel` — every data state
/// the page renders (loading / empty / success / error), the add/remove/replace/move/change-kind
/// mutations, the command-params JSON validation (web `paramsError`), and the reused option
/// projections. The web component is a controlled form, so these assert the form logic directly.
@MainActor final class ActionBuilderPageModelTests: XCTestCase {
    private struct StubProvider: ActionBuilderPageProviding {
        let value: ActionBuilderPageInput
        init(_ value: ActionBuilderPageInput) {
            self.value = value
        }

        func load() async -> ActionBuilderPageInput {
            value
        }
    }

    private let channels: [NotificationChannelSummary] = [
        NotificationChannelSummary(id: 7, name: "Home", kind: .discord, enabled: true),
        NotificationChannelSummary(id: 9, name: "Off", kind: .pushover, enabled: false)
    ]

    private func model(
        _ actions: [AutomationAction] = [],
        channels: [NotificationChannelSummary] = []
    ) -> ActionBuilderPageModel {
        ActionBuilderPageModel(provider: StubProvider(ActionBuilderPageInput(actions: actions, channels: channels)))
    }

    // MARK: - States

    func testInitialStateIsLoading() {
        let model = model([.notify(channelID: 0, template: "")])
        XCTAssertEqual(model.state, .loading)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = model()
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testLoadPopulatesSuccess() async {
        let model = model([.callAutomation(targetID: 3), .notify(channelID: 7, template: "Hi")], channels: channels)
        await model.load()
        XCTAssertEqual(model.state, .success)
        XCTAssertEqual(model.rows.count, 2)
        XCTAssertEqual(model.channels.count, 2)
    }

    func testDefaultProviderLoadsRepresentativeState() async {
        let model = ActionBuilderPageModel(provider: DefaultActionBuilderPageData())
        await model.load()
        XCTAssertEqual(model.state, .success)
        XCTAssertEqual(model.rows.count, 3)
        // The seeded command action's params are pretty-printed back into the editor text.
        XCTAssertEqual(model.rows.first?.paramsText, "{\n  \"percent\": 80\n}")
    }

    // MARK: - Add / remove / move

    func testAddActionAppendsDefaultCommand() async {
        let model = model(channels: channels)
        await model.load()
        XCTAssertEqual(model.state, .empty)
        model.addAction()
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(model.rows[0].action.kind, .command)
        XCTAssertEqual(model.state, .success)
    }

    func testRemoveAction() async {
        let model = model([.callAutomation(targetID: 1), .callAutomation(targetID: 2)])
        await model.load()
        let firstID = model.rows[0].id
        model.removeAction(id: firstID)
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(model.rows[0].action, .callAutomation(targetID: 2))
    }

    func testMoveActionSwapsAndGuards() async {
        let model = model([.callAutomation(targetID: 1), .callAutomation(targetID: 2)])
        await model.load()
        let top = model.rows[0].id
        let bottom = model.rows[1].id
        XCTAssertFalse(model.canMove(id: top, .up))
        XCTAssertTrue(model.canMove(id: top, .down))
        XCTAssertFalse(model.canMove(id: bottom, .down))
        model.moveAction(id: top, .down)
        XCTAssertEqual(model.rows[0].action, .callAutomation(targetID: 2))
        XCTAssertEqual(model.rows[1].action, .callAutomation(targetID: 1))
        // Out-of-range move is a no-op.
        model.moveAction(id: model.rows[1].id, .down)
        XCTAssertEqual(model.rows[1].action, .callAutomation(targetID: 1))
    }

    // MARK: - Change kind / replace

    func testChangeKindReplacesWithDefaultAndReseeds() async {
        let model = model([.command(commandName: "lock", params: .object([ActionJSONMember("a", .number("1"))]))])
        await model.load()
        let id = model.rows[0].id
        XCTAssertFalse(model.rows[0].paramsText.isEmpty)
        model.changeKind(id: id, to: .setSetting)
        XCTAssertEqual(model.rows[0].action.kind, .setSetting)
        XCTAssertEqual(model.rows[0].action, .setSetting(key: "", value: .text("")))
        XCTAssertTrue(model.rows[0].paramsText.isEmpty)
        XCTAssertNil(model.rows[0].paramsError)
    }

    func testReplaceActionUpdatesValue() async {
        let model = model([.notify(channelID: 7, template: "Hi")])
        await model.load()
        let id = model.rows[0].id
        model.replaceAction(id: id, with: .notify(channelID: 9, template: "Bye"))
        XCTAssertEqual(model.rows[0].action, .notify(channelID: 9, template: "Bye"))
    }

    // MARK: - Command-params validation (the error data state)

    func testUpdateParamsValidObjectCommits() async {
        let model = model([.command(commandName: "set_temps", params: nil)])
        await model.load()
        let id = model.rows[0].id
        model.updateParams(id: id, text: "{\"temp\": 21}")
        XCTAssertNil(model.rows[0].paramsError)
        XCTAssertEqual(model.state, .success)
        XCTAssertEqual(
            model.rows[0].action,
            .command(commandName: "set_temps", params: .object([ActionJSONMember("temp", .number("21"))]))
        )
    }

    func testUpdateParamsEmptyClears() async {
        let model = model([.command(commandName: "set_temps", params: .object([ActionJSONMember("t", .number("1"))]))])
        await model.load()
        let id = model.rows[0].id
        model.updateParams(id: id, text: "   ")
        XCTAssertNil(model.rows[0].paramsError)
        XCTAssertEqual(model.rows[0].action, .command(commandName: "set_temps", params: nil))
    }

    func testUpdateParamsNonObjectYieldsErrorState() async {
        let model = model([.command(commandName: "set_temps", params: nil)])
        await model.load()
        let id = model.rows[0].id
        model.updateParams(id: id, text: "[1, 2]")
        XCTAssertNotNil(model.rows[0].paramsError)
        XCTAssertTrue(model.hasValidationError)
        XCTAssertEqual(model.state, .error)
    }

    func testUpdateParamsMalformedYieldsErrorState() async {
        let model = model([.command(commandName: "set_temps", params: nil)])
        await model.load()
        let id = model.rows[0].id
        model.updateParams(id: id, text: "{ broken")
        XCTAssertNotNil(model.rows[0].paramsError)
        XCTAssertEqual(model.state, .error)
        // Fixing the JSON returns the page to success.
        model.updateParams(id: id, text: "{\"ok\": true}")
        XCTAssertNil(model.rows[0].paramsError)
        XCTAssertEqual(model.state, .success)
    }

    func testUpdateParamsIgnoresNonCommandRows() async {
        let model = model([.callAutomation(targetID: 1)])
        await model.load()
        let id = model.rows[0].id
        model.updateParams(id: id, text: "{\"x\": 1}")
        XCTAssertEqual(model.rows[0].action, .callAutomation(targetID: 1))
        XCTAssertNil(model.rows[0].paramsError)
    }

    // MARK: - Projections

    func testChannelAndCommandProjections() async {
        let model = model(channels: channels)
        await model.load()
        XCTAssertEqual(model.defaultChannelID, 7)
        XCTAssertEqual(model.channelOptions.count, 2)
        XCTAssertTrue(model.channelOptions[1].disabled)
        // The first command option is the "Select command..." sentinel.
        XCTAssertEqual(model.commandOptions.first?.value, "")
        XCTAssertGreaterThan(model.commandOptions.count, 1)
    }

    func testRefreshReseeds() async {
        let model = model([.callAutomation(targetID: 5)])
        await model.load()
        model.addAction()
        XCTAssertEqual(model.rows.count, 2)
        await model.refresh()
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(model.rows[0].action, .callAutomation(targetID: 5))
    }
}
