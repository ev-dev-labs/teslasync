//
//  HelpTooltip.Adapter.swift
//  TeslaSync — P4 shared surface · 0216 · HelpTooltip (Apple)
//
//  The Foundation-only core for the help "?" tooltip — the SwiftUI parity of
//  `components/ui/HelpTooltip.tsx`. This file owns the surface identity (the diagnostics slug), the i18n
//  facade seam, the caller-facing value types (``HelpTooltipPlacement`` — web `placement`,
//  ``HelpTooltipSize`` — web `size` + its `SIZE_CLASS` glyph dimensions, ``HelpTooltipLearnMore`` — web
//  `learnMore: { url; label? }``), the resolved render model (``HelpTooltipContent``), the control metrics
//  (``HelpTooltipLayout`` — native peers of the web Tailwind sizes), and the pure ``HelpTooltipProjector``
//  that reproduces the component's content-resolution rule (`resolved = i18nKey ? t(i18nKey,{defaultValue})
//  : text ?? ''`; `if (!resolved) return null`) as a deterministic function. No SwiftUI and no `@Observable`,
//  so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<HelpTooltip>` is a pure PRESENTATIONAL primitive — it takes plain props,
//  resolves one string, and composes the shared `<Tooltip>`. There is NO fetch, NO React-Query cache, and NO
//  Promise, so it has NO loading / error / stale / offline branch (nothing to fetch, fail, age, or lose
//  connectivity to). Inventing such chrome would fabricate states the source does not have, so this surface
//  reproduces only the source's REAL branches — the same faithful-parity stance the sibling primitives
//  ContextMenu (0206) and DataTableColumnMenu (0210) took. The real branches are: hidden (no resolved content
//  — the web `return null`), collapsed (content present, the tooltip closed — only the trigger glyph
//  renders), revealed (the tooltip open — the body text), revealed-with-learn-more (the body plus the
//  external link), across the three glyph sizes and the four placements, with the custom-glyph escape hatch
//  (web `children`).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum HelpTooltipSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "HelpTooltip"
}

// MARK: - Localization facade seam (web `t(key, default)` → P1/S10 key)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// closure so the pure core has no dependency on a bundle: the production app passes the P1/S10 facade,
/// while tests pass a deterministic resolver.
public typealias HelpTooltipResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - HelpTooltipPlacement (web `placement`)

/// Where the tooltip appears relative to the trigger — the native peer of the web `placement` prop
/// (`'top' | 'bottom' | 'left' | 'right'`). The horizontal cases use the layout-direction-aware
/// `leading` / `trailing` (the native peer of the web `left` / `right`) so the surface mirrors correctly in
/// right-to-left locales. The view maps each case to a popover arrow edge.
public enum HelpTooltipPlacement: String, Sendable, CaseIterable {
    /// Above the trigger (web `top`, the default).
    case top
    /// Below the trigger (web `bottom`).
    case bottom
    /// Before the trigger on the leading edge (web `left`).
    case leading
    /// After the trigger on the trailing edge (web `right`).
    case trailing

    /// The web default placement (`'top'`).
    public static let webDefault: HelpTooltipPlacement = .top

    /// Maps a web `placement` literal to its native case (`left` → `leading`, `right` → `trailing`), so a
    /// caller porting a web call site can pass the exact prop value.
    public init(webSide: String) {
        switch webSide {
        case "bottom": self = .bottom
        case "left": self = .leading
        case "right": self = .trailing
        default: self = .top
        }
    }
}

// MARK: - HelpTooltipSize (web `size` + `SIZE_CLASS`)

/// The trigger glyph size — the native peer of the web `size` prop and its `SIZE_CLASS` map (`xs` = `h-3 w-3`
/// = 12pt, `sm` = `h-3.5 w-3.5` = 14pt, `md` = `h-4 w-4` = 16pt). ``baseGlyphSide`` is the unscaled point
/// size; the view scales it with Dynamic Type via `@ScaledMetric`.
public enum HelpTooltipSize: String, Sendable, CaseIterable {
    /// 12pt glyph (web `xs` = `h-3 w-3`).
    case xs
    /// 14pt glyph (web `sm` = `h-3.5 w-3.5`, the default).
    case sm
    /// 16pt glyph (web `md` = `h-4 w-4`).
    case md

    /// The web default size (`'sm'`).
    public static let webDefault: HelpTooltipSize = .sm

    /// The unscaled glyph side in points — the native peer of the web `SIZE_CLASS` height/width.
    public var baseGlyphSide: CGFloat {
        switch self {
        case .xs: 12
        case .sm: 14
        case .md: 16
        }
    }
}

// MARK: - HelpTooltipLearnMore (web `learnMore`)

