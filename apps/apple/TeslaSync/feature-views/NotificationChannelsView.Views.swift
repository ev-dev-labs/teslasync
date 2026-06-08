//
//  NotificationChannelsView.Views.swift
//  TeslaSync — P4 feature view · 0188 · NotificationChannelsView (Apple)
//
//  The presentational subviews composed by `NotificationChannelsView`: the stats row
//  (web `MetricCard` grid, with the skeleton fallback), the per-channel card (icon +
//  name + status + toggle + masked config preview + test/edit/delete actions), the
//  loading / empty / error chrome, and the transient toast overlay (web `useToast`). All
//  consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind
//  ports, no raw hex (brand tints come from the token categorical palette).
//

import SwiftUI

// MARK: - Stats row (web `MetricCard` grid / skeletons)

/// The four delivery-stat tiles, or four skeletons while stats are loading (web
/// `stats ? <grid/> : <skeletons/>`).
struct NotifStatsRow: View {
    let stats: NotifChannelStats?

    private static let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: Self.columns, spacing: TSSpacing.lg) {
            if let stats {
                NotifStatTile(
                    label: NotifChannelsStrings.string("notifications.stats.sent", "Total Sent"),
                    value: "\(stats.sent)",
                    systemImage: "checkmark.circle.fill",
                    tone: .success
                )
                NotifStatTile(
                    label: NotifChannelsStrings.string("notifications.stats.failed", "Failed"),
                    value: "\(stats.failed)",
                    systemImage: "xmark.circle.fill",
                    tone: .danger
                )
                NotifStatTile(
                    label: NotifChannelsStrings.string("notifications.stats.pending", "Pending"),
                    value: "\(stats.pending)",
                    systemImage: "bell.fill",
                    tone: .warning
                )
                NotifStatTile(
                    label: NotifChannelsStrings.string("notifications.stats.activeChannels", "Active Channels"),
                    value: stats.activeChannelsText,
                    systemImage: "bell.fill",
                    tone: .info
                )
            } else {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 80, cornerRadius: TSRadius.lg)
                }
            }
        }
    }
}

/// One delivery-stat tile (web `MetricCard` with a tinted icon).
struct NotifStatTile: View {
    let label: String
    let value: String
    let systemImage: String
    let tone: TSTone

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack {
                    TSMetricLabel(LocalizedStringKey(label))
                    Spacer(minLength: TSSpacing.sm)
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(tone.color)
                        .accessibilityHidden(true)
                }
                TSMetricValue(value)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: NotificationChannelsAccessibility.statLabel(label: label, value: value)))
    }
}

// MARK: - Channel card (web channel `GlassPanel`)

/// One configured channel — the web card: provider icon + name + status badge + enable
/// toggle, a masked config preview, and the test / edit / delete action row.
struct NotifChannelCard: View {
    let channel: NotificationChannelData
    let model: NotificationChannelsModel

