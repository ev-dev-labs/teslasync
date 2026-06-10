//
//  Modal.Adapter.swift
//  TeslaSync — P4 modal/dialog · 0014 · Modal (Apple)
//
//  The testable, dependency-free projection core for the surface modal — the faithful port of
//  components/ui/Modal.tsx. The web `Modal` is the shared overlay primitive: a backdrop scrim
//  (`onClick={onClose}`), an optional titled header with a 44×44 close button, four width presets
//  (sm | md | lg | full), a full-screen bottom sheet below the `sm` (640px) breakpoint, and an
//  accessibility contract (`role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-label`). Every
//  rule that governs the native chrome lives here as pure value logic (CoreGraphics/Foundation only)
//  so the metrics, the responsive breakpoint, the per-edge radii, the label precedence, and the
//  body-phase resolution can be unit-tested without a rendered view, a store, or a bundle.
//
//  Web parity map (Modal.tsx → native):
//    • `size: 'sm'|'md'|'lg'|'full'`            → `ModalSize` + `ModalAdapter.maxWidth(for:in:)`.
//    • `< sm` full-screen vs `sm:` centered card → `ModalAdapter.isCompact(width:)` + `cornerRadii`.
//    • `h-11 w-11` close button (WCAG 2.5.5)     → `ModalAdapter.closeButtonSide` (44).
//    • `aria-labelledby` (title) vs `aria-label` → `ModalProjection.resolveLabel(title:ariaLabel:)`.
//    • `title && (<header/>)`                    → `ModalProjection.showsHeader(title:)`.
//    • arbitrary `children` (any load state)     → `ModalProjection.resolvePhase(status:hasContent:)`.
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, kept in the dependency-free
/// core so the projection's unit tests can reach it. Matches the prompt surface name `Modal`.
public enum ModalSurface {
    public static let slug = "Modal"
}

// MARK: - Size preset (web `size`)

/// The width preset applied at and above the `sm` breakpoint (web `size`, default `md`). Below the
/// breakpoint the modal is always a full-width bottom sheet regardless of this value.
public enum ModalSize: String, Sendable, Equatable, CaseIterable {
    case small
    case medium
    case large
    case full
}

// MARK: - Body load status / freshness / render phase

/// The host's report of the modal body's data load. The web `Modal` is content-agnostic — it wraps
/// arbitrary `children`; the native surface formalises that contract so the body can render a real
/// loading / empty / error envelope instead of a blank box.
public enum ModalBodyStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the header freshness chip + the connectivity banner so a
/// modal showing cached body data clearly labels it as such.
public enum ModalConnection: String, Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the modal body renders. The web wraps `children` directly; the native body adds the
/// loading / empty / error envelopes so the first-load, no-data, and failure cases never render a
/// blank panel. `.data` shows the caller-provided content (web `children`).
public enum ModalBodyPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case data
}

// MARK: - Resolved accessibility label (web `aria-labelledby` vs `aria-label`)

/// The resolved dialog labelling. `titled` is the web `aria-labelledby` path (a visible heading
/// labels the dialog and the header renders); `anonymous` is the web `aria-label` path (no visible
/// heading); `untitled` is the web `undefined` fallback — native still needs a label for the modal
/// element, so the surface resolves a generic one.
public enum ModalLabel: Sendable, Equatable {
    case titled(String)
    case anonymous(String)
    case untitled
}

// MARK: - Per-corner radii (compact bottom sheet vs regular card)

/// The dialog's per-corner radii. Below the breakpoint the modal is a bottom sheet pinned to the
/// safe area, so only the top corners are rounded (the native sheet idiom for the web `rounded-none`
/// edge-to-edge mobile sheet); at/above the breakpoint it is a centered card with every corner
/// rounded (web `sm:rounded-lg`).
public struct ModalCornerRadii: Sendable, Equatable {
    public let topLeading: CGFloat
    public let topTrailing: CGFloat
    public let bottomLeading: CGFloat
    public let bottomTrailing: CGFloat

    public init(
        topLeading: CGFloat,
        topTrailing: CGFloat,
        bottomLeading: CGFloat,
        bottomTrailing: CGFloat
    ) {
        self.topLeading = topLeading
        self.topTrailing = topTrailing
        self.bottomLeading = bottomLeading
        self.bottomTrailing = bottomTrailing
    }
}

// MARK: - Layout / metrics core (pure)

