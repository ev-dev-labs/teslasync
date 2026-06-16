import SwiftUI

// Widget-grid surfaces for the Command Center (web `DashboardGrid` + `WidgetPicker` +
// `KioskOverlay`): the responsive tile grid, one tile, the blank-layout empty state, the
// add-widget picker sheet, and the kiosk overlay. Split out of DashboardPage.Sections.swift
// to keep each file within the length budget. Native SwiftUI, design tokens only.

// MARK: - Widget grid (web `DashboardGrid` host)

/// The populated dashboard (web `DashboardGrid`): a responsive grid of the configured widget
/// tiles. In edit mode each tile gains a remove control; otherwise tapping a tile opens its
/// feature route. The per-widget live telemetry belongs to the individual widget parity units.
struct DashboardWidgetGrid: View {
    let widgets: [DashboardWidget]
    let editMode: Bool
    let vehicleName: String?
    let onOpen: (DashboardWidget) -> Void
    let onRemove: (DashboardWidget) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(widgets) { widget in
                DashboardOverviewTile(
                    widget: widget,
                    editMode: editMode,
                    subtitle: subtitle(for: widget),
                    onOpen: { onOpen(widget) },
                    onRemove: { onRemove(widget) }
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("dashboard.overview"))
    }

    /// The vehicle tile carries the resolved garage name (real `/vehicles` data); the rest are
    /// navigational summaries owned by their own widget units.
    private func subtitle(for widget: DashboardWidget) -> String? {
        widget == .vehicleHero ? vehicleName : nil
    }
}

/// One dashboard tile (web `DashboardWidgetTile`): a tinted icon, the widget's localized title,
/// an optional real subtitle, and a chevron (view mode) or a remove control (edit mode).
struct DashboardOverviewTile: View {
    let widget: DashboardWidget
    let editMode: Bool
    let subtitle: String?
    let onOpen: () -> Void
    let onRemove: () -> Void

    var body: some View {
        Button(action: onOpen) {
            tileBody
        }
        .buttonStyle(.plain)
        .disabled(editMode)
        .overlay(alignment: .topTrailing) {
            if editMode { removeButton }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(LocalizedStringKey(widget.titleKey)))
    }

    private var tileBody: some View {
        TSCard {
            HStack(spacing: TSSpacing.md) {
                TSIconBox(systemName: widget.systemImage, tone: widget.tone)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(LocalizedStringKey(widget.titleKey))
                        .font(Font.TS.panel).fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    if let subtitle {
                        Text(verbatim: subtitle)
                            .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                if !editMode {
                    Image(systemName: "chevron.right")
                        .font(.caption2).foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var removeButton: some View {
        Button(action: onRemove) {
            Image(systemName: "minus.circle.fill")
                .font(.system(size: 20))
                .symbolRenderingMode(.palette)
                .foregroundStyle(Color.white, Color.TS.statusDanger)
        }
        .buttonStyle(.plain)
        .padding(TSSpacing.xs)
        .accessibilityLabel(Text("dashboard.remove"))
    }
}

// MARK: - Empty layout state (web blank dashboard)

/// Shown when the dashboard has no widgets (after "New Dashboard"): a friendly empty state
/// with an "Add Widget" call-to-action, so a blank dashboard is never a dead region.
struct DashboardEmptyLayout: View {
    let onAddWidget: () -> Void

    var body: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "dashboard.noWidgets",
                message: "dashboard.noWidgetsHint",
                systemImage: "square.grid.2x2"
            ) {
                TSButton("dashboard.addWidget", action: onAddWidget)
            }
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Add-widget picker (web `WidgetPicker` / catalogue)

/// The add-widget sheet (web `WidgetPicker`): lists the seeded widgets not already on the
/// dashboard and adds the chosen one. Stays open for multiple picks; shows an all-added state
/// when the dashboard already holds every widget.
struct DashboardAddWidgetSheet: View {
    let model: DashboardPageModel
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if model.addableWidgets.isEmpty {
                    TSEmptyState(title: "dashboard.allWidgetsAdded", systemImage: "checkmark.circle")
                } else {
                    List(model.addableWidgets) { widget in
                        Button { model.addWidget(widget) } label: {
                            Label {
                                Text(LocalizedStringKey(widget.titleKey))
                                    .foregroundStyle(Color.TS.textPrimary)
                            } icon: {
                                Image(systemName: widget.systemImage)
                                    .foregroundStyle(widget.tone.color)
                            }
                        }
                        .accessibilityLabel(Text(LocalizedStringKey(widget.titleKey)))
                    }
                }
            }
            .navigationTitle(Text("dashboard.addWidget"))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("dashboard.done", action: onClose)
                }
            }
        }
    }
}

// MARK: - Kiosk overlay (web `KioskOverlay`)

/// The full-screen kiosk presentation (web kiosk portal): the dashboard tiles on a dimmed
/// backdrop with an exit control.
struct DashboardKioskOverlay: View {
    let widgets: [DashboardWidget]
    let vehicleName: String?
    let onExit: () -> Void

    var body: some View {
        ZStack {
            Color.TS.bg.opacity(0.96).ignoresSafeArea()
            ScrollView {
                DashboardWidgetGrid(
                    widgets: widgets,
                    editMode: false,
                    vehicleName: vehicleName,
                    onOpen: { _ in },
                    onRemove: { _ in }
                )
                .padding(TSSpacing.xl)
            }
            .safeAreaInset(edge: .top) { kioskBar }
        }
    }

    private var kioskBar: some View {
        HStack {
            Spacer()
            TSButton("dashboard.exitKiosk", variant: .secondary, size: .small, action: onExit)
        }
        .padding(TSSpacing.md)
    }
}
