//
//  ChangelogModal.States.swift
//  TeslaSync — P4 modal / dialog · 0003 · ChangelogModal (Apple)
//
//  The chrome + leaf states `ChangelogModal` composes: the pinned header (title + freshness chip +
//  close), the live-state freshness chip + connectivity / inline-error banners, the populated container
//  (subtitle + scrolling release entries + footer actions), and the loading / empty / error leaf states.
//  Every state renders real chrome — never a blank box (engineering guideline #6). The release entry rows,
//  change sections, and badge live in ChangelogModal.Rows.swift. Copy via P1/S10 (`ChangelogStrings`);
//  chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Header (web Modal header)

/// The pinned header: the dialog title, an optional freshness chip, and the Close button (web Modal
/// header). Close maps to the web `onClose`.
struct ChangelogHeader: View {
    @Bindable var model: ChangelogModel
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Text(verbatim: ChangelogStrings.string("changelog.modal.title", "What's new in TeslaSync"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if model.connection != .live {
                ChangelogFreshnessChip(connection: model.connection)
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
        .accessibilityLabel(Text(verbatim: ChangelogStrings.string("changelog.modal.close", "Close")))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound seen-version source's live-state (ADR-013).
struct ChangelogFreshnessChip: View {
    let connection: ChangelogConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: ChangelogStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ChangelogStrings.string(descriptor.key, descriptor.fallback)))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: ChangelogConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "changelog.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "changelog.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "changelog.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner

/// The cached-data banner shown above the list when the bound seen-version source is not live, so the
/// "since your last visit" framing is clearly labeled as possibly out of date while reconnecting / offline
/// (ADR-013).
struct ChangelogConnectivityBanner: View {
    let connection: ChangelogConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "changelog.offlineBanner" : "changelog.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded release history"
            : "Reconnecting — the seen-state may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: ChangelogStrings.string(key, fallback))
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

// MARK: - Inline error banner

/// The inline reload error shown above the list when a refresh failed but the cached history remains
/// (added so a failed refresh never blanks the changelog).
struct ChangelogInlineErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: ChangelogStrings.string("changelog.reloadError", "Couldn't refresh the changelog"))
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

// MARK: - Populated container (web subtitle + list + footer)

/// The full changelog: an optional connectivity / inline-error banner, the subtitle, the scrolling list of
/// collapsible release entries, and the footer actions (web `space-y-4` body + the bordered footer).
struct ChangelogPopulatedView: View {
    @Bindable var model: ChangelogModel
    let onGotIt: () -> Void
    let onViewFull: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if model.connection != .live {
                ChangelogConnectivityBanner(connection: model.connection)
            }
            if let message = model.inlineErrorMessage {
                ChangelogInlineErrorBanner(message: message)
            }
            subtitle
            Divider().overlay(Color.TS.border)
            list
            Divider().overlay(Color.TS.border)
            ChangelogFooter(onGotIt: onGotIt, onViewFull: onViewFull)
        }
    }

    private var subtitle: some View {
        Text(verbatim: model.subtitleText)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.md)
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: TSSpacing.md) {
                ForEach(model.visibleEntries) { entry in
                    ChangelogEntryRow(model: model, entry: entry)
                }
            }
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Footer (web bordered footer with two actions)

/// The footer actions (web `border-t` footer): a ghost "View full changelog" and the primary "Got it",
/// right-aligned.
struct ChangelogFooter: View {
    let onGotIt: () -> Void
    let onViewFull: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TSButton(variant: .ghost, size: .medium, action: onViewFull) {
                Text(verbatim: ChangelogStrings.string("changelog.modal.viewFull", "View full changelog"))
            }
            TSButton(variant: .primary, size: .medium, action: onGotIt) {
                Text(verbatim: ChangelogStrings.string("changelog.modal.gotIt", "Got it"))
            }
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
    }
}

// MARK: - Loading (skeleton chrome)

/// The first-load skeleton (the history + seen-state in flight): a redaction-free outline of the subtitle
/// and two release rows so the layout doesn't reflow when the data resolves. A gentle opacity pulse runs
/// unless Reduce Motion is on.
struct ChangelogLoadingState: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            bar(width: 220, height: 12)
            ForEach(0 ..< 2, id: \.self) { _ in
                bar(width: nil, height: 64)
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
        .accessibilityLabel(Text(verbatim: ChangelogStrings.string("changelog.loading", "Loading what's new…")))
    }

    private func bar(width: CGFloat?, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textMuted.opacity(0.16))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

// MARK: - Empty (history resolved with no entries)

/// The resolved-but-empty changelog state (no releases to show), over a native `ContentUnavailableView`
/// so the dialog is never a blank box.
struct ChangelogEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: ChangelogStrings.string("changelog.emptyTitle", "No release notes yet"))
            } icon: {
                Image(systemName: "sparkles")
            }
        } description: {
            Text(verbatim: ChangelogStrings.string(
                "changelog.emptyBody",
                "There's nothing new to show right now. Check back after the next update."
            ))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (load failed)

/// The first-load failure state with a retry affordance (no cached history to fall back on), so the dialog
/// isn't a blank box (web `QueryError` equivalent).
struct ChangelogErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: ChangelogStrings.string("changelog.error", "Couldn't load the changelog"))
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
                Text(verbatim: ChangelogStrings.string("changelog.retry", "Retry"))
            }
            .padding(.top, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
