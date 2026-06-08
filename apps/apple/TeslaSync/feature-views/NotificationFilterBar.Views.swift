//
//  NotificationFilterBar.Views.swift
//  TeslaSync — P4 feature view · 0189 · NotificationFilterBar (Apple)
//
//  The populated content orchestrator plus the freshness chip, cached-data banner, and
//  the loading / empty / error states composed by `NotificationFilterBar`. All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No networking
//  and no web Tailwind ports live here.
//

import SwiftUI

// MARK: - Content (web `space-y-3`: FilterBar + RangePicker + ActiveFilterChips)

/// The populated body shown for `.content`: the cached-data banner (when not live),
/// the wrapping filter row (severity chips + vehicle/rule pickers + search), the
/// from/to date range, and the active-filter chips — the web `<div className="space-y-3">`.
struct NotificationFilterContent: View {
    @Bindable var model: NotificationFilterModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                NotificationConnectivityBanner(connection: model.connection)
            }
            NotificationFilterRow(model: model)
            NotificationDateRangeField(model: model)
            if !model.activeChips.isEmpty {
                NotificationActiveChips(
                    chips: model.activeChips,
                    onRemove: { model.removeChip($0) },
                    onClearAll: { model.clearAll() }
                )
            }
        }
    }
}

// MARK: - Filter row (web `<FilterBar>`)

/// The control row (web `FilterBar` flex-wrap): the severity chip group on one line,
/// then the vehicle + rule pickers and the search field, laid out side-by-side on a
/// regular width and stacked when compact. The freshness chip trails when the options
/// are not live.
struct NotificationFilterRow: View {
    @Bindable var model: NotificationFilterModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isWide: Bool {
        horizontalSizeClass != .compact
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                HStack {
                    Spacer(minLength: 0)
                    NotificationFreshnessChip(connection: model.connection)
                }
            }
            NotificationSeverityBar(model: model)
            pickersAndSearch
        }
    }

    @ViewBuilder
    private var pickersAndSearch: some View {
        if isWide {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                pickers
                NotificationSearchField(model: model).frame(maxWidth: 320)
                Spacer(minLength: 0)
            }
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                pickers
                NotificationSearchField(model: model)
            }
        }
    }

    private var pickers: some View {
        HStack(spacing: TSSpacing.sm) {
            NotificationOptionPicker(
                accessibilityLabel: model.localize("notifications.inbox.filter.vehicle", "Vehicle"),
                allLabel: model.localize("notifications.inbox.filter.allVehicles", "All vehicles"),
                options: model.vehicles.map { NotificationPickerOption(id: $0.id, label: $0.label) },
                selectedID: model.filters.selectedVehicleID,
                onSelect: { model.setVehicle($0) }
            )
            NotificationOptionPicker(
                accessibilityLabel: model.localize("notifications.inbox.filter.rule", "Rule"),
                allLabel: model.localize("notifications.inbox.filter.allRules", "All rules"),
                options: model.rules.map { NotificationPickerOption(id: $0.id, label: $0.label) },
                selectedID: model.filters.selectedRuleID,
                onSelect: { model.setRule($0) }
            )
        }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013), shown when
/// the options are stale / offline so a cached set is clearly labeled.
struct NotificationFreshnessChip: View {
    let connection: NotificationFilterConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            NotificationFilterStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(NotificationFilterStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: NotificationFilterConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "notifications.inbox.filter.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "notifications.inbox.filter.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "notifications.inbox.filter.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the controls when the bound source is not live,
/// so cached filter options are clearly labeled (web `DataFreshness` intent).
struct NotificationConnectivityBanner: View {
    let connection: NotificationFilterConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "notifications.inbox.filter.offlineBanner" : "notifications.inbox.filter.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded filter options"
            : "Reconnecting — filter options may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            NotificationFilterStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (initial option fetch)

/// The initial-fetch skeleton chrome: a row of muted pill blocks standing in for the
/// severity chips, the pickers, and the search field. Never a blank box.
struct NotificationFilterLoadingState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    TSSkeleton(width: 64, height: 28, cornerRadius: TSRadius.pill)
                }
            }
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 140, height: 32, cornerRadius: TSRadius.md)
                TSSkeleton(width: 140, height: 32, cornerRadius: TSRadius.md)
            }
            TSSkeleton(height: 32, cornerRadius: TSRadius.md)
        }
        .accessibilityElement()
        .accessibilityLabel(
            NotificationFilterStrings.text("notifications.inbox.filter.loading", "Loading notification filters")
        )
    }
}

// MARK: - Empty state (no vehicles or rules to filter by)

/// The resolved-but-no-options state (web friendly `EmptyState`) over a native
/// `ContentUnavailableView`. Never a blank box.
struct NotificationFilterEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                NotificationFilterStrings.text("notifications.inbox.filter.empty", "No notifications to filter yet")
            } icon: {
                Image(systemName: "line.3.horizontal.decrease.circle")
            }
        } description: {
            NotificationFilterStrings.text(
                "notifications.inbox.filter.emptyDescription",
                "Filters will appear here once your fleet records alerts. Search and severity still work."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (option fetch failed → retry)

/// The fetch-failure state with a retry affordance (web `QueryError`).
struct NotificationFilterErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            NotificationFilterStrings.text("notifications.inbox.filter.errorTitle", "Couldn't load filters")
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
                NotificationFilterStrings.text("notifications.inbox.filter.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(NotificationFilterStrings.text("notifications.inbox.filter.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Localization Text helper

extension NotificationFilterStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values
    /// are never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
