import SwiftUI

// MARK: - Parity string keys (web `t(key, default)` — Localizable.xcstrings)

/// Every visible literal the "Share a trip" page resolves, centralized so the views and the parity
/// tests agree on the web key names (verbatim). Defaults ship in `Localizable.xcstrings`. The keys
/// are computed (not stored) properties because `LocalizedStringKey` is not `Sendable`; under the
/// app's Swift 6 `complete` strict-concurrency mode a stored `static let` of it would be a
/// non-concurrency-safe global. Computed accessors hold no shared state, so they are safe. The two
/// interpolated keys (`row.trip`, `row.drives`) are exposed as pure `static func` formatters that
/// resolve through `String(localized:)` / `String(format:)` so the integer argument is honored.
public enum SharingTripsStrings {
    public static var title: LocalizedStringKey {
        "sharing.trips.title"
    }

    public static var subtitle: LocalizedStringKey {
        "sharing.trips.subtitle"
    }

    public static var recentHeading: LocalizedStringKey {
        "sharing.trips.recent.heading"
    }

    public static var recentEmpty: LocalizedStringKey {
        "sharing.trips.recent.empty"
    }

    public static var staticHintHeading: LocalizedStringKey {
        "sharing.trips.staticHint.heading"
    }

    public static var staticHintBody: LocalizedStringKey {
        "sharing.trips.staticHint.body"
    }

    /// The auto-generated trip fallback label (web `${t('sharing.trips.row.trip', 'Trip')} #${id}`).
    public static func rowTrip(id: Int64) -> String {
        "\(String(localized: "sharing.trips.row.trip")) #\(id)"
    }

    /// The drive-count chip (web `t('sharing.trips.row.drives', '{{count}} drives', { count })`).
    public static func rowDrives(count: Int) -> String {
        String(format: String(localized: "sharing.trips.row.drives"), count)
    }

    /// The 8 web key names, for the parity coverage test.
    public static let rawKeys: [String] = [
        "sharing.trips.recent.empty",
        "sharing.trips.recent.heading",
        "sharing.trips.row.drives",
        "sharing.trips.row.trip",
        "sharing.trips.staticHint.body",
        "sharing.trips.staticHint.heading",
        "sharing.trips.subtitle",
        "sharing.trips.title"
    ]
}
