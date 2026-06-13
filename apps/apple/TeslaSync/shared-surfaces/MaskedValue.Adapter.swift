//
//  MaskedValue.Adapter.swift
//  TeslaSync — P4 shared surface · 0220 · MaskedValue (Apple)
//
//  The Foundation-only core for the click-to-reveal privacy primitive — the SwiftUI parity of
//  components/ui/MaskedValue.tsx. This file owns the surface identity (the diagnostics slug), the masking
//  axis (``MaskVariant`` — the verbatim port of the web `MaskVariant` union from `@/lib/maskValue`), the
//  pure ``MaskedValueMasker`` (the byte-for-byte port of `maskFor()` + its per-variant rules), the props
//  value type (``MaskedValueInput``), the view-ready ``MaskedValueProjection``, and the pure
//  ``MaskedValueProjector`` that resolves the masked text, the empty-vs-content branch, and the localized
//  toggle / copy labels. No SwiftUI and no @Observable, so every masking rule and branch is unit-testable
//  in isolation.
//
//  Faithful-parity note: the web `<MaskedValue>` is a PURE presentational primitive. It takes a sensitive
//  string (`value`) plus a masking `variant` and renders it masked-by-default with a click-to-reveal
//  toggle and an optional copy button — there is NO fetch, no React-Query cache, and no Promise. It
//  therefore has NO loading, error, stale, or offline branch: there is nothing to fetch, fail, age, or
//  lose connectivity to (the host passes the resolved string in). Inventing such chrome would fabricate
//  states the source does not have, so this surface reproduces ONLY the source's REAL branches, exactly
//  as the sibling presentational primitives StatusHero (0199) and CopyButton (0207) did. The real,
//  prop-driven branches are:
//    • empty   — `raw.length === 0` → an em-dash with the caller `aria-label` and NO toggle (web early
//                return). There is nothing to reveal.
//    • masked  — the default: the variant-masked bullets in the secondary tone + the eye toggle (+ an
//                optional copy button that always copies the raw value).
//    • revealed — the cleartext in the accent tone + the eye-off toggle; auto-hides after `autoHideMs`.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum MaskedValueSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "MaskedValue"
}

// MARK: - MaskVariant (web `MaskVariant` union from `@/lib/maskValue`)

/// The masking strategy — the verbatim port of the web `MaskVariant`
/// (`'token' | 'vin' | 'coords' | 'email' | 'generic'`). It selects which rule ``MaskedValueMasker``
/// applies and the default visible-suffix length. The raw values are byte-identical to the web union so a
/// parity table can round-trip them.
public enum MaskVariant: String, Sendable, Equatable, CaseIterable {
    /// Opaque API/auth tokens — a fixed 12-bullet run + the last `showLast` (default 4) characters, so a
    /// 16-char and a 64-char token look identical when masked (web `maskToken`).
    case token
    /// Tesla 17-char VIN — the 3-char WMI prefix + bullets + the last `showLast` (default 4); short inputs
    /// that cannot be VINs are fully bulleted (web `maskVin`).
    case vin
    /// A `lat,lng` pair rendered as `••.•••, ••.•••` (a single number is masked the same way); non-numeric
    /// input falls back to the generic mask (web `maskCoords`).
    case coords
    /// An e-mail — the local-part is masked while the domain stays visible, e.g. `j•••@example.com`
    /// (web `maskEmail`).
    case email
    /// The fallback — a bullet run to the hidden length with the last `showLast` (default 0) visible
    /// (web `maskGeneric`).
    case generic

    /// The default number of trailing characters left visible per variant — the verbatim port of the web
    /// `DEFAULT_SHOW_LAST` table. A caller `showLast` overrides it.
    public var defaultShowLast: Int {
        switch self {
        case .token: 4
        case .vin: 4
        case .coords: 0
        case .email: 1
        case .generic: 0
        }
    }
}

// MARK: - MaskedValueMasker (web `maskFor` + per-variant rules)

/// The pure masking core — the byte-for-byte port of `maskFor()` and its helpers from
/// `web/src/lib/maskValue.ts`. Total and never-throwing (matching the web contract): an empty string or
/// any variant yields a deterministic masked form with no null checks at the call site. The bullet is
/// U+2022 (•) and the coordinate separator is ", ", exactly as the web source.
public enum MaskedValueMasker {
    /// The bullet glyph (web `BULLET = '\u2022'`).
    static let bullet = "\u{2022}"
    /// The coordinate-pair separator (web `SEPARATOR = ', '`).
    static let separator = ", "

    /// Returns the user-visible masked representation of `value` — the verbatim port of the web `maskFor`.
    /// `showLast` overrides the variant default; an unknown variant cannot occur (the enum is total) but
    /// the `generic` rule is the web's documented fallback.
    public static func mask(_ value: String, variant: MaskVariant, showLast: Int? = nil) -> String {
        let last = showLast ?? variant.defaultShowLast
        switch variant {
        case .token: return maskToken(value, showLast: last)
        case .vin: return maskVin(value, showLast: last)
        case .coords: return maskCoords(value)
        case .email: return maskEmail(value, showLast: last)
        case .generic: return maskGeneric(value, showLast: last)
        }
    }

