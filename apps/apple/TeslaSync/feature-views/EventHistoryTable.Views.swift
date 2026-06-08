//
//  EventHistoryTable.Views.swift
//  TeslaSync — P4 feature view · 0042 · EventHistoryTable (Apple)
//
//  The presentational subviews composed by `EventHistoryTable`: the data table (reusing
//  the shared `TSDataTable`, the native parity of the web `DataTable`) with the Time /
//  Lock / Sentry / Doors / Windows columns, the status badges (web `Badge`), the colored
//  door/window cells, and the loading / empty / error states. All consume the P1/S10
//  facade and the shared P1/S9 tokens — no networking, no Tailwind ports. Colors map the
//  web green/amber/success/danger/neutral to the design status tokens.
//

import SwiftUI

// MARK: - Status badge (web `Badge`, runtime/facade text)

/// A tinted capsule badge built from the shared `TSBadge` tokens but taking the runtime
/// facade-resolved string the `LocalizedStringKey`-only `TSBadge` cannot express — the
/// web Lock (`success`/`danger`) and Sentry (`success`/`neutral`) badges.
struct EHStatusBadge: View {
    let text: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Cells

/// The Time cell (web `<TimeStamp>`): a muted absolute body with the relative form folded
/// into the accessibility value; em-dash when the timestamp is absent/unparseable.
struct EHTimeCell: View {
    let row: EventHistoryRow

    var body: some View {
        Text(verbatim: EventHistoryFormat.absolute(for: row.createdAt))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .accessibilityLabel(Text(verbatim: accessibilityValue))
    }

    private var accessibilityValue: String {
        guard let date = row.createdAt else { return EventHistoryFormat.dash }
        return "\(EventHistoryFormat.absolute(for: date)), \(EventHistoryFormat.relative(for: date))"
    }
}

/// The Doors cell (web `asNonEmptyString(doorState) ?? Closed/—`): green when the doors
/// are closed, amber otherwise (web `text-green-400` / `text-amber-400`).
struct EHDoorCell: View {
    let row: EventHistoryRow

    var body: some View {
        Text(verbatim: EventHistoryAccessibility.doorText(row.door, EHStrings.string))
            .font(Font.TS.bodySm)
            .foregroundStyle(row.doorClosed ? Color.TS.statusSuccess : Color.TS.statusWarning)
            .lineLimit(1)
    }
}

/// The Windows cell (web `windowSummary`): green when all windows are closed, amber when
/// any is open/venting.
struct EHWindowCell: View {
    let row: EventHistoryRow

    var body: some View {
        Text(verbatim: EventHistoryAccessibility.windowText(row.windows, EHStrings.string))
            .font(Font.TS.bodySm)
            .foregroundStyle(row.windowsClosed ? Color.TS.statusSuccess : Color.TS.statusWarning)
            .lineLimit(1)
    }
}

// MARK: - Data table (web `DataTable`, compact)

/// The populated state (web `<DataTable … compact>`): the shared `TSDataTable` with the
/// five web columns. Time is sortable (web `sortable: true`); the row identity is the
/// event id (web `keyExtractor`).
struct EHEventsTable: View {
    let rows: [EventHistoryRow]

    var body: some View {
        TSDataTable(rows: rows, columns: columns, density: .compact)
    }

    private var columns: [TSColumn<EventHistoryRow>] {
        [
            TSColumn(
                id: "time",
                title: title("admin.security.col.time", "Time"),
                comparator: EventHistoryAdapter.compareByTime
            ) { row in
                EHTimeCell(row: row)
            },
            TSColumn(id: "lock", title: title("admin.security.col.lock", "Lock")) { row in
                EHStatusBadge(
                    text: EventHistoryAccessibility.lockText(row.locked, EHStrings.string),
                    tone: row.locked ? .success : .danger
                )
            },
            TSColumn(id: "sentry", title: title("admin.security.col.sentry", "Sentry")) { row in
                EHStatusBadge(
                    text: EventHistoryAccessibility.sentryText(row.sentryOn, EHStrings.string),
                    tone: row.sentryOn ? .success : .neutral
                )
            },
            TSColumn(id: "doors", title: title("admin.security.col.doors", "Doors")) { row in
                EHDoorCell(row: row)
            },
            TSColumn(id: "windows", title: title("admin.security.col.windows", "Windows")) { row in
                EHWindowCell(row: row)
            }
        ]
    }

    private func title(_ key: String, _ fallback: String) -> LocalizedStringKey {
        "\(EHStrings.string(key, fallback))"
    }
}

// MARK: - Loading (web `<Skeleton lines={8} />`)

/// The initial-fetch skeleton chrome: eight redacted lines that respect Reduce Motion via
/// the shared `TSSkeleton`, exposed as one labeled accessibility element.
struct EHLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 8, id: \.self) { _ in
                TSSkeleton(height: 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: EHStrings.string(
            "admin.security.loadingA11y", "Loading security events"
        )))
    }
}

// MARK: - Empty (web DataTable `emptyMessage`)

/// The zero-rows state (web DataTable `emptyMessage`): a friendly icon + the localized
/// "No security events recorded yet." message, never a blank surface.
struct EHEmptyView: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: EHStrings.string("admin.security.noEvents", "No security events recorded yet."))
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

/// The failure state (the P4 states contract's `QueryError`-equivalent): an icon, a
/// title, the optional upstream message, and a retry affordance wired to the model. The
/// web leaf has no error branch — its parent owns the query — so this is native chrome
/// for a failed parent fetch surfaced through the source's error snapshot.
struct EHErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: EHStrings.string("admin.security.errorTitle", "Couldn't load security events"))
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
                Text(verbatim: EHStrings.string("admin.security.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: EHStrings.string("admin.security.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .contain)
    }
}
