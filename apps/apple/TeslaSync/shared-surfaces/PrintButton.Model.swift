//
//  PrintButton.Model.swift
//  TeslaSync — P4 shared surface · 0223 · PrintButton (Apple)
//
//  The Foundation-only core of the print button — the native parity of
//  `components/ui/PrintButton.tsx`. The web component is a single ghost `Button` that opens the
//  browser print dialog (`window.print()`) for the current page, after optionally awaiting a caller
//  `beforePrint` setup hook (expand collapsed panels / switch to the tab the user wants on paper) and
//  giving the renderer one animation frame to flush the resulting state before the page is snapshotted.
//  A `printing` flag guards re-entrancy so a second click while a print is in flight is ignored, and a
//  thrown `beforePrint` is logged and resets the flag (no dialog). Its only hook is `useTranslation`
//  (the P1/S10 localisation facade) — there is no network and no data-fetch state holder — so this
//  layer mirrors that exactly: the surface identity + telemetry seam (P1/S11), the pure icon / label /
//  accessibility / re-entrancy-guard logic ported verbatim from the web branches, the i18n facade, and
//  the `@MainActor` model that binds the platform print presenter (the native shape of `window.print`,
//  P1/S8) and owns the transient `isPrinting` flag + the `beforePrint` hook. View-free so every branch
//  is unit tested without rendering a view.
//
//  Branches reproduced from the web source (every one is exercised). Like the sibling stateless,
//  networkless action surfaces ChartExportMenu 0066 / CopyLinkButton 0168 / CopyButton 0207 /
//  FullscreenButton 0214, the generic data-feed leaf states (loading / empty / stale / offline /
//  error-retry) do not apply to a print-trigger primitive that fetches nothing — they are intentionally
//  absent rather than faked; the states reproduced are the ACTUAL ones the web component renders +
//  the behavioural branches its click handler walks:
//    • resting   — the `Printer` glyph + "Print" (or a caller `label` override); enabled.
//    • iconOnly  — the dense glyph-only variant: no visible title, the spoken label carried as the
//                  accessibility label (web `iconOnly ? null : printLabel` + `resolvedAriaLabel`).
//    • disabled  — the trigger is non-interactive (web `disabled` prop).
//    • printing  — the in-flight re-entrancy guard (web `printing` state): a second activation is a
//                  no-op until the current print resolves. Non-visual in the web source, so the
//                  control's appearance is intentionally unchanged (web parity).
//    • beforeRun — a caller `beforePrint` hook runs and is awaited before the dialog opens (web
//                  `await beforePrint()`).
//    • beforeErr — a thrown / rejected `beforePrint` is logged and resets the guard; no dialog opens
//                  (web `catch` → `console.error` → `setPrinting(false)`).
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). A static,
/// non-identifying constant matching the web component name.
public enum PrintButtonMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "PrintButton"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol PrintButtonTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogPrintButtonTelemetry: PrintButtonTelemetry {
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
public enum PrintButtonDiagnostics {
    public static func openIfNeeded(
        alreadyEmitted: Bool,
        telemetry: any PrintButtonTelemetry
    ) -> Bool {
        guard !alreadyEmitted else { return true }
        telemetry.viewOpened(surface: PrintButtonMeta.surfaceSlug)
        return true
    }
}

// MARK: - Pure logic (web icon / label / aria switch, re-entrancy guard)

/// The view-free decision logic ported from the web component: the glyph (web `<Printer/>`), the
/// visible-label resolution (web `label ?? t('common.printButton.print', 'Print')`), the
/// accessibility-label resolution (web `ariaLabel ?? (iconOnly ? printLabel : undefined)`), and the
/// re-entrancy guard (web `if (printing) return`). Each function is a direct translation of a web
/// branch so the view + model stay pure functions of these and every branch is unit tested in
/// isolation.
public enum PrintButtonLogic {
    /// The SF Symbol mirroring the web lucide `Printer` glyph. `printer` is Apple's canonical print
    /// glyph.
    public static func iconSystemImage() -> String {
        "printer"
    }

    /// The visible button label — the verbatim port of the web `printLabel = label ?? t(…, 'Print')`.
    /// A caller `label` override wins; otherwise the localised default "Print" is used. The caller
    /// drops this entirely for `iconOnly`.
    public static func visibleLabel(labelOverride: String?, defaultLabel: String) -> String {
        labelOverride ?? defaultLabel
    }

    /// The assistive (`aria-label`) text — the port of the web
    /// `resolvedAriaLabel = ariaLabel ?? (iconOnly ? printLabel : undefined)`. The web leaves it
    /// `undefined` for the labelled button so the visible text is used; the native control needs a
    /// concrete spoken label (the icon + text content is hidden from VoiceOver), so both the icon-only
    /// and the labelled cases resolve to the same string the visible label shows — an explicit
    /// `ariaLabel` override still wins.
    public static func accessibilityLabel(
        ariaLabel: String?,
        labelOverride: String?,
        defaultLabel: String
    ) -> String {
        ariaLabel ?? (labelOverride ?? defaultLabel)
    }

