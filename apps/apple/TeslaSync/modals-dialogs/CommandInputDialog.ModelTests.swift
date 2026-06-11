//
//  CommandInputDialog.ModelTests.swift
//  TeslaSync — P4 modal/dialog · 0030 · CommandInputDialog (Apple)
//
//  State-holder coverage for `CommandInputDialogModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across loading / loaded-empty / failed (incl. keeping content when
//  a cached command survives a failed reload), the form rebuild on a fresh command (web `useEffect` on
//  `open`) + the re-open-after-clear re-arm + the default-value seeding, validate-on-blur, the
//  revalidate-on-change-only-when-touched rule, the submit gate (validate all, mark touched, route only
//  when valid, no-op while submitting), cancel, the in-flight submit flag, the stale auto-refresh (once,
//  re-armed on return to live), and offline keeping the form. Driven through the in-memory source — no
//  HTTP, no queue.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under
/// Swift 6 strict concurrency.
private final class SpyCommandInputTelemetry: CommandInputTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }

    var surfaces: [String] {
        lock.withLock { storage }
    }
}

/// Records submitted value maps + cancel calls.
private final class SpyCommandInputController: CommandInputController, @unchecked Sendable {
    private let lock = NSLock()
    private var submitted: [[String: String]] = []
    private var cancels = 0

    func submit(_ values: [String: String]) {
        lock.withLock { submitted.append(values) }
    }

    func cancel() {
        lock.withLock { cancels += 1 }
    }

    var submissions: [[String: String]] {
        lock.withLock { submitted }
    }

    var cancelCount: Int {
        lock.withLock { cancels }
    }
}

