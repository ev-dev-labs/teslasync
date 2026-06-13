//
//  TourOverlay.Geometry.swift
//  TeslaSync — P4 shared surface · 0145 · TourOverlay (Apple)
//
//  The pure tour-overlay geometry + per-step derivations, split from `TourOverlay.Adapter.swift` for the
//  file-length budget: the faithful port of the web `getTooltipPosition` (the gap / pad / bottom-nav
//  clamps for all four placements + the anchors→origin resolution), the progress-dot row, the step
//  counter, and the navigation model (the web back / skip / next-or-finish shapes). Foundation +
//  CoreGraphics only, so every branch is unit tested in isolation (TourOverlay.AdapterTests.swift).
//

import CoreGraphics
import Foundation

// MARK: - Tooltip positioner (web `getTooltipPosition`)

/// The tooltip's resolved CSS-style anchors — the native shape of the web `getTooltipPosition` return
/// (`top` / `bottom` / `left` / `right` are unset when the web omits them) plus the computed `maxWidth`.
public struct TourOverlayTooltipLayout: Sendable, Equatable {
    public var top: CGFloat?
    public var bottom: CGFloat?
    public var left: CGFloat?
    public var right: CGFloat?
    public var maxWidth: CGFloat

    public init(
        top: CGFloat? = nil,
        bottom: CGFloat? = nil,
        left: CGFloat? = nil,
        right: CGFloat? = nil,
        maxWidth: CGFloat
    ) {
        self.top = top
        self.bottom = bottom
        self.left = left
        self.right = right
        self.maxWidth = maxWidth
    }
}

/// The faithful port of the web `getTooltipPosition` — the `gap` / `pad` / `bottomNav` constants, the
/// `clampLeft` / `clampTop` clamps, and the per-placement anchor selection. Kept pure so every branch +
/// clamp is asserted without a layout pass; the SwiftUI view resolves the anchors to a top-left origin
/// via `origin(layout:viewport:tooltipSize:)`.
public enum TourOverlayTooltipPositioner {
    /// Web `const gap = 16`.
    public static let gap: CGFloat = 16
    /// Web `const pad = 16`.
    public static let pad: CGFloat = 16
    /// Web `const bottomNav = 72` (the mobile bottom tab-bar height).
    public static let bottomNav: CGFloat = 72
    /// Web `Math.min(360, …)`.
    public static let maxTooltipWidth: CGFloat = 360
    /// Web `vh - bottomNav - 160` reserved space below the clamped top.
    public static let reservedBelow: CGFloat = 160

    /// Web `const maxW = Math.min(360, vw - pad * 2)`.
    public static func maxWidth(viewport: TourOverlayViewport) -> CGFloat {
        min(maxTooltipWidth, viewport.width - pad * 2)
    }

    /// Web `clampLeft = x => Math.max(pad, Math.min(x, vw - maxW - pad))`.
    static func clampLeft(_ value: CGFloat, viewport: TourOverlayViewport, maxW: CGFloat) -> CGFloat {
        max(pad, min(value, viewport.width - maxW - pad))
    }

    /// Web `clampTop = y => Math.max(pad, Math.min(y, vh - bottomNav - 160))`.
    static func clampTop(_ value: CGFloat, viewport: TourOverlayViewport) -> CGFloat {
        max(pad, min(value, viewport.height - bottomNav - reservedBelow))
    }

    /// The verbatim per-placement port of the web `switch (placement)`.
    public static func layout(
        placement: TourOverlayPlacement,
        rect: TourOverlayTargetRect,
        viewport: TourOverlayViewport
    ) -> TourOverlayTooltipLayout {
        let maxW = maxWidth(viewport: viewport)
        switch placement {
        case .bottom:
            return TourOverlayTooltipLayout(
                top: clampTop(rect.bottom + gap, viewport: viewport),
                left: clampLeft(rect.left, viewport: viewport, maxW: maxW),
                maxWidth: maxW
            )
        case .top:
            return TourOverlayTooltipLayout(
                bottom: max(pad + bottomNav, viewport.height - rect.top + gap),
                left: clampLeft(rect.left, viewport: viewport, maxW: maxW),
                maxWidth: maxW
            )
        case .right:
            return TourOverlayTooltipLayout(
                top: clampTop(rect.top, viewport: viewport),
                left: clampLeft(rect.right + gap, viewport: viewport, maxW: maxW),
                maxWidth: maxW
            )
        case .left:
            return TourOverlayTooltipLayout(
                top: clampTop(rect.top, viewport: viewport),
                right: max(pad, viewport.width - rect.left + gap),
                maxWidth: maxW
            )
        }
    }

