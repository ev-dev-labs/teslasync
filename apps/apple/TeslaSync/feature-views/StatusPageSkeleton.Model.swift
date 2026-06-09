//
//  StatusPageSkeleton.Model.swift
//  TeslaSync — P4 feature view · StatusPageSkeleton (Apple)
//
//  The pure, host-free spec for the System-Status loading skeleton
//  (web `features/system/components/status/StatusPageSkeleton.tsx`). The web
//  source is a layout-shaped loading state shown during the initial fetch of the
//  System Status page; it mirrors the real page's vertical rhythm
//  (hero → chip bar → health rows → action items → resources → 4 accordion rows)
//  so there is no layout shift once data loads. It owns no data and renders no
//  conditional branch and makes no t() call, so the "adapter" here is the static
//  projection of the source's child tree, which the XCTest suite asserts
//  block-for-block without a rendering host.
//
//  This file also holds the diagnostics identity (P1/S11 `view.opened`) and the
//  P1/S10 i18n facade for the single VoiceOver busy-state label the Apple HIG
//  requires (the web root `aria-label`).
//
//  Spacing convention (matches the LoadingSkeleton predecessor): a block's
//  leading `mt-{n}` / `space-y-{n}` gap is carried as exact web points on
//  ``StatusSkeletonBlock/topInset`` (Tailwind 1 unit = 4 pt); region and row
//  gaps are resolved to platform spacing tokens by the view, so the surface
//  follows native rhythm rather than ported pixels.
//

import Foundation

// MARK: - Surface identity (P1/S11 view.opened)

