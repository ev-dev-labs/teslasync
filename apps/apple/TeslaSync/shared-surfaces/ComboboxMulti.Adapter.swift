//
//  ComboboxMulti.Adapter.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  The testable, dependency-light core for the multi-select combobox — the SwiftUI parity of
//  `components/forms/ComboboxMulti.tsx`, the WAI-ARIA "type to filter, pick many" primitive whose value
//  is an ARRAY: selected options render as removable chips inside the field, and the dropdown ALWAYS
//  hides options that are already selected (the web never shows the same row twice). Everything in this
//  file is pure Foundation (no SwiftUI, no `@Observable`, no bundle), so every value type is unit
//  testable in isolation against the web source's own behaviour: the option / chip value
//  (``ComboboxMultiItem``), the closure-free props (``ComboboxMultiConfig``, carrying the `maxItems`
//  cap the single-select sibling lacks), the async option-load lifecycle (``ComboboxMultiListPhase``),
//  and the P4-leaf freshness axis (``ComboboxMultiConnection``). The pure projection (text filter +
//  selected-removed filter / cap / nav / at-max / result-count copy) lives next door in
//  `ComboboxMulti.Projection.swift`.
//
//  Parity disposition (Honesty Covenant #5 — parity cuts both ways):
//  The web `ComboboxMulti` is a generic `<T>` primitive driven by props. Its REAL render branches are
//  the chip strip (web `value.map(chip)`), the in-flight loading indicator (`loading` prop OR an
//  in-flight async loader), the empty row whose copy is "Maximum reached" at the cap else "No results",
//  the populated option list with the active-descendant highlight (rows non-interactive at the cap),
//  and the "{{count}} more — refine search" overflow footer. The async loader's failure path folds to
//  an empty list in the source (`setAsyncOptions([])`). This surface reproduces every one of those
//  branches and — exactly as the in-tree single-select sibling Combobox (0148) and the forms sibling
//  UnitInput (0162) do — adds the P4 leaf contract so the field never collapses to a blank box: an
//  explicit `error` retry affordance (the `QueryError` peer of the loader-failure the web swallows) and
//  the orthogonal `stale` / `offline` freshness axis. No web Tailwind class is ported; the layout is
//  composed from platform tokens (P1/S9).
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. A plain `Sendable` closure so the pure core needs no bundle: the app
/// passes the P1/S10 facade (``ComboboxMultiStrings``), tests pass an identity-fallback resolver.
public typealias ComboboxMultiResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Surface metadata

/// Static, non-identifying surface constants. The slug is the web source name (`ComboboxMulti`) so the
/// P1/S11 `view.opened` event matches across platforms; the defaults mirror the web prop defaults
/// (`maxVisibleOptions = 50`, `asyncDebounceMs = 200`).
public enum ComboboxMultiMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ComboboxMulti"

    /// Web `maxVisibleOptions = 50` — the cap on rendered rows before the "+N more" footer.
    public static let defaultMaxVisibleOptions = 50

    /// Web `asyncDebounceMs = 200` — the debounce before an async option fetch fires.
    public static let defaultAsyncDebounce: Duration = .milliseconds(200)
}

// MARK: - ComboboxMultiItem (web option `T`, reduced to its key + label)

