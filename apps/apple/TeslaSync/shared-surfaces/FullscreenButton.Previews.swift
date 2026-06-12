//
//  FullscreenButton.Previews.swift
//  TeslaSync — P4 shared surface · 0214 · FullscreenButton (Apple)
//
//  Xcode previews for each branch the web source renders: the resting "Enter fullscreen" button, the
//  active "Exit fullscreen" confirmation, a custom-label variant (web `ariaLabelEnter` /
//  `ariaLabelExit`), the detached-target no-op, the unsupported (hidden) branch, and a live toggle
//  demo wired to an in-memory presenter (so the enter / exit swap is visible in the canvas without the
//  real window server). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import SwiftUI

#if DEBUG
    /// A faux chart-toolbar row hosting the button on its trailing edge, so the control reads in
    /// context (its production home: the `ChartContainer` toolbar + the map fullscreen control).
    private struct FullscreenButtonPreviewRow<Trailing: View>: View {
        let title: String
        @ViewBuilder let trailing: Trailing

        var body: some View {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer()
                trailing
            }
            .padding(TSSpacing.md)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .padding()
            .background(Color.TS.bg)
        }
    }

    #Preview("Resting (Enter fullscreen)") {
        FullscreenButtonPreviewRow(title: "Battery degradation") {
            FullscreenButton(
                targetID: "chart.battery",
                presenter: InMemoryFullscreenPresenter()
            )
        }
    }

    #Preview("Active (Exit fullscreen)") {
        FullscreenButtonPreviewRow(title: "Battery degradation") {
            FullscreenButton(
                targetID: "chart.battery",
                presenter: InMemoryFullscreenPresenter(activeTargetID: "chart.battery")
            )
        }
    }

    #Preview("Custom labels") {
        FullscreenButtonPreviewRow(title: "Route map") {
            FullscreenButton(
                targetID: "map.route",
                presenter: InMemoryFullscreenPresenter(),
                ariaLabelEnter: "Expand map",
                ariaLabelExit: "Collapse map"
            )
        }
    }

    #Preview("Detached target (no-op)") {
        FullscreenButtonPreviewRow(title: "Loading chart") {
            FullscreenButton(
                targetID: nil,
                presenter: InMemoryFullscreenPresenter()
            )
        }
    }

    #Preview("Unsupported (hidden)") {
        FullscreenButtonPreviewRow(title: "Sandboxed embed") {
            FullscreenButton(
                targetID: "chart.embed",
                presenter: InMemoryFullscreenPresenter(isFullscreenSupported: false)
            )
        }
    }

    #Preview("Toggle demo (live presenter)") {
        @Previewable @State var presenter = InMemoryFullscreenPresenter()
        VStack(spacing: TSSpacing.md) {
            FullscreenButtonPreviewRow(title: "Speed profile") {
                FullscreenButton(targetID: "chart.speed", presenter: presenter)
            }
            Text(verbatim: "active: \(presenter.activeTargetID ?? "—")")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .background(Color.TS.bg)
    }
#endif
