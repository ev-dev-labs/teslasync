//
//  BackupActionsCard.Model.swift
//  TeslaSync — P4 feature view · 0241 · BackupActionsCard (Apple)
//
//  The surface identity (P1/S11 slug), the telemetry seam (P1/S11 `view.opened`), the
//  state-holder seam (P1/S8), the observable view-model, the in-memory sources for
//  previews/tests, and the i18n facade (P1/S10) for the backup-status action card —
//  the SwiftUI parity of features/system/components/status/BackupActionsCard.tsx.
//
//  The web component binds `useMutation(triggerQuickBackup)` (POST /backup/quick),
//  `useToast` (success/error feedback), and `useQueryClient` (invalidates the
//  `backup-runs` + `system-status/backup-stats` queries on success). The native
//  surface binds all three through one seam so the view performs no I/O: the run
//  mutation + the query invalidation. The view binds through `BackupActionsCardModel`.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `BackupActionsCard` surface. The slug is
/// emitted with the P1/S11 `view.opened` contract and referenced by the view + tests
/// so the two never drift.
public enum BackupActionsCardSurface {
    public static let slug = "BackupActionsCard"

    /// Reports the surface becoming visible. Factored out of the view's lifecycle so it
    /// is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any BackupActionsCardTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The model reports the
/// surface's appearance through this protocol so production wiring, previews, and tests
/// can each supply their own sink.
public protocol BackupActionsCardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is a
/// static, non-identifying constant logged verbatim; no run id or payload is recorded.
public struct OSLogBackupActionsCardTelemetry: BackupActionsCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Mutation result + error (web `triggerQuickBackup` → `BackupRun`)

/// The started-run summary the quick-backup mutation resolves to — the native form of
/// the web `BackupRun` payload (only the fields this surface needs).
public struct BackupRunSummary: Sendable, Equatable {
    public let id: Int64
    public let status: String

    public init(id: Int64, status: String) {
        self.id = id
        self.status = status
    }
}

/// The classified failure of the quick-backup mutation. The production seam maps the
/// shared `ApiError` to a case so the model needs no transport knowledge: a 401/403
/// becomes `permissionDenied` (web `status === 401 || status === 403`), a transport
/// failure becomes `offline`, and anything else becomes `failed(message:)` (web
/// `Backup failed: ${msg}`).
public enum QuickBackupStartError: Error, Equatable {
    case permissionDenied
    case offline
    case failed(message: String)
}

// MARK: - State-holder seam (P1/S8 — web `useMutation` + `useQueryClient`)

/// The seam the model fires the run through. Production implements this over the shared
/// P1/S8 quick-backup mutation holder + the query cache; previews/tests use
/// `InMemoryQuickBackupSource` / `ControllableQuickBackupSource`. The view never talks
/// to the network directly.
@MainActor
public protocol QuickBackupRunning: AnyObject {
    /// Runs the on-demand quick backup (web `triggerQuickBackup`, POST /backup/quick).
    /// Throws `QuickBackupStartError` on failure.
    func runQuickBackup() async throws -> BackupRunSummary

    /// Invalidates the backup views after a successful run (web `qc.invalidateQueries`
    /// for `['backup-runs']` + `['system-status','backup-stats']`).
    func invalidateBackupViews()
}

// MARK: - View-model

/// The surface's observable view-model. Owns the run lifecycle (web mutation status),
/// the latest toast (web `useToast`), and the run-button label/disabled projection.
/// On a successful run it asks the seam to invalidate the backup views (web query
/// invalidation). No networking lives here — the run is delegated to the injected seam.
@MainActor
@Observable
public final class BackupActionsCardModel {
    /// The run lifecycle, mirroring the web mutation status. `failed` carries the toast
    /// kind so the view can reflect which error branch occurred.
    public enum ActionPhase: Equatable, Sendable {
        case idle
        case running
        case succeeded
        case failed(kind: BackupActionToast.Kind)
    }

    public private(set) var actionPhase: ActionPhase = .idle
    public private(set) var toast: BackupActionToast?
    public private(set) var lastRun: BackupRunSummary?

    @ObservationIgnored private let source: any QuickBackupRunning
    @ObservationIgnored private let telemetry: any BackupActionsCardTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any QuickBackupRunning,
        telemetry: any BackupActionsCardTelemetry = OSLogBackupActionsCardTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
    }

    // MARK: Derived projections

    /// Whether the run mutation is in flight (web `mutation.isPending`).
    public var isRunning: Bool {
        actionPhase == .running
    }

    /// Whether the run button is rendered disabled (web `disabled={mutation.isPending}`).
    public var isRunDisabled: Bool {
        isRunning
    }

