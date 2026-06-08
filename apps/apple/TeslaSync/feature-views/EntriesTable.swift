//
//  EntriesTable.swift
//  TeslaSync — P4 feature view · 0027 · EntriesTable (Apple)
//
//  Native, Apple-idiomatic DLQ-inspector entries table at parity with the web source
//  web/src/features/admin/components/dlq-inspector/EntriesTable.tsx.
//
//  Presentational feature view: it binds to an injected `EntriesTableModel` (the P1/S8
//  data seam) and owns no networking. Every load state renders — loading, loaded, empty,
//  error (with retry), stale, and offline — and the populated table reproduces the web
//  columns, the click-to-sort affordance, the replayable badge, and the per-row Inspect
//  action. All copy resolves through the P1/S10 i18n facade; no English literals live here.
//

import SwiftUI

/// The DLQ entries table surface. Compose it inside an admin/diagnostics page, hand it a
/// model bound to the DLQ feed, and a callback for the Inspect action (the parent owns the
/// drawer, exactly like the web component's `onInspect` prop).
public struct EntriesTable: View {
    /// Stable surface slug for the P1/S11 `view.opened` diagnostics event.
    public static let surfaceSlug = "EntriesTable"

    private let onInspect: (DLQEntryRow) -> Void
    private let telemetry: EntriesTableTelemetry
    @State private var model: EntriesTableModel

    public init(
        model: EntriesTableModel,
        onInspect: @escaping (DLQEntryRow) -> Void,
        telemetry: EntriesTableTelemetry = OSLogEntriesTableTelemetry()
    ) {
        _model = State(initialValue: model)
        self.onInspect = onInspect
        self.telemetry = telemetry
    }

    /// Freshness for the chip / banner, when the current state carries one.
    var currentFreshness: WidgetFreshness? {
        switch model.state {
        case let .loaded(_, freshness): freshness
        case let .empty(freshness): freshness
        case .loading, .failed: nil
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            connectivityBanner
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear {
            telemetry.viewOpened(surface: Self.surfaceSlug)
            model.start()
        }
        .onDisappear {
            model.stop()
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: EntriesTableStrings.tableTitle)
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
            if let freshness = currentFreshness {
                freshnessChip(freshness)
            }
            Spacer(minLength: TSSpacing.sm)
            refreshButton
        }
        .accessibilityElement(children: .contain)
    }

    private func freshnessChip(_ freshness: WidgetFreshness) -> some View {
        let info = EntriesTableFreshness.info(for: freshness)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: info.iconName).font(.caption2)
            Text(verbatim: info.label).font(Font.TS.caption)
        }
        .foregroundStyle(info.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(info.tone.color.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    private var refreshButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { model.refresh() },
            label: { Image(systemName: "arrow.clockwise") }
        )
        .accessibilityLabel(Text(verbatim: accessibilityRefresh))
    }

    // MARK: Connectivity banner (offline / stale honesty)

    @ViewBuilder private var connectivityBanner: some View {
        switch currentFreshness {
        case .offline:
            banner(icon: "wifi.slash", text: EntriesTableStrings.offlineBanner, tone: .neutral)
        case .stale:
            banner(icon: "clock.badge.exclamationmark", text: EntriesTableStrings.staleBanner, tone: .warning)
        case .fresh, .none:
            EmptyView()
        }
    }

    private func banner(icon: String, text: String, tone: TSTone) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: icon).font(.caption)
            Text(verbatim: text).font(Font.TS.caption)
            Spacer(minLength: 0)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // MARK: Content (every state renders)

    @ViewBuilder private var content: some View {
        switch model.state {
        case let .loading(cached):
            if let cached, !cached.isEmpty {
                entriesTable(cached)
            } else {
                loadingState
            }
        case let .loaded(rows, _):
            if rows.isEmpty {
                emptyState
            } else {
                entriesTable(rows)
            }
        case .empty:
            emptyState
        case let .failed(_, cached):
            if let cached, !cached.isEmpty {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    failureBanner
                    entriesTable(cached)
                }
            } else {
                errorState
            }
        }
    }

    private var failureBanner: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill").font(.caption)
                Text(verbatim: EntriesTableStrings.errorTitle).font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.statusDanger)
            Spacer(minLength: TSSpacing.sm)
            TSButton(LocalizedStringKey(EntriesTableStrings.retry), variant: .secondary, size: .small) {
                model.refresh()
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.statusDanger.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityElement(children: .contain)
    }

    private var loadingState: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(height: 28, cornerRadius: TSRadius.sm)
            }
            TSSpinner(label: LocalizedStringKey(EntriesTableStrings.tableLoading))
                .padding(.top, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: EntriesTableStrings.tableLoading))
    }

    private var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey(EntriesTableStrings.tableEmpty),
            systemImage: "checkmark.seal"
        )
        .frame(maxWidth: .infinity)
    }

    private var errorState: some View {
        TSErrorDisplay(
            title: LocalizedStringKey(EntriesTableStrings.errorTitle),
            onRetry: { model.refresh() }
        )
        .frame(maxWidth: .infinity)
    }

    // MARK: Table

    private func entriesTable(_ rows: [DLQEntryRow]) -> some View {
        let sorted = EntriesTableSort.sorted(rows, by: .default)
        return TSDataTable(rows: sorted, columns: columns)
            .accessibilityLabel(Text(verbatim: EntriesTableAccessibility.listSummary(count: rows.count)))
    }
}