/// The optional "Learn more" affordance — the native peer of the web `learnMore: { url; label? }`. `url` is
/// the destination opened in the browser (web `target="_blank"`); `label` overrides the default "Learn more"
/// copy. ``resolvedURL`` parses `url` once so the view can decide between an interactive link and a
/// non-interactive labelled fallback (a malformed URL never crashes the surface).
public struct HelpTooltipLearnMore: Sendable, Equatable {
    /// The destination opened in a new context (web `learnMore.url`, `target="_blank"`).
    public let url: String
    /// An optional label overriding the default "Learn more" copy (web `learnMore.label`).
    public let label: String?

    public init(url: String, label: String? = nil) {
        self.url = url
        self.label = label
    }

    /// The parsed destination, or `nil` when `url` is not a valid URL — lets the view fall back to a
    /// non-interactive label rather than crash on a malformed string.
    public var resolvedURL: URL? {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return URL(string: trimmed)
    }
}

// MARK: - HelpTooltipContent (web resolved tooltip body)

/// The resolved tooltip body — the native peer of what the web renders inside `<Tooltip content>`: the
/// resolved explanatory `text` (web `resolved`, always non-empty here — an empty resolution yields `nil`
/// content, the web `return null`) and the optional `learnMore` affordance. A closure-free
/// `Sendable`/`Equatable` value type so the view and the projection agree on one shape.
public struct HelpTooltipContent: Sendable, Equatable {
    /// The resolved explanatory copy (web `resolved`). Guaranteed non-empty.
    public let text: String
    /// The optional "Learn more" affordance (web `learnMore`).
    public let learnMore: HelpTooltipLearnMore?

    public init(text: String, learnMore: HelpTooltipLearnMore? = nil) {
        self.text = text
        self.learnMore = learnMore
    }
}

// MARK: - HelpTooltipLayout (web Tailwind metrics)

/// The surface's precise metrics — the native peers of the web Tailwind utilities on
/// `components/ui/HelpTooltip.tsx` (body `text-2xs leading-snug`, the learn-more row `mt-1 gap-1` with the
/// `ExternalLink` glyph `h-3 w-3` = 12pt). The popover inset + body width are native HIG choices for a
/// comfortable multiline tooltip (web `multiline`), kept as named constants rather than scattered magic
/// numbers, mirroring the sibling surfaces' `…Layout` enums.
public enum HelpTooltipLayout {
    /// Inset around the popover body content.
    public static let popoverPadding: CGFloat = 12
    /// Comfortable maximum width for the multiline body (web `multiline` tooltip).
    public static let bodyMaxWidth: CGFloat = 260
    /// Vertical gap between the body text and the learn-more row (web `mt-1`).
    public static let learnMoreTopSpacing: CGFloat = 4
    /// Gap between the learn-more label and its external glyph (web `gap-1`).
    public static let learnMoreGap: CGFloat = 4
    /// The external-link glyph side (web `ExternalLink` `h-3 w-3`).
    public static let externalGlyphSide: CGFloat = 12
    /// The trigger's tappable padding around the glyph (HIG hit target; web `rounded-full` button).
    public static let triggerPadding: CGFloat = 2
}

// MARK: - HelpTooltipProjector (web content resolution)

/// The pure projection rule for the surface — the surface's data adapter in the "inputs → projection" sense
/// the acceptance calls for: it takes the props a caller already holds (no fetch, no clock) and reproduces
/// the component's content resolution as a deterministic function. Unit tested across the i18n-key / plain
/// -text branches, the empty-resolution `nil` (the web `return null`), and the learn-more pass-through.
public enum HelpTooltipProjector {
    /// The resolved tooltip copy, or `nil` when there is nothing to show — the verbatim port of the web
    /// `const resolved = i18nKey ? t(i18nKey, { defaultValue: defaultValue ?? '' }) : (text ?? ''); if
    /// (!resolved) return null`. When `i18nKey` is supplied the `text` prop is ignored (exactly as the web
    /// ternary does); an empty resolution yields `nil`. The string is not trimmed — the web truthiness check
    /// only rejects the empty string.
    public static func resolve(
        text: String?,
        i18nKey: String?,
        defaultValue: String?,
        using resolve: HelpTooltipResolve
    ) -> String? {
        let resolved: String = if let i18nKey {
            resolve(i18nKey, defaultValue ?? "")
        } else {
            text ?? ""
        }
        return resolved.isEmpty ? nil : resolved
    }

    /// The resolved render model, or `nil` when the surface renders nothing — combines ``resolve(text:i18nKey:
    /// defaultValue:using:)`` with the optional `learnMore` affordance. `nil` is the native peer of the web
    /// `return null` (the help glyph simply does not appear when there is nothing to explain).
    public static func content(
        text: String?,
        i18nKey: String?,
        defaultValue: String?,
        learnMore: HelpTooltipLearnMore?,
        using resolve: HelpTooltipResolve
    ) -> HelpTooltipContent? {
        guard let resolved = self.resolve(
            text: text,
            i18nKey: i18nKey,
            defaultValue: defaultValue,
            using: resolve
        ) else {
            return nil
        }
        return HelpTooltipContent(text: resolved, learnMore: learnMore)
    }
}
