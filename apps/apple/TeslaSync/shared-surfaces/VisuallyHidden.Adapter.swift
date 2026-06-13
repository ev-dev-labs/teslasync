//
//  VisuallyHidden.Adapter.swift
//  TeslaSync — P4 shared surface · 0003 · VisuallyHidden (Apple)
//
//  The testable, dependency-light core for the visually-hidden utility — the SwiftUI parity
//  of `components/a11y/VisuallyHidden.tsx`. Everything here is pure (Foundation only): the
//  three render modes the web component exposes (the default `sr-only` span, the `liveRegion`
//  pairing, and the `focusable` skip-link), the element-polymorphism axis (the web `as`
//  prop), the verbatim port of the web `liveProps` derivation (role + aria-live + aria-atomic),
//  one announced live-region message with the rotating dedupe padding its `useAnnouncer` data
//  source applies, and the VoiceOver summary builders. No store, no bundle, no rendered view,
//  so each piece is unit tested in isolation.
//
//  Parity note: the web `VisuallyHidden` renders content that is invisible to sighted users
//  but exposed to assistive technology. `liveRegion` wires `role` + `aria-live` +
//  `aria-atomic` so the content is voiced; `focusable` flips the element visible on keyboard
//  focus (the "Skip to main content" pattern); `as` switches the underlying tag while keeping
//  the hidden semantics. This core reproduces that exact data: the mode axis, the computed
//  semantics, the element kind, and the message identity its announcer feed produces.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a
/// bundle: the production app passes the P1/S10 facade, while tests pass the identity-fallback
/// resolver.
public typealias VisuallyHiddenResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Priority (web `priority` — 'polite' | 'assertive')

/// Live-region urgency — the native mirror of the web `priority` prop. `polite` waits for the
/// assistive technology to finish its current activity (web `role="status" aria-live="polite"`);
/// `assertive` interrupts (web `role="alert" aria-live="assertive"`), reserved for genuine
/// errors and security-sensitive messages.
public enum VisuallyHiddenPriority: String, Sendable, Equatable, CaseIterable, Identifiable {
    case polite
    case assertive

    public var id: String {
        rawValue
    }

    /// The ARIA `role` the web component assigns for this urgency
    /// (`priority === 'assertive' ? 'alert' : 'status'`).
    public var role: String {
        self == .assertive ? "alert" : "status"
    }

    /// The ARIA `aria-live` value — the raw token, matching the web attribute verbatim.
    public var ariaLive: String {
        rawValue
    }

    /// Whether the urgency interrupts the assistive technology. `assertive` maps to the native
    /// `.high` speech priority so it interrupts; `polite` maps to `.default` so it queues.
    public var isInterrupting: Bool {
        self == .assertive
    }
}

// MARK: - Element (web `as` polymorphism)

/// The underlying element the web component renders — the native mirror of the polymorphic
/// `as` prop. Defaults to `span` (inline, no layout side-effects). The visually-hidden
/// semantics are identical across every kind; only the tag changes.
public enum VisuallyHiddenElement: String, Sendable, Equatable, CaseIterable, Identifiable {
    case span
    case label
    case anchor
    case div

    public var id: String {
        rawValue
    }

    /// The HTML tag the web component would render for this kind (`anchor` → `a`).
    public var tag: String {
        switch self {
        case .span: "span"
        case .label: "label"
        case .anchor: "a"
        case .div: "div"
        }
    }
}

// MARK: - Mode (the three render modes the web component exposes)

/// The render mode of one `VisuallyHidden` element — the native union of the web component's
/// `liveRegion` / `focusable` flags. `hidden` is the bare `sr-only` default; `liveRegion`
/// pairs the hidden styling with the announced-region semantics; `focusable` becomes visible
/// on keyboard focus (the skip-link pattern).
public enum VisuallyHiddenMode: Sendable, Equatable {
    case hidden
    case liveRegion(VisuallyHiddenPriority)
    case focusable

    /// A stable token for previews/diagnostics and the i18n key suffix.
    public var slug: String {
        switch self {
        case .hidden: "hidden"
        case let .liveRegion(priority): "live-\(priority.rawValue)"
        case .focusable: "focusable"
        }
    }
}

// MARK: - Semantics (verbatim port of the web `liveProps` + focusable base)

/// The resolved accessibility semantics for a mode — the native port of the web component's
/// computed attributes. `liveRegion` yields the `role` / `ariaLive` / `ariaAtomic` triplet
/// (web `liveProps`); `focusable` sets `focusReveals`; every mode keeps `screenReaderOnly`
/// (the `sr-only` base class). Pure + `Equatable` so the derivation is asserted exactly.
public struct VisuallyHiddenSemantics: Sendable, Equatable {
    public let role: String?
    public let ariaLive: String?
    public let ariaAtomic: String?
    public let focusReveals: Bool
    public let screenReaderOnly: Bool

    public init(
        role: String?,
        ariaLive: String?,
        ariaAtomic: String?,
        focusReveals: Bool,
        screenReaderOnly: Bool
    ) {
        self.role = role
        self.ariaLive = ariaLive
        self.ariaAtomic = ariaAtomic
        self.focusReveals = focusReveals
        self.screenReaderOnly = screenReaderOnly
    }

