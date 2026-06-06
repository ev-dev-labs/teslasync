import XCTest
@testable import TeslaSync

/// The Live Activity controller: per-kind id tracking, start/update/end lifecycle,
/// and honest degradation when the presenter is unsupported (macOS / old OS).
@MainActor
final class LiveActivityControllerTests: XCTestCase {
    func testStartTracksActiveAndPresenterRecords() async {
        let presenter = PreviewLiveActivityPresenter()
        let controller = LiveActivityController(presenter: presenter)

        let started = await controller.startCharging(
            vehicleName: "Model 3",
            state: .init(batteryLevel: 0.5, chargeLimit: 0.8)
        )
        XCTAssertTrue(started)
        XCTAssertTrue(controller.activeKinds.contains(.charging))
        XCTAssertEqual(presenter.starts, [.charging])
    }

    func testUpdateThenEndClearsActive() async {
        let presenter = PreviewLiveActivityPresenter()
        let controller = LiveActivityController(presenter: presenter)

        _ = await controller.startCharging(vehicleName: "M3", state: .init(batteryLevel: 0.5, chargeLimit: 0.8))
        await controller.updateCharging(.init(batteryLevel: 0.7, chargeLimit: 0.8))
        await controller.endCharging()

        XCTAssertFalse(controller.activeKinds.contains(.charging))
        XCTAssertEqual(presenter.updates, [.charging])
        XCTAssertEqual(presenter.ends, [.charging])
    }

    func testStartingSameKindTwiceFoldsIntoUpdate() async {
        let presenter = PreviewLiveActivityPresenter()
        let controller = LiveActivityController(presenter: presenter)

        _ = await controller.startDrive(
            vehicleName: "M3",
            state: .init(distanceMeters: 0, durationSeconds: 0, batteryLevel: 0.9)
        )
        _ = await controller.startDrive(
            vehicleName: "M3",
            state: .init(distanceMeters: 10, durationSeconds: 5, batteryLevel: 0.9)
        )

        XCTAssertEqual(presenter.starts, [.drive], "a second start for the same kind does not start a new activity")
        XCTAssertEqual(presenter.updates, [.drive], "it folds into an update instead")
    }

    func testUnsupportedPresenterDegradesHonestly() async {
        let controller = LiveActivityController(presenter: NoopLiveActivityPresenter())
        XCTAssertFalse(controller.isSupported)

        let started = await controller.startCommand(
            vehicleName: "M3",
            commandName: "Climate On",
            state: .init(status: .pending)
        )
        XCTAssertFalse(started, "an unsupported presenter never starts an activity")
        XCTAssertTrue(controller.activeKinds.isEmpty)
    }

    func testEndAllClearsEveryKind() async {
        let presenter = PreviewLiveActivityPresenter()
        let controller = LiveActivityController(presenter: presenter)

        _ = await controller.startCharging(vehicleName: "M3", state: .init(batteryLevel: 0.5, chargeLimit: 0.8))
        _ = await controller.startCommand(vehicleName: "M3", commandName: "Honk", state: .init(status: .sent))
        await controller.endAll()

        XCTAssertTrue(controller.activeKinds.isEmpty)
        XCTAssertEqual(Set(presenter.ends), [.charging, .command])
    }
}
