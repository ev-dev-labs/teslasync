//
//  Combobox.Adapter.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  The testable, dependency-light core for the combobox — the SwiftUI parity of
//  `components/forms/Combobox.tsx`, the shared WAI-ARIA "type to filter then pick" primitive used by
//  signal pickers, geocoded address inputs, and vehicle pickers. Everything in this file is pure
//  Foundation (no SwiftUI, no `@Observable`, no bundle), so every value type is unit testable in
//  isolation against the web source's own behaviour: the option value (``ComboboxItem``), the
//  closure-free props (``ComboboxConfig``), the async option-load lifecycle (``ComboboxListPhase``),
//  and the P4-leaf freshness axis (``ComboboxConnection``). The pure projection (filter / cap / nav /
//  result-count copy) lives next door in `Combobox.Projection.swift`.
//
//  Parity disposition (Honesty Covenant #5 — parity cuts both ways):
//  The web `Combobox` is a generic `<T>` primitive driven by props. Its REAL render branches are the
//  in-flight loading indicator (`loading` prop OR an in-flight async loader), the "No results" empty
//  row, the populated option list with the active-descendant + selected highlight, and the
//  "{{count}} more — refine search" overflow footer. The async loader's failure path folds to an empty
//  list in the source (`setAsyncOptions([])`). This surface reproduces every one of those branches and
//  — exactly as the in-tree forms sibling UnitInput (0162) does — adds the P4 leaf contract so the
//  field never collapses to a blank box: an explicit `error` retry affordance (the `QueryError` peer of
//  the loader-failure the web swallows) and the orthogonal `stale` / `offline` freshness axis. No web
//  Tailwind class is ported; the layout is composed from platform tokens (P1/S9).
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. A plain `Sendable` closure so the pure core needs no bundle: the app
/// passes the P1/S10 facade (``ComboboxStrings``), tests pass an identity-fallback resolver.
public typealias ComboboxResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Surface metadata

/// Static, non-identifying surface constants. The slug is the web source name (`Combobox`) so the
/// P1/S11 `view.opened` event matches across platforms; the defaults mirror the web prop defaults
/// (`maxVisibleOptions = 50`, `asyncDebounceMs = 200`).
public enum ComboboxMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "Combobox"

    /// Web `maxVisibleOptions = 50` — the cap on rendered rows before the "+N more" footer.
    public static let defaultMaxVisibleOptions = 50

    /// Web `asyncDebounceMs = 200` — the debounce before an async option fetch fires.
    public static let defaultAsyncDebounce: Duration = .milliseconds(200)
}

// MARK: - ComboboxItem (web option `T`, reduced to its key + label)

