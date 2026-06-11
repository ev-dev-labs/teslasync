//
//  ChartExportMenu.Model.swift
//  TeslaSync — P4 shared surface · 0066 · ChartExportMenu (Apple)
//
//  The Foundation-only core of the chart-export overflow menu — the native parity of
//  `components/charts/ChartExportMenu.tsx`. The web component is a single Download-icon trigger
//  that opens a menu of export actions ("Download data as CSV" / "Save as PNG" / "Save as SVG" /
//  "Copy image to clipboard"); the copy action resolves a `ClipboardOutcome` and announces the
//  result through a toast. It is purely props-driven: its only hooks are `useTranslation` (the
//  P1/S10 localisation facade) and `useOptionalToast` (a non-throwing toast accessor that returns
//  `null` outside a provider). There is no network and no data-fetch state holder to bind — so
//  this layer mirrors that exactly: the pure menu projection, the clipboard-outcome → toast
//  mapping, the i18n facade, the diagnostics slug + telemetry seam (P1/S11), the optional toast
//  seam (the native shape of `useOptionalToast`), and the `@MainActor` action model that owns the
//  host-supplied export callbacks. View-free so every branch and mapping is unit tested without
//  rendering a view.
//
//  Branches reproduced from the web source (every one is exercised — there is no hidden surface
//  beyond the web-faithful "menu cannot open while disabled"):
//    • disabled  — the trigger is inert and the menu cannot open; the trigger label switches to
//                  the "not ready" affordance (web `disabledTooltip`).
//    • busy      — the image-capture items (PNG / SVG / Copy) are disabled while a snapshot is in
//                  flight; the CSV item ignores `busy` (web: CSV doesn't depend on the chart DOM).
//    • csv       — the optional "Download data as CSV" item leads the menu only when a CSV handler
//                  is supplied (web `onExportCsv && …`).
//    • copy      — the async copy resolves `copied` / `fallback` / `failed`, mapped to a success /
//                  info / error toast; with no toast presenter the copy still runs (the download
//                  side effect) and the announcement is skipped (web `if (!toast) return`).
//

import Foundation
import Observation
import OSLog

// MARK: - Clipboard outcome (web `ClipboardOutcome` from @/hooks/useChartExport)

/// The result of a copy-image attempt — the native port of the web
/// `type ClipboardOutcome = 'copied' | 'fallback' | 'failed'`. The async `onCopyImage` handler
/// resolves one of these so the menu can announce the result with the matching toast severity.
public enum ChartExportClipboardOutcome: String, Sendable, Equatable, CaseIterable {
    /// The image was written to the clipboard (web success toast).
    case copied
    /// The clipboard was unavailable, so the image was downloaded instead (web info toast).
    case fallback
    /// The copy failed outright (web error toast).
    case failed
}

// MARK: - Menu action (the four web menu items)

/// The export actions the overflow menu can offer — one case per web menu item. `csv` is optional
/// (present only when a CSV handler is supplied); `png` / `svg` / `copy` are always present.
public enum ChartExportMenuAction: String, Sendable, Equatable, CaseIterable, Identifiable {
    case csv
    case png
    case svg
    case copy

    public var id: String {
        rawValue
    }

    /// Whether the action captures the chart image and is therefore gated by the `busy` flag (web:
    /// PNG / SVG / Copy carry `disabled={busy}`; CSV does not because it doesn't read the chart DOM).
    public var dependsOnSnapshot: Bool {
        self != .csv
    }
}

// MARK: - Toast severity + intent (web `toast.success` / `.info` / `.error`)

/// The toast severity the copy outcome maps to — the subset of the web `ToastType` the menu emits.
public enum ChartExportToastSeverity: String, Sendable, Equatable {
    case success
    case info
    case error
}

/// A resolved toast request — the severity plus the localisation key + web English fallback of the
/// message to announce. Built by `ChartExportMenuLogic.toastIntent(for:)` from a clipboard outcome.
public struct ChartExportToastIntent: Sendable, Equatable {
    public let severity: ChartExportToastSeverity
    public let messageKey: String
    public let messageFallback: String

    public init(severity: ChartExportToastSeverity, messageKey: String, messageFallback: String) {
        self.severity = severity
        self.messageKey = messageKey
        self.messageFallback = messageFallback
    }
}

// MARK: - Menu item projection (web menu item rows)

/// A single resolved menu row — the action, its localisation key + web English fallback, the SF
/// Symbol that mirrors the web lucide glyph, and whether it is currently enabled. Produced by
/// `ChartExportMenuLogic.menuItems(hasCsv:busy:)` so the view is a pure function of the inputs.
public struct ChartExportMenuItem: Sendable, Equatable, Identifiable {
    public let action: ChartExportMenuAction
    public let labelKey: String
    public let labelFallback: String
    public let systemImage: String
    public let isEnabled: Bool

    public var id: ChartExportMenuAction {
        action
    }

