//
//  ComboboxMulti.Strings.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  The P1/S10 localization facade for the multi-select combobox — the native peer of the web
//  `t(key, default)` calls in `components/forms/ComboboxMulti.tsx`. Every key/fallback pair is
//  byte-identical to the web source so the picker reads the same on both platforms; the `{{count}}` /
//  `{{label}}` tokens carry the i18next interpolation markers through verbatim (resolved by
//  ``ComboboxMultiProjector/interpolate(_:_:)``). Keys live in the per-surface "ComboboxMulti" table,
//  folded into the app `Localizable.xcstrings` catalog at integration time; in test / preview bundles
//  `NSLocalizedString` returns the `value:` fallback, keeping the labels deterministic. The Swift
//  sources hold no English literals — every string flows through here.
//

import Foundation

/// Resolves the surface's strings by key with the web English fallback. The web `t()` keys are
/// reproduced verbatim; the remaining keys are native P4 leaf chrome (error / freshness / a11y) so the
/// views never hardcode prose.
public enum ComboboxMultiStrings {
    public static let table = "ComboboxMulti"

    /// The default bundle-backed resolver (the production facade). Tests inject an identity-fallback
    /// resolver through the pure projector instead.
    public static let string: ComboboxMultiResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Web `t()` keys (verbatim from components/forms/ComboboxMulti.tsx)

    /// Empty-list row + zero-count announcement (web `combobox.noResults`).
    public static var noResults: String {
        string("combobox.noResults", "No results")
    }

    /// In-flight fetch indicator + loading row (web `combobox.loading`).
    public static var loading: String {
        string("combobox.loading", "Loading")
    }

    /// The empty-row + input-prompt copy when the selection cap is reached (web
    /// `combobox.maxReached`).
    public static var maxReached: String {
        string("combobox.maxReached", "Maximum reached")
    }

    /// Chevron label while the list is open (web `combobox.closeListAria`).
    public static var closeListAria: String {
        string("combobox.closeListAria", "Hide options")
    }

    /// Chevron label while the list is closed (web `combobox.openListAria`).
    public static var openListAria: String {
        string("combobox.openListAria", "Show options")
    }

    /// The single-result announcement (web `combobox.resultsCountOne`).
    public static var resultsCountOne: String {
        string("combobox.resultsCountOne", "1 result")
    }

    /// The result-count screen-reader announcement, `{{count}}` interpolated (web
    /// `combobox.resultsCount` / `combobox.resultsCountOne` / `combobox.noResults`).
    public static func resultsCount(_ count: Int) -> String {
        ComboboxMultiProjector.resultCountMessage(
            count: count,
            noResults: noResults,
            one: resultsCountOne,
            manyTemplate: string("combobox.resultsCount", "{{count}} results")
        )
    }

    /// The "+N more — refine search" footer, `{{count}}` interpolated (web `combobox.moreHidden`).
    public static func moreHidden(_ count: Int) -> String {
        ComboboxMultiProjector.moreHiddenLabel(
            template: string("combobox.moreHidden", "{{count}} more — refine search"),
            count: count
        )
    }

    /// One chip's remove-button accessibility label, `{{label}}` interpolated (web
    /// `combobox.removeChip`).
    public static func removeChip(_ label: String) -> String {
        ComboboxMultiProjector.labelMessage(
            template: string("combobox.removeChip", "Remove {{label}}"),
            label: label
        )
    }

    /// The polite announcement posted after a chip is removed, `{{label}}` interpolated (web
    /// `combobox.removedChip`).
    public static func removedChip(_ label: String) -> String {
        ComboboxMultiProjector.labelMessage(
            template: string("combobox.removedChip", "Removed {{label}}"),
            label: label
        )
    }

    // MARK: Native P4 leaf chrome (no English literals in Swift)

    /// The listbox accessibility container label fallback (used when the field label is empty).
    public static var optionsLabel: String {
        string("combobox.optionsLabel", "Options")
    }

    /// The error-row title (the P4 `QueryError` peer for the loader failure the web swallows).
    public static var errorTitle: String {
        string("combobox.errorTitle", "Couldn't load options")
    }

    /// The error-row retry affordance.
    public static var retry: String {
        string("combobox.retry", "Retry")
    }

    /// Freshness chip — live feed (chip hidden, kept for completeness / a11y).
    public static var live: String {
        string("combobox.live", "Live")
    }

    /// Freshness chip — stale feed.
    public static var stale: String {
        string("combobox.stale", "Stale")
    }

    /// Freshness chip — offline feed.
    public static var offline: String {
        string("combobox.offline", "Offline")
    }

    /// Freshness chip — stale accessibility label (the chip is a refresh button).
    public static var staleA11y: String {
        string("combobox.staleA11y", "Stale — tap to refresh")
    }

    /// Freshness chip — offline accessibility label.
    public static var offlineA11y: String {
        string("combobox.offlineA11y", "Offline — showing the last loaded options")
    }
}
