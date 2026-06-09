//
//  FSMHealthPanel.Views.swift
//  TeslaSync — P4 feature view · 0228 · FSMHealthPanel (Apple)
//
//  Presentational chrome composed by `FSMHealthPanel`: the panel title + freshness chip,
//  the stale/offline banner, the loading / error / all-clear states, and the derived
//  alert grid + alert card (web `Grid` of `HealthAlert` cards). All copy resolves through
//  the P1/S10 facade; all chrome is token-driven (P1/S9). No networking and no Tailwind
//  ports live here.
//

import SwiftUI

// MARK: - Title (web uppercase `<h2>` "FSM Health")

/// The panel title — the web `<h2 class="… uppercase tracking-wider">` shown only above the
/// alert grid. Rendered as a header for assistive tech.
struct FSMHealthTitle: View {
    var body: some View {
        Text(verbatim: FSMHealthMessages.panelTitle(localize: FSMHealthPanelStrings.string))
            .font(Font.TS.label)
            .textCase(.uppercase)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013). The web source
/// does not model connectivity (its parent does); this is the P4 freshness envelope.
struct FSMHealthFreshnessChip: View {
    let connection: FSMHealthConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            FSMHealthPanelStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(FSMHealthPanelStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: FSMHealthConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "fsm.health.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "fsm.health.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "fsm.health.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the body when the bound source is not live, so
/// cached health is clearly labeled (web `DataFreshness` intent).
struct FSMHealthConnectivityBanner: View {
    let connection: FSMHealthConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "fsm.health.offlineBanner" : "fsm.health.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded health"
            : "Reconnecting — FSM health may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            FSMHealthPanelStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - All-clear row (web `alerts.length === 0` branch)

/// The healthy state — the web all-clear row (a green dot + "all FSMs healthy" copy). The
/// friendly "empty" state, never a blank box.
struct FSMHealthAllClearRow: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(Color.TS.statusSuccess)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            Text(verbatim: FSMHealthMessages.allClear(localize: FSMHealthPanelStrings.string))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.statusSuccess)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: faint alert-card blocks so the panel keeps its shape
/// while the parent query resolves. Respects Reduce Motion (via `TSSkeleton`).
struct FSMHealthLoadingView: View {
    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 2, id: \.self) { _ in
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 90, height: 11)
                        TSSkeleton(width: 150, height: 10)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 24, height: 18)
                }
                .padding(TSSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    Color.TS.surfaceGlass,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
            }
        }
        .accessibilityElement()
        .accessibilityLabel(FSMHealthPanelStrings.text("fsm.health.loadingA11y", "Loading FSM health"))
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline
/// error treatment used across the feature-view surfaces.
struct FSMHealthError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            FSMHealthPanelStrings.text("fsm.health.errorTitle", "Couldn't load FSM health")
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
                FSMHealthPanelStrings.text("fsm.health.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(FSMHealthPanelStrings.text("fsm.health.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Alert grid (web `Grid cols={{ default: 1, md: alerts.length }}`)

/// The derived alert grid — the responsive 1/N-column grid of `HealthAlert` cards, wrapped
/// in the shared fade-in (web `FadeIn` intent). `.adaptive` reproduces the web
/// `cols={{ default: 1, md: alerts.length }}`: one column on a compact width, several once
/// the width allows.
struct FSMHealthAlertGrid: View {
    let alerts: [FSMHealthAlert]
    let locale: Locale

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(alerts) { alert in
                FSMHealthAlertCard(alert: alert, locale: locale)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Alert card (web per-alert `<div class="flex items-start gap-3 …">`)

/// One health-alert card — the leading severity icon, the title + count message, and the
/// trailing bold count badge (web `fmtInt`). Tinted by severity (warning ⇒ amber, info ⇒
/// blue), matching the web `border-*-500/20` + `bg-*-500/5` treatment.
struct FSMHealthAlertCard: View {
    let alert: FSMHealthAlert
    let locale: Locale

    private var tone: Color {
        alert.severity == .warning ? Color.TS.statusWarning : Color.TS.statusInfo
    }

    private var iconName: String {
        // Web `flap ? AlertTriangle : stuck ? Timer : RotateCw`.
        switch alert.kind {
        case .flap: "exclamationmark.triangle.fill"
        case .stuck: "timer"
        case .recovery: "arrow.clockwise"
        }
    }

    private var title: String {
        FSMHealthMessages.title(for: alert.kind, localize: FSMHealthPanelStrings.string)
    }

    private var message: String {
        FSMHealthMessages.message(for: alert, localize: FSMHealthPanelStrings.string)
    }

    private var badge: String {
        FSMHealthFormat.count(alert.count, locale: locale)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: iconName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tone)
                .frame(width: 16)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(tone)
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: badge)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(tone)
                .monospacedDigit()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.opacity(0.06), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(title), \(badge): \(message)"))
    }
}
