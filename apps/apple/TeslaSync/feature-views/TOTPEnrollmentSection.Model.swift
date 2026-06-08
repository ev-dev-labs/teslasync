//
//  TOTPEnrollmentSection.Model.swift
//  TeslaSync — P4 feature view · 0217 · TOTPEnrollmentSection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and
//  the i18n facade (P1/S10) for the TOTP enrollment surface. The view binds
//  through `TOTPEnrollmentModel`; no networking lives in the view. SwiftUI parity
//  of features/settings/components/TOTPEnrollmentSection.tsx — the web component
//  owns a status `useQuery` plus four mutations (enroll / verify / revoke /
//  regenerate) and a local dialog state machine; the model owns that whole
//  lifecycle behind the `TOTPEnrollmentSource` seam so previews + tests drive it
//  with `InMemoryTOTPEnrollmentSource` and the view never talks to the network.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core `Telemetry.track(.screenView(screen:…))`,
/// which is consent-gated and redacted there.
public protocol TOTPEnrollmentTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogTOTPEnrollmentTelemetry: TOTPEnrollmentTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "TOTPEnrollmentSection"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time; the per-surface table keeps each parallel surface prompt self-contained.
public enum TOTPEnrollmentStrings {
    public static let table = "TOTPEnrollmentSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — wiring the status snapshots to the
/// `useTOTPStatus` query and the four async methods to the `useTOTPEnroll` /
/// `useTOTPVerify` / `useTOTPRevoke` / `useTOTPRegenerateBackupCodes` mutations.
/// Previews + tests use `InMemoryTOTPEnrollmentSource`. The view never talks to
/// the network directly.
@MainActor
public protocol TOTPEnrollmentSource: AnyObject {
    var onUpdate: (@MainActor (TOTPEnrollmentUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the status query (the error-state retry / the stale auto-refresh).
    func refresh()
    /// Web `useTOTPEnroll().mutateAsync()` — starts a pending enrollment.
    func enroll() async throws -> TOTPEnrollmentData
    /// Web `useTOTPVerify().mutateAsync({ code })` — promotes pending → active.
    func verify(code: String) async throws
    /// Web `useTOTPRevoke().mutateAsync()` — disables the credential.
    func revoke() async throws
    /// Web `useTOTPRegenerateBackupCodes().mutateAsync()` — fresh codes once.
    func regenerateBackupCodes() async throws -> [String]
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `TOTPEnrollmentSource`,
/// projects each status snapshot into a render `TOTPStatusPhase` + freshness,
/// and owns the modal flow (web `dialogStep` / `enrollment` / `revealedCodes` /
/// `verifyCode` / `verifyError` / `showDisableConfirm`) plus the four mutations'
/// pending flags. Emits the `view.opened` diagnostics event once on appearance.
@MainActor
@Observable
public final class TOTPEnrollmentModel {
    // Status surface (web render branches).
    public private(set) var phase: TOTPStatusPhase = .loading
    public private(set) var connection: TOTPConnection = .live
    public private(set) var statusModel: TOTPStatusViewModel
    public private(set) var updatedAt: Date?

    // Modal flow (web local component state).
    public private(set) var dialogStep: TOTPDialogStep = .closed
    public private(set) var enrollment: TOTPEnrollmentData?
    public private(set) var revealedCodes: [String]?
    public private(set) var verifyCode = ""
    public private(set) var verifyError: String?
    public private(set) var showDisableConfirm = false
    public var disableConfirmInput = ""

    // Mutation pending flags (web `*.isPending`).
    public private(set) var enrollPending = false
    public private(set) var verifyPending = false
    public private(set) var revokePending = false
    public private(set) var regeneratePending = false

    /// The token the disable confirmation requires typed (web
    /// `requireTypedConfirmation="DISABLE"`).
    public static let disableConfirmationToken = "DISABLE"

    @ObservationIgnored private let source: any TOTPEnrollmentSource
    @ObservationIgnored private let telemetry: any TOTPEnrollmentTelemetry
    @ObservationIgnored private let localize: (String, String) -> String
    @ObservationIgnored private let formatDateTime: (Date) -> String
    @ObservationIgnored private var latestData: TOTPStatusData?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TOTPEnrollmentSource,
        telemetry: any TOTPEnrollmentTelemetry = OSLogTOTPEnrollmentTelemetry(),
        localize: @escaping (String, String) -> String = TOTPEnrollmentStrings.string,
        formatDateTime: @escaping (Date) -> String = TOTPDateFormatting.format
    ) {
        self.source = source
        self.telemetry = telemetry
        self.localize = localize
        self.formatDateTime = formatDateTime
        statusModel = TOTPStatusProjection.statusViewModel(
            nil, localize: localize, formatDateTime: formatDateTime
        )
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TOTPEnrollmentSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a status refresh (cached surface stays visible). Wired to retry.
    public func refresh() {
        source.refresh()
    }

    // MARK: Accessibility seams

    /// The status header VoiceOver summary (title + Active / Not-enrolled pill).
    public var headerAccessibilityLabel: String {
        TOTPAccessibility.headerSummary(phase: phase, localize: localize)
    }

    /// The activated panel VoiceOver summary (last used + backup-codes remaining).
    public var activatedAccessibilityLabel: String {
        TOTPAccessibility.activatedSummary(statusModel, localize: localize)
    }

    // MARK: Enroll

    /// Web `handleEnroll`: starts a pending enrollment and opens the QR modal on
    /// success. On failure the dialog stays closed (the web surfaces a toast via
    /// the mutation's `onError`; here the failure is logged and the pill is
    /// unchanged — no inline error, matching the web component).
    public func enroll() {
        guard !enrollPending else { return }
        enrollPending = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { enrollPending = false }
            do {
                let result = try await source.enroll()
                enrollment = result
                verifyCode = ""
                verifyError = nil
                dialogStep = .enroll
            } catch {
                logActionFailure("enroll", error)
            }
        }
    }

    // MARK: Verify

    /// Web verify input `onChange`: sanitise to six digits before storing.
    public func setVerifyCode(_ raw: String) {
        verifyCode = TOTPCode.sanitize(raw)
    }

    /// A `Binding` over `verifyCode` the SwiftUI field writes through `setVerifyCode`.
    public var verifyCodeBinding: Binding<String> {
        Binding(
            get: { [weak self] in self?.verifyCode ?? "" },
            set: { [weak self] in self?.setVerifyCode($0) }
        )
    }

    /// Web `handleVerify`: guards the six-digit length, then promotes the pending
    /// enrollment. On success reveals the enrollment's backup codes (web
    /// `enrollment?.backup_codes ?? []`) and flips to the backup-codes modal; on
    /// failure maps `err.code` to the inline message.
    public func verify() {
        guard !verifyPending else { return }
        verifyError = nil
        guard TOTPCode.isComplete(verifyCode) else {
            verifyError = TOTPVerifyErrorMapper.incompleteMessage(localize: localize)
            return
        }
        let code = TOTPCode.sanitize(verifyCode)
        verifyPending = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { verifyPending = false }
            do {
                try await source.verify(code: code)
                revealedCodes = enrollment?.backupCodes ?? []
                dialogStep = .backupCodes
            } catch let verifyError as TOTPVerifyError {
                self.verifyError = TOTPVerifyErrorMapper.message(for: verifyError, localize: localize)
            } catch {
                self.verifyError = TOTPVerifyErrorMapper.message(
                    for: .generic(error.localizedDescription), localize: localize
                )
            }
        }
    }

    // MARK: Disable (revoke)

    /// Opens the typed-confirmation disable dialog (web `setShowDisableConfirm`).
    public func openDisableConfirm() {
        disableConfirmInput = ""
        showDisableConfirm = true
    }

    /// Cancels the disable dialog (web `onCancel`).
    public func cancelDisableConfirm() {
        showDisableConfirm = false
        disableConfirmInput = ""
    }

    /// Whether the typed confirmation matches (web `requireTypedConfirmation`).
    public var canConfirmDisable: Bool {
        disableConfirmInput == Self.disableConfirmationToken
    }

    /// Web `handleConfirmDisable`: revokes the credential, then closes the dialog
    /// in `finally` regardless of outcome (the web surfaces failures via a toast).
    public func confirmDisable() {
        guard !revokePending, canConfirmDisable else { return }
        revokePending = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                revokePending = false
                showDisableConfirm = false
                disableConfirmInput = ""
            }
            do {
                try await source.revoke()
            } catch {
                logActionFailure("revoke", error)
            }
        }
    }

