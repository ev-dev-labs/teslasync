//
//  CopyButton.Model.swift
//  TeslaSync — P4 shared surface · 0207 · CopyButton (Apple)
//
//  The Foundation-only core of the one-click clipboard button — the native parity of
//  `components/ui/CopyButton.tsx`. The web component is a single ghost `Button` that copies an
//  arbitrary string to the clipboard, toggling its label "Copy" → "Copied" for two seconds and
//  (opt-in) firing a success / error toast. It is purely action-driven: its only hooks are
//  `useTranslation` (the P1/S10 localisation facade) and `useOptionalToast` (the P1/S8 toast state
//  holder, read without throwing so it degrades gracefully off a provider). There is no network and
//  no data-fetch state holder to bind — so this layer mirrors that exactly: the copy-outcome model,
//  the icon / label / accessibility switch, the outcome → toast mapping, the i18n facade, the
//  diagnostics slug + telemetry seam (P1/S11), the toast presenter seam (the native shape of
//  `useOptionalToast`), and the `@MainActor` model that owns the text source + clipboard + the
//  optional toast + the transient "Copied" flag + the `onCopy` callback. View-free so every branch
//  and mapping is unit tested without rendering a view.
//
//  Branches reproduced from the web source (every one is exercised — there is no hidden data-feed
//  surface; like the sibling action surfaces ChartExportMenu 0066 / CopyLinkButton 0168, the generic
//  loading / empty / stale / offline leaf states do not apply to a stateless, networkless clipboard
//  action and are intentionally absent rather than faked):
//    • copy     — the resting button: the `Copy` glyph + "Copy" (web `copied === false`), or a caller
//                 `label` override / `iconOnly` (no title).
//    • copied   — the transient confirmation: the `CheckCircle` glyph + "Copied", held for
//                 `autoResetDelay` then reverted (web `setCopied(true)` → `setTimeout(…, 2000)`).
//    • onCopy   — a successful write invokes the caller's `onCopy` callback (web `onCopy?.()`).
//    • success  — when `withToast`, a successful write announces the success toast (web
//                 `toast?.success`); when `withToast` is false, no toast (web default).
//    • error    — a failed write (clipboard unavailable, web `catch`) announces the error toast when
//                 `withToast` (web `toast?.error`) and logs the failure (web `console.error`); the
//                 button stays in its resting state.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). A static,
/// non-identifying constant matching the web component name.
public enum CopyButtonMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "CopyButton"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol CopyButtonTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogCopyButtonTelemetry: CopyButtonTelemetry {
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
public enum CopyButtonDiagnostics {
    public static func openIfNeeded(
        alreadyEmitted: Bool,
        telemetry: any CopyButtonTelemetry
    ) -> Bool {
        guard !alreadyEmitted else { return true }
        telemetry.viewOpened(surface: CopyButtonMeta.surfaceSlug)
        return true
    }
}

// MARK: - Copy outcome (web try / catch around the clipboard write)

/// The result of a copy attempt — the native port of the web `try { … } catch { … }` around
/// `navigator.clipboard.writeText`. `copied` is the success branch (`setCopied(true)`); `failed` is
/// the catch branch (clipboard unavailable / write rejected).
public enum CopyButtonCopyOutcome: String, Sendable, Equatable, CaseIterable {
    /// The text was written to the clipboard (web success branch → `setCopied(true)`).
    case copied
    /// The write failed (web `catch` branch → `console.error`; error toast when `withToast`).
    case failed
}

// MARK: - Toast severity + intent (web `toast.success` / `toast.error`)

/// The toast severity a copy outcome maps to — the subset of the web `ToastType` this surface emits.
public enum CopyButtonToastSeverity: String, Sendable, Equatable {
    case success
    case error
}

/// A resolved toast request — the severity plus the localisation key + web English fallback of the
/// message to announce. Built by `CopyButtonLogic.toastIntent(for:)` from a copy outcome.
public struct CopyButtonToastIntent: Sendable, Equatable {
    public let severity: CopyButtonToastSeverity
    public let messageKey: String
    public let messageFallback: String

    public init(severity: CopyButtonToastSeverity, messageKey: String, messageFallback: String) {
        self.severity = severity
        self.messageKey = messageKey
        self.messageFallback = messageFallback
    }
}

// MARK: - Resolved label pair (the web `copyLabel` / `copiedLabel`)

/// The two resolved button titles — the web `copyLabel = t('common.copyButton.copy', 'Copy')` and
/// `copiedLabel = t('common.copyButton.copied', 'Copied')`. Bundled so the label / accessibility
/// resolvers take the localised pair as one value rather than two loose strings.
public struct CopyButtonLabelStrings: Sendable, Equatable {
    public let copy: String
    public let copied: String

