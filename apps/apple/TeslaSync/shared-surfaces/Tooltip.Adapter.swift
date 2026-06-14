//
//  Tooltip.Adapter.swift
//  TeslaSync — P4 shared surface · 0231 · Tooltip (Apple)
//
//  The Foundation-only core for the hover / focus tooltip — the SwiftUI parity of
//  `components/ui/Tooltip.tsx`. This file owns the surface identity (the diagnostics slug, P1/S11), the i18n
//  facade seam (P1/S10), the caller-facing value types (``TooltipSide`` — the web `side` prop and its
//  `sideClasses` map; ``TooltipWrap`` — the web `multiline` prop and its `whitespace-nowrap` /
//  `max-w-[260px]` split), the precise control metrics (``TooltipMetrics`` — the native peers of the web
//  Tailwind sizes), and the pure ``TooltipProjector`` that reproduces the component's content rules as
//  deterministic functions. No SwiftUI and no `@Observable`, so every rule is unit-testable in isolation
//  (Tooltip.AdapterTests.swift).
//
//  Faithful-parity note: the web `<Tooltip>` is a PURE PRESENTATIONAL primitive. Its only hook is `useId`
//  (a stable id for `role="tooltip"` + `aria-describedby`); it performs NO fetch, holds NO React-Query
//  cache, and awaits NO Promise — so it has NO loading / error / stale / offline branch (there is nothing to
//  fetch, fail, age, or lose connectivity to). Inventing such chrome would fabricate states the source does
//  not have, so this surface reproduces only the source's REAL branches — the same faithful-parity stance the
//  sibling primitive HelpTooltip (0216) documents. The real branches are: hidden (opacity-0 scale-95) vs
//  revealed (opacity-100 scale-100), the four placements (web `sideClasses`), single-line vs multiline (web
//  `multiline`), the inverted high-contrast surface, and the reduce-motion path — across string and rich
//  (web `ReactNode`) content. The data-lifecycle states (loading / empty-as-spinner / error / stale /
//  offline) belong to the embedding FEATURE surface that supplies the tooltip's content, not to this
//  primitive. The one lifecycle peer this surface does own is "empty": an empty / whitespace content resolves
//  to NO floating box (the P4 "never a blank box" rule) rather than an empty inverted card.
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum TooltipSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Tooltip"
}

// MARK: - Localization facade seam (web `t(key, default)` → P1/S10 key)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// closure so the pure core has no dependency on a bundle: the production app passes the P1/S10 facade, while
/// tests pass a deterministic resolver. The web `<Tooltip>` itself extracts no `t()` keys (its body is
/// caller-supplied); the one surface-owned string is the localized VoiceOver role for the floating bubble
/// (the native peer of the web `role="tooltip"`, which the platform does not announce for a custom view).
public typealias TooltipResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - TooltipSide (web `side` + `sideClasses`)

/// Where the tooltip appears relative to its trigger — the native peer of the web `side` prop
/// (`'top' | 'bottom' | 'left' | 'right'`, default `'top'`). The horizontal cases use the
/// layout-direction-aware `leading` / `trailing` (the native peers of the web `left` / `right`) so the
/// surface mirrors correctly in right-to-left locales. The view maps each case to an overlay alignment and a
/// scale anchor (Tooltip.Views.swift).
public enum TooltipSide: String, Sendable, CaseIterable {
    /// Above the trigger, horizontally centered (web `top`, the default — `bottom-full left-1/2`).
    case top
    /// Below the trigger, horizontally centered (web `bottom` — `top-full left-1/2`).
    case bottom
    /// Before the trigger on the leading edge, vertically centered (web `left` — `right-full top-1/2`).
    case leading
    /// After the trigger on the trailing edge, vertically centered (web `right` — `left-full top-1/2`).
    case trailing

    /// The web default placement (`'top'`).
    public static let webDefault: TooltipSide = .top

    /// Maps a web `side` literal to its native case (`left` → `leading`, `right` → `trailing`), so a caller
    /// porting a web call site can pass the exact prop value; unknown strings fall back to the web default.
    public init(webSide: String) {
        switch webSide {
        case "bottom": self = .bottom
        case "left": self = .leading
        case "right": self = .trailing
        default: self = .top
        }
    }

    /// The web `side` literal for this case (`leading` → `left`, `trailing` → `right`) — the inverse of
    /// ``init(webSide:)``, so a value can round-trip back to the web prop string.
    public var webSide: String {
        switch self {
        case .top: "top"
        case .bottom: "bottom"
        case .leading: "left"
        case .trailing: "right"
        }
    }