    /// Resolves the CSS-style anchors to a concrete top-left origin for SwiftUI, given the measured
    /// tooltip size — the native equivalent of the browser resolving `top`/`left` vs `bottom`/`right`.
    /// A `right` anchor maps to `vw - right - width`; a `bottom` anchor maps to `vh - bottom - height`;
    /// an unset axis falls back to `pad` (the web never omits both axes, but the fallback keeps the
    /// tooltip on-screen).
    public static func origin(
        layout: TourOverlayTooltipLayout,
        viewport: TourOverlayViewport,
        tooltipSize: CGSize
    ) -> CGPoint {
        let originX: CGFloat = if let left = layout.left {
            left
        } else if let right = layout.right {
            viewport.width - right - tooltipSize.width
        } else {
            pad
        }

        let originY: CGFloat = if let top = layout.top {
            top
        } else if let bottom = layout.bottom {
            viewport.height - bottom - tooltipSize.height
        } else {
            pad
        }

        return CGPoint(x: originX, y: originY)
    }
}

// MARK: - Progress dots (web progress-dot row)

/// One progress dot's visual state — the native parity of the web dot classes: the current step is the
/// wide accent pill (`w-4 bg-primary`), the others are the narrow muted dots (`w-1.5`). `completed` and
/// `upcoming` render the same (the web does too) but are kept distinct so a test asserts the boundary.
public enum TourOverlayDotState: Sendable, Equatable {
    case completed
    case current
    case upcoming

    /// Web `i === currentStep` — the wide accent pill.
    public var isCurrent: Bool {
        self == .current
    }
}

/// One progress dot, keyed by index for `ForEach`.
public struct TourOverlayProgressDot: Sendable, Equatable, Identifiable {
    public let id: Int
    public let state: TourOverlayDotState

    public init(id: Int, state: TourOverlayDotState) {
        self.id = id
        self.state = state
    }
}

/// Builds the progress-dot row — the port of the web
/// `Array.from({ length: totalSteps }).map((_, i) => …)`.
public enum TourOverlayProgress {
    public static func dots(currentStep: Int, totalSteps: Int) -> [TourOverlayProgressDot] {
        guard totalSteps > 0 else { return [] }
        return (0 ..< totalSteps).map { index in
            let state: TourOverlayDotState = if index == currentStep {
                .current
            } else if index < currentStep {
                .completed
            } else {
                .upcoming
            }
            return TourOverlayProgressDot(id: index, state: state)
        }
    }
}

// MARK: - Step counter (web `{currentStep + 1} / {totalSteps}`)

/// The "n / total" counter — the verbatim port of the web `{currentStep + 1} / {totalSteps}`.
public enum TourOverlayStepCounter {
    public static func text(currentStep: Int, totalSteps: Int) -> String {
        "\(currentStep + 1) / \(totalSteps)"
    }
}

// MARK: - Navigation model (web back / skip / next-or-finish shapes)

/// The resolved navigation affordances for the current step — the native parity of the web nav row:
/// `showsBack` is `currentStep > 0`; `isLastStep` (the "Get Started!" finish) is
/// `currentStep === totalSteps - 1`; `showsNextArrow` (the trailing arrow on Next) is
/// `currentStep < totalSteps - 1`.
public struct TourOverlayNavModel: Sendable, Equatable {
    public let showsBack: Bool
    public let isLastStep: Bool
    public let showsNextArrow: Bool

    public init(showsBack: Bool, isLastStep: Bool, showsNextArrow: Bool) {
        self.showsBack = showsBack
        self.isLastStep = isLastStep
        self.showsNextArrow = showsNextArrow
    }

    /// The primary button's label key (web `tour.finish` on the last step, else `tour.next`).
    public var primaryTitleKey: String {
        isLastStep ? "tour.finish" : "tour.next"
    }

    /// The primary button's English fallback (web `'Get Started!'` / `'Next'`).
    public var primaryTitleFallback: String {
        isLastStep ? "Get Started!" : "Next"
    }
}

/// Resolves the navigation model for a step index. Clamps to a single-step tour so a degenerate
/// `totalSteps <= 1` still resolves to the finish shape without an out-of-range arrow.
public enum TourOverlayNav {
    public static func model(currentStep: Int, totalSteps: Int) -> TourOverlayNavModel {
        TourOverlayNavModel(
            showsBack: currentStep > 0,
            isLastStep: currentStep >= totalSteps - 1,
            showsNextArrow: currentStep < totalSteps - 1
        )
    }
}
