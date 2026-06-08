//
//  SignalLogWidget.swift
//  TeslaSync — P4 dashboard widget · 0089 · SignalLogWidget (Apple)
//
//  The composable Signal Log dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/SignalLogWidget.tsx. Binds through SignalLogModel
//  (no networking in the view) and renders every state: loading / empty / error /
//  stale / offline / content, plus the compact signals/sec big number and the
//  pause/resume freeze.
//

import Foundation
import SwiftUI

// MARK: - SignalLogWidget (the dashboard surface)

/// The live raw-signal feed — the SwiftUI parity of the web `SignalLogWidget`.
/// Renders a header (scroll icon + title + freshness chip + pause/resume action)
/// over the resolved render state, binding through `SignalLogModel` (P1/S8). No
/// networking lives here.
public struct SignalLogWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SignalLogModel.surfaceSlug
    }

    /// Canonical registry metadata (registry/telemetry.ts → "signal-log").
    public static let registration = DashboardWidgetRegistration(
        id: "signal-log",
        nameKey: "widget.signalLog.title",
        descriptionKey: "widget.signalLog.description",
        category: "telemetry",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: SignalLogModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SignalLogModel,
        size: DashboardWidgetSize = SignalLogWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SignalLogWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        SignalLogBuilder.isCompact(cols: size.cols)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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

extension SignalLogWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "scroll")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            SignalLogStrings.text("widget.signalLog.title", "Signal Log")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            SignalLogFreshnessChip(
                freshness: model.freshness,
                updatedAt: model.updatedAt,
                onRefresh: { model.refresh() }
            )
            if !isCompact { pauseButton }
            if onOpen != nil { openButton }
        }
    }

    private var pauseButton: some View {
        let label = model.paused
            ? SignalLogStrings.string("widget.signalLog.resume", "Resume")
            : SignalLogStrings.string("widget.signalLog.pause", "Pause")
        return Button {
            model.togglePause()
        } label: {
            Image(systemName: model.paused ? "play.fill" : "pause.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SignalLogStrings.text("widget.signalLog.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SignalLogStrings.text("widget.signalLog.openA11y", "Open the signals page"))
    }
}

// MARK: - Content states

extension SignalLogWidget {
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
            resolvedContent
        }
    }

    @ViewBuilder
    private var resolvedContent: some View {
        if isCompact {
            SignalLogBigNumber(rate: model.roundedRate)
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.connection != .live { connectivityBanner }
                feedList
            }
        }
    }

    private var feedList: some View {
        let rows = model.displayItems
        return ScrollView {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    SignalLogRow(row: row, showsDivider: index < rows.count - 1)
                }
            }
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel(SignalLogStrings.text("widget.signalLog.feedA11y", "Signal update feed"))
    }

    private var loadingChrome: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 44, height: 18, cornerRadius: TSRadius.sm)
                    VStack(alignment: .leading, spacing: 4) {
                        TSSkeleton(width: 90, height: 8)
                        TSSkeleton(width: 52, height: 10)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 36, height: 8)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(SignalLogStrings.text("widget.signalLog.loading", "Loading signal updates"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SignalLogStrings.text("widget.signalLog.noSignals", "No signal updates yet")
            } icon: {
                Image(systemName: "scroll")
            }
        } description: {
            SignalLogStrings.text(
                "widget.signalLog.emptyHint",
                "Connect a vehicle streaming telemetry to watch its raw signals arrive live."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SignalLogStrings.text("widget.signalLog.errorTitle", "Couldn't load signal updates")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            retryButton
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button {
            model.refresh()
        } label: {
            SignalLogStrings.text("widget.signalLog.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SignalLogStrings.text("widget.signalLog.retry", "Retry"))
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.signalLog.offlineBanner" : "widget.signalLog.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last received updates"
            : "Reconnecting — updates may be delayed"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SignalLogStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
