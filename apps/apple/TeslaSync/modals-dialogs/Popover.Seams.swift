//
//  Popover.Seams.swift
//  TeslaSync — P4 modal / dialog · 0015 · Popover (Apple)
//
//  The dependency seams the `Popover` primitive binds through, kept apart from the model/views for
//  the lint length budget: the P1/S11 telemetry contract (`view.opened`), the P1/S10 i18n facade
//  (the surface is anonymous in the web source, so the only copy is the accessibility region /
//  dismiss labels + an empty-content fallback), and the VoiceOver string builders.
//
//  The web `Popover` (components/ui/Popover.tsx) carries no data hooks and no visible text — it is a
//  pure positioning primitive (`role="dialog"`, `aria-modal="false"`, optional `ariaLabel`). These
//  seams therefore exist for diagnostics + accessibility only; there is no network anywhere in the
//  surface.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event when the popover is presented. The default logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol PopoverTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the open as a `view.opened`. The slug is a static,
/// non-identifying constant (`PopoverSurfaceID.slug`).
public struct OSLogPopoverTelemetry: PopoverTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback so the views hold no hardcoded
/// literals. Keys live in the "Popover" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum PopoverStrings {
    public static let table = "Popover"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum PopoverAccessibility {
    /// Default region-label fallback key + English (web: the `ariaLabel` prop, or a generic role).
    public static let regionKey = "popover.region.defaultLabel"
    public static let regionFallback = "Popover"

    /// Dismiss-affordance label (web: Esc / click-outside close).
    public static let dismissKey = "popover.dismiss"
    public static let dismissFallback = "Dismiss"

    /// Empty-content fallback shown when no children are supplied (web renders an empty surface).
    public static let emptyKey = "popover.empty"
    public static let emptyFallback = "Nothing to show"

    /// The popover region's VoiceOver label: the caller's `ariaLabel` when present (web
    /// `aria-label={ariaLabel}`), else the localized default. A blank custom label collapses to the
    /// default so the region is never announced as empty.
    public static func regionLabel(
        custom: String?,
        localize: (String, String) -> String = PopoverStrings.string
    ) -> String {
        if let custom, !custom.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return custom
        }
        return localize(regionKey, regionFallback)
    }

    /// The dismiss control's VoiceOver label.
    public static func dismissLabel(localize: (String, String) -> String = PopoverStrings.string) -> String {
        localize(dismissKey, dismissFallback)
    }

    /// The empty-state fallback copy.
    public static func emptyLabel(localize: (String, String) -> String = PopoverStrings.string) -> String {
        localize(emptyKey, emptyFallback)
    }
}