/// One selectable option — the native peer of the web generic option `T`, reduced to the two things
/// the component actually reads from it: a stable key (web `getOptionKey`, used for React keys, aria
/// ids, and selection equality) and the visible label (web `getOptionLabel`). A page holding a richer
/// `T` maps it into a ``ComboboxItem`` before passing it in (`id = getOptionKey(o)`,
/// `label = getOptionLabel(o)`), exactly as the sibling ActiveFilterChips reduces its chip model — so
/// the value stays `Equatable` / `Sendable` / `Identifiable` and the surface needs no generics.
public struct ComboboxItem: Sendable, Equatable, Identifiable {
    /// Stable key (web `getOptionKey`).
    public let id: String
    /// Visible label (web `getOptionLabel`).
    public let label: String

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

// MARK: - ComboboxConnection (P4 leaf freshness axis)

/// The freshness of the bound option feed — the orthogonal connectivity axis rendered as the
/// freshness chip beneath the field (the in-tree UnitInput precedent). `live` hides the chip; `stale`
/// shows a warning chip and arms a one-shot auto-refresh; `offline` keeps the last-loaded options and
/// shows a muted chip.
public enum ComboboxConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - ComboboxListPhase (web async option lifecycle)

/// The async option-load lifecycle — the native peer of the web `asyncLoading` flag plus the
/// loader's resolve / reject. A static option array is permanently `.loaded`. `.failed` carries the
/// runtime failure reason; the web swallows it to an empty list, while this surface renders it as a
/// retry affordance (the P4 `QueryError` peer) without inventing a fabricated message.
public enum ComboboxListPhase: Sendable, Equatable {
    /// An async fetch is in flight (web `asyncLoading == true`).
    case loading
    /// Options are resolved (web async resolve, or any static array).
    case loaded
    /// The async loader threw a non-cancellation error (web loader reject → swallowed to `[]`).
    case failed(String)
}

// MARK: - ComboboxConfig (web props, closure-free)

/// The component's props minus the closures (`onChange` / `onFreeTextCommit` / `onInputChange` and the
/// async loader live on the state-holder so this value stays `Equatable` / `Sendable`). A value type
/// so the view, the state-holder, and the pure projection agree on one shape, and so a SwiftUI
/// `.onChange` can cheaply detect a prop rebind.
public struct ComboboxConfig: Sendable, Equatable {
    /// Required visible OR accessibility label (web `label`).
    public var label: String
    /// The empty-field hint text — the web `placeholder` prop. `nil` renders no prompt. // parity:allow web prop name
    public var prompt: String?
    /// Render the label visually-hidden but still announced (web `hideLabel`).
    public var hideLabel: Bool
    /// Disable interaction (web `disabled`).
    public var disabled: Bool
    /// Commit raw typed text on Enter when no option is highlighted (web `allowFreeText`).
    public var allowFreeText: Bool
    /// Cap on rendered rows before the "+N more" footer (web `maxVisibleOptions`, default 50).
    public var maxVisibleOptions: Int
    /// Hide the trailing chevron toggle (web `noChevron`).
    public var noChevron: Bool
    /// Hide the inline clear (×) button (web `noClearButton`).
    public var noClearButton: Bool
    /// An optional leading SF Symbol shown inside the field (the native peer of the web `icon` node).
    public var iconSystemName: String?

    public init(
        label: String = "",
        prompt: String? = nil,
        hideLabel: Bool = false,
        disabled: Bool = false,
        allowFreeText: Bool = false,
        maxVisibleOptions: Int = ComboboxMeta.defaultMaxVisibleOptions,
        noChevron: Bool = false,
        noClearButton: Bool = false,
        iconSystemName: String? = nil
    ) {
        self.label = label
        self.prompt = prompt
        self.hideLabel = hideLabel
        self.disabled = disabled
        self.allowFreeText = allowFreeText
        self.maxVisibleOptions = maxVisibleOptions
        self.noChevron = noChevron
        self.noClearButton = noClearButton
        self.iconSystemName = iconSystemName
    }
}

// MARK: - ComboboxSnapshot (the inbound feed — web `value` + parent lifecycle + P4 leaf)

/// One coalesced snapshot pushed by the ``ComboboxSource`` seam — the web controlled `value` plus the
/// static option array (ignored in async mode, where the loader owns the rows), the parent's optional
/// loading / error lifecycle, and the P4 leaf connectivity. `selection` is the web `value` (`nil` =
/// nothing selected). The field reads everything through the model + this seam; it never reaches the
/// host directly.
public struct ComboboxSnapshot: Sendable, Equatable {
    /// The selected option (web `value`); `nil` is nothing selected.
    public var selection: ComboboxItem?
    /// The static option array (web `options` when it is an array). Ignored in async mode.
    public var staticItems: [ComboboxItem]
    /// A parent-driven fetch is in flight (web `loading` prop).
    public var isLoading: Bool
    /// A parent-driven failure reason; non-empty surfaces the error affordance.
    public var errorMessage: String?
    /// The P4 leaf connectivity axis.
    public var connection: ComboboxConnection

    public init(
        selection: ComboboxItem? = nil,
        staticItems: [ComboboxItem] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: ComboboxConnection = .live
    ) {
        self.selection = selection
        self.staticItems = staticItems
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}
