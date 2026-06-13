//
//  TourOverlay.Adapter.swift
//  TeslaSync — P4 shared surface · 0145 · TourOverlay (Apple)
//
//  The testable, dependency-light core for the guided-tour spotlight overlay — the SwiftUI parity of
//  `components/feedback/TourOverlay.tsx`. Everything here is pure (Foundation + CoreGraphics only): the
//  step / target-rect / placement value types (web `TourStep` + `DOMRect`), the spotlight geometry (web
//  `spotlight` with its 6pt cutout pad), the faithful port of the web `getTooltipPosition` (the gap /
//  pad / bottom-nav clamps for all four placements), the progress-dot model, the navigation model (the
//  web back / skip / next-or-finish shapes), the step counter, the render-phase projection, and the
//  VoiceOver dialog-label builder. No store, no bundle, no rendered view, so each derivation is unit
//  tested in isolation (TourOverlay.AdapterTests.swift).
//
//  Parity note: the web `TourOverlay` is a presentational overlay fed by `useTour` — it renders a dark
//  scrim with a transparent spotlight cut around `targetRect`, an accent border-glow, and a tooltip
//  card anchored by `getTooltipPosition(step.placement, rect)`; `if (!targetRect) return null`. This
//  core reproduces every pure derivation as values + functions; the SwiftUI chrome (the cutout mask,
//  the border glow, the tooltip, the leaf states) layers on top in the sibling view files. The web's
//  single null-return is widened into the prompt-required loading / empty / error envelopes plus the
//  orthogonal stale / offline freshness axis, so the surface never renders a blank box.
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so the
/// projection's unit tests can reach it.
public enum TourOverlaySurface {
    public static let slug = "TourOverlay"
}

// MARK: - Load status / freshness / render phase

/// The bound source's load status for the active tour step + its anchor rect. The web reads the live
/// `useTour` state synchronously; the native surface models the load lifecycle here so every state
/// renders rather than collapsing to `null`.
public enum TourOverlayLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-state freshness (ADR-013): drives the freshness chip so a cached tour position is clearly
/// labeled while the layout / element geometry is syncing or offline.
public enum TourOverlayConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render at the top level. The web only ever renders the spotlight or `null`;
/// the loading + empty + error envelopes are added so the first-resolve, no-anchor, and failure cases
/// never render a blank box.
public enum TourOverlayPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case data
}

// MARK: - Placement (web `TourStep.placement`)

/// Where the tooltip sits relative to the highlighted element — the native parity of the web
/// `placement: 'top' | 'bottom' | 'left' | 'right'`.
public enum TourOverlayPlacement: String, Sendable, Equatable, CaseIterable {
    case top
    case bottom
    case left
    case right
}

// MARK: - Step (web `TourStep` subset the overlay renders)

/// One tour step as the overlay consumes it — the native mirror of the subset of the web `TourStep` the
/// overlay renders (`target` as identity, `title`, `description`, `placement`). The web `onShow` /
/// `onHide` side-effects are owned by the tour engine, not the overlay, so they are intentionally
/// omitted. `title` / `description` are already-resolved display strings (the web tour definitions hold
/// literals, not i18n keys), rendered verbatim.
public struct TourOverlayStep: Sendable, Equatable, Identifiable {
    /// The web `step.target` CSS selector — the stable identity of the step.
    public let id: String
    public let title: String
    /// Web `step.description` — held as `detail` so it never shadows `CustomStringConvertible`.
    public let detail: String
    public let placement: TourOverlayPlacement

    public init(id: String, title: String, detail: String, placement: TourOverlayPlacement) {
        self.id = id
        self.title = title
        self.detail = detail
        self.placement = placement
    }
}

// MARK: - Target rect (web `DOMRect`)

