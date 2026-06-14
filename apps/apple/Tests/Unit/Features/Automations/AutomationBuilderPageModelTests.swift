import XCTest
@testable import TeslaSync

/// Recording double for the builder data-source seam (file scope keeps the test class body small).
private actor BuilderStub: AutomationBuilderDataSource {
    var automation: AutomationFull?
    var preset: AutomationPreset?
    var vehicles: [AutomationVehicleRef]
    var channels: [NotificationChannelSummary]
    var loadError: Error?
    private(set) var createdInputs: [AutomationFullInput] = []
    private(set) var updatedInputs: [(id: Int64, input: AutomationFullInput)] = []
    private(set) var testRunIDs: [Int64] = []

    init(
        automation: AutomationFull? = nil,
        preset: AutomationPreset? = nil,
        vehicles: [AutomationVehicleRef] = [],
        channels: [NotificationChannelSummary] = [],
        loadError: Error? = nil
    ) {
        self.automation = automation
        self.preset = preset
        self.vehicles = vehicles
        self.channels = channels
        self.loadError = loadError
    }

    func useAutomation(id _: Int64) async throws -> AutomationFull? {
        if let loadError { throw loadError }
        return automation
    }

    func useAutomationPreset(id _: String) async throws -> AutomationPreset? {
        preset
    }

    func useVehicles() async throws -> [AutomationVehicleRef] {
        vehicles
    }

    func useNotificationChannels() async throws -> [NotificationChannelSummary] {
        channels
    }

    func useCreateAutomationFull(_ input: AutomationFullInput) async throws -> AutomationSaveResult {
        createdInputs.append(input)
        return AutomationSaveResult(id: 500)
    }

    func useUpdateAutomationFull(id: Int64, input: AutomationFullInput) async throws -> AutomationSaveResult {
        updatedInputs.append((id, input))
        return AutomationSaveResult(id: id)
    }

    func useTestRunAutomation(id: Int64) async throws {
        testRunIDs.append(id)
    }
}

private struct StubError: Error {}

private func sampleAutomation(id: Int64 = 42) -> AutomationFull {
    AutomationFull(
        id: id, name: "Precondition", description: "warm up", vehicleID: 7, enabled: true,
        triggers: [.signal(SignalTrigger(signal: "battery_level", op: .lessThan, value: .number(30)))],
        conditions: [], actions: [.command(commandName: "climate_on", params: nil)]
    )
}

@MainActor
final class AutomationBuilderPageModelTests: XCTestCase {
    // MARK: Phase resolution (web loading / content / not-found / error)

