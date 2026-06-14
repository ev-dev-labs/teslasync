import SwiftUI

/// The adaptive top-queries table for `SlowQueriesPage` (web `DataTable`): a columnar grid
/// on macOS / iPad regular width and per-query cards on compact iPhone width. Reproduces
/// the seven web columns — the monospaced query fingerprint, call count, mean / max / total
/// millisecond timings, rows returned, and the shared-buffer cache-hit ratio. Kept as a
/// dedicated surface (mirroring `DiskForecastPage.Table`) so the page file stays focused on
/// chrome + states. All copy resolves from `Localizable.xcstrings`.
struct SlowQueriesTable: View {
    let rows: [SlowQueryRow]

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        if isCompact {
            VStack(spacing: TSSpacing.md) {
                ForEach(rows) { queryCard($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("admin.slowQueries.colFingerprint").gridColumnAlignment(.leading)
                header("admin.slowQueries.colCalls").gridColumnAlignment(.trailing)
                header("admin.slowQueries.colMean").gridColumnAlignment(.trailing)
                header("admin.slowQueries.colMax").gridColumnAlignment(.trailing)
                header("admin.slowQueries.colTotal").gridColumnAlignment(.trailing)
                header("admin.slowQueries.colRows").gridColumnAlignment(.trailing)
                header("admin.slowQueries.colCache").gridColumnAlignment(.trailing)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(7)
            ForEach(rows) { row in
                GridRow {
                    fingerprintCell(row)
                    numericCell(row.callsText)
                    numericCell(row.meanText)
                    numericCell(row.maxText)
                    numericCell(row.totalText)
                    numericCell(row.rowsText)
                    numericCell(row.cacheHitRatioText)
                }
                .accessibilityElement(children: .combine)
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(7)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    /// Web `<Code className="block max-w-md truncate" title={r.fingerprint}>`.
    private func fingerprintCell(_ row: SlowQueryRow) -> some View {
        Text(verbatim: row.fingerprintText)
            .font(.system(.footnote, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: 360, alignment: .leading)
            .help(Text(verbatim: row.fingerprint))
            .accessibilityLabel(Text(verbatim: row.fingerprint))
    }

    private func numericCell(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.bodySm)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    // MARK: - Compact (iPhone) cards

    private func queryCard(_ row: SlowQueryRow) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: row.fingerprintText)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(2)
                    .truncationMode(.tail)
                    .accessibilityLabel(Text(verbatim: row.fingerprint))
                Divider().overlay(Color.TS.border.opacity(0.5))
                labeledRow("admin.slowQueries.colCalls", row.callsText)
                labeledRow("admin.slowQueries.colMean", row.meanText)
                labeledRow("admin.slowQueries.colMax", row.maxText)
                labeledRow("admin.slowQueries.colTotal", row.totalText)
                labeledRow("admin.slowQueries.colRows", row.rowsText)
                labeledRow("admin.slowQueries.colCache", row.cacheHitRatioText)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func labeledRow(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }
}
