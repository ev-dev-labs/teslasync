//
//  PullToRefresh.Adapter.swift
//  TeslaSync — P4 shared surface · 0188 · PullToRefresh (Apple)
//
//  The testable, dependency-light core for the pull-to-refresh wrapper — the SwiftUI parity of
//  `components/mobile/PullToRefresh.tsx`. Everything here is pure (Foundation only): the surface
//  metadata (the diagnostics slug + the verbatim web constants), the pointer-capability axis (the
//  native shape of the web `useIsCoarsePointer()` gate), the render-phase enum, the coalesced input
//  snapshot (the web props), the i18n key constants the web `t(...)` calls reference, and the
//  VoiceOver label builder. No store, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note — states. The web source is a presentational gesture wrapper: it reads three hooks
//  (`useIsCoarsePointer`, `useMotionPreference`, `useTranslation`) and renders `children` with a pull
//  indicator on top. It performs no fetch and has no loading / error / empty / stale / offline branch
//  to mirror; synthesising such chrome would invent state the web source does not have (the same
//  disposition as the 0075 AnimatedNumber / 0053 AIThinkingIndicator surfaces). The genuine render
//  branches this core models are exactly the ones the web has: `inactive` (the desktop / fine-pointer
//  pass-through where the web returns `children` straight), `idle` (no pull), `pulling` (below the
//  threshold), `ready` (past the threshold — "release to refresh"), and `refreshing` (the awaited
//  `onRefresh`).
//

import Foundation

// MARK: - Surface metadata (diagnostics slug + verbatim web constants)

/// The static identity + tuning of the surface — the P1/S11 diagnostics slug emitted with
/// `view.opened`, plus the verbatim web constants (`DEFAULT_THRESHOLD = 80`, `MAX_PULL = 140`) and the
/// render coefficients read out of the web JSX (`indicatorHeight = threshold * 0.6` while refreshing,
/// the `0.5` rubber-band resistance past the threshold, the `8 px` move guard, the `progress * 270°`
/// icon sweep, the `max(0.4, progress)` opacity floor, and the `0.8 + progress * 0.2` scale ramp).
public enum PullToRefreshMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "PullToRefresh"

    /// Web `DEFAULT_THRESHOLD = 80` — pixels pulled before a release fires `onRefresh`.
    public static let defaultThreshold: Double = 80

    /// Web `MAX_PULL = 140` — the visual ceiling past which the pull resists (rubber band).
    public static let maxPull: Double = 140

    /// Web rubber-band factor: past the threshold only half of the extra travel counts.
    public static let resistanceFactor: Double = 0.5

    /// Web move guard: a drag must exceed this many points before it claims the gesture (the parity of
    /// the `delta > 8` `preventDefault()` guard that stops the scroll view fighting the pull).
    public static let moveGuard: Double = 8

    /// Web `indicatorHeight = threshold * 0.6` (and the content offset) while refreshing.
    public static let refreshingHeightFactor: Double = 0.6

    /// Web icon sweep: the indicator glyph rotates up to `progress * 270°` while pulling.
    public static let maxIconRotationDegrees: Double = 270

    /// Web `opacity: Math.max(0.4, progress)` — the indicator never fully fades while visible.
    public static let minIndicatorOpacity: Double = 0.4

    /// Web `transform: scale(0.8 + progress * 0.2)` — the indicator base scale.
    public static let indicatorBaseScale: Double = 0.8

    /// Web indicator scale ramp added across the pull (`+ progress * 0.2`).
    public static let indicatorScaleRange: Double = 0.2
}

// MARK: - i18n keys (web `t(key, fallback)`)

/// The message keys the web source references, plus the native-only accessibility copy. Every visible
/// string resolves through these keys via the P1/S10 facade (`PullToRefreshStrings`), so the Swift
/// sources hold no English literals. The first three mirror `components/mobile/PullToRefresh.tsx`
/// one-for-one; the `action` / `hint` keys are the native VoiceOver affordance (the web pull gesture
/// has no keyboard / assistive equivalent, so the native port adds an explicit "Refresh" action).
public enum PullToRefreshStringKey {
    /// Web `t('mobile.refresh.pull', 'Pull to refresh')`.
    public static let pull = "mobile.refresh.pull"
    /// Web `t('mobile.refresh.release', 'Release to refresh')`.
    public static let release = "mobile.refresh.release"
    /// Web `t('mobile.refresh.refreshing', 'Refreshing…')`.
    public static let refreshing = "mobile.refresh.refreshing"
    /// Native VoiceOver action name that triggers a refresh without the drag gesture.
    public static let action = "mobile.refresh.action"
    /// Native VoiceOver hint describing the pull affordance.
    public static let hint = "mobile.refresh.hint"

    /// The English fallback for a key — the verbatim web default copy (and the native a11y copy),
    /// passed as the `value:` of `NSLocalizedString` so the surface reads correctly before the catalog
    /// is localized.
    public static func fallback(for key: String) -> String {
        switch key {
        case pull: "Pull to refresh"
        case release: "Release to refresh"
        case refreshing: "Refreshing…"
        case action: "Refresh"
        case hint: "Pull down to refresh"
        default: key
        }
    }
}

