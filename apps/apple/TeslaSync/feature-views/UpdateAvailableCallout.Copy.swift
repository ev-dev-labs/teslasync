//
//  UpdateAvailableCallout.Copy.swift
//  TeslaSync — P4 feature view · 0259 · UpdateAvailableCallout (Apple)
//
//  The copy catalog — every string the surface renders, as `UAText` constants carrying an
//  i18n key + the English fallback. The web source
//  (web/src/features/system/components/status/UpdateAvailableCallout.tsx) hardcodes its
//  copy as English literals (it makes NO `t()` calls), so these keys PROMOTE those literals
//  into the P1/S10 catalog — the native surface holds no hardcoded English. The fallbacks
//  are the web literals verbatim; the final group backs the native chrome (the external-link
//  hint + the P4 freshness notes) the Apple HIG states contract requires and the web gets
//  implicitly (an `<a target=_blank>`) or omits (the freshness axis).
//
//  Kept beside the projection (not in the view) so the strings are referenced by key in one
//  place, the interpolating builders (version, timestamp) are unit-testable, and the
//  catalog-coverage test can iterate the full set.
//

import Foundation

/// The surface copy catalog. Static `UAText` for the fixed strings; small builders for the
/// interpolating strings (web `v${version}` and the formatted timestamp).
public enum UpdateAvailableCopy {
    // MARK: Heading (web `Update available{latest ? ` — v${latest}` : ''}`)

    /// The heading with no known latest version (web `latest` falsy).
    public static let heading = UAText(
        "updateAvailable.heading",
        "Update available"
    )

    /// The heading with the latest version (web `Update available — v${latest}`).
    public static func headingWithVersion(_ version: String) -> UAText {
        UAText(
            "updateAvailable.heading.withVersion",
            "Update available — v{{version}}",
            args: ["version": version]
        )
    }

    // MARK: Body (web `{current ? `You're running v${current}. ` : ''}Review …`)

    /// The body with no known current version (web `current` falsy).
    public static let body = UAText(
        "updateAvailable.body",
        "Review the release notes before upgrading your deployment."
    )

    /// The body prefixed with the running version (web `You're running v${current}. Review …`).
    public static func bodyWithCurrent(_ version: String) -> UAText {
        UAText(
            "updateAvailable.body.withCurrent",
            "You're running v{{version}}. Review the release notes before upgrading your deployment.",
            args: ["version": version]
        )
    }

    // MARK: Last checked (web `checkedAt && ` · Last checked ${formatDateTime(checkedAt)}``)

    /// The "last checked" line (the leading ` · ` separator is rendered as layout punctuation,
    /// kept out of the localized string per i18n practice). `timestamp` is pre-formatted by
    /// `UpdateAvailableFormat.dateTime` (the `useDateFormat` port).
    public static func lastChecked(_ timestamp: String) -> UAText {
        UAText(
            "updateAvailable.lastChecked",
            "Last checked {{timestamp}}",
            args: ["timestamp": timestamp]
        )
    }

    // MARK: Call to action (web anchor `View notes`)

    /// The release-notes link label (web anchor text).
    public static let viewNotes = UAText(
        "updateAvailable.viewNotes",
        "View notes"
    )

    // MARK: Native chrome (a11y + P4 freshness — not literal in the web leaf)

    /// VoiceOver hint for the external link (web `<a target="_blank" rel="noopener">`).
    public static let viewNotesHint = UAText(
        "updateAvailable.viewNotes.hint",
        "Opens the release notes on GitHub in your browser"
    )

    /// VoiceOver/header label for the whole callout (web `role="status"` region intent).
    public static let regionLabel = UAText(
        "updateAvailable.region.label",
        "Update available"
    )

    /// The stale freshness chip (P4 leaf `stale` — the web `staleTime` window elapsed).
    public static let freshnessStale = UAText(
        "updateAvailable.freshness.stale",
        "This result may be out of date"
    )

    /// The offline freshness chip (P4 leaf `offline` — showing the last cached check).
    public static let freshnessOffline = UAText(
        "updateAvailable.freshness.offline",
        "Offline — showing the last check"
    )

    /// The freshness chip copy for a connection, or nil when live (no chip).
    public static func freshnessNote(for connection: UpdateConnection) -> UAText? {
        switch connection {
        case .live: nil
        case .stale: freshnessStale
        case .offline: freshnessOffline
        }
    }
}
