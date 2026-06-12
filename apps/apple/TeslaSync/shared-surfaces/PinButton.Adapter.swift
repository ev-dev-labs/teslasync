//
//  PinButton.Adapter.swift
//  TeslaSync — P4 shared surface · 0222 · PinButton (Apple)
//
//  The Foundation-only core for the shared pin affordance — the SwiftUI parity of
//  `components/ui/PinButton.tsx`. This file owns the surface identity (the diagnostics slug), the
//  localisation seam, the pinned-domain value (``PinnedItemKind``, web `PinnedItemType` — wire-stable),
//  the size token (``PinButtonSize``, web `'sm' | 'md'`), the load / freshness axes the production store
//  projects from the `/pinned` `Resource<T>`, the props value type (``PinButtonInput``), the resolved
//  view-ready ``PinButtonProjection`` (icon + tone + tooltip + label + busy/awaiting + status badge), and
//  the pure ``PinButtonProjector`` that maps the bound pin snapshot into that projection. No SwiftUI and
//  no `@Observable`, so every rule is unit-testable in isolation.
//
//  Parity note: the web `<PinButton>` is a tiny data-bound toggle. It reads the unified pin query
//  (`usePinned(itemType, context)`, defaulted to `[]`) to derive `isPinned = pinned.some(p =>
//  String(p.item_id) === idStr)`, and writes through the toggle mutation (`useTogglePin(itemType)`),
//  disabling itself while `toggle.isPending`. Because the web destructures only `data: pinned = []`, it
//  swallows the query's loading / error into the unpinned default and never renders a skeleton, a
//  QueryError panel, or an empty placeholder — the button ALWAYS renders. The native surface keeps that
//  exact contract (the button is never hidden, `isPinned` follows the best-available — cached during a
//  refresh — set, unknown ⇒ not pinned) AND, per the P4 leaf states contract, surfaces the freshness the
//  web swallows as a small, gated status badge (offline → error → stale precedence) layered OVER the
//  unconditionally-rendered button, exactly as the sibling data-bound surface CookieConsentBanner (0115)
//  layers its freshness chip over the cached value. The mutation's in-flight is the web `toggle.isPending`
//  → disabled; a cold first load (no cached set yet) shows a button-sized progress spinner in place of the
//  glyph rather than a blank box, per the HIG.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum PinButtonSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "PinButton"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a
/// plain closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias PinButtonResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - PinnedItemKind (web `PinnedItemType`)

/// The pin domain bucket — the native peer of the web `PinnedItemType` union
/// (`vehicle | widget | alert_rule | location | geofence | automation | dashboard | command`). The raw
/// value is the wire token, so the store seam round-trips identically to the `/pinned?type=…` query and
/// the toggle mutation's `item_type` body field. Drives both the API call and the cache key, exactly as
/// the web hook's `pinnedKeys.list(type, context)` does.
public enum PinnedItemKind: String, Sendable, Equatable, CaseIterable {
    case vehicle
    case widget
    case alertRule = "alert_rule"
    case location
    case geofence
    case automation
    case dashboard
    case command

    /// The wire token sent to / received from `/pinned` (identical to the web `PinnedItemType` string).
    public var wireValue: String {
        rawValue
    }
}

// MARK: - PinButtonSize (web `'sm' | 'md'`)

/// The control size — the native peer of the web `size?: 'sm' | 'md'` prop. `small` is the compact
/// list / table-cell affordance (web `h-7 w-7`, 14pt glyph, 12pt label); `medium` is the card-header
/// affordance (web `h-8 w-8`, 16pt glyph, 14pt label). Defaults to `small`, matching the web default.
public enum PinButtonSize: String, Sendable, Equatable, CaseIterable {
    case small
    case medium

    /// The square control side in points (web `h-7 w-7` = 28 / `h-8 w-8` = 32).
    public var controlSide: CGFloat {
        switch self {
        case .small: 28
        case .medium: 32
        }
    }