/// Stable, non-identifying identity for the `StatusPageSkeleton` feature view.
/// The slug is the value emitted with the P1/S11 `view.opened` diagnostics
/// contract and is referenced by both the view and its tests so the two never
/// drift.
public enum StatusPageSkeletonSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "StatusPageSkeleton"

    /// Reports the surface becoming visible. This is the exact code path the
    /// view runs from its `.task`, factored out so it is unit-testable without a
    /// rendering host.
    public static func reportOpen(to telemetry: any StatusPageSkeletonTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Skeleton block primitives (web <Skeleton/>)

/// The width policy of a shimmer block, mapped from the web `Skeleton` `width`
/// prop: a fixed CSS length (`"56px"`), a percentage of the container (`"60%"`),
/// or the `Skeleton` default `"100%"` (web `w-full`).
public enum StatusSkeletonWidth: Equatable, Sendable {
    /// A fixed width in points (web `"{n}px"`).
    case points(CGFloat)
    /// A fraction of the container width in `0...1` (web `"{p}%"`).
    case fraction(CGFloat)
    /// Stretches to fill the container (web `w-full` / the `Skeleton` default).
    case fill
}

/// The corner treatment of a shimmer block, mapped from the web `Skeleton`
/// `rounded` prop (and the `rounded-full` chip class): the default small radius,
/// or a full pill.
public enum StatusSkeletonShape: Equatable, Sendable {
    /// The default small corner radius (web default `rounded`).
    case rounded
    /// A full pill, used for the avatar and chip blocks (web `rounded` prop /
    /// `rounded-full` → `rounded-full`).
    case pill
}

/// A single shimmer block — the native projection of one web `<Skeleton/>`.
/// `topInset` reproduces the web `mt-{n}` (or a `space-y-{n}` gap) that separates
/// a block from the one stacked above it, so sub-views can stack with zero
/// spacing and let the data carry the rhythm.
public struct StatusSkeletonBlock: Equatable, Sendable {
    /// The width policy (web `width` prop).
    public let width: StatusSkeletonWidth
    /// Fixed height in points (web `height` prop).
    public let height: CGFloat
    /// Leading top inset in points (web `mt-{n}` / `space-y-{n}`); `0` when none.
    public let topInset: CGFloat
    /// Corner treatment (web `rounded` prop / `rounded-full`).
    public let shape: StatusSkeletonShape

    public init(
        width: StatusSkeletonWidth,
        height: CGFloat,
        topInset: CGFloat = 0,
        shape: StatusSkeletonShape = .rounded
    ) {
        self.width = width
        self.height = height
        self.topInset = topInset
        self.shape = shape
    }

    /// Whether the block stretches to fill its container (web `w-full`).
    public var fillsWidth: Bool {
        width == .fill
    }
}

public extension StatusSkeletonBlock {
    /// A fixed-width block (web `"{n}px"`).
    static func fixed(
        _ width: CGFloat,
        height: CGFloat,
        topInset: CGFloat = 0,
        shape: StatusSkeletonShape = .rounded
    ) -> StatusSkeletonBlock {
        StatusSkeletonBlock(width: .points(width), height: height, topInset: topInset, shape: shape)
    }

    /// A percentage-width block (web `"{p}%"`), `fraction` in `0...1`.
    static func fraction(
        _ fraction: CGFloat,
        height: CGFloat,
        topInset: CGFloat = 0,
        shape: StatusSkeletonShape = .rounded
    ) -> StatusSkeletonBlock {
        StatusSkeletonBlock(width: .fraction(fraction), height: height, topInset: topInset, shape: shape)
    }

    /// A full-width block (web `w-full` / the `Skeleton` default).
    static func fill(
        height: CGFloat,
        topInset: CGFloat = 0,
        shape: StatusSkeletonShape = .rounded
    ) -> StatusSkeletonBlock {
        StatusSkeletonBlock(width: .fill, height: height, topInset: topInset, shape: shape)
    }
}

// MARK: - Region specs

/// The page hero — the web `GlassPanel.p-5` with `flex items-start gap-4`: a
/// leading circular avatar block, a flexible title + subtitle column, and a
/// trailing action block.
public struct StatusSkeletonHero: Equatable, Sendable {
    /// The leading 56×56 circular avatar (web `Skeleton 56×56 rounded`).
    public let avatar: StatusSkeletonBlock
    /// The 60%-wide title line (web `Skeleton h-6 w-60%`).
    public let title: StatusSkeletonBlock
    /// The 40%-wide subtitle line (web `Skeleton h-3.5 w-40%`, `space-y-2`).
    public let subtitle: StatusSkeletonBlock
    /// The trailing 120×36 action block (web `Skeleton 120×36`).
    public let action: StatusSkeletonBlock

    public init(
        avatar: StatusSkeletonBlock,
        title: StatusSkeletonBlock,
        subtitle: StatusSkeletonBlock,
        action: StatusSkeletonBlock
    ) {
        self.avatar = avatar
        self.title = title
        self.subtitle = subtitle
        self.action = action
    }
}

/// The horizontal chip bar — the web `flex gap-2 overflow-hidden` of pill chips
/// (`Skeleton 92×32 rounded-full`).
public struct StatusSkeletonChipBar: Equatable, Sendable {
    /// The pill chips, left-to-right.
    public let chips: [StatusSkeletonBlock]

    public init(chips: [StatusSkeletonBlock]) {
        self.chips = chips
    }

    /// The number of chips (web `Array.from({ length: 8 })`).
    public var count: Int {
        chips.count
    }
}

/// A titled stack of uniform full-width rows — the web `GlassPanel` holding a
/// heading then `space-y-{n}` of `SkeletonRow` blocks. Reproduces the health,
/// action-items, and resources panels, each with its own heading, row height,
/// row count, and gaps.
public struct StatusSkeletonRowGroup: Equatable, Sendable {
    /// The panel heading block (web `Skeleton h-{n} w-{n}`).
    public let heading: StatusSkeletonBlock
    /// The uniform row height in points (web `SkeletonRow height`).
    public let rowHeight: CGFloat
    /// The number of rows (web `Array.from({ length: n })`).
    public let rowCount: Int
    /// The gap between rows (web `space-y-{n}`).
    public let rowSpacing: CGFloat
    /// The gap between the heading and the first row (web `mb-{n}` /
    /// `space-y-{n}`).
    public let rowsTopInset: CGFloat

    public init(
        heading: StatusSkeletonBlock,
        rowHeight: CGFloat,
        rowCount: Int,
        rowSpacing: CGFloat,
        rowsTopInset: CGFloat
    ) {
        self.heading = heading
        self.rowHeight = rowHeight
        self.rowCount = rowCount
        self.rowSpacing = rowSpacing
        self.rowsTopInset = rowsTopInset
    }
}

/// One collapsed accordion row — the web `GlassPanel.p-5` with
/// `flex items-center gap-3`: a leading icon block, a flexible title + subtitle
/// column, and a trailing chevron/badge block.
public struct StatusSkeletonAccordionRow: Equatable, Sendable {
    /// The leading 20×20 icon block (web `Skeleton 20×20`).
    public let icon: StatusSkeletonBlock
    /// The 40%-wide title line (web `Skeleton h-4 w-40%`).
    public let title: StatusSkeletonBlock
    /// The 60%-wide subtitle line (web `Skeleton h-3 w-60% mt-1`).
    public let subtitle: StatusSkeletonBlock
    /// The trailing 60×24 accessory block (web `Skeleton 60×24`).
    public let trailing: StatusSkeletonBlock

    public init(
        icon: StatusSkeletonBlock,
        title: StatusSkeletonBlock,
        subtitle: StatusSkeletonBlock,
        trailing: StatusSkeletonBlock
    ) {
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing
    }
}

/// One top-level stacked child of the web root `space-y-5`. Modelling children as
/// an ordered enum lets a single rendering engine reproduce the source while the
/// tests assert each child's spec block-for-block.
public enum StatusPageSkeletonRegion: Equatable, Sendable {
    case hero(StatusSkeletonHero)
    case chipBar(StatusSkeletonChipBar)
    case rowGroup(StatusSkeletonRowGroup)
    case accordionRow(StatusSkeletonAccordionRow)
}

public extension StatusPageSkeletonRegion {
    var asHero: StatusSkeletonHero? {
        if case let .hero(value) = self { return value }
        return nil
    }

    var asChipBar: StatusSkeletonChipBar? {
        if case let .chipBar(value) = self { return value }
        return nil
    }

    var asRowGroup: StatusSkeletonRowGroup? {
        if case let .rowGroup(value) = self { return value }
        return nil
    }

    var asAccordionRow: StatusSkeletonAccordionRow? {
        if case let .accordionRow(value) = self { return value }
        return nil
    }
}

// MARK: - Layout projection (the web source's structure, 1:1)

/// The deterministic projection of the web `StatusPageSkeleton`'s structure: the
/// ordered list of root children reproduced block-for-block from the source, the
/// `max-w-3xl` content cap, and the VoiceOver busy-state label the Apple HIG
/// requires. Keeping the structure in a value type lets the XCTest suite assert
/// every dimension and count without a rendering host.
public struct StatusPageSkeletonLayout: Equatable, Sendable {
    public let regions: [StatusPageSkeletonRegion]
    /// The maximum content width in points (web `max-w-3xl` = 48rem = 768 pt),
    /// centred (web `mx-auto`).
    public let maxContentWidth: CGFloat
    public let accessibilityLabelKey: String
    public let accessibilityLabelFallback: String

    public init(
        regions: [StatusPageSkeletonRegion],
        maxContentWidth: CGFloat,
        accessibilityLabelKey: String,
        accessibilityLabelFallback: String
    ) {
        self.regions = regions
        self.maxContentWidth = maxContentWidth
        self.accessibilityLabelKey = accessibilityLabelKey
        self.accessibilityLabelFallback = accessibilityLabelFallback
    }

    /// The number of top-level stacked children (the web root `space-y-5`).
    public var regionCount: Int {
        regions.count
    }
}

public extension StatusPageSkeletonLayout {
    /// The System-Status loading skeleton (web `StatusPageSkeleton.tsx`),
    /// projected 1:1. Nine stacked root children: hero, chip bar, health rows,
    /// action-items rows, resources rows, then four collapsed accordion rows.
    /// Tailwind sizes use the canonical 1 unit = 4 pt scale; `px` values are
    /// carried verbatim.
    static let standard = StatusPageSkeletonLayout(
        regions: [
            .hero(StatusSkeletonHero(
                avatar: .fixed(56, height: 56, shape: .pill),
                title: .fraction(0.6, height: 24),
                subtitle: .fraction(0.4, height: 14, topInset: 8),
                action: .fixed(120, height: 36)
            )),
            .chipBar(StatusSkeletonChipBar(
                chips: Array(
                    repeating: .fixed(92, height: 32, shape: .pill),
                    count: 8
                )
            )),
            .rowGroup(StatusSkeletonRowGroup(
                heading: .fixed(80, height: 18),
                rowHeight: 44,
                rowCount: 6,
                rowSpacing: 4,
                rowsTopInset: 8
            )),
            .rowGroup(StatusSkeletonRowGroup(
                heading: .fixed(180, height: 18),
                rowHeight: 32,
                rowCount: 2,
                rowSpacing: 8,
                rowsTopInset: 8
            )),
            .rowGroup(StatusSkeletonRowGroup(
                heading: .fixed(120, height: 18),
                rowHeight: 28,
                rowCount: 5,
                rowSpacing: 12,
                rowsTopInset: 12
            )),
            .accordionRow(StatusPageSkeletonLayout.accordionRow),
            .accordionRow(StatusPageSkeletonLayout.accordionRow),
            .accordionRow(StatusPageSkeletonLayout.accordionRow),
            .accordionRow(StatusPageSkeletonLayout.accordionRow)
        ],
        maxContentWidth: 768,
        accessibilityLabelKey: StatusPageSkeletonStringsKey.accessibilityLabel,
        accessibilityLabelFallback: StatusPageSkeletonStringsKey.accessibilityLabelFallback
    )

    /// The shared spec for one collapsed accordion row (web map of length 4).
    private static let accordionRow = StatusSkeletonAccordionRow(
        icon: .fixed(20, height: 20),
        title: .fraction(0.4, height: 16),
        subtitle: .fraction(0.6, height: 12, topInset: 4),
        trailing: .fixed(60, height: 24)
    )
}

// MARK: - Localization facade (P1/S10) — web t(key, default)

/// Resolves this surface's strings by key with an English fallback so the view
/// holds no hardcoded literals. The web source is an anonymous skeleton (no
/// `t()` calls); its only human-facing string is the root `aria-label`, mapped
/// here to the native VoiceOver busy-state label the Apple HIG requires. Keys
/// live in the "StatusPageSkeleton" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum StatusPageSkeletonStrings {
    public static let table = "StatusPageSkeleton"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

/// The localization keys this surface resolves, kept in one place so the view,
/// the `.strings` table, and the tests never drift.
public enum StatusPageSkeletonStringsKey {
    /// VoiceOver label announcing the whole skeleton as one busy element
    /// (web root `aria-label="Loading system status"`).
    public static let accessibilityLabel = "status.loading.accessibilityLabel"
    /// English fallback for the busy-state label (also shipped in `.strings`).
    public static let accessibilityLabelFallback = "Loading system status"
}
