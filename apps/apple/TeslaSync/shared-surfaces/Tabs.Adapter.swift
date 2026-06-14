//
//  Tabs.Adapter.swift
//  TeslaSync — P4 shared surface · 0227 · Tabs (Apple)
//
//  The Foundation-only core for the accessible tab strip — the SwiftUI parity of
//  `components/ui/Tabs.tsx`. This file owns the surface identity (the diagnostics slug), the i18n facade
//  seam (`TabsResolve`), the immutable `TabItem` value type (the verbatim port of the web `TabItem` —
//  key / label / disabled), the props value type (`TabsInput` — tabs / activeTab / ariaLabel), the
//  identifier scheme (`TabsIdentifiers` — the native peer of the web `useId()` tablist id plus the
//  `{id}-tab-{key}` / `{id}-panel-{key}` element ids), the keyboard-navigation rule (`TabsKeyMove` + the
//  pure `TabsNavigator`, a byte-for-byte port of the web `handleKeyDown`), the layout metrics
//  (`TabsLayout` — native peers of the web Tailwind sizes), the view-ready `TabsItemProjection` /
//  `TabsProjection`, and the pure `TabsProjector`. No SwiftUI and no `@Observable`, so every rule is
//  unit-testable in isolation.
//
//  Faithful-parity note: the web `<Tabs>` is a PURE presentational, fully CONTROLLED primitive — it takes
//  plain props (`tabs`, `activeTab`, `onChange`, `ariaLabel?`), derives the WAI-ARIA tablist, and reports
//  activation through `onChange` (the parent owns the active-tab state). There is NO fetch, NO React-Query
//  cache, and NO Promise, so it has NO loading / error / stale / offline branch — nothing to fetch, fail,
//  age, or lose connectivity to. Inventing such chrome would fabricate states the source does not have, so
//  this surface reproduces only the source's REAL branches, the same faithful-parity stance the sibling
//  presentational primitives MaskedValue (0220) and Pagination (0221) took. The REAL branches are:
//    • populated — one or more tabs, each rendered selected / unselected / disabled (the web `tabs.map`),
//                  with roving focus + automatic-activation Left/Right/Home/End keyboard navigation.
//    • empty     — no tabs (`tabs.length === 0`): the web renders an empty `role="tablist"` container; the
//                  native peer shows a friendly, localized empty-state message instead of a blank box (the prompt's
//                  "never a blank box" rule), with no interactive tab.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum TabsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Tabs"
}

// MARK: - Localization facade seam (web has no `t()`; the empty-state message is the lone native prose)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// closure so the pure core has no dependency on a bundle: the production app passes the P1/S10 facade,
/// while tests pass a deterministic resolver. The web `<Tabs>` routes no literals (tab labels + ariaLabel
/// are caller-supplied, already-localized props), so the only key is the native empty-state message.
public typealias TabsResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - TabItem (web `TabItem` — key / label / disabled)

/// One tab descriptor — the verbatim port of the web `interface TabItem { key; label; disabled? }`. The
/// `label` is a caller-supplied, already-localized string (rendered verbatim, exactly like the web), and
/// `disabled` defaults to `false` (the web optional). `Identifiable` by `key` so SwiftUI's `ForEach` keys
/// rows the same way the web `key={tab.key}` does.
public struct TabItem: Sendable, Equatable, Identifiable {
    /// The stable identity reported through `onChange` (web `key`).
    public let key: String
    /// The already-localized, caller-supplied display label (web `label`).
    public let label: String
    /// Whether the tab is non-interactive and skipped by keyboard navigation (web `disabled`).
    public let disabled: Bool

    public init(key: String, label: String, disabled: Bool = false) {
        self.key = key
        self.label = label
        self.disabled = disabled
    }

    /// `Identifiable` conformance — the tab key (web `key={tab.key}`).
    public var id: String {
        key
    }
}

// MARK: - TabsInput (web props, closure-free)

/// The component's props — the native peer of `TabsProps`, minus the `onChange` callback (held by the
/// state-holder so the input stays `Equatable`) and the `className` (a Tailwind concern, not ported). A
/// value type so the view, the state-holder, and the pure projection agree on one shape, and so a SwiftUI
/// `.onChange` can detect a prop change cheaply when a reused control rebinds.
public struct TabsInput: Sendable, Equatable {
    /// The ordered tab descriptors (web `tabs`).
    public let tabs: [TabItem]
    /// The key of the currently active tab (web `activeTab`).
    public let activeTab: String
    /// The optional accessible name for the tablist (web `ariaLabel`); `nil` leaves it unnamed.
    public let ariaLabel: String?

    public init(tabs: [TabItem], activeTab: String, ariaLabel: String? = nil) {
        self.tabs = tabs
        self.activeTab = activeTab
        self.ariaLabel = ariaLabel
    }

    /// Whether the empty branch renders (web `tabs.length === 0`): no tabs to show.
    public var isEmpty: Bool {
        tabs.isEmpty
    }

