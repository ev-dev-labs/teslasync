//
//  PullToRefresh.Projection.swift
//  TeslaSync — P4 shared surface · 0188 · PullToRefresh (Apple)
//
//  The pure projection from the pull distance + threshold + refreshing flag to the on-screen geometry —
//  the native port of the web `onTouchMove` resistance math and the render computations:
//
//      const resisted = delta < threshold ? delta : threshold + (delta - threshold) * 0.5;
//      const clamped  = Math.min(resisted, MAX_PULL);
//      const progress = refreshing ? 1 : Math.min(pull / threshold, 1);
//      const ready    = pull >= threshold;
//      const indicatorHeight = refreshing ? threshold * 0.6 : pull;
//      opacity: Math.max(0.4, progress)   transform: scale(0.8 + progress * 0.2)
//      icon rotate: refreshing ? spin : progress * 270deg
//
//  The view is a pure function of these values; every branch is unit tested. Keeping the resistance,
//  the clamp, and the render coefficients here (rather than in the view) lets the rendered geometry at
//  any pull distance be asserted deterministically — how the per-state "snapshot" coverage is expressed
//  without a pixel snapshot harness.
//

import Foundation

// MARK: - Projection (resistance + clamp + render geometry)

/// Pure projection: the rubber-band resistance, the `MAX_PULL` clamp, the release predicate, and the
/// indicator geometry (height, progress, opacity, scale, icon rotation) at any pull distance. No
/// SwiftUI, no mutable state.
public enum PullToRefreshProjection {
    // MARK: Gesture math (web `onTouchMove`)

    /// The resisted travel for a raw downward `delta` — 1:1 up to the threshold, then half-speed past
    /// it (web `delta < threshold ? delta : threshold + (delta - threshold) * 0.5`).
    public static func resisted(delta: Double, threshold: Double) -> Double {
        delta < threshold
            ? delta
            : threshold + (delta - threshold) * PullToRefreshMeta.resistanceFactor
    }

    /// The pull distance for a raw downward `delta` — the resisted travel clamped to `MAX_PULL`. A
    /// non-positive delta means the finger moved up (or back to the origin): no pull (web `delta <= 0`
    /// resets the pull to zero).
    public static func pull(forDelta delta: Double, threshold: Double) -> Double {
        guard delta > 0 else { return 0 }
        return min(resisted(delta: delta, threshold: threshold), PullToRefreshMeta.maxPull)
    }

    /// Whether a release at this pull distance fires `onRefresh` — the web release predicate
    /// (`wasArmed && distance >= threshold`); the `armed` flag is tracked by the model.
    public static func shouldFire(pull: Double, threshold: Double, armed: Bool) -> Bool {
        armed && pull >= threshold
    }

    // MARK: Render geometry (web JSX)

    /// The pull progress 0…1 — `1` while refreshing, otherwise `min(pull / threshold, 1)` (web
    /// `progress`). The threshold is guarded positive by the caller's `effectiveThreshold`.
    public static func progress(pull: Double, threshold: Double, refreshing: Bool) -> Double {
        if refreshing { return 1 }
        let denominator = threshold > 0 ? threshold : PullToRefreshMeta.defaultThreshold
        return min(max(0, pull) / denominator, 1)
    }

    /// Whether the pull has reached the release threshold (web `ready = pull >= threshold`).
    public static func isReady(pull: Double, threshold: Double) -> Bool {
        pull >= threshold
    }

    /// The indicator band height (and the content's downward offset) — a fixed `threshold * 0.6` while
    /// refreshing, otherwise the live pull (web `indicatorHeight` / the content `translate3d` Y).
    public static func indicatorHeight(pull: Double, threshold: Double, refreshing: Bool) -> Double {
        refreshing ? threshold * PullToRefreshMeta.refreshingHeightFactor : max(0, pull)
    }

    /// The content's downward offset — identical to the indicator band height (web ties them to the
    /// same value), surfaced separately so the call sites read intentionally.
    public static func contentOffset(pull: Double, threshold: Double, refreshing: Bool) -> Double {
        indicatorHeight(pull: pull, threshold: threshold, refreshing: refreshing)
    }

    /// The indicator opacity — never below the `0.4` floor while visible (web `max(0.4, progress)`).
    public static func indicatorOpacity(progress: Double) -> Double {
        max(PullToRefreshMeta.minIndicatorOpacity, min(1, progress))
    }

    /// The indicator scale — `0.8 + progress * 0.2` (web `scale(...)`).
    public static func indicatorScale(progress: Double) -> Double {
        PullToRefreshMeta.indicatorBaseScale + min(1, max(0, progress)) * PullToRefreshMeta.indicatorScaleRange
    }

    /// The static icon rotation in degrees while pulling — `progress * 270°` (web rotates the glyph as
    /// a wind-up affordance). Returns `0` while refreshing, where the view shows an indeterminate
    /// spinner (or a still glyph under Reduce Motion) instead of a fixed angle.
    public static func iconRotationDegrees(progress: Double, refreshing: Bool) -> Double {
        refreshing ? 0 : min(1, max(0, progress)) * PullToRefreshMeta.maxIconRotationDegrees
    }

    // MARK: Phase + copy

    /// The resolved render phase for a pull distance — the native parity of the web JSX branch order
    /// (inactive pass-through → refreshing → idle → ready → pulling).
    public static func phase(
        pull: Double,
        threshold: Double,
        refreshing: Bool,
        active: Bool
    ) -> PullToRefreshPhase {
        guard active else { return .inactive }
        if refreshing { return .refreshing }
        if pull <= 0 { return .idle }
        return isReady(pull: pull, threshold: threshold) ? .ready : .pulling
    }

    /// The i18n key for a phase's indicator label — the web ternary
    /// (`refreshing ? refreshing : ready ? release : pull`). The non-indicator phases fall back to the
    /// neutral "pull" copy so a caller asking off-state still gets valid text.
    public static func labelKey(for phase: PullToRefreshPhase) -> String {
        switch phase {
        case .refreshing: PullToRefreshStringKey.refreshing
        case .ready: PullToRefreshStringKey.release
        case .pulling, .idle, .inactive: PullToRefreshStringKey.pull
        }
    }
}
