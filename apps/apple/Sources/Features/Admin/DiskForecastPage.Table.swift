import SwiftUI

/// The adaptive hypertables table for `DiskForecastPage` (web `DataTable`): a columnar
/// grid on macOS / iPad regular width and per-hypertable cards on compact iPhone width.
/// Reproduces the six web columns — Hypertable (+ chunk count), Total, Uncompressed /
/// compressed split, Growth per day, Days to quota, and the severity badge. Kept as a
/// dedicated surface (mirroring `AlertStudioPage.Views`) so the page file stays focused
/// on chrome + states. All copy resolves from `Localizable.xcstrings`.
struct DiskForecastTable: View {
    let rows: [DiskForecastHypertable]

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
                ForEach(rows) { hypertableCard($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .topLeading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("admin.diskForecast.colTable").gridColumnAlignment(.leading)
                header("admin.diskForecast.colTotal").gridColumnAlignment(.trailing)
                header("admin.diskForecast.colSplit").gridColumnAlignment(.trailing)
                header("admin.diskForecast.colGrowth").gridColumnAlignment(.trailing)
                header("admin.diskForecast.colDays").gridColumnAlignment(.trailing)
                header("admin.diskForecast.colSeverity").gridColumnAlignment(.trailing)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(6)
            ForEach(rows) { row in
                GridRow {
                    nameCell(row)
                    numericCell(DiskForecastFormat.bytes(row.totalBytes))
                    splitCell(row)
                    numericCell("\(DiskForecastFormat.bytes(row.growthBytesPerDay))/d")
                    numericCell(DiskForecastFormat.daysToQuota(row.estDaysToQuota))
                    DiskForecastSeverityBadge(severity: row.severity)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(6)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func nameCell(_ row: DiskForecastHypertable) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: row.hypertableName)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: Self.chunkCountText(row.chunkCount))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func numericCell(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.bodySm)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func splitCell(_ row: DiskForecastHypertable) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(verbatim: DiskForecastFormat.bytes(row.uncompressedBytes))
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: Self.compressedCaption(row.compressedBytes))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    // MARK: - Compact (iPhone) cards

    private func hypertableCard(_ row: DiskForecastHypertable) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    nameCell(row)
                    Spacer(minLength: TSSpacing.sm)
                    DiskForecastSeverityBadge(severity: row.severity)
                }
                labeledRow("admin.diskForecast.colTotal", DiskForecastFormat.bytes(row.totalBytes))
                splitRow(row)
                labeledRow(
                    "admin.diskForecast.colGrowth",
                    "\(DiskForecastFormat.bytes(row.growthBytesPerDay))/d"
                )
                labeledRow("admin.diskForecast.colDays", DiskForecastFormat.daysToQuota(row.estDaysToQuota))
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

    private func splitRow(_ row: DiskForecastHypertable) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("admin.diskForecast.colSplit").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: DiskForecastFormat.bytes(row.uncompressedBytes))
                    .font(Font.TS.bodySm)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: Self.compressedCaption(row.compressedBytes))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    // MARK: - Interpolated cell strings (web i18next `{{token}}` → catalog)

    /// Resolves `admin.diskForecast.chunkCount` ("%lld chunks") with the chunk count.
    static func chunkCountText(_ count: Int64) -> String {
        String(format: String(localized: "admin.diskForecast.chunkCount"), count)
    }

    /// Web split caption: `{compressed bytes} compressed` (suffix from the catalog).
    static func compressedCaption(_ bytes: Int64) -> String {
        "\(DiskForecastFormat.bytes(bytes)) \(String(localized: "admin.diskForecast.compressedSuffix"))"
    }
}

/// The severity badge (web `Badge` + `SEVERITY_VARIANT` / `SEVERITY_LABEL`). The label
/// tokens are the web's hardcoded status map (OK / Warn / Critical / —), rendered
/// verbatim like the sibling page's HTTP-method chips; the tone maps to the shared
/// status tokens.
struct DiskForecastSeverityBadge: View {
    let severity: DiskForecastSeverity

    var body: some View {
        let tone = Self.tone(severity)
        return Text(verbatim: Self.label(severity))
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: Self.label(severity)))
    }

    /// Web `SEVERITY_VARIANT` (ok→success, warn→warning, critical→danger, unknown→neutral).
    static func tone(_ severity: DiskForecastSeverity) -> TSTone {
        switch severity {
        case .ok: .success
        case .warn: .warning
        case .critical: .danger
        case .unknown: .neutral
        }
    }

    /// Web `SEVERITY_LABEL` (a hardcoded status-token map).
    static func label(_ severity: DiskForecastSeverity) -> String {
        switch severity {
        case .ok: "OK"
        case .warn: "Warn"
        case .critical: "Critical"
        case .unknown: "—"
        }
    }
}
