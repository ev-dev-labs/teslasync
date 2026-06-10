//
//  IncidentsCard.States.swift
//  TeslaSync — P4 feature view · 0247 · IncidentsCard (Apple)
//
//  The non-content states `IncidentsCard` switches over — loading (a spinner inside the panel
//  chrome), empty (the web source collapses to null; the native surface renders a friendly,
//  labeled empty state per the P4 "every state MUST render — no hidden surfaces" mandate),
//  error (a `QueryError`-style panel with a retry affordance), the inline reload-error above a
//  retained list, and the live-state freshness chip + cached-data banner (ADR-013). Every
//  state renders real chrome — never a blank box. Copy via the P1/S10 facade (ICView); chrome
//  via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (first paint)

/// The first-paint loading state rendered inside the card chrome, so the layout doesn't
/// reflow when the incidents arrive.
struct IncidentsLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            ICView.text(IncidentsCardText.loading)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (web collapses; native renders a friendly state)

/// The resolved-but-no-incidents state over a native `ContentUnavailableView`. The web card
/// returns `null` here; the native surface renders a labeled "all clear" state so the section
/// is never a hidden / blank box.
struct IncidentsEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ICView.text(IncidentsCardText.emptyTitle)
            } icon: {
                Image(systemName: "checkmark.shield.fill")
                    .foregroundStyle(Color.TS.statusSuccess)
            }
        } description: {
            ICView.text(IncidentsCardText.emptyMessage)
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (a first-load failure widened to a
/// `QueryError`-style panel so it isn't a blank box).
struct IncidentsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ICView.text(IncidentsCardText.errorTitle)
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
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            ICView.text(IncidentsCardText.retry)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(ICView.text(IncidentsCardText.retry))
    }
}

// MARK: - Inline reload error (failed refresh while rows remain)

/// The inline list-load error shown above the populated rows when a reload failed but cached
/// incidents remain, so the failure is surfaced without blanking the retained list.
struct IncidentsInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            ICView.text(IncidentsCardText.errorTitle)
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
struct IncidentsFreshnessChip: View {
    let connection: IncidentsConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ICView.text(descriptor.text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ICView.text(descriptor.text))
    }

    private struct Descriptor {
        let tone: Color
        let text: LocalizedText
    }

    private static func descriptor(for connection: IncidentsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, text: IncidentsCardText.live)
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, text: IncidentsCardText.stale)
        case .offline:
            Descriptor(tone: Color.TS.textMuted, text: IncidentsCardText.offline)
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the content when the bound source is not live, so a
/// cached incident list is clearly labeled (ADR-013).
struct IncidentsConnectivityBanner: View {
    let connection: IncidentsConnection

    var body: some View {
        let offline = connection == .offline
        let text = offline ? IncidentsCardText.offlineBanner : IncidentsCardText.staleBanner
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            ICView.text(text).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
