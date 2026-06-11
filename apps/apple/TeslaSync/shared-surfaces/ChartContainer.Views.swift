//
//  ChartContainer.Views.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  The figure header + toolbar composed by `ChartContainer`: the title / subtitle block (web `<h3>` +
//  `<p>`) and the trailing action toolbar (web `data-html2canvas-ignore` action area) carrying the
//  caller's action slot, the annotation add + show/hide toggle (web `Plus` / `Eye` / `EyeOff`
//  buttons), the export overflow (web `ChartExportMenu`), and the fullscreen toggle (web
//  `FullscreenButton`). All copy resolves through the P1/S10 facade; all colour comes from the P1/S9
//  tokens; the shared `TSButton` primitive is reused.
//

import SwiftUI

// MARK: - Header (web `ChartContainer` title row + action toolbar)

/// The chart figure header — the title + optional subtitle on the leading edge and the trailing
/// action toolbar. Generic over the caller's `Action` slot (web `action` prop). Reads the resolved
/// state to gate the annotation toggle, export menu, and fullscreen button, and forwards taps to the
/// bound model so the view owns no decision logic.
struct ChartContainerHeader<Action: View>: View {
    let model: ChartContainerModel
    let resolved: ChartContainerResolved
    @Binding var expanded: Bool
    let renderImage: @MainActor () -> ChartContainerPlatformImage?
    let csv: @MainActor () -> String?
    let action: Action

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            titleBlock
            Spacer(minLength: 0)
            toolbar
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: model.content.title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let subtitle = model.content.subtitle, !subtitle.isEmpty {
                Text(verbatim: subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var toolbar: some View {
        HStack(spacing: TSSpacing.xs) {
            action
            if resolved.annotationsEnabled {
                addButton
                toggleButton
            }
            if resolved.showExportMenu {
                ChartContainerExportMenu(
                    hasCsv: model.content.hasExportData,
                    renderImage: renderImage,
                    csv: csv
                )
            }
            if model.content.fullscreen {
                ChartContainerFullscreenButton(expanded: $expanded)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var addButton: some View {
        Button {
            model.setAddFormOpen(true)
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: ChartContainerStrings.string("annotations.add", "Add annotation")))
    }

    private var toggleButton: some View {
        let hidden = resolved.hidden
        let label = hidden
            ? ChartContainerStrings.string("annotations.show", "Show annotations")
            : ChartContainerStrings.string("annotations.hide", "Hide annotations")
        return Button {
            model.toggleHidden()
        } label: {
            Image(systemName: hidden ? "eye.slash" : "eye")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(hidden ? Color.TS.textMuted : Color.TS.accent)
                .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(hidden ? .isSelected : [])
    }
}
