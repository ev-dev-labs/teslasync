//
//  RouteTransition.Projection.swift
//  TeslaSync — P4 shared surface · 0192 · RouteTransition (Apple)
//
//  The pure projection from the navigation inputs (previous path, new path, reduced-motion flag, skip
//  patterns) to the resolved `RouteTransitionDecision` the view paints — the native port of the web
//  `RouteTransition.tsx` body:
//
//      const { reduce, durationMs } = useMotionPreference(120)
//      const matchesSkip = (p) => skipPattern.some(pat => matchPath({ path: pat, end: true }, p) != null)
//      const skipForList = matchesSkip(prevPath) || matchesSkip(newPath)
//      const effectiveDurationMs = reduce || skipForList ? 0 : durationMs
//
//  plus the `matchPath({ end: true })` route matcher the web `skipForList` check relies on. The decision
//  is a pure function of these values; every branch is unit tested. Keeping the matcher + the
//  reduce/skip resolution here (rather than in the view) lets the resolved outcome at any navigation be
//  asserted deterministically — how the per-state "snapshot" coverage is expressed without a pixel
//  snapshot harness.
//

import Foundation

// MARK: - Route matcher (web `matchPath({ path, end: true })`)

/// The native parity of react-router v6's `matchPath({ path, end: true }, pathname)` — the matcher the
/// web `skipForList` check uses to decide whether a navigation is a list ↔ detail drill. Pure, no
/// regex compilation: a pattern matches a path when, segment-for-segment, every `:param` segment lines
/// up with a present (non-empty) path segment and every literal segment compares equal. Matching is
/// case-insensitive and full (`end: true`) — the pattern must consume the whole path, so `/drives/:id`
/// matches `/drives/123` but never `/drives/123/replay` — and a trailing slash is tolerated, exactly as
/// react-router's default (`caseSensitive: false`) does.
public enum RouteMatcher {
    /// The non-empty path segments — splitting on `/` and dropping the empties absorbs the leading
    /// slash, a trailing slash, and any accidental double slashes (react-router normalizes the same way).
    public static func segments(_ path: String) -> [String] {
        path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    }

    /// Whether a single react-router pattern matches a path under `end: true` semantics.
    public static func matches(pattern: String, path: String) -> Bool {
        let patternSegments = segments(pattern)
        let pathSegments = segments(path)
        // `end: true` → the segment counts must line up exactly (no trailing path left over).
        guard patternSegments.count == pathSegments.count else { return false }
        for (patternSegment, pathSegment) in zip(patternSegments, pathSegments) {
            if patternSegment.hasPrefix(":") {
                // A dynamic `:param` matches any present segment; `segments` already dropped empties.
                guard !pathSegment.isEmpty else { return false }
            } else if patternSegment.caseInsensitiveCompare(pathSegment) != .orderedSame {
                return false
            }
        }
        return true
    }

    /// Whether any pattern in the set matches the path — the web `skipPattern.some(...)`.
    public static func matchesAny(_ patterns: [String], path: String) -> Bool {
        patterns.contains { matches(pattern: $0, path: path) }
    }
}

// MARK: - Projection (reduce / skip resolution → decision)

/// Pure projection: the web `skipForList` check and the `reduce || skipForList ? 0 : durationMs`
/// resolution, expressed as a single `RouteTransitionDecision`. No SwiftUI, no mutable state.
public enum RouteTransitionProjection {
    /// Whether a navigation is a list ↔ detail drill the fade should skip — the web
    /// `matchesSkip(prevPath) || matchesSkip(newPath)`. Firing on EITHER side means the drill-back-out
    /// (a POP from `/drives/123` to `/drives`) is skipped too, exactly as the web comment describes.
    public static func skipsForListDetail(
        previousPath: String,
        newPath: String,
        skipPatterns: [String]
    ) -> Bool {
        RouteMatcher.matchesAny(skipPatterns, path: previousPath)
            || RouteMatcher.matchesAny(skipPatterns, path: newPath)
    }

    /// The resolved decision for a navigation — the native parity of the web body. `previousPath == nil`
    /// is the first appearance (web `initial={false}`); an unchanged path is `stable` (the web key does
    /// not change); otherwise reduced motion wins first (the left operand of the web `reduce ||`), then a
    /// list ↔ detail drill, and only a plain page-to-page change cross-fades at the base duration.
    public static func decide(
        previousPath: String?,
        newPath: String,
        reduceMotion: Bool,
        skipPatterns: [String],
        baseDurationMs: Double
    ) -> RouteTransitionDecision {
        guard let previousPath else {
            return RouteTransitionDecision(phase: .initial, durationMs: 0)
        }
        guard previousPath != newPath else {
            return RouteTransitionDecision(phase: .stable, durationMs: 0)
        }
        if reduceMotion {
            return RouteTransitionDecision(phase: .suppressed(.reduceMotion), durationMs: 0)
        }
        if skipsForListDetail(previousPath: previousPath, newPath: newPath, skipPatterns: skipPatterns) {
            return RouteTransitionDecision(phase: .suppressed(.skipPattern), durationMs: 0)
        }
        return RouteTransitionDecision(phase: .animated, durationMs: baseDurationMs)
    }
}