    /// The keys of the non-disabled tabs, in order — the verbatim port of the web
    /// `tabs.filter(t => !t.disabled).map(t => t.key)`. Drives roving focus + arrow navigation.
    public var enabledKeys: [String] {
        tabs.filter { !$0.disabled }.map(\.key)
    }
}

// MARK: - TabsIdentifiers (web `useId()` + `{id}-tab-{key}` / `{id}-panel-{key}`)

/// The element-identifier scheme — the native peer of the web `useId()` tablist id and the derived tab /
/// panel ids. The web wires `aria-controls` / `aria-labelledby` through these ids so a consumer-rendered
/// `role="tabpanel"` points back at its tab; native carries the same strings as `accessibilityIdentifier`s
/// so hosts can wire the same relationship and tests can assert the format. ``generate()`` is the parity of
/// `useId()` — a per-instance unique, render-stable id.
public enum TabsIdentifiers {
    /// The tab element id (web `id={`${tablistId}-tab-${tab.key}`}`).
    public static func tab(_ tablistID: String, key: String) -> String {
        "\(tablistID)-tab-\(key)"
    }

    /// The panel element id (web `aria-controls={`${tablistId}-panel-${tab.key}`}`).
    public static func panel(_ tablistID: String, key: String) -> String {
        "\(tablistID)-panel-\(key)"
    }

    /// A fresh, render-stable tablist id — the native peer of `useId()`.
    public static func generate() -> String {
        "tabs-\(UUID().uuidString.prefix(8))"
    }
}

// MARK: - TabsKeyMove + TabsNavigator (web `handleKeyDown`)

/// A keyboard navigation intent — the native peer of the web arrow / Home / End handling: ``previous`` is
/// ArrowLeft, ``next`` is ArrowRight, ``first`` is Home, ``last`` is End.
public enum TabsKeyMove: Sendable, Equatable, CaseIterable {
    /// ArrowLeft — the previous enabled tab (wrapping).
    case previous
    /// ArrowRight — the next enabled tab (wrapping).
    case next
    /// Home — the first enabled tab.
    case first
    /// End — the last enabled tab.
    case last
}

/// The pure keyboard-navigation rule — the byte-for-byte port of the web `handleKeyDown`. Given the focused
/// tab's key, a move, and the ordered `enabledKeys`, it returns the next key to focus + activate (web
/// automatic activation), or `nil` when there is nothing to move to. Faithful edges, exactly as the web:
///   • `enabledKeys` empty → `nil` (web `if (enabledKeys.length === 0) return`).
///   • arrow from a key NOT in `enabledKeys` (e.g. the active tab is disabled) → `nil` (web `idx === -1`).
///   • arrows wrap with `(idx + delta + n) % n`; Home / End jump to the first / last enabled key (these
///     work even when the current key is not enabled, matching the web Home/End branch).
public enum TabsNavigator {
    /// The next key to focus + activate for `move`, or `nil` when navigation is a no-op.
    public static func nextKey(
        from currentKey: String,
        move: TabsKeyMove,
        enabledKeys: [String]
    ) -> String? {
        guard !enabledKeys.isEmpty else { return nil }
        switch move {
        case .first:
            return enabledKeys.first
        case .last:
            return enabledKeys.last
        case .previous, .next:
            guard let idx = enabledKeys.firstIndex(of: currentKey) else { return nil }
            let delta = move == .next ? 1 : -1
            let count = enabledKeys.count
            let nextIdx = ((idx + delta) % count + count) % count
            return enabledKeys[nextIdx]
        }
    }
}

// MARK: - TabsLayout (web Tailwind metrics)

/// The surface's precise metrics — the native peers of the web Tailwind utilities on
/// `components/ui/Tabs.tsx`: the `gap-1` between tabs, the `px-4` / `py-2` tab inset, the `border-b` 1pt
/// baseline under the whole strip, the `border-b-2` 2pt accent underline under the selected tab, and the
/// `opacity-50` disabled dimming. Named constants rather than scattered magic numbers, mirroring the
/// sibling surfaces' `…Layout` enums.
public enum TabsLayout {
    /// Spacing between adjacent tabs (web `gap-1`).
    public static let stripSpacing: CGFloat = 4
    /// Horizontal inset inside each tab (web `px-4`).
    public static let tabHorizontalPadding: CGFloat = 16
    /// Vertical inset inside each tab (web `py-2`).
    public static let tabVerticalPadding: CGFloat = 8
    /// The selected tab's accent underline thickness (web `border-b-2`).
    public static let indicatorThickness: CGFloat = 2
    /// The strip's baseline border thickness (web `border-b`).
    public static let baselineThickness: CGFloat = 1
    /// Dimming applied to a disabled tab (web `opacity-50`).
    public static let disabledOpacity: CGFloat = 0.5
}

// MARK: - TabsItemProjection (view-ready per tab)

