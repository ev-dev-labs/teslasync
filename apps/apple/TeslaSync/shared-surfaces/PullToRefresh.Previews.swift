//
//  PullToRefresh.Previews.swift
//  TeslaSync — P4 shared surface · 0188 · PullToRefresh (Apple)
//
//  Xcode previews for the gesture lifecycle the web source supports — the indicator pill at each pull
//  phase (idle, pulling, ready, refreshing) rendered directly from the pure projection, plus the live
//  surface wrapping a sample list (forced to the coarse-pointer capability so the gesture path renders
//  on the Mac canvas too). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope. Reduce Motion is environment-driven (handled in the glyph + the snap-back) and toggled
//  through the canvas accessibility overrides.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 360, alignment: .center)
            .background(Color.TS.bg)
    }

    #Preview("Indicator — idle") {
        staged(PullToRefreshIndicator(pull: 0, refreshing: false, threshold: 80))
    }

    #Preview("Indicator — pulling") {
        staged(PullToRefreshIndicator(pull: 40, refreshing: false, threshold: 80))
    }

    #Preview("Indicator — ready to release") {
        staged(PullToRefreshIndicator(pull: 80, refreshing: false, threshold: 80))
    }

    #Preview("Indicator — refreshing") {
        staged(PullToRefreshIndicator(pull: 0, refreshing: true, threshold: 80))
    }

    #Preview("Surface — live list") {
        PullToRefresh(
            model: PullToRefreshModel(
                input: PullToRefreshInput(pointer: .coarse),
                onRefresh: { try? await Task.sleep(for: .seconds(1)) }
            )
        ) {
            VStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< 12, id: \.self) { row in
                    HStack {
                        Text(verbatim: "Vehicle signal \(row + 1)")
                            .font(Font.TS.body)
                            .foregroundStyle(Color.TS.textPrimary)
                        Spacer()
                        Text(verbatim: "\(row * 7 + 3)%")
                            .font(Font.TS.body)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    .padding(TSSpacing.md)
                    .tsGlassPanel(cornerRadius: TSRadius.md)
                }
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }
#endif
