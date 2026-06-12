//
//  CopyLinkButton.Model.swift
//  TeslaSync — P4 shared surface · 0168 · CopyLinkButton (Apple)
//
//  The Foundation-only core of the copy-link button — the native parity of
//  `components/layout/CopyLinkButton.tsx`. The web component is a single ghost `Button` that copies
//  the current URL (path + query string) to the clipboard so a filtered / deep-linked view can be
//  shared. It is purely action-driven: its only hooks are `useTranslation` (the P1/S10 localisation
//  facade) and `useToast` (the P1/S8 toast state holder). There is no network and no data-fetch
//  state holder to bind — so this layer mirrors that exactly: the copy-outcome model, the
//  outcome → toast mapping, the icon / label switch, the i18n facade, the diagnostics slug +
//  telemetry seam (P1/S11), the toast presenter seam (the native shape of `useToast`), and the
//  `@MainActor` model that owns the ambient URL provider + clipboard + the transient "Copied" flag.
//  View-free so every branch and mapping is unit tested without rendering a view.
//
//  Branches reproduced from the web source (every one is exercised — there is no hidden data-feed
//  surface; like the sibling action surface ChartExportMenu 0066, the generic loading / empty /
//  stale / offline leaf states do not apply to a stateless, networkless clipboard action and are
//  intentionally absent rather than faked):
//    • action  — the resting button: the `Link2` glyph + "Copy link" (web `copied === false`).
//    • copied  — the transient confirmation: the `Check` glyph + "Copied", held for `autoResetDelay`
//                then reverted (web `setCopied(true)` → `setTimeout(setCopied(false), 2000)`).
//    • success — a successful write announces the success toast (web `toast.success`).
//    • error   — a failed write (clipboard unavailable, web `catch`) or an unavailable URL announces
//                the error toast (web `toast.error`); the button stays in its resting state.
//    • unavailable — the native graceful guard: with no shareable URL the button is inert (web always
//                resolves `window.location.href`, so this is the native improvement, never a crash).
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). A static,
/// non-identifying constant matching the web component name.
public enum CopyLinkButtonMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "CopyLinkButton"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol CopyLinkButtonTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogCopyLinkButtonTelemetry: CopyLinkButtonTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

/// The testable emission seam: emits `view.opened` exactly once, the first time the button appears.
/// Returns the new "already emitted" flag so the caller can thread it across appearances without
/// double counting.
public enum CopyLinkButtonDiagnostics {
    public static func openIfNeeded(
        alreadyEmitted: Bool,
        telemetry: any CopyLinkButtonTelemetry
    ) -> Bool {
        guard !alreadyEmitted else { return true }
        telemetry.viewOpened(surface: CopyLinkButtonMeta.surfaceSlug)
        return true
    }
}

// MARK: - Copy outcome (web try / catch around the clipboard write)

/// The result of a copy attempt — the native port of the web `try { … } catch { … }` around
/// `navigator.clipboard.writeText`. `copied` is the success branch; `failed` is the catch branch
/// (clipboard unavailable) folded together with the native "no shareable URL" guard.
public enum CopyLinkButtonCopyOutcome: String, Sendable, Equatable, CaseIterable {
    /// The URL was written to the clipboard (web success branch → `setCopied(true)` + success toast).
    case copied
    /// The write failed, or there was no shareable URL (web `catch` branch → error toast).
    case failed
}

// MARK: - Toast severity + intent (web `toast.success` / `toast.error`)

/// The toast severity a copy outcome maps to — the subset of the web `ToastType` this surface emits.
public enum CopyLinkButtonToastSeverity: String, Sendable, Equatable {
    case success
    case error
}

/// A resolved toast request — the severity plus the localisation key + web English fallback of the
/// message to announce. Built by `CopyLinkButtonLogic.toastIntent(for:)` from a copy outcome.
public struct CopyLinkButtonToastIntent: Sendable, Equatable {
    public let severity: CopyLinkButtonToastSeverity
    public let messageKey: String
    public let messageFallback: String

    public init(severity: CopyLinkButtonToastSeverity, messageKey: String, messageFallback: String) {
        self.severity = severity
        self.messageKey = messageKey
        self.messageFallback = messageFallback
    }
}

