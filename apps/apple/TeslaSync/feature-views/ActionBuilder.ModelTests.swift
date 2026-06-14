//
//  ActionBuilder.ModelTests.swift
//  TeslaSync — P4 feature view · 0080 · ActionBuilder (Apple)
//
//  Unit coverage for the `ActionBuilderModel` state holder: it seeds rows from the
//  initial actions, applies the web add/remove/replace/change-kind/move mutations,
//  emits the updated `[AutomationAction]` to the host on every change (web `onChange`),
//  guards moves at the ends, and emits the P1/S11 `view.opened` telemetry exactly once.
//

import XCTest
@testable import TeslaSync

@MainActor final class ActionBuilderModelTests: XCTestCase {
    private func channels() -> [NotificationChannelSummary] {
        [
            NotificationChannelSummary(id: 1, name: "A", kind: .email, enabled: false),
            NotificationChannelSummary(id: 2, name: "B", kind: .slack, enabled: true)
        ]
    }

    private func model(
        _ actions: [AutomationAction],
        onChange: @escaping ([AutomationAction]) -> Void = { _ in }
    ) -> ActionBuilderModel {
        ActionBuilderModel(
            actions: actions,
            channels: channels(),
            telemetry: SpyActionBuilderTelemetry(),
            onChange: onChange
        )
    }

    func testInitSeedsRows() {
        let actions: [AutomationAction] = [.callAutomation(targetID: 3), .setSetting(key: "k", value: .text("v"))]
        let model = model(actions)
        XCTAssertEqual(model.rows.count, 2)
        XCTAssertEqual(model.actions, actions)
        XCTAssertEqual(model.defaultChannelID, 2)
        XCTAssertEqual(model.channelOptions.count, 2)
    }

    func testAddAppendsDefaultCommandAndEmits() {
        let spy = ChangeSpy()
        let model = model([], onChange: spy.capture)
        model.addAction()
        XCTAssertEqual(model.actions, [.command(commandName: "climate_on", params: nil)])
        XCTAssertEqual(spy.emissions.count, 1)
        XCTAssertEqual(spy.emissions.last, model.actions)
    }

    func testChangeKindUsesDefaultChannelForNotify() {
        let model = model([.callAutomation(targetID: 1)])
        let id = model.rows[0].id
        model.changeKind(id: id, to: .notify)
        XCTAssertEqual(model.actions, [.notify(channelID: 2, template: "")])
    }

    func testReplaceAndRemoveEmit() {
        let spy = ChangeSpy()
        let model = model([.callAutomation(targetID: 1)], onChange: spy.capture)
        let id = model.rows[0].id
        model.replaceAction(id: id, with: .callAutomation(targetID: 9))
        XCTAssertEqual(model.actions, [.callAutomation(targetID: 9)])
        model.removeAction(id: id)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertEqual(spy.emissions.count, 2)
        XCTAssertEqual(spy.emissions.last, [])
    }

    func testMoveSwapsAndGuardsEnds() {
        let model = model([
            .callAutomation(targetID: 1),
            .callAutomation(targetID: 2),
            .callAutomation(targetID: 3)
        ])
        let firstID = model.rows[0].id
        let lastID = model.rows[2].id
        model.moveAction(id: firstID, .down)
        XCTAssertEqual(model.actions.first, .callAutomation(targetID: 2))
        XCTAssertFalse(model.canMove(id: lastID, .down))
        model.moveAction(id: lastID, .down) // out of range — no-op
        XCTAssertEqual(model.actions.last, .callAutomation(targetID: 3))
    }

    func testCanMoveAndIndex() {
        let model = model([.callAutomation(targetID: 1), .callAutomation(targetID: 2)])
        let firstID = model.rows[0].id
        let lastID = model.rows[1].id
        XCTAssertFalse(model.canMove(id: firstID, .up))
        XCTAssertTrue(model.canMove(id: firstID, .down))
        XCTAssertEqual(model.index(of: lastID), 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyActionBuilderTelemetry()
        let model = ActionBuilderModel(actions: [], channels: [], telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ActionBuilderSurface.slug])
        XCTAssertEqual(ActionBuilderSurface.slug, "ActionBuilder")
    }
}

// MARK: - Spies

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyActionBuilderTelemetry: ActionBuilderTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Captures each `onChange` emission. Single-threaded test use only.
private final class ChangeSpy: @unchecked Sendable {
    private(set) var emissions: [[AutomationAction]] = []

    func capture(_ actions: [AutomationAction]) {
        emissions.append(actions)
    }
}
