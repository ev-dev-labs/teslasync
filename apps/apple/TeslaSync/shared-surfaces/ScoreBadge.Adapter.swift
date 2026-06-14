//
//  ScoreBadge.Adapter.swift
//  TeslaSync — P4 shared surface · 0103 · ScoreBadge (Apple)
//
//  The testable, dependency-light core for the score badge — the SwiftUI parity of
//  `components/data-display/ScoreBadge.tsx`. Everything here is pure (Foundation only): the A–F grade
//  scale (the verbatim port of `lib/scoreScale.ts` — the grade union, the default 0–100 thresholds,
//  and `numericToGrade`), the grade glyphs lifted into i18n keys (the web `ScoreGradeInfo.label`
//  literals), the aria-label composer (the verbatim port of the web
//  `t('score.aria', 'Score {{grade}}', { grade })`), the display-size scale (the web `SIZE_CLASS`),
//  the fetch lifecycle, the surface metadata (diagnostics slug), and the VoiceOver label builder.
//  No store, no bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web badge is a letter-grade pill (A+ / A / B / C / D / F / —) where the letter IS
//  the badge — no extra "SCORE" sub-label. It takes either a numeric `score` (mapped to a grade via
//  `numericToGrade`, optionally with custom `thresholds` for an inverse scale such as Wh/km
//  efficiency) or a pre-computed `grade`, plus a `size`. The colour comes from the shared grade
//  palette so any badge with the same letter renders the same colour everywhere. All names are
//  prefixed `ScoreBadge` so the surface stays self-contained in the single app module.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity resolver. The web
/// source routes only the aria label through `t()`; the grade glyphs (A+ / A / … / —) are hardcoded
/// in the shared palette, so they are lifted into keys here with the verbatim glyph as the fallback
/// (native code holds no hardcoded English literals).
public typealias ScoreBadgeResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Grade (verbatim port of `scoreScale.ts` `ScoreGrade`)

/// The letter grade the badge renders — the native mirror of the web `ScoreGrade` union
/// (`'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | '—'`). The case names are spelled out (a single-letter case
/// trips the repo's `identifier_name` floor); the raw values carry the clean scale id used to namespace
/// the i18n keys. ``unrated`` is the web `'—'` sentinel — the empty readout for a null / non-finite
/// score, never a blank box.
public enum ScoreBadgeGrade: String, Sendable, Equatable, CaseIterable {
    case aPlus
    case aGrade = "a"
    case bGrade = "b"
    case cGrade = "c"
    case dGrade = "d"
    case fGrade = "f"
    case unrated

    /// The i18n key for the grade glyph (the web `ScoreGradeInfo.label`, lifted into a key for native
    /// parity), namespaced by the clean scale id (`score.grade.a.label`, …).
    public var labelKey: String {
        "score.grade.\(rawValue).label"
    }

    /// The web grade glyph, used as the i18n fallback: A+ / A / B / C / D / F / —.
    public var labelFallback: String {
        switch self {
        case .aPlus: "A+"
        case .aGrade: "A"
        case .bGrade: "B"
        case .cGrade: "C"
        case .dGrade: "D"
        case .fGrade: "F"
        case .unrated: "—"
        }
    }

    /// The localized grade glyph (web `info.label`), via the resolver.
    public func label(_ strings: ScoreBadgeResolve) -> String {
        strings(labelKey, labelFallback)
    }
}

// MARK: - Threshold scale (verbatim port of `scoreScale.ts` thresholds + `numericToGrade`)

/// One ordered 0–100 threshold — the native mirror of the web
/// `{ min: number; label: ScoreGrade }`. The lower bound is inclusive (web `score >= min`).
public struct ScoreBadgeThreshold: Sendable, Equatable {
    public let min: Double
    public let grade: ScoreBadgeGrade

    public init(min: Double, grade: ScoreBadgeGrade) {
        self.min = min
        self.grade = grade
    }
}

/// The grade scale — the verbatim port of the web `DEFAULT_SCORE_THRESHOLDS` plus the `numericToGrade`
/// mapping. A caller can override `thresholds` (Wh/km efficiency, latency ms, anything ordered), just
/// like the web badge's `thresholds` prop.
public enum ScoreBadgeScale {
    /// The default 0–100 thresholds (lower bound inclusive) — the verbatim port of the web
    /// `DEFAULT_SCORE_THRESHOLDS`: A+ ≥ 90, A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, F ≥ 0.
    public static let defaultThresholds: [ScoreBadgeThreshold] = [
        ScoreBadgeThreshold(min: 90, grade: .aPlus),
        ScoreBadgeThreshold(min: 80, grade: .aGrade),
        ScoreBadgeThreshold(min: 65, grade: .bGrade),
        ScoreBadgeThreshold(min: 50, grade: .cGrade),
        ScoreBadgeThreshold(min: 35, grade: .dGrade),
        ScoreBadgeThreshold(min: 0, grade: .fGrade)
    ]