@MainActor
final class CommandInputDialogModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryCommandInputSource,
        telemetry: SpyCommandInputTelemetry = SpyCommandInputTelemetry(),
        controller: SpyCommandInputController = SpyCommandInputController()
    ) -> CommandInputDialogModel {
        CommandInputDialogModel(
            source: source,
            telemetry: telemetry,
            controller: controller,
            localize: passthroughLocalize
        )
    }

    private func pinSpec(commandID: String = "speed_limit_on") -> CommandInputSpec {
        CommandInputSpec(
            commandID: commandID, titleKey: "k", titleFallback: "Activate",
            promptKey: "p", promptFallback: "Enter 4-digit PIN:",
            fields: [CommandInputField(name: "pin", validation: .pin)]
        )
    }

    private func defaultedSpec() -> CommandInputSpec {
        CommandInputSpec(
            commandID: "charge_limit", titleKey: "k", titleFallback: "Set Limit",
            promptKey: "p", promptFallback: "Enter %",
            fields: [CommandInputField(
                name: "percent",
                validation: .number,
                minValue: 50,
                maxValue: 100,
                initialValue: "80"
            )]
        )
    }

    private func context(_ spec: CommandInputSpec) -> CommandInputContext {
        CommandInputContext(spec: spec, vehicleDisplayName: "My Tesla")
    }

    // MARK: Telemetry + phases

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyCommandInputTelemetry()
        let source = InMemoryCommandInputSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["CommandInputDialog"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContentSeedsFields() {
        let source = InMemoryCommandInputSource(initial: CommandInputUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(CommandInputUpdate(status: .loaded, context: context(pinSpec())))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.fields.map(\.name), ["pin"])
        XCTAssertEqual(model.value(for: "pin"), "")
    }

    func testLoadedNoContextResolvesEmpty() {
        let source = InMemoryCommandInputSource(initial: CommandInputUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedNoContextResolvesError() {
        let source = InMemoryCommandInputSource(initial: CommandInputUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testFailedWithContextKeepsContent() {
        let loaded = CommandInputUpdate(status: .loaded, context: context(pinSpec()))
        let source = InMemoryCommandInputSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(CommandInputUpdate(status: .failed("stale read"), context: context(pinSpec())))
        XCTAssertEqual(model.phase, .content)
    }

    // MARK: Form rebuild + default seeding

    func testDefaultValueSeededOnLoad() {
        let source = InMemoryCommandInputSource(
            initial: CommandInputUpdate(status: .loaded, context: context(defaultedSpec()))
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.value(for: "percent"), "80")
    }

    func testFormRebuildsOnNewCommandButNotOnSame() {
        let source = InMemoryCommandInputSource(
            initial: CommandInputUpdate(status: .loaded, context: context(pinSpec(commandID: "a")))
        )
        let model = makeModel(source: source)
        model.start()
        model.updateValue("pin", "1234")
        // Same command re-push must NOT clobber the user's entry.
        source.push(CommandInputUpdate(status: .loaded, context: context(pinSpec(commandID: "a"))))
        XCTAssertEqual(model.value(for: "pin"), "1234")
        // A different command DOES rebuild the form.
        source.push(CommandInputUpdate(status: .loaded, context: context(pinSpec(commandID: "b"))))
        XCTAssertEqual(model.value(for: "pin"), "")
    }

    func testReopeningSameCommandAfterClearRebuilds() {
        let source = InMemoryCommandInputSource(
            initial: CommandInputUpdate(status: .loaded, context: context(pinSpec(commandID: "a")))
        )
        let model = makeModel(source: source)
        model.start()
        model.updateValue("pin", "1234")
        source.push(CommandInputUpdate(status: .loaded, context: nil))
        source.push(CommandInputUpdate(status: .loaded, context: context(pinSpec(commandID: "a"))))
        XCTAssertEqual(model.value(for: "pin"), "")
    }

    // MARK: Validation lifecycle (blur / change-when-touched)

    func testBlurValidatesAndSurfacesError() {
        let source = InMemoryCommandInputSource(
            initial: CommandInputUpdate(status: .loaded, context: context(pinSpec()))
        )
        let model = makeModel(source: source)
        model.start()
        model.updateValue("pin", "12")
        XCTAssertNil(model.visibleError(for: "pin")) // not touched yet
        model.blurField("pin")
        XCTAssertEqual(model.visibleError(for: "pin"), "Enter a 4-digit PIN")
    }

    func testRevalidatesOnChangeOnlyAfterTouched() {
        let source = InMemoryCommandInputSource(
            initial: CommandInputUpdate(status: .loaded, context: context(pinSpec()))
        )
        let model = makeModel(source: source)
        model.start()
        model.blurField("pin") // empty → Required, now touched
        XCTAssertEqual(model.visibleError(for: "pin"), "Required")
        model.updateValue("pin", "1234") // touched → revalidate → clears
        XCTAssertNil(model.visibleError(for: "pin"))
    }

    // MARK: Submit gate

    func testSubmitBlocksWhenInvalidMarksTouchedAndDoesNotRoute() {
        let controller = SpyCommandInputController()
        let source = InMemoryCommandInputSource(
            initial: CommandInputUpdate(status: .loaded, context: context(pinSpec()))
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.submit()
        XCTAssertTrue(controller.submissions.isEmpty)
        XCTAssertEqual(model.visibleError(for: "pin"), "Required")
        XCTAssertFalse(model.isValid)
    }

    func testSubmitRoutesValuesWhenValid() {
        let controller = SpyCommandInputController()
        let source = InMemoryCommandInputSource(
            initial: CommandInputUpdate(status: .loaded, context: context(pinSpec()))
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.updateValue("pin", "1234")
        XCTAssertTrue(model.isValid)
        model.submit()
        XCTAssertEqual(controller.submissions, [["pin": "1234"]])
    }

    func testSubmitIsNoOpWhileSubmitting() {
        let controller = SpyCommandInputController()
        let source = InMemoryCommandInputSource(
            initial: CommandInputUpdate(status: .loaded, context: context(pinSpec()), submitting: true)
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.updateValue("pin", "1234")
        XCTAssertTrue(model.submitting)
        model.submit()
        XCTAssertTrue(controller.submissions.isEmpty)
    }

    // MARK: Cancel + freshness

    func testCancelDelegatesToController() {
        let controller = SpyCommandInputController()
        let source = InMemoryCommandInputSource(
            initial: CommandInputUpdate(status: .loaded, context: context(pinSpec()))
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.cancel()
        XCTAssertEqual(controller.cancelCount, 1)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let loaded = CommandInputUpdate(status: .loaded, context: context(pinSpec()))
        let source = InMemoryCommandInputSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(CommandInputUpdate(status: .loaded, context: context(pinSpec()), connection: .stale))
        source.push(CommandInputUpdate(status: .loaded, context: context(pinSpec()), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(CommandInputUpdate(status: .loaded, context: context(pinSpec()), connection: .live))
        source.push(CommandInputUpdate(status: .loaded, context: context(pinSpec()), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let loaded = CommandInputUpdate(status: .loaded, context: context(pinSpec()))
        let source = InMemoryCommandInputSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(CommandInputUpdate(status: .loaded, context: context(pinSpec()), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
