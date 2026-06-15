import SwiftUI

/// The adaptive feedback table for `FeedbackQueuePage` (web `DataTable`): a columnar
/// grid on macOS / iPad regular width and per-row cards on compact iPhone. Reproduces
/// the seven web columns — Created, Category badge, Title, Page route, Reporter,
/// Status badge, and the GitHub issue link — plus the expandable detail row (web
/// `renderExpanded` → `FeedbackExpansion`). Kept as a dedicated surface (mirroring
/// `AuditLogEntriesTable`) so the page file stays focused on chrome + states.
struct FeedbackQueueTable: View {
    let rows: [FeedbackEntry]
    let model: FeedbackQueuePageModel

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
                ForEach(rows) { rowCard($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .topLeading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("feedback.queue.col.created")
                header("feedback.queue.col.category")
                header("feedback.queue.col.title")
                header("feedback.queue.col.pageRoute")
                header("feedback.queue.col.reporter")
                header("feedback.queue.col.status")
                header("feedback.queue.col.github")
                Color.clear.frame(width: 1, height: 1)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(8)
            ForEach(rows) { row in
                GridRow {
                    valueCell(FeedbackQueueFormat.dateTime(row.createdAt))
                    FeedbackCategoryBadge(category: row.category)
                    titleCell(row)
                    pageRouteCell(row)
                    reporterCell(row)
                    FeedbackStatusBadge(status: row.status)
                    githubCell(row)
                    expandButton(row)
                }
                .accessibilityElement(children: .combine)
                if model.isExpanded(row.id) {
                    FeedbackExpansion(row: row, model: model)
                        .gridCellColumns(8)
                }
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(8)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func valueCell(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
    }

    private func titleCell(_ row: FeedbackEntry) -> some View {
        Text(verbatim: FeedbackQueueFormat.dash(row.title))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(2)
            .frame(maxWidth: 240, alignment: .leading)
    }

    private func pageRouteCell(_ row: FeedbackEntry) -> some View {
        Group {
            if row.pageRoute.isEmpty {
                Text(verbatim: FeedbackQueueFormat.emptyValue)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            } else {
                Text(verbatim: row.pageRoute)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }

    @ViewBuilder
    private func githubCell(_ row: FeedbackEntry) -> some View {
        if let url = URL(string: row.githubIssueURL), !row.githubIssueURL.isEmpty {
            Link(destination: url) {
                Text("feedback.queue.openIssue")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
                    .underline()
            }
            .accessibilityLabel(Text("feedback.queue.openIssue"))
        } else {
            Text(verbatim: FeedbackQueueFormat.emptyValue)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func expandButton(_ row: FeedbackEntry) -> some View {
        TSButton(
            model.isExpanded(row.id) ? "feedback.queue.hideDetails" : "feedback.queue.showDetails",
            variant: .ghost,
            size: .small
        ) {
            model.toggleExpanded(row.id)
        }
    }

    // MARK: - Compact (iPhone) cards

    private func rowCard(_ row: FeedbackEntry) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: FeedbackQueueFormat.dash(row.title))
                            .font(Font.TS.bodySm)
                            .fontWeight(.medium)
                            .foregroundStyle(Color.TS.textPrimary)
                        Text(verbatim: FeedbackQueueFormat.dateTime(row.createdAt))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    FeedbackStatusBadge(status: row.status)
                }
                HStack(spacing: TSSpacing.sm) {
                    FeedbackCategoryBadge(category: row.category)
                    Spacer(minLength: TSSpacing.sm)
                    githubCell(row)
                }
                pageRouteRow(row)
                reporterRow(row)
                expandButton(row)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                if model.isExpanded(row.id) {
                    FeedbackExpansion(row: row, model: model)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func pageRouteRow(_ row: FeedbackEntry) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("feedback.queue.col.pageRoute").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: FeedbackQueueFormat.dash(row.pageRoute))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.trailing)
        }
    }

    private func reporterRow(_ row: FeedbackEntry) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("feedback.queue.col.reporter").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            reporterCell(row)
        }
    }

    // MARK: - Reporter identity (web `UserCell` {id: submitter_subject, email: user_email})

    /// The reporter cell — mirrors the web `UserCell` with `showEmail=false`: an avatar
    /// plus a single line, never a secondary line and never the submitter IP (the web
    /// cell is only handed the subject + email).
    private func reporterCell(_ row: FeedbackEntry) -> some View {
        HStack(spacing: TSSpacing.sm) {
            TSAvatar(name: Self.reporterDisplay(row) ?? "", size: 28)
            Group {
                if let display = Self.reporterDisplay(row) {
                    Text(verbatim: display)
                } else {
                    Text("avatar.unknown")
                }
            }
            .font(Font.TS.bodySm)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
        }
    }

    /// Web `UserCell` display priority with `name` unset: email local-part, else the
    /// submitter subject, else `nil` (rendered as the localized "Unknown user").
    static func reporterDisplay(_ row: FeedbackEntry) -> String? {
        if !row.userEmail.isEmpty {
            let local = row.userEmail.split(separator: "@").first.map(String.init) ?? row.userEmail
            if !local.isEmpty { return local }
        }
        if !row.submitterSubject.isEmpty { return row.submitterSubject }
        return nil
    }
}
