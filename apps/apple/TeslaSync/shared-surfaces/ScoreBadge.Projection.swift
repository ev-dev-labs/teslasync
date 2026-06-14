//
//  ScoreBadge.Projection.swift
//  TeslaSync — P4 shared surface · 0103 · ScoreBadge (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state — the native port of the
//  web render (a colored, bold letter chosen from `score` + `thresholds` or a pre-computed `grade`)
//  wrapped in the P4 leaf contract (loading / unavailable chrome around the resolved badge, plus the
//  stale + offline decorations). The view is a pure function of this value; every branch is unit tested.
//

import Foundation

// MARK: - Badge value (web `score` + `thresholds` | `grade` discriminated props)

/// The grade-determining input — the native mirror of the web badge's mutually-exclusive prop styles:
/// a numeric `score` mapped through `thresholds` (the `<ScoreBadge score={87} />` /
/// `<ScoreBadge score={150} thresholds={…} />` forms), or a pre-computed `grade`
/// (`<ScoreBadge grade="B" />`). A null score resolves to the ``ScoreBadgeGrade/unrated`` "—" readout.
public enum ScoreBadgeValue: Sendable, Equatable {
    case score(Double?, thresholds: [ScoreBadgeThreshold])
    case grade(ScoreBadgeGrade)

    /// The `<ScoreBadge score={…} />` form with the default 0–100 scale.
    public static func score(_ value: Double?) -> ScoreBadgeValue {
        .score(value, thresholds: ScoreBadgeScale.defaultThresholds)
    }

    /// Resolves the value to a grade — `.grade` passes through; `.score` runs the verbatim
    /// `numericToGrade` port (the web `'grade' in props ? gradeInfo(grade) : numericToGrade(score)`).
    public func resolvedGrade() -> ScoreBadgeGrade {
        switch self {
        case let .grade(grade):
            grade
        case let .score(value, thresholds):
            ScoreBadgeScale.grade(for: value, thresholds: thresholds)
        }
    }
}

// MARK: - Source inputs (P1/S8 — the feed + its fetch lifecycle)

/// One coalesced snapshot of the surface's inputs — the fetch lifecycle state, the grade-determining
/// value (the web `score`/`grade` props), and the P4 leaf connectivity + freshness bits. The view binds
/// the model over this; the resolved readout is a pure function of it plus the static config.
public struct ScoreBadgeInput: Sendable, Equatable {
    public var status: ScoreBadgeFetchStatus
    public var value: ScoreBadgeValue
    public var stale: Bool
    public var offline: Bool

    public init(
        status: ScoreBadgeFetchStatus = .loading,
        value: ScoreBadgeValue = .score(nil),
        stale: Bool = false,
        offline: Bool = false
    ) {
        self.status = status
        self.value = value
        self.stale = stale
        self.offline = offline
    }
}

// MARK: - Static configuration (web non-data props)

/// The static presentation config — the web props that are not data. `size` is the web `size` prop
/// (the `SIZE_CLASS` scale); `ariaLabelOverride` is the web `ariaLabel` prop (replaces the
/// auto-generated label). The web `className` / `testId` are DOM-only and have no native counterpart.
public struct ScoreBadgeConfig: Sendable, Equatable {
    public var size: ScoreBadgeSize
    public var ariaLabelOverride: String?

    public init(size: ScoreBadgeSize = .medium, ariaLabelOverride: String? = nil) {
        self.size = size
        self.ariaLabelOverride = ariaLabelOverride
    }

    public static let `default` = ScoreBadgeConfig()
}

// MARK: - Resolved view-state (web render output + P4 leaf contract)

/// The resolved badge readout — the grade, its localized glyph, the display size, and the composed
/// aria label (web `aria-label`). Everything the glyph needs to render with no further string work.
public struct ScoreBadgeReadout: Sendable, Equatable {
    public let grade: ScoreBadgeGrade
    public let label: String
    public let size: ScoreBadgeSize
    public let accessibilityLabel: String

    public init(
        grade: ScoreBadgeGrade,
        label: String,
        size: ScoreBadgeSize,
        accessibilityLabel: String
    ) {
        self.grade = grade
        self.label = label
        self.size = size
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The resolved, view-ready state — `phase` selects the rendered body while `stale` / `offline`
/// decorate the ready badge (the cached value stays visible).
public struct ScoreBadgeResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Feed still resolving (web parent has no value yet) → neutral skeleton.
        case loading
        /// Feed failed → a neutral retry chip (the `QueryError` peer).
        case unavailable
        /// Feed resolved → the colored grade glyph (the ``ScoreBadgeGrade/unrated`` "—" is the empty
        /// readout).
        case ready(ScoreBadgeReadout)
    }

    public let phase: Phase
    public let stale: Bool
    public let offline: Bool

    public init(phase: Phase, stale: Bool, offline: Bool) {
        self.phase = phase
        self.stale = stale
        self.offline = offline
    }

    /// The resolved grade when presenting a readout, else `nil` — a convenience the model uses and the
    /// tests assert.
    public var readyGrade: ScoreBadgeGrade? {
        if case let .ready(readout) = phase { return readout.grade }
        return nil
    }
}

// MARK: - Projection (input + config + strings → resolved)

/// Pure projection from the input snapshot to the resolved view-state. The fetch status decides the
/// phase; when resolved, the value decides the grade (the verbatim web `numericToGrade` / `gradeInfo`
/// split), the grade decides the localized glyph, and the glyph composes the aria label (the web
/// `t('score.aria', …)`). The stale + offline bits ride through unchanged for the ready decoration.
public enum ScoreBadgeProjection {
    public static func resolve(
        _ input: ScoreBadgeInput,
        config: ScoreBadgeConfig,
        strings: ScoreBadgeResolve
    ) -> ScoreBadgeResolved {
        let phase: ScoreBadgeResolved.Phase = switch input.status {
        case .loading:
            .loading
        case .failed:
            .unavailable
        case .resolved:
            .ready(readout(for: input, config: config, strings: strings))
        }
        return ScoreBadgeResolved(phase: phase, stale: input.stale, offline: input.offline)
    }

    private static func readout(
        for input: ScoreBadgeInput,
        config: ScoreBadgeConfig,
        strings: ScoreBadgeResolve
    ) -> ScoreBadgeReadout {
        let grade = input.value.resolvedGrade()
        let label = grade.label(strings)
        let aria = ScoreBadgeAriaBuilder.label(
            gradeLabel: label,
            override: config.ariaLabelOverride,
            strings: strings
        )
        return ScoreBadgeReadout(
            grade: grade,
            label: label,
            size: config.size,
            accessibilityLabel: aria
        )
    }
}
