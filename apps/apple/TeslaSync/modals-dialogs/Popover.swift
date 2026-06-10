//
//  Popover.swift
//  TeslaSync — P4 modal / dialog · 0015 · Popover (Apple)
//
//  The public entry point for the `Popover` primitive (web components/ui/Popover.tsx). The web
//  source hand-portals content next to a trigger; on Apple platforms the HIG-correct transport for
//  the common "attach to a trigger" case is the native `.popover`, which already gives the web
//  semantics for free and correctly: auto-flip, viewport clamp, Esc / click-outside dismiss, focus
//  restore to the trigger, and a non-modal surface (web `aria-modal="false"`). This file wires that
//  transport to the surface — mapping the web `side` / `align` onto the popover's arrow edge +
//  attachment point via the same axes the geometry engine uses, forcing the popover presentation on
//  compact iOS (web always shows a popover, never a sheet), and driving the P1/S11 `view.opened`
//  telemetry through `PopoverModel`. For an inline, fully hand-positioned popover bounded to a
//  parent (the literal `position: fixed` math), use `PopoverContainer` in Popover.Views.swift.
//

import SwiftUI

// MARK: - Axis → SwiftUI mapping

extension PopoverSide {
    /// The popover's preferred arrow edge for this side (the OS may override under space pressure,
    /// exactly as the web `compute()` flips). `bottom` (open below) → arrow on the top edge.
    var preferredArrowEdge: Edge {
        self == .bottom ? .top : .bottom
    }
}

extension PopoverAlign {
    /// The attachment unit point on the anchor for this alignment + side (web `align` cross-axis +
    /// `side` main-axis). `start` → leading, `center` → middle, `end` → trailing.
    func attachmentUnitPoint(on side: PopoverSide) -> UnitPoint {
        let xPos: CGFloat = switch self {
        case .start: 0
        case .center: 0.5
        case .end: 1
        }
        return UnitPoint(x: xPos, y: side == .bottom ? 1 : 0)
    }
}

// MARK: - Window-level presentation modifier

/// Presents `popoverBody` in a native `.popover` anchored to the modified view, mapping the web
/// `side` / `align` to the arrow edge + attachment point and mirroring the presentation flag into
/// `PopoverModel` so the surface emits `view.opened` once per open and resolves its region label.
struct PopoverPresentationModifier<PopoverBody: View>: ViewModifier {
    @Binding var isPresented: Bool
    let side: PopoverSide
    let align: PopoverAlign
    @ViewBuilder let popoverBody: () -> PopoverBody

    @State private var model: PopoverModel

    init(
        isPresented: Binding<Bool>,
        side: PopoverSide,
        align: PopoverAlign,
        sideOffset: CGFloat,
        accessibilityLabel: String?,
        telemetry: any PopoverTelemetry,
        onDismiss: (() -> Void)?,
        @ViewBuilder popoverBody: @escaping () -> PopoverBody
    ) {
        _isPresented = isPresented
        self.side = side
        self.align = align
        self.popoverBody = popoverBody
        _model = State(initialValue: PopoverModel(
            side: side,
            align: align,
            sideOffset: sideOffset,
            accessibilityLabel: accessibilityLabel,
            telemetry: telemetry,
            onDismiss: onDismiss
        ))
    }

    func body(content: Content) -> some View {
        content
            .popover(
                isPresented: $isPresented,
                attachmentAnchor: .point(align.attachmentUnitPoint(on: side)),
                arrowEdge: side.preferredArrowEdge
            ) {
                PopoverSurface { popoverBody() }
                    .presentationCompactAdaptation(.popover)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text(verbatim: model.regionAccessibilityLabel))
            }
            .onChange(of: isPresented) { _, value in model.setPresented(value) }
    }
}

// MARK: - Public API

public extension View {
    /// Presents a TeslaSync `Popover` anchored to this view (web `components/ui/Popover.tsx`). Uses
    /// the native `.popover` transport (HIG auto-flip / clamp / dismiss / focus restore) and forces
    /// the popover presentation on compact iOS so it never adapts to a sheet, matching the web
    /// surface. `view.opened` (P1/S11) fires once per open.
    ///
    /// - Parameters:
    ///   - isPresented: Whether the popover is shown (web `open`); SwiftUI also clears it on dismiss.
    ///   - side: Preferred side relative to the anchor (web `side`, default `.bottom`).
    ///   - align: Cross-axis alignment (web `align`, default `.start`).
    ///   - sideOffset: Held on the model for the inline container; the native popover owns its own
    ///     arrow gap, so it is advisory on this transport (web `sideOffset`, default 6).
    ///   - accessibilityLabel: VoiceOver label for the region (web `ariaLabel`); falls back to a
    ///     localized default.
    ///   - telemetry: Diagnostics sink (defaults to the `os.Logger` adapter).
    ///   - onDismiss: Invoked when the popover closes (web `onClose`).
    ///   - content: The popover body.
    func popoverSurface(
        isPresented: Binding<Bool>,
        side: PopoverSide = .bottom,
        align: PopoverAlign = .start,
        sideOffset: CGFloat = PopoverGeometry.defaultSideOffset,
        accessibilityLabel: String? = nil,
        telemetry: any PopoverTelemetry = OSLogPopoverTelemetry(),
        onDismiss: (() -> Void)? = nil,
        @ViewBuilder content: @escaping () -> some View
    ) -> some View {
        modifier(PopoverPresentationModifier(
            isPresented: isPresented,
            side: side,
            align: align,
            sideOffset: sideOffset,
            accessibilityLabel: accessibilityLabel,
            telemetry: telemetry,
            onDismiss: onDismiss,
            popoverBody: content
        ))
    }
}
