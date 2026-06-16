import SwiftUI

// The Drain-Sessions table for the Vampire Drain surface (web GlassPanel8 + `DataTable`).
// Split from the other sections to keep each file focused. Date / duration / battery levels /
// loss / rate format directly via `VampireDrainFormat` at this render boundary (ADR-005); the
// panel renders its own empty state (never a blank region). The Loss% cell is a severity-
// tinted value chip (web `Badge` variant by `drain_pct`); the Sentry cell is an On/Off badge.

// MARK: - Drain sessions (web Drain Sessions — GlassPanel8 + DataTable)

/// The drain-sessions panel (web GlassPanel8): a header with a session-count chip plus a
/// sortable seven-column table (Date / Duration / Start% / End% / Loss% / Rate %/hr / Sentry),
/// or the no-sessions empty state.
struct VampireDrainSessionsSection: View {
    let data: VampireDrainData

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    TSSubhead("Drain Sessions")
                    Spacer(minLength: TSSpacing.sm)
                    countChip
                }
                if data.hasEntries {
                    TSDataTable(rows: data.entries, columns: columns, density: .compact)
                        .accessibilityLabel(Text("Drain Sessions"))
                } else {
                    TSEmptyState(title: "No drain sessions recorded yet.", systemImage: "bolt.slash")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    /// Web `<Badge variant="neutral">{entries.length} {t('sessions')}</Badge>` — the count
    /// chip; the localized "sessions" word resolves from the string catalog.
    private var countChip: some View {
        (Text(verbatim: "\(data.sessionCount) ") + Text("sessions"))
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.3), lineWidth: 1))
            .accessibilityElement(children: .combine)
    }

    private var columns: [TSColumn<VampireDrainSession>] {
        [
            TSColumn(
                id: "date",
                title: "Date",
                comparator: { compareStrings($0.date, $1.date) },
                cell: { Text(verbatim: VampireDrainFormat.dateTime($0.date)) }
            ),
            TSColumn(
                id: "duration",
                title: "Duration",
                comparator: { compare($0.durationHours, $1.durationHours) },
                cell: { Text(verbatim: VampireDrainFormat.durationHours($0.durationHours)) }
            ),
            TSColumn(
                id: "start",
                title: "Start %",
                comparator: { compare($0.startBattery, $1.startBattery) },
                cell: { Text(verbatim: VampireDrainFormat.batteryPercent($0.startBattery)) }
            ),
            TSColumn(
                id: "end",
                title: "End %",
                comparator: { compare($0.endBattery, $1.endBattery) },
                cell: { Text(verbatim: VampireDrainFormat.batteryPercent($0.endBattery)) }
            ),
            TSColumn(
                id: "loss",
                title: "Loss %",
                comparator: { compare($0.drainPct, $1.drainPct) },
                cell: { lossCell($0) }
            ),
            TSColumn(
                id: "rate",
                title: "Rate %/hr",
                comparator: { compare($0.drainRatePctHr, $1.drainRatePctHr) },
                cell: { Text(verbatim: VampireDrainFormat.rate($0.drainRatePctHr)) }
            ),
            TSColumn(
                id: "sentry",
                title: "Sentry",
                comparator: { compareBools($0.sentryActive, $1.sentryActive) },
                cell: { sentryCell($0) }
            )
        ]
    }

    /// Web Loss% `<Badge variant={drain_pct > 5 ? 'danger' : > 2 ? 'warning' : 'success'}>`
    /// — a severity-tinted verbatim percent chip.
    private func lossCell(_ session: VampireDrainSession) -> some View {
        let tone = session.drainSeverity.tone
        return Text(verbatim: VampireDrainFormat.lossPercent(session.drainPct))
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }

    /// Web Sentry `<Badge variant={sentry_active ? 'warning' : 'neutral'}>On/Off</Badge>`.
    private func sentryCell(_ session: VampireDrainSession) -> some View {
        TSBadge(session.sentryActive ? "On" : "Off", tone: session.sentryActive ? .warning : .neutral)
    }

    private func compare(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs == rhs { return .orderedSame }
        return lhs < rhs ? .orderedAscending : .orderedDescending
    }

    private func compareStrings(_ lhs: String, _ rhs: String) -> ComparisonResult {
        lhs.compare(rhs)
    }

    private func compareBools(_ lhs: Bool, _ rhs: Bool) -> ComparisonResult {
        if lhs == rhs { return .orderedSame }
        return lhs ? .orderedDescending : .orderedAscending
    }
}
