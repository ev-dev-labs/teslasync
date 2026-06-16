import SwiftUI

// The session list: the controls bar (count + sort + density), the bulk-delete toolbar, the
// date-grouped rows with their per-day headers, pagination, and every list empty state (web
// `common.noData` controls empty, and the `emptyTitle` / `emptyForCollection` list empty
// with the reset CTA).

// MARK: - List section (web list controls + DateGroupedList + Pagination + empties)

struct ChargingListSection: View {
    @Bindable var model: ChargingListPageModel
    @State private var confirmingDelete = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.sortedSessions.isEmpty {
                TSEmptyState(title: "common.noData", systemImage: "bolt.slash")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, TSSpacing.lg)
            } else {
                controls
                list
            }
        }
    }

    // MARK: Controls (web "All sessions" header + SortControl + DensityToggle)

    private var controls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: TSSpacing.md) { controlsContent }
            VStack(alignment: .leading, spacing: TSSpacing.sm) { controlsContent }
        }
    }

    @ViewBuilder
    private var controlsContent: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "powerplug.fill").font(.caption).foregroundStyle(Color.TS.statusSuccess)
            TSPanelTitle("charging.allSessions")
            Text(verbatim: "(\(ChargingListFormat.compact(Double(model.sortedSessions.count))))")
                .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        Spacer(minLength: TSSpacing.sm)
        HStack(spacing: TSSpacing.sm) {
            sortControl
            densityToggle
        }
    }

    private var sortControl: some View {
        HStack(spacing: TSSpacing.xs) {
            Picker(selection: sortFieldBinding) {
                ForEach(ChargingSortField.allCases) { field in
                    Text(LocalizedStringKey(field.labelKey)).tag(field)
                }
            } label: {
                Text("charging.sort.label")
            }
            .pickerStyle(.menu)
            .labelsHidden()
            Button {
                model.setSortDescending(!model.sortDescending)
            } label: {
                Image(systemName: model.sortDescending ? "arrow.down" : "arrow.up")
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.accent)
            .accessibilityLabel(Text(model.sortDescending ? "sort.descending" : "sort.ascending"))
        }
    }

    private var densityToggle: some View {
        Picker(selection: densityBinding) {
            Image(systemName: "rectangle.grid.1x2").tag(ChargingDensity.comfortable)
            Image(systemName: "list.bullet").tag(ChargingDensity.compact)
        } label: {
            Text("charging.density.label")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(maxWidth: 96)
        .accessibilityLabel(Text("charging.density.label"))
    }

    // MARK: List body (web bulk toolbar + grouped rows + pagination / empty)

    @ViewBuilder
    private var list: some View {
        if model.paginatedSessions.isEmpty {
            listEmpty
        } else {
            if !model.selectedIDs.isEmpty {
                bulkBar
            }
            ForEach(model.groupedSessions) { group in
                ChargingDayGroupView(group: group, model: model)
            }
            if model.pageCount > 1 {
                TSPagination(currentPage: pageBinding, pageCount: model.pageCount)
            }
        }
    }

    private var bulkBar: some View {
        let count = model.selectedIDs.count
        let noun = count == 1
            ? String(localized: "bulk.noun.session_one")
            : String(localized: "bulk.noun.session_other")
        return HStack(spacing: TSSpacing.md) {
            Text(verbatim: "\(count) \(noun)")
                .font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
            Spacer()
            Button(role: .destructive) {
                confirmingDelete = true
            } label: {
                Label("bulk.actions.delete", systemImage: "trash")
            }
            .disabled(model.isDeleting)
            Button("table.clearSelection") { model.clearSelection() }
                .buttonStyle(.plain)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.accent)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .confirmationDialog(
            Text(verbatim: String(format: String(localized: "bulk.deleteConfirmTitle"), count, noun)),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button("common.delete", role: .destructive) {
                Task { await model.deleteSelected() }
            }
        } message: {
            Text("bulk.deleteConfirmDescription")
        }
    }

    private var listEmpty: some View {
        let isFiltered = model.collection != .all
        return TSEmptyState(
            title: isFiltered ? "charging.emptyForCollection" : "charging.emptyTitle",
            message: isFiltered ? "charging.emptyForCollection.msg" : "charging.emptyMessage",
            systemImage: "minus.plus.batteryblock"
        ) {
            TSButton("charging.empty.cta", variant: .secondary, size: .small) {
                model.resetFilters()
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    // MARK: Bindings

    private var sortFieldBinding: Binding<ChargingSortField> {
        Binding(get: { model.sortField }, set: { model.setSort(field: $0) })
    }

    private var densityBinding: Binding<ChargingDensity> {
        Binding(get: { model.density }, set: { model.density = $0 })
    }

    private var pageBinding: Binding<Int> {
        Binding(get: { model.page }, set: { model.goToPage($0) })
    }
}

// MARK: - Date group (web `DateGroupedList` group: header + rows)

/// One day bucket of the list (web `DateGroupedListGroup`): the long date + relative label +
/// per-day summary header, then the day's session rows.
struct ChargingDayGroupView: View {
    let group: ChargingDayGroup
    let model: ChargingListPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: group.dateLabel).font(Font.TS.bodySm).fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if !group.relativeLabel.isEmpty {
                    Text(verbatim: group.relativeLabel).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                }
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: group.summary).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
            }
            ForEach(group.sessions) { session in
                ChargingSessionRow(
                    session: session,
                    anomaly: model.anomalyByID[session.id],
                    isSelected: model.isSelected(session.id),
                    density: model.density,
                    symbol: model.currencySymbol,
                    onToggle: { model.toggleSelected(session.id, $0) }
                )
            }
        }
    }
}