    /// The glyph point size (web `h-3.5 w-3.5` = 14 / `h-4 w-4` = 16).
    public var glyphPointSize: CGFloat {
        switch self {
        case .small: 14
        case .medium: 16
        }
    }

    /// The label point size when `showLabel` is set (web `text-xs` = 12 / `text-sm` = 14).
    public var labelPointSize: CGFloat {
        switch self {
        case .small: 12
        case .medium: 14
        }
    }
}

// MARK: - Load / freshness axes (the P4 states contract)

/// The load status of the pin query, mirroring the shared `LoadableState` the production store projects
/// from the `/pinned` `Resource<T>`. The web swallows this into the unpinned default; the native surface
/// keeps the button rendered and only surfaces a failure through the gated status badge.
public enum PinLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// The freshness of the cached pin set (the P4 states axis the web `usePinned` query swallows).
/// `stale` triggers one guarded auto-refresh + a refreshing badge; `offline` shows an offline badge; in
/// both cases the cached pinned set stays applied beneath the badge (cached value never hidden).
public enum PinFreshness: String, Sendable, Equatable, CaseIterable {
    case fresh
    case stale
    case offline
}

// MARK: - PinButtonInput (web props, store-free)

/// The component's props — the native peer of `PinButtonProps`, minus the pin store (held by the
/// state-holder). A value type so the view, the state-holder, and the pure projection agree on one shape
/// and a SwiftUI `.onChange` can detect a prop change cheaply when a reused button rebinds.
public struct PinButtonInput: Sendable, Equatable {
    /// Domain bucket — drives the store binding + the cache key (web `itemType`).
    public let itemType: PinnedItemKind
    /// Stable identifier for the row being pinned, coerced to string (web `String(itemId)`).
    public let itemID: String
    /// Optional sub-surface scope, e.g. a `dashboardId` for widget pins (web `context`).
    public let context: String?
    /// Compact list cell vs card header (web `size`, default `small`).
    public let size: PinButtonSize
    /// Render the "Pin" / "Pinned" text beside the glyph (web `showLabel`, default false).
    public let showLabel: Bool

    public init(
        itemType: PinnedItemKind,
        itemID: String,
        context: String? = nil,
        size: PinButtonSize = .small,
        showLabel: Bool = false
    ) {
        self.itemType = itemType
        self.itemID = itemID
        self.context = context
        self.size = size
        self.showLabel = showLabel
    }
}

// MARK: - PinTone (web amber-pinned vs muted-idle)

/// The glyph tone — the native peer of the web class branch
/// `isPinned ? 'text-amber-300 …' : 'text-[var(--text-muted)] …'`. Mapped to a design token by the view
/// (`pinned` → `Color.TS.statusWarning`, `idle` → `Color.TS.textMuted`); kept token-name-free here so the
/// pure core stays SwiftUI-free.
public enum PinTone: String, Sendable, Equatable, CaseIterable {
    case idle
    case pinned
}

// MARK: - PinPresentation (the resolved glyph + copy for one state)

/// The resolved icon + tone + tooltip + label copy for the current pinned-ness — the native peer of the
/// web `Icon = isPinned ? PinOff : Pin` + `tooltipLabel` + the optional `<span>` label. The lucide →
/// SF Symbol mapping mirrors the web exactly: unpinned shows a plain pushpin (`Pin` → `pin`, "tap to
/// pin"), pinned shows the slashed pin (`PinOff` → `pin.slash.fill`, amber, "tap to unpin"). The copy is
/// carried as (key, fallback) pairs resolved through the P1/S10 facade by the view.
public struct PinPresentation: Sendable, Equatable {
    /// The SF Symbol name for the glyph (web lucide `Pin` / `PinOff`).
    public let symbolName: String
    /// The glyph tone (web amber / muted).
    public let tone: PinTone
    /// The tooltip + accessibility label key (web `pin.unpin` / `pin.pin`).
    public let tooltipKey: String
    /// The tooltip + accessibility label English fallback.
    public let tooltipFallback: String
    /// The inline label key when `showLabel` is set (web `pin.pinned` / `pin.pin`).
    public let labelKey: String
    /// The inline label English fallback.
    public let labelFallback: String

