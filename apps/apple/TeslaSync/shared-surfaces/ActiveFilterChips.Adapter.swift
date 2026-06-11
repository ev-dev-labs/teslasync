//
//  ActiveFilterChips.Adapter.swift
//  TeslaSync — P4 shared surface · 0147 · ActiveFilterChips (Apple)
//
//  The Foundation-only core for the active-filter chip strip — the SwiftUI parity of
//  `components/forms/ActiveFilterChips.tsx`. This file owns the surface identity (the diagnostics slug),
//  the closure-free chip value (``FilterChipDescriptor``), the props value type
//  (``ActiveFilterChipsInput``), the visible/overflow split (``ActiveFilterChipsPartition``), the
//  view-ready ``ActiveFilterChipsProjection``, and the pure ``ActiveFilterChipsProjector`` that maps one
//  into the other. No SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<ActiveFilterChips>` is a PURE presentational component. It takes its
//  data as plain props (`filters`, `onClearAll`, `hideWhenEmpty`, `maxVisible`) and renders — there is no
//  fetch, no React-Query cache, and no Promise — so it has NO loading, error, stale, or offline branch
//  (there is nothing to fetch, fail, age, or lose connectivity to; its only "hook" is `useTranslation`).
//  Inventing such chrome would fabricate states the source does not have, so this surface reproduces only
//  the source's REAL branches — exactly as the sibling presentational primitives InlineCallout (0124),
//  Delta (0081), and MetricCard (0095) did. The real branches are: hidden (empty + `hideWhenEmpty`), the
//  empty group (empty + `hideWhenEmpty == false`), the inline chips, the "+N more" overflow popover, and
//  the optional "Clear all" affordance — plus the polite removal / clear-all announcements.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum ActiveFilterChipsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ActiveFilterChips"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a
/// plain closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias ActiveFilterChipsResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - FilterChipDescriptor (web `FilterChipDescriptor`, closure-free)

/// One chip's data — the native peer of the web `FilterChipDescriptor`, minus the `onRemove` closure
/// (held by the state-holder so this value stays `Equatable`/`Sendable`). `id` matches the web `key`
/// (typically the URL search-param name, so chips are stable + uniquely keyable); `label` is the i18n'd
/// field name shown before the colon (e.g. "Vehicle"); `value` is the user-facing value (e.g. "Model 3").
public struct FilterChipDescriptor: Sendable, Equatable, Identifiable {
    /// Stable identity (web `key`).
    public let id: String
    /// The i18n'd field name shown before the colon (web `label`).
    public let label: String
    /// The user-facing value shown after the colon (web `value`).
    public let value: String

    public init(id: String, label: String, value: String) {
        self.id = id
        self.label = label
        self.value = value
    }
}

// MARK: - ActiveFilterChipsInput (web props, closure-free)

/// The component's props — the native peer of `ActiveFilterChipsProps`, minus the `onRemove`/`onClearAll`
/// closures (held by the state-holder). A value type so the view, the state-holder, and the pure
/// projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply when the
/// page rebinds a fresh filter snapshot.
public struct ActiveFilterChipsInput: Sendable, Equatable {
    /// The ordered active filters (web `filters`).
    public let filters: [FilterChipDescriptor]
    /// Whether the page supplied an `onClearAll` (web `onClearAll != null`).
    public let hasClearAll: Bool
    /// Render nothing when there are no chips and nothing to clear (web `hideWhenEmpty`, default true).
    public let hideWhenEmpty: Bool
    /// Max chips rendered inline before the rest collapse into "+N more" (web `maxVisible`, default 8).
    public let maxVisible: Int

    public init(
        filters: [FilterChipDescriptor],
        hasClearAll: Bool = false,
        hideWhenEmpty: Bool = true,
        maxVisible: Int = 8
    ) {
        self.filters = filters
        self.hasClearAll = hasClearAll
        self.hideWhenEmpty = hideWhenEmpty
        self.maxVisible = maxVisible
    }
}

// MARK: - ActiveFilterChipsPartition (web `{ visible, overflow }`)

/// The inline / collapsed split — the native peer of the web `useMemo` result `{ visible, overflow }`.
/// `overflow` is non-empty only when the chip count exceeds `maxVisible`; one inline slot is reserved for
/// the "+N more" trigger when it is (web `visibleCount = max(0, maxVisible - 1)`).
public struct ActiveFilterChipsPartition: Sendable, Equatable {
    /// Chips rendered inline (web `visible`).
    public let visible: [FilterChipDescriptor]
    /// Chips collapsed behind the "+N more" trigger (web `overflow`).
    public let overflow: [FilterChipDescriptor]

    public init(visible: [FilterChipDescriptor], overflow: [FilterChipDescriptor]) {
        self.visible = visible
        self.overflow = overflow
    }

    /// Whether a "+N more" trigger is rendered (web `overflow.length > 0`).
    public var hasOverflow: Bool {
        !overflow.isEmpty
    }

    /// The count shown in the "+N more" trigger (web `overflow.length`).
    public var overflowCount: Int {
        overflow.count
    }
}

// MARK: - ActiveFilterChipsProjection (view-ready)

