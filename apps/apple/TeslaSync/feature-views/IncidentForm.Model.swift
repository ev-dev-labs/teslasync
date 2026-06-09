//
//  IncidentForm.Model.swift
//  TeslaSync — P4 feature view · 0246 · IncidentForm (Apple)
//
//  The surface identity (P1/S11 slug), the telemetry seam (P1/S11 `view.opened`), the
//  state-holder seam (P1/S8), the observable view-model, the in-memory sources for
//  previews/tests, and the i18n facade (P1/S10) for the manual incident-logging form —
//  the SwiftUI parity of features/system/components/status/IncidentForm.tsx.
//
//  The web component binds `useCreateIncident()` (POST /status/incidents, invalidates the
//  incidents list on success), `useToast()` (success/error feedback), and `useId()` (label
//  associations). The native surface binds the create + invalidation through one seam so
//  the view performs no I/O; the toast + the field/label associations are owned by the
//  model + the SwiftUI view. The view binds through `IncidentFormModel`.
//
//  SwiftUI-free (Foundation / Observation / OSLog) so the model + adapter logic compile
//  and run on a plain host; the SwiftUI chrome lives in `IncidentForm.swift`.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `IncidentForm` surface. The slug is emitted
/// with the P1/S11 `view.opened` contract and referenced by the view + tests so the two
/// never drift.
public enum IncidentFormSurface {
    public static let slug = "IncidentForm"

    /// Reports the surface becoming visible. Factored out of the view's lifecycle so it is
    /// unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any IncidentFormTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The model reports the surface's
/// appearance through this protocol so production wiring, previews, and tests can each
/// supply their own sink.
public protocol IncidentFormTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is a static,
/// non-identifying constant logged verbatim; no incident content is recorded.
public struct OSLogIncidentFormTelemetry: IncidentFormTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)` / `toast(text)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "IncidentForm" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; they are kept in a per-surface
/// table so each parallel surface prompt owns its own strings without editing the shared
/// catalog (parallel-unsafe across the concurrent slots).
public enum IncidentFormStrings {
    public static let table = "IncidentForm"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `LocalizedText` descriptor (web `t(key, fallback)`).
    public static func string(_ text: LocalizedText) -> String {
        string(text.key, text.fallback)
    }
}

// MARK: - State-holder seam (P1/S8 — web `useCreateIncident`)

/// The seam the model fires the create through. Production implements this over the shared
/// P1/S8 create-incident mutation holder + the query cache; previews/tests use
/// `InMemoryIncidentCreator` / `ControllableIncidentCreator`. The view never talks to the
/// network directly.
@MainActor
public protocol IncidentCreating: AnyObject {
    /// Creates the incident (web `create.mutateAsync(...)`, POST /status/incidents). Throws
    /// `CreateIncidentError` on failure.
    func createIncident(_ request: CreateIncidentRequest) async throws -> CreatedIncidentSummary

    /// Invalidates the incidents list after a successful create (web `useCreateIncident`
    /// `onSuccess` → `qc.invalidateQueries(['status-incidents'])`).
    func invalidateIncidents()
}

// MARK: - View-model

/// The surface's observable view-model. Owns the controlled form fields (web `useState`),
/// the submit lifecycle (web mutation status), the latest toast (web `useToast`), and the
/// dismiss signal the view honors on a successful create (web `onClose()`). No networking
/// lives here — the create is delegated to the injected seam.
@MainActor
@Observable
public final class IncidentFormModel {
    /// The submit lifecycle, mirroring the web mutation status. `failed` carries the toast
    /// kind so the view can reflect which error branch occurred.
    public enum SubmitPhase: Equatable, Sendable {
        case idle
        case submitting
        case succeeded
        case failed(kind: IncidentFormToast.Kind)
    }

    // Controlled fields (web `title` / `severity` / `status` / `components` / `message`).
    public var title: String = ""
    public var severity: IncidentSeverity = .minor
    public var status: IncidentStatus = .investigating
    public var components: String = ""
    public var message: String = ""

    public private(set) var submitPhase: SubmitPhase = .idle
    public private(set) var toast: IncidentFormToast?
    public private(set) var lastCreated: CreatedIncidentSummary?
    /// Raised once after a successful create so the view can run the web `onClose()`.
    public private(set) var shouldDismiss = false

