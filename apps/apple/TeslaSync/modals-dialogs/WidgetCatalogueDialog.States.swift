//
//  WidgetCatalogueDialog.States.swift
//  TeslaSync — P4 modal / dialog · 0026 · WidgetCatalogueDialog (Apple)
//
//  The chrome + leaf states `WidgetCatalogueDialog` composes: the pinned header (title + freshness chip +
//  close), the live-state freshness chip + connectivity / inline-error banners, the populated container
//  (subtitle + sticky search + scrolling category sections), and the loading / empty / error leaf states.
//  Every state renders real chrome — never a blank box (engineering guideline #6). The search field,
//  category sections, and entry rows live in WidgetCatalogueDialog.Rows.swift. Copy via P1/S10
//  (`WidgetCatalogueStrings`); chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Header (web dialog header)

/// The pinned header: the dialog title, an optional freshness chip, and the Close button (web Modal
/// header). Close maps to the web `onClose`.
struct WidgetCatalogueHeader: View {
    @Bindable var model: WidgetCatalogueModel
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Text(verbatim: WidgetCatalogueStrings.string("dashboard.catalogue.title", "Widget catalogue"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if model.connection != .live {
                WidgetCatalogueFreshnessChip(connection: model.connection)
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
        .accessibilityLabel(Text(verbatim: WidgetCatalogueStrings.string("dashboard.catalogue.close", "Close")))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound active-widget-set source's live-state (ADR-013).
struct WidgetCatalogueFreshnessChip: View {
    let connection: WidgetCatalogueConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: WidgetCatalogueStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: WidgetCatalogueStrings.string(descriptor.key, descriptor.fallback)))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: WidgetCatalogueConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "dashboard.catalogue.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "dashboard.catalogue.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "dashboard.catalogue.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner

/// The cached-data banner shown above the catalogue when the bound active-widget-set source is not live,
/// so the "Added" badges are clearly labeled as possibly out of date while reconnecting / offline
/// (ADR-013).
struct WidgetCatalogueConnectivityBanner: View {
    let connection: WidgetCatalogueConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "dashboard.catalogue.offlineBanner" : "dashboard.catalogue.staleBanner"
        let fallback = offline
            ? "Offline — “Added” badges reflect the last loaded layout"
            : "Reconnecting — “Added” badges may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: WidgetCatalogueStrings.string(key, fallback))
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

/// The inline reload error shown above the catalogue when a refresh failed but the cached catalogue
/// remains (added so a failed refresh never blanks the catalogue).
struct WidgetCatalogueInlineErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: WidgetCatalogueStrings.string(
                "dashboard.catalogue.reloadError", "Couldn't refresh the catalogue"
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

// MARK: - Populated container (web subtitle + search + scrolling sections)

/// The full catalogue: an optional connectivity / inline-error banner, the subtitle, the sticky search
/// field + result count, and the scrolling category sections (or the in-catalogue no-matches empty card).
struct WidgetCataloguePopulatedView: View {
    @Bindable var model: WidgetCatalogueModel
    let onAdd: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            if model.connection != .live {
                WidgetCatalogueConnectivityBanner(connection: model.connection)
            }
            if let message = model.inlineErrorMessage {
                WidgetCatalogueInlineErrorBanner(message: message)
            }
            WidgetCatalogueSearchHeader(model: model)
            Divider().overlay(Color.TS.border)
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.isSearchEmpty {
            WidgetCatalogueSearchEmptyCard(model: model)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                    ForEach(model.groups) { group in
                        WidgetCatalogueCategorySection(model: model, group: group, onAdd: onAdd)
                    }
                }
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// MARK: - Loading (skeleton chrome)

/// The first-load skeleton (the catalogue + active set in flight): a redaction-free outline of the search
/// field and two category sections so the layout doesn't reflow when the data resolves. A gentle opacity
/// pulse runs unless Reduce Motion is on.
struct WidgetCatalogueLoadingState: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            bar(width: nil, height: 38)
            ForEach(0 ..< 2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    bar(width: 160, height: 12)
                    bar(width: nil, height: 56)
                    bar(width: nil, height: 56)
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
        .accessibilityLabel(Text(verbatim: WidgetCatalogueStrings.string(
            "dashboard.catalogue.loading", "Loading widget catalogue…"
        )))
    }

    private func bar(width: CGFloat?, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textMuted.opacity(0.16))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

// MARK: - Empty (catalogue resolved with no widgets)

/// The resolved-but-empty catalogue state (no widgets available at all), over a native
/// `ContentUnavailableView` so the dialog is never a blank box.
struct WidgetCatalogueEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: WidgetCatalogueStrings.string(
                    "dashboard.catalogue.catalogueEmptyTitle", "No widgets available"
                ))
            } icon: {
                Image(systemName: "square.grid.2x2.fill")
            }
        } description: {
            Text(verbatim: WidgetCatalogueStrings.string(
                "dashboard.catalogue.catalogueEmptyBody",
                "There are no widgets to add right now. Check back after the next sync."
            ))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (load failed)

/// The first-load failure state with a retry affordance (no cached catalogue to fall back on), so the
/// dialog isn't a blank box.
struct WidgetCatalogueErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: WidgetCatalogueStrings.string(
                "dashboard.catalogue.error", "Couldn't load the widget catalogue"
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
                Text(verbatim: WidgetCatalogueStrings.string("dashboard.catalogue.retry", "Retry"))
            }
            .padding(.top, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
