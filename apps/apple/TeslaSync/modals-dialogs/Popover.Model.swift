//
//  Popover.Model.swift
//  TeslaSync — P4 modal / dialog · 0015 · Popover (Apple)
//
//  The presentation state holder the `Popover` views bind through. The web `Popover`
//  (components/ui/Popover.tsx) is a primitive with no data hooks — its only "state" is the
//  positioning lifecycle owned by `useLayoutEffect`: closed → open-but-unmeasured (`pos === null`,
//  rendered hidden) → positioned (with any auto-flip) → re-measured on resize / scroll, plus the
//  Esc / click-outside / blur dismiss and the focus restore to the trigger.
//
//  This model reproduces exactly that lifecycle in a SwiftUI-free, unit-testable shape: it mirrors
//  the presentation flag, ingests the measured anchor / content / viewport, delegates to
//  `PopoverGeometry` for the resolved placement (the "measuring" state is simply `placement == nil`),
//  emits the P1/S11 `view.opened` event once per open, and resolves the VoiceOver labels. There is
//  no networking — the surface carries no data source.
//

import CoreGraphics
import Foundation
import Observation

/// The popover's observable presentation model. Owns the open flag, the measured geometry inputs,
/// the resolved `PopoverPlacement`, and the diagnostics + accessibility seams.
@MainActor
@Observable
public final class PopoverModel {
    // Configuration (web props `side` / `align` / `sideOffset`)
    public let side: PopoverSide
    public let align: PopoverAlign
    public let sideOffset: CGFloat

    // Presentation + measured inputs (web `open` + the `compute()` rects)
    public private(set) var isPresented = false
    public private(set) var anchorFrame: CGRect = .zero
    public private(set) var contentSize: CGSize = .zero
    public private(set) var viewportSize: CGSize = .zero

    /// The resolved placement, or `nil` while still measuring (web `pos === null` → hidden content).
    public private(set) var placement: PopoverPlacement?

    @ObservationIgnored private let telemetry: any PopoverTelemetry
    @ObservationIgnored private let onDismiss: (() -> Void)?
    @ObservationIgnored private let accessibilityLabel: String?
    @ObservationIgnored let localize: (String, String) -> String

    public init(
        side: PopoverSide = .bottom,
        align: PopoverAlign = .start,
        sideOffset: CGFloat = PopoverGeometry.defaultSideOffset,
        accessibilityLabel: String? = nil,
        telemetry: any PopoverTelemetry = OSLogPopoverTelemetry(),
        onDismiss: (() -> Void)? = nil,
        localize: @escaping (String, String) -> String = PopoverStrings.string
    ) {
        self.side = side
        self.align = align
        self.sideOffset = sideOffset
        self.accessibilityLabel = accessibilityLabel
        self.telemetry = telemetry
        self.onDismiss = onDismiss
        self.localize = localize
    }

    // MARK: - Derived state

    /// Whether the popover is presented but not yet positioned (web hidden `pos === null` frame).
    public var isMeasuring: Bool {
        isPresented && placement == nil
    }

    /// The side actually used after any flip (web `resolvedSide`), defaulting to the requested side
    /// before a placement has been computed.
    public var resolvedSide: PopoverSide {
        placement?.resolvedSide ?? side
    }

    /// The maximum content size that fits on the resolved side without overflowing the viewport
    /// margin. `.zero` (in either dimension) means "not yet measured — apply no cap".
    public var contentMaxSize: CGSize {
        guard viewportSize.width > 0, viewportSize.height > 0 else { return .zero }
        return PopoverGeometry.availableContentSize(
            anchor: anchorFrame,
            viewport: viewportSize,
            side: resolvedSide,
            sideOffset: sideOffset
        )
    }

    // MARK: - Accessibility labels (P1/S10)

    /// The popover region's VoiceOver label (web `aria-label`, else the localized default).
    public var regionAccessibilityLabel: String {
        PopoverAccessibility.regionLabel(custom: accessibilityLabel, localize: localize)
    }

    /// The dismiss control's VoiceOver label.
    public var dismissAccessibilityLabel: String {
        PopoverAccessibility.dismissLabel(localize: localize)
    }

    /// The empty-content fallback copy (web renders an empty surface for empty children).
    public var emptyAccessibilityLabel: String {
        PopoverAccessibility.emptyLabel(localize: localize)
    }

    // MARK: - Lifecycle

    /// Presents the popover, emitting the `view.opened` diagnostics event on the rising edge only
    /// (web: a popover open is a discrete view-open; re-opening emits again). Idempotent while open.
    public func present() {
        guard !isPresented else { return }
        isPresented = true
        telemetry.viewOpened(surface: PopoverSurfaceID.slug)
    }

    /// Dismisses the popover (web Esc / click-outside / blur), resetting the measuring state so the
    /// next open re-measures, and invoking the close callback (web `onClose`). Idempotent while
    /// closed.
    public func dismiss() {
        guard isPresented else { return }
        isPresented = false
        placement = nil
        onDismiss?()
    }

    /// Mirrors an external `isPresented` binding (the native `.popover` source of truth): emits
    /// `view.opened` on the rising edge and `onClose` on the falling edge.
    public func setPresented(_ value: Bool) {
        if value {
            present()
        } else {
            dismiss()
        }
    }

    // MARK: - Measurement (web `compute()` inputs from resize / scroll)

    /// Updates the anchor rect (the trigger's bounding box, web `anchorRef.getBoundingClientRect()`).
    public func updateAnchor(_ rect: CGRect) {
        guard rect != anchorFrame else { return }
        anchorFrame = rect
        recompute()
    }

    /// Updates the measured content size (web `content.getBoundingClientRect()`).
    public func updateContent(_ size: CGSize) {
        guard size != contentSize else { return }
        contentSize = size
        recompute()
    }

    /// Updates the viewport size (web `window.innerWidth / innerHeight`).
    public func updateViewport(_ size: CGSize) {
        guard size != viewportSize else { return }
        viewportSize = size
        recompute()
    }

    /// Recomputes the placement once open and all three rects are known; clears it otherwise so the
    /// view falls back to the hidden "measuring" frame (web `pos === null`).
    private func recompute() {
        guard isPresented,
              contentSize.width > 0, contentSize.height > 0,
              viewportSize.width > 0, viewportSize.height > 0
        else {
            placement = nil
            return
        }
        placement = PopoverGeometry.place(
            anchor: anchorFrame,
            content: contentSize,
            viewport: viewportSize,
            side: side,
            align: align,
            sideOffset: sideOffset
        )
    }
}
