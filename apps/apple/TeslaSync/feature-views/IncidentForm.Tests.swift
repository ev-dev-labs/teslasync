//
//  IncidentForm.Tests.swift
//  TeslaSync — P4 feature view · 0246 · IncidentForm (Apple)
//
//  Unit coverage for the IncidentForm surface: the Adapter projections (title validity +
//  the trim/`maxLength` clamps, the comma-split affected-components parser, the create
//  request builder incl. the `initial_message` trim→undefined rule, the submit-button
//  label, the toast content for every outcome incl. the `err.message`→fallback branch, and
//  the accessibility builders), the `IncidentFormModel` state holder (idle/submitting/
//  succeeded/failed lifecycle, the validation early-return that never calls the seam, the
//  success-path invalidation + dismiss signal, the re-entrancy guard, the toast dismiss,
//  and the P1/S11 `view.opened` telemetry), and the i18n facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by the in-memory + controllable seams.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: validation, request build, labels, toast, a11y

@MainActor final class IncidentFormAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (LocalizedText) -> String = { $0.fallback }

    // Title validity (web `title.trim().length < 3`)

    func testTitleValidity() {
        XCTAssertFalse(IncidentFormAdapter.isTitleValid(""))
        XCTAssertFalse(IncidentFormAdapter.isTitleValid("  "))
        XCTAssertFalse(IncidentFormAdapter.isTitleValid("ab"))
        XCTAssertFalse(IncidentFormAdapter.isTitleValid("  ab  "))
        XCTAssertTrue(IncidentFormAdapter.isTitleValid("abc"))
        XCTAssertTrue(IncidentFormAdapter.isTitleValid("  abc  "))
        XCTAssertTrue(IncidentFormAdapter.isValid(IncidentDraft(title: "Outage")))
        XCTAssertFalse(IncidentFormAdapter.isValid(IncidentDraft(title: "no")))
    }

    // Field clamps (web `maxLength={200}` / `maxLength={4000}`)

    func testTitleClampToMaxLength() {
        let long = String(repeating: "x", count: 250)
        XCTAssertEqual(IncidentFormAdapter.clampTitle(long).count, IncidentFieldBounds.titleMaxLength)
        XCTAssertEqual(IncidentFormAdapter.clampTitle("short"), "short")
    }

    func testMessageClampToMaxLength() {
        let long = String(repeating: "y", count: 4200)
        XCTAssertEqual(IncidentFormAdapter.clampMessage(long).count, IncidentFieldBounds.messageMaxLength)
        XCTAssertEqual(IncidentFormAdapter.clampMessage("hi"), "hi")
    }

    // Affected-components parse (web `split(',').map(trim).filter(Boolean)`)

    func testParseComponents() {
        XCTAssertEqual(IncidentFormAdapter.parseComponents(""), [])
        XCTAssertEqual(IncidentFormAdapter.parseComponents("   "), [])
        XCTAssertEqual(IncidentFormAdapter.parseComponents("tesla"), ["tesla"])
        XCTAssertEqual(IncidentFormAdapter.parseComponents("tesla, telemetry"), ["tesla", "telemetry"])
        XCTAssertEqual(IncidentFormAdapter.parseComponents(" tesla ,, telemetry , "), ["tesla", "telemetry"])
    }

    // Request build (web create body) — trim title, initial_message trim→nil, components

    func testMakeRequestValidDraft() {
        let draft = IncidentDraft(
            title: "  Wall connector restart  ",
            severity: .major,
            status: .identified,
            components: "tesla, , telemetry",
            message: "  looking into it  "
        )
        let request = IncidentFormAdapter.makeRequest(from: draft)
        XCTAssertEqual(request?.title, "Wall connector restart")
        XCTAssertEqual(request?.severity, .major)
        XCTAssertEqual(request?.status, .identified)
        XCTAssertEqual(request?.initialMessage, "looking into it")
        XCTAssertEqual(request?.affectedComponents, ["tesla", "telemetry"])
    }

    func testMakeRequestEmptyMessageBecomesNil() {
        let draft = IncidentDraft(title: "Outage", message: "   ")
        let request = IncidentFormAdapter.makeRequest(from: draft)
        XCTAssertNil(request?.initialMessage)
        XCTAssertEqual(request?.affectedComponents, [])
    }

    func testMakeRequestReturnsNilWhenTitleTooShort() {
        XCTAssertNil(IncidentFormAdapter.makeRequest(from: IncidentDraft(title: "no")))
        XCTAssertNil(IncidentFormAdapter.makeRequest(from: IncidentDraft(title: "  ")))
    }

    // Submit-button label (web `isPending ? 'Logging…' : 'Log incident'`)

    func testSubmitLabelProjection() {
        XCTAssertEqual(IncidentFormAdapter.submitLabel(isSubmitting: false).key, "status.incidentForm.action.submit")
        XCTAssertEqual(IncidentFormAdapter.submitLabel(isSubmitting: false).fallback, "Log incident")
        XCTAssertEqual(IncidentFormAdapter.submitLabel(isSubmitting: true).key, "status.incidentForm.action.submitting")
        XCTAssertEqual(IncidentFormAdapter.submitLabel(isSubmitting: true).fallback, "Logging…")
    }

    // Toast content (web `useToast` validation / success / error branches)

    func testToastValidationProjection() {
        let toast = IncidentFormToast.project(.validationFailed, localize: echo)
        XCTAssertEqual(toast?.kind, .validation)
        XCTAssertEqual(toast?.tone, .danger)
        XCTAssertEqual(toast?.message, "Title must be at least 3 characters.")
        XCTAssertEqual(toast?.systemImage, "exclamationmark.triangle.fill")
    }

    func testToastSuccessProjection() {
        let toast = IncidentFormToast.project(.succeeded, localize: echo)
        XCTAssertEqual(toast?.kind, .success)
        XCTAssertEqual(toast?.tone, .success)
        XCTAssertEqual(toast?.message, "Incident logged.")
        XCTAssertEqual(toast?.systemImage, "checkmark.circle.fill")
    }

    func testToastOfflineProjection() {
        let toast = IncidentFormToast.project(.offline, localize: echo)
        XCTAssertEqual(toast?.kind, .offline)
        XCTAssertEqual(toast?.tone, .neutral)
        XCTAssertEqual(toast?.systemImage, "wifi.slash")
    }

    func testToastFailureUsesServerMessageWhenPresent() {
        let toast = IncidentFormToast.project(.failed(message: "title already exists"), localize: echo)
        XCTAssertEqual(toast?.kind, .failed)
        XCTAssertEqual(toast?.tone, .danger)
        XCTAssertEqual(toast?.message, "title already exists")
    }

    func testToastFailureFallsBackWhenMessageEmpty() {
        let toast = IncidentFormToast.project(.failed(message: "   "), localize: echo)
        XCTAssertEqual(toast?.message, "Failed to log incident")
    }

    // Accessibility builders

    func testAccessibilityBuilders() {
        XCTAssertEqual(IncidentFormAccessibility.submitLabel(isSubmitting: false, localize: echo), "Log incident")
        XCTAssertEqual(IncidentFormAccessibility.submitLabel(isSubmitting: true, localize: echo), "Logging…")
        XCTAssertEqual(IncidentFormAccessibility.cancelLabel(localize: echo), "Cancel")
        XCTAssertEqual(IncidentFormAccessibility.submitID, "incident-form-submit")
        XCTAssertEqual(IncidentFormAccessibility.cancelID, "incident-form-cancel")
    }

    // Enum option order matches the web `<Select>` order

    func testOptionOrderMatchesWeb() {
        XCTAssertEqual(IncidentSeverity.allCases, [.minor, .major, .critical])
        XCTAssertEqual(IncidentStatus.allCases, [.investigating, .identified, .monitoring, .resolved])
    }
}

