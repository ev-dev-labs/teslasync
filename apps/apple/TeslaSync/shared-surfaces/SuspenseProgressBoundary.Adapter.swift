//
//  SuspenseProgressBoundary.Adapter.swift
//  TeslaSync — P4 shared surface · 0141 · SuspenseProgressBoundary (Apple)
//
//  The testable, dependency-light core for the suspense → progress bridge — the SwiftUI parity of
//  `components/feedback/SuspenseProgressBoundary.tsx` together with the `@/lib/globalProgress`
//  controller it drives and the `components/feedback/TopProgress.tsx` bar that observes it. Everything
//  here is pure (Foundation only): the surface metadata (the diagnostics slug + the verbatim
//  `globalProgress` trickle constants) and the accessibility value helper. No store and no rendered
//  view, so each piece is unit tested in isolation.
//
//  Parity note — states. The web source is behavioural, not data-bound: it wraps `<Suspense>` so that
//  while the fallback is mounted (a lazy route chunk is downloading) the global progress controller is
//  active, and once the real children render the controller deactivates. Its genuine render branches
//  are therefore exactly two — the mounted fallback (loading) and the resolved children (content) —
//  reproduced one-for-one by `SuspensePhase`. It reads no query, so it has no empty / error / stale /
//  offline branch to mirror; synthesising such chrome would invent state the web source does not have
//  (the same honest disposition as the 0099 ProgressRing and 0075 AnimatedNumber surfaces). The bar's
//  asymptotic trickle is the surface's only computed output, and it is modelled deterministically by the
//  pure reducer in SuspenseProgressBoundary.Projection.swift.
//
//  Parity note — i18n. The boundary itself renders no translatable copy (it is anonymous — it only
//  swaps children for a fallback). The one locale-sensitive string belongs to the bar it drives: the
//  web `TopProgress` reads `t('global.loading', 'Loading')` for its `aria-label`. That key is mirrored
//  in SuspenseProgressBoundary.strings and resolved through the P1/S10 facade; the Swift sources hold no
//  English literals.
//

import Foundation

// MARK: - Surface metadata (diagnostics slug + globalProgress constants)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened` and the
/// verbatim port of the web `globalProgress` trickle constants (`TRICKLE_TARGET = 80`,
/// `TRICKLE_INITIAL = 8`, `TRICKLE_INTERVAL_MS = 120`) plus the per-tick advance shape
/// (`progress + max(1, remaining * 0.15)`).
public enum SuspenseProgressBoundaryMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SuspenseProgressBoundary"

    /// The P1/S10 i18n key for the progress bar's VoiceOver label — mirrored verbatim from the web
    /// `TopProgress` (`t('global.loading', 'Loading')`) and reserved in SuspenseProgressBoundary.strings.
    public static let loadingLabelKey = "global.loading"

    /// Web `TRICKLE_TARGET = 80` — the asymptotic ceiling the trickle approaches but never reaches
    /// without an explicit stop.
    public static let trickleTarget: Double = 80

    /// Web `TRICKLE_INITIAL = 8` — the initial jump on the first `start` so the bar is immediately
    /// visible.
    public static let trickleInitial: Double = 8

    /// Web `TRICKLE_INTERVAL_MS = 120` — the tick interval driving the asymptotic trickle.
    public static let trickleIntervalMs: Int = 120

    /// Web `remaining * 0.15` — the fraction of the remaining gap closed each tick.
    public static let trickleStepFraction: Double = 0.15

    /// Web `Math.max(1, …)` — the minimum forward motion each tick, so the bar always advances.
    public static let trickleMinStep: Double = 1

    /// The bar's whole-percent accessibility value — the parity of the web
    /// `Math.round(Math.max(0, Math.min(100, progress)))` used for `aria-valuenow`.
    public static func valueNow(_ progress: Double) -> Int {
        guard progress.isFinite else { return 0 }
        let clamped = Swift.min(100, Swift.max(0, progress))
        return Int(clamped.rounded())
    }
}

// MARK: - Phase (web Suspense fallback / resolved)

/// The two genuine render branches of the web boundary: `loading` while the fallback is mounted (a lazy
/// chunk is downloading, the progress controller is active) and `resolved` once the real children
/// render (the controller deactivates). Drives the container's swap and the once-only progress bridge.
public enum SuspensePhase: Sendable, Equatable {
    case loading
    case resolved

    /// Resolves the phase from the host's readiness flag — the parity of `<Suspense>` having resolved
    /// its lazy boundary (`true`) or still showing its fallback (`false`).
    public init(isReady: Bool) {
        self = isReady ? .resolved : .loading
    }

    /// `true` while the fallback is mounted — the window during which the progress controller is held
    /// active, exactly as the web `ProgressTrackingFallback` holds `globalProgress.start()` open.
    public var isLoading: Bool {
        self == .loading
    }
}
