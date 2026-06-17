import SwiftUI

// MARK: - Climate history table (web "Climate History" `DataTable`)

/// The adaptive climate-history table (web `DataTable`): a columnar grid on
/// macOS / iPad regular width and per-row cards on compact iPhone width.
/// Reproduces the seven web columns — Time, Inside, Outside, Set Temp (each with
/// the user's temperature unit), Fan, HVAC (badge), and Climate Keeper (badge).
/// Kept as a dedicated surface so the page file stays focused on chrome + states.
struct ClimateHistoryTable: View {
    let rows: [ClimateSnapshot]
    let fahrenheit: Bool
    let unitLabel: String

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
                ForEach(rows) { row($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .topLeading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("Time").gridColumnAlignment(.leading)
                unitHeader("Inside").gridColumnAlignment(.trailing)
                unitHeader("Outside").gridColumnAlignment(.trailing)
                unitHeader("Set Temp").gridColumnAlignment(.trailing)
                header("Fan").gridColumnAlignment(.trailing)
                header("HVAC").gridColumnAlignment(.leading)
                header("Climate Keeper").gridColumnAlignment(.leading)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(7)
            ForEach(rows) { row in
                GridRow {
                    Text(verbatim: ClimateFormat.dateTime(row.timestamp))
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textPrimary)
                    numericCell(temperature(row.insideTemp))
                    numericCell(temperature(row.outsideTemp))
                    numericCell(temperature(row.driverTempSetting))
                    numericCell(fanText(row.fanSpeed))
                    hvacBadge(row.isAcOn)
                    keeperBadge(row.climateKeeperMode)
                }
                .accessibilityElement(children: .combine)
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(7)
            }
        }
    }

    // MARK: - Compact (iPhone) cards

    private func row(_ snapshot: ClimateSnapshot) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: ClimateFormat.dateTime(snapshot.timestamp))
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                labeledRow(unitLabeled("Inside"), temperature(snapshot.insideTemp))
                labeledRow(unitLabeled("Outside"), temperature(snapshot.outsideTemp))
                labeledRow(unitLabeled("Set Temp"), temperature(snapshot.driverTempSetting))
                labeledRow(Text("Fan"), fanText(snapshot.fanSpeed))
                HStack {
                    Text("HVAC").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                    Spacer(minLength: TSSpacing.md)
                    hvacBadge(snapshot.isAcOn)
                }
                HStack {
                    Text("Climate Keeper").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                    Spacer(minLength: TSSpacing.md)
                    keeperBadge(snapshot.climateKeeperMode)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Cells

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    /// A header that appends the user's temperature unit (web `${t('Inside')} ${tempUnit}`).
    private func unitHeader(_ key: LocalizedStringKey) -> some View {
        unitLabeled(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func unitLabeled(_ key: LocalizedStringKey) -> Text {
        Text(key) + Text(verbatim: " \(unitLabel)")
    }

    private func numericCell(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.bodySm)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func labeledRow(_ label: Text, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            label.font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }

    private func hvacBadge(_ isAcOn: Bool?) -> some View {
        let active = isAcOn == true
        return TSBadge(active ? "On" : "Off", tone: active ? .success : .neutral)
    }

    private func keeperBadge(_ mode: String?) -> some View {
        TSBadge(ClimateKeeper.labelKey(mode), tone: ClimateKeeper.tone(mode))
    }

    // MARK: - Value formatting (SI °C → user unit at the boundary)

    private func temperature(_ celsius: Double?) -> String {
        guard let celsius else { return ClimateFormat.dash }
        return ClimateFormat.number(ClimateFormat.displayTemperature(celsius, fahrenheit: fahrenheit), decimals: 1)
    }

    private func fanText(_ fanSpeed: Int?) -> String {
        guard let fanSpeed else { return ClimateFormat.dash }
        return String(fanSpeed)
    }
}
