import SwiftUI

/// A compact freshness chip (coloured dot + label) shown on the glance so the user
/// always knows whether they are looking at live, stale, or offline-old data.
struct WatchFreshnessChip: View {
    let freshness: WidgetFreshness

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(freshness.tint)
                .frame(width: 6, height: 6)
            Text(freshness.labelKey)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(freshness.labelKey))
    }
}

/// The first-launch loading state, shown only until the cache hydrates or the first
/// payload arrives.
struct WatchLoadingView: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ProgressView()
            Text("watch.loading")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("watch.loading")
    }
}

/// Honest empty state: nothing has ever been cached. Offers a refresh and points
/// the user at the iPhone, never a blank screen (ADR-011/013).
struct WatchEmptyView: View {
    let onRefresh: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "car.fill")
                .font(.title3)
                .foregroundStyle(Color.TS.textMuted)
            Text("watch.empty.title")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Text("watch.empty.message")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            Button(action: onRefresh) {
                Label("watch.action.refresh", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("watch.empty")
    }
}

/// A pinned banner shown above content while the cached data is stale.
struct WatchStaleBanner: View {
    let lastUpdated: Date?
    let onRefresh: () -> Void

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "clock.badge.exclamationmark")
                VStack(alignment: .leading, spacing: 0) {
                    Text("watch.stale.title")
                        .font(Font.TS.caption)
                    if let lastUpdated {
                        Text(lastUpdated, style: .relative)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.clockwise")
            }
        }
        .buttonStyle(.plain)
        .padding(TSSpacing.xs)
        .background(Color.TS.statusWarning.opacity(0.18), in: RoundedRectangle(cornerRadius: TSRadius.sm))
        .foregroundStyle(Color.TS.statusWarning)
        .accessibilityIdentifier("watch.stale")
    }
}

/// A clear "sign in on iPhone" banner shown when the phone has no session, so the
/// auth-required state (and why actions are disabled) is never ambiguous.
struct WatchAuthBanner: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "lock.fill")
            Text("watch.auth.required")
                .font(Font.TS.caption)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm))
        .foregroundStyle(Color.TS.textSecondary)
        .accessibilityIdentifier("watch.auth")
    }
}

/// A transient error banner (command failure, refresh problem) with a retry.
struct WatchErrorBanner: View {
    let messageKey: LocalizedStringKey
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "exclamationmark.triangle.fill")
                Text(messageKey)
                    .font(Font.TS.caption)
                Spacer(minLength: 0)
                Image(systemName: "arrow.clockwise")
            }
        }
        .buttonStyle(.plain)
        .padding(TSSpacing.xs)
        .background(Color.TS.statusDanger.opacity(0.18), in: RoundedRectangle(cornerRadius: TSRadius.sm))
        .foregroundStyle(Color.TS.statusDanger)
        .accessibilityIdentifier("watch.error")
    }
}

/// Offline state: values were cached but are now too old (or the phone is
/// unreachable). Shows the last-known age honestly and offers a refresh instead of
/// presenting aged data as if it were live.
struct WatchOfflineContent: View {
    let lastUpdated: Date?
    let onRefresh: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.title3)
                .foregroundStyle(Color.TS.textMuted)
            Text("watch.offline.title")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            if let lastUpdated {
                HStack(spacing: TSSpacing.xs) {
                    Text("watch.updated")
                    Text(lastUpdated, style: .relative)
                }
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            } else {
                Text("watch.offline.message")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRefresh) {
                Label("watch.action.refresh", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("watch.offline")
    }
}
