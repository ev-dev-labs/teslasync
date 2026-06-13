//
//  SuspenseProgressBoundary.Previews.swift
//  TeslaSync — P4 shared surface · 0141 · SuspenseProgressBoundary (Apple)
//
//  Xcode previews for the boundary's genuine render branches — the mounted fallback (loading, bar
//  trickling) and the resolved children (content, bar gone) — plus an interactive toggle that flips
//  readiness so the bridge and the trickle can be exercised live, and a standalone bar preview seeded to
//  a fixed fill. Each preview injects a dedicated `SuspenseProgressController` so the shared channel
//  stays untouched. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope. Reduce Motion is environment-driven (handled in the bar / container) and toggled through the
//  canvas accessibility overrides.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 420, minHeight: 220, alignment: .center)
            .background(Color.TS.bg)
    }

    private struct SampleContent: View {
        var body: some View {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "bolt.car.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(Color.TS.accent)
                Text(verbatim: "Fleet dashboard")
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: "3 vehicles · 2 charging")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private struct SampleFallback: View {
        var body: some View {
            VStack(spacing: TSSpacing.md) {
                ProgressView()
                Text(verbatim: "Loading route chunk…")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @MainActor
    private func loadingController() -> SuspenseProgressController {
        let controller = SuspenseProgressController()
        controller.start()
        for _ in 0 ..< 10 {
            controller.advance()
        }
        return controller
    }

    #Preview("Loading — fallback + trickling bar") {
        staged(
            SuspenseProgressBoundary(
                isReady: false,
                controller: loadingController()
            ) {
                SampleContent()
            } fallback: {
                SampleFallback()
            }
        )
    }

    #Preview("Resolved — content, bar gone") {
        staged(
            SuspenseProgressBoundary(
                isReady: true,
                controller: SuspenseProgressController()
            ) {
                SampleContent()
            } fallback: {
                SampleFallback()
            }
        )
    }

    private struct InteractiveBoundaryPreview: View {
        @State private var isReady = false
        private let controller = SuspenseProgressController()

        var body: some View {
            VStack(spacing: TSSpacing.lg) {
                SuspenseProgressBoundary(isReady: isReady, controller: controller) {
                    SampleContent()
                } fallback: {
                    SampleFallback()
                }
                .frame(height: 140)

                Toggle(isOn: $isReady) {
                    Text(verbatim: "Child resolved")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .tint(Color.TS.accent)
            }
        }
    }

    #Preview("Interactive — flip readiness") {
        staged(InteractiveBoundaryPreview())
    }

    #Preview("Bar — seeded fill") {
        staged(
            VStack(spacing: TSSpacing.x2xl) {
                SuspenseProgressBar(controller: loadingController())
                Text(verbatim: "Top progress bar")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        )
    }
#endif
