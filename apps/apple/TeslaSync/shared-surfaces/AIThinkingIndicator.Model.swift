//
//  AIThinkingIndicator.Model.swift
//  TeslaSync — P4 shared surface · 0053 · AIThinkingIndicator (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the AI "thinking" indicator. The view binds through
//  `AIThinkingIndicatorModel`; no networking lives in the view (the web source has none — it reads
//  only `useTranslation`). The model resolves the label once from the input + the i18n facade and
//  emits the `view.opened` diagnostics event exactly once when the surface first appears (the web
//  indicator always presents — there is no gate — so the first appearance is the open moment).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AIThinkingTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogAIThinkingTelemetry: AIThinkingTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Resolves the leading label from the input override + the
/// i18n facade (the native binding for the web `useTranslation` read), exposes the resolved
/// projection, and emits the `view.opened` diagnostics event exactly once when the indicator first
/// appears. There is no async source because the web source has no data dependency.
@MainActor
@Observable
public final class AIThinkingIndicatorModel {
    public private(set) var resolved: AIThinkingResolved

    /// Convenience accessor for the resolved leading label.
    public var label: String {
        resolved.label
    }

    @ObservationIgnored private let telemetry: any AIThinkingTelemetry
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: AIThinkingIndicatorInput = AIThinkingIndicatorInput(),
        telemetry: any AIThinkingTelemetry = OSLogAIThinkingTelemetry(),
        resolve: AIThinkingResolve = AIThinkingStrings.string
    ) {
        let defaultLabel = resolve(
            AIThinkingIndicatorMeta.defaultLabelKey,
            AIThinkingIndicatorMeta.defaultLabelFallback
        )
        resolved = AIThinkingProjection.resolve(input, defaultLabel: defaultLabel)
        self.telemetry = telemetry
    }

    /// Records the surface open exactly once. Idempotent across re-appears (the indicator may mount
    /// and unmount repeatedly while a stream churns, but `view.opened` fires only the first time).
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: AIThinkingIndicatorMeta.surfaceSlug)
    }

    /// Symmetry with `start()` for the view lifecycle; the surface holds no resources to release.
    public func stop() {}
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys mirror the web source (`helix.thinking`, plus the documented
/// `ai.common.thinking` override verb), folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings.
public enum AIThinkingStrings {
    public static let table = "AIThinkingIndicator"

    public static let string: AIThinkingResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