/// The pure layout + metrics rules shared by the view and its tests. Holds no SwiftUI — every value
/// is derived from the available viewport so the responsive behaviour can be asserted directly.
public enum ModalAdapter {
    /// The minimum close-button touch target (web `h-11 w-11` = 44px, WCAG 2.5.5).
    public static let closeButtonSide: CGFloat = 44

    /// The web `sm` breakpoint (640px). Below this the modal is a full-width bottom sheet.
    public static let compactBreakpoint: CGFloat = 640

    /// The centered-card horizontal inset at/above the breakpoint (web `sm:p-4` = 1rem each side).
    public static let cardInset: CGFloat = 16

    /// The card corner radius at/above the breakpoint (web `sm:rounded-lg`); mirrors `TSRadius.lg`.
    public static let cardCornerRadius: CGFloat = 16

    /// Whether the viewport is below the `sm` breakpoint (web full-screen bottom-sheet branch).
    public static func isCompact(width: CGFloat) -> Bool {
        width < compactBreakpoint
    }

    /// The width cap applied at/above the breakpoint (web `max-w-sm` = 24rem / `max-w-lg` = 32rem /
    /// `max-w-2xl` = 42rem / `max-w-[min(96vw,1100px)]`).
    public static func maxWidth(for size: ModalSize, in availableWidth: CGFloat) -> CGFloat {
        switch size {
        case .small: 384
        case .medium: 512
        case .large: 672
        case .full: min(availableWidth * 0.96, 1100)
        }
    }

    /// The dialog's resolved on-screen width. Compact fills the viewport (web full-screen sheet);
    /// otherwise it is the size cap, clamped so the inset is always honoured on narrow regular
    /// viewports.
    public static func resolvedWidth(for size: ModalSize, in availableWidth: CGFloat) -> CGFloat {
        guard !isCompact(width: availableWidth) else { return availableWidth }
        let available = max(0, availableWidth - cardInset * 2)
        return min(maxWidth(for: size, in: availableWidth), available)
    }

    /// The fraction of viewport height the dialog may occupy (web `max-h-[100dvh]` compact vs
    /// `sm:max-h-[90vh]`).
    public static func maxHeightFraction(width: CGFloat) -> CGFloat {
        isCompact(width: width) ? 1.0 : 0.9
    }

    /// The per-corner radii for the viewport (compact bottom sheet → top only; regular card → all).
    public static func cornerRadii(width: CGFloat) -> ModalCornerRadii {
        if isCompact(width: width) {
            return ModalCornerRadii(
                topLeading: cardCornerRadius,
                topTrailing: cardCornerRadius,
                bottomLeading: 0,
                bottomTrailing: 0
            )
        }
        return ModalCornerRadii(
            topLeading: cardCornerRadius,
            topTrailing: cardCornerRadius,
            bottomLeading: cardCornerRadius,
            bottomTrailing: cardCornerRadius
        )
    }

    /// Whether the dialog pins to the bottom (compact sheet, web `items-end`) or centers (web
    /// `sm:items-center`).
    public static func pinsToBottom(width: CGFloat) -> Bool {
        isCompact(width: width)
    }
}

// MARK: - Projection core (pure)

/// The dependency-free rules for the dialog's label precedence, header visibility, and body-phase
/// resolution — the parts of the web component that decide *what* renders rather than *where*.
public enum ModalProjection {
    /// The web labelling precedence: a non-empty `title` labels the dialog via its visible heading
    /// (`aria-labelledby`); otherwise a non-empty `ariaLabel` labels it directly (`aria-label`);
    /// otherwise the dialog is untitled (web `undefined`) and the surface supplies a generic label.
    public static func resolveLabel(title: String?, ariaLabel: String?) -> ModalLabel {
        if let title, !title.isEmpty { return .titled(title) }
        if let ariaLabel, !ariaLabel.isEmpty { return .anonymous(ariaLabel) }
        return .untitled
    }

    /// Whether the titled header (heading + close button) renders (web `title && (<header/>)`).
    /// A modal with no title has no visible header and is dismissed via the scrim / swipe / Esc.
    public static func showsHeader(title: String?) -> Bool {
        guard let title else { return false }
        return !title.isEmpty
    }

    /// Resolves the body render phase from the host's load report. Loading shows the skeleton; a
    /// successful load shows the content when present else the empty envelope; a failure shows the
    /// error envelope with the message.
    public static func resolvePhase(status: ModalBodyStatus, hasContent: Bool) -> ModalBodyPhase {
        switch status {
        case .loading:
            .loading
        case .loaded:
            hasContent ? .data : .empty
        case let .failed(message):
            .error(message)
        }
    }
}
