//
//  NotificationChannelsView.swift
//  TeslaSync — P4 feature view · 0188 · NotificationChannelsView (Apple)
//
//  The SwiftUI parity of
//  features/notifications/components/NotificationChannelsView.tsx — the channels CRUD
//  surface: a delivery-stats row, an "Add Channel" action, the configured-channel cards
//  (each with an enable toggle, a masked config preview, and test / edit / delete
//  actions), and the add/edit form sheet. It binds through `NotificationChannelsModel`
//  (P1/S8); no networking lives in the view. On appear it emits the P1/S11 `view.opened`
//  diagnostics event for the surface slug `NotificationChannelsView`.
//
//  Every state renders (no hidden surface): `loading` (stats + card skeletons), `empty`
//  (friendly empty state), `error` (QueryError + retry), `data` (the full grid), and the
//  orthogonal `connection` axis (live / stale / offline) as a freshness chip + banner
//  with a one-shot auto-refresh on the stale transition. Channel mutations surface their
//  outcome through a transient toast (web `useToast`).
//
//  Out of scope: the web `<BrowserPushChannelCard />` composed alongside the channels
//  grid is a separate surface with its own P4 prompt and is not reproduced here.
//

import SwiftUI

public struct NotificationChannelsView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        NotificationChannelsSurface.slug
    }

    @State private var model: NotificationChannelsModel

    public init(model: NotificationChannelsModel) {
        _model = State(initialValue: model)
    }

    private var resolved: NotifChannelsResolved {
        model.resolved
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                if model.connection != .live {
                    connectivityBanner
                }
                TSFadeIn { NotifStatsRow(stats: resolved.stats) }
                TSFadeIn { topActionRow }
                TSFadeIn { gridContent }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.lg)
        }
        .overlay(alignment: .bottom) { toastOverlay }
        .tsModal(isPresented: formPresented, title: formTitle) { formContent }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .task(id: model.toast?.id) { await autoDismissToast() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: NotifChannelsStrings.string(
            "notifications.channels.surfaceA11y",
            "Notification channels"
        )))
    }
}

// MARK: - Top action row (freshness chip + Add Channel)

private extension NotificationChannelsView {
    var topActionRow: some View {
        HStack(spacing: TSSpacing.sm) {
            freshnessChip
            refreshButton
            Spacer(minLength: TSSpacing.sm)
            addButton
        }
    }

    var addButton: some View {
        TSButton(variant: .primary) {
            model.presentAdd()
        } label: {
            Label {
                Text(verbatim: NotifChannelsStrings.string("notifications.channels.add", "Add Channel"))
            } icon: {
                Image(systemName: "plus")
            }
        }
        .accessibilityLabel(Text(verbatim: NotifChannelsStrings.string("notifications.channels.add", "Add Channel")))
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = NotifChannelsStrings.string("notifications.channels.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = NotifChannelsStrings.string("notifications.channels.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = NotifChannelsStrings.string("notifications.channels.offline", "Offline")
        }
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: NotifChannelsStrings.string("notifications.channels.refresh", "Refresh")))
    }
}

// MARK: - Channels grid (phase switch)

private extension NotificationChannelsView {
    private static let cardColumns = [GridItem(.adaptive(minimum: 280), spacing: TSSpacing.lg)]

    @ViewBuilder
    var gridContent: some View {
        switch model.phase {
        case .loading:
            NotifChannelsLoadingGrid()
        case .empty:
            NotifChannelsEmptyView()
        case let .error(message):
            NotifChannelsErrorView(message: message) { model.refresh() }
        case .data:
            channelGrid
        }
    }

    var channelGrid: some View {
        LazyVGrid(columns: Self.cardColumns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(resolved.channels) { channel in
                NotifChannelCard(channel: channel, model: model)
            }
        }
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? NotifChannelsStrings.string("notifications.channels.offlineBanner", "Offline — showing last known data")
            : NotifChannelsStrings.string("notifications.channels.staleBanner", "Reconnecting — data may be stale")
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Form sheet + toast

private extension NotificationChannelsView {
    var formPresented: Binding<Bool> {
        Binding(
            get: { model.isFormPresented },
            set: { presented in if !presented { model.dismissForm() } }
        )
    }

    var formTitle: LocalizedStringKey {
        let isEdit = model.formModel?.isEdit ?? false
        let key = isEdit ? "notifications.channels.editTitle" : "notifications.channels.addTitle"
        let fallback = isEdit ? "Edit Channel" : "Add Channel"
        return LocalizedStringKey(NotifChannelsStrings.string(key, fallback))
    }

    @ViewBuilder
    var formContent: some View {
        if let formModel = model.formModel {
            NotificationChannelForm(model: formModel) { model.dismissForm() }
        }
    }

    @ViewBuilder
    var toastOverlay: some View {
        if let toast = model.toast {
            NotifToastView(toast: toast)
                .padding(TSSpacing.lg)
                .animation(.easeInOut(duration: TSMotion.normalDuration), value: toast.id)
        }
    }

    func autoDismissToast() async {
        guard model.toast != nil else { return }
        try? await Task.sleep(for: .seconds(3))
        if !Task.isCancelled {
            model.dismissToast()
        }
    }
}
