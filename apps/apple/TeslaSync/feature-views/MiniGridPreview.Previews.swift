//
//  MiniGridPreview.Previews.swift
//  TeslaSync — P4 feature view · 0128 · MiniGridPreview (Apple)
//
//  Xcode previews for each branch the web source carries: a populated multi-row
//  layout (icons resolved through the default catalog), a single-widget layout,
//  a dense layout, an unknown-widget tile (no icon — web `getWidgetDef` miss),
//  the empty layout (friendly empty state), and a dark-scheme render. DEBUG-only;
//  skipped by the release host gate.
//

import SwiftUI

#if DEBUG
    /// A silent telemetry sink so previews don't emit `view.opened` noise.
    private struct SilentMiniGridPreviewTelemetry: MiniGridPreviewTelemetry {
        func viewOpened(surface _: String) {}
    }

    private extension MiniGridPreview {
        /// Preview convenience: builds a preview with the silent telemetry sink.
        static func preview(dashboard: MiniGridDashboard) -> MiniGridPreview {
            MiniGridPreview(dashboard: dashboard, telemetry: SilentMiniGridPreviewTelemetry())
        }
    }

    private enum MiniGridPreviewSamples {
        /// A varied multi-row layout exercising spans + several icon families.
        static let populated = MiniGridDashboard(
            widgets: [
                MiniGridWidgetInstance(instanceID: "a", widgetID: "battery-radial-gauge"),
                MiniGridWidgetInstance(instanceID: "b", widgetID: "fleet-stats"),
                MiniGridWidgetInstance(instanceID: "c", widgetID: "charge-status"),
                MiniGridWidgetInstance(instanceID: "d", widgetID: "climate-status"),
                MiniGridWidgetInstance(instanceID: "e", widgetID: "speed-profile")
            ],
            layouts: ["lg": [
                MiniGridLayoutItem(identifier: "a", x: 0, y: 0, widthUnits: 2, heightUnits: 2),
                MiniGridLayoutItem(identifier: "b", x: 2, y: 0, widthUnits: 2, heightUnits: 1),
                MiniGridLayoutItem(identifier: "c", x: 2, y: 1, widthUnits: 1, heightUnits: 1),
                MiniGridLayoutItem(identifier: "d", x: 3, y: 1, widthUnits: 1, heightUnits: 1),
                MiniGridLayoutItem(identifier: "e", x: 0, y: 2, widthUnits: 4, heightUnits: 1)
            ]]
        )

        /// One large widget — exercises the single-tile + aspect path.
        static let single = MiniGridDashboard(
            widgets: [MiniGridWidgetInstance(instanceID: "hero", widgetID: "vehicle-hero")],
            layouts: ["lg": [
                MiniGridLayoutItem(identifier: "hero", x: 0, y: 0, widthUnits: 2, heightUnits: 2)
            ]]
        )

        /// A dense 4×2 grid plus an unknown-widget tile (no icon — registry miss).
        static let dense = MiniGridDashboard(
            widgets: [
                MiniGridWidgetInstance(instanceID: "t1", widgetID: "drive-score-gauge"),
                MiniGridWidgetInstance(instanceID: "t2", widgetID: "energy-stats"),
                MiniGridWidgetInstance(instanceID: "t3", widgetID: "tire-pressure-visual"),
                MiniGridWidgetInstance(instanceID: "t4", widgetID: "guard-mode"),
                MiniGridWidgetInstance(instanceID: "t5", widgetID: "location-map"),
                MiniGridWidgetInstance(instanceID: "t6", widgetID: "media-now-playing"),
                MiniGridWidgetInstance(instanceID: "t7", widgetID: "system-health"),
                MiniGridWidgetInstance(instanceID: "t8", widgetID: "not-a-real-widget")
            ],
            layouts: ["lg": [
                MiniGridLayoutItem(identifier: "t1", x: 0, y: 0, widthUnits: 1, heightUnits: 1),
                MiniGridLayoutItem(identifier: "t2", x: 1, y: 0, widthUnits: 1, heightUnits: 1),
                MiniGridLayoutItem(identifier: "t3", x: 2, y: 0, widthUnits: 1, heightUnits: 1),
                MiniGridLayoutItem(identifier: "t4", x: 3, y: 0, widthUnits: 1, heightUnits: 1),
                MiniGridLayoutItem(identifier: "t5", x: 0, y: 1, widthUnits: 1, heightUnits: 1),
                MiniGridLayoutItem(identifier: "t6", x: 1, y: 1, widthUnits: 1, heightUnits: 1),
                MiniGridLayoutItem(identifier: "t7", x: 2, y: 1, widthUnits: 1, heightUnits: 1),
                MiniGridLayoutItem(identifier: "t8", x: 3, y: 1, widthUnits: 1, heightUnits: 1)
            ]]
        )

        /// No widgets — the friendly empty state.
        static let empty = MiniGridDashboard(widgets: [], layouts: ["lg": []])
    }

    #Preview("Layouts") {
        HStack(spacing: TSSpacing.lg) {
            MiniGridPreview.preview(dashboard: MiniGridPreviewSamples.populated)
                .frame(width: 200)
            MiniGridPreview.preview(dashboard: MiniGridPreviewSamples.single)
                .frame(width: 160)
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }

    #Preview("Dense · unknown tile") {
        MiniGridPreview.preview(dashboard: MiniGridPreviewSamples.dense)
            .frame(width: 240)
            .padding(TSSpacing.lg)
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MiniGridPreview.preview(dashboard: MiniGridPreviewSamples.empty)
            .frame(width: 220)
            .padding(TSSpacing.lg)
            .background(Color.TS.bg)
    }

    #Preview("Dark") {
        MiniGridPreview.preview(dashboard: MiniGridPreviewSamples.populated)
            .frame(width: 240)
            .padding(TSSpacing.lg)
            .background(Color.TS.bg)
            .preferredColorScheme(.dark)
    }
#endif