    // MARK: Regenerate

    /// Web `handleRegenerate`: regenerates the backup codes and reveals them once
    /// in the backup-codes modal. On failure the dialog stays closed (web toast).
    public func regenerate() {
        guard !regeneratePending else { return }
        regeneratePending = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { regeneratePending = false }
            do {
                let codes = try await source.regenerateBackupCodes()
                revealedCodes = codes
                enrollment = nil
                dialogStep = .backupCodes
            } catch {
                logActionFailure("regenerate", error)
            }
        }
    }

    // MARK: Backup-codes download

    /// The `.txt` body for the revealed codes (web `downloadCodes` blob), or `nil`
    /// when there is nothing to download (web early-return guard).
    public func backupCodesFileContents() -> String? {
        guard let codes = revealedCodes, !codes.isEmpty else { return nil }
        let header = localize(
            "totp.backupCodes.fileHeader",
            "# TeslaSync TOTP backup codes — keep secret."
        )
        return TOTPBackupCodesFile.contents(codes: codes, header: header)
    }

    // MARK: Dialog reset

    /// Web `closeDialog`: resets the whole modal flow back to closed.
    public func closeDialog() {
        dialogStep = .closed
        enrollment = nil
        revealedCodes = nil
        verifyCode = ""
        verifyError = nil
    }

    // MARK: Snapshot application

    private func apply(_ update: TOTPEnrollmentUpdate) {
        latestData = update.data
        connection = update.connection
        updatedAt = update.updatedAt
        statusModel = TOTPStatusProjection.statusViewModel(
            update.data, localize: localize, formatDateTime: formatDateTime
        )
        phase = TOTPStatusProjection.resolvePhase(update)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline does
    /// not auto-refresh (there is no connectivity to retry over).
    private func handleAutoRefresh(for connection: TOTPConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }

    private func logActionFailure(_ action: String, _ error: Error) {
        Logger(subsystem: "io.teslasync.app", category: "totp")
            .error("totp \(action, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
    }
}