    public init(
        symbolName: String,
        tone: PinTone,
        tooltipKey: String,
        tooltipFallback: String,
        labelKey: String,
        labelFallback: String
    ) {
        self.symbolName = symbolName
        self.tone = tone
        self.tooltipKey = tooltipKey
        self.tooltipFallback = tooltipFallback
        self.labelKey = labelKey
        self.labelFallback = labelFallback
    }

    /// The unpinned presentation — plain pushpin, muted, "Pin" (web `Pin` + `pin.pin`).
    public static let unpinned = PinPresentation(
        symbolName: "pin",
        tone: .idle,
        tooltipKey: "pin.pin",
        tooltipFallback: "Pin",
        labelKey: "pin.pin",
        labelFallback: "Pin"
    )

    /// The pinned presentation — slashed pin, amber, "Unpin" tooltip + "Pinned" label (web `PinOff` +
    /// `pin.unpin` / `pin.pinned`).
    public static let pinned = PinPresentation(
        symbolName: "pin.slash.fill",
        tone: .pinned,
        tooltipKey: "pin.unpin",
        tooltipFallback: "Unpin",
        labelKey: "pin.pinned",
        labelFallback: "Pinned"
    )
}

// MARK: - PinStatusBadge (the P4 states contract: offline / error / stale)

/// The visual tone of the pin status badge layered over the button when the pin set is degraded.
public enum PinStatusTone: String, Sendable, Equatable, CaseIterable {
    case error
    case offline
    case stale
}

/// The projected status badge shown over the (still-rendered) button when the pin set is failed /
/// offline / stale. `nil` when the set is fresh + loaded — so the happy path is a bare glyph, byte-for-
/// byte the web. The cached pinned-ness stays applied beneath it (cached value never hidden); `showsRetry`
/// drives the VoiceOver "Retry" action that re-requests the set.
public struct PinStatusBadge: Sendable, Equatable {
    public let tone: PinStatusTone
    /// The SF Symbol for the corner indicator.
    public let symbolName: String
    public let messageKey: String
    public let messageFallback: String
    public let showsRetry: Bool

    public init(
        tone: PinStatusTone,
        symbolName: String,
        messageKey: String,
        messageFallback: String,
        showsRetry: Bool
    ) {
        self.tone = tone
        self.symbolName = symbolName
        self.messageKey = messageKey
        self.messageFallback = messageFallback
        self.showsRetry = showsRetry
    }

    /// The localized badge message resolved through the facade.
    public func message(_ localize: PinButtonResolve) -> String {
        localize(messageKey, messageFallback)
    }
}

// MARK: - PinButtonProjection (view-ready)

/// The resolved, view-ready button — everything the SwiftUI body needs as a pure function of the props +
/// the bound pin snapshot (no derivation in the view). `isPinned` drives the glyph + tone + copy;
/// `isBusy` is the web `toggle.isPending` (→ disabled + dimmed); `isAwaitingFirstLoad` is a cold load with
/// no cached set (→ spinner in place of the glyph); `statusBadge` is the gated P4 freshness chrome.
public struct PinButtonProjection: Sendable, Equatable {
    /// Whether the bound item is in the pin set (web `pinned.some(...)`).
    public let isPinned: Bool
    /// The resolved glyph + tone + tooltip + label copy.
    public let presentation: PinPresentation
    /// A pin/unpin mutation is in flight for this item (web `toggle.isPending`) → disabled + dimmed.
    public let isBusy: Bool
    /// The first load has not resolved and there is no cached set → show a progress spinner, disabled.
    public let isAwaitingFirstLoad: Bool
    /// Whether `showLabel` was requested (web `showLabel`).
    public let showsLabel: Bool
    /// The gated freshness / error badge (offline → error → stale), or `nil` when fresh + loaded.
    public let statusBadge: PinStatusBadge?

