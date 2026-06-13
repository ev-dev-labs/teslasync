//
//  DataTableResizer.Previews.swift
//  TeslaSync — P4 shared surface · 0212 · DataTableResizer (Apple)
//
//  Xcode previews for every real branch of the column-resize handle: the live interactive harness (drag /
//  arrow-key it to resize a real cell), the resting (invisible) handle, the hover tint, the focus tint, the
//  dragging tint, the min / max clamp boundaries, and a custom accessible-label override. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 460, alignment: .leading)
        .background(Color.TS.bg)
    }

    /// A stand-in header cell with the supplied handle pinned to its trailing edge — lets the static
    /// (injected-model) previews show the thin bar against a real surface without owning width state.
    @MainActor
    private func swatchCell(width: CGFloat, @ViewBuilder _ handle: () -> some View) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: "Column")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(width: width, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .overlay(alignment: .trailing) { handle() }
    }

    /// Builds a handle whose interaction flag is pre-seeded, so a static preview can render the hover /
    /// focus / drag tint that would otherwise only appear under live interaction.
    @MainActor
    private func seededHandle(hovering: Bool = false, focused: Bool = false, dragging: Bool = false) -> some View {
        let model = DataTableResizerModel(input: DataTableResizerInput(columnKey: "name", width: 160))
        if hovering { model.setHovering(true) }
        if focused { model.setFocused(true) }
        if dragging { model.dragChanged(translation: 0) }
        return DataTableResizer(model: model)
    }

    #Preview("Live — drag or arrow-key to resize") {
        staged("interactive harness · width streams back through onResize / onResizeEnd") {
            DataTableResizerColumnHarness(columnKey: "displayName", title: "Display name")
        }
    }

    #Preview("Resting — invisible until hover/focus") {
        staged("opacity-0 at rest (web resizer); hover or focus to reveal") {
            swatchCell(width: 200) { seededHandle() }
        }
    }

    #Preview("Hover tint") {
        staged("hover:bg-cyan-400/40 (web resizer hover)") {
            swatchCell(width: 200) { seededHandle(hovering: true) }
        }
    }

    #Preview("Focus tint — keyboard splitter") {
        staged("focus-visible:bg-cyan-400/60 (web resizer focus)") {
            swatchCell(width: 200) { seededHandle(focused: true) }
        }
    }

    #Preview("Dragging tint") {
        staged("dragging → bg-cyan-400/60 (web resizer drag)") {
            swatchCell(width: 200) { seededHandle(dragging: true) }
        }
    }

    #Preview("At minimum width — clamp floor") {
        staged("width pinned to minWidth (60 pt); arrow-left cannot shrink further") {
            DataTableResizerColumnHarness(columnKey: "soc", title: "SoC", width: 60, minWidth: 60, maxWidth: 280)
        }
    }

    #Preview("At maximum width — clamp ceiling") {
        staged("width pinned to maxWidth (280 pt); arrow-right cannot grow further") {
            DataTableResizerColumnHarness(columnKey: "vin", title: "VIN", width: 280, minWidth: 60, maxWidth: 280)
        }
    }

    #Preview("Custom accessible label") {
        staged("label override (web `label` prop) replaces \"Resize column …\"") {
            swatchCell(width: 200) {
                let model = DataTableResizerModel(
                    input: DataTableResizerInput(columnKey: "odo", width: 160, label: "Resize the odometer column")
                )
                model.setHovering(true)
                return DataTableResizer(model: model)
            }
        }
    }
#endif
