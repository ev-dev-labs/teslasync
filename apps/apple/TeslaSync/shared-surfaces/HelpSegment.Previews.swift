//
//  HelpSegment.Previews.swift
//  TeslaSync — P4 shared surface · 0179 · HelpSegment (Apple)
//
//  Xcode previews for every real branch of the footer help segment: the three display densities (icon-only,
//  compact = icon + `?` key cap, and the wide form = icon + key cap + action labels), the mounted public
//  surface in its `iconOnly` and default forms, and a dark-scheme rendering. Each preview injects a model
//  with an English resolver + no-op action handlers so no notification fires. The per-density rows are built
//  straight from the projector so they render the same on iOS, iPadOS, and macOS regardless of the size
//  class. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel() -> HelpSegmentModel {
        HelpSegmentModel(
            resolve: { _, fallback in fallback },
            actions: HelpSegmentActions(openShortcuts: {}, openTour: {}, openFeedback: {})
        )
    }

    @MainActor
    private func densityRow(_ density: HelpSegmentDensity, model: HelpSegmentModel) -> some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(model.projection(density: density).actions) { action in
                HelpSegmentButton(projection: action, model: model)
            }
        }
    }

    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("All densities") {
        let model = previewModel()
        return staged("icon-only · compact · wide") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                densityRow(.iconOnly, model: model)
                densityRow(.compact, model: model)
                densityRow(.full, model: model)
            }
        }
    }

    #Preview("Mounted — default (wide on regular width)") {
        staged("iconOnly: false") {
            HelpSegment(iconOnly: false, model: previewModel())
        }
    }

    #Preview("Mounted — iconOnly") {
        staged("iconOnly: true") {
            HelpSegment(iconOnly: true, model: previewModel())
        }
    }

    #Preview("Dark — all densities") {
        let model = previewModel()
        return staged("dark scheme") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                densityRow(.iconOnly, model: model)
                densityRow(.compact, model: model)
                densityRow(.full, model: model)
            }
        }
        .preferredColorScheme(.dark)
    }
#endif