// MARK: - Table columns

extension EntriesTable {
    private var columns: [TSColumn<DLQEntryRow>] {
        [
            arrivedColumn, reasonColumn, vinColumn, topicColumn,
            redeliveriesColumn, payloadColumn, replayableColumn, actionsColumn
        ]
    }

    private var arrivedColumn: TSColumn<DLQEntryRow> {
        TSColumn(
            id: DLQSortKey.arrivedAt.rawValue,
            title: LocalizedStringKey(EntriesTableStrings.colArrived),
            comparator: { EntriesTableSort.compare($0, $1, by: .arrivedAt) },
            cell: { row in Text(verbatim: row.arrivedAtText) }
        )
    }

    private var reasonColumn: TSColumn<DLQEntryRow> {
        TSColumn(
            id: DLQSortKey.reason.rawValue,
            title: LocalizedStringKey(EntriesTableStrings.colReason),
            comparator: { EntriesTableSort.compare($0, $1, by: .reason) },
            cell: { row in
                Text(verbatim: row.reasonDisplay)
                    .monospaced()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        )
    }

    private var vinColumn: TSColumn<DLQEntryRow> {
        TSColumn(
            id: DLQSortKey.vin.rawValue,
            title: LocalizedStringKey(EntriesTableStrings.colVin),
            comparator: { EntriesTableSort.compare($0, $1, by: .vin) },
            cell: { row in
                Text(verbatim: row.vinDisplay)
                    .monospaced()
                    .foregroundStyle(Color.TS.textMuted)
            }
        )
    }

    private var topicColumn: TSColumn<DLQEntryRow> {
        TSColumn(
            id: "parsed_source_topic",
            title: LocalizedStringKey(EntriesTableStrings.colTopic)
        ) { row in
            Text(verbatim: row.sourceTopicDisplay)
                .monospaced()
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var redeliveriesColumn: TSColumn<DLQEntryRow> {
        TSColumn(
            id: "parsed_redeliveries",
            title: LocalizedStringKey(EntriesTableStrings.colRedeliveries)
        ) { row in
            trailing(Text(verbatim: row.redeliveriesText).monospacedDigit())
        }
    }

    private var payloadColumn: TSColumn<DLQEntryRow> {
        TSColumn(
            id: DLQSortKey.payloadSize.rawValue,
            title: LocalizedStringKey(EntriesTableStrings.colSize),
            comparator: { EntriesTableSort.compare($0, $1, by: .payloadSize) },
            cell: { row in
                trailing(
                    Text(verbatim: row.payloadSizeText)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textMuted)
                )
            }
        )
    }

    private var replayableColumn: TSColumn<DLQEntryRow> {
        TSColumn(
            id: "replayable",
            title: LocalizedStringKey(EntriesTableStrings.colReplayable)
        ) { row in
            replayableBadge(row.replayable)
        }
    }

    private var actionsColumn: TSColumn<DLQEntryRow> {
        TSColumn(
            id: "actions",
            title: LocalizedStringKey(EntriesTableStrings.colActions)
        ) { row in
            inspectButton(row)
        }
    }

    private func trailing(_ content: some View) -> some View {
        HStack(spacing: 0) {
            Spacer(minLength: 0)
            content
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func replayableBadge(_ replayable: Bool) -> some View {
        TSBadge(
            replayable
                ? LocalizedStringKey(EntriesTableStrings.commonYes)
                : LocalizedStringKey(EntriesTableStrings.commonNo),
            tone: replayable ? .success : .neutral
        )
    }

    private func inspectButton(_ row: DLQEntryRow) -> some View {
        TSButton(
            LocalizedStringKey(EntriesTableStrings.inspect),
            variant: .secondary,
            size: .small,
            action: { onInspect(row) }
        )
        .accessibilityLabel(Text(verbatim: EntriesTableAccessibility.inspectLabel(for: row)))
        .accessibilityHint(Text(verbatim: EntriesTableAccessibility.rowLabel(for: row)))
    }

    private var accessibilityRefresh: String {
        EntriesTableStrings.string(EntriesTableStrings.Key.a11yRefresh, "Refresh entries")
    }
}
