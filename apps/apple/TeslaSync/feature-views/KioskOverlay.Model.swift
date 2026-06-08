//
//  KioskOverlay.Model.swift
//  TeslaSync — P4 feature view · 0124 · KioskOverlay (Apple)
//
//  The pure, host-free projection of a `KioskOverlay`'s inputs into the structural
//  decisions the view renders — the native parity of the web component's render
//  branches (web/src/features/dashboard/components/KioskOverlay.tsx):
//
//    • the dim layer + its `opacity: 1 - config.dimLevel` (CSS-clamped to 0…1),
//    • the cursor-hide decision (`isCursorHidden`),
//    • the clock decision + its corner (`config.showClock` / `config.clockPosition`),
//    • the rotation-indicator gate (`dashboardCount > 1 && config.rotateInterval > 0`)
//      and the active-dot test (`i === currentIndex`),
//    • the locale-aware clock formatters (ports of `useDateFormat`'s `formatTime`
//      and `formatDateWithDay`),
//    • the 3-second exit auto-hide delay (`setTimeout(…, 3000)`).
//
//  `KioskOverlay` owns no data — exactly like the web component, which receives
//  everything as props and fetches nothing — so the loading / empty / error /
//  stale / offline states belong to whatever surface embeds the overlay (the Kiosk
//  page), not to the overlay itself. The branches the web source actually carries
//  are reproduced here in full and are unit-tested without a rendering host.
//
//  Keeping these decisions in `Equatable` value types lets the XCTest suite cover
//  every configuration (and the accessibility / i18n policy) without a snapshot
//  host — the same approach the sibling presentational surfaces use.
//

import Foundation
import SwiftUI

// MARK: - Surface identity

