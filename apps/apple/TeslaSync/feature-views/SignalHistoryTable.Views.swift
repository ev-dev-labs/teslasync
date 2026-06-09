//
//  SignalHistoryTable.Views.swift
//  TeslaSync — P4 feature view · 0269 · SignalHistoryTable (Apple)
//
//  The presentational subviews composed by `SignalHistoryTable`: the value table
//  (reusing the shared `TSDataTable`, the native parity of the web `DataTable`) with the
//  Timestamp / Signal / Value / Type columns + the raw-payload row expansion, the paged
//  navigation (shared `TSPagination`, web `Pagination`), the Type badge (web `Badge`),
//  the palette-coded Signal cell (web `selectedSignals.indexOf` colouring), and the
//  loading / empty / error states. All consume the P1/S10 facade and the shared P1/S9
//  tokens — no networking, no Tailwind ports. The Type badge maps the web
//  info / success / warning variants to the design status tones.
//

import SwiftUI

// MARK: - Type badge (web `Badge` with TYPE_BADGE_VARIANT)

/// The Type column badge (web `<Badge variant={…}>{vt}</Badge>`): number → info, string →
/// success, boolean → warning. Built from the shared badge tokens but taking the runtime
/// facade-resolved label the `LocalizedStringKey`-only `TSBadge` cannot express.
struct SHTypeBadge: View {
    let type: SignalValueType

    var body: some View {
        let label = SignalHistoryAccessibility.valueTypeLabel(type, SHStrings.string)
        let tone = Self.tone(for: type)
        return Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: label))
    }

    /// Web `TYPE_BADGE_VARIANT` → design tone.
    static func tone(for type: SignalValueType) -> TSTone {
        switch type {
        case .number: .info
        case .string: .success
        case .boolean: .warning
        }
    }
}

// MARK: - Cells

/// The Timestamp cell (web `formatDateTime(r.created_at)`): a muted absolute body with the
/// relative form folded into the accessibility value; em-dash when absent/unparseable.
struct SHTimeCell: View {
    let row: SignalHistoryRow

    var body: some View {
        Text(verbatim: SignalHistoryFormat.absolute(for: row.createdAt))
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .accessibilityLabel(Text(verbatim: accessibilityValue))
    }

    private var accessibilityValue: String {
        guard let date = row.createdAt else { return SignalHistoryFormat.dash }
        return "\(SignalHistoryFormat.absolute(for: date)), \(SignalHistoryFormat.relative(for: date))"
    }
}

/// The Signal cell (web colored dot + mono name): when the signal is in the caller's
/// `selectedSignals`, a palette dot precedes the name and the name takes the matching
/// palette color (index-stable with `SignalChartPanel`); otherwise no dot and the primary
/// text color.
struct SHSignalCell: View {
    let row: SignalHistoryRow

    private var signalColor: Color {
        guard let index = row.colorIndex else { return Color.TS.textPrimary }
        return TSChartPalette.color(at: index)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if row.colorIndex != nil {
                Circle()
                    .fill(signalColor)
                    .frame(width: 8, height: 8)
                    .accessibilityHidden(true)
            }
            Text(verbatim: row.signal)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(signalColor)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: row.signal))
    }
}

/// The Value cell (web `formatValue(r)` in mono primary text).
struct SHValueCell: View {
    let row: SignalHistoryRow

    var body: some View {
        Text(verbatim: row.value)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
    }
}

// MARK: - Raw-payload expansion (web `<pre>{JSON.stringify(r, null, 2)}</pre>`)

/// The expandable detail (web `renderExpanded`): the row's pretty-printed JSON in a
/// muted, selectable monospaced block.
struct SHRawPayloadView: View {
    let row: SignalHistoryRow

    var body: some View {
        Text(verbatim: row.rawPayloadJSON)
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.leading)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(verbatim: SHStrings.string(
                "telemetry.signalHistory.rawPayload", "Raw signal payload"
            )))
            .accessibilityValue(Text(verbatim: row.rawPayloadJSON))
    }
}