    func testCreateModeReadyAfterLoad() async {
        let model = AutomationBuilderPageModel(mode: .create, dataSource: BuilderStub(vehicles: [
            AutomationVehicleRef(id: 1, displayName: "Model 3")
        ]))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.vehicles.count, 1)
    }

    func testEditModeHydratesForm() async {
        let model = AutomationBuilderPageModel(mode: .edit(42), dataSource: BuilderStub(automation: sampleAutomation()))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.form.name, "Precondition")
        XCTAssertEqual(model.form.vehicleID, 7)
        XCTAssertEqual(model.existingName, "Precondition")
        XCTAssertNotNil(model.form.trigger)
    }

    func testEditModeNotFound() async {
        let model = AutomationBuilderPageModel(mode: .edit(99), dataSource: BuilderStub(automation: nil))
        await model.load()
        XCTAssertEqual(model.phase, .notFound)
    }

    func testEditModeError() async {
        let model = AutomationBuilderPageModel(mode: .edit(99), dataSource: BuilderStub(loadError: StubError()))
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
    }

    func testPresetModeHydrates() async {
        let preset = AutomationPreset(
            name: "Preheat", description: "schedule",
            triggers: [.schedule(cronExpr: "0 8 * * *", timezone: "UTC")]
        )
        let model = AutomationBuilderPageModel(mode: .preset("p1"), dataSource: BuilderStub(preset: preset))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.form.name, "Preheat")
        XCTAssertEqual(model.form.trigger?.kind, .schedule)
    }

    // MARK: Validation (web `validate()` ordered rules)

    func testValidationNameRequired() {
        var form = AutomationBuilderForm()
        form.name = "  "
        XCTAssertEqual(AutomationBuilderValidation.validate(form), .name)
    }

    func testValidationTriggerRequired() {
        var form = AutomationBuilderForm(name: "Has name")
        form.trigger = nil
        XCTAssertEqual(AutomationBuilderValidation.validate(form), .trigger)
    }

    func testValidationTriggerPlace() {
        let form = AutomationBuilderForm(
            name: "Has name",
            trigger: .geofence(placeID: 0, event: .enter, dwellMinutes: nil)
        )
        XCTAssertEqual(AutomationBuilderValidation.validate(form), .triggerPlace)
    }

    func testValidationConditionPlace() {
        let form = AutomationBuilderForm(
            name: "Has name",
            trigger: .event(.online),
            conditions: [AutomationConditionInput(body: .geofence(GeofenceCondition(placeId: 0, state: .inside)))]
        )
        XCTAssertEqual(AutomationBuilderValidation.validate(form), .conditionPlace)
    }

    func testValidationActionsEmpty() {
        let form = AutomationBuilderForm(name: "Has name", trigger: .event(.online), actions: [])
        XCTAssertEqual(AutomationBuilderValidation.validate(form), .actions)
    }

    func testValidationActionDetails() {
        let form = AutomationBuilderForm(
            name: "Has name",
            trigger: .event(.online),
            actions: [.command(commandName: "  ", params: nil)]
        )
        XCTAssertEqual(AutomationBuilderValidation.validate(form), .actionDetails)
    }

    func testValidationPasses() {
        let form = AutomationBuilderForm(
            name: "Has name",
            trigger: .event(.online),
            actions: [.command(commandName: "climate_on", params: nil)]
        )
        XCTAssertNil(AutomationBuilderValidation.validate(form))
    }

    // MARK: Save / test-run (web `handleSave` / `handleTestRun`)

    func testSaveCreateAssemblesPayload() async {
        let stub = BuilderStub()
        let model = AutomationBuilderPageModel(mode: .create, dataSource: stub)
        model.setName("  Morning  ")
        model.setTriggerKind(.event)
        let ok = await model.save()
        XCTAssertTrue(ok)
        XCTAssertEqual(model.savedID, 500)
        let inputs = await stub.createdInputs
        XCTAssertEqual(inputs.count, 1)
        XCTAssertEqual(inputs.first?.name, "Morning")
        XCTAssertEqual(inputs.first?.triggers.count, 1)
    }

    func testSaveUpdateUsesID() async {
        let stub = BuilderStub(automation: sampleAutomation())
        let model = AutomationBuilderPageModel(mode: .edit(42), dataSource: stub)
        await model.load()
        let ok = await model.save()
        XCTAssertTrue(ok)
        let updates = await stub.updatedInputs
        XCTAssertEqual(updates.first?.id, 42)
    }

    func testSaveValidationBlocksWrite() async {
        let stub = BuilderStub()
        let model = AutomationBuilderPageModel(mode: .create, dataSource: stub)
        model.setName("")
        let ok = await model.save()
        XCTAssertFalse(ok)
        XCTAssertNotNil(model.saveError)
        let inputs = await stub.createdInputs
        XCTAssertTrue(inputs.isEmpty)
    }

    func testTestRunAfterSave() async {
        let stub = BuilderStub()
        let model = AutomationBuilderPageModel(mode: .create, dataSource: stub)
        model.setName("Morning")
        model.setTriggerKind(.event)
        _ = await model.save()
        await model.testRun()
        XCTAssertTrue(model.testRunStarted)
        let ids = await stub.testRunIDs
        XCTAssertEqual(ids, [500])
    }

    // MARK: Derived copy

    func testVehicleLabelFallback() {
        let model = AutomationBuilderPageModel(mode: .create, dataSource: BuilderStub())
        XCTAssertEqual(model.vehicleLabel(AutomationVehicleRef(id: 3, displayName: "")), "Vehicle 3")
        XCTAssertEqual(model.vehicleLabel(AutomationVehicleRef(id: 3, displayName: "Y")), "Y")
    }

    func testSetTriggerKindSeedsDefault() {
        let model = AutomationBuilderPageModel(mode: .create, dataSource: BuilderStub())
        model.setTriggerKind(.signal)
        XCTAssertEqual(model.form.trigger?.kind, .signal)
        model.setTriggerKind(nil)
        XCTAssertNil(model.form.trigger)
    }

    func testModeTitleKeys() {
        XCTAssertEqual(AutomationBuilderMode.edit(1).leaseKey, "automation/1")
        XCTAssertEqual(AutomationBuilderMode.preset("p").leaseKey, "automation/preset/p")
        XCTAssertEqual(AutomationBuilderMode.create.leaseKey, "automation/new")
    }
}
