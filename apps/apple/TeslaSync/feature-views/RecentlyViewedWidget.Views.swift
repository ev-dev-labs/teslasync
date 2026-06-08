//
//  RecentlyViewedWidget.Views.swift
//  TeslaSync — P4 feature view · 0131 · RecentlyViewedWidget (Apple)
//
//  The presentational subviews composed by `RecentlyViewedWidget`: the kind → SF Symbol map
//  (web `iconForKind`), the navigable entry row (web `<Link>` row), the freshness chip +
//  cached-data banner (the P4 stale / offline chrome), the loading skeleton (native, before
//  the first store read), the empty hint (web non-actionable `<p>`), and the error +retry
//  state. All consume pre-localized strings from the P1/S10 facade and the shared P1/S9
//  tokens — no store access, no Tailwind ports.
//

import SwiftUI

// MARK: - Kind → SF Symbol (web `iconForKind`)

extension RecentPageKind {
    /// The SF Symbol mirroring the web lucide icon for each kind (web `iconForKind`).
    var symbolName: String {
        switch self {
        case .vehicle: "car.fill" // web Car
        case .drive: "road.lanes" // web Route
        case .charging: "battery.100.bolt" // web BatteryCharging
        case .trip: "safari" // web Compass
        case .geofence: "mappin.and.ellipse" // web MapPinned
        case .yearReview: "calendar" // web CalendarDays
        case .page: "doc.text" // web FileText
        }
    }
}

// MARK: - Entry row (web `<Link to={entry.path}>` row)

/// One navigable recent-page row (web `<li><Link>`): the kind icon, the page title (the
/// single-line flexible column), and the trailing relative-recency label. The whole row is a
/// button — the native analogue of the web `<Link>` — exposed to VoiceOver as one element
/// with a combined label + an "opens this page" hint.
struct RecentlyViewedRowView: View {
    let row: RecentlyViewedRow
    let now: Date
    let onSelect: (RecentlyViewedRow) -> Void

    var body: some View {
        Button {
            onSelect(row)
        } label: {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: row.kind.symbolName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .frame(width: 18)
                    .accessibilityHidden(true)
                Text(verbatim: row.title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(verbatim: relativeText)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
                    .layoutPriority(1)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(RecentlyViewedRowButtonStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityHint(Text(verbatim: RecentlyViewedStrings.string(
            "recentPages.rowA11yHint", "Opens this page"
        )))
        .accessibilityAddTraits(.isLink)
    }

    private var relativeText: String {
        RecentlyViewedAdapter.relativeText(for: row, now: now, localize: RecentlyViewedStrings.string)
    }

    private var accessibilityLabel: String {
        RecentlyViewedAdapter.accessibilitySummary(for: row, now: now, localize: RecentlyViewedStrings.string)
    }
}

/// A subtle hover/press fill for the navigable row (web `hover:bg-[var(--surface-2)]`),
/// honoring the press state on touch + pointer without a heavyweight control chrome.
private struct RecentlyViewedRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                configuration.isPressed ? Color.TS.surfaceGlass : Color.clear,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .contentShape(Rectangle())
    }
}

// MARK: - Freshness chip (native stale / offline overlay)

/// The header freshness chip shown when the cached recents are not fully fresh — the P4
/// states-contract stale / offline indicator. Absent when fresh.
struct RecentlyViewedFreshnessChip: View {
    let freshness: RecentlyViewedFreshness

    var body: some View {
        if let descriptor = Self.descriptor(for: freshness) {
            let label = RecentlyViewedStrings.string(descriptor.key, descriptor.fallback)
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: descriptor.symbol)
                    .font(.system(size: 10, weight: .semibold))
                Text(verbatim: label)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(descriptor.tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(descriptor.tone.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(descriptor.tone.opacity(0.25), lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: label))
        }
    }

    private struct Descriptor {
        let symbol: String
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for freshness: RecentlyViewedFreshness) -> Descriptor? {
        switch freshness {
        case .fresh:
            nil
        case .stale:
            Descriptor(
                symbol: "clock.arrow.circlepath", tone: Color.TS.statusWarning,
                key: "recentPages.stale", fallback: "Stale"
            )
        case .offline:
            Descriptor(
                symbol: "wifi.slash", tone: Color.TS.textMuted,
                key: "recentPages.offline", fallback: "Offline"
            )
        }
    }
}

/// The stale / offline banner shown above the list when the cached recents are not fully
/// fresh, so the rows are clearly labeled as cached (the P4 states-contract cached-data
/// indicator). The cached recents themselves always stay visible (offline-first).
struct RecentlyViewedConnectivityBanner: View {
    let freshness: RecentlyViewedFreshness

    var body: some View {
        if let descriptor = Self.descriptor(for: freshness) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: descriptor.symbol)
                    .font(.system(size: 10, weight: .semibold))
                Text(verbatim: RecentlyViewedStrings.string(descriptor.key, descriptor.fallback))
                    .font(Font.TS.caption)
            }
            .foregroundStyle(descriptor.tone)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(
                descriptor.tone.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .accessibilityElement(children: .combine)
        }
    }

    private struct Descriptor {
        let symbol: String
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for freshness: RecentlyViewedFreshness) -> Descriptor? {
        switch freshness {
        case .fresh:
            nil
        case .stale:
            Descriptor(
                symbol: "clock.arrow.circlepath", tone: Color.TS.statusWarning,
                key: "recentPages.staleBanner", fallback: "Refreshing — recent pages may be out of date"
            )
        case .offline:
            Descriptor(
                symbol: "wifi.slash", tone: Color.TS.textMuted,
                key: "recentPages.offlineBanner", fallback: "Offline — showing your saved recent pages"
            )
        }
    }
}

// MARK: - Loading (native skeleton, before the first store read)

/// The initial-read skeleton chrome: a few redacted rows that respect Reduce Motion via the
/// shared `TSSkeleton`, exposed as one labeled accessibility element.
struct RecentlyViewedLoadingView: View {
    var rowCount = 4

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ForEach(0 ..< rowCount, id: \.self) { _ in
                TSSkeleton(height: 28, cornerRadius: TSRadius.sm)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: RecentlyViewedStrings.string(
            "recentPages.loadingA11y", "Loading recently viewed pages"
        )))
    }
}

// MARK: - Empty (web non-actionable `<p>` hint)

/// The zero-recents state — the web's deliberately non-actionable hint paragraph (a plain
/// `<p>`, not a CTA), rendered with a faint clock glyph + the localized hint, centered. The
/// "action" is the rest of the app, so there is no button here, matching the web.
struct RecentlyViewedEmptyView: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "clock.badge.questionmark")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: RecentlyViewedStrings.string(
                "recentPages.empty", "Pages you visit will appear here for quick access."
            ))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (native QueryError-equivalent + retry)

/// The failure state (the P4 states contract's `QueryError`-equivalent): an icon, a title,
/// the optional underlying message, and a retry affordance wired to the model. The web leaf
/// has no error branch — its store read is synchronous — so this is native chrome for a
/// corrupt / unreadable persisted recents store.
struct RecentlyViewedErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: RecentlyViewedStrings.string(
                "recentPages.errorTitle", "Couldn't load recent pages"
            ))
            .font(Font.TS.bodySm)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            retryButton
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .contain)
    }

    private var retryButton: some View {
        let label = RecentlyViewedStrings.string("recentPages.retry", "Retry")
        return Button(action: onRetry) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}