    public init(copy: String, copied: String) {
        self.copy = copy
        self.copied = copied
    }
}

// MARK: - Pure logic (web icon / label / aria switch, outcome → toast mapping)

/// The view-free decision logic ported from the web component: the icon switch on the `copied` flag
/// (web `copied ? <CheckCircle/> : <Copy/>`), the visible-label resolution (web
/// `label ?? (copied ? copiedLabel : copyLabel)`), the accessibility-label resolution (web
/// `ariaLabel ?? (iconOnly ? … : undefined)`), the outcome → toast mapping (web `success → toast.success`
/// / `catch → toast.error`), and the clipboard-result → outcome resolution. Each function is a direct
/// translation of a web branch so the view stays a pure function of these and every branch is unit
/// tested in isolation.
public enum CopyButtonLogic {
    /// The SF Symbol mirroring the web lucide glyph for the current `copied` flag (web
    /// `copied ? <CheckCircle/> : <Copy/>`).
    public static func iconSystemImage(copied: Bool) -> String {
        copied ? "checkmark.circle" : "doc.on.doc"
    }

    /// The visible button label — the verbatim port of the web
    /// `label ?? (copied ? copiedLabel : copyLabel)`. A caller `label` override wins and does NOT
    /// toggle with `copied` (only the icon does); otherwise the default toggles "Copy" → "Copied".
    /// The caller drops this entirely for `iconOnly`.
    public static func visibleLabel(
        labelOverride: String?,
        copied: Bool,
        labels: CopyButtonLabelStrings
    ) -> String {
        labelOverride ?? (copied ? labels.copied : labels.copy)
    }

    /// The assistive (`aria-label`) text — the verbatim port of
    /// `ariaLabel ?? (iconOnly ? (copied ? copiedLabel : (label ?? copyLabel)) : undefined)`. The web
    /// leaves it `undefined` for the labelled button so the visible text is used; the native control
    /// needs a concrete spoken label (the icon + text content is hidden from VoiceOver), so the
    /// non-icon case resolves to the same string the visible label shows.
    public static func accessibilityLabel(
        ariaLabel: String?,
        iconOnly: Bool,
        labelOverride: String?,
        copied: Bool,
        labels: CopyButtonLabelStrings
    ) -> String {
        if let ariaLabel {
            return ariaLabel
        }
        if iconOnly {
            return copied ? labels.copied : (labelOverride ?? labels.copy)
        }
        return labelOverride ?? (copied ? labels.copied : labels.copy)
    }

    /// Maps a copy outcome to its toast intent — the verbatim port of the web
    /// `success → toast.success(common.copyButton.successToast)` /
    /// `catch → toast.error(common.copyButton.errorToast)`.
    public static func toastIntent(for outcome: CopyButtonCopyOutcome) -> CopyButtonToastIntent {
        switch outcome {
        case .copied:
            CopyButtonToastIntent(
                severity: .success,
                messageKey: "common.copyButton.successToast",
                messageFallback: "Copied to clipboard"
            )
        case .failed:
            CopyButtonToastIntent(
                severity: .error,
                messageKey: "common.copyButton.errorToast",
                messageFallback: "Failed to copy"
            )
        }
    }

