//
//  SignalsWorkspacePageViews.swift
//  TeslaSync — P4 feature view · P7 · SignalsWorkspacePage (Apple)
//
//  Shared chrome + the headline / toolbar / catalog / compare-stats panels:
//    1 Selected · 2 Mode · 3 Live-rate · 4 Pinned-signals   (HeadlineStrip)
//    5 GlassPanel5                                          (WorkspaceToolbar)
//    6 Changed-signals · 7 Visible-after-filter · 8 Pinned · 9 Window-span
//                                                           (CompareStatsStrip)
//    11 GlassPanel11 (catalog half)                         (SignalCatalogSection)
//  plus the four reusable data-state views (loading / empty / error / success).
//

import SwiftUI

// MARK: - Glass panel container (ADR-005 materials)

/// Material-backed rounded container standing in for the web `GlassPanel`.
struct WorkspacePanel<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(.white.opacity(0.08), lineWidth: 1)
            )
    }
}

// MARK: - Stat card (headline + compare metrics)

/// A single metric tile (web `StatCard`). Used for panels 1–4 and 6–9.
struct WorkspaceStatCard: View {
    let label: String
    let value: String
    let systemImage: String

    var body: some View {
        WorkspacePanel {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: systemImage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(label)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text(value)
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }
}

// MARK: - Data-state views (loading / empty / error / success)

/// Loading state — redacted skeleton rows (ADR-011 "never a blank region").
struct WorkspaceStateLoading: View {
    var rows: Int = 4
    var label: String = "Loading"

    var body: some View {
        VStack(spacing: 10) {
            ForEach(0..<rows, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(.quaternary)
                    .frame(height: 44)
            }
        }
        .redacted(reason: .privacy)
        .overlay(alignment: .center) { ProgressView() }
        .accessibilityLabel(label)
    }
}

/// Empty state — `ContentUnavailableView` (HIG-native).
struct WorkspaceStateEmpty: View {
    let title: String
    let message: String
    var systemImage: String = "tray"

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(message)
        }
        .accessibilityLabel(title)
    }
}

/// Error state — message + Retry CTA.
struct WorkspaceStateError: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(WSText.loadFailed, systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Retry", systemImage: "arrow.clockwise", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .accessibilityLabel("\(WSText.loadFailed). \(message)")
    }
}

// MARK: - Panels 1–4 · Headline strip

/// Headline metrics: Selected · Mode · Live-rate · Pinned-signals.
struct HeadlineStrip: View {
    @Bindable var model: SignalsWorkspacePageModel
    let columns: [GridItem]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            WorkspaceStatCard(
                label: WSText.selected,
                value: "\(model.selectedCount)",
                systemImage: "arrow.up.arrow.down"
            )
            WorkspaceStatCard(
                label: WSText.mode,
                value: model.modeLabel,
                systemImage: modeIcon
            )
            WorkspaceStatCard(
                label: WSText.liveRate,
                value: model.liveRateText,
                systemImage: "dot.radiowaves.left.and.right"
            )
            WorkspaceStatCard(
                label: WSText.pinned,
                value: "\(model.pinnedCount)",
                systemImage: "pin"
            )
        }
    }

    private var modeIcon: String {
        switch model.mode {
        case .compare: "arrow.left.arrow.right"
        case .live: "dot.radiowaves.left.and.right"
        case .historical: "cylinder.split.1x2"
        }
    }
}

// MARK: - Panel 5 · Workspace toolbar (GlassPanel5)

/// Time range / Per page / Run / Live / Compare controls + help (web GlassPanel).
struct WorkspaceToolbar: View {
    @Bindable var model: SignalsWorkspacePageModel
    let onRun: () -> Void

    var body: some View {
        WorkspacePanel {
            VStack(alignment: .leading, spacing: 14) {
                rangeRow
                Divider()
                controlsRow
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var rangeRow: some View {
        if model.mode != .compare {
            VStack(alignment: .leading, spacing: 6) {
                Text(WSText.timeRange)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { rangePickers }
                    VStack(alignment: .leading, spacing: 10) { rangePickers }
                }
            }
        }
    }

    @ViewBuilder private var rangePickers: some View {
        DatePicker("From", selection: $model.rangeStart, displayedComponents: [.date, .hourAndMinute])
            .labelsHidden()
        Image(systemName: "arrow.right").foregroundStyle(.secondary)
        DatePicker("To", selection: $model.rangeEnd, displayedComponents: [.date, .hourAndMinute])
            .labelsHidden()
    }

    private var controlsRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { controls }
            VStack(alignment: .leading, spacing: 10) { controls }
        }
    }

    @ViewBuilder private var controls: some View {
        if model.mode == .historical {
            perPagePicker
            Button(WSText.run, systemImage: "cylinder.split.1x2", action: onRun)
                .buttonStyle(.borderedProminent)
                .disabled(!model.canRunHistory)
        }
        Button(role: model.mode == .live ? .destructive : nil) {
            model.toggleLive()
        } label: {
            Label(
                model.mode == .live ? WSText.stopLive : WSText.live,
                systemImage: "dot.radiowaves.left.and.right"
            )
        }
        .buttonStyle(.bordered)
        .disabled(model.selectedSignals.isEmpty && model.mode != .live)

        compareButton
        liveHelp
    }

