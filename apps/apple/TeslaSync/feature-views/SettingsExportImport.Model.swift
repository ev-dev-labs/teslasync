//
//  SettingsExportImport.Model.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  The surface identity (P1/S11 slug), the telemetry seam (P1/S11 `view.opened`), the
//  backup I/O errors + seams (P1/S8), and the observable view-model for the settings
//  backup/restore surface — the SwiftUI parity of
//  features/settings/components/SettingsExportImport.tsx. The native surface binds the
//  export + import I/O through two injected seams so the view performs no networking; the
//  stage machine (idle → parsing → preview → applied) + export lifecycle live here. The
//  sources, DEBUG preview seam, and i18n facade live in SettingsExportImport.Seams.swift.
//  Deliberately SwiftUI-free (Foundation + Observation + OSLog) — host-free testable.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `SettingsExportImport` surface. The slug is
/// emitted with the P1/S11 `view.opened` contract and referenced by the view + tests so
/// the two never drift.
public enum SettingsExportImportSurface {
    public static let slug = "SettingsExportImport"

    /// Reports the surface becoming visible. Factored out of the view's lifecycle so it is
    /// unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any SettingsExportImportTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The model reports the surface's
/// appearance through this protocol so production, previews, and tests each supply a sink.
public protocol SettingsExportImportTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is a static,
/// non-identifying constant; no bundle bytes or filenames are recorded.
public struct OSLogSettingsExportImportTelemetry: SettingsExportImportTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Backup I/O errors (web mutation rejections)

/// The classified failure of the export / dry-run / apply mutations. The production seam
/// maps shared transport errors to a case so the model needs no transport knowledge: a
/// cancelled step-up → `sudoCanceled` (web `SudoCanceledError`, a non-error), a connectivity
/// failure → `offline`, anything else → `failed(message:)`.
public enum SettingsBackupError: Error, Equatable {
    case sudoCanceled
    case offline
    case failed(message: String)
}

// MARK: - State-holder seams (P1/S8 — web `useSettingsBackup` mutations)

/// The seam the model fires the export through. Production wires it over the shared P1/S8
/// export holder + the file save; previews/tests use `InMemorySettingsBackupSource`.
@MainActor
public protocol SettingsBackupExporting: AnyObject {
    /// Fetches the bundle and saves it to the user's Files (web GET /settings/export + the
    /// blob save-as). Throws `SettingsBackupError` on failure.
    func exportSettings() async throws -> ExportedSettingsBundle
}

/// The seam the model fires the import dry-run + apply through (web `useDryRunImport` /
/// `useApplyImport`). Apply is `RequireSudo`-gated; a cancelled step-up → `.sudoCanceled`.
@MainActor
public protocol SettingsBackupImporting: AnyObject {
    /// POST /settings/import {dry_run:true} — the per-section preview (web dry-run).
    func dryRun(_ bundle: SettingsBundle) async throws -> SettingsImportResult

    /// POST /settings/import {dry_run:false} — applies the bundle (web apply, SUDO-gated).
    func apply(_ bundle: SettingsBundle) async throws -> SettingsImportResult
}

// MARK: - View-model

/// The surface's observable view-model. Owns the export lifecycle, the import stage machine
/// (web `stage`), the inline parse error, the dry-run/applied results, and the latest toast
/// (web `useToast`). No networking lives here — export + import use the injected seams.
@MainActor
@Observable
public final class SettingsExportImportModel {
    /// The export lifecycle, mirroring the web export mutation status.
    public enum ExportPhase: Equatable, Sendable {
        case idle
        case exporting
    }

    /// The import stage machine (web `ImportStage`).
    public enum ImportStage: Equatable, Sendable {
        case idle
        case parsing
        case preview
        case applied
    }

    public private(set) var exportPhase: ExportPhase = .idle
    public private(set) var importStage: ImportStage = .idle
    public private(set) var pending: PendingSettingsImport?
    public private(set) var parseError: SettingsImportParseError?
    public private(set) var previewResult: SettingsImportResult?
    public private(set) var appliedResult: SettingsImportResult?
    public private(set) var applyInFlight = false
    public private(set) var toast: SettingsBackupToast?
    public private(set) var lastExport: ExportedSettingsBundle?

    @ObservationIgnored private let exporter: any SettingsBackupExporting
    @ObservationIgnored private let importer: any SettingsBackupImporting
    @ObservationIgnored private let telemetry: any SettingsExportImportTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false

