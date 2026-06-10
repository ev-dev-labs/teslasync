//
//  ConfirmDialog.Seams.swift
//  TeslaSync — P4 modal / dialog · 0012 · ConfirmDialog (Apple)
//
//  The dependency seams the ConfirmDialog view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S11 telemetry contract, the confirm / cancel command seam (web
//  `onConfirm` / `onCancel`), the "Don't ask again" silence store (web `lib/confirmSilence.ts`,
//  `localStorage` → `UserDefaults`), the coalesced source snapshot, the P1/S8 source protocol, the
//  in-memory source for previews / tests, the P1/S10 i18n facade (web `useTranslation`), and the
//  VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol ConfirmDialogTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogConfirmDialogTelemetry: ConfirmDialogTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Confirm / cancel command seam (web `onConfirm` / `onCancel`)

/// The dialog's two decisions. `confirm()` is the web `onConfirm` — the parent forwards the
/// approval to its mutation (the native seam awaits it so the in-flight `submitting` state can drive
/// the spinner + disabled buttons, the parity of the web `loading` prop). `cancel()` is the web
/// `onCancel`. Keeps the action plumbing out of the view; the production app injects an adapter over
/// the caller's handlers, previews / tests use the logging / spy defaults.
public protocol ConfirmDialogController: Sendable {
    /// Approve the action (web `onConfirm`). Awaited so the dialog can show the in-flight state.
    func confirm() async
    /// Dismiss without acting (web `onCancel`).
    func cancel()
}

/// `os.Logger`-backed default that records the decisions without performing a mutation, so previews
/// render safely.
public struct OSLogConfirmDialogController: ConfirmDialogController {
    private let logger: Logger
    private let surface = ConfirmDialogSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "confirm")
    }

    public func confirm() async {
        logger.info("confirm.confirm surface=\(surface, privacy: .public)")
    }

    public func cancel() {
        logger.info("confirm.cancel surface=\(surface, privacy: .public)")
    }
}

// MARK: - Silence store seam (web `lib/confirmSilence.ts`)

/// The "Don't ask again" allowlist (web `isSilenced` / `silence`). The web persists a JSON array of
/// action ids under one versioned `localStorage` key; the native default mirrors that over
/// `UserDefaults`. Only non-destructive, non-typed prompts are ever silenced (enforced upstream by
/// `ConfirmDialogProjection.silenceHonored`).
@MainActor
public protocol ConfirmDialogSilenceStore: AnyObject {
    /// Whether the user previously opted to silence this action id (web `isSilenced`).
    func isSilenced(_ key: String) -> Bool
    /// Persist that the user no longer wants to be asked about this action id (web `silence`).
    func silence(_ key: String)
}

/// `UserDefaults`-backed silence store — the native parity of the web `localStorage` allowlist.
/// Stores a deduped string array under the same versioned key shape (`teslasync:confirm-silence:v1`)
/// so the contract reads identically across platforms.
@MainActor
public final class UserDefaultsConfirmDialogSilenceStore: ConfirmDialogSilenceStore {
    /// The single versioned allowlist key (web `STORAGE_KEY`).
    public static let storageKey = "teslasync:confirm-silence:v1"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func isSilenced(_ key: String) -> Bool {
        guard !key.isEmpty else { return false }
        return load().contains(key)
    }

    public func silence(_ key: String) {
        guard !key.isEmpty else { return }
        var set = load()
        guard !set.contains(key) else { return }
        set.insert(key)
        defaults.set(Array(set), forKey: Self.storageKey)
    }

    private func load() -> Set<String> {
        let raw = defaults.array(forKey: Self.storageKey) as? [String] ?? []
        return Set(raw)
    }
}

/// In-memory silence store for previews + unit tests. Seeds an optional initial allowlist and
/// records writes so a test can assert the persistence happened exactly once.
@MainActor
public final class InMemoryConfirmDialogSilenceStore: ConfirmDialogSilenceStore {
    public private(set) var silenced: Set<String>
    public private(set) var silenceCalls: [String] = []

    public init(silenced: Set<String> = []) {
        self.silenced = silenced
    }

    public func isSilenced(_ key: String) -> Bool {
        guard !key.isEmpty else { return false }
        return silenced.contains(key)
    }

    public func silence(_ key: String) {
        guard !key.isEmpty else { return }
        silenceCalls.append(key)
        silenced.insert(key)
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `ConfirmDialogSource`: the delivery status, the resolved
/// confirm request, the live-state freshness, the in-flight background-reload flag, and the
/// last-updated timestamp.
public struct ConfirmDialogUpdate: Sendable, Equatable {
    public var status: ConfirmLoadStatus
    public var request: ConfirmRequest?
    public var connection: ConfirmConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ConfirmLoadStatus = .loading,
        request: ConfirmRequest? = nil,
        connection: ConfirmConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.request = request
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 confirm-prompt
/// coordinator (the imperative `useConfirm()` trigger / the AI dispatcher confirm frame); previews /
/// tests use `InMemoryConfirmDialogSource`. The view never talks to persistence or the network.
@MainActor
public protocol ConfirmDialogSource: AnyObject {
    var onUpdate: (@MainActor (ConfirmDialogUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the pending request (web refetch / the error-state retry / stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryConfirmDialogSource: ConfirmDialogSource {
    public var onUpdate: (@MainActor (ConfirmDialogUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ConfirmDialogUpdate?

    public init(initial: ConfirmDialogUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: ConfirmDialogUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "ConfirmDialog" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum ConfirmDialogStrings {
    public static let table = "ConfirmDialog"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{value}}`): resolves then substitutes.
    public static func string(
        _ key: String,
        _ fallback: String,
        _ token: String,
        _ value: String
    ) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum ConfirmDialogAccessibility {
    /// The dialog's region label (web `Modal` `title`). Falls back to the localized "Confirm" when a
    /// request carries no title.
    public static func summary(title: String, localize: (String, String) -> String) -> String {
        if title.isEmpty {
            return localize(ConfirmDialogProjection.Keys.confirm, ConfirmDialogProjection.Fallbacks.confirm)
        }
        return title
    }

    /// The severity prefix read before the message so VoiceOver announces the stakes (web icon
    /// `aria` role) — "Critical" / "Warning", then the message.
    public static func messageLabel(
        severity: ConfirmSeverity,
        message: String,
        localize: (String, String) -> String
    ) -> String {
        let prefixKey = severity == .critical ? "confirm.a11y.critical" : "confirm.a11y.warning"
        let prefixFallback = severity == .critical ? "Critical" : "Warning"
        let prefix = localize(prefixKey, prefixFallback)
        return "\(prefix). \(message)"
    }

    /// The typed-confirmation field's VoiceOver label (web `aria-label={inputLabel}`).
    public static func typedFieldLabel(_ label: String) -> String {
        label
    }

    /// The "Don't ask again" checkbox label (web `aria-label`), with its checked state appended so
    /// VoiceOver announces the toggle.
    public static func silenceLabel(checked: Bool, localize: (String, String) -> String) -> String {
        let base = localize(
            ConfirmDialogProjection.Keys.silenceCheckbox,
            ConfirmDialogProjection.Fallbacks.silenceCheckbox
        )
        let stateKey = checked ? "confirm.a11y.checked" : "confirm.a11y.unchecked"
        let stateFallback = checked ? "Checked" : "Unchecked"
        return "\(base), \(localize(stateKey, stateFallback))"
    }
}
