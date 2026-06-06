import SwiftUI

/// Compact live-connection badge: a pulsing live/idle dot plus a state label and,
/// when data has gone stale, a freshness chip. Reads a non-generic `LiveStatus`
/// so it drops into any toolbar/header (web `LiveIndicator` + `FreshnessIndicator`).
public struct LiveConnectionBadge: View {
    private let status: LiveStatus

    public init(_ status: LiveStatus) {
        self.status = status
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSLiveIndicator(isLive: status.isLive)
                .accessibilityIdentifier("live.indicator")
            if status.isStale {
                TSFreshnessIndicator(isStale: true, label: "live.status.stale")
                    .accessibilityIdentifier("live.freshness")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(Self.label(for: status)))
    }

    static func label(for status: LiveStatus) -> LocalizedStringKey {
        if status.isStale { return "live.status.stale" }
        switch status.phase {
        case .open: return "live.status.live"
        case .connecting: return "live.status.connecting"
        case .reconnecting: return "live.status.reconnecting"
        case .stale: return "live.status.stale"
        case .closed: return "live.status.offline"
        }
    }
}

/// Stale live-data banner with a reconnect affordance (web `LiveStaleDataBanner`
/// + Tesla reconnect). Shown above content when values are visible but stale.
public struct LiveStaleBanner: View {
    private let onReconnect: () -> Void

    public init(onReconnect: @escaping () -> Void) {
        self.onReconnect = onReconnect
    }

    public var body: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "clock.badge.exclamationmark",
            title: "stale.title",
            message: "stale.message"
        ) {
            TSButton("live.reconnect", size: .small, action: onReconnect)
                .accessibilityIdentifier("live.reconnect.button")
        }
        .accessibilityIdentifier("live.staleBanner")
    }
}

/// A standalone reconnect button (offline affordance).
public struct LiveReconnectButton: View {
    private let onReconnect: () -> Void

    public init(onReconnect: @escaping () -> Void) {
        self.onReconnect = onReconnect
    }

    public var body: some View {
        TSButton("live.reconnect", variant: .secondary, size: .small, action: onReconnect)
            .accessibilityIdentifier("live.reconnect.button")
    }
}

/// Renders the right surface for a live store's five-state presentation:
/// loading, empty, error (retry), or content — with a stale banner pinned above
/// content while data is stale. Never shows a blank panel (ADR-011/013).
///
/// Generic only over `Content`; it takes a non-generic `LiveStatus` plus retry /
/// reconnect callbacks, so it composes with any `LiveDataStore` regardless of its
/// `Value`/`Event` types.
public struct LiveStateView<Content: View>: View {
    private let status: LiveStatus
    private let onRetry: () -> Void
    private let onReconnect: () -> Void
    private let content: () -> Content

    public init(
        status: LiveStatus,
        onRetry: @escaping () -> Void,
        onReconnect: @escaping () -> Void,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.status = status
        self.onRetry = onRetry
        self.onReconnect = onReconnect
        self.content = content
    }

    public var body: some View {
        switch status.presentation {
        case .loading:
            TSPageLoader(label: "live.status.connecting")
                .accessibilityIdentifier("live.loading")
        case .empty:
            emptyState
        case .error:
            TSErrorDisplay(title: "live.error.title", message: "live.error.message", onRetry: onRetry)
                .accessibilityIdentifier("live.error")
        case .fresh, .stale:
            loadedContent
        }
    }

    private var emptyState: some View {
        TSEmptyState(
            title: "live.empty.title",
            message: "live.empty.message",
            systemImage: "dot.radiowaves.left.and.right"
        ) {
            LiveReconnectButton(onReconnect: onReconnect)
        }
        .accessibilityIdentifier("live.empty")
    }

    private var loadedContent: some View {
        VStack(spacing: TSSpacing.md) {
            if status.isStale {
                LiveStaleBanner(onReconnect: onReconnect)
            }
            content()
        }
    }
}