    /// A run of `count` bullets (web `bullets`); empty for a non-positive count.
    static func bullets(_ count: Int) -> String {
        count <= 0 ? "" : String(repeating: bullet, count: count)
    }

    /// The generic rule (web `maskGeneric`): a bullet run to the hidden length + the last `showLast`
    /// characters verbatim.
    static func maskGeneric(_ value: String, showLast: Int) -> String {
        if value.isEmpty { return "" }
        let visible = max(0, min(showLast, value.count))
        let hidden = value.count - visible
        return bullets(hidden) + String(value.suffix(visible))
    }

    /// The token rule (web `maskToken`): a FIXED 12-bullet run + the last `showLast` characters, so the
    /// masked form never leaks the original length.
    static func maskToken(_ value: String, showLast: Int) -> String {
        if value.isEmpty { return "" }
        let visible = max(0, min(showLast, value.count))
        return bullets(12) + String(value.suffix(visible))
    }

    /// The VIN rule (web `maskVin`): for a plausible VIN (≥ 11 chars) expose the 3-char WMI prefix + the
    /// last `showLast` and bullet the middle; shorter inputs (which cannot be VINs) are fully bulleted so
    /// the WMI of a tiny string is never exposed.
    static func maskVin(_ value: String, showLast: Int) -> String {
        if value.isEmpty { return "" }
        if value.count >= 11 {
            let visibleSuffix = max(0, min(showLast, value.count - 3))
            let hidden = value.count - 3 - visibleSuffix
            return String(value.prefix(3)) + bullets(hidden) + String(value.suffix(visibleSuffix))
        }
        return bullets(value.count)
    }

    /// The e-mail rule (web `maskEmail`): mask the local-part (always at least one bullet) while keeping
    /// the domain (including the `@`) visible. No `@`, or one at position 0, falls back to generic.
    static func maskEmail(_ value: String, showLast: Int) -> String {
        guard let atIndex = value.firstIndex(of: "@"), atIndex != value.startIndex else {
            return maskGeneric(value, showLast: max(showLast, 0))
        }
        let local = String(value[value.startIndex ..< atIndex])
        let domain = String(value[atIndex...])
        let visible = max(0, min(showLast, local.count))
        let masked = String(local.prefix(visible)) + bullets(max(local.count - visible, 1))
        return masked + domain
    }

    /// The coordinate rule (web `maskCoords`): each comma-separated numeric part renders as `••.•••`,
    /// joined by ", "; a single number masks the same way; any non-numeric part falls back to generic.
    ///
    /// Numeric detection mirrors the web `Number.isFinite(Number(p))`; Swift's `Double(_:)` rejects a few
    /// loose JS forms (a lone trailing dot like "5."), which only affects malformed coordinates — real
    /// `lat,lng` pairs (e.g. "37.7749,-122.4194") match exactly.
    static func maskCoords(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "" }
        let parts = trimmed
            .split(separator: ",", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if parts.isEmpty { return "" }
        let numeric = parts.allSatisfy { Double($0)?.isFinite == true }
        if !numeric { return maskGeneric(trimmed, showLast: 0) }
        return parts
            .map { _ in "\(bullet)\(bullet).\(bullet)\(bullet)\(bullet)" }
            .joined(separator: separator)
    }
}

// MARK: - MaskedValueInput (web props, closure-free)

/// The component's props — the native peer of `MaskedValueProps`, minus the rendering closures (the
/// audit + telemetry side effects are held by the state-holder so the value stays `Equatable`). A value
/// type so the view, the state-holder, and the pure projection agree on one shape, and so a SwiftUI
/// `.onChange` can detect a prop change cheaply when a reused control rebinds (e.g. a new `value`).
public struct MaskedValueInput: Sendable, Equatable {
    /// The raw value to mask (web `value`); `nil` / empty renders the em-dash branch with no toggle.
    public let value: String?
    /// The masking strategy (web `variant`).
    public let variant: MaskVariant
    /// An optional override of the variant's default visible-suffix length (web `showLast`).
    public let showLast: Int?
    /// Whether a copy button renders next to the toggle (web `copyable`, default false).
    public let copyable: Bool
    /// Whether a reveal records an audit event through the injected recorder (web `auditOnReveal`,
    /// default false — the conservative default the web shipped because the audit route is opt-in).
    public let auditOnReveal: Bool
    /// The human-readable description for VoiceOver / tests (web `ariaLabel`, required). Caller-supplied
    /// and already localized, so it is rendered verbatim — never the raw secret.
    public let ariaLabel: String
    /// The auto-hide duration in milliseconds (web `autoHideMs`, default 30 000); `0` disables auto-hide.
    public let autoHideMs: Int

