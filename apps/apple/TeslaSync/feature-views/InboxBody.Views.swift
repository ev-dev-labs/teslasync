//
//  InboxBody.Views.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  Shared presentational chrome for the inbox: the severity tint / SF Symbol
//  mapping (web `SeverityBadge` colours), the native stale / offline freshness
//  banner (P4 states contract), and the filter summary bar — the read-state
//  segmented control (web `read` URL param) plus removable chips for every active
//  narrowing filter and a "Clear all" affordance (InboxBody owns the URL filter
//  state; the multi-select editor is the NotificationFilterBar surface). All
//  consume pre-localized strings from the P1/S10 facade + the shared P1/S9 tokens.
//

import SwiftUI

// MARK: - Severity → tint + SF Symbol (web `SeverityBadge`)

extension InboxSeverity {
    /// The tint mirroring the web severity colour (info → cyan/info, warn → amber,
    /// critical → red).
    var tint: Color {
        switch self {
        case .info: Color.TS.statusInfo
        case .warn: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        }
    }

    /// The SF Symbol mirroring the web severity glyph.
    var symbolName: String {
        switch self {
        case .info: "info.circle.fill"
        case .warn: "exclamationmark.triangle.fill"
        case .critical: "exclamationmark.octagon.fill"
        }
    }
}

// MARK: - Freshness banner (native stale / offline chrome)

/// The stale / offline banner shown above the list when the bound source is not
/// fully live, so cached rows are clearly labeled with a manual refresh.
struct InboxFreshnessBanner: View {
    let connection: InboxConnection
    let localize: (String, String) -> String
    let onRefresh: () -> Void

    private var offline: Bool {
        connection == .offline
    }

    private var tone: Color {
        offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: String {
        offline
            ? localize("notifications.inbox.offlineBanner", "Offline — showing the last known notifications")
            : localize("notifications.inbox.staleBanner", "Reconnecting — notifications may be out of date")
    }

    private var refreshLabel: String {
        localize("notifications.inbox.refresh", "Refresh")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                Text(verbatim: refreshLabel)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: refreshLabel))
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Filter summary bar (web `read` param + active-filter reflection)

/// The inbox's own filter chrome: the read-state segmented control plus a
/// reflection of the active narrowing filters with per-chip removal + "Clear all".
struct InboxFilterSummaryBar: View {
    @Bindable var model: InboxBodyModel

    private var readSelection: Binding<InboxReadFilter> {
        Binding(get: { model.filters.read }, set: { model.setReadFilter($0) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Picker(selection: readSelection) {
                Text(verbatim: model.localize("notifications.read.all", "All")).tag(InboxReadFilter.all)
                Text(verbatim: model.localize("notifications.read.read", "Read")).tag(InboxReadFilter.read)
                Text(verbatim: model.localize("notifications.read.unread", "Unread")).tag(InboxReadFilter.unread)
            } label: {
                Text(verbatim: model.localize("notifications.read.label", "Read state"))
            }
            .pickerStyle(.segmented)
            .accessibilityLabel(Text(verbatim: model.localize("notifications.read.label", "Read state")))

            if model.filters.hasActiveFilters {
                activeFilters
            }
        }
    }

    private var activeFilters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.xs) {
                ForEach(model.filters.severity, id: \.self) { severity in
                    InboxFilterChip(label: model.localize(severity.labelKey, severity.labelFallback)) {
                        model.removeSeverity(severity)
                    }
                }
                ForEach(model.filters.vehicleIds, id: \.self) { vehicleId in
                    InboxFilterChip(label: model.vehicleMap[vehicleId]?.label ?? "#\(vehicleId)") {
                        model.removeVehicle(vehicleId)
                    }
                }
                ForEach(model.filters.ruleIds, id: \.self) { ruleId in
                    InboxFilterChip(label: model.ruleMap[ruleId]?.name ?? "#\(ruleId)") {
                        model.removeRule(ruleId)
                    }
                }
                if !model.filters.search.isEmpty {
                    InboxFilterChip(label: "\u{201C}\(model.filters.search)\u{201D}") { model.clearSearch() }
                }
                InboxClearAllButton(label: model.localize("notifications.filters.clearAll", "Clear all")) {
                    model.clearAllFilters()
                }
            }
            .padding(.vertical, 2)
        }
    }
}

/// One removable active-filter chip.
private struct InboxFilterChip: View {
    let label: String
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: label))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
    }
}

/// The "Clear all" affordance shown beside the active-filter chips.
private struct InboxClearAllButton: View {
    let label: String
    let onClear: () -> Void

    var body: some View {
        Button(action: onClear) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.accent)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}
