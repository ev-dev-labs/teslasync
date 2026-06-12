//
//  FullscreenButton.Model.swift
//  TeslaSync — P4 shared surface · 0214 · FullscreenButton (Apple)
//
//  The Foundation-only core of the fullscreen toggle button — the native parity of
//  `components/ui/FullscreenButton.tsx`. The web component wraps the browser Fullscreen API
//  (`requestFullscreen` / `exitFullscreen` / `fullscreenchange`) behind a single ghost icon-button
//  that toggles the fullscreen state of a target element. It hides itself entirely when the platform
//  cannot present element-level fullscreen (web `document.fullscreenEnabled === false`), sources its
//  on/off state from the platform (web `fullscreenchange`, NOT the click handler) so it stays honest
//  when the user presses Esc / the system revokes fullscreen / a sibling toggles the same target, and
//  flips its icon + accessible label + pressed state together. Its only hook is `useTranslation` (the
//  P1/S10 localisation facade) — there is no network and no data-fetch state holder — so this layer
//  mirrors that exactly: the surface identity + telemetry seam (P1/S11), the pure toggle / icon /
//  label / active-detection logic ported verbatim from the web branches, the i18n facade, and the
//  `@MainActor` model that binds the platform presenter (the native shape of the Fullscreen API,
//  P1/S8) and owns the target identity + the support override. View-free so every branch is unit
//  tested without rendering a view.
//
//  Branches reproduced from the web source (every one is exercised). Like the sibling stateless,
//  networkless action surfaces ChartExportMenu 0066 / CopyLinkButton 0168 / CopyButton 0207, the
//  generic data-feed leaf states (loading / empty / stale / offline / error-retry) do not apply to a
//  presentation-toggle primitive that fetches nothing — they are intentionally absent rather than
//  faked; the states reproduced are the ACTUAL ones the web component renders:
//    • unsupported — the platform cannot present element-level fullscreen (web
//                    `document.fullscreenEnabled === false`, or the `testHookSupported` override): the
//                    button renders nothing (web `if (!supported) return null`).
//    • resting     — nothing of ours is fullscreen: the "expand" glyph + "Enter fullscreen", pressed
//                    = false (web `isFs === false`).
//    • active      — our target (or a descendant) is fullscreen: the "collapse" glyph + "Exit
//                    fullscreen", pressed = true (web `isFs === true`).
//    • detached    — the target is not mounted (web `targetRef.current == null`): the button still
//                    renders but the toggle is a no-op (web `if (!target) return`).
//    • external    — the platform fullscreen state changed without a tap (Esc / system revoke /
//                    sibling): the button reflects it (web `fullscreenchange` listener), because the
//                    bound presenter is observable.
//    • descendant  — a descendant of the target is the fullscreen element: still reported as active
//                    (web `target.contains(el)`).
//    • arbitration — another element holds the fullscreen lock: released first, then our target is
//                    requested (web exit-then-request, avoids the "already fullscreen elsewhere"
//                    silent rejection).
//    • rejected    — the platform denied the request (web `catch` → `console.warn`): logged, the
//                    on/off state is left un-flipped.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). A static,
/// non-identifying constant matching the web component name.
public enum FullscreenButtonMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "FullscreenButton"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol FullscreenButtonTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogFullscreenButtonTelemetry: FullscreenButtonTelemetry {
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
public enum FullscreenButtonDiagnostics {
    public static func openIfNeeded(
        alreadyEmitted: Bool,
        telemetry: any FullscreenButtonTelemetry
    ) -> Bool {
        guard !alreadyEmitted else { return true }
        telemetry.viewOpened(surface: FullscreenButtonMeta.surfaceSlug)
        return true
    }
}

// MARK: - Toggle action (web `toggle()` decision tree)

/// The decision the toggle resolves to for the current target + live fullscreen element — the native
/// port of the web `toggle()` branches around `document.fullscreenElement`:
///   • `noop`         — no target mounted (web `if (!target) return`).
///   • `enter`        — nothing is fullscreen → request our target (web `requestFullscreen()`).
///   • `exit`         — our target (or a descendant) is fullscreen → release it (web
///                      `exitFullscreen()`).
///   • `exitThenEnter`— another element holds the lock → release it first, then request our target
///                      (web `exitFullscreen()` then `requestFullscreen()`).
public enum FullscreenButtonToggleAction: String, Sendable, Equatable, CaseIterable {
    case noop
    case enter
    case exit
    case exitThenEnter
}

// MARK: - Pure logic (web icon / label / active-detection / toggle switch)

/// The view-free decision logic ported from the web component: the glyph switch on the fullscreen
/// flag (web `isFs ? <Minimize/> : <Maximize/>`), the label resolution (web
/// `isFs ? exitLabel : enterLabel`), the active-detection (web
/// `el === target || target.contains(el)`), and the `toggle()` decision tree. Each function is a
/// direct translation of a web branch so the view stays a pure function of these and every branch is
/// unit tested in isolation.
public enum FullscreenButtonLogic {
    /// The SF Symbol mirroring the web lucide glyph for the current fullscreen flag (web
    /// `isFs ? <Minimize/> : <Maximize/>`). `arrow.up.left.and.arrow.down.right` is Apple's canonical
    /// "enter full screen" glyph (lucide `Maximize`); `arrow.down.right.and.arrow.up.left` is "exit
    /// full screen" (lucide `Minimize`).
    public static func iconSystemImage(isFullscreen: Bool) -> String {
        isFullscreen ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right"
    }