    /// `true` when the mode wires a live region (web `liveRegion` branch) — drives the
    /// region-card chrome.
    public var isLiveRegion: Bool {
        role != nil
    }

    /// The verbatim port of the web derivation:
    /// `liveRegion ? { role: priority==='assertive'?'alert':'status', 'aria-live': priority,
    /// 'aria-atomic': 'true' } : undefined`, plus `focusable && FOCUSABLE_BASE`, over the
    /// always-on `sr-only` base.
    public static func resolve(for mode: VisuallyHiddenMode) -> VisuallyHiddenSemantics {
        switch mode {
        case .hidden:
            VisuallyHiddenSemantics(
                role: nil,
                ariaLive: nil,
                ariaAtomic: nil,
                focusReveals: false,
                screenReaderOnly: true
            )
        case let .liveRegion(priority):
            VisuallyHiddenSemantics(
                role: priority.role,
                ariaLive: priority.ariaLive,
                ariaAtomic: "true",
                focusReveals: false,
                screenReaderOnly: true
            )
        case .focusable:
            VisuallyHiddenSemantics(
                role: nil,
                ariaLive: nil,
                ariaAtomic: nil,
                focusReveals: true,
                screenReaderOnly: true
            )
        }
    }
}

// MARK: - Focusable base (web `focus:not-sr-only focus-visible:not-sr-only`)

/// Captures the web `FOCUSABLE_BASE` contract so the parity is documented and testable: a
/// `focusable` element drops its visually-hidden styling while focused (web
/// `focus:not-sr-only`), so keyboard users can see the skip-link they have tabbed onto. The
/// native surface honours this with a real focus-revealed control.
public enum VisuallyHiddenFocusable {
    /// The web class pair that toggles `sr-only` off on focus — kept verbatim as the parity
    /// anchor the audit pins against.
    public static let webBaseClass = "focus:not-sr-only focus-visible:not-sr-only"
}

// MARK: - Message (one announced live-region value from `useAnnouncer`)

/// One announced message routed into a live region — the native mirror of a value the web
/// `useAnnouncer` feed writes into a `<VisuallyHidden liveRegion>`. `id` is the monotonic
/// sequence; `text` is the clean message shown in the inspector; `announcementText` is the
/// padded form posted to the assistive technology (the rotating zero-width-space suffix that
/// forces re-announcement of identical consecutive messages); `priority` selects the region;
/// `timestamp` orders the recent history.
public struct VisuallyHiddenMessage: Sendable, Equatable, Identifiable {
    public let id: Int
    public let text: String
    public let announcementText: String
    public let priority: VisuallyHiddenPriority
    public let timestamp: Date

    public init(
        id: Int,
        text: String,
        announcementText: String,
        priority: VisuallyHiddenPriority,
        timestamp: Date
    ) {
        self.id = id
        self.text = text
        self.announcementText = announcementText
        self.priority = priority
        self.timestamp = timestamp
    }
}

// MARK: - Dedupe padding (the `useAnnouncer` rotating zero-width suffix)

/// Reproduces the announcer feed's duplicate-dedupe mechanism: each call appends a rotating
/// run of zero-width spaces (`'\u200B'.repeat(counter % 4)`) so the region text is a fresh
/// string and the assistive technology re-reads identical consecutive messages. Pure +
/// deterministic so the rotation is asserted entry-for-entry.
public enum VisuallyHiddenPadding {
    /// U+200B ZERO WIDTH SPACE — invisible on screen and not spoken.
    public static let zeroWidthSpace = "\u{200B}"

    /// The suffix for a given sequence number — `sequence mod 4` zero-width spaces, kept
    /// bounded so the message length never grows unbounded.
    public static func suffix(for sequence: Int) -> String {
        let count = ((sequence % 4) + 4) % 4
        return String(repeating: zeroWidthSpace, count: count)
    }

    /// The padded announcement string — `message` with the rotating zero-width suffix appended.
    public static func padded(_ message: String, sequence: Int) -> String {
        message + suffix(for: sequence)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content
/// is asserted without rendering the view. Each mode card reads its name then its semantics;
/// each live region reads its name then its current message.
public enum VisuallyHiddenAccessibility {
    /// One mode card's label: "{modeName}: {summary}", so VoiceOver names the mode then reads
    /// what it does.
    public static func modeLabel(modeName: String, summary: String) -> String {
        "\(modeName): \(summary)"
    }

    /// One live region's label: "{regionName}: {message}", or "{regionName}: {emptyWord}" when
    /// the region has not been written to yet — so VoiceOver never lands on an unlabelled
    /// element.
    public static func regionLabel(regionName: String, message: String, emptyWord: String) -> String {
        let body = message.isEmpty ? emptyWord : message
        return "\(regionName): \(body)"
    }

    /// One history row's label: "{priorityWord}: {message}", so the row reads as a sentence
    /// naming its urgency then its content.
    public static func historyLabel(priorityWord: String, message: String) -> String {
        "\(priorityWord): \(message)"
    }
}