// MARK: - Data table (web `DataTable`, compact, expandable)

/// The populated table (web `<DataTable … compact expandable>`): the shared `TSDataTable`
/// with the four web columns; Timestamp is sortable; the raw-payload detail is attached
/// only when the caller opted into row expansion (web `expandable` prop, default true).
struct SHSignalTable: View {
    let resolved: SignalHistoryResolved

    var body: some View {
        var table = TSDataTable(rows: resolved.rows, columns: columns, density: .compact)
        if resolved.expandable {
            table = table.rowDetail { row in SHRawPayloadView(row: row) }
        }
        return table
    }

    private var columns: [TSColumn<SignalHistoryRow>] {
        [
            TSColumn(
                id: "time",
                title: title("telemetry.signalHistory.col.timestamp", "Timestamp"),
                comparator: SignalHistoryAdapter.compareByTime
            ) { row in
                SHTimeCell(row: row)
            },
            TSColumn(id: "signal", title: title("telemetry.signalHistory.col.signal", "Signal")) { row in
                SHSignalCell(row: row)
            },
            TSColumn(id: "value", title: title("telemetry.signalHistory.col.value", "Value")) { row in
                SHValueCell(row: row)
            },
            TSColumn(id: "type", title: title("telemetry.signalHistory.col.type", "Type")) { row in
                SHTypeBadge(type: row.valueType)
            }
        ]
    }

    private func title(_ key: String, _ fallback: String) -> LocalizedStringKey {
        "\(SHStrings.string(key, fallback))"
    }
}

// MARK: - Pagination (web `Pagination`)

/// The paged navigation (web `<Pagination page pageSize total onPageChange>`): the shared
/// `TSPagination`, bridged between the web 1-based `page` and the control's 0-based index;
/// the setter forwards a 1-based page back through the model (web `onPageChange`).
struct SHPaginationBar: View {
    let resolved: SignalHistoryResolved
    let onPageChange: (Int) -> Void

    var body: some View {
        let binding = Binding<Int>(
            get: { max(0, resolved.page - 1) },
            set: { zeroBased in onPageChange(zeroBased + 1) }
        )
        return TSPagination(currentPage: binding, pageCount: resolved.pageCount)
            .frame(maxWidth: .infinity, alignment: .center)
    }
}

/// The data phase body (web `rows.length > 0` branch): the table above the pager.
struct SHDataView: View {
    let resolved: SignalHistoryResolved
    let onPageChange: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            SHSignalTable(resolved: resolved)
            SHPaginationBar(resolved: resolved, onPageChange: onPageChange)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Loading (web `[1,2,3,4,5].map(<Skeleton h-8/>)`)

/// The initial-fetch skeleton chrome: five redacted rows that respect Reduce Motion via
/// the shared `TSSkeleton`, exposed as one labeled accessibility element.
struct SHLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(height: 28)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SHStrings.string(
            "telemetry.signalHistory.loadingA11y", "Loading signal history"
        )))
    }
}

// MARK: - Empty (web `EmptyState`)

/// The zero-rows state (web `<EmptyState icon={<Activity/>} title="No data" …>`): a
/// friendly icon + the localized title and message, never a blank surface.
struct SHEmptyView: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: SHStrings.string("telemetry.signalHistory.noData", "No data"))
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: SHStrings.string(
                "telemetry.signalHistory.noDataMessage", "No signal data found for this query."
            ))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (native QueryError-equivalent + retry)

/// The failure state (the P4 states contract's `QueryError`-equivalent): an icon, a title,
/// the optional upstream message, and a retry affordance wired to the model. The web leaf
/// has no error branch — its parent owns the query — so this is native chrome for a failed
/// parent fetch surfaced through the source's error snapshot.
struct SHErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: SHStrings.string("telemetry.signalHistory.errorTitle", "Couldn't load signal history"))
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: onRetry) {
                Text(verbatim: SHStrings.string("telemetry.signalHistory.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: SHStrings.string("telemetry.signalHistory.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .contain)
    }
}