/// The resolved, view-ready model for one tab — everything the SwiftUI tab button needs as a pure function
/// of the props. `isSelected` is the web `activeTab === tab.key` (→ `aria-selected`); `isDisabled` is the
/// web `disabled`; `tabElementID` / `panelID` are the web `id` / `aria-controls`. ``isFocusable`` projects
/// the web roving `tabIndex={selected ? 0 : -1}` (a disabled selected tab is not focusable, exactly as a
/// disabled DOM button ignores its tabindex).
public struct TabsItemProjection: Sendable, Equatable, Identifiable {
    /// The tab identity (web `tab.key`).
    public let key: String
    /// The already-localized display label (web `tab.label`).
    public let label: String
    /// Whether this is the active tab (web `activeTab === tab.key` → `aria-selected`).
    public let isSelected: Bool
    /// Whether the tab is non-interactive (web `disabled`).
    public let isDisabled: Bool
    /// The tab element id (web `id`).
    public let tabElementID: String
    /// The controlled panel id (web `aria-controls`).
    public let panelID: String

    public init(
        key: String,
        label: String,
        isSelected: Bool,
        isDisabled: Bool,
        tabElementID: String,
        panelID: String
    ) {
        self.key = key
        self.label = label
        self.isSelected = isSelected
        self.isDisabled = isDisabled
        self.tabElementID = tabElementID
        self.panelID = panelID
    }

    /// `Identifiable` conformance — the tab key.
    public var id: String {
        key
    }

    /// Whether the tab is the single roving tab-order stop — the web `tabIndex={selected ? 0 : -1}`, with a
    /// disabled selected tab excluded (a disabled control is not focusable regardless of tabindex).
    public var isFocusable: Bool {
        isSelected && !isDisabled
    }
}

// MARK: - TabsProjection (view-ready)

/// The resolved, view-ready model — everything the SwiftUI body needs as a pure function of the props (no
/// clock, no networking, no derivation in the view). `items` is the web `tabs.map`; `enabledKeys` is the
/// web `enabledKeys`; `selectedKey` is the web `activeTab`; `accessibilityLabel` is the web `ariaLabel`;
/// `emptyLabel` is the resolved native empty-state message for the no-tabs branch; `tablistID` is the web
/// `useId()` value.
public struct TabsProjection: Sendable, Equatable {
    /// The tablist id (web `useId()`).
    public let tablistID: String
    /// The optional tablist accessible name (web `ariaLabel`).
    public let accessibilityLabel: String?
    /// The view-ready tabs (web `tabs.map`).
    public let items: [TabsItemProjection]
    /// The enabled-tab keys, in order (web `enabledKeys`).
    public let enabledKeys: [String]
    /// The active tab key (web `activeTab`).
    public let selectedKey: String
    /// The localized empty-branch message (no web equivalent — the native "never a blank box" copy).
    public let emptyLabel: String

    public init(
        tablistID: String,
        accessibilityLabel: String?,
        items: [TabsItemProjection],
        enabledKeys: [String],
        selectedKey: String,
        emptyLabel: String
    ) {
        self.tablistID = tablistID
        self.accessibilityLabel = accessibilityLabel
        self.items = items
        self.enabledKeys = enabledKeys
        self.selectedKey = selectedKey
        self.emptyLabel = emptyLabel
    }

    /// Whether the empty-state message renders (web `tabs.length === 0`).
    public var isEmpty: Bool {
        items.isEmpty
    }

    /// Whether `key` is an enabled (non-disabled) tab — the activation gate.
    public func isEnabled(_ key: String) -> Bool {
        enabledKeys.contains(key)
    }
}

// MARK: - TabsProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "inputs → projection" sense the acceptance calls for: it takes the props a host already holds (no fetch,
/// no clock) plus the resolved empty-state label and the tablist id, and reproduces the component's
/// `tabs.map` render decision deterministically. Unit tested across the selected / disabled / empty
/// branches and the id format.
public enum TabsProjector {
    /// Resolves the whole model. `tablistID` is the web `useId()` value (injected so the projector stays
    /// Foundation-only); `emptyLabel` is the resolved native empty-state message (web has none).
    public static func project(
        _ input: TabsInput,
        tablistID: String,
        emptyLabel: String
    ) -> TabsProjection {
        let items = input.tabs.map { tab in
            TabsItemProjection(
                key: tab.key,
                label: tab.label,
                isSelected: tab.key == input.activeTab,
                isDisabled: tab.disabled,
                tabElementID: TabsIdentifiers.tab(tablistID, key: tab.key),
                panelID: TabsIdentifiers.panel(tablistID, key: tab.key)
            )
        }
        return TabsProjection(
            tablistID: tablistID,
            accessibilityLabel: input.ariaLabel,
            items: items,
            enabledKeys: input.enabledKeys,
            selectedKey: input.activeTab,
            emptyLabel: emptyLabel
        )
    }
}
