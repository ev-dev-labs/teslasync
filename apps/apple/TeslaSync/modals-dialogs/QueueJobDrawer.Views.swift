//
//  QueueJobDrawer.Views.swift
//  TeslaSync — P4 modal / dialog · 0020 · QueueJobDrawer (Apple)
//
//  The panel chrome for `QueueJobDrawer`: the dimming scrim (web backdrop), the titled header
//  (web `<h3>` + close "×"), the live-state freshness chip + cached-data banner (ADR-013), and
//  the populated job list (web `<ul>` of rows with the inline reload-failure banner). The job row
//  + the loading / empty / error leaf states live in QueueJobDrawer.Rows.swift. All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). No web Tailwind classes are
//  ported — platform materials + tokens reproduce the glass panel.
//

import SwiftUI

// MARK: - Scrim (web backdrop)

/// The dimming backdrop behind the panel (web `bg-[var(--surface-overlay)] backdrop-blur` scrim).
/// Tap dismisses (web `onClick={onClose}`); it is decorative to VoiceOver (web
/// `aria-hidden="true"`) since the close button + the panel's escape action carry the accessible
/// dismissal.
struct QueueJobDrawerScrim: View {
    let onTap: () -> Void

    var body: some View {
        Rectangle()
            .fill(Color.black.opacity(0.45))
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture(perform: onTap)
            .accessibilityHidden(true)
    }
}

// MARK: - Header (web `<h3>` + close)

/// The panel header (web `title && <header>`): the drawer title, the freshness chip, and the
/// trailing close button (web `<button aria-label="Close"><X/></button>`).
struct QueueJobDrawerHeader: View {
    let title: String
    let connection: QueueJobDrawerConnection
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            if connection != .live {
                QueueJobDrawerFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            QueueJobDrawerCloseButton(label: closeLabel, action: onClose)
        }
        .padding(.horizontal, TSSpacing.x2xl)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }
}

/// The header's close affordance (web close "×"). Carries the Escape keyboard shortcut so a
/// hardware keyboard dismisses the panel (web `Escape` → `onClose`).
struct QueueJobDrawerCloseButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .keyboardShortcut(.cancelAction)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013). Rendered only
/// when not live, so a cached list is clearly labeled.
struct QueueJobDrawerFreshnessChip: View {
    let connection: QueueJobDrawerConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle()
                .fill(descriptor.tone)
                .frame(width: 6, height: 6)
            Text(verbatim: QueueJobDrawerStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: QueueJobDrawerStrings.string(descriptor.key, descriptor.fallback)))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: QueueJobDrawerConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "queueStatus.drawer.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "queueStatus.drawer.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "queueStatus.drawer.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the body when the bound source is not live, so a cached
/// list is clearly labeled (ADR-013).
struct QueueJobDrawerConnectivityBanner: View {
    let connection: QueueJobDrawerConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "queueStatus.drawer.offlineBanner" : "queueStatus.drawer.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded jobs"
            : "Reconnecting — this list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: QueueJobDrawerStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Populated list (web `<ul>`)

/// The populated job list (web `<ul className="space-y-2">`): the inline reload-failure banner
/// (when cached rows survive a failed reload) above one `QueueJobRow` per job.
struct QueueJobDrawerList: View {
    @Bindable var model: QueueJobDrawerModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if let message = model.inlineErrorMessage {
                QueueJobDrawerInlineError(message: message)
            }
            ForEach(model.jobs) { job in
                QueueJobRow(job: job, model: model)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
