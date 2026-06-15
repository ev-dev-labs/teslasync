import SwiftUI

/// The adaptive per-vehicle table for `VehicleCostPage` (web `DataTable`): a columnar grid
/// on macOS / iPad regular width and per-vehicle cards on compact iPhone width. Reproduces
/// the six web columns — Vehicle (+ id caption), Rows, Bytes (est.), Rate (rows/min, 24h),
/// DLQ (24h), and Last seen. Kept as a dedicated surface (mirroring `DiskForecastPage.Table`)
/// so the page file stays focused on chrome + states. All copy resolves from
/// `Localizable.xcstrings`.
struct VehicleCostTable: View {
    let rows: [VehicleCostRow]

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
                ForEach(rows) { vehicleCard($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .topLeading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("admin.vehicleCost.colVehicle").gridColumnAlignment(.leading)
                header("admin.vehicleCost.colRows").gridColumnAlignment(.trailing)
                header("admin.vehicleCost.colBytes").gridColumnAlignment(.trailing)
                header("admin.vehicleCost.colRate").gridColumnAlignment(.trailing)
                header("admin.vehicleCost.colFailures").gridColumnAlignment(.trailing)
                header("admin.vehicleCost.colLastSeen").gridColumnAlignment(.leading)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(6)
            ForEach(rows) { row in
                GridRow {
                    nameCell(row)
                    numericCell(VehicleCostFormat.number(row.signalRowCount))
                    numericCell(VehicleCostFormat.bytes(row.signalBytesEst))
                    numericCell(VehicleCostFormat.number(row.ingestRatePerMinute24h, decimals: 1))
                    failuresCell(row.dlqFailures24h)
                    lastSeenCell(row.lastSeenAt)
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

    private func nameCell(_ row: VehicleCostRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: Self.vehicleName(row))
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: Self.idCaption(row))
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

    /// Web DLQ cell: amber when there are failures, muted secondary otherwise.
    private func failuresCell(_ failures: Int64) -> some View {
        Text(verbatim: VehicleCostFormat.number(failures))
            .font(Font.TS.bodySm)
            .monospacedDigit()
            .foregroundStyle(failures > 0 ? Color.TS.statusWarning : Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func lastSeenCell(_ iso: String) -> some View {
        Text(verbatim: VehicleCostFormat.relative(iso))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Compact (iPhone) cards

    private func vehicleCard(_ row: VehicleCostRow) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                nameCell(row)
                labeledRow("admin.vehicleCost.colRows", VehicleCostFormat.number(row.signalRowCount))
                labeledRow("admin.vehicleCost.colBytes", VehicleCostFormat.bytes(row.signalBytesEst))
                labeledRow(
                    "admin.vehicleCost.colRate",
                    VehicleCostFormat.number(row.ingestRatePerMinute24h, decimals: 1)
                )
                failuresRow(row.dlqFailures24h)
                labeledRow("admin.vehicleCost.colLastSeen", VehicleCostFormat.relative(row.lastSeenAt))
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

    private func failuresRow(_ failures: Int64) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("admin.vehicleCost.colFailures").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: VehicleCostFormat.number(failures))
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(failures > 0 ? Color.TS.statusWarning : Color.TS.textSecondary)
        }
    }

    // MARK: - Cell strings (web display_name fallback + verbatim "ID" caption)

    /// Web vehicle name: `display_name` or the interpolated `unnamed` fallback
    /// (`Vehicle #{{id}}`).
    static func vehicleName(_ row: VehicleCostRow) -> String {
        if let name = row.displayName, !name.isEmpty { return name }
        return String(format: String(localized: "admin.vehicleCost.unnamed"), row.vehicleID)
    }

    /// Web id caption `ID {fmtNumber(vehicle_id)}`. The "ID" prefix is a bare web literal
    /// (no i18n key), so it renders verbatim like the sibling page's value tokens.
    static func idCaption(_ row: VehicleCostRow) -> String {
        "ID \(VehicleCostFormat.number(row.vehicleID))"
    }
}