// MARK: - Session row (web `ChargingSessionCard`, page-level compact form)

/// One charging session row (web `ChargingSessionCard`): a selection toggle, the start time,
/// the charger type + place, an inline anomaly badge, and the kWh / cost / duration / power
/// metrics. Energy / power format from SI at the boundary; cost applies the currency symbol.
struct ChargingSessionRow: View {
    let session: ChargingSession
    let anomaly: ChargingAnomaly?
    let isSelected: Bool
    let density: ChargingDensity
    let symbol: String
    let onToggle: (Bool) -> Void

    var body: some View {
        TSCard {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                selectionToggle
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: TSSpacing.sm) {
                        Text(verbatim: timeText).font(Font.TS.bodySm).fontWeight(.medium)
                            .foregroundStyle(Color.TS.textPrimary)
                        categoryChip
                        if let anomaly { anomalyBadge(anomaly) }
                    }
                    if let place = session.startPlace, !place.isEmpty {
                        Text(verbatim: place).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: TSSpacing.sm)
                metrics
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var selectionToggle: some View {
        Button {
            onToggle(!isSelected)
        } label: {
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textMuted)
                .font(.title3)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(isSelected ? "table.deselectRow" : "table.selectRow"))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private var categoryChip: some View {
        HStack(spacing: 2) {
            Image(systemName: session.category.collection.systemImage).font(.caption2)
            categoryLabel.font(Font.TS.caption)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.surface, in: Capsule())
        .foregroundStyle(Color.TS.textSecondary)
        .lineLimit(1)
    }

    /// The charger type verbatim, or the category's localized label when unknown.
    @ViewBuilder
    private var categoryLabel: some View {
        if let type = session.chargerType, !type.isEmpty {
            Text(verbatim: type)
        } else {
            Text(LocalizedStringKey(session.category.collection.labelKey))
        }
    }

    private func anomalyBadge(_ anomaly: ChargingAnomaly) -> some View {
        Image(systemName: "exclamationmark.triangle.fill")
            .font(.caption2)
            .foregroundStyle(Color.TS.statusWarning)
            .accessibilityLabel(Text(LocalizedStringKey(anomaly.kind.labelKey)))
    }

    @ViewBuilder
    private var metrics: some View {
        let kwh = "\(ChargingListFormat.number(session.energyAddedWh / 1000)) kWh"
        let cost = session.costDecimal.map { ChargingListFormat.currency($0, symbol: symbol) }
            ?? ChargingListFormat.emptyValue
        let durationText = ChargingListFormat.duration(minutes: session.durationMinutes)
        if density == .compact {
            HStack(spacing: TSSpacing.md) {
                Text(verbatim: kwh).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: cost).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
            }
        } else {
            HStack(spacing: TSSpacing.lg) {
                metric(value: kwh, tone: Color.TS.textPrimary)
                metric(value: cost, tone: Color.TS.textSecondary)
                metric(value: durationText, tone: Color.TS.textSecondary)
                metric(value: "\(ChargingListFormat.powerKw(session.avgPowerW)) kW", tone: Color.TS.textSecondary)
            }
        }
    }

    private func metric(value: String, tone: Color) -> some View {
        Text(verbatim: value).font(Font.TS.bodySm).monospacedDigit().foregroundStyle(tone)
    }

    private var timeText: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = ChargingAggregation.dayCalendar.timeZone
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: session.startedAt)
    }
}

private extension ChargerCategory {
    /// The collection whose icon + label represent this category in the row chip.
    var collection: ChargingCollection {
        switch self {
        case .home: .home
        case .supercharger: .supercharger
        case .dc: .dc
        case .unknown: .all
        }
    }
}