// MARK: - State holder: submit lifecycle + validation guard + telemetry

@MainActor final class IncidentFormModelTests: XCTestCase {
    private func waitUntilSubmitting(_ model: IncidentFormModel) async {
        for _ in 0 ..< 50 where !model.isSubmitting {
            await Task.yield()
        }
    }

    func testInitialStateIsIdle() {
        let model = IncidentFormModel(source: InMemoryIncidentCreator())
        XCTAssertEqual(model.submitPhase, .idle)
        XCTAssertFalse(model.isSubmitting)
        XCTAssertFalse(model.isSubmitDisabled)
        XCTAssertEqual(model.severity, .minor)
        XCTAssertEqual(model.status, .investigating)
        XCTAssertEqual(model.submitLabel.key, "status.incidentForm.action.submit")
        XCTAssertNil(model.toast)
        XCTAssertNil(model.lastCreated)
        XCTAssertFalse(model.shouldDismiss)
    }

    func testSubmitSuccessSetsSucceededInvalidatesAndDismisses() async {
        let source = InMemoryIncidentCreator(result: .success(CreatedIncidentSummary(id: 9, title: "Outage")))
        let model = IncidentFormModel(source: source)
        model.setTitle("Wall connector restart")
        model.severity = .critical
        model.status = .monitoring
        model.components = "tesla, telemetry"
        model.setMessage("looking into it")

        await model.submit()

        XCTAssertEqual(model.submitPhase, .succeeded)
        XCTAssertEqual(model.toast?.kind, .success)
        XCTAssertEqual(model.toast?.message, "Incident logged.")
        XCTAssertEqual(model.lastCreated, CreatedIncidentSummary(id: 9, title: "Outage"))
        XCTAssertTrue(model.shouldDismiss)
        XCTAssertEqual(source.createCount, 1)
        XCTAssertEqual(source.invalidateCount, 1)
        // The request mirrors the web body exactly.
        XCTAssertEqual(source.lastRequest?.title, "Wall connector restart")
        XCTAssertEqual(source.lastRequest?.severity, .critical)
        XCTAssertEqual(source.lastRequest?.status, .monitoring)
        XCTAssertEqual(source.lastRequest?.initialMessage, "looking into it")
        XCTAssertEqual(source.lastRequest?.affectedComponents, ["tesla", "telemetry"])
    }

