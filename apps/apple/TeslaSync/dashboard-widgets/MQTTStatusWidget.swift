//
//  MQTTStatusWidget.swift
//  TeslaSync — P4 dashboard widget · 0068 · MQTTStatusWidget (Apple)
//
//  The composable MQTT Status dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/MQTTStatusWidget.tsx. Binds through
//  `MQTTStatusModel` (no networking in the view); renders every state (loading /
//  empty / error / content) with a live/stale/offline freshness chip, and the
//  responsive compact (1×2) vs standard (2×2+) layouts from the web source.
//

import SwiftUI

// MARK: - MQTTStatusWidget (the dashboard surface)

/// The composable MQTT Status dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/MQTTStatusWidget.tsx`. Renders every state from
/// the web source inside a glass widget shell, binding through `MQTTStatusModel`
/// (P1/S8). No networking lives here.
public struct MQTTStatusWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MQTTStatusWidget"

    /// Canonical registry metadata (registry/system.ts → "mqtt-status").
    public static let registration = DashboardWidgetRegistration(
        id: "mqtt-status",
        nameKey: "widget.mqtt.title",
        descriptionKey: "widget.mqtt.description",
        category: "system",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 3, rows: 40)
    )

    @State private var model: MQTTStatusModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: MQTTStatusModel,
        size: DashboardWidgetSize = MQTTStatusWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = MQTTStatusWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        MQTTStatusModel.isCompact(size)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension MQTTStatusWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            if !isCompact {
                MQTTStatusStrings.text("widget.mqtt.title", "MQTT Status")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            MQTTFreshnessChip(connection: model.connection)
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(MQTTStatusStrings.text("widget.mqtt.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                MQTTStatusStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(MQTTStatusStrings.text("widget.mqtt.openA11y", "Open the Fleet Telemetry page"))
    }
}

// MARK: - Content states

extension MQTTStatusWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            if isCompact { compactContent } else { standardContent }
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 72, height: 18, cornerRadius: TSRadius.pill)
            if !isCompact {
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                    TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                }
            } else {
                TSSkeleton(width: 90, height: 24, cornerRadius: TSRadius.sm)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement()
        .accessibilityLabel(MQTTStatusStrings.text("widget.mqtt.loading", "Loading MQTT status"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                MQTTStatusStrings.text("widget.mqtt.noData", "No MQTT status data")
            } icon: {
                Image(systemName: "antenna.radiowaves.left.and.right")
            }
        } description: {
            MQTTStatusStrings.text("widget.mqtt.emptyHint", "Waiting for Fleet Telemetry data.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            MQTTStatusStrings.text("widget.mqtt.errorTitle", "Couldn't load MQTT status")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            Button {
                model.refresh()
            } label: {
                MQTTStatusStrings.text("widget.mqtt.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(MQTTStatusStrings.text("widget.mqtt.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content layouts (web compact 1×2 / standard 2×2+)

extension MQTTStatusWidget {
    private var messagesPerSecondText: String {
        MQTTStatusFormat.number(model.stats.messagesPerSecond, decimals: 1)
    }

    private var totalMessagesText: String {
        MQTTStatusFormat.int(model.stats.totalMessages)
    }

    private var lastMessageText: String {
        MQTTStatusFormat.lastMessageText(model.stats.lastMessage)
    }

    /// Compact layout (1×2): status chip over the message rate (web `isCompact`).
    private var compactContent: some View {
        VStack(spacing: TSSpacing.sm) {
            MQTTStatusChip(connected: model.brokerConnected, size: .small)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(verbatim: messagesPerSecondText)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                MQTTStatusStrings.text("widget.mqtt.msgSec", "msg/s")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Standard layout (2×2+): status row + stat grid + last-message/broker footer.
    private var standardContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack {
                MQTTStatusStrings.text("widget.mqtt.status", "Status")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer()
                MQTTStatusChip(connected: model.brokerConnected, size: .small)
            }

            HStack(spacing: TSSpacing.sm) {
                MQTTStatTile(
                    label: MQTTStatusStrings.string("widget.mqtt.msgRate", "Messages/sec"),
                    value: messagesPerSecondText
                )
                MQTTStatTile(
                    label: MQTTStatusStrings.string("widget.mqtt.totalToday", "Total Messages"),
                    value: totalMessagesText
                )
            }

            Spacer(minLength: 0)

            VStack(spacing: TSSpacing.xs) {
                Divider().overlay(Color.TS.border)
                MQTTFooterRow(
                    label: MQTTStatusStrings.string("widget.mqtt.lastMessage", "Last Message"),
                    value: lastMessageText
                )
                MQTTFooterRow(
                    label: MQTTStatusStrings.string("widget.mqtt.broker", "Broker"),
                    value: model.brokerLabel
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