    /// Maps a numeric score to a grade — the verbatim port of the web `numericToGrade`:
    /// a `nil` / non-finite score folds to ``ScoreBadgeGrade/unrated`` (the web `'—'`); otherwise the
    /// thresholds are evaluated highest-first so the first `score >= min` match wins; a score below
    /// every threshold falls through to ``ScoreBadgeGrade/fGrade`` (the web `'F'` floor).
    public static func grade(
        for score: Double?,
        thresholds: [ScoreBadgeThreshold] = defaultThresholds
    ) -> ScoreBadgeGrade {
        guard let score, score.isFinite else { return .unrated }
        for threshold in thresholds.sorted(by: { $0.min > $1.min }) where score >= threshold.min {
            return threshold.grade
        }
        return .fGrade
    }
}

// MARK: - Display size (verbatim port of the web `SIZE_CLASS`)

/// The badge display size — the native mirror of the web `ScoreBadgeSize` (`'sm' | 'md' | 'lg'`).
/// `sm` is the inline ~12pt glyph, `md` (default) the ~20pt list-row glyph, `lg` the ~30pt
/// section-header glyph (the web `text-xs` / `text-xl` / `text-3xl`).
public enum ScoreBadgeSize: String, Sendable, Equatable, CaseIterable {
    case small = "sm"
    case medium = "md"
    case large = "lg"

    /// The point size for the grade glyph — the native port of the web `SIZE_CLASS`
    /// (text-xs ≈ 12, text-xl ≈ 20, text-3xl ≈ 30).
    public var pointSize: CGFloat {
        switch self {
        case .small: 12
        case .medium: 20
        case .large: 30
        }
    }

    /// The redacted-skeleton footprint for the loading state, sized to the glyph so the layout does
    /// not jump when the readout lands.
    public var skeletonSize: CGSize {
        switch self {
        case .small: CGSize(width: 18, height: 12)
        case .medium: CGSize(width: 26, height: 20)
        case .large: CGSize(width: 38, height: 30)
        }
    }
}

// MARK: - Fetch lifecycle (P4 leaf contract around the web presentational badge)

/// The resolution state of the feed backing the badge — the native shape of the host's fetch
/// lifecycle around the web `score` / `grade` props. `loading` shows the neutral skeleton, `failed`
/// shows the retry chip, and `resolved` renders the grade (a resolved but null score is the
/// ``ScoreBadgeGrade/unrated`` "—" readout, never a blank box).
public enum ScoreBadgeFetchStatus: String, Sendable, Equatable, CaseIterable {
    case loading
    case resolved
    case failed
}

// MARK: - Aria label (verbatim port of the web `t('score.aria', 'Score {{grade}}', { grade })`)

/// The aria-label composer — the verbatim port of the web
/// `ariaLabel ?? t('score.aria', 'Score {{grade}}', { grade: info.label })`. The i18next `{{grade}}`
/// interpolation becomes a `%@` token so the build is locale- and width-safe; the grade glyph is
/// already localized before it is inserted.
public enum ScoreBadgeAriaBuilder {
    public static func label(
        gradeLabel: String,
        override: String?,
        strings: ScoreBadgeResolve
    ) -> String {
        if let override, !override.isEmpty { return override }
        return String(format: strings("score.aria", "Score %@"), gradeLabel)
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum ScoreBadgeMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ScoreBadge"
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver string from already-localized parts, so the spoken content is
/// asserted without rendering the view. The badge voices its aria label (the web `aria-label`,
/// "Score B"), suffixed with the stale and/or offline notes when those P4 leaf decorations apply so a
/// non-sighted user learns the score may be out of date or is the last-known cached value.
public enum ScoreBadgeAccessibility {
    public static func label(base: String, staleNote: String?, offlineNote: String?) -> String {
        var parts = [base]
        if let staleNote, !staleNote.isEmpty { parts.append(staleNote) }
        if let offlineNote, !offlineNote.isEmpty { parts.append(offlineNote) }
        return parts.joined(separator: ", ")
    }
}