    public init(
        action: ChartExportMenuAction,
        labelKey: String,
        labelFallback: String,
        systemImage: String,
        isEnabled: Bool
    ) {
        self.action = action
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.systemImage = systemImage
        self.isEnabled = isEnabled
    }
}

// MARK: - Pure projection logic (web `triggerLabel`, menu-item list, copy-outcome mapping)

/// The view-free decision logic ported from the web component: the menu-item list (incl. the
/// optional CSV lead item and the `busy` gating), the trigger-label switch, the open guard, and the
/// clipboard-outcome → toast mapping. Each function is a direct translation of a web branch so the
/// view stays a pure function of these and every branch is unit tested in isolation.
public enum ChartExportMenuLogic {
    /// The localisation key + web English fallback for an action's menu label.
    static func label(for action: ChartExportMenuAction) -> (key: String, fallback: String) {
        switch action {
        case .csv: ("chart.export.csv", "Download data as CSV")
        case .png: ("chart.export.png", "Save as PNG")
        case .svg: ("chart.export.svg", "Save as SVG")
        case .copy: ("chart.export.copy", "Copy image to clipboard")
        }
    }

    /// The SF Symbol mirroring the web lucide glyph for an action.
    static func systemImage(for action: ChartExportMenuAction) -> String {
        switch action {
        case .csv: "tablecells" // web FileSpreadsheet
        case .png: "photo" // web Image
        case .svg: "doc.richtext" // web FileImage
        case .copy: "doc.on.doc" // web Copy
        }
    }

    /// Builds one `ChartExportMenuItem` for an action at the current `busy` level.
    static func item(for action: ChartExportMenuAction, busy: Bool) -> ChartExportMenuItem {
        let label = label(for: action)
        // CSV ignores `busy`; the snapshot-dependent items are disabled while a capture is in flight.
        let enabled = action.dependsOnSnapshot ? !busy : true
        return ChartExportMenuItem(
            action: action,
            labelKey: label.key,
            labelFallback: label.fallback,
            systemImage: systemImage(for: action),
            isEnabled: enabled
        )
    }

    /// The ordered menu rows — the verbatim port of the web JSX: the optional CSV lead item, then
    /// PNG, SVG, and Copy. `busy` disables the snapshot-dependent items; the CSV item is unaffected.
    public static func menuItems(hasCsv: Bool, busy: Bool) -> [ChartExportMenuItem] {
        var actions: [ChartExportMenuAction] = []
        if hasCsv { actions.append(.csv) }
        actions.append(contentsOf: [.png, .svg, .copy])
        return actions.map { item(for: $0, busy: busy) }
    }

    /// The trigger's accessible label — the web `disabled ? disabledTooltip : menuLabel` switch.
    public static func triggerLabel(disabled: Bool) -> (key: String, fallback: String) {
        disabled
            ? ("chart.export.disabledTooltip", "Chart not ready to export")
            : ("chart.export.menuLabel", "Export chart")
    }

    /// Whether the menu may open — the web `open && !disabled` guard reduced to its precondition.
    public static func canOpen(disabled: Bool) -> Bool {
        !disabled
    }

