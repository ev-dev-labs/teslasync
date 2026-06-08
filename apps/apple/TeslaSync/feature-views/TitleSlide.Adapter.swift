//
//  TitleSlide.Adapter.swift
//  TeslaSync — P4 feature view · 0070 · TitleSlide (Apple)
//
//  Pure (Foundation-only) projection: cached `TitleSlideDTO` + display locale → the display
//  strings the view renders, reproducing the web source's numeric pipeline VERBATIM so the native
//  surface shows the exact same values as features/analytics/components/review/TitleSlide.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware number formatting that mirrors the web `fmtNumber` (`Number.toLocaleString`).
public enum TitleSlideFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// The web year glyph is `<AnimatedNumber value={data.year} />`, whose default `decimals = 0`
    /// feeds `fmtNumber(value, 0)` → `value.toLocaleString(locale, { min/maxFractionDigits: 0 })`.
    /// For a four-digit year that emits a grouping separator (en-US → "2,026"). We reproduce that
    /// exact output — including the separator — rather than "correcting" it, so a user with the web
    /// and native recaps open side by side sees identical text (covenant: no silent drift). The
    /// behaviour is pinned by `TitleSlideAdapterTests.testYearGroupsLikeWebFmtNumber`.
    public static func year(_ value: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        let safe = safeNumber(Double(value))
        return formatter.string(from: NSNumber(value: safe)) ?? String(value)
    }
}

// MARK: - Projection (web `TitleSlide` body)

/// The fully-projected slide content: the formatted hero year (web `AnimatedNumber`), the raw year
/// integer (for accessibility / callers), and the resolved vehicle name (web
/// `data.vehicle.display_name`). Computed once per snapshot by the model.
public struct TitleSlideProjection: Equatable {
    public let yearText: String
    public let year: Int
    public let vehicleName: String

    public init(yearText: String, year: Int, vehicleName: String) {
        self.yearText = yearText
        self.year = year
        self.vehicleName = vehicleName
    }
}

/// Pure projector: `TitleSlideDTO` + locale → `TitleSlideProjection`. Every value is computed with
/// the exact same formatting as the web slide.
public enum TitleSlideProjector {
    /// The em-dash sentinel shown when the recap has no usable vehicle name. The web binds
    /// `data.vehicle.display_name` directly; we trim it and fall back to the em-dash for null-safety
    /// so the hero never renders a blank line.
    public static let emDash = "—"

    public static func project(data: TitleSlideDTO, localeIdentifier: String = "en_US") -> TitleSlideProjection {
        let trimmedName = data.vehicleDisplayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return TitleSlideProjection(
            yearText: TitleSlideFormat.year(data.year, localeIdentifier: localeIdentifier),
            year: data.year,
            vehicleName: trimmedName.isEmpty ? emDash : trimmedName
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the slide. Pure + public so the a11y label content can
/// be unit-tested without rendering the view. Labels resolve through the injected localizer
/// (bundle-free in tests).
public enum TitleSlideAccessibility {
    /// One spoken sentence: the recap title, the year, then the vehicle, e.g.
    /// "Year in Review, 2,026, Model 3".
    public static func summary(
        for projection: TitleSlideProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("yearReview.title", "Year in Review")
        return [title, projection.yearText, projection.vehicleName].joined(separator: ", ")
    }
}
