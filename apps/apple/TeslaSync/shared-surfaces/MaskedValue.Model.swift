//
//  MaskedValue.Model.swift
//  TeslaSync — P4 shared surface · 0220 · MaskedValue (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), the reveal-audit seam, and the observable
//  state-holder (P1/S8) for the click-to-reveal privacy primitive. The web `<MaskedValue>` is purely
//  presentational: it takes its data as plain props and renders, with no fetcher — so the native peer
//  needs no data state-holder. What the holder DOES own is the surface's interaction lifecycle: it
//  carries the current ``MaskedValueInput`` (the props), the runtime `revealed` flag (the web `useState`),
//  the auto-hide timer (the web `setTimeout` + `clearTimeout`), the fire-and-forget reveal-audit side
//  effect (the web `postRevealAudit`), and the once-per-instance `view.opened` diagnostics event. The
//  view never performs networking — the audit flows through the injected ``MaskedValueAuditRecorder``.
//
//  i18n note: the web source resolves its three toggle/copy labels through `t()` with English fallbacks
//  (`mask.reveal` → "Reveal value", `mask.hide` → "Hide value", `mask.copy` → "Copy value"). Native ships
//  NO hardcoded prose, so those keys are resolved here through the P1/S10 facade. The `value` and
//  `ariaLabel` props are caller-supplied (already localized), so they are rendered verbatim — and the
//  `ariaLabel`, never the raw secret, is what VoiceOver reads.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "MaskedValue" table (the exact set from the web source
/// `components/ui/MaskedValue.tsx`), folded into the app `Localizable.xcstrings` catalog at integration
/// time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the
/// derivation deterministic and byte-identical to the web English copy.
public enum MaskedValueStrings {
    public static let table = "MaskedValue"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The reveal toggle label (web `t('mask.reveal', 'Reveal value')`).
    public static var reveal: String {
        string("mask.reveal", "Reveal value")
    }

    /// The hide toggle label (web `t('mask.hide', 'Hide value')`).
    public static var hide: String {
        string("mask.hide", "Hide value")
    }

    /// The copy button accessible label (web `t('mask.copy', 'Copy value')`).
    public static var copy: String {
        string("mask.copy", "Copy value")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol MaskedValueTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogMaskedValueTelemetry: MaskedValueTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Reveal-audit seam (web `postRevealAudit` → POST /audit/reveal)

/// The audit kind recorded on a reveal — the verbatim port of the web POST body `{ kind: 'masked_reveal',
/// variant }`. A stable, non-identifying constant.
public enum MaskedValueAudit {
    /// The audit event kind (web `kind: 'masked_reveal'`).
    public static let kind = "masked_reveal"
}

/// The seam a reveal is recorded through — the native parity of the web fire-and-forget
/// `fetch('/audit/reveal', { method: 'POST', … })`. Only invoked when the caller opts in
/// (`auditOnReveal=true`, web default false). Implementations MUST be fire-and-forget and MUST NOT
/// throw or block: an audit is defense-in-depth and must never interfere with the reveal UX (the web
/// swallows every error by design). The production app injects a recorder that forwards to the
/// shared-core audit client; previews / isolated tests use the default logger or a recording double.
public protocol MaskedValueAuditRecorder: Sendable {
    /// Records a reveal for the given `variant` (web `postRevealAudit(variant)`); never throws, never
    /// blocks.
    func recordReveal(variant: String)
}

/// `os.Logger`-backed default that records the reveal as a redaction-safe audit breadcrumb. It performs
/// no network I/O itself (the production app swaps in an HTTP-backed recorder), so the conservative web
/// default — `auditOnReveal=false`, meaning nothing fires until a real route exists — is preserved.
public struct OSLogMaskedValueAuditRecorder: MaskedValueAuditRecorder {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "audit") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func recordReveal(variant: String) {
        logger.info("audit kind=\(MaskedValueAudit.kind, privacy: .public) variant=\(variant, privacy: .public)")
    }
}

// MARK: - MaskedValueModel (P1/S8) — interaction lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``MaskedValueInput`` (the web props), the
/// runtime `revealed` flag (web `useState`), the auto-hide timer (web `setTimeout`/`clearTimeout`), and
/// the reveal-audit side effect (web `postRevealAudit`), derives the pure ``MaskedValueProjection`` as an
/// observed read (SwiftUI observation replaces the React re-render), and emits `view.opened` exactly once
/// per instance. The web component has no fetcher, so neither does this holder.
@MainActor
@Observable
public final class MaskedValueModel {
    /// The current props (web `props`). Reading it (or the derived projection / `revealed`) registers an
    /// observation dependency, so the surface re-renders when the value / variant / flags change.
    public private(set) var input: MaskedValueInput

