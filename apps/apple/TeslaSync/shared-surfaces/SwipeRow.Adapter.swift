//
//  SwipeRow.Adapter.swift
//  TeslaSync — P4 shared surface · 0189 · SwipeRow (Apple)
//
//  The testable, dependency-light core for the SwipeRow shared surface — the SwiftUI parity of
//  `web/src/components/mobile/SwipeRow.tsx`. That component is a swipe-to-action row wrapper that
//  mirrors the iOS Mail / Notes interaction: drag left to reveal the right-edge action, drag right to
//  reveal the left-edge action, leave the row "peeked" past the reveal threshold, or auto-fire the
//  action when released past half the row width. A vertical drift cancels the gesture so the parent
//  list keeps scrolling; a single haptic blip fires the first time the reveal threshold is crossed.
//
//  Everything here is pure (Foundation only): the px geometry constants (web `DEFAULT_REVEAL`,
//  `ACTION_WIDTH`, `VERTICAL_TOLERANCE`, the 8px horizontal lock), the drag math (axis-lock decision,
//  the wired-side + overshoot clamp, the threshold-cross haptic decision), the release outcome (the
//  web `onTouchEnd` branch ladder), the action tone → token mapping + default SF Symbol (web
//  Archive / Trash2), and the VoiceOver label builder. No store, no bundle, no rendered view, so each
//  rule is unit tested in isolation. Offsets are `Double` px (the web pixel space); the view converts
//  to `CGFloat` at the boundary.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias SwipeRowResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Action tone (web `tone: 'danger' | 'default'`)

/// The visual tone of a swipe action — the native mirror of the web `SwipeAction.tone`. `danger`
/// paints the destructive rose/danger token (web `bg-rose-500/20`); `default` paints the accent/cyan
/// token (web `bg-cyan-500/20`). Mapped to a `Color` only at the view boundary (P1/S9), never here.
public enum SwipeActionTone: String, Sendable, Equatable, CaseIterable {
    case `default`
    case danger

    /// The SF Symbol the action shows when the caller supplies no custom icon — the native parity of
    /// the web `defaultIcon`: `Trash2` for the destructive tone, `Archive` otherwise.
    public var defaultSymbolName: String {
        switch self {
        case .default: "archivebox"
        case .danger: "trash"
        }
    }
}

// MARK: - Release outcome (web `onTouchEnd` branch ladder)

/// What a released swipe resolves to — the native mirror of the web `onTouchEnd` decision ladder.
/// A negative offset means the row was dragged left (revealing the right-edge action); a positive
/// offset means it was dragged right (revealing the left-edge action). `fire*` auto-invokes the
/// action (released past half the row width); `peek*` rests the row open so the user taps the button;
/// `closed` snaps the row back.
public enum SwipeRowOutcome: String, Sendable, Equatable {
    case fireRight
    case fireLeft
    case peekRight
    case peekLeft
    case closed
}

// MARK: - Geometry (the web drag math)

/// The pure px geometry of the swipe interaction — the native source of truth for the constants and
/// the drag/release math the web component computes inline. Namespaced so the view, the model, and
/// the tests share one implementation. All distances are `Double` px in the web pixel space.
public enum SwipeRowGeometry {
    /// Distance the user must drag before an action is "revealed" (web `DEFAULT_REVEAL = 64`).
    public static let revealThreshold: Double = 64
    /// Width of the underlay action panel (web `ACTION_WIDTH = 96`).
    public static let actionWidth: Double = 96
    /// Vertical drift past which the gesture cancels so the list can scroll (web `VERTICAL_TOLERANCE`).
    public static let verticalTolerance: Double = 16
    /// Horizontal travel that locks the gesture onto the swipe axis (web `Math.abs(dx) < 8` guard).
    public static let horizontalLock: Double = 8

    /// Whether a not-yet-locked gesture should cancel because the drag is dominantly vertical — the
    /// web "abandon this row's gesture so the list can keep scrolling" branch
    /// (`|dy| > VERTICAL_TOLERANCE && |dy| > |dx|`).
    public static func shouldCancelForVerticalDrift(dx: Double, dy: Double) -> Bool {
        abs(dy) > verticalTolerance && abs(dy) > abs(dx)
    }

