//
//  SoftwareUpdatesTimelineView.swift
//  TeslaSync — P4 feature view · P7 · SoftwareUpdates (Apple) — Update Timeline
//
//  The update timeline (web GlassPanel 4) and its per-update card (web GlassPanel
//  5). The panel hosts the four data states inline — loading shimmer, the empty
//  `ContentUnavailableView`, a retryable error, and the populated timeline + pager
//  — so the data-bearing region is never a blank panel (ADR-011). Each row
//  reproduces the web `EventRow`: a status node, the version, a tone-coded badge,
//  the release-notes link, the vehicle name and the install / schedule dates.
//

import SwiftUI

// MARK: - GlassPanel 4 — Update Timeline

/// The update-timeline panel (web GlassPanel 4) — section title + the four data
/// states. The summary cards live above it and always render; this region owns
/// the loading / empty / error / success branches for the `/software-updates` feed.
struct SoftwareUpdatesTimelinePanel: View {
    let state: SoftwareUpdatesViewState
    let updates: [SoftwareUpdatesItem]
    let page: Int
    let hasPreviousPage: Bool
    let hasNextPage: Bool
    let displayName: (Int64) -> String
    let onRetry: () -> Void
    let onPrevious: () -> Void
    let onNext: () -> Void

    var body: some View {
        SoftwareUpdatesCard {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                SoftwareUpdatesSectionTitle(
                    text: String(localized: "Update Timeline", defaultValue: "Update Timeline")
                )
                content
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .loading:
            loadingView
        case .empty:
            emptyView
        case let .error(message):
            errorView(message)
        case .success:
            timeline
        }
    }

    // MARK: loading

    private var loadingView: some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 72)
            }
        }
        .redacted(reason: .placeholder) // parity:allow native shimmer for the loading state
        .accessibilityLabel(Text(String(localized: "Update Timeline", defaultValue: "Update Timeline")))
    }

    // MARK: empty

    private var emptyView: some View {
        ContentUnavailableView {
            Label(
                String(localized: "No update history", defaultValue: "No update history"),
                systemImage: "iphone.slash"
            )
        } description: {
            Text(String(
                localized: "No software update history available",
                defaultValue: "No software update history available"
            ))
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: error

    private func errorView(_ message: String) -> some View {
        ContentUnavailableView {
            Label(
                String(localized: "error.loadFailed", defaultValue: "Failed to load data"),
                systemImage: "exclamationmark.triangle"
            )
        } description: {
            Text(message)
        } actions: {
            Button(String(localized: "common.retry", defaultValue: "Retry"), action: onRetry)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: success

    private var timeline: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(updates) { update in
                SoftwareUpdateRow(update: update, vehicleName: displayName(update.vehicleID))
            }
            SoftwareUpdatesPager(
                page: page,
                hasPrevious: hasPreviousPage,
                hasNext: hasNextPage,
                onPrevious: onPrevious,
                onNext: onNext
            )
            .padding(.top, TSSpacing.sm)
        }
    }
}

// MARK: - GlassPanel 5 — One update row

/// A single firmware row (web GlassPanel 5 / `EventRow`): a status node, the
/// version, a tone-coded status badge, the release-notes link, the vehicle name
/// and the install / schedule / created timestamps.
struct SoftwareUpdateRow: View {
    let update: SoftwareUpdatesItem
    let vehicleName: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            statusNode
            card
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityLabel))
    }

    private var statusNode: some View {
        ZStack {
            Circle()
                .fill(tone.color.opacity(0.15))
                .frame(width: 28, height: 28)
            Image(systemName: symbol)
                .font(.caption)
                .foregroundStyle(tone.color)
        }
        .accessibilityHidden(true)
    }

    private var card: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.sm) {
                    Text(update.version)
                        .font(Font.TS.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    SoftwareUpdatesBadge(text: statusLabel, tone: tone)
                    releaseNotesLink
                }
                Text(vehicleName)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
            datesColumn
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md)
                .stroke(Color.TS.border, lineWidth: 1)
        )
    }

    @ViewBuilder private var releaseNotesLink: some View {
        if let url = update.releaseNotesURL {
            Link(destination: url) {
                Image(systemName: "arrow.up.right.square")
                    .font(.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .help(releaseNotesLabel)
            .accessibilityLabel(Text(releaseNotesLabel))
        }
    }

    @ViewBuilder private var datesColumn: some View {
        VStack(alignment: .trailing, spacing: TSSpacing.xs) {
            if let installedAt = update.installedAt {
                Label(Self.formatted(installedAt), systemImage: "calendar")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            if let scheduledAt = update.scheduledAt, update.installedAt == nil {
                Label("\(scheduledWord): \(Self.formatted(scheduledAt))", systemImage: "clock")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusWarning)
            }
            Text(Self.formatted(update.createdAt))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .labelStyle(.titleAndIcon)
    }

    // MARK: derived

    private var tone: SoftwareUpdateBadgeTone { SoftwareUpdateStatusDisplay.tone(for: update.status) }
    private var symbol: String { SoftwareUpdateStatusDisplay.symbol(for: update.status) }
    private var statusLabel: String { SoftwareUpdateStatusDisplay.label(for: update.status) }
    private var scheduledWord: String { String(localized: "Scheduled", defaultValue: "Scheduled") }
    private var releaseNotesLabel: String {
        String(localized: "View release notes", defaultValue: "View release notes")
    }

    private var accessibilityLabel: String {
        "\(update.version), \(statusLabel), \(vehicleName)"
    }

    private static func formatted(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }
}

// MARK: - Pagination (web `Pagination`)

/// The timeline pager (web `Pagination`) — Previous / page indicator / Next.
struct SoftwareUpdatesPager: View {
    let page: Int
    let hasPrevious: Bool
    let hasNext: Bool
    let onPrevious: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack {
            Button(action: onPrevious) {
                Label(
                    String(localized: "common.previous", defaultValue: "Previous"),
                    systemImage: "chevron.left"
                )
            }
            .disabled(!hasPrevious)

            Spacer(minLength: TSSpacing.md)

            Text("\(pageWord) \(page)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityLabel(Text("\(pageWord) \(page)"))

            Spacer(minLength: TSSpacing.md)

            Button(action: onNext) {
                Label(
                    String(localized: "common.next", defaultValue: "Next"),
                    systemImage: "chevron.right"
                )
            }
            .disabled(!hasNext)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }

    private var pageWord: String { String(localized: "Page", defaultValue: "Page") }
}