    public init(
        value: String?,
        variant: MaskVariant,
        showLast: Int? = nil,
        copyable: Bool = false,
        auditOnReveal: Bool = false,
        ariaLabel: String,
        autoHideMs: Int = MaskedValueInput.defaultAutoHideMs
    ) {
        self.value = value
        self.variant = variant
        self.showLast = showLast
        self.copyable = copyable
        self.auditOnReveal = auditOnReveal
        self.ariaLabel = ariaLabel
        self.autoHideMs = autoHideMs
    }

    /// The reveal auto-hide default (web `DEFAULT_AUTO_HIDE_MS = 30_000`).
    public static let defaultAutoHideMs = 30000

    /// The raw value coalesced to a non-optional string (web `raw = value ?? ''`).
    public var raw: String {
        value ?? ""
    }

    /// Whether the empty branch renders (web `raw.length === 0`): no content to mask, no toggle.
    public var isEmpty: Bool {
        raw.isEmpty
    }
}

// MARK: - MaskedValueProjection (view-ready)

/// The resolved, view-ready model — everything the SwiftUI body needs as a pure function of the props
/// (no clock, no networking, no derivation in the view). `maskedText` is the web `masked`; `rawText` is
/// the web `raw`; `isEmpty` is the web early-return branch; `revealLabel` / `hideLabel` are the web
/// `t('mask.reveal')` / `t('mask.hide')`; `copyLabel` is `t('mask.copy')`; `accessibilityLabel` is the
/// caller `ariaLabel`. The runtime `revealed` flag (state-holder owned) picks between the masked and raw
/// text + the two toggle labels via the helpers below.
public struct MaskedValueProjection: Sendable, Equatable {
    /// Whether the em-dash empty branch renders (web `raw.length === 0`).
    public let isEmpty: Bool
    /// The variant-masked display string (web `masked`).
    public let maskedText: String
    /// The cleartext display string (web `raw`).
    public let rawText: String
    /// The masking strategy (carried for the audit `variant` payload + tests).
    public let variant: MaskVariant
    /// Whether the copy button renders (web `copyable`).
    public let copyable: Bool
    /// The em-dash shown for the empty branch (web `—`). A typographic symbol, not prose.
    public let emptyGlyph: String
    /// The reveal toggle label (web `t('mask.reveal', 'Reveal value')`).
    public let revealLabel: String
    /// The hide toggle label (web `t('mask.hide', 'Hide value')`).
    public let hideLabel: String
    /// The copy button accessible label (web `t('mask.copy', 'Copy value')`).
    public let copyLabel: String
    /// The semantic VoiceOver description (web `ariaLabel`) — never the raw secret.
    public let accessibilityLabel: String

    public init(
        isEmpty: Bool,
        maskedText: String,
        rawText: String,
        variant: MaskVariant,
        copyable: Bool,
        emptyGlyph: String,
        revealLabel: String,
        hideLabel: String,
        copyLabel: String,
        accessibilityLabel: String
    ) {
        self.isEmpty = isEmpty
        self.maskedText = maskedText
        self.rawText = rawText
        self.variant = variant
        self.copyable = copyable
        self.emptyGlyph = emptyGlyph
        self.revealLabel = revealLabel
        self.hideLabel = hideLabel
        self.copyLabel = copyLabel
        self.accessibilityLabel = accessibilityLabel
    }

    /// The text shown in the code slot — the web `{revealed ? raw : masked}`.
    public func displayText(revealed: Bool) -> String {
        revealed ? rawText : maskedText
    }

    /// The toggle's label for the current state — the web `revealed ? t('mask.hide') : t('mask.reveal')`.
    public func toggleLabel(revealed: Bool) -> String {
        revealed ? hideLabel : revealLabel
    }
}

// MARK: - MaskedValueProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: it takes the props a host already holds (no
/// fetch, no clock) plus the injected P1/S10 label resolvers and derives the rendered model. Unit tested
/// across every variant's masking rule, the empty branch, and the resolved labels.
public enum MaskedValueProjector {
    /// The em-dash rendered for the empty branch (web `—`, U+2014).
    public static let emDash = "\u{2014}"

    /// Resolves the whole model. `revealLabel` / `hideLabel` / `copyLabel` are the localized toggle + copy
    /// labels (web `t('mask.reveal')` / `t('mask.hide')` / `t('mask.copy')`), injected so the projector
    /// stays Foundation-only + facade-agnostic for tests.
    public static func resolve(
        _ input: MaskedValueInput,
        revealLabel: String,
        hideLabel: String,
        copyLabel: String
    ) -> MaskedValueProjection {
        let raw = input.raw
        return MaskedValueProjection(
            isEmpty: raw.isEmpty,
            maskedText: MaskedValueMasker.mask(raw, variant: input.variant, showLast: input.showLast),
            rawText: raw,
            variant: input.variant,
            copyable: input.copyable,
            emptyGlyph: emDash,
            revealLabel: revealLabel,
            hideLabel: hideLabel,
            copyLabel: copyLabel,
            accessibilityLabel: input.ariaLabel
        )
    }
}