    public init(
        exporter: any SettingsBackupExporting,
        importer: any SettingsBackupImporting,
        telemetry: any SettingsExportImportTelemetry = OSLogSettingsExportImportTelemetry(),
        locale: Locale = .current
    ) {
        self.exporter = exporter
        self.importer = importer
        self.telemetry = telemetry
        self.locale = locale
    }

    // MARK: Derived projections

    public var isExporting: Bool {
        exportPhase == .exporting
    }

    public var isExportDisabled: Bool {
        isExporting
    }

    /// The Export button label (web `isPending ? 'Exporting…' : 'Export JSON'`).
    public var exportButtonLabel: SettingsBackupLabel {
        SettingsBackupLabel.exportButton(isExporting: isExporting)
    }

    /// Whether the dropzone is shown (web `stage !== 'preview' && stage !== 'applied'`).
    public var showsDropzone: Bool {
        importStage != .preview && importStage != .applied
    }

    public var isParsing: Bool {
        importStage == .parsing
    }

    /// The choose-file label (web `stage === 'parsing' ? 'Reading…' : 'Choose a file'`).
    public var chooseButtonLabel: SettingsBackupLabel {
        SettingsBackupLabel.chooseButton(isParsing: isParsing)
    }

    /// The dry-run summary triple (web `summary`), or `nil` before a preview resolves.
    public var previewSummary: SettingsImportSummary? {
        previewResult.map(SettingsImportSummary.summarise)
    }

    /// The Apply button label (web `isPending ? 'Applying…' : total>0 ? 'Apply N…' : '…'`).
    public var applyButtonLabel: SettingsBackupLabel {
        SettingsBackupLabel.applyButton(isApplying: applyInFlight, total: previewSummary?.total ?? 0)
    }

    /// Whether Apply is disabled (web `disabled={isPending || summary.total === 0}`).
    public var isApplyDisabled: Bool {
        applyInFlight || (previewSummary?.total ?? 0) == 0
    }

    /// The per-section diff rows for the active result (applied, then preview).
    public var sectionRows: [SettingsSectionDiffRow] {
        guard let result = appliedResult ?? previewResult else { return [] }
        return SettingsSectionDiffRow.rows(from: result)
    }

    /// The localized inline parse-error message, or `nil` when there is none.
    public func parseErrorMessage() -> String? {
        parseError?.message(
            localize: SettingsExportImportStrings.string,
            format: SettingsExportImportStrings.format
        )
    }

    /// The localized dry-run preview header (web `Previewing {{name}} ({{size}} bytes)`).
    public func previewHeaderText() -> String? {
        guard let pending else { return nil }
        return SettingsImportPreviewHeader.text(
            name: pending.filename,
            sizeBytes: pending.sizeBytes,
            locale: locale,
            format: SettingsExportImportStrings.format
        )
    }

    /// The localized dry-run summary line (web `{{a}} added, {{u}} updated, {{s}} unchanged`).
    public func previewSummaryLine() -> String? {
        guard let summary = previewSummary else { return nil }
        return SettingsImportPreviewHeader.summaryLine(summary, format: SettingsExportImportStrings.format)
    }

    // MARK: Lifecycle

    /// Emits the diagnostics `view.opened` event once (web surface mount). Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        SettingsExportImportSurface.reportOpen(to: telemetry)
    }

    /// Clears the current toast (web `useToast` auto-dismiss / manual close).
    public func dismissToast() {
        toast = nil
    }

    // MARK: Export (web `handleExport`)

    /// Fires the export mutation. Re-entrancy guarded (web `disabled={isPending}`); on
    /// success surfaces the saved toast, else classifies offline/generic (web `useMutationToast`).
    public func export() async {
        guard exportPhase != .exporting else { return }
        exportPhase = .exporting
        do {
            let result = try await exporter.exportSettings()
            lastExport = result
            toast = SettingsBackupToast.exportSucceeded(localize: SettingsExportImportStrings.string)
        } catch let error as SettingsBackupError {
            applyExportError(error)
        } catch {
            applyExportError(.failed(message: error.localizedDescription))
        }
        exportPhase = .idle
    }

    // MARK: Import intake (web `ingestFile`)

    /// Resets the import flow to its idle state (web `resetImport`).
    public func resetImport() {
        pending = nil
        importStage = .idle
        parseError = nil
        previewResult = nil
        appliedResult = nil
    }

