//
//  DashboardSettingsModal.States.swift
//  TeslaSync — P4 modal / dialog · 0022 · DashboardSettingsModal (Apple)
//
//  The chrome + leaf states `DashboardSettingsModal` composes: the pinned header (title + freshness
//  chip + close), the live-state freshness chip + connectivity / inline-error banners, the populated
//  container (scrolling sectioned form + pinned footer), the footer (Cancel + Save), and the loading /
//  empty / error leaf states. Every state renders real chrome — never a blank box (engineering
//  guideline #6). The form sections live in DashboardSettingsModal.Controls.swift. Copy via P1/S10
//  (`DashboardSettingsStrings`); chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Header (web dialog header)

/// The pinned header: the dialog title, an optional freshness chip, and the Close button (web Modal
/// header). Close maps to the web `onClose`.
struct DashboardSettingsHeader: View {
    @Bindable var model: DashboardSettingsModel
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Text(verbatim: DashboardSettingsStrings.string("dashSettings.title", "Dashboard Settings"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if model.connection != .live {
                DashboardSettingsFreshnessChip(connection: model.connection)
            }
            closeButton
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: DashboardSettingsStrings.string("dashSettings.close", "Close")))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound vehicle-list source's live-state (ADR-013).
struct DashboardSettingsFreshnessChip: View {
    let connection: DashboardSettingsConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: DashboardSettingsStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: DashboardSettingsStrings.string(descriptor.key, descriptor.fallback)))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: DashboardSettingsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "dashSettings.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "dashSettings.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "dashSettings.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity + inline-error banners

/// The cached-data banner shown above the form when the bound vehicle-list source is not live, so a
/// cached vehicle list is clearly labeled while reconnecting / offline (ADR-013).
struct DashboardSettingsConnectivityBanner: View {
    let connection: DashboardSettingsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "dashSettings.offlineBanner" : "dashSettings.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded vehicle list"
            : "Reconnecting — the vehicle list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: DashboardSettingsStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.1))
        .accessibilityElement(children: .combine)
    }
}

/// The inline vehicle-list-reload error shown above the form when a reload failed but the cached form
/// remains (web has no analog; added so a failed refresh never blanks the editable form).
struct DashboardSettingsInlineErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: DashboardSettingsStrings.string(
                "dashSettings.reloadError", "Couldn't refresh the vehicle list"
            ))
            .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message).font(Font.TS.caption).lineLimit(1)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Populated container (web scrolling form + footer)

/// The full settings form: an optional connectivity / inline-error banner, the scrolling sectioned
/// form (Identity / Vehicle Filter / Auto-Refresh / Display), and the pinned footer.
struct DashboardSettingsPopulatedView: View {
    @Bindable var model: DashboardSettingsModel
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if model.connection != .live {
                DashboardSettingsConnectivityBanner(connection: model.connection)
            }
            if let message = model.inlineErrorMessage {
                DashboardSettingsInlineErrorBanner(message: message)
            }
            form
            Divider().overlay(Color.TS.border)
            DashboardSettingsFooter(onCancel: onCancel, onSave: onSave)
        }
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                DashboardSettingsIdentitySection(model: model)
                DashboardSettingsScopeSection(model: model)
                DashboardSettingsRefreshSection(model: model)
                DashboardSettingsDisplaySection(model: model)
            }
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Footer (web sticky dialog footer)

/// The pinned footer: the Cancel + Save actions (web footer `flex justify-end`). Save commits the
/// deltas (web `handleSave`); both dismiss.
struct DashboardSettingsFooter: View {
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TSButton(variant: .ghost, size: .medium, action: onCancel) {
                Text(verbatim: DashboardSettingsStrings.string("common.cancel", "Cancel"))
            }
            TSButton(variant: .primary, size: .medium, action: onSave) {
                Text(verbatim: DashboardSettingsStrings.string("common.save", "Save"))
            }
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
    }
}

// MARK: - Loading (skeleton chrome)

/// The first-load skeleton (the dashboard + vehicle list in flight): a redaction-free outline of the
/// four form sections so the layout doesn't reflow when the data resolves. A gentle opacity pulse runs
/// unless Reduce Motion is on.
struct DashboardSettingsLoadingState: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            ForEach(0 ..< 4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    bar(width: 140, height: 14)
                    bar(width: nil, height: 40)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .opacity(pulsing ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: DashboardSettingsStrings.string(
            "dashSettings.loading", "Loading dashboard settings…"
        )))
    }

    private func bar(width: CGFloat?, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textMuted.opacity(0.16))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

// MARK: - Empty (dashboard not found)

/// The resolved-but-absent dashboard state (e.g. it was deleted while the sheet was opening), over a
/// native `ContentUnavailableView` so the dialog is never a blank box.
struct DashboardSettingsEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: DashboardSettingsStrings.string(
                    "dashSettings.emptyTitle", "Dashboard unavailable"
                ))
            } icon: {
                Image(systemName: "rectangle.on.rectangle.slash")
            }
        } description: {
            Text(verbatim: DashboardSettingsStrings.string(
                "dashSettings.emptyMessage", "This dashboard couldn't be found. It may have been deleted."
            ))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (load failed)

/// The first-load failure state with a retry affordance (no resolved dashboard to fall back on), so
/// the dialog isn't a blank box.
struct DashboardSettingsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: DashboardSettingsStrings.string(
                "dashSettings.error", "Couldn't load dashboard settings"
            ))
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
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: DashboardSettingsStrings.string("dashSettings.retry", "Retry"))
            }
            .padding(.top, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
