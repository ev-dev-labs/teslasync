//
//  SignalConfigModal.States.swift
//  TeslaSync — P4 modal / dialog · 0016 · SignalConfigModal (Apple)
//
//  The chrome + leaf states `SignalConfigModal` composes: the pinned header (title + selection
//  count + freshness chip + close), the live-state freshness chip + connectivity / inline-error
//  banners, the populated container (pinned master bar + scrolling grouped list + pinned footer),
//  the footer (summary + Cancel + Subscribe), and the loading / empty / error / search-empty leaf
//  states. Every state renders real chrome — never a blank box (engineering guideline #6). The
//  master controls live in SignalConfigModal.Controls.swift; the category section + signal rows live
//  in SignalConfigModal.Rows.swift. Copy via P1/S10 (`SignalConfigStrings`); chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Header (web sticky dialog header)

/// The pinned header: the dialog title, the "{selected} / {total} signals selected" subtitle, an
/// optional freshness chip, and the Close button (web header + the `{selectedCount} / {totalCount}`
/// line). Close maps to the web `onClose`.
struct SignalConfigHeader: View {
    @Bindable var model: SignalConfigModel
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: SignalConfigStrings.string(
                    "signals.config.title", "Fleet Telemetry Signal Configuration"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
                if model.totalCount > 0 {
                    Text(verbatim: SignalConfigAccessibility.selectionSummary(
                        selected: model.selectedCount, total: model.totalCount, localize: model.localize
                    ))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            if model.connection != .live {
                SignalConfigFreshnessChip(connection: model.connection)
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
        .accessibilityLabel(Text(verbatim: SignalConfigStrings.string("signals.config.close", "Close")))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SignalConfigFreshnessChip: View {
    let connection: SignalConfigConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: SignalConfigStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SignalConfigStrings.string(descriptor.key, descriptor.fallback)))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: SignalConfigConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "signals.config.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "signals.config.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "signals.config.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity + inline-error banners

/// The cached-data banner shown above the list when the bound source is not live, so a cached
/// catalog is clearly labeled while reconnecting / offline (ADR-013).
struct SignalConfigConnectivityBanner: View {
    let connection: SignalConfigConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "signals.config.offlineBanner" : "signals.config.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded signal catalog"
            : "Reconnecting — this catalog may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: SignalConfigStrings.string(key, fallback))
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

/// The inline catalog-reload error shown above the form when a reload failed but a cached catalog
/// remains (web has no analog; added so a failed refresh never blanks the editable form).
struct SignalConfigInlineErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: SignalConfigStrings.string(
                "signals.config.reloadError", "Couldn't refresh the signal catalog"
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

// MARK: - Populated container (web sticky header / scroll body / sticky footer)

/// The full config form: the pinned master controls, an optional connectivity / inline-error banner,
/// the scrolling category-grouped list (or the in-list search-empty state), and the pinned footer.
struct SignalConfigPopulatedView: View {
    @Bindable var model: SignalConfigModel
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            SignalConfigControlBar(model: model)
            Divider().overlay(Color.TS.border)
            if model.connection != .live {
                SignalConfigConnectivityBanner(connection: model.connection)
            }
            if let message = model.inlineErrorMessage {
                SignalConfigInlineErrorBanner(message: message)
            }
            list
            Divider().overlay(Color.TS.border)
            SignalConfigFooter(model: model, onCancel: onCancel, onSubmit: onSubmit)
        }
    }

    private var list: some View {
        ScrollView {
            if model.isSearchEmpty {
                SignalConfigSearchEmptyState()
            } else {
                LazyVStack(spacing: TSSpacing.sm) {
                    ForEach(model.groups) { group in
                        SignalConfigCategorySection(model: model, group: group)
                    }
                }
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.md)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Footer (web sticky dialog footer)

/// The pinned footer: the selection summary (with the 500 ms / 10 s breakdown once anything is
/// selected) and the Cancel + "Subscribe N Signals" actions (web footer). Subscribe is disabled with
/// no selection (web `disabled={selectedCount === 0}`).
struct SignalConfigFooter: View {
    @Bindable var model: SignalConfigModel
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            summary
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .secondary, size: .small, action: onCancel) {
                Text(verbatim: SignalConfigStrings.string("signals.config.cancel", "Cancel"))
            }
            TSButton(variant: .primary, size: .small, action: onSubmit) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "bolt.fill").font(.system(size: 11, weight: .semibold))
                    Text(verbatim: subscribeTitle)
                }
            }
            .disabled(!model.canSubmit)
            .opacity(model.canSubmit ? 1 : 0.4)
            .accessibilityLabel(Text(verbatim: subscribeTitle))
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: SignalConfigStrings.string(
                "signals.config.selectedCount", "{{count}} signals selected", "{{count}}",
                String(model.summary.selected)
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            if model.summary.selected > 0 {
                Text(verbatim: breakdown)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
    }

    private var breakdown: String {
        SignalConfigStrings.string(
            "signals.config.cadenceBreakdown", "{{realtime}} at 500ms · {{standard}} at 10s"
        )
        .replacingOccurrences(of: "{{realtime}}", with: String(model.summary.realtime))
        .replacingOccurrences(of: "{{standard}}", with: String(model.summary.standard))
    }

    private var subscribeTitle: String {
        SignalConfigStrings.string(
            "signals.config.subscribeCount", "Subscribe {{count}} Signals", "{{count}}",
            String(model.summary.selected)
        )
    }
}

// MARK: - Loading (skeleton chrome)

/// The first-load skeleton (catalog fetch in flight, no cached catalog): a redaction-free outline of
/// the master bar + a few category rows so the layout doesn't reflow when the catalog resolves. A
/// gentle opacity pulse runs unless Reduce Motion is on.
struct SignalConfigLoadingState: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            bar(width: 220, height: 28)
            ForEach(0 ..< 4, id: \.self) { _ in
                bar(width: nil, height: 40)
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
        .accessibilityLabel(Text(verbatim: SignalConfigStrings.string(
            "signals.config.loading", "Loading signal catalog…"
        )))
    }

    private func bar(width: CGFloat?, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textMuted.opacity(0.16))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

// MARK: - Empty (no signals available)

/// The resolved-but-empty catalog state (no streamable signals), over a native
/// `ContentUnavailableView` so the dialog is never a blank box.
struct SignalConfigEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: SignalConfigStrings.string(
                    "signals.config.emptyTitle", "No signals available"
                ))
            } icon: {
                Image(systemName: "antenna.radiowaves.left.and.right.slash")
            }
        } description: {
            Text(verbatim: SignalConfigStrings.string(
                "signals.config.emptyMessage", "This vehicle isn't reporting any configurable telemetry signals."
            ))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Search empty (no matches)

/// The in-list "no matches" state when the search query hides every signal (web grouped list empty),
/// shown while the master bar + footer stay on screen.
struct SignalConfigSearchEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: SignalConfigStrings.string("signals.config.searchEmptyTitle", "No matching signals"))
            } icon: {
                Image(systemName: "magnifyingglass")
            }
        } description: {
            Text(verbatim: SignalConfigStrings.string(
                "signals.config.searchEmptyMessage", "Try a different search term."
            ))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (catalog load failed)

/// The first-load failure state with a retry affordance (no cached catalog to fall back on), so the
/// dialog isn't a blank box.
struct SignalConfigErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: SignalConfigStrings.string(
                "signals.config.error", "Couldn't load the signal catalog"
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
                Text(verbatim: SignalConfigStrings.string("signals.config.retry", "Retry"))
            }
            .padding(.top, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
