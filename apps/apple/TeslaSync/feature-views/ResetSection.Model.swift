//
//  ResetSection.Model.swift
//  TeslaSync — P4 feature view · 0212 · ResetSection (Apple)
//
//  The seams the view binds through, the observable view-model, the telemetry +
//  localization facades — the SwiftUI parity of
//  web/src/features/settings/components/ResetSection.tsx.
//
//  The web surface composes the static resettable-section catalog (`useSectionRows`) and
//  deny-list (`useDeniedRows`), the per-section reset mutation (`useResetSection`), the
//  global reset mutation (`useResetAllSettings`), and toast feedback (`useToast`); the
//  `request()` client transparently runs the SUDO step-up, rejecting with
//  `SudoCanceledError` on user-cancel. This file reproduces the catalog feed + the two
//  mutations as P1/S8 state-holder seams (no networking in the view), wires the P1/S11
//  telemetry contract, exposes the P1/S10 facade, and owns the confirm-sheet + toast
//  presentation. Previews/tests drive the model with the in-memory seams in
//  ResetSection.Sources.swift.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Diagnostics surface identity (P1/S11)

/// The surface slug emitted with the `view.opened` diagnostics event. Kept here so the
/// model + tests reference it without importing SwiftUI.
public enum ResetDiagnostics {
    public static let surface = "ResetSection"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core
/// `Telemetry.track(.screenView(screen:…))`, which is consent-gated and redacted there.
public protocol ResetTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event. The
/// slug is a static, non-identifying constant; no path, title, or id is recorded.
public struct OSLogResetTelemetry: ResetTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "ResetSection" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its strings without editing the shared catalog.
public enum ResetStrings {
    public static let table = "ResetSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience that wraps the resolved string in a verbatim `Text` (so call sites in
    /// SwiftUI views never inline a literal).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Mutation receipt + error (web `SettingsResetResult` / `SudoCanceledError`)

/// The reset receipt the mutations resolve to — the native form of the web
/// `SettingsResetResult` (`reset` is the summed item count, `sections` lists each section
/// the server ran, in order).
public struct SettingsResetReceipt: Sendable, Equatable {
    public let reset: Int
    public let sections: [String]

    public init(reset: Int, sections: [String]) {
        self.reset = reset
        self.sections = sections
    }
}

/// The classified failure of a reset mutation. The production seam maps the shared
/// `ApiError` to a case so the model needs no transport knowledge: a user-cancelled SUDO
/// step-up becomes `canceled` (web `SudoCanceledError`, handled as a silent no-op), a
/// transport failure becomes `offline`, and anything else becomes `failed(message:)` (web
/// `useMutationToast` error branch).
public enum SettingsResetError: Error, Equatable {
    case canceled
    case offline
    case failed(message: String)
}

// MARK: - Section-list snapshot (web `useSectionRows` + `useDeniedRows`)

/// One coalesced snapshot of the resettable-section catalog + the deny-list, reduced to
/// the load/freshness envelope the P4 states contract reads. Production hydrates the rows
/// from the backend section registry; previews/tests use the canonical `ResetCatalog`.
public struct ResetSectionsUpdate: Sendable, Equatable {
    public var status: ResetSectionsStatus
    public var freshness: ResetFreshness
    public var sections: [ResetSectionRow]
    public var denied: [ResetDeniedRow]
    public var updatedAt: Date?