/// The resolved, view-ready strip — everything the SwiftUI body needs as a pure function of the props
/// (no derivation in the view). `isHidden` is the web early `return null`; `isEmpty` distinguishes the
/// (shown) empty group from a populated one; `showsClearAll` is the web `onClearAll && filters.length > 0`.
public struct ActiveFilterChipsProjection: Sendable, Equatable {
    /// The whole surface renders nothing (web `hideWhenEmpty && isEmpty` → `return null`).
    public let isHidden: Bool
    /// No chips are present (web `filters.length === 0`).
    public let isEmpty: Bool
    /// The inline / collapsed split.
    public let partition: ActiveFilterChipsPartition
    /// The "Clear all" affordance is rendered (web `onClearAll && filters.length > 0`).
    public let showsClearAll: Bool

    public init(
        isHidden: Bool,
        isEmpty: Bool,
        partition: ActiveFilterChipsPartition,
        showsClearAll: Bool
    ) {
        self.isHidden = isHidden
        self.isEmpty = isEmpty
        self.partition = partition
        self.showsClearAll = showsClearAll
    }

    /// Convenience passthrough — the inline chips.
    public var visible: [FilterChipDescriptor] {
        partition.visible
    }

    /// Convenience passthrough — the collapsed chips.
    public var overflow: [FilterChipDescriptor] {
        partition.overflow
    }
}

// MARK: - ActiveFilterChipsProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "cached → projection" sense the acceptance calls for: it takes the props a page already holds (no
/// fetch, no clock) and derives the rendered strip, the visible/overflow split, the interpolated copy
/// (web i18next `{{count}}` / `{{label}}`), and the padded a11y announcements. Unit tested across the
/// partition boundaries, the hide / empty / clear-all flags, the interpolation, and the rotating padding.
public enum ActiveFilterChipsProjector {
    /// Splits the filters into inline + collapsed — the verbatim port of the web `useMemo`:
    /// `maxVisible <= 0` collapses everything; `count <= maxVisible` keeps everything inline; otherwise
    /// one inline slot is reserved for the "+N more" trigger (`visibleCount = max(0, maxVisible - 1)`).
    public static func partition(
        filters: [FilterChipDescriptor],
        maxVisible: Int
    ) -> ActiveFilterChipsPartition {
        if maxVisible <= 0 {
            return ActiveFilterChipsPartition(visible: [], overflow: filters)
        }
        if filters.count <= maxVisible {
            return ActiveFilterChipsPartition(visible: filters, overflow: [])
        }
        let visibleCount = max(0, maxVisible - 1)
        return ActiveFilterChipsPartition(
            visible: Array(filters.prefix(visibleCount)),
            overflow: Array(filters.suffix(from: visibleCount))
        )
    }

    /// Resolves the whole strip from the props — the native peer of the web component's render decision.
    public static func resolve(_ input: ActiveFilterChipsInput) -> ActiveFilterChipsProjection {
        let isEmpty = input.filters.isEmpty
        return ActiveFilterChipsProjection(
            isHidden: input.hideWhenEmpty && isEmpty,
            isEmpty: isEmpty,
            partition: partition(filters: input.filters, maxVisible: input.maxVisible),
            showsClearAll: input.hasClearAll && !isEmpty
        )
    }

    // MARK: Interpolated copy (web i18next `{{token}}`)

    /// Replaces `{{token}}` placeholders in a resolved template with the supplied values — the native
    /// port of i18next interpolation, so the per-surface strings keep the web's `+{{count}} more` /
    /// `Remove filter {{label}}` shapes and stay translator-friendly.
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }

    /// The "+N more" trigger copy (web `t('filters.moreCount', '+{{count}} more', { count })`).
    public static func moreCountLabel(template: String, count: Int) -> String {
        interpolate(template, ["count": String(count)])
    }

    /// One chip's remove-button VoiceOver label (web `t('filters.removeAria', 'Remove filter {{label}}',
    /// { label })`).
    public static func removeAccessibilityLabel(template: String, label: String) -> String {
        interpolate(template, ["label": label])
    }

    // MARK: A11y announcements (web live-region text + rotating dedupe padding)

    /// U+200B ZERO WIDTH SPACE — invisible on screen and not spoken, exactly as the web uses it to force
    /// the assistive technology to re-read an identical consecutive announcement.
    public static let zeroWidthSpace = "\u{200B}"

    /// The rotating dedupe suffix — `sequence mod 4` zero-width spaces, the verbatim port of the web
    /// `'\u200B'.repeat(announceCounter % 4)`. The modulo keeps the suffix bounded.
    public static func announcementPadding(sequence: Int) -> String {
        let count = ((sequence % 4) + 4) % 4
        return String(repeating: zeroWidthSpace, count: count)
    }

    /// The polite live-region text announced when one chip is removed — web
    /// `${t('filters.removed')}: ${label}${padding}`.
    public static func removalAnnouncement(removedText: String, label: String, sequence: Int) -> String {
        "\(removedText): \(label)" + announcementPadding(sequence: sequence)
    }

    /// The polite live-region text announced when every chip is cleared — web
    /// `${t('filters.clearedAll')}${padding}`.
    public static func clearedAllAnnouncement(clearedText: String, sequence: Int) -> String {
        clearedText + announcementPadding(sequence: sequence)
    }
}