    /// Whether a fresh print may start for the current in-flight flag — the verbatim port of the web
    /// `if (printing) return`: `false` while a print is already in flight (a second activation is a
    /// no-op), `true` when idle.
    public static func shouldStartPrint(isPrinting: Bool) -> Bool {
        !isPrinting
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "PrintButton" table (the exact set from the web source
/// `components/ui/PrintButton.tsx`), folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings.
public enum PrintButtonStrings {
    public static let table = "PrintButton"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The default print label (web `t('common.printButton.print', 'Print')`).
    public static func printLabel() -> String {
        string("common.printButton.print", "Print")
    }

    /// The resolved visible label for the current `label` override (web `printLabel`).
    public static func visibleLabel(labelOverride: String?) -> String {
        PrintButtonLogic.visibleLabel(labelOverride: labelOverride, defaultLabel: printLabel())
    }

    /// The resolved VoiceOver / `aria-label` for the control (web `resolvedAriaLabel`).
    public static func accessibilityLabel(ariaLabel: String?, labelOverride: String?) -> String {
        PrintButtonLogic.accessibilityLabel(
            ariaLabel: ariaLabel,
            labelOverride: labelOverride,
            defaultLabel: printLabel()
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model — the `@MainActor` owner of the bound platform print presenter
/// (the native shape of `window.print`), the optional `beforePrint` setup hook, and the transient
/// `isPrinting` re-entrancy guard. The view stays a pure function of its static props; this model
/// carries the side effects (the awaited `beforePrint`, the one-frame flush, the print presentation,
/// and the failure log) off the view so no `Task` plumbing leaks into the SwiftUI layer. The web
/// `handleClick` is reproduced verbatim by `performPrint()`.
@MainActor
@Observable
public final class PrintButtonModel {
    /// The in-flight re-entrancy guard (web `printing` state) — `true` from the moment a print starts
    /// until it resolves (or `beforePrint` throws). Published so tests can observe it; the web source
    /// does not change the button's appearance while it is set, so the view intentionally does not
    /// read it.
    public private(set) var isPrinting = false

    @ObservationIgnored private let presenter: any PrintPresenting
    @ObservationIgnored private let beforePrint: (@MainActor () async throws -> Void)?
    @ObservationIgnored private let telemetry: any PrintButtonTelemetry
    @ObservationIgnored private let logger = Logger(
        subsystem: "io.teslasync.app",
        category: "shared-surface.PrintButton"
    )
    @ObservationIgnored private var didEmitOpen = false

    public init(
        presenter: any PrintPresenting = SystemPrintPresenter.shared,
        beforePrint: (@MainActor () async throws -> Void)? = nil,
        telemetry: any PrintButtonTelemetry = OSLogPrintButtonTelemetry()
    ) {
        self.presenter = presenter
        self.beforePrint = beforePrint
        self.telemetry = telemetry
    }

    /// Emits `view.opened` exactly once, the first time the button appears (idempotent).
    public func markAppeared() {
        didEmitOpen = PrintButtonDiagnostics.openIfNeeded(
            alreadyEmitted: didEmitOpen,
            telemetry: telemetry
        )
    }

    /// The fire-and-forget entry the view's tap handler calls — spawns the awaited print flow so the
    /// SwiftUI action stays synchronous. `[weak self]` avoids retaining the model past the view.
    public func requestPrint() {
        Task { [weak self] in
            await self?.performPrint()
        }
    }

    /// The web `handleClick`: guard re-entrancy (web `if (printing) return`), mark in-flight (web
    /// `setPrinting(true)`), await the optional `beforePrint` setup hook (web `await beforePrint()`),
    /// yield one scheduler hop so SwiftUI flushes any resulting state before the snapshot (web
    /// `requestAnimationFrame`), then open the platform print dialog (web `window.print()`) and clear
    /// the guard (web `finally setPrinting(false)`). A thrown `beforePrint` is logged and clears the
    /// guard with no dialog (web `catch` → `console.error` → `setPrinting(false)`).
    public func performPrint() async {
        guard PrintButtonLogic.shouldStartPrint(isPrinting: isPrinting) else { return }
        isPrinting = true
        do {
            try await beforePrint?()
        } catch {
            logger.error("PrintButton: beforePrint threw; skipping print")
            isPrinting = false
            return
        }
        // web `requestAnimationFrame` — give the runtime one scheduler hop to flush any pre-print
        // state (expanded panels / switched tabs) before the page is snapshotted for the dialog.
        await Task.yield()
        presenter.present()
        isPrinting = false
    }
}