    @ObservationIgnored private let source: any IncidentCreating
    @ObservationIgnored private let telemetry: any IncidentFormTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any IncidentCreating,
        telemetry: any IncidentFormTelemetry = OSLogIncidentFormTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
    }

    // MARK: Derived projections

    /// The assembled draft (web controlled state) fed to the pure adapter transforms.
    public var draft: IncidentDraft {
        IncidentDraft(title: title, severity: severity, status: status, components: components, message: message)
    }

    /// Whether the create mutation is in flight (web `create.isPending`).
    public var isSubmitting: Bool {
        submitPhase == .submitting
    }

    /// Whether the action buttons are rendered disabled (web `disabled={create.isPending}`).
    public var isSubmitDisabled: Bool {
        isSubmitting
    }

    /// The current submit-button label (web `isPending ? 'Logging…' : 'Log incident'`).
    public var submitLabel: LocalizedText {
        IncidentFormAdapter.submitLabel(isSubmitting: isSubmitting)
    }

    /// Whether the title currently satisfies the web `length >= 3` rule (drives the a11y
    /// "is valid" hint; the submit guard still runs on submit for parity).
    public var isTitleValid: Bool {
        IncidentFormAdapter.isTitleValid(title)
    }

    // MARK: Field intents (web bound inputs with `maxLength`)

    /// Sets the title, capped to the web `maxLength={200}`.
    public func setTitle(_ value: String) {
        title = IncidentFormAdapter.clampTitle(value)
    }

    /// Sets the initial message, capped to the web `maxLength={4000}`.
    public func setMessage(_ value: String) {
        message = IncidentFormAdapter.clampMessage(value)
    }

    // MARK: Lifecycle

    /// Emits the diagnostics `view.opened` event once (web surface mount). Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        IncidentFormSurface.reportOpen(to: telemetry)
    }

    /// Clears the current toast (web `useToast` auto-dismiss / manual close).
    public func dismissToast() {
        toast = nil
    }

    // MARK: Submit (web `handleSubmit`)

    /// Validates and fires the create mutation. Re-entrancy guarded so a double-tap can't
    /// start two creates (the web button is `disabled` while pending). On a failed title
    /// guard it surfaces the validation toast and returns WITHOUT calling the seam (web
    /// early `return`). On success it surfaces the success toast, invalidates the incidents
    /// list, and raises the dismiss signal (web `onClose()`); on failure it classifies the
    /// error into the offline or generic branch (web `onError`) and stays open.
    public func submit() async {
        guard submitPhase != .submitting else { return }

        guard let request = IncidentFormAdapter.makeRequest(from: draft) else {
            finish(.validationFailed)
            return
        }

        submitPhase = .submitting
        toast = nil
        do {
            let summary = try await source.createIncident(request)
            lastCreated = summary
            source.invalidateIncidents()
            finish(.succeeded)
        } catch let error as CreateIncidentError {
            switch error {
            case .offline:
                finish(.offline)
            case let .failed(message):
                finish(.failed(message: message))
            }
        } catch {
            finish(.failed(message: error.localizedDescription))
        }
    }

    // MARK: Internals

    private func finish(_ outcome: IncidentSubmitOutcome) {
        toast = IncidentFormToast.project(outcome, localize: IncidentFormStrings.string)
        switch outcome {
        case .validationFailed:
            submitPhase = .idle
        case .succeeded:
            submitPhase = .succeeded
            shouldDismiss = true
        case .offline:
            submitPhase = .failed(kind: .offline)
        case .failed:
            submitPhase = .failed(kind: .failed)
        }
    }
}

// MARK: - In-memory sources (previews + tests; the view never performs I/O)

/// Deterministic source for previews + unit tests. Returns a canned result (a created
/// incident, or a thrown `CreateIncidentError`) from `createIncident(_:)`, optionally after
/// a delay so the in-flight (`submitting`) state can be observed. Records the create +
/// invalidation calls so the success path can be asserted.
@MainActor
public final class InMemoryIncidentCreator: IncidentCreating {
    /// The canned result the source yields.
    public enum Result: Sendable {
        case success(CreatedIncidentSummary)
        case failure(CreateIncidentError)
    }

    public private(set) var createCount = 0
    public private(set) var invalidateCount = 0
    public private(set) var lastRequest: CreateIncidentRequest?

    private let result: Result
    private let delay: Duration?

    public init(
        result: Result = .success(CreatedIncidentSummary(id: 1, title: "Incident")),
        delay: Duration? = nil
    ) {
        self.result = result
        self.delay = delay
    }

    public func createIncident(_ request: CreateIncidentRequest) async throws -> CreatedIncidentSummary {
        createCount += 1
        lastRequest = request
        if let delay {
            try? await Task.sleep(for: delay)
        }
        switch result {
        case let .success(summary):
            return summary
        case let .failure(error):
            throw error
        }
    }

    public func invalidateIncidents() {
        invalidateCount += 1
    }
}

/// Source whose completion is driven by the test, so the `submitting` state can be asserted
/// deterministically between the mutation start and its resolution.
@MainActor
public final class ControllableIncidentCreator: IncidentCreating {
    public private(set) var createCount = 0
    public private(set) var invalidateCount = 0
    public private(set) var lastRequest: CreateIncidentRequest?

    private var continuation: CheckedContinuation<CreatedIncidentSummary, Error>?

    public init() {}

    public func createIncident(_ request: CreateIncidentRequest) async throws -> CreatedIncidentSummary {
        createCount += 1
        lastRequest = request
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
        }
    }

    public func invalidateIncidents() {
        invalidateCount += 1
    }

    /// Resolves the in-flight create with a started summary.
    public func complete(_ summary: CreatedIncidentSummary = CreatedIncidentSummary(id: 1, title: "Incident")) {
        continuation?.resume(returning: summary)
        continuation = nil
    }

    /// Fails the in-flight create with a classified error.
    public func fail(_ error: CreateIncidentError) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}

// MARK: - Preview/UI-snapshot seams (DEBUG only)

#if DEBUG
    public extension IncidentFormModel {
        /// Seeds a settled outcome (toast + phase) for previews / UI snapshots — no I/O.
        func previewApply(_ outcome: IncidentSubmitOutcome) {
            finish(outcome)
        }

        /// Forces the in-flight phase so the "Logging…" state can be previewed.
        func previewSetSubmitting() {
            submitPhase = .submitting
        }

        /// Seeds the controlled fields so previews render a populated form.
        func previewFill(title: String, components: String = "", message: String = "") {
            setTitle(title)
            self.components = components
            setMessage(message)
        }
    }
#endif