/// The highlighted element's frame in the overlay's coordinate space — the native mirror of the web
/// `targetRect: DOMRect`. `x` / `y` are the web `left` / `top`; `right` / `bottom` are derived exactly
/// as the DOM does, so the spotlight geometry + tooltip positioner read the same anchors the web does.
public struct TourOverlayTargetRect: Sendable, Equatable {
    public let x: CGFloat
    public let y: CGFloat
    public let width: CGFloat
    public let height: CGFloat

    public init(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    /// Web `rect.left`.
    public var left: CGFloat {
        x
    }

    /// Web `rect.top`.
    public var top: CGFloat {
        y
    }

    /// Web `rect.right`.
    public var right: CGFloat {
        x + width
    }

    /// Web `rect.bottom`.
    public var bottom: CGFloat {
        y + height
    }
}

// MARK: - Viewport (web `window.innerWidth/Height`)

/// The overlay's container size — the native parity of the web `window.innerWidth` / `innerHeight` the
/// positioner clamps against.
public struct TourOverlayViewport: Sendable, Equatable {
    public let width: CGFloat
    public let height: CGFloat

    public init(width: CGFloat, height: CGFloat) {
        self.width = width
        self.height = height
    }
}

// MARK: - Spotlight geometry (web `spotlight`)

/// The dimmed-overlay cutout frame — the native mirror of the web `spotlight` rect (the target rect
/// grown by `spotlightPadding` on every edge).
public struct TourOverlaySpotlight: Sendable, Equatable {
    public let x: CGFloat
    public let y: CGFloat
    public let width: CGFloat
    public let height: CGFloat

    public init(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    /// The cutout as a `CGRect`, for the SwiftUI mask + the border-glow frame.
    public var rect: CGRect {
        CGRect(x: x, y: y, width: width, height: height)
    }
}

/// Builds the spotlight cutout — the verbatim port of the web `spotlight`:
/// `{ top: top - pad, left: left - pad, width: width + pad*2, height: height + pad*2 }`.
public enum TourOverlaySpotlightGeometry {
    /// Web `const spotlightPadding = 6`.
    public static let padding: CGFloat = 6

    public static func frame(
        for rect: TourOverlayTargetRect,
        padding: CGFloat = padding
    ) -> TourOverlaySpotlight {
        TourOverlaySpotlight(
            x: rect.left - padding,
            y: rect.top - padding,
            width: rect.width + padding * 2,
            height: rect.height + padding * 2
        )
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

/// The dependency-free render-phase resolver shared by the model + the views. The web renders the
/// spotlight when a `targetRect` is present and `null` otherwise; this widens that into the
/// prompt-required envelopes: an in-flight resolve with no anchor is `loading`; a resolved tour with no
/// anchor (web `null`) is the friendly `empty`; a failure with no cached anchor is `error`; a present
/// anchor (even behind a transient refresh failure) keeps rendering the `data` spotlight.
public enum TourOverlayProjection {
    /// `hasAnchor` is the native `targetRect != nil && step != nil` — the web `if (!targetRect)` guard.
    public static func resolve(status: TourOverlayLoadStatus, hasAnchor: Bool) -> TourOverlayPhase {
        switch status {
        case .loading:
            hasAnchor ? .data : .loading
        case .loaded:
            hasAnchor ? .data : .empty
        case .empty:
            .empty
        case let .failed(message):
            hasAnchor ? .data : .error(message)
        }
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the overlay's VoiceOver / `aria-label` strings from already-localised templates, so the
/// spoken content is asserted without rendering.
public enum TourOverlayAccessibility {
    /// The tooltip dialog label — the port of
    /// `t('tour.dialogLabel', 'Tour step {{current}} of {{total}}', { current: currentStep + 1, total })`.
    public static func dialogLabel(
        currentStep: Int,
        totalSteps: Int,
        localize: (String, String) -> String
    ) -> String {
        let template = localize("tour.dialogLabel", "Tour step {{current}} of {{total}}")
        return template
            .replacingOccurrences(of: "{{current}}", with: "\(currentStep + 1)")
            .replacingOccurrences(of: "{{total}}", with: "\(totalSteps)")
    }
}
