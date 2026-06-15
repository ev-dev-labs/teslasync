//
//  RedisDiagnosticEmptyState.Views.swift
//  TeslaSync — P4 feature view · 0039 · RedisDiagnosticEmptyState (Apple)
//
//  The presentational core composed by the surface: the toned diagnostic banner (web
//  `DiagnosticBanner` over `GlassPanel`), the meta detail list (web `DiagnosticMetaList`
//  `<dl>`), the live-store-mode badge (web `Badge`), the monospaced value (web `<code>`),
//  and the generic legacy empty state (web `EmptyState`). All consume the P1/S10 facade
//  and the shared P1/S9 tokens — no networking, no Tailwind ports. The interactive chrome
//  (docs link / retry / other-vehicle chips) lives in RedisDiagnosticEmptyState.Chrome.swift.
//

import SwiftUI

// MARK: - Diagnostic banner (web `DiagnosticBanner`)

/// The toned diagnostic banner: a leading SF Symbol + the title, body, meta list, retry,
/// docs CTA, and "other vehicles" chips, on a tone-tinted bordered surface (web
/// `GlassPanel` with the `border-{tone}` / `bg-{tone}` classes).
struct RedisDiagnosticBanner: View {
    let resolved: RedisDiagnosticResolved
    let meta: RedisDiagnosticSignalsMeta?
    let chips: RedisDiagnosticChipsPhase
    let docsBaseURL: URL?
    let onRetry: () -> Void
    let onSelect: (Int) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: resolved.iconSystemName)
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: titleText)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: bodyText)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if resolved.showsMeta, let meta {
                    RedisDiagnosticMetaList(meta: meta)
                }
                if resolved.isError {
                    RedisRetryButton(action: onRetry)
                }
                if let cta = resolved.cta {
                    RedisDocsLink(cta: cta, baseURL: docsBaseURL)
                }
                RedisOtherVehicles(phase: chips, onSelect: onSelect)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(resolved.tone.fillColor, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(resolved.tone.strokeColor, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var titleText: String {
        resolved.title.resolved(RDStrings.string)
    }

    private var bodyText: String {
        resolved.body.resolved(RDStrings.string)
    }
}

// MARK: - Meta detail list (web `DiagnosticMetaList` `<dl>`)

/// The diagnostic meta grid: live-store mode (badge), Redis key (code), L1/L2 counts,
/// L1/L2 last-seen (formatted or em-dash), and the VIN (code, only when present).
struct RedisDiagnosticMetaList: View {
    let meta: RedisDiagnosticSignalsMeta

    var body: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.xs) {
            row(RedisDiagnosticCopy.metaMode) { RedisModeBadge(mode: meta.liveSignalStoreMode) }
            row(RedisDiagnosticCopy.metaKey) { RedisCodeText(value: meta.redisKey) }
            row(RedisDiagnosticCopy.metaL1Count) { value(String(meta.l1SignalCount)) }
            row(RedisDiagnosticCopy.metaL2Count) { value(String(meta.redisFieldCount)) }
            row(RedisDiagnosticCopy.metaL1LastSeen) { value(RedisDiagnosticFormat.dateTime(meta.l1LastSeenAt)) }
            row(RedisDiagnosticCopy.metaL2LastSeen) { value(RedisDiagnosticFormat.dateTime(meta.l2LastSeenAt)) }
            if !meta.vehicleVin.isEmpty {
                row(RedisDiagnosticCopy.metaVin) { RedisCodeText(value: meta.vehicleVin) }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func row(_ label: RDText, @ViewBuilder value: () -> some View) -> some View {
        GridRow(alignment: .firstTextBaseline) {
            Text(verbatim: label.resolved(RDStrings.string))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .gridColumnAlignment(.leading)
            value().gridColumnAlignment(.leading)
        }
    }

    private func value(_ text: String) -> some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

// MARK: - Live-store-mode badge (web `<Badge variant={hybrid ? success : danger}>`)

/// The mode chip: success-toned for `hybrid`, danger-toned for `local`, carrying the raw
/// mode value (web renders `{meta.live_signal_store_mode}` verbatim inside the badge).
struct RedisModeBadge: View {
    let mode: RedisLiveStoreMode

    var body: some View {
        let tone = mode == .hybrid ? Color.TS.statusSuccess : Color.TS.statusDanger
        return Text(verbatim: mode.rawValue)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: mode.rawValue))
    }
}

// MARK: - Monospaced value (web `<code className="font-mono">`)

/// A selectable monospaced value (web `<code>`): the Redis key + the VIN render through
/// this so an operator can copy them.
struct RedisCodeText: View {
    let value: String

    var body: some View {
        Text(verbatim: value)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .textSelection(.enabled)
            .lineLimit(1)
            .truncationMode(.middle)
    }
}

// MARK: - Legacy empty state (web pre-meta `EmptyState`)

/// The generic pre-meta fallback (web `EmptyState` with the Database icon + message),
/// rendered over `ContentUnavailableView` so it is never a blank box.
struct RedisLegacyEmptyState: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: RedisDiagnosticIcon.database)
            }
        }
        .accessibilityLabel(Text(verbatim: message))
    }
}
