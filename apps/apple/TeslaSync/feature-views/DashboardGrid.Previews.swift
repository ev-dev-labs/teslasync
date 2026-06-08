//
//  DashboardGrid.Previews.swift
//  TeslaSync — P4 feature view · 0122 · DashboardGrid (Apple)
//
//  #if DEBUG previews — one per state + branch of the web source: loaded (view
//  mode), edit mode (drag chrome + dot grid), kiosk boost + widget borders, the
//  compact gaps, the stale + offline freshness chips, and the loading / empty /
//  error chrome. Previews use the bundle-free `.echo` localizer so the English copy
//  renders without the folded catalog, no-op actions so they are side-effect-free,
//  and a small representative widget body (the parent's registry renderer stand-in).
//

#if DEBUG
    import SwiftUI

    @MainActor
    private enum DashboardGridPreview {
        static let actions = DashboardGridActions(
            onRemoveWidget: { _ in },
            onOpenSettings: { _ in }
        )

        static func widgets() -> [DashboardWidgetInstance] {
            [
                DashboardWidgetInstance(
                    id: "w-vehicle",
                    widgetId: "vehicle-hero",
                    name: "Vehicle",
                    defaultSize: DashboardWidgetSpan(cols: 2, rows: 3)
                ),
                DashboardWidgetInstance(
                    id: "w-battery",
                    widgetId: "battery",
                    name: "Battery",
                    defaultSize: DashboardWidgetSpan(cols: 1, rows: 2)
                ),
                DashboardWidgetInstance(
                    id: "w-charging",
                    widgetId: "charging",
                    name: "Charging",
                    defaultSize: DashboardWidgetSpan(cols: 1, rows: 2)
                ),
                DashboardWidgetInstance(
                    id: "w-energy",
                    widgetId: "energy",
                    name: "Energy",
                    defaultSize: DashboardWidgetSpan(cols: 2, rows: 2)
                )
            ]
        }

        static func layouts() -> DashboardGridLayouts {
            DashboardGridLayouts([
                .lg: [
                    DashboardGridLayoutItem(id: "w-vehicle", x: 0, y: 0, columnSpan: 2, rowSpan: 3),
                    DashboardGridLayoutItem(id: "w-battery", x: 2, y: 0, columnSpan: 1, rowSpan: 2),
                    DashboardGridLayoutItem(id: "w-charging", x: 3, y: 0, columnSpan: 1, rowSpan: 2),
                    DashboardGridLayoutItem(id: "w-energy", x: 2, y: 2, columnSpan: 2, rowSpan: 2)
                ],
                .xs: [
                    DashboardGridLayoutItem(id: "w-battery", x: 0, y: 0, columnSpan: 1, rowSpan: 2),
                    DashboardGridLayoutItem(id: "w-vehicle", x: 0, y: 2, columnSpan: 1, rowSpan: 3),
                    DashboardGridLayoutItem(id: "w-charging", x: 0, y: 5, columnSpan: 1, rowSpan: 2),
                    DashboardGridLayoutItem(id: "w-energy", x: 0, y: 7, columnSpan: 1, rowSpan: 2)
                ]
            ])
        }

        static func dashboard() -> DashboardGridData {
            DashboardGridData(id: "primary", name: "Overview", widgets: widgets(), layouts: layouts())
        }

        static func grid(
            _ state: DashboardGridState,
            connection: DashboardGridConnection = .live,
            options: DashboardGridOptions = DashboardGridOptions()
        ) -> some View {
            DashboardGrid(
                state: state,
                connection: connection,
                options: options,
                actions: actions,
                localize: .echo
            ) { context in
                SampleWidgetBody(context: context)
            }
        }
    }

    /// A small representative widget body standing in for the parent's registry
    /// renderer (web `def.component`) so the composition, chrome, and states render
    /// in isolation.
    private struct SampleWidgetBody: View {
        let context: DashboardWidgetRenderContext

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: symbol)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.TS.accent)
                    Text(verbatim: context.name)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                Text(verbatim: value)
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }

        private var symbol: String {
            switch context.widgetId {
            case "vehicle-hero": "car.fill"
            case "battery": "battery.75percent"
            case "charging": "bolt.fill"
            case "energy": "leaf.fill"
            default: "square.grid.2x2"
            }
        }

        private var value: String {
            switch context.widgetId {
            case "vehicle-hero": "Model 3"
            case "battery": "72%"
            case "charging": "11 kW"
            case "energy": "248 Wh/mi"
            default: "—"
            }
        }
    }

    #Preview("Loaded · view mode") {
        DashboardGridPreview.grid(.loaded(DashboardGridPreview.dashboard()))
            .frame(width: 1280, height: 560)
            .background(Color.TS.bg)
    }

    #Preview("Edit mode · chrome + dot grid") {
        DashboardGridPreview.grid(
            .loaded(DashboardGridPreview.dashboard()),
            options: DashboardGridOptions(editMode: true)
        )
        .frame(width: 1280, height: 560)
        .background(Color.TS.bg)
    }

    #Preview("Kiosk + borders + compact") {
        DashboardGridPreview.grid(
            .loaded(DashboardGridPreview.dashboard()),
            options: DashboardGridOptions(
                compactMode: true,
                showWidgetBorders: true,
                kioskWidgetOpacity: 0.8
            )
        )
        .frame(width: 1280, height: 560)
        .background(Color.TS.bg)
    }

    #Preview("Mobile stack (xs)") {
        DashboardGridPreview.grid(.loaded(DashboardGridPreview.dashboard()))
            .frame(width: 380, height: 720)
            .background(Color.TS.bg)
    }

    #Preview("Freshness · stale / offline") {
        VStack(spacing: TSSpacing.lg) {
            DashboardGridPreview.grid(.loaded(DashboardGridPreview.dashboard()), connection: .stale)
                .frame(height: 280)
            DashboardGridPreview.grid(.loaded(DashboardGridPreview.dashboard()), connection: .offline)
                .frame(height: 280)
        }
        .frame(width: 1000)
        .background(Color.TS.bg)
    }

    #Preview("Chrome · loading / empty / error") {
        TabView {
            DashboardGridPreview.grid(.loading)
                .tabItem { Text(verbatim: "Loading") }
            DashboardGridPreview.grid(.empty)
                .tabItem { Text(verbatim: "Empty") }
            DashboardGridPreview.grid(.error(message: nil))
                .tabItem { Text(verbatim: "Error") }
        }
        .frame(width: 900, height: 540)
        .background(Color.TS.bg)
    }
#endif