    /// Resolves the copy outcome from the clipboard write result: `copied` on a successful write,
    /// `failed` otherwise (web `catch`).
    public static func outcome(clipboardSucceeded: Bool) -> CopyButtonCopyOutcome {
        clipboardSucceeded ? .copied : .failed
    }
}

// MARK: - Toast presenter seam (native parity of `useOptionalToast`)

/// The toast presenter the button announces copy outcomes through — the native shape of the web
/// `useOptionalToast()` accessor. The host injects a presenter that forwards to the app's shared
/// toast surface; previews and isolated tests pass `nil` (the copy still runs and the announcement is
/// skipped, exactly as the web `toast?.success` optional-chains off a missing provider).
@MainActor
public protocol CopyButtonToastPresenter: AnyObject {
    func presentToast(severity: CopyButtonToastSeverity, message: String)
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "CopyButton" table (the exact set from the web source
/// `components/ui/CopyButton.tsx`), folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings.
public enum CopyButtonStrings {
    public static let table = "CopyButton"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The resting label (web `t('common.copyButton.copy', 'Copy')`).
    public static func copyLabel() -> String {
        string("common.copyButton.copy", "Copy")
    }

    /// The confirmed label (web `t('common.copyButton.copied', 'Copied')`).
    public static func copiedLabel() -> String {
        string("common.copyButton.copied", "Copied")
    }

    /// The resolved button-title pair (web `copyLabel` / `copiedLabel`).
    public static func labels() -> CopyButtonLabelStrings {
        CopyButtonLabelStrings(copy: copyLabel(), copied: copiedLabel())
    }

    /// The resolved visible label for the current props + `copied` flag (web `visibleLabel`).
    public static func visibleLabel(labelOverride: String?, copied: Bool) -> String {
        CopyButtonLogic.visibleLabel(labelOverride: labelOverride, copied: copied, labels: labels())
    }

    /// The resolved VoiceOver / `aria-label` for the control (web `resolvedAriaLabel`).
    public static func accessibilityLabel(
        ariaLabel: String?,
        iconOnly: Bool,
        labelOverride: String?,
        copied: Bool
    ) -> String {
        CopyButtonLogic.accessibilityLabel(
            ariaLabel: ariaLabel,
            iconOnly: iconOnly,
            labelOverride: labelOverride,
            copied: copied,
            labels: labels()
        )
    }

    /// The resolved announcement for a copy outcome (web `t(intent.key, intent.default)`).
    public static func toastMessage(for outcome: CopyButtonCopyOutcome) -> String {
        let intent = CopyButtonLogic.toastIntent(for: outcome)
        return string(intent.messageKey, intent.messageFallback)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model — the `@MainActor` owner of the text source (the native parity
/// of the web `text` prop, read fresh at copy time), the platform clipboard, the optional toast
/// presenter (web `useOptionalToast`), the `withToast` opt-in, and the `onCopy` callback, plus the
/// transient `copied` confirmation. The view stays a pure function of `copied`; this model carries the
/// side effects (the clipboard write, the optional toast announcement, the `onCopy` callback, the
/// failure log, and the 2s reset timer) off the view so no `Task` plumbing leaks into the SwiftUI
/// layer. The web `handleCopy` is reproduced verbatim by `copyText()`.
@MainActor
@Observable
public final class CopyButtonModel {
    /// The transient "Copied" confirmation (web `copied` state) — `true` for `autoResetDelay` after a
    /// successful copy, then reverted (web `setTimeout(() => setCopied(false), 2000)`).
    public private(set) var copied = false

    @ObservationIgnored private let textProvider: any CopyButtonTextProviding
    @ObservationIgnored private let clipboard: any CopyButtonClipboard
    @ObservationIgnored private weak var toast: (any CopyButtonToastPresenter)?
    @ObservationIgnored private let withToast: Bool
    @ObservationIgnored private let onCopy: (@MainActor () -> Void)?
    @ObservationIgnored private let telemetry: any CopyButtonTelemetry
    @ObservationIgnored private let autoResetDelay: Duration
    @ObservationIgnored private let logger = Logger(
        subsystem: "io.teslasync.app",
        category: "shared-surface.CopyButton"
    )
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var resetTask: Task<Void, Never>?

    public init(
        textProvider: any CopyButtonTextProviding,
        clipboard: any CopyButtonClipboard = SystemCopyButtonClipboard(),
        toast: (any CopyButtonToastPresenter)? = nil,
        withToast: Bool = false,
        onCopy: (@MainActor () -> Void)? = nil,
        telemetry: any CopyButtonTelemetry = OSLogCopyButtonTelemetry(),
        autoResetDelay: Duration = .seconds(2)
    ) {
        self.textProvider = textProvider
        self.clipboard = clipboard
        self.toast = toast
        self.withToast = withToast
        self.onCopy = onCopy
        self.telemetry = telemetry
        self.autoResetDelay = autoResetDelay
    }

    /// The current string to copy (web `text` prop), read fresh at copy time so it tracks a caller
    /// that re-renders with a new value.
    public var currentText: String {
        textProvider.currentText
    }

    /// Emits `view.opened` exactly once, the first time the button appears (idempotent).
    public func markAppeared() {
        didEmitOpen = CopyButtonDiagnostics.openIfNeeded(
            alreadyEmitted: didEmitOpen,
            telemetry: telemetry
        )
    }

    /// The web `handleCopy`: write the current text to the clipboard, and on success flip to the
    /// "Copied" confirmation, invoke `onCopy`, announce the success toast (when `withToast`), and arm
    /// the reset timer; a failed write logs the error (web `console.error`) and announces the error
    /// toast (when `withToast`), leaving the button in its resting state. The `copied` mutation
    /// publishes immediately, so the UI shows "Copied" before the reset elapses.
    public func copyText() {
        let wrote = clipboard.write(currentText)
        let outcome = CopyButtonLogic.outcome(clipboardSucceeded: wrote)
        switch outcome {
        case .copied:
            copied = true
            onCopy?()
            announce(.copied)
            armReset()
        case .failed:
            logger.error("CopyButton: clipboard write failed")
            announce(.failed)
        }
    }

    /// Announces a copy outcome through the optional toast presenter — the parity of the web
    /// `withToast && toast?.success` / `toast?.error`; only fires when the caller opted in and a
    /// presenter is mounted (the graceful off-provider degrade).
    private func announce(_ outcome: CopyButtonCopyOutcome) {
        guard withToast, let toast else { return }
        let intent = CopyButtonLogic.toastIntent(for: outcome)
        toast.presentToast(
            severity: intent.severity,
            message: CopyButtonStrings.string(intent.messageKey, intent.messageFallback)
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