    /// Ingests a picked file (web `ingestFile`). `data` is `nil` on a read failure. Reproduces
    /// the web pipeline: size guard → read guard → JSON parse → validation → dry-run preview.
    public func ingest(filename: String, sizeBytes: Int, data: Data?) async {
        resetImport()
        importStage = .parsing

        guard sizeBytes <= maxImportFileBytes else {
            return failParse(.tooLarge)
        }
        guard let data else {
            return failParse(.readFailed)
        }

        let parsed: Any
        switch SettingsBundleValidator.parse(data) {
        case let .success(value): parsed = value
        case let .failure(error): return failParse(.invalidJSON(detail: jsonErrorDetail(error)))
        }

        let bundle: SettingsBundle
        switch SettingsBundleValidator.validate(json: parsed, rawData: data) {
        case let .success(value): bundle = value
        case let .failure(error): return failParse(.invalidBundle(error))
        }

        pending = PendingSettingsImport(bundle: bundle, filename: filename, sizeBytes: sizeBytes)

        do {
            let result = try await importer.dryRun(bundle)
            previewResult = result
            importStage = .preview
        } catch let error as SettingsBackupError {
            pending = nil
            failParse(.previewFailed(message: previewFailureMessage(error)))
        } catch {
            pending = nil
            failParse(.previewFailed(message: error.localizedDescription))
        }
    }

    // MARK: Apply (web `handleApply`)

    /// Applies the pending bundle (web `handleApply`). Re-entrancy guarded. On success it
    /// advances to `applied` + surfaces the success toast. A cancelled step-up (web
    /// `SudoCanceledError`) is a non-error; other failures classify into the offline/generic
    /// toast while the preview stays so the user can retry without re-uploading.
    public func apply() async {
        guard let pending, !applyInFlight else { return }
        applyInFlight = true
        do {
            let result = try await importer.apply(pending.bundle)
            appliedResult = result
            importStage = .applied
            toast = SettingsBackupToast.importApplied(
                summary: SettingsImportSummary.summarise(result),
                localize: SettingsExportImportStrings.string,
                format: SettingsExportImportStrings.format
            )
        } catch let error as SettingsBackupError {
            applyImportError(error)
        } catch {
            applyImportError(.failed(message: error.localizedDescription))
        }
        applyInFlight = false
    }

    // MARK: Internals

    private func failParse(_ error: SettingsImportParseError) {
        importStage = .idle
        parseError = error
    }

    private func applyExportError(_ error: SettingsBackupError) {
        switch error {
        case .offline:
            toast = SettingsBackupToast.exportOffline(localize: SettingsExportImportStrings.string)
        case let .failed(message):
            toast = SettingsBackupToast.exportFailed(
                message: message,
                localize: SettingsExportImportStrings.string,
                format: SettingsExportImportStrings.format
            )
        case .sudoCanceled:
            break
        }
    }

    private func applyImportError(_ error: SettingsBackupError) {
        switch error {
        case .sudoCanceled:
            break
        case .offline:
            toast = SettingsBackupToast.importOffline(localize: SettingsExportImportStrings.string)
        case let .failed(message):
            toast = SettingsBackupToast.importFailed(message: message, localize: SettingsExportImportStrings.string)
        }
    }

    private func previewFailureMessage(_ error: SettingsBackupError) -> String? {
        switch error {
        case let .failed(message): message
        case .offline, .sudoCanceled: nil
        }
    }

    private func jsonErrorDetail(_ error: Error) -> String {
        let nsError = error as NSError
        if let debug = nsError.userInfo[NSDebugDescriptionErrorKey] as? String, !debug.isEmpty {
            return debug
        }
        return nsError.localizedDescription
    }
}

// MARK: - Preview/UI-snapshot seam (DEBUG only)

#if DEBUG
    extension SettingsExportImportModel {
        /// Seeds the import flow into a stage with canned results for previews — no I/O.
        func previewSeed(
            stage: ImportStage = .idle,
            pending: PendingSettingsImport? = nil,
            previewResult: SettingsImportResult? = nil,
            appliedResult: SettingsImportResult? = nil,
            parseError: SettingsImportParseError? = nil,
            toast: SettingsBackupToast? = nil,
            exporting: Bool = false,
            applyInFlight: Bool = false
        ) {
            importStage = stage
            self.pending = pending
            self.previewResult = previewResult
            self.appliedResult = appliedResult
            self.parseError = parseError
            self.toast = toast
            exportPhase = exporting ? .exporting : .idle
            self.applyInFlight = applyInFlight
        }
    }
#endif
