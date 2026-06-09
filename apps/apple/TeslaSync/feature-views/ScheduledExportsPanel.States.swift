//
//  ScheduledExportsPanel.States.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  The non-table states `ScheduledExportsPanel` switches over — loading (web three
//  `Skeleton` bars), empty (web `EmptyState`), error (web `QueryError` with retry), the
//  inline list-error, and the live-state freshness chip + cached-data banner. Every state
//  renders real chrome — never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Localization Text helper

extension ScheduledExportsStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are
    /// never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Loading (web three `Skeleton` bars)

/// The first-paint loading state rendered inside the panel chrome (web three
/// `<Skeleton className="h-12 w-full" />` bars), so the layout doesn't reflow when data
/// arrives.
struct ScheduledExportsLoadingState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 48)
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                            .strokeBorder(Color.TS.border, lineWidth: 1)
                    )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ScheduledExportsStrings.text(
            "dataExport.scheduled.loadingA11y", "Loading scheduled exports"
        ))
    }
}

// MARK: - Empty (web `EmptyState`)

/// The resolved-but-no-schedules state (web `EmptyState` title + message) over a native
/// `ContentUnavailableView`. The header already exposes the "New schedule" action, so this
/// stays informational. Never a blank box.
struct ScheduledExportsEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ScheduledExportsStrings.text("dataExport.scheduled.empty", "No schedules yet")
            } icon: {
                Image(systemName: "calendar.badge.exclamationmark")
            }
        } description: {
            ScheduledExportsStrings.text(
                "dataExport.scheduled.emptyMessage",
                "Create a schedule to receive recurring exports automatically."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (the inline error widened to a
/// `QueryError`-style panel so a first-load failure isn't a blank box).
struct ScheduledExportsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ScheduledExportsStrings.text(
                "dataExport.scheduled.errorTitle", "Couldn't load scheduled exports"
            )
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
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            ScheduledExportsStrings.text("dataExport.scheduled.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(ScheduledExportsStrings.text("dataExport.scheduled.retry", "Retry"))
    }
}

// MARK: - Inline list-error (web inline error above the table)

/// The inline list-load error shown above the populated rows when a reload failed but
/// cached rows remain.
struct ScheduledExportsInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            ScheduledExportsStrings.text(
                "dataExport.scheduled.errorTitle", "Couldn't load scheduled exports"
            )
            .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message).font(Font.TS.caption)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct ScheduledExportsFreshnessChip: View {
    let connection: ScheduledExportsConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ScheduledExportsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ScheduledExportsStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: ScheduledExportsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "dataExport.scheduled.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "dataExport.scheduled.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "dataExport.scheduled.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the content when the bound source is not live, so a
/// cached list is clearly labeled (ADR-013).
struct ScheduledExportsConnectivityBanner: View {
    let connection: ScheduledExportsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "dataExport.scheduled.offlineBanner" : "dataExport.scheduled.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded schedules"
            : "Reconnecting — this list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ScheduledExportsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