    private var tint: Color {
        TSChartPalette.color(at: channel.kind.paletteIndex)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                configPreview
                actionRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .opacity(channel.enabled ? 1 : 0.6)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: cardAccessibilityLabel))
    }

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconBox
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: channel.name)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                HStack(spacing: TSSpacing.sm) {
                    Text(verbatim: kindLabel)
                        .font(Font.TS.caption)
                        .foregroundStyle(tint)
                    TSBadge(LocalizedStringKey(statusLabel), tone: channel.enabled ? .success : .neutral)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            enableToggle
        }
    }

    private var iconBox: some View {
        Image(systemName: channel.kind.systemImage)
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: 40, height: 40)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(tint.opacity(0.25), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var enableToggle: some View {
        Toggle(isOn: toggleBinding) { EmptyView() }
            .labelsHidden()
            .tint(Color.TS.accent)
            .disabled(model.isToggling(channel.id))
            .accessibilityLabel(Text(verbatim: NotifChannelsStrings.string(
                "notifications.channels.toggleLabel",
                "Toggle channel"
            )))
    }

    private var toggleBinding: Binding<Bool> {
        Binding(
            get: { channel.enabled },
            set: { _ in Task { await model.toggle(channel) } }
        )
    }

    private var configPreview: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(channel.configPreview) { entry in
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Text(verbatim: "\(entry.key):")
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textSecondary)
                    Text(verbatim: entry.displayValue)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(Color.TS.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
    }

    private var actionRow: some View {
        HStack(spacing: TSSpacing.sm) {
            testButton
            editButton
            Spacer(minLength: 0)
            deleteButton
        }
        .padding(.top, TSSpacing.xs)
        .overlay(alignment: .top) {
            Divider().overlay(Color.TS.border)
        }
        .padding(.top, TSSpacing.xs)
    }

    private var testButton: some View {
        let testing = model.isTesting(channel.id)
        let title = testing
            ? NotifChannelsStrings.string("notifications.channels.testing", "Testing…")
            : NotifChannelsStrings.string("notifications.channels.testShort", "Test")
        return TSButton(variant: .primary, size: .small, isLoading: testing) {
            Task { await model.test(channel) }
        } label: {
            Label { Text(verbatim: title) } icon: { Image(systemName: "testtube.2") }
        }
        .accessibilityLabel(Text(verbatim: title))
    }

    private var editButton: some View {
        TSButton(variant: .ghost, size: .small) {
            model.presentEdit(channel)
        } label: {
            Label {
                Text(verbatim: NotifChannelsStrings.string("common.edit", "Edit"))
            } icon: {
                Image(systemName: "pencil")
            }
        }
        .accessibilityLabel(Text(verbatim: NotifChannelsStrings.string("common.edit", "Edit")))
    }

    private var deleteButton: some View {
        TSButton(variant: .destructive, size: .small, isLoading: model.isDeleting(channel.id)) {
            Task { await model.delete(channel) }
        } label: {
            Image(systemName: "trash")
        }
        .accessibilityLabel(Text(verbatim: NotifChannelsStrings.string("common.delete", "Delete")))
    }

    private var kindLabel: String {
        NotifChannelsStrings.string(channel.kind.labelKey, channel.kind.labelFallback)
    }

    private var statusLabel: String {
        channel.enabled
            ? NotifChannelsStrings.string("notifications.channels.active", "Active")
            : NotifChannelsStrings.string("notifications.channels.disabled", "Disabled")
    }

    private var cardAccessibilityLabel: String {
        NotificationChannelsAccessibility.channelLabel(name: channel.name, kind: kindLabel, status: statusLabel)
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The channels grid while the list is loading — three card skeletons (web
/// `isLoading && [1,2,3].map(<Skeleton h-48/>)`).
struct NotifChannelsLoadingGrid: View {
    private static let columns = [GridItem(.adaptive(minimum: 280), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: Self.columns, spacing: TSSpacing.lg) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 192, cornerRadius: TSRadius.lg)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: NotifChannelsStrings.string(
            "notifications.channels.loadingA11y",
            "Loading channels"
        )))
    }
}

/// The empty state (web `EmptyState`) — never a blank panel.
struct NotifChannelsEmptyView: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(NotifChannelsStrings.string(
                "notifications.channels.empty.title",
                "No channels configured"
            )),
            message: LocalizedStringKey(NotifChannelsStrings.string(
                "notifications.channels.empty.message",
                "Add a notification channel to start receiving alerts via Discord, Slack, Telegram, Email, and more."
            )),
            systemImage: "bell.slash"
        )
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct NotifChannelsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSQueryError(
            message: message.isEmpty ? nil : LocalizedStringKey(message),
            onRetry: onRetry
        )
    }
}

// MARK: - Toast overlay (web `useToast`)

/// The transient toast banner anchored to the surface bottom (web `toast.success` /
/// `toast.error`). Auto-dismiss is driven by the surface's timed task.
struct NotifToastView: View {
    let toast: NotifToast

    private var tone: Color {
        toast.tone == .success ? Color.TS.statusSuccess : Color.TS.statusDanger
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: toast.tone == .success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(tone)
            Text(verbatim: toast.message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.3), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .combine)
    }
}
