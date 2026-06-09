//
//  CommandHistoryWidget.swift
//  TeslaSync — P4 dashboard widget · 0029 · CommandHistoryWidget (Apple)
//
//  The composable "Command History" dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/CommandHistoryWidget.tsx. Renders every state from the
//  web source (loading / empty / error / stale / offline / content) inside a glass
//  widget shell, binding through `CommandModel` (P1/S8). No networking lives here;
//  the size-derived compact gate (web `isCompact = size.cols <= 1`) and the feed cap
//  (web `maxItems={10}`) are applied here via `CommandLayout`.
//

import Foundation
import SwiftUI

// MARK: - CommandHistoryWidget (the dashboard surface)

/// The composable Command History dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/CommandHistoryWidget.tsx`. Lists the recent vehicle
/// commands newest-first with their success / failed / pending status, collapsing to
/// the single latest command + a status badge when narrow. Binds through
/// `CommandModel` (P1/S8); the view never touches the network.
public struct CommandHistoryWidget: View {
    @State private var model: CommandModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: CommandModel,
        size: DashboardWidgetSize = CommandHistoryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = CommandHistoryWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — collapse to the single latest command.
    private var isCompact: Bool {
        CommandLayout.isCompact(for: size)
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

extension CommandHistoryWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "terminal.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            CommandStrings.text("widget.commandHistory", "Command History")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = CommandStrings.string("widget.commandLive", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = CommandStrings.string("widget.commandStale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = CommandStrings.string("widget.commandOffline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(CommandStrings.text("widget.commandRefresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                CommandStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(CommandStrings.text("widget.commandOpenA11y", "Open the commands page"))
    }

    // MARK: Content states

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
            loadedContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< (isCompact ? 1 : 4), id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 44, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(CommandStrings.text("widget.commandLoading", "Loading command history"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                CommandStrings.text("widget.noCommands", "No commands sent")
            } icon: {
                Image(systemName: "terminal.fill")
            }
        } description: {
            CommandStrings.text(
                "widget.commandEmptyHint",
                "Commands you send to your vehicle will appear here."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            CommandStrings.text("widget.commandErrorTitle", "Couldn't load command history")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                CommandStrings.text("widget.commandRetry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CommandStrings.text("widget.commandRetry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live, !isCompact {
                CommandConnectivityBanner(connection: model.connection)
            }
            if isCompact {
                if let latest = model.latest {
                    CommandCompactRow(item: latest)
                } else {
                    CommandEmptyFeed()
                }
            } else {
                CommandEventFeed(items: model.items, maxItems: CommandLayout.feedLimit)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
    }
}