    func testSubmitValidationFailureSkipsSeamAndStaysOpen() async {
        let source = InMemoryIncidentCreator()
        let model = IncidentFormModel(source: source)
        model.setTitle("no") // < 3 chars after trim

        await model.submit()

        XCTAssertEqual(model.submitPhase, .idle)
        XCTAssertEqual(model.toast?.kind, .validation)
        XCTAssertEqual(model.toast?.message, "Title must be at least 3 characters.")
        XCTAssertFalse(model.shouldDismiss)
        XCTAssertEqual(source.createCount, 0)
        XCTAssertEqual(source.invalidateCount, 0)
    }

    func testSubmitOfflineSurfacesOfflineToastWithoutDismiss() async {
        let source = InMemoryIncidentCreator(result: .failure(.offline))
        let model = IncidentFormModel(source: source)
        model.setTitle("Outage in progress")

        await model.submit()

        XCTAssertEqual(model.submitPhase, .failed(kind: .offline))
        XCTAssertEqual(model.toast?.kind, .offline)
        XCTAssertEqual(model.toast?.tone, .neutral)
        XCTAssertFalse(model.shouldDismiss)
        XCTAssertEqual(source.invalidateCount, 0)
    }

    func testSubmitGenericFailureSurfacesServerMessage() async {
        let source = InMemoryIncidentCreator(result: .failure(.failed(message: "title already exists")))
        let model = IncidentFormModel(source: source)
        model.setTitle("Outage in progress")

        await model.submit()

        XCTAssertEqual(model.submitPhase, .failed(kind: .failed))
        XCTAssertEqual(model.toast?.message, "title already exists")
        XCTAssertFalse(model.shouldDismiss)
        XCTAssertEqual(source.invalidateCount, 0)
    }

    func testSubmittingStateWhileInFlightThenSucceeds() async {
        let source = ControllableIncidentCreator()
        let model = IncidentFormModel(source: source)
        model.setTitle("Wall connector restart")
        let task = Task { await model.submit() }
        await waitUntilSubmitting(model)
        XCTAssertTrue(model.isSubmitting)
        XCTAssertTrue(model.isSubmitDisabled)
        XCTAssertEqual(model.submitLabel.key, "status.incidentForm.action.submitting")
        XCTAssertNil(model.toast)

        source.complete(CreatedIncidentSummary(id: 7, title: "Wall connector restart"))
        await task.value
        XCTAssertEqual(model.submitPhase, .succeeded)
        XCTAssertTrue(model.shouldDismiss)
        XCTAssertEqual(source.invalidateCount, 1)
    }

    func testSubmitGuardsAgainstConcurrentRuns() async {
        let source = ControllableIncidentCreator()
        let model = IncidentFormModel(source: source)
        model.setTitle("Wall connector restart")
        let task = Task { await model.submit() }
        await waitUntilSubmitting(model)
        await model.submit() // second call must early-return while a create is in flight
        XCTAssertEqual(source.createCount, 1)
        source.complete()
        await task.value
    }

    func testSetTitleAndMessageClampToBounds() {
        let model = IncidentFormModel(source: InMemoryIncidentCreator())
        model.setTitle(String(repeating: "x", count: 250))
        XCTAssertEqual(model.title.count, IncidentFieldBounds.titleMaxLength)
        model.setMessage(String(repeating: "y", count: 4200))
        XCTAssertEqual(model.message.count, IncidentFieldBounds.messageMaxLength)
    }

    func testDismissToastClears() async {
        let model = IncidentFormModel(source: InMemoryIncidentCreator(result: .failure(.offline)))
        model.setTitle("Outage in progress")
        await model.submit()
        XCTAssertNotNil(model.toast)
        model.dismissToast()
        XCTAssertNil(model.toast)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyIncidentTelemetry()
        let model = IncidentFormModel(source: InMemoryIncidentCreator(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [IncidentFormSurface.slug])
        XCTAssertEqual(IncidentFormSurface.slug, "IncidentForm")
    }

    func testLocalizationFacadeReturnsFallback() {
        XCTAssertEqual(
            IncidentFormStrings.string("status.incidentForm.action.submit", "Log incident"),
            "Log incident"
        )
        XCTAssertEqual(IncidentFormStrings.string(IncidentFormText.toastSuccess), "Incident logged.")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyIncidentTelemetry: IncidentFormTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