// MARK: - Pure logic (web icon / label switch, outcome → toast mapping, copy guard)

/// The view-free decision logic ported from the web component: the outcome → toast mapping (web
/// `copied → toast.success` / `catch → toast.error`), the icon + label switch on the `copied` flag
/// (web `Check`/`Link2` + "Copied"/"Copy link"), the shareable-URL guard, and the resolution of an
/// outcome from a URL + a clipboard result. Each function is a direct translation of a web branch so
/// the view stays a pure function of these and every branch is unit tested in isolation.
public enum CopyLinkButtonLogic {
    /// Maps a copy outcome to its toast intent — the verbatim port of the web
    /// `success → toast.success(common.copyLink.success)` / `catch → toast.error(common.copyLink.error)`.
    public static func toastIntent(for outcome: CopyLinkButtonCopyOutcome) -> CopyLinkButtonToastIntent {
        switch outcome {
        case .copied:
            CopyLinkButtonToastIntent(
                severity: .success,
                messageKey: "common.copyLink.success",
                messageFallback: "Link copied to clipboard"
            )
        case .failed:
            CopyLinkButtonToastIntent(
                severity: .error,
                messageKey: "common.copyLink.error",
                messageFallback: "Could not copy link"
            )
        }
    }

    /// The SF Symbol mirroring the web lucide glyph for the current `copied` flag (web
    /// `copied ? <Check/> : <Link2/>`).
    public static func iconSystemImage(copied: Bool) -> String {
        copied ? "checkmark" : "link"
    }

    /// The localisation key + web English fallback for the button label at the current `copied` flag
    /// (web `copied ? t('common.copyLink.copied') : t('common.copyLink.action')`).
    public static func label(copied: Bool) -> (key: String, fallback: String) {
        copied
            ? ("common.copyLink.copied", "Copied")
            : ("common.copyLink.action", "Copy link")
    }