    /// Whether the tooltip sits beside the trigger (leading / trailing) rather than above / below — the web
    /// `left` / `right` axis, which centers the bubble vertically instead of horizontally.
    public var isHorizontal: Bool {
        self == .leading || self == .trailing
    }
}

// MARK: - TooltipWrap (web `multiline`)

/// How the tooltip body lays out — the native peer of the web `multiline` prop. Single-line keeps the body on
/// one line (web `whitespace-nowrap`); multiline lets it wrap within a comfortable maximum width (web
/// `whitespace-normal max-w-[260px]`, used by `HelpTooltip` for long bodies).
public enum TooltipWrap: String, Sendable, CaseIterable {
    /// One line, sized to its content (web `whitespace-nowrap`, the default).
    case singleLine
    /// Wraps within ``TooltipMetrics/multilineMaxWidth`` (web `whitespace-normal max-w-[260px]`).
    case multiline

    /// The web default (`multiline` absent → `whitespace-nowrap`).
    public static let webDefault: TooltipWrap = .singleLine

    /// Maps the web boolean `multiline` prop to the native case.
    public init(multiline: Bool) {
        self = multiline ? .multiline : .singleLine
    }

    /// Whether the body wraps onto multiple lines (web `multiline === true`).
    public var isMultiline: Bool {
        self == .multiline
    }
}

// MARK: - TooltipMetrics (web Tailwind sizes)

/// The surface's precise metrics — the native peers of the web Tailwind utilities on
/// `components/ui/Tooltip.tsx` (`px-2.5 py-1.5`, `rounded-lg`, the `mb-2 / mt-2 / mr-2 / ml-2` gap, the
/// `max-w-[260px]` multiline cap, the `scale-95` hidden scale). Token-aligned where an exact token exists
/// (`rounded-lg` = ``TSRadius/sm``, the 8pt gap = ``TSSpacing/sm``); the sub-token paddings are named
/// constants rather than scattered magic numbers, mirroring the sibling surfaces' `…Metrics` / `…Layout`
/// enums.
public enum TooltipMetrics {
    /// Horizontal inset of the bubble body (web `px-2.5` = 10pt).
    public static let horizontalPadding: CGFloat = 10
    /// Vertical inset of the bubble body (web `py-1.5` = 6pt).
    public static let verticalPadding: CGFloat = 6
    /// Bubble corner radius (web `rounded-lg`) — the 8pt design radius.
    public static let cornerRadius: CGFloat = TSRadius.sm
    /// Gap between the bubble and the trigger (web `mb-2 / mt-2 / mr-2 / ml-2`) — the 8pt design spacing.
    public static let gap: CGFloat = TSSpacing.sm
    /// Maximum width of a multiline bubble (web `max-w-[260px]`).
    public static let multilineMaxWidth: CGFloat = 260
    /// The hidden-state scale the bubble grows from (web `scale-95`).
    public static let hiddenScale: CGFloat = 0.95
    /// Drop-shadow blur radius (web `shadow-lg`).
    public static let shadowRadius: CGFloat = 12
    /// Drop-shadow vertical offset (web `shadow-lg`).
    public static let shadowYOffset: CGFloat = 6
    /// Drop-shadow opacity (web `shadow-lg`).
    public static let shadowOpacity: Double = 0.18
    /// Hairline stroke width drawn only under increased contrast (web `forced-colors:border`).
    public static let increasedContrastHairline: CGFloat = 1
}

// MARK: - TooltipProjector (web content + id rules)

/// The pure projection rules for the surface — the surface's data adapter in the "inputs → projection" sense
/// the acceptance calls for: it takes the props a caller already holds (no fetch, no clock) and reproduces the
/// component's content behaviour as deterministic functions. Unit tested across the plain / empty / whitespace
/// branches.
public enum TooltipProjector {
    /// The accessibility description announced for the trigger — the native peer of the web
    /// `aria-describedby` text (screen readers announce the tooltip copy after the trigger's own name).
    /// Surrounding whitespace is trimmed; an empty / whitespace-only body yields `nil` (no description, and —
    /// per ``shouldRenderBubble(content:)`` — no floating box at all).
    public static func accessibilityDescription(_ content: String) -> String? {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Whether a bubble should render for this content. The web always renders the `role="tooltip"` span, but
    /// the native surface never shows a blank inverted card (the P4 "empty → never a blank box" rule): an
    /// empty / whitespace-only body renders no bubble (and reports no `view.opened`).
    public static func shouldRenderBubble(content: String) -> Bool {
        accessibilityDescription(content) != nil
    }
}