    /// The current run-button label (web `isPending ? 'Starting…' : 'Run quick backup now'`).
    public var buttonLabel: QuickBackupButtonLabel {
        QuickBackupButtonLabel.project(isRunning: isRunning)
    }

    // MARK: Lifecycle

    /// Emits the diagnostics `view.opened` event once (web surface mount). Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        BackupActionsCardSurface.reportOpen(to: telemetry)
    }

    /// Clears the current toast (web `useToast` auto-dismiss / manual close).
    public func dismissToast() {
        toast = nil
    }

    // MARK: Run mutation (web `mutation.mutate()` via `handleRun`)

    /// Fires the quick-backup mutation. Re-entrancy guarded so a double-tap can't start
    /// two backups (web early `return` on `mutation.isPending`). On success it surfaces
    /// the success toast and invalidates the backup views; on failure it classifies the
    /// error into the admin-permission, offline, or generic branch (web `onError`).
    public func run() async {
        guard actionPhase != .running else { return }
        actionPhase = .running
        toast = nil
        do {
            let summary = try await source.runQuickBackup()
            lastRun = summary
            source.invalidateBackupViews()
            finish(.succeeded)
        } catch let error as QuickBackupStartError {
            switch error {
            case .permissionDenied:
                finish(.permissionDenied)
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

    private func finish(_ outcome: QuickBackupOutcome) {
        toast = BackupActionToast.project(
            outcome,
            localize: BackupActionsCardStrings.string,
            format: BackupActionsCardStrings.format
        )
        switch outcome {
        case .succeeded:
            actionPhase = .succeeded
        case .permissionDenied:
            actionPhase = .failed(kind: .permission)
        case .offline:
            actionPhase = .failed(kind: .offline)
        case .failed:
            actionPhase = .failed(kind: .failed)
        }
    }
}

// MARK: - In-memory sources (previews + tests; the view never performs I/O)

/// Deterministic source for previews + unit tests. Returns a canned result (a started
/// run, or a thrown `QuickBackupStartError`) from `runQuickBackup()`, optionally after a
/// delay so the in-flight (`running`) state can be observed. Counts the run +
/// invalidation calls so the success path can be asserted.
@MainActor
public final class InMemoryQuickBackupSource: QuickBackupRunning {
    /// The canned result the source yields.
    public enum Result: Sendable {
        case success(BackupRunSummary)
        case failure(QuickBackupStartError)
    }

    public private(set) var runCount = 0
    public private(set) var invalidateCount = 0

    private let result: Result
    private let delay: Duration?

    public init(
        result: Result = .success(BackupRunSummary(id: 1, status: "started")),
        delay: Duration? = nil
    ) {
        self.result = result
        self.delay = delay
    }

    public func runQuickBackup() async throws -> BackupRunSummary {
        runCount += 1
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

    public func invalidateBackupViews() {
        invalidateCount += 1
    }
}

/// Source whose completion is driven by the test, so the `running` state can be asserted
/// deterministically between the mutation start and its resolution.
@MainActor
public final class ControllableQuickBackupSource: QuickBackupRunning {
    public private(set) var runCount = 0
    public private(set) var invalidateCount = 0

    private var continuation: CheckedContinuation<BackupRunSummary, Error>?

    public init() {}

    public func runQuickBackup() async throws -> BackupRunSummary {
        runCount += 1
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
        }
    }

    public func invalidateBackupViews() {
        invalidateCount += 1
    }

    /// Resolves the in-flight run with a started summary.
    public func complete(_ summary: BackupRunSummary = BackupRunSummary(id: 1, status: "started")) {
        continuation?.resume(returning: summary)
        continuation = nil
    }

    /// Fails the in-flight run with a classified error.
    public func fail(_ error: QuickBackupStartError) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)` / `toast(text)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "BackupActionsCard" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time. The web source strings
/// (run/starting labels, manage link, success/permission/failed toasts) are preserved
/// verbatim so a shared catalog resolves identically across web and native.
public enum BackupActionsCardStrings {
    public static let table = "BackupActionsCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-interpolated string (web template literal `Backup failed: ${msg}`).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}

// MARK: - Preview/UI-snapshot seams (DEBUG only)

#if DEBUG
    public extension BackupActionsCardModel {
        /// Seeds a settled outcome (toast + phase) for previews / UI snapshots — no I/O.
        func previewApply(_ outcome: QuickBackupOutcome) {
            finish(outcome)
        }

        /// Forces the in-flight phase so the "Starting…" state can be previewed.
        func previewSetRunning() {
            actionPhase = .running
        }
    }
#endif