    @ViewBuilder private var compareButton: some View {
        if model.mode == .compare {
            Button { model.toggleCompare() } label: {
                Label(WSText.exitCompare, systemImage: "arrow.left.arrow.right")
            }
            .buttonStyle(.borderedProminent)
        } else {
            Button { model.toggleCompare() } label: {
                Label(WSText.compare, systemImage: "arrow.left.arrow.right")
            }
            .buttonStyle(.bordered)
        }
    }

    private var perPagePicker: some View {
        Picker(WSText.perPage, selection: $model.perPage) {
            ForEach(model.perPageOptions, id: \.self) { option in
                Text("\(option)").tag(option)
            }
        }
        .pickerStyle(.menu)
        .onChange(of: model.perPage) { _, _ in model.page = 1 }
        .accessibilityLabel(WSText.perPage)
    }

    private var liveHelp: some View {
        Image(systemName: "questionmark.circle")
            .foregroundStyle(.secondary)
            .help(WSText.liveHelpAria)
            .accessibilityLabel(WSText.liveHelpAria)
    }
}

// MARK: - Catalog section (GlassPanel11, catalog half)

/// "Add signals" disclosure with category tree (web Accordion + SignalCategoryTree).
/// Renders the useSignals data states (loading / empty / error / success).
struct SignalCatalogSection: View {
    @Bindable var model: SignalsWorkspacePageModel

    var body: some View {
        WorkspacePanel {
            DisclosureGroup(isExpanded: $model.catalogOpen) {
                catalogBody.padding(.top, 10)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "list.bullet.indent")
                    Text(WSText.addSignals).fontWeight(.semibold)
                    Spacer()
                    Text(badgeText)
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(.tint.opacity(0.15), in: Capsule())
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var badgeText: String {
        model.selectedCount > 0 ? WSText.signalsSelected(model.selectedCount) : WSText.noneSelected
    }

    @ViewBuilder private var catalogBody: some View {
        switch model.signalsPhase {
        case .loading:
            WorkspaceStateLoading(rows: 5, label: WSText.addSignals)
        case .empty:
            WorkspaceStateEmpty(
                title: WSText.noVehicle,
                message: WSText.noVehicleDesc,
                systemImage: "antenna.radiowaves.left.and.right.slash"
            )
        case let .error(message):
            WorkspaceStateError(message: message) { Task { await model.retryCatalog() } }
        case .success:
            catalogTree
        }
    }

    private var catalogTree: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Search", text: $model.catalogSearch)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Search signals")
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(model.filteredCategories(), id: \.category.id) { group in
                        categoryDisclosure(group.category, signals: group.signals)
                    }
                }
            }
            .frame(maxHeight: 360)
        }
    }

    private func categoryDisclosure(_ category: SignalCategory, signals: [String]) -> some View {
        DisclosureGroup(isExpanded: expansionBinding(category.key)) {
            ForEach(signals, id: \.self) { signal in
                signalRow(signal)
            }
        } label: {
            Text("\(category.title) (\(signals.count))").font(.subheadline).fontWeight(.medium)
        }
    }

    private func signalRow(_ signal: String) -> some View {
        Button {
            model.toggleSignal(signal)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: model.isSelected(signal) ? "checkmark.square.fill" : "square")
                    .foregroundStyle(model.isSelected(signal) ? Color.accentColor : Color.secondary)
                Text(signal).font(.system(.body, design: .monospaced))
                Spacer()
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(model.isSelected(signal) ? [.isSelected] : [])
    }

    private func expansionBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: { model.expandedCategories.contains(key) },
            set: { _ in model.toggleCategoryExpanded(key) }
        )
    }
}

// MARK: - Panels 6–9 · Compare stats strip

/// Compare metrics: Changed-signals · Visible-after-filter · Pinned · Window-span.
struct CompareStatsStrip: View {
    @Bindable var model: SignalsWorkspacePageModel
    let columns: [GridItem]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            WorkspaceStatCard(
                label: WSText.totalChanged,
                value: model.diffPhase == .loading ? "—" : "\(model.changedCount)",
                systemImage: "arrow.left.arrow.right"
            )
            WorkspaceStatCard(
                label: WSText.visibleAfterFilter,
                value: model.diffPhase == .loading ? "—" : "\(model.visibleCount)",
                systemImage: "line.3.horizontal.decrease.circle"
            )
            WorkspaceStatCard(
                label: WSText.pinnedCount,
                value: "\(model.pinnedCount)",
                systemImage: "pin"
            )
            WorkspaceStatCard(
                label: WSText.windowSpan,
                value: model.windowSpanText,
                systemImage: "clock.arrow.2.circlepath"
            )
        }
    }
}
