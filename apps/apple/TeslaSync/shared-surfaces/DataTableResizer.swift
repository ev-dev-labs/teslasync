//
//  DataTableResizer.swift
//  TeslaSync — P4 shared surface · 0212 · DataTableResizer (Apple)
//
//  The public API of the column-resize handle — the SwiftUI parity of `components/ui/DataTableResizer.tsx`.
//  Like the web component it is driven entirely by its props (`columnKey`, the controlled `width`,
//  `minWidth` / `maxWidth`, the `onResize` / `onResizeEnd` callbacks, and the optional accessible `label`);
//  there is no fetcher. The view binds through ``DataTableResizerModel`` for the drag streaming + the
//  keyboard / VoiceOver steps + the once-only `view.opened` telemetry (P1/S11); composes the token-driven
//  chrome (P1/S9); and pushes prop changes into the holder via `.onChange` so the controlled `width`
//  streams back faithfully during a drag. No networking, no Tailwind ports.
//
//  Accessibility parity: the web uses the WAI-ARIA "Window Splitter" pattern (`role="separator"` +
//  `aria-valuenow/min/max` + `tabIndex=0` + arrow-key resize). Its native peer is an accessible element
//  with an adjustable action — VoiceOver announces the resize label + the current width and a swipe
//  up/down grows/shrinks the column (the increment/decrement mapping to the web `ArrowRight`/`ArrowLeft`).
//

import SwiftUI

/// The column-resize handle — the SwiftUI parity of `components/ui/DataTableResizer.tsx`. A thin bar pinned
/// to a column header's trailing edge: invisible at rest, tinted on hover / focus / drag (web `opacity-0` →
/// `bg-cyan-400/40` → `bg-cyan-400/60`). Dragging streams clamped widths to `onResize` and commits the
/// final width to `onResizeEnd` on release; the arrow keys (and a VoiceOver swipe) step the width by 8 pt,
/// Home resets to 80 pt, End maxes out — each clamped to `minWidth … maxWidth`. Mount it as a trailing
/// overlay on a resizable `<th>`-equivalent header cell.
public struct DataTableResizer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        DataTableResizerSurface.slug
    }

    private let input: DataTableResizerInput
    private let onResize: (@MainActor (Double) -> Void)?
    private let onResizeEnd: (@MainActor (Double) -> Void)?
    @State private var model: DataTableResizerModel
    @FocusState private var isFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The prop-style initializer — the parity of `<DataTableResizer columnKey width minWidth maxWidth
    /// onResize onResizeEnd label />`. `onResize` is required (the controlled page owns `width` and updates
    /// it on every change); `onResizeEnd` is optional (commit / persistence); `label` overrides the default
    /// "Resize column {columnKey}" accessible label.
    public init(
        columnKey: String,
        width: Double,
        minWidth: Double = 60,
        maxWidth: Double = 800,
        onResize: @escaping @MainActor (Double) -> Void,
        onResizeEnd: (@MainActor (Double) -> Void)? = nil,
        label: String? = nil,
        telemetry: any DataTableResizerTelemetry = OSLogDataTableResizerTelemetry()
    ) {
        let resolved = DataTableResizerInput(
            columnKey: columnKey,
            width: width,
            minWidth: minWidth,
            maxWidth: maxWidth,
            label: label
        )
        input = resolved
        self.onResize = onResize
        self.onResizeEnd = onResizeEnd
        _model = State(initialValue: DataTableResizerModel(
            input: resolved,
            onResize: onResize,
            onResizeEnd: onResizeEnd,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded drag state).
    public init(model: DataTableResizerModel) {
        input = model.input
        onResize = nil
        onResizeEnd = nil
        _model = State(initialValue: model)
    }

    public var body: some View {
        handle
            .frame(width: DataTableResizerStyle.hitWidth)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .focusable()
            .focused($isFocused)
            .gesture(dragGesture)
            .onHover { model.setHovering($0) }
            .tsColumnResizePointer()
            .onKeyPress(.leftArrow) { model.stepSmaller(); return .handled }
            .onKeyPress(.rightArrow) { model.stepLarger(); return .handled }
            .onKeyPress(.home) { model.resetToDefault(); return .handled }
            .onKeyPress(.end) { model.maximize(); return .handled }
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: DataTableResizerStrings.label(
                columnKey: input.columnKey,
                override: input.label
            )))
            .accessibilityValue(Text(verbatim: DataTableResizerStrings.value(width: model.projection.width)))
            .accessibilityHint(Text(verbatim: DataTableResizerStrings.hint))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: model.adjust(.increment)
                case .decrement: model.adjust(.decrement)
                @unknown default: break
                }
            }
            .onChange(of: isFocused) { _, focused in model.setFocused(focused) }
            .onChange(of: input) { _, newInput in
                model.update(newInput, onResize: onResize, onResizeEnd: onResizeEnd)
            }
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    /// The thin tinted bar pinned to the trailing edge within the (wider) interactive target. The fill
    /// opacity tracks the interaction (web resizer `opacity-0` → hover/focus/drag tints); the fade honors
    /// Reduce Motion (web `transition-opacity`).
    private var handle: some View {
        ZStack(alignment: .trailing) {
            Color.clear
            RoundedRectangle(cornerRadius: DataTableResizerStyle.barCornerRadius, style: .continuous)
                .fill(Color.TS.accent.opacity(model.projection.fillOpacity))
                .frame(width: DataTableResizerStyle.barWidth)
                .frame(maxHeight: .infinity)
        }
        .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: model.projection.fillOpacity)
    }

    /// The pointer drag — streams the translation to the holder (web pointer-move) and commits on release
    /// (web pointer-up / pointer-cancel). `minimumDistance: 0` so the grab registers immediately, matching
    /// the web pointer-capture-on-down.
    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in model.dragChanged(translation: Double(value.translation.width)) }
            .onEnded { _ in model.dragEnded() }
    }
}