/// The localization resolver shape — the native parity of the web `t(key, fallback)` call. Injected so
/// the projection / model can be unit tested with a deterministic stub. `@Sendable` so the shared
/// `PullToRefreshStrings.string` resolver is a concurrency-safe global under Swift 6 strict checking.
public typealias PullToRefreshResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Pointer capability (web `useIsCoarsePointer`)

/// The pointer-capability axis — the native shape of the web `matchMedia('(pointer: coarse)')` read
/// behind `useIsCoarsePointer()`. `coarse` (touch / pen — iPhone, iPad) opts the gesture in; `fine`
/// (an indirect pointer — the Mac) renders `children` straight through, matching the web's
/// `if (!active) return <>{children}</>` desktop pass-through.
public enum PullToRefreshPointer: Sendable, Equatable {
    case coarse
    case fine

    /// The platform's primary input. iOS / iPadOS are touch-first (`coarse`); macOS and Mac Catalyst
    /// drive with an indirect pointer (`fine`), where a pull-to-refresh gesture is non-idiomatic and
    /// the web component renders nothing of its own.
    public static var platformDefault: PullToRefreshPointer {
        #if os(macOS)
            .fine
        #elseif targetEnvironment(macCatalyst)
            .fine
        #else
            .coarse
        #endif
    }

    /// Whether this capability opts the gesture in (web `isCoarse`).
    public var isCoarse: Bool {
        self == .coarse
    }
}

// MARK: - Render phase (the genuine web render branches)

/// The genuine render branches the web source has (see the file-header parity note). `inactive` is the
/// desktop / fine-pointer pass-through; the remaining four are the gesture lifecycle the web JSX
/// renders (idle → pulling → ready → refreshing).
public enum PullToRefreshPhase: Sendable, Equatable {
    /// The gesture is disabled (web `!active`): `children` render straight through, no indicator.
    case inactive
    /// Active, but at rest — no pull in progress (web `pull === 0 && !refreshing`).
    case idle
    /// Pulling, but short of the threshold (web `pull > 0 && pull < threshold`).
    case pulling
    /// Pulled past the threshold — releasing now fires `onRefresh` (web `pull >= threshold`).
    case ready
    /// The awaited `onRefresh` is in flight (web `refreshing`).
    case refreshing

    /// Whether the pull indicator is on screen for this phase (web `pull > 0 || refreshing`).
    public var showsIndicator: Bool {
        switch self {
        case .pulling, .ready, .refreshing: true
        case .inactive, .idle: false
        }
    }
}

// MARK: - Input snapshot (web props)

/// One coalesced snapshot of the surface's inputs — the web props that survive into the gesture model.
/// `threshold` is the release distance (web default 80); `pointer` is the resolved capability; the
/// optional `enabled` override mirrors the web `enabled` prop (`active = enabled ?? isCoarse`).
/// Equatable so the view can react to prop changes.
public struct PullToRefreshInput: Sendable, Equatable {
    public var threshold: Double
    public var pointer: PullToRefreshPointer
    public var enabled: Bool?

    public init(
        threshold: Double = PullToRefreshMeta.defaultThreshold,
        pointer: PullToRefreshPointer = .platformDefault,
        enabled: Bool? = nil
    ) {
        self.threshold = threshold
        self.pointer = pointer
        self.enabled = enabled
    }

    /// The resolved gesture-enabled flag — the web `active = enabled ?? isCoarse`.
    public var isActive: Bool {
        enabled ?? pointer.isCoarse
    }

    /// The threshold guarded to a sane positive minimum so the progress denominator can never divide by
    /// zero (a caller passing `0` would make the web `pull / threshold` non-finite).
    public var effectiveThreshold: Double {
        threshold > 0 ? threshold : PullToRefreshMeta.defaultThreshold
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver strings from the resolved phase, so the spoken content is asserted
/// without rendering the view. The web indicator is `aria-hidden` while pulling and a polite
/// `role="status"` live region while refreshing; the native port voices the same status copy and adds
/// an explicit "Refresh" action label (the assistive affordance the web pull gesture lacks).
public enum PullToRefreshAccessibility {
    /// The spoken status for the indicator — the localized phase label (pull / release / refreshing).
    public static func statusLabel(
        for phase: PullToRefreshPhase,
        strings: PullToRefreshResolve
    ) -> String {
        let key = PullToRefreshProjection.labelKey(for: phase)
        return strings(key, PullToRefreshStringKey.fallback(for: key))
    }

    /// The localized VoiceOver action name that triggers a refresh without the drag gesture.
    public static func actionLabel(strings: PullToRefreshResolve) -> String {
        strings(PullToRefreshStringKey.action, PullToRefreshStringKey.fallback(for: PullToRefreshStringKey.action))
    }

    /// The localized VoiceOver hint describing the pull affordance.
    public static func hintLabel(strings: PullToRefreshResolve) -> String {
        strings(PullToRefreshStringKey.hint, PullToRefreshStringKey.fallback(for: PullToRefreshStringKey.hint))
    }
}