    /// Whether the cleartext is currently shown (web `revealed` state). Masked by default; auto-hides
    /// after `autoHideMs` (web `setTimeout`), and resets to masked when the surface tears down (web
    /// unmount), so a re-appear shows the masked form again.
    public private(set) var revealed = false

    @ObservationIgnored private let auditRecorder: any MaskedValueAuditRecorder
    @ObservationIgnored private let telemetry: any MaskedValueTelemetry
    @ObservationIgnored private var autoHideTask: Task<Void, Never>?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: MaskedValueInput,
        auditRecorder: any MaskedValueAuditRecorder = OSLogMaskedValueAuditRecorder(),
        telemetry: any MaskedValueTelemetry = OSLogMaskedValueTelemetry()
    ) {
        self.input = input
        self.auditRecorder = auditRecorder
        self.telemetry = telemetry
    }

    /// The resolved, view-ready model (web render output), with the toggle + copy labels resolved through
    /// the P1/S10 facade.
    public var projection: MaskedValueProjection {
        MaskedValueProjector.resolve(
            input,
            revealLabel: MaskedValueStrings.reveal,
            hideLabel: MaskedValueStrings.hide,
            copyLabel: MaskedValueStrings.copy
        )
    }

    /// Whether the auto-hide timer is currently armed — a deterministic test seam (the native peer of an
    /// active web `setTimeout` handle).
    public var isAutoHideArmed: Bool {
        autoHideTask != nil
    }

    /// Reveals the cleartext — the web `reveal`: a no-op on the empty branch (web `if (raw.length === 0)
    /// return`); otherwise flips to revealed, clears any pending timer, records the audit when opted in
    /// (web `auditOnReveal && postRevealAudit(variant)`), and arms the auto-hide (web `setTimeout`).
    public func reveal() {
        guard !input.isEmpty else { return }
        revealed = true
        cancelAutoHide()
        if input.auditOnReveal {
            auditRecorder.recordReveal(variant: input.variant.rawValue)
        }
        if input.autoHideMs > 0 {
            armAutoHide(afterMs: input.autoHideMs)
        }
    }

    /// Hides the cleartext — the web `hide`: back to masked and clears the auto-hide timer (web
    /// `clearTimer`).
    public func hide() {
        revealed = false
        cancelAutoHide()
    }

    /// Toggles reveal / hide — the web `onClick={revealed ? hide : reveal}`.
    public func toggle() {
        if revealed {
            hide()
        } else {
            reveal()
        }
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// input actually changes; if the new value is empty (no content to reveal) it also collapses back to
    /// masked and clears any pending timer, mirroring the web early-return branch.
    public func update(_ input: MaskedValueInput) {
        guard input != self.input else { return }
        self.input = input
        if input.isEmpty {
            hide()
        }
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance, never again on a later re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: MaskedValueSurface.slug)
        }
    }

    /// Marks the surface inactive and releases the auto-hide timer (web unmount `clearTimer`), resetting
    /// to masked so a teardown mid-reveal never leaks a fired timer against a gone view and a re-appear
    /// shows the masked form again (web remount). The once-only `view.opened` contract is preserved.
    public func stop() {
        started = false
        hide()
    }

    /// Arms (or re-arms) the auto-hide — the native parity of the web `setTimeout(() => setRevealed(false),
    /// autoHideMs)`; a fresh reveal cancels the prior timer first.
    private func armAutoHide(afterMs milliseconds: Int) {
        cancelAutoHide()
        autoHideTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(milliseconds))
            guard !Task.isCancelled else { return }
            self?.revealed = false
            self?.autoHideTask = nil
        }
    }

    /// Cancels any pending auto-hide timer (web `clearTimeout` + null-out).
    private func cancelAutoHide() {
        autoHideTask?.cancel()
        autoHideTask = nil
    }
}