/// Stable, non-identifying identity for the `KioskOverlay` feature view. The slug
/// is the value emitted with the P1/S11 `view.opened` diagnostics contract and is
/// referenced by both the view and its tests so the two never drift.
public enum KioskOverlaySurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "KioskOverlay"

    /// Reports the surface becoming visible. This is the exact code path the view
    /// runs from its `.task`, factored out so it is unit-testable without a
    /// rendering host.
    public static func reportOpen(to telemetry: any KioskOverlayTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "KioskOverlay" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum KioskOverlayStrings {
    /// The per-surface strings table name (file `KioskOverlay.strings`).
    public static let table = "KioskOverlay"

    /// The localized value for `key`, falling back to the web English literal.
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `string(_:_:)` wrapped as a `Text` (rendered verbatim so the resolved value
    /// is shown exactly).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Clock corner (web `config.clockPosition`)

/// The corner the kiosk clock pins to, mirroring the web
/// `'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'` union. The raw value
/// is the exact web string so a backend / config payload round-trips losslessly.
public enum KioskClockPosition: String, CaseIterable, Sendable {
    case topLeft = "top-left"
    case topRight = "top-right"
    case bottomLeft = "bottom-left"
    case bottomRight = "bottom-right"

    /// Decodes from the web string, defaulting to `.bottomRight` for an unknown
    /// value — parity with `DEFAULT_KIOSK_CONFIG.clockPosition`.
    public init(webValue: String) {
        self = KioskClockPosition(rawValue: webValue) ?? .bottomRight
    }

    /// The frame alignment that pins the clock box to its corner (web `top-4 left-4`
    /// … `bottom-4 right-4`).
    public var alignment: Alignment {
        switch self {
        case .topLeft: .topLeading
        case .topRight: .topTrailing
        case .bottomLeft: .bottomLeading
        case .bottomRight: .bottomTrailing
        }
    }

    /// The text-stack alignment, so the time/date hug the same screen edge as the
    /// corner (a native polish over the web's always-left-aligned text).
    public var horizontalAlignment: HorizontalAlignment {
        switch self {
        case .topLeft, .bottomLeft: .leading
        case .topRight, .bottomRight: .trailing
        }
    }
}

// MARK: - Overlay configuration (web `config: KioskConfig`)

/// The subset of the web `KioskConfig` the overlay actually reads (`dimLevel`,
/// `showClock`, `clockPosition`, `rotateInterval`). The remaining `KioskConfig`
/// fields drive the kiosk *engine* (cursor/dim timers, rotation, opacity), not this
/// presentational overlay, so they are out of this surface's contract. Defaults
/// mirror `DEFAULT_KIOSK_CONFIG`.
public struct KioskOverlayConfig: Equatable, Sendable {
    /// Web `dimLevel` (0…1). The dim layer renders at `1 - dimLevel`.
    public var dimLevel: Double
    /// Web `showClock`.
    public var showClock: Bool
    /// Web `clockPosition`.
    public var clockPosition: KioskClockPosition
    /// Web `rotateInterval` (seconds). The rotation indicator only shows when > 0.
    public var rotateInterval: Double

    public init(
        dimLevel: Double = 0.5,
        showClock: Bool = true,
        clockPosition: KioskClockPosition = .bottomRight,
        rotateInterval: Double = 30
    ) {
        self.dimLevel = dimLevel
        self.showClock = showClock
        self.clockPosition = clockPosition
        self.rotateInterval = rotateInterval
    }
}

// MARK: - Clock formatting (port of `useDateFormat`)

/// Locale + timezone-aware clock formatters, ports of the web `useDateFormat`
/// helpers used by the overlay:
///
///   • `formatTime`        → `toLocaleTimeString({ hour: '2-digit', minute: '2-digit' })`
///     (24h or 12h per locale) — template `"jjmm"`.
///   • `formatDateWithDay` → `toLocaleDateString({ weekday: 'short', month: 'short',
///     day: 'numeric' })` ("Fri, Apr 4") — template `"EEEMMMd"`.
///
/// `setLocalizedDateFormatFromTemplate` reorders the fields for the active locale,
/// matching `Intl`'s behaviour, so a 24-hour locale yields "14:30" and a 12-hour
/// locale "02:30 PM" from the same call.
public enum KioskClock {
    /// The current wall-clock time, formatted like the web `formatTime` (2-digit
    /// hour + minute, locale 12/24h).
    public static func formatTime(
        _ date: Date,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("jjmm")
        return formatter.string(from: date)
    }

    /// The current date, formatted like the web `formatDateWithDay` (short weekday +
    /// short month + numeric day).
    public static func formatDateWithDay(
        _ date: Date,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("EEEMMMd")
        return formatter.string(from: date)
    }
}

// MARK: - Exit affordance timing (web `setTimeout(…, 3000)`)

/// Timing constants for the exit affordance reveal/auto-hide, isolated so the
/// 3-second parity with the web `setShowExit(false)` timer is asserted by a test
/// rather than buried in the view.
public enum KioskOverlayExit {
    /// How long the exit control stays revealed after an interaction before it fades
    /// back out (web `setTimeout(() => setShowExit(false), 3000)`).
    public static let autoHideDelay: Duration = .seconds(3)
}

// MARK: - Presentation (pure projection of the inputs → render config)

/// The pure, `Equatable` projection of a `KioskOverlay`'s inputs into the render
/// decisions: whether/how strongly to dim, whether to hide the pointer, whether and
/// where to show the clock, and whether/how to render the rotation indicator.
public struct KioskOverlayPresentation: Equatable, Sendable {
    /// Web `isDimmed` — gates the dim layer entirely.
    public let isDimmed: Bool
    /// The dim layer opacity, web `1 - config.dimLevel`, CSS-clamped to `0…1`
    /// (non-finite input ⇒ `0`, i.e. no dimming).
    public let dimOpacity: Double
    /// Web `isCursorHidden` — the view hides the macOS pointer when `true` (a no-op
    /// on touch platforms, which have no system pointer).
    public let hidesPointer: Bool
    /// Web `config.showClock`.
    public let showsClock: Bool
    /// Web `config.clockPosition`.
    public let clockPosition: KioskClockPosition
    /// Web `dashboardCount > 1 && config.rotateInterval > 0`.
    public let showsRotationIndicator: Bool
    /// The number of rotation dots (web `dashboardCount`), floored at `0`.
    public let dashboardCount: Int
    /// The active rotation index (web `currentIndex`).
    public let currentIndex: Int

    public init(
        config: KioskOverlayConfig,
        isDimmed: Bool,
        isCursorHidden: Bool,
        dashboardCount: Int,
        currentIndex: Int
    ) {
        self.isDimmed = isDimmed
        dimOpacity = Self.dimOpacity(dimLevel: config.dimLevel)
        hidesPointer = isCursorHidden
        showsClock = config.showClock
        clockPosition = config.clockPosition
        showsRotationIndicator = dashboardCount > 1 && config.rotateInterval > 0
        self.dashboardCount = Swift.max(0, dashboardCount)
        self.currentIndex = currentIndex
    }

    /// The dim opacity, web `1 - dimLevel`, clamped to `0…1`. A non-finite
    /// `dimLevel` resolves to `0` so bad config never blacks out the screen.
    public static func dimOpacity(dimLevel: Double) -> Double {
        guard dimLevel.isFinite else { return 0 }
        return Swift.min(Swift.max(1 - dimLevel, 0), 1)
    }

    /// The dot indices to render (web `Array.from({ length: dashboardCount })`).
    public var dotIndices: Range<Int> {
        0 ..< dashboardCount
    }

    /// Whether the dot at `index` is the active one (web `i === currentIndex`).
    public func isActiveDot(_ index: Int) -> Bool {
        index == currentIndex
    }

    /// The diagnostics slug this presentation belongs to.
    public var surfaceSlug: String {
        KioskOverlaySurface.slug
    }
}
