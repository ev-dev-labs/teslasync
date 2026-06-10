//
//  Popover.Geometry.swift
//  TeslaSync — P4 modal / dialog · 0015 · Popover (Apple)
//
//  The pure positioning core for the `Popover` primitive — a faithful, SwiftUI-free port of the web
//  source's `useLayoutEffect` `compute()` (components/ui/Popover.tsx). The web component portals its
//  content to <body> and hand-positions it relative to the trigger's bounding rect: it resolves the
//  `side` (flipping bottom↔top when the requested side overflows the viewport and the opposite side
//  has more room), offsets by `sideOffset`, aligns on the cross axis (`start` / `end` / `center`),
//  and clamps the result horizontally + vertically to stay inside the viewport with an 8 px margin.
//
//  All of that lives here as value types + static math so it is deterministic and unit-testable in
//  isolation (Apple platforms have a native `.popover`, but the web source's whole purpose is this
//  explicit geometry, so it is reproduced exactly rather than hidden behind the OS). The view layer
//  (`Popover.swift` / `Popover.Views.swift`) consumes this to drive both a native `.popover`
//  transport and the inline `PopoverContainer`.
//

import CoreGraphics

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Static, non-identifying diagnostics slug for the surface (web component name). Named distinctly
/// from the `PopoverSurface` chrome view in Popover.Views.swift.
public enum PopoverSurfaceID {
    public static let slug = "Popover"
}

// MARK: - Axes (web `PopoverSide` / `PopoverAlign`)

/// Side of the anchor the popover opens toward (web `PopoverSide`). Auto-flips when the requested
/// side overflows the viewport.
public enum PopoverSide: String, Sendable, CaseIterable {
    case bottom
    case top

    /// The opposing side used when a flip is required.
    public var opposite: PopoverSide {
        self == .bottom ? .top : .bottom
    }
}

/// Cross-axis alignment of the popover relative to the anchor (web `PopoverAlign`).
public enum PopoverAlign: String, Sendable, CaseIterable {
    case start
    case end
    case center
}

// MARK: - Result

/// A resolved popover placement in the anchor's coordinate space (top-left origin, matching the web
/// `position: fixed; top; left`). `resolvedSide` reflects any auto-flip that was applied.
public struct PopoverPlacement: Equatable, Sendable {
    public var top: CGFloat
    public var left: CGFloat
    public var resolvedSide: PopoverSide

    public init(top: CGFloat, left: CGFloat, resolvedSide: PopoverSide) {
        self.top = top
        self.left = left
        self.resolvedSide = resolvedSide
    }

    /// The placement's origin as a point (convenience for `.offset` / `.position` call sites).
    public var origin: CGPoint {
        CGPoint(x: left, y: top)
    }
}

// MARK: - Engine

/// The stateless positioning engine — a 1:1 port of the web `compute()` flip / align / clamp math.
public enum PopoverGeometry {
    /// Viewport edge margin the popover is kept within (web `const margin = 8`).
    public static let margin: CGFloat = 8

    /// Default gap between the anchor and the popover (web `sideOffset = 6`).
    public static let defaultSideOffset: CGFloat = 6

    /// Resolves the side, flipping when the requested side can't fit and the opposite side has more
    /// room (web: `if (side === 'bottom' && c.height > spaceBelow && spaceAbove > spaceBelow) …`).
    /// `spaceAbove` / `spaceBelow` are the already-inset gaps (anchor offset − `sideOffset` −
    /// `margin`) available on each side.
    public static func resolveSide(
        _ side: PopoverSide,
        contentHeight: CGFloat,
        spaceAbove: CGFloat,
        spaceBelow: CGFloat
    ) -> PopoverSide {
        switch side {
        case .bottom where contentHeight > spaceBelow && spaceAbove > spaceBelow:
            .top
        case .top where contentHeight > spaceAbove && spaceBelow > spaceAbove:
            .bottom
        default:
            side
        }
    }

    /// Computes the full placement for an anchor rect, content size, and viewport — the faithful port
    /// of the web `compute()`. Coordinates share a top-left origin (the anchor's window space).
    public static func place(
        anchor: CGRect,
        content: CGSize,
        viewport: CGSize,
        side: PopoverSide,
        align: PopoverAlign,
        sideOffset: CGFloat = defaultSideOffset,
        margin: CGFloat = margin
    ) -> PopoverPlacement {
        let viewWidth = viewport.width
        let viewHeight = viewport.height

        let spaceBelow = viewHeight - anchor.maxY - sideOffset - margin
        let spaceAbove = anchor.minY - sideOffset - margin
        let resolvedSide = resolveSide(
            side,
            contentHeight: content.height,
            spaceAbove: spaceAbove,
            spaceBelow: spaceBelow
        )

        var top = resolvedSide == .bottom
            ? anchor.maxY + sideOffset
            : anchor.minY - sideOffset - content.height

        var left = alignedLeft(anchor: anchor, contentWidth: content.width, align: align)

        // Clamp horizontally to the viewport (web order: right edge, then left edge).
        if left + content.width + margin > viewWidth {
            left = viewWidth - content.width - margin
        }
        if left < margin {
            left = margin
        }

        // Clamp vertically (web: only bites when both sides overflow).
        if top + content.height + margin > viewHeight {
            top = viewHeight - content.height - margin
        }
        if top < margin {
            top = margin
        }

        return PopoverPlacement(top: top, left: left, resolvedSide: resolvedSide)
    }

    /// The un-clamped cross-axis left edge for an alignment (web `align` branch).
    public static func alignedLeft(anchor: CGRect, contentWidth: CGFloat, align: PopoverAlign) -> CGFloat {
        switch align {
        case .start:
            anchor.minX
        case .end:
            anchor.maxX - contentWidth
        case .center:
            anchor.minX + anchor.width / 2 - contentWidth / 2
        }
    }

    /// The maximum content size that fits on `side` of the anchor without overflowing the viewport
    /// margin. Lets a caller cap the surface (and scroll inside it) so a tall popover never spills
    /// off-screen — the bounded analogue of the web clamp. Never returns negative dimensions.
    public static func availableContentSize(
        anchor: CGRect,
        viewport: CGSize,
        side: PopoverSide,
        sideOffset: CGFloat = defaultSideOffset,
        margin: CGFloat = margin
    ) -> CGSize {
        let maxWidth = max(0, viewport.width - margin * 2)
        let maxHeight: CGFloat = switch side {
        case .bottom:
            viewport.height - anchor.maxY - sideOffset - margin
        case .top:
            anchor.minY - sideOffset - margin
        }
        return CGSize(width: maxWidth, height: max(0, maxHeight))
    }
}