/// One selectable option / selected chip — the native peer of the web generic option `T`, reduced to
/// the two things the component actually reads from it: a stable key (web `getOptionKey`, used for
/// React keys, aria ids, and selection-membership equality) and the visible label (web
/// `getOptionLabel` / `getChipLabel`). A page holding a richer `T` maps it into a ``ComboboxMultiItem``
/// before passing it in (`id = getOptionKey(o)`, `label = getOptionLabel(o)`) — so the value stays
/// `Equatable` / `Sendable` / `Identifiable` and the surface needs no generics.
public struct ComboboxMultiItem: Sendable, Equatable, Identifiable {
    /// Stable key (web `getOptionKey`).
    public let id: String
    /// Visible label (web `getOptionLabel` / `getChipLabel`).
    public let label: String

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

// MARK: - ComboboxMultiConnection (P4 leaf freshness axis)

/// The freshness of the bound option feed — the orthogonal connectivity axis rendered as the freshness
/// chip beneath the field (the in-tree Combobox / UnitInput precedent). `live` hides the chip; `stale`
/// shows a warning chip and arms a one-shot auto-refresh; `offline` keeps the last-loaded options and
/// shows a muted chip.
public enum ComboboxMultiConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - ComboboxMultiListPhase (web async option lifecycle)

/// The async option-load lifecycle — the native peer of the web `asyncLoading` flag plus the loader's
/// resolve / reject. A static option array is permanently `.loaded`. `.failed` carries the runtime
/// failure reason; the web swallows it to an empty list, while this surface renders it as a retry
/// affordance (the P4 `QueryError` peer) without inventing a fabricated message.
public enum ComboboxMultiListPhase: Sendable, Equatable {
    /// An async fetch is in flight (web `asyncLoading == true`).
    case loading
    /// Options are resolved (web async resolve, or any static array).
    case loaded
    /// The async loader threw a non-cancellation error (web loader reject → swallowed to `[]`).
    case failed(String)
}

// MARK: - ComboboxMultiConfig (web props, closure-free)

/// The component's props minus the closures (`onChange` and the async loader live on the state-holder
/// so this value stays `Equatable` / `Sendable`). A value type so the view, the state-holder, and the
/// pure projection agree on one shape, and so a SwiftUI `.onChange` can cheaply detect a prop rebind.
public struct ComboboxMultiConfig: Sendable, Equatable {
    /// Required visible OR accessibility label (web `label`).
    public var label: String
    /// The empty-field hint text — the web `placeholder` prop. `nil` renders no prompt. // parity:allow web prop name
    public var prompt: String?
    /// Render the label visually-hidden but still announced (web `hideLabel`).
    public var hideLabel: Bool
    /// Disable interaction (web `disabled`).
    public var disabled: Bool
    /// Cap on rendered rows before the "+N more" footer (web `maxVisibleOptions`, default 50).
    public var maxVisibleOptions: Int
    /// Maximum number of chips allowed (web `maxItems`); `nil` is unbounded.
    public var maxItems: Int?
    /// Hide the trailing chevron toggle (web `noChevron`).
    public var noChevron: Bool
    /// An optional leading SF Symbol shown inside the field (the native peer of the web `icon` node).
    public var iconSystemName: String?

    public init(
        label: String = "",
        prompt: String? = nil,
        hideLabel: Bool = false,
        disabled: Bool = false,
        maxVisibleOptions: Int = ComboboxMultiMeta.defaultMaxVisibleOptions,
        maxItems: Int? = nil,
        noChevron: Bool = false,
        iconSystemName: String? = nil
    ) {
        self.label = label
        self.prompt = prompt
        self.hideLabel = hideLabel
        self.disabled = disabled
        self.maxVisibleOptions = maxVisibleOptions
        self.maxItems = maxItems
        self.noChevron = noChevron
        self.iconSystemName = iconSystemName
    }
}

// MARK: - ComboboxMultiSnapshot (the inbound feed — web `value` + parent lifecycle + P4 leaf)

/// One coalesced snapshot pushed by the ``ComboboxMultiSource`` seam — the web controlled `value` array
/// plus the static option array (ignored in async mode, where the loader owns the rows), the parent's
/// optional loading / error lifecycle, and the P4 leaf connectivity. `selected` is the web `value`
/// (empty = nothing selected). The field reads everything through the model + this seam; it never
/// reaches the host directly.
public struct ComboboxMultiSnapshot: Sendable, Equatable {
    /// The selected options / chips, in order (web `value`).
    public var selected: [ComboboxMultiItem]
    /// The static option array (web `options` when it is an array). Ignored in async mode.
    public var staticItems: [ComboboxMultiItem]
    /// A parent-driven fetch is in flight (web `loading` prop).
    public var isLoading: Bool
    /// A parent-driven failure reason; non-empty surfaces the error affordance.
    public var errorMessage: String?
    /// The P4 leaf connectivity axis.
    public var connection: ComboboxMultiConnection

    public init(
        selected: [ComboboxMultiItem] = [],
        staticItems: [ComboboxMultiItem] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: ComboboxMultiConnection = .live
    ) {
        self.selected = selected
        self.staticItems = staticItems
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}
