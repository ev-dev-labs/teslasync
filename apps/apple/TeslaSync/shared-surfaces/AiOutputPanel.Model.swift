//
//  AiOutputPanel.Model.swift
//  TeslaSync — P4 shared surface · 0036 · AiOutputPanel (Apple)
//
//  The Foundation-only core of the streamed-output panel — the native parity of
//  `components/ai/AiOutputPanel.tsx`. Holds the stream lifecycle (web `AiStreamState`), the
//  pure render-branch decision logic (the verbatim port of the web `hasAnything` gate + the
//  three-way error / pending / text branch), the diagnostics slug + telemetry seam (P1/S11),
//  the i18n facade (P1/S10), and the testable accessibility-label seam. View-free so every
//  branch and every spoken label is unit tested without rendering a view.
//
//  The web component is purely props-driven (its only hook is `useTranslation`): it owns no
//  network and no state holder. The host feature surface drives `useAiStream` and feeds the
//  accumulated `text` / lifecycle `state` / terminal `error` in. This model layer mirrors that
//  exactly — there is no data source to bind, only the localisation facade and the render maths.
//

import Foundation
import OSLog

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web
/// `'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'` union exposed by `useAiStream`.
/// The panel reacts to `streaming` (open, awaiting the first delta), `error` (terminal failure),
/// and `done` (closed with content); `pausedConfirm` is carried for union fidelity though the
/// panel treats it like any non-terminal phase.
public enum AiOutputPanelStreamState: String, Sendable, Equatable, CaseIterable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error

    /// Web `state === 'error'`.
    public var isError: Bool {
        self == .error
    }
}

// MARK: - Render branch (web JSX conditional)

/// The single render branch the panel resolves to — the native projection of the web component's
/// conditional render. `hidden` is the web `return null` (nothing has streamed yet); the other
/// three map one-to-one to the JSX ternary arms.
public enum AiOutputPanelRender: Sendable, Equatable {
    /// Web `!hasAnything` → the component renders nothing.
    case hidden
    /// Web `state === 'error'` → the Helix error row. Carries the raw, unresolved error prop.
    case error(String?)
    /// Web `text.length === 0 && state === 'streaming'` → the pending (thinking) slot.
    case pending
    /// The accumulated narrative (`whitespace-pre-wrap`).
    case text(String)

    /// Whether the panel draws a bordered container (web: any branch other than `return null`).
    public var isVisible: Bool {
        if case .hidden = self { return false }
        return true
    }
}

// MARK: - Pure render + accessibility logic (web `hasAnything` + the JSX ternary)

/// The view-free decision logic ported from the web component. Each function is a direct
/// translation of a web boolean / branch so the view is a pure function of these and every
/// branch is unit tested in isolation.
public enum AiOutputPanelLogic {
    /// Web `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    public static func hasAnything(text: String, state: AiOutputPanelStreamState) -> Bool {
        !text.isEmpty || state == .streaming || state == .error || state == .done
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(text: String, state: AiOutputPanelStreamState) -> Bool {
        text.isEmpty && state == .streaming
    }

    /// The full render projection — the native parity of the web component's
    /// `if (!hasAnything) return null` gate followed by the error / pending / text ternary.
    public static func render(
        text: String,
        state: AiOutputPanelStreamState,
        error: String?
    ) -> AiOutputPanelRender {
        guard hasAnything(text: text, state: state) else { return .hidden }
        if state == .error { return .error(error) }
        if thinkingVisible(text: text, state: state) { return .pending }
        return .text(text)
    }

    /// Web `error ?? t('ai.common.errorUnknown', 'unknown')`, widened so an empty string also
    /// resolves to the localised "unknown" (a blank error message is never shown to the user).
    public static func resolveErrorMessage(_ error: String?, unknown: String) -> String {
        guard let error, !error.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return unknown
        }
        return error
    }

    /// The VoiceOver label for a resolved render branch, built from already-localised parts so the
    /// spoken content is asserted without rendering. `hidden` has no spoken content.
    public static func accessibilityLabel(
        for render: AiOutputPanelRender,
        labels: AiOutputPanelLabels
    ) -> String? {
        switch render {
        case .hidden:
            nil
        case let .error(raw):
            "\(labels.errorLabel) \(resolveErrorMessage(raw, unknown: labels.unknownLabel))"
        case .pending:
            labels.thinkingLabel
        case let .text(value):
            value
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). A static,
/// non-identifying constant matching the web component name.
public enum AiOutputPanelSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AiOutputPanel"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol AiOutputPanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogAiOutputPanelTelemetry: AiOutputPanelTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

/// The testable emission seam: emits `view.opened` exactly once, the first time the panel is
/// actually visible (web `hasAnything`). Returns the new "already emitted" flag so the caller can
/// thread it across the appear / phase-change transitions without double counting.
public enum AiOutputPanelDiagnostics {
    public static func openIfVisible(
        render: AiOutputPanelRender,
        alreadyEmitted: Bool,
        telemetry: any AiOutputPanelTelemetry
    ) -> Bool {
        guard render.isVisible, !alreadyEmitted else { return alreadyEmitted }
        telemetry.viewOpened(surface: AiOutputPanelSurface.slug)
        return true
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "AiOutputPanel" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum AiOutputPanelStrings {
    public static let table = "AiOutputPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Web `t('helix.errorLabel', 'Helix error:')`.
    public static var errorLabel: String {
        string("helix.errorLabel", "Helix error:")
    }

    /// Web `t('ai.common.errorUnknown', 'unknown')`.
    public static var unknownLabel: String {
        string("ai.common.errorUnknown", "unknown")
    }

    /// Web `AIThinkingIndicator` default `t('helix.thinking', 'Helix is thinking')`.
    public static var thinkingLabel: String {
        string("helix.thinking", "Helix is thinking")
    }
}

// MARK: - Accessibility label set

/// The already-localised labels the accessibility seam interleaves with the live render branch.
/// Resolved from the P1/S10 facade in production; constructed explicitly in tests.
public struct AiOutputPanelLabels: Sendable, Equatable {
    public let errorLabel: String
    public let unknownLabel: String
    public let thinkingLabel: String

    public init(errorLabel: String, unknownLabel: String, thinkingLabel: String) {
        self.errorLabel = errorLabel
        self.unknownLabel = unknownLabel
        self.thinkingLabel = thinkingLabel
    }

    /// The production label set, resolved through the P1/S10 facade.
    public static var resolved: AiOutputPanelLabels {
        AiOutputPanelLabels(
            errorLabel: AiOutputPanelStrings.errorLabel,
            unknownLabel: AiOutputPanelStrings.unknownLabel,
            thinkingLabel: AiOutputPanelStrings.thinkingLabel
        )
    }
}