    public init(
        isPinned: Bool,
        presentation: PinPresentation,
        isBusy: Bool,
        isAwaitingFirstLoad: Bool,
        showsLabel: Bool,
        statusBadge: PinStatusBadge?
    ) {
        self.isPinned = isPinned
        self.presentation = presentation
        self.isBusy = isBusy
        self.isAwaitingFirstLoad = isAwaitingFirstLoad
        self.showsLabel = showsLabel
        self.statusBadge = statusBadge
    }

    /// Whether the button accepts a toggle tap — the web `disabled={toggle.isPending}` plus the native
    /// cold-load guard (you cannot toggle against an unknown set).
    public var isInteractive: Bool {
        !isBusy && !isAwaitingFirstLoad
    }
}

// MARK: - PinButtonProjector (web render body)

/// The pure projection from the props + the bound pin snapshot to the view-ready model — the surface's
/// data adapter in the "cached → projection" sense the acceptance calls for: it takes the snapshot the
/// store already holds (no fetch, no clock) and derives the rendered button, the pinned-ness, the busy /
/// cold-load flags, and the gated status badge. Unit tested across the pin membership, the in-flight
/// flag, the cold-vs-refresh load, and the offline → error → stale badge precedence.
public enum PinButtonProjector {
    /// Whether `itemID` is pinned in the bound bucket — the verbatim port of the web
    /// `pinned.some(p => String(p.item_id) === idStr)`.
    public static func isPinned(pinnedIDs: Set<String>, itemID: String) -> Bool {
        pinnedIDs.contains(itemID)
    }

    /// The gated status badge. Offline (the root cause) takes precedence, then a hard failure
    /// (retryable), then a stale refresh (retryable); a fresh, loaded set yields no badge so the happy
    /// path is a bare glyph identical to the web.
    public static func statusBadge(status: PinLoadStatus, freshness: PinFreshness) -> PinStatusBadge? {
        if freshness == .offline {
            return PinStatusBadge(
                tone: .offline,
                symbolName: "wifi.slash",
                messageKey: "pin.status.offline",
                messageFallback: "Offline — showing the last known pins",
                showsRetry: false
            )
        }
        if case .failed = status {
            return PinStatusBadge(
                tone: .error,
                symbolName: "exclamationmark.circle.fill",
                messageKey: "pin.status.error",
                messageFallback: "Couldn't load pinned items",
                showsRetry: true
            )
        }
        if freshness == .stale {
            return PinStatusBadge(
                tone: .stale,
                symbolName: "arrow.triangle.2.circlepath",
                messageKey: "pin.status.stale",
                messageFallback: "Refreshing pinned items…",
                showsRetry: true
            )
        }
        return nil
    }

    /// Resolves the whole button from the props + the bound pin snapshot — the native peer of the web
    /// component's render. The button is ALWAYS produced (the web never hides it); `isPinned` reads the
    /// snapshot's best-available set (cached during a refresh, empty ⇒ not pinned while cold / failed,
    /// matching the web `pinned = []` default).
    public static func resolve(_ input: PinButtonInput, snapshot: PinnedSnapshot) -> PinButtonProjection {
        let pinned = isPinned(pinnedIDs: snapshot.pinnedIDs, itemID: input.itemID)
        let awaitingFirstLoad = snapshot.status == .loading && !snapshot.hasLoaded
        return PinButtonProjection(
            isPinned: pinned,
            presentation: pinned ? .pinned : .unpinned,
            isBusy: snapshot.pendingItemIDs.contains(input.itemID),
            isAwaitingFirstLoad: awaitingFirstLoad,
            showsLabel: input.showLabel,
            statusBadge: statusBadge(status: snapshot.status, freshness: snapshot.freshness)
        )
    }
}
