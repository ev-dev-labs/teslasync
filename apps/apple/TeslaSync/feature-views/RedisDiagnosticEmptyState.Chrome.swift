//
//  RedisDiagnosticEmptyState.Chrome.swift
//  TeslaSync — P4 feature view · 0039 · RedisDiagnosticEmptyState (Apple)
//
//  The interactive chrome composed inside the diagnostic banner: the docs call-to-action
//  link (web `<a href><Button>`), the native retry affordance (the P4 states-contract
//  `QueryError` equivalent the web leaf lacks — it delegates to the bound source's
//  refresh), and the "other vehicles with cached signals" section (web clickable chips)
//  with its loading-skeleton chrome. All consume the P1/S10 facade + shared P1/S9 tokens.
//

import SwiftUI

// MARK: - Docs CTA (web `<a href={ctaHref} target="_blank"><Button variant="secondary">`)

/// The secondary docs link, opening the app-relative `ctaHref` resolved against the app
/// base URL. Carries an external-link glyph + the localized label as its accessibility name.
struct RedisDocsLink: View {
    let cta: RDCTA
    let baseURL: URL?

    var body: some View {
        let label = cta.label.resolved(RDStrings.string)
        return Group {
            if let url = RedisDiagnosticDocs.url(forPath: cta.path, base: baseURL) {
                Link(destination: url) { labelView(label) }
            } else {
                labelView(label)
            }
        }
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(.isLink)
    }

    private func labelView(_ label: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
            Image(systemName: "arrow.up.right.square")
                .font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(Color.TS.textPrimary)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Retry affordance (P4 states contract — QueryError equivalent)

/// The native retry control on the upstream-failure branches. The web leaf delegates the
/// fetch to its parent and has no retry; the native surface exposes one (wired to the
/// bound source's `refresh`) as the states-contract `QueryError` equivalent.
struct RedisRetryButton: View {
    let action: () -> Void

    var body: some View {
        let label = RedisDiagnosticCopy.retry.resolved(RDStrings.string)
        return Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.16), in: Capsule())
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Other vehicles section (web `otherKeys` chips)

/// The "Other vehicles with cached signals" sub-section. Hidden when the branch omits it,
/// the keys query failed, or the filtered set is empty (web parity); a skeleton row while
/// the keys query loads (native chrome); the wrapping chip grid when resolved.
struct RedisOtherVehicles: View {
    let phase: RedisDiagnosticChipsPhase
    let onSelect: (Int) -> Void

    private let columns = [GridItem(.adaptive(minimum: 132), spacing: TSSpacing.sm, alignment: .leading)]

    var body: some View {
        switch phase {
        case .hidden:
            EmptyView()
        case .loading:
            section { loadingChips }
        case let .chips(entries):
            section { chipGrid(entries) }
        }
    }

    private func section(@ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: RedisDiagnosticCopy.otherVehicles.resolved(RDStrings.string))
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(.top, TSSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var loadingChips: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(width: 120, height: 26, cornerRadius: TSRadius.pill)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: RedisDiagnosticCopy.loadingOtherVehicles.resolved(RDStrings.string)))
    }

    private func chipGrid(_ entries: [RedisSignalKeyEntry]) -> some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(Array(entries.prefix(6))) { entry in
                RedisVehicleChip(entry: entry) { onSelect(entry.vehicleId) }
            }
        }
    }
}

// MARK: - Vehicle chip (web clickable `<button>` chip)

/// One tappable vehicle chip: the display name (web `display_name || vin || `Vehicle id``)
/// plus the cached field count, switching the viewer to that vehicle on tap.
struct RedisVehicleChip: View {
    let entry: RedisSignalKeyEntry
    let onTap: () -> Void

    var body: some View {
        let name = RedisDiagnosticCopy.chipName(for: entry, localize: RDStrings.string)
        return Button(action: onTap) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: name)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                Text(verbatim: "· \(entry.fieldCount)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: RedisDiagnosticAccessibility.chipSummary(
            name: name,
            fieldCount: entry.fieldCount,
            localize: RDStrings.string
        )))
        .accessibilityHint(Text(verbatim: RedisDiagnosticCopy.otherVehicleHint.resolved(RDStrings.string)))
        .accessibilityAddTraits(.isButton)
    }
}
