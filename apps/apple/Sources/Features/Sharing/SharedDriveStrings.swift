import SwiftUI

// MARK: - Parity string keys (web `t(key, default)` — Localizable.xcstrings)

/// Every visible literal the Shared Drive report resolves, centralized so the views and the parity
/// tests agree on the web key names (verbatim). Defaults ship in `Localizable.xcstrings`. The keys
/// are computed (not stored) properties because `LocalizedStringKey` is not `Sendable`; under the
/// app's Swift 6 `complete` strict-concurrency mode a stored `static let` of it would be a
/// non-concurrency-safe global. Computed accessors hold no shared state, so they are safe.
public enum SharedDriveStrings {
    public static var header: LocalizedStringKey {
        "share.header"
    }

    public static var distance: LocalizedStringKey {
        "share.distance"
    }

    public static var duration: LocalizedStringKey {
        "share.duration"
    }

    public static var efficiency: LocalizedStringKey {
        "share.efficiency"
    }

    public static var battery: LocalizedStringKey {
        "share.battery"
    }

    public static var maxSpeed: LocalizedStringKey {
        "share.maxSpeed"
    }

    public static var avgSpeed: LocalizedStringKey {
        "share.avgSpeed"
    }

    public static var elevGain: LocalizedStringKey {
        "share.elevGain"
    }

    public static var elevation: LocalizedStringKey {
        "share.elevation"
    }

    public static var elevationAria: LocalizedStringKey {
        "share.elevation.aria"
    }

    public static var elevTooltipLabel: LocalizedStringKey {
        "share.elevTooltipLabel"
    }

    public static var speed: LocalizedStringKey {
        "share.speed"
    }

    public static var speedAria: LocalizedStringKey {
        "share.speed.aria"
    }

    public static var speedTooltipLabel: LocalizedStringKey {
        "share.speedTooltipLabel"
    }

    public static var noMapData: LocalizedStringKey {
        "share.noMapData"
    }

    public static var footer: LocalizedStringKey {
        "share.footer"
    }

    public static var learnMore: LocalizedStringKey {
        "share.learnMore"
    }

    public static var expiredTitle: LocalizedStringKey {
        "share.expired.title"
    }

    public static var expiredDescription: LocalizedStringKey {
        "share.expired.description"
    }

    public static var expiredHome: LocalizedStringKey {
        "share.expired.home"
    }

    /// The 20 web key names, for the parity coverage test.
    public static let rawKeys: [String] = [
        "share.header",
        "share.distance",
        "share.duration",
        "share.efficiency",
        "share.battery",
        "share.maxSpeed",
        "share.avgSpeed",
        "share.elevGain",
        "share.elevation",
        "share.elevation.aria",
        "share.elevTooltipLabel",
        "share.speed",
        "share.speed.aria",
        "share.speedTooltipLabel",
        "share.noMapData",
        "share.footer",
        "share.learnMore",
        "share.expired.title",
        "share.expired.description",
        "share.expired.home"
    ]
}