    public init(
        status: ResetSectionsStatus = .loading,
        freshness: ResetFreshness = .fresh,
        sections: [ResetSectionRow] = ResetCatalog.defaultSections,
        denied: [ResetDeniedRow] = ResetCatalog.deniedSections,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.freshness = freshness
        self.sections = sections
        self.denied = denied
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seams (P1/S8 layer)

/// The resettable-section catalog feed (web `useSectionRows` / `useDeniedRows`). Production
/// implements this over the shared backend section-registry state holder; previews/tests
/// use `InMemoryResetSectionsSource`. The view never talks to the network.
@MainActor
public protocol ResetSectionsSource: AnyObject {
    var onUpdate: (@MainActor (ResetSectionsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The reset-mutation seam (web `useResetSection` / `useResetAllSettings`). `resetSection`
/// runs `POST /settings/reset { section }`; `resetAll` runs `POST /settings/reset {}`; both
/// throw `SettingsResetError`. `invalidateCaches` flushes every cached query after a
/// success (web `qc.invalidateQueries()`), since a reset can touch any preference surface.
@MainActor
public protocol SettingsResetting: AnyObject {
    func resetSection(_ section: String) async throws -> SettingsResetReceipt
    func resetAll() async throws -> SettingsResetReceipt
    func invalidateCaches()
}

// MARK: - Toast (web `useToast().success` / `useMutationToast` error)

/// The kind of transient toast a reset produces.
public enum ResetToastKind: Sendable, Equatable {
    case success
    case error
}

/// One transient toast (web `toast.success(title, detail)` / the hook's error toast).
/// Carries a fresh id so a repeated identical message still re-triggers the
/// auto-dismissing presentation.
public struct ResetToast: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let kind: ResetToastKind
    public let title: String
    public let detail: String

    public init(id: UUID = UUID(), kind: ResetToastKind, title: String, detail: String) {
        self.id = id
        self.kind = kind
        self.title = title
        self.detail = detail
    }
}

// MARK: - View-model (P1/S8 binding)

/// The surface's observable view-model. Subscribes to the catalog seam, resolves the
/// render `phase` (web is always rendered; the loading skeleton shows only before the
/// section list first resolves), owns the per-section + global confirm presentation and
/// the toast, and drives the two mutations through the reset seam. Emits the `view.opened`
/// diagnostics event once on first start.
@MainActor
@Observable
public final class ResetSectionModel {
    public private(set) var phase: ResetPhase = .loading
    public private(set) var status: ResetSectionsStatus = .loading
    public private(set) var freshness: ResetFreshness = .fresh
    public private(set) var sections: [ResetSectionRow] = ResetCatalog.defaultSections
    public private(set) var denied: [ResetDeniedRow] = ResetCatalog.deniedSections
    public private(set) var updatedAt: Date?

    /// The section whose per-section confirm sheet is presented, or `nil` (web `pending`).
    public private(set) var pendingSection: ResetSectionRow?
    /// The id of the section whose reset is currently in flight (web `sectionMut.isPending`).
    public private(set) var resettingSectionID: String?
    /// Whether the global danger-zone confirm sheet is presented (web `resetAllOpen`).
    public var resetAllPresented = false
    /// The typed danger-zone confirmation text (web typed-confirmation input).
    public var resetAllInput = ""
    /// Whether the global reset is in flight (web `allMut.isPending`).
    public private(set) var isResettingAll = false
    /// The active toast, or `nil` (web `toast`).
    public private(set) var toast: ResetToast?

    @ObservationIgnored private let source: any ResetSectionsSource
    @ObservationIgnored private let resetter: any SettingsResetting
    @ObservationIgnored private let telemetry: any ResetTelemetry
    @ObservationIgnored private let localize: ResetLocalize
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ResetSectionsSource,
        resetter: any SettingsResetting,
        telemetry: any ResetTelemetry = OSLogResetTelemetry(),
        localize: @escaping ResetLocalize = ResetStrings.string
    ) {
        self.source = source
        self.resetter = resetter
        self.telemetry = telemetry
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived projections

    /// Whether the typed danger-zone confirmation is satisfied (web confirm `disabled`).
    public var canConfirmResetAll: Bool {
        ResetAdapter.canConfirmResetAll(input: resetAllInput)
    }

    /// Whether a per-section Reset button renders disabled (web `busy`).
    public func isSectionBusy(_ id: String) -> Bool {
        resettingSectionID == id
    }

    // MARK: Lifecycle

    /// Begins observing the catalog seam and emits the `view.opened` event once.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ResetDiagnostics.surface)
        source.start()
    }

    /// Stops observing the catalog seam.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a catalog refresh (cached list stays applied). Wired to the status-banner
    /// retry and the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Per-section reset (web ConfirmDialog → useResetSection)

    /// Requests a per-section reset by presenting its confirm sheet (web `setPending`).
    public func requestResetSection(_ row: ResetSectionRow) {
        pendingSection = row
    }

    /// Dismisses the per-section confirm sheet without resetting (web `onCancel`).
    public func cancelResetSection() {
        guard resettingSectionID == nil else { return }
        pendingSection = nil
    }

    /// Confirms the per-section reset (web `handleConfirmSection`): runs the mutation,
    /// flushes caches + toasts on success, swallows a SUDO cancel silently, and toasts any
    /// other failure. The sheet stays up (loading) until the mutation settles.
    public func confirmResetSection() async {
        guard let row = pendingSection, resettingSectionID == nil else { return }
        resettingSectionID = row.id
        defer {
            resettingSectionID = nil
            pendingSection = nil
        }
        do {
            let receipt = try await resetter.resetSection(row.id)
            resetter.invalidateCaches()
            announceSuccess(receipt, isAll: false)
        } catch let error as SettingsResetError {
            handleResetError(error, isAll: false)
        } catch {
            handleResetError(.failed(message: error.localizedDescription), isAll: false)
        }
    }

    // MARK: Global reset (web Danger zone → useResetAllSettings)

    /// Opens the danger-zone confirm sheet with a cleared typed field (web `setResetAllOpen`).
    public func requestResetAll() {
        resetAllInput = ""
        resetAllPresented = true
    }

    /// Dismisses the danger-zone confirm sheet without resetting (web `onCancel`).
    public func cancelResetAll() {
        guard !isResettingAll else { return }
        resetAllPresented = false
        resetAllInput = ""
    }

    /// Confirms the global reset (web `handleConfirmAll`). Guarded by the typed-confirmation
    /// predicate so it can't run until the field reads "RESET"; same cache-flush + toast +
    /// silent-cancel semantics as the per-section path.
    public func confirmResetAll() async {
        guard canConfirmResetAll, !isResettingAll else { return }
        isResettingAll = true
        defer {
            isResettingAll = false
            resetAllPresented = false
            resetAllInput = ""
        }
        do {
            let receipt = try await resetter.resetAll()
            resetter.invalidateCaches()
            announceSuccess(receipt, isAll: true)
        } catch let error as SettingsResetError {
            handleResetError(error, isAll: true)
        } catch {
            handleResetError(.failed(message: error.localizedDescription), isAll: true)
        }
    }

    // MARK: Toast

    /// Clears the active toast (called by the view once its auto-dismiss elapses).
    public func dismissToast() {
        toast = nil
    }

    // MARK: Apply (catalog snapshot)

    private func apply(_ update: ResetSectionsUpdate) {
        status = update.status
        freshness = update.freshness
        sections = update.sections
        denied = update.denied
        updatedAt = update.updatedAt
        phase = ResetPhaseResolver.resolve(status: update.status)
        handleAutoRefresh(for: update.freshness)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// fresh again so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for freshness: ResetFreshness) {
        switch freshness {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .fresh:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }

    // MARK: Feedback

    private func announceSuccess(_ receipt: SettingsResetReceipt, isAll: Bool) {
        let title = isAll
            ? localize("settingsReset.toasts.successTitle.all", "All settings reset")
            : localize("settingsReset.toasts.successTitle.section", "Section reset")
        let detail = ResetAdapter.successDetail(
            reset: receipt.reset,
            sectionsCount: receipt.sections.count,
            localize: localize
        )
        toast = ResetToast(kind: .success, title: title, detail: detail)
    }

    private func handleResetError(_ error: SettingsResetError, isAll: Bool) {
        guard error != .canceled else { return }
        let title = isAll
            ? localize("toast.settings.reset.allError", "Failed to reset all settings")
            : localize("toast.settings.reset.error", "Failed to reset section")
        let detail: String = switch error {
        case .offline:
            localize(
                "settingsReset.toasts.offline",
                "You appear to be offline. Check your connection and try again."
            )
        case let .failed(message):
            message
        case .canceled:
            ""
        }
        toast = ResetToast(kind: .error, title: title, detail: detail)
    }
}