    /// Maps a clipboard outcome to its toast intent — the verbatim port of the web
    /// `copied → success` / `fallback → info` / `failed → error` announcement branch.
    public static func toastIntent(for outcome: ChartExportClipboardOutcome) -> ChartExportToastIntent {
        switch outcome {
        case .copied:
            ChartExportToastIntent(
                severity: .success,
                messageKey: "chart.export.copySuccess",
                messageFallback: "Chart image copied to clipboard"
            )
        case .fallback:
            ChartExportToastIntent(
                severity: .info,
                messageKey: "chart.export.copyFallback",
                messageFallback: "Clipboard not available — image downloaded instead"
            )
        case .failed:
            ChartExportToastIntent(
                severity: .error,
                messageKey: "chart.export.copyFailed",
                messageFallback: "Failed to copy chart image"
            )
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). A static,
/// non-identifying constant matching the web component name.
public enum ChartExportMenuMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChartExportMenu"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ChartExportMenuTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogChartExportMenuTelemetry: ChartExportMenuTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

/// The testable emission seam: emits `view.opened` exactly once, the first time the menu appears.
/// Returns the new "already emitted" flag so the caller can thread it across appearances without
/// double counting.
public enum ChartExportMenuDiagnostics {
    public static func openIfNeeded(
        alreadyEmitted: Bool,
        telemetry: any ChartExportMenuTelemetry
    ) -> Bool {
        guard !alreadyEmitted else { return true }
        telemetry.viewOpened(surface: ChartExportMenuMeta.surfaceSlug)
        return true
    }
}

// MARK: - Toast seam (native parity of `useOptionalToast`)

/// The optional toast presenter the menu announces copy outcomes through — the native shape of the
/// web `useOptionalToast()` accessor, which returns `null` outside a `ToastProvider`. The host
/// injects a presenter that forwards to the app's shared toast surface; previews and isolated tests
/// pass `nil` (the menu then degrades gracefully, exactly like the web `if (!toast) return`).
@MainActor
public protocol ChartExportMenuToastPresenter: AnyObject {
    func presentToast(severity: ChartExportToastSeverity, message: String)
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "ChartExportMenu" table (the exact set from the web source
/// `components/charts/ChartExportMenu.tsx`), folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings.
public enum ChartExportMenuStrings {
    public static let table = "ChartExportMenu"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The resolved menu label for an item (web `t(item.key, item.default)`).
    public static func itemLabel(_ item: ChartExportMenuItem) -> String {
        string(item.labelKey, item.labelFallback)
    }

    /// The resolved trigger label for the current disabled state.
    public static func triggerLabel(disabled: Bool) -> String {
        let label = ChartExportMenuLogic.triggerLabel(disabled: disabled)
        return string(label.key, label.fallback)
    }

    /// The resolved announcement for a clipboard outcome (web `t(intent.key, intent.default)`).
    public static func toastMessage(for outcome: ChartExportClipboardOutcome) -> String {
        let intent = ChartExportMenuLogic.toastIntent(for: outcome)
        return string(intent.messageKey, intent.messageFallback)
    }
}

// MARK: - Action model (@MainActor owner of the host export callbacks)

/// The `@MainActor` action model the view binds through — the home for the host-supplied export
/// callbacks (the native shape of the web `onExportPNG` / `onExportSVG` / `onCopyImage` /
/// `onExportCsv` props), the optional toast presenter, and the once-only `view.opened` emission. The
/// view stays a pure function of `disabled` / `busy` / `hasCsv`; this model carries the side effects
/// off the view so async export work and toast announcements run on the main actor without leaking
/// `Task` plumbing into the SwiftUI layer.
@MainActor
@Observable
public final class ChartExportMenuModel {
    @ObservationIgnored private let onExportPNG: @MainActor () async -> Void
    @ObservationIgnored private let onExportSVG: @MainActor () async -> Void
    @ObservationIgnored private let onCopyImage: @MainActor () async -> ChartExportClipboardOutcome
    @ObservationIgnored private let onExportCsv: (@MainActor () -> Void)?
    @ObservationIgnored private weak var toast: (any ChartExportMenuToastPresenter)?
    @ObservationIgnored private let telemetry: any ChartExportMenuTelemetry
    @ObservationIgnored private var didEmitOpen = false

    public init(
        onExportPNG: @escaping @MainActor () async -> Void,
        onExportSVG: @escaping @MainActor () async -> Void,
        onCopyImage: @escaping @MainActor () async -> ChartExportClipboardOutcome,
        onExportCsv: (@MainActor () -> Void)? = nil,
        toast: (any ChartExportMenuToastPresenter)? = nil,
        telemetry: any ChartExportMenuTelemetry = OSLogChartExportMenuTelemetry()
    ) {
        self.onExportPNG = onExportPNG
        self.onExportSVG = onExportSVG
        self.onCopyImage = onCopyImage
        self.onExportCsv = onExportCsv
        self.toast = toast
        self.telemetry = telemetry
    }

    /// Whether the optional CSV lead item is offered (web `onExportCsv && …`).
    public var hasCsv: Bool {
        onExportCsv != nil
    }

    /// Emits `view.opened` exactly once, the first time the menu appears (idempotent).
    public func markAppeared() {
        didEmitOpen = ChartExportMenuDiagnostics.openIfNeeded(
            alreadyEmitted: didEmitOpen,
            telemetry: telemetry
        )
    }

    /// Dispatches a chosen menu action — the synchronous parity of the web item `onClick` handlers.
    /// CSV runs inline; the snapshot-dependent actions are awaited off a child task so the view's
    /// tap handler returns immediately (the menu has already dismissed).
    public func perform(_ action: ChartExportMenuAction) {
        switch action {
        case .csv:
            onExportCsv?()
        case .png:
            Task { await self.exportPNG() }
        case .svg:
            Task { await self.exportSVG() }
        case .copy:
            Task { await self.copyImage() }
        }
    }

    /// Awaits the host PNG export (web `void onExportPNG()`). Exposed for direct test invocation.
    public func exportPNG() async {
        await onExportPNG()
    }

    /// Awaits the host SVG export (web `void onExportSVG()`). Exposed for direct test invocation.
    public func exportSVG() async {
        await onExportSVG()
    }

    /// Awaits the host copy handler then announces the outcome through the optional toast — the
    /// verbatim port of the web `const result = await onCopyImage(); if (!toast) return; …` branch.
    public func copyImage() async {
        let outcome = await onCopyImage()
        guard let toast else { return }
        let intent = ChartExportMenuLogic.toastIntent(for: outcome)
        let message = ChartExportMenuStrings.string(intent.messageKey, intent.messageFallback)
        toast.presentToast(severity: intent.severity, message: message)
    }
}