    /// The resolved button label — the verbatim port of the web `isFs ? exitLabel : enterLabel`,
    /// where each side falls back to its localised default unless the caller overrode it (web
    /// `ariaLabelEnter ?? t(…)` / `ariaLabelExit ?? t(…)`).
    public static func label(isFullscreen: Bool, enterLabel: String, exitLabel: String) -> String {
        isFullscreen ? exitLabel : enterLabel
    }

    /// Whether the button should read as fullscreen for the current target + live element — the
    /// verbatim port of the web `target != null && el != null && (el === target ||
    /// target.contains(el))`. A descendant of the target counts (web `contains`) so the icon stays
    /// honest when e.g. a child of the card is the live element.
    public static func isActive(
        targetID: String?,
        activeTargetID: String?,
        descendantIDs: Set<String>
    ) -> Bool {
        guard let targetID, let activeTargetID else { return false }
        return activeTargetID == targetID || descendantIDs.contains(activeTargetID)
    }

    /// The toggle decision for the current target + live element — the verbatim port of the web
    /// `toggle()` branch order: no target → noop; ours/descendant active → exit; another active →
    /// exit-then-enter; nothing active → enter.
    public static func toggleAction(
        targetID: String?,
        activeTargetID: String?,
        descendantIDs: Set<String>
    ) -> FullscreenButtonToggleAction {
        guard let targetID else { return .noop }
        guard let activeTargetID else { return .enter }
        if activeTargetID == targetID || descendantIDs.contains(activeTargetID) {
            return .exit
        }
        return .exitThenEnter
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "FullscreenButton" table (the exact set from the web source
/// `components/ui/FullscreenButton.tsx`), folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings.
public enum FullscreenButtonStrings {
    public static let table = "FullscreenButton"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The default "enter" label (web `t('common.fullscreen.enter', 'Enter fullscreen')`).
    public static func enterLabel() -> String {
        string("common.fullscreen.enter", "Enter fullscreen")
    }

    /// The default "exit" label (web `t('common.fullscreen.exit', 'Exit fullscreen')`).
    public static func exitLabel() -> String {
        string("common.fullscreen.exit", "Exit fullscreen")
    }

    /// The resolved label for the current state — a caller override wins on its side (web
    /// `ariaLabelEnter` / `ariaLabelExit`), otherwise the localised default is used.
    public static func resolvedLabel(
        isFullscreen: Bool,
        enterOverride: String?,
        exitOverride: String?
    ) -> String {
        FullscreenButtonLogic.label(
            isFullscreen: isFullscreen,
            enterLabel: enterOverride ?? enterLabel(),
            exitLabel: exitOverride ?? exitLabel()
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model — the `@MainActor` owner of the target identity (the native
/// parity of the web `targetRef` + the descendant set the web `target.contains(el)` walks), the
/// support override (the native shape of the web `testHookSupported` prop), the optional label
/// overrides (web `ariaLabelEnter` / `ariaLabelExit`), and the bound platform presenter (the native
/// shape of the Fullscreen API, read live so the button reflects Esc / system / sibling changes). The
/// view stays a pure function of `isFullscreen` + `isSupported`; this model carries the side effects
/// (the request / exit calls + the rejection log) off the view. The web `toggle` is reproduced
/// verbatim by `toggle()`; the web support gate by `isSupported`; the web `fullscreenchange`-sourced
/// state by `isFullscreen` (a live read of the observable presenter).
@MainActor
@Observable
public final class FullscreenButtonModel {
    /// The element the button toggles (web `targetRef.current` identity). `nil` is the web empty-ref
    /// case — the button renders but the toggle no-ops.
    public var targetID: String?

    /// The identities that count as "inside" the target (web `target.contains(el)`); a fullscreen
    /// element in this set reports the button as active. Empty for the common single-target case.
    public var descendantIDs: Set<String>

    @ObservationIgnored private let presenter: any FullscreenPresenting
    @ObservationIgnored private let supportOverride: Bool?
    @ObservationIgnored private let enterOverride: String?
    @ObservationIgnored private let exitOverride: String?
    @ObservationIgnored private let telemetry: any FullscreenButtonTelemetry
    @ObservationIgnored private let logger = Logger(
        subsystem: "io.teslasync.app",
        category: "shared-surface.FullscreenButton"
    )
    @ObservationIgnored private var didEmitOpen = false

    public init(
        targetID: String?,
        descendantIDs: Set<String> = [],
        presenter: any FullscreenPresenting = SystemFullscreenPresenter.shared,
        supportOverride: Bool? = nil,
        enterLabelOverride: String? = nil,
        exitLabelOverride: String? = nil,
        telemetry: any FullscreenButtonTelemetry = OSLogFullscreenButtonTelemetry()
    ) {
        self.targetID = targetID
        self.descendantIDs = descendantIDs
        self.presenter = presenter
        self.supportOverride = supportOverride
        enterOverride = enterLabelOverride
        exitOverride = exitLabelOverride
        self.telemetry = telemetry
    }

    /// Whether the platform can present element-level fullscreen — the web
    /// `testHookSupported !== undefined ? testHookSupported : probeSupport()`. When `false` the view
    /// renders nothing (web `if (!supported) return null`).
    public var isSupported: Bool {
        supportOverride ?? presenter.isFullscreenSupported
    }

    /// Whether the button currently reads as fullscreen — a live read of the observable presenter's
    /// active element vs our target / descendants (web `isFs`, sourced from `fullscreenchange`). The
    /// read is tracked by Observation so an external change re-renders the view.
    public var isFullscreen: Bool {
        FullscreenButtonLogic.isActive(
            targetID: targetID,
            activeTargetID: presenter.activeTargetID,
            descendantIDs: descendantIDs
        )
    }

    /// The label to show for the current state (web `isFs ? exitLabel : enterLabel`, with overrides).
    public var resolvedLabel: String {
        FullscreenButtonStrings.resolvedLabel(
            isFullscreen: isFullscreen,
            enterOverride: enterOverride,
            exitOverride: exitOverride
        )
    }

    /// Emits `view.opened` exactly once, the first time the button appears (idempotent).
    public func markAppeared() {
        didEmitOpen = FullscreenButtonDiagnostics.openIfNeeded(
            alreadyEmitted: didEmitOpen,
            telemetry: telemetry
        )
    }

    /// The web `toggle`: resolve the action for the current target + live fullscreen element, then
    /// release / request through the presenter. A `nil` target no-ops (web `if (!target) return`); a
    /// foreign lock is released first (web exit-then-request); a rejected request is logged and leaves
    /// the on/off state un-flipped (web `catch` → `console.warn`).
    public func toggle() {
        let action = FullscreenButtonLogic.toggleAction(
            targetID: targetID,
            activeTargetID: presenter.activeTargetID,
            descendantIDs: descendantIDs
        )
        switch action {
        case .noop:
            return
        case .exit:
            _ = presenter.exit()
        case .enter:
            requestEnter()
        case .exitThenEnter:
            _ = presenter.exit()
            requestEnter()
        }
    }

    /// Requests fullscreen on the current target, logging a warning when the platform denies it (web
    /// `requestFullscreen()` rejection → `console.warn`); the presenter leaves its state unchanged on
    /// failure so the button does not flip.
    private func requestEnter() {
        guard let targetID else { return }
        if !presenter.request(targetID: targetID) {
            logger.warning("FullscreenButton: requestFullscreen rejected for target")
        }
    }
}
