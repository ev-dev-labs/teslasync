//
//  SectionErrorBoundary.Previews.swift
//  TeslaSync — P4 shared surface · 0138 · SectionErrorBoundary (Apple)
//
//  Xcode previews for each surface state (healthy content / loading / empty / caught-inline /
//  caught-title / caught-custom / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    /// A representative guarded section (the parity of a wrapped chart / widget) for the previews.
    private struct SectionBoundaryPreviewContent: View {
        var body: some View {
            TSCard {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    Text(verbatim: "Battery Degradation")
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: "98.2% capacity retained over the last 24,000 km")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    /// Builds an optional no-op handler, sidestepping the `cond ? {} : nil` inference limitation for
    /// `@MainActor` closures by returning the closure from an explicitly-typed function.
    @MainActor
    private func previewHandler(_ enabled: Bool) -> (@MainActor () -> Void)? {
        guard enabled else { return nil }
        return {}
    }

    @MainActor
    private func previewModel(
        _ input: SectionErrorBoundaryInput,
        mode: SectionBoundaryFallbackMode = .inline,
        retry: Bool = true
    ) -> SectionErrorBoundaryModel {
        let source = InMemorySectionErrorBoundarySource(initial: input)
        let model = SectionErrorBoundaryModel(
            name: "BatteryDegradationChart",
            mode: mode,
            source: source,
            onRetry: previewHandler(retry)
        )
        model.start()
        return model
    }

    #Preview("Content") {
        SectionErrorBoundary(model: previewModel(SectionErrorBoundaryInput())) {
            SectionBoundaryPreviewContent()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Caught — inline") {
        SectionErrorBoundary(model: previewModel(
            SectionErrorBoundaryInput(
                error: SectionBoundaryError(message: "Cannot read properties of undefined (reading 'soc')")
            )
        )) {
            SectionBoundaryPreviewContent()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Caught — title") {
        SectionErrorBoundary(model: previewModel(
            SectionErrorBoundaryInput(error: SectionBoundaryError(message: "render failed")),
            mode: .title("Battery degradation chart unavailable")
        )) {
            SectionBoundaryPreviewContent()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Caught — custom") {
        SectionErrorBoundary(model: previewModel(
            SectionErrorBoundaryInput(error: SectionBoundaryError(message: "render failed")),
            mode: .custom
        )) {
            SectionBoundaryPreviewContent()
        } fallback: {
            TSCard {
                Text(verbatim: "—")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SectionErrorBoundary(model: previewModel(SectionErrorBoundaryInput(isLoading: true))) {
            SectionBoundaryPreviewContent()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SectionErrorBoundary(model: previewModel(SectionErrorBoundaryInput(hasContent: false))) {
            SectionBoundaryPreviewContent()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SectionErrorBoundary(model: previewModel(SectionErrorBoundaryInput(connection: .stale))) {
            SectionBoundaryPreviewContent()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SectionErrorBoundary(model: previewModel(SectionErrorBoundaryInput(connection: .offline))) {
            SectionBoundaryPreviewContent()
        }
        .padding()
        .background(Color.TS.bg)
    }
#endif