    /// Whether horizontal travel has passed the axis-lock threshold (web `Math.abs(dx) < 8` → locked
    /// once it is no longer below 8). Below the lock the row does not move.
    public static func hasHorizontalLock(dx: Double) -> Bool {
        abs(dx) >= horizontalLock
    }

    /// The constrained live offset for a horizontal translation — the web move clamp: a drag toward a
    /// side with no wired action is pinned to 0, and the travel is clamped to ±`width` so the row
    /// never slides fully off. A non-finite width falls back to the web default (320).
    public static func constrainedOffset(
        dx: Double,
        width: Double,
        hasLeftAction: Bool,
        hasRightAction: Bool
    ) -> Double {
        var next = dx
        if next < 0, !hasRightAction { next = 0 }
        if next > 0, !hasLeftAction { next = 0 }
        let maxAbs = width.isFinite && width > 0 ? width : 320
        return min(maxAbs, max(-maxAbs, next))
    }

    /// Whether the live offset has crossed the reveal threshold — the web one-shot-haptic trigger
    /// (`Math.abs(next) >= revealThreshold`).
    public static func crossedRevealThreshold(offset: Double, threshold: Double = revealThreshold) -> Bool {
        abs(offset) >= threshold
    }

    /// The release outcome for a final offset — the web `onTouchEnd` ladder: past half the width →
    /// auto-fire the wired action; else past the reveal threshold → peek it open; else snap closed.
    /// Branches guard on the wired side so an un-wired direction always resolves to `.closed`.
    public static func releaseOutcome(
        finalOffset: Double,
        width: Double,
        hasLeftAction: Bool,
        hasRightAction: Bool,
        threshold: Double = revealThreshold
    ) -> SwipeRowOutcome {
        let halfWidth = (width.isFinite && width > 0 ? width : 320) / 2
        if finalOffset <= -halfWidth, hasRightAction { return .fireRight }
        if finalOffset >= halfWidth, hasLeftAction { return .fireLeft }
        if finalOffset <= -threshold, hasRightAction { return .peekRight }
        if finalOffset >= threshold, hasLeftAction { return .peekLeft }
        return .closed
    }

    /// The resting offset the row animates to for a `peek*` / `closed` outcome (the `fire*` outcomes
    /// snap closed after invoking, so they also rest at 0). Negative rests the right action open;
    /// positive rests the left action open (web `setOffset(-ACTION_WIDTH)` / `+ACTION_WIDTH`).
    public static func restingOffset(for outcome: SwipeRowOutcome) -> Double {
        switch outcome {
        case .peekRight: -actionWidth
        case .peekLeft: actionWidth
        case .fireRight, .fireLeft, .closed: 0
        }
    }
}

// MARK: - Accessibility (testable seam)

/// Pure VoiceOver-label builders for the surface, so the spoken copy is asserted without rendering a
/// view. All copy is either the host's already-localized action label (web labels arrive localized)
/// or resolved through the injected P1/S10 facade.
public enum SwipeRowAccessibility {
    /// The spoken label for an action button — the host's `accessibilityLabel` override when present,
    /// else the visible `label` (web `ariaLabel ?? label`). Trimmed; an empty result falls back to the
    /// localized generic-action copy so VoiceOver never reads nothing.
    public static func actionLabel(
        label: String,
        override: String?,
        strings: SwipeRowResolve
    ) -> String {
        if let override, !override.trimmingCharacters(in: .whitespaces).isEmpty {
            return override
        }
        let trimmed = label.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
            return trimmed
        }
        return strings("swipeRow.action.generic", "Action")
    }

    /// The row's combined VoiceOver hint announcing that swipe actions are available, so touch users
    /// who cannot perform the drag still discover the actions via the rotor / custom actions.
    public static func rowActionsHint(
        hasLeftAction: Bool,
        hasRightAction: Bool,
        strings: SwipeRowResolve
    ) -> String? {
        guard hasLeftAction || hasRightAction else { return nil }
        return strings("swipeRow.actionsAvailable", "Actions available")
    }
}
