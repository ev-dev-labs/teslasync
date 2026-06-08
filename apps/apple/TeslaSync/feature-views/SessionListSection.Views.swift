//
//  SessionListSection.Views.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  The populated content orchestrator + the section header, freshness chip,
//  cached-data banner, and the loading / empty / no-matches / error states composed
//  by `SessionListSection`. All copy resolves through the P1/S10 facade; all chrome
//  is token-driven (P1/S9). No networking and no web Tailwind ports live here.
//

import SwiftUI

// MARK: - Content (web populated branch: search + controls + list + pagination)

/// The populated body shown for `.content`: the search field + active chips, the
/// "All Sessions" header + controls, the bulk toolbar, the rows (or the no-matches
/// state), and the pager — the web `<>…</>` after the loading/empty guards.
struct SessionListContent: View {
    @Bindable var model: SessionListModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            searchSection
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SessionListHeader(count: model.filteredCount, connection: model.connection)
                SessionControlsBar(model: model)
            }
            listSection
            SessionPaginationBar(model: model)
        }
    }

    private var searchSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            SessionSearchField(model: model)
            if !model.activeFilterChips.isEmpty {
                SessionActiveChips(
                    chips: model.activeFilterChips,
                    onRemove: { model.removeChip($0) },
                    onClearAll: { model.clearAllFilters() }
                )
            }
        }
    }

    @ViewBuilder
    private var listSection: some View {
        if model.hasNoMatches {
            SessionNoMatchesState()
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if model.supportsBulkActions {
                    SessionBulkToolbar(model: model)
                }
                SessionRowsList(model: model)
            }
        }
    }
}

// MARK: - Rows list (web `StaggerContainer` of `ChargingSessionCard`)

/// The staggered list of session rows for the current page (web `StaggerContainer` →
/// `filteredSessions.map(<ChargingSessionCard>)`).
struct SessionRowsList: View {
    @Bindable var model: SessionListModel

    var body: some View {
        TSStaggerContainer(spacing: TSSpacing.md) {
            ForEach(Array(model.pagedItems.enumerated()), id: \.element.id) { index, item in
                TSStaggerItem(index: index) {
                    SessionRow(
                        item: item,
                        formatting: model.formatting,
                        units: model.units,
                        localize: model.localize,
                        selectable: model.supportsBulkActions,
                        selected: model.selectedIDs.contains(item.id),
                        onToggleSelect: { on in model.toggleSelection(id: item.id, on: on) }
                    )
                }
            }
        }
    }
}

// MARK: - Header (web "All Sessions" title + count + freshness)

/// The list header: the charging glyph, the "All Sessions" title, the filtered count,
/// and the live-state freshness chip (web `<h3 class=section-title>` + count span).
struct SessionListHeader: View {
    let count: Int
    let connection: SessionListConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "bolt.batteryblock.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            SessionListStrings.text("charging.sessions.allSessions", "All Sessions")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: "(\(count))")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
            Spacer(minLength: TSSpacing.sm)
            SessionFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SessionFreshnessChip: View {
    let connection: SessionListConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SessionListStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SessionListStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: SessionListConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "charging.sessions.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "charging.sessions.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "charging.sessions.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the content when the bound source is not live,
/// so a cached list is clearly labeled (web `DataFreshness` intent).
struct SessionConnectivityBanner: View {
    let connection: SessionListConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.sessions.offlineBanner" : "charging.sessions.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded sessions"
            : "Reconnecting — this list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            SessionListStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web five `<Skeleton>` rows)

/// The initial-fetch skeleton chrome: five muted row blocks (web `[1,2,3,4,5].map`).
struct SessionLoadingState: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(height: 76, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(SessionListStrings.text("charging.sessions.loading", "Loading charging sessions"))
    }
}

// MARK: - Empty state (web "No charging sessions yet")

/// The resolved-but-no-sessions state (web `<EmptyState title="No charging sessions
/// yet">`) over a native `ContentUnavailableView`. Never a blank box.
struct SessionEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SessionListStrings.text("charging.list.empty", "No charging sessions yet")
            } icon: {
                Image(systemName: "bolt.batteryblock")
            }
        } description: {
            SessionListStrings.text(
                "charging.list.emptyDescription",
                "Charging data will appear here once your vehicle records a session."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - No-matches state (web "No sessions match your filters")

/// The has-sessions-but-filtered-to-empty state (web inner `<EmptyState title="No
/// sessions match your filters">`). The controls stay visible above it.
struct SessionNoMatchesState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SessionListStrings.text("charging.list.noMatches", "No sessions match your filters")
            } icon: {
                Image(systemName: "line.3.horizontal.decrease.circle")
            }
        } description: {
            SessionListStrings.text(
                "charging.list.noMatchesDescription",
                "Try clearing the search or charger filter to see more sessions."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`).
struct SessionErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SessionListStrings.text("charging.sessions.errorTitle", "Couldn't load charging sessions")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                SessionListStrings.text("charging.sessions.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SessionListStrings.text("charging.sessions.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Localization Text helper

extension SessionListStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated
    /// values are never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