    /// Whether a URL is shareable — non-empty after trimming. The native graceful guard: the web
    /// reads `window.location.href`, which a browser always resolves, so an empty URL is the native
    /// improvement (an inert button) rather than a copy of the empty string.
    public static func canCopy(url: String) -> Bool {
        !url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Resolves the copy outcome from the URL + the clipboard write result: `copied` only when the
    /// URL is shareable and the write succeeded; `failed` otherwise (web `catch` + the native
    /// unavailable-URL guard).
    public static func outcome(url: String, clipboardSucceeded: Bool) -> CopyLinkButtonCopyOutcome {
        canCopy(url: url) && clipboardSucceeded ? .copied : .failed
    }
}

// MARK: - Toast presenter seam (native parity of `useToast`)

/// The toast presenter the button announces copy outcomes through — the native shape of the web
/// `useToast()` accessor. The host injects a presenter that forwards to the app's shared toast
/// surface; previews and isolated tests pass `nil` (the copy still runs and the announcement is
/// skipped, so the surface degrades gracefully off a toast provider).
@MainActor
public protocol CopyLinkButtonToastPresenter: AnyObject {
    func presentToast(severity: CopyLinkButtonToastSeverity, message: String)
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "CopyLinkButton" table (the exact set from the web source
/// `components/layout/CopyLinkButton.tsx`), folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings.
public enum CopyLinkButtonStrings {
    public static let table = "CopyLinkButton"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The resolved button label for the current `copied` flag (web `t(label.key, label.default)`).
    public static func label(copied: Bool) -> String {
        let label = CopyLinkButtonLogic.label(copied: copied)
        return string(label.key, label.fallback)
    }

    /// The resolved VoiceOver / `aria-label` for the control (web `t('common.copyLink.label', …)`).
    public static func accessibilityLabel() -> String {
        string("common.copyLink.label", "Copy link to this view")
    }

    /// The resolved announcement for a copy outcome (web `t(intent.key, intent.default)`).
    public static func toastMessage(for outcome: CopyLinkButtonCopyOutcome) -> String {
        let intent = CopyLinkButtonLogic.toastIntent(for: outcome)
        return string(intent.messageKey, intent.messageFallback)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model — the `@MainActor` owner of the ambient URL provider (the
/// native parity of `window.location.href`), the platform clipboard, the optional toast presenter
/// (web `useToast`), and the transient `copied` confirmation. The view stays a pure function of
/// `copied` + `canCopy`; this model carries the side effects (the clipboard write, the toast
/// announcement, and the 2s reset timer) off the view so no `Task` plumbing leaks into the SwiftUI
/// layer. The web `handleClick` is reproduced verbatim by `copyLink()`.
@MainActor
@Observable
public final class CopyLinkButtonModel {
    /// The transient "Copied" confirmation (web `copied` state) — `true` for `autoResetDelay` after a
    /// successful copy, then reverted (web `window.setTimeout(() => setCopied(false), 2000)`).
    public private(set) var copied = false

    @ObservationIgnored private let urlProvider: any CopyLinkURLProviding
    @ObservationIgnored private let clipboard: any CopyLinkClipboard
    @ObservationIgnored private weak var toast: (any CopyLinkButtonToastPresenter)?
    @ObservationIgnored private let telemetry: any CopyLinkButtonTelemetry
    @ObservationIgnored private let autoResetDelay: Duration
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var resetTask: Task<Void, Never>?

    public init(
        urlProvider: any CopyLinkURLProviding,
        clipboard: any CopyLinkClipboard = SystemCopyLinkClipboard(),
        toast: (any CopyLinkButtonToastPresenter)? = nil,
        telemetry: any CopyLinkButtonTelemetry = OSLogCopyLinkButtonTelemetry(),
        autoResetDelay: Duration = .seconds(2)
    ) {
        self.urlProvider = urlProvider
        self.clipboard = clipboard
        self.toast = toast
        self.telemetry = telemetry
        self.autoResetDelay = autoResetDelay
    }

    /// The current shareable URL (web `window.location.href`), read fresh at copy time; empty when the
    /// app cannot form a deep link for the current view.
    public var currentURL: String {
        urlProvider.currentURL
    }

    /// Whether the button is actionable (native graceful guard — web always resolves a URL).
    public var canCopy: Bool {
        CopyLinkButtonLogic.canCopy(url: currentURL)
    }

    /// Emits `view.opened` exactly once, the first time the button appears (idempotent).
    public func markAppeared() {
        didEmitOpen = CopyLinkButtonDiagnostics.openIfNeeded(
            alreadyEmitted: didEmitOpen,
            telemetry: telemetry
        )
    }

    /// The web `handleClick`: read the current URL, write it to the clipboard, flip to the "Copied"
    /// confirmation + announce the success toast, and arm the reset timer; a missing URL or a failed
    /// write announces the error toast (web `catch`) and leaves the button in its resting state. The
    /// `copied` mutation publishes immediately, so the UI shows "Copied" before the reset elapses.
    public func copyLink() {
        let url = currentURL
        let wrote = CopyLinkButtonLogic.canCopy(url: url) ? clipboard.write(url) : false
        let outcome = CopyLinkButtonLogic.outcome(url: url, clipboardSucceeded: wrote)
        announce(outcome)
        guard outcome == .copied else { return }
        copied = true
        armReset()
    }

    /// Announces a copy outcome through the optional toast presenter — the parity of the web
    /// `toast.success` / `toast.error` calls; a `nil` presenter is the graceful off-provider degrade.
    private func announce(_ outcome: CopyLinkButtonCopyOutcome) {
        guard let toast else { return }
        let intent = CopyLinkButtonLogic.toastIntent(for: outcome)
        toast.presentToast(
            severity: intent.severity,
            message: CopyLinkButtonStrings.string(intent.messageKey, intent.messageFallback)
        )
    }

    /// Arms (or re-arms) the transient-confirmation reset — the native parity of the web
    /// `setTimeout(() => setCopied(false), 2000)`; a fresh copy cancels the prior timer.
    private func armReset() {
        resetTask?.cancel()
        resetTask = Task { [weak self, autoResetDelay] in
            try? await Task.sleep(for: autoResetDelay)
            guard !Task.isCancelled else { return }
            self?.copied = false
        }
    }
}
