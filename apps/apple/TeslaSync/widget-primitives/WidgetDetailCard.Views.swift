//
//  WidgetDetailCard.Views.swift
//  TeslaSync — P4 widget primitive · 0004 · WidgetDetailCard (Apple)
//
//  The presentational pieces of the detail card — the native peers of the web elements: the detail row
//  (web row `<div>` — the leading uppercase muted label and the trailing value with an optional monospaced
//  font + optional ``TSBadge``) and the friendly empty leaf (the native peer of the web `<EmptyState>` from
//  `@/components/feedback`, via the shared ``TSEmptyState``). All chrome is token-driven (P1/S9); no raw
//  hex, no Tailwind ports. The badge REUSES the shared ``TSBadge`` (web `Badge`) with the web
//  `badgeVariantMap` tone (success → success, warning → warning, error → danger, neutral → neutral). Each
//  row folds into a single VoiceOver element reading "{label}, {value}, {badge}".
//

import SwiftUI

// MARK: - DetailBadgeVariant → tone (web `badgeVariantMap`)

extension DetailBadgeVariant {
    /// The badge tone for this variant — the native peer of the web
    /// `badgeVariantMap = { success: 'success', warning: 'warning', error: 'danger', neutral: 'neutral' }`.
    /// `error` maps to the danger tone exactly as the web maps it to the `'danger'` `<Badge>` variant.
    var tone: TSTone {
        switch self {
        case .success: .success
        case .warning: .warning
        case .error: .danger
        case .neutral: .neutral
        }
    }
}

// MARK: - DetailEntryRow (web detail row)

/// A single detail row — the native peer of the web row `<div className="flex items-center
/// justify-between …">`: a leading uppercase muted label (web `text-[10px] uppercase tracking-wide`) and a
/// trailing cluster pairing the formatted value (monospaced when `mono`) with an optional ``TSBadge``. A
/// hairline separator sits below every row except the last (web `i < visible.length - 1`). A pure function
/// of its ``DetailRow``, so it composes in every branch for snapshot / preview / test. The whole row folds
/// into one VoiceOver element reading "{label}, {value}, {badge}".
struct DetailEntryRow: View {
    let row: DetailRow

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                label
                Spacer(minLength: TSSpacing.sm)
                valueCluster
            }
            .padding(.vertical, TSSpacing.sm)
            .padding(.horizontal, TSSpacing.xs)
            if !row.isLast {
                Rectangle()
                    .fill(Color.TS.border)
                    .frame(height: 1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    /// The leading uppercase muted label (web `min-w-0 truncate text-[10px] uppercase tracking-wide`),
    /// mapped to the `label` typographic role with the token's wide tracking.
    private var label: some View {
        Text(verbatim: row.label)
            .font(Font.TS.label)
            .tracking(TSTypeMetrics.labelTracking)
            .foregroundStyle(Color.TS.textMuted)
            .textCase(.uppercase)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    /// The trailing value + optional badge cluster (web `flex min-w-0 items-center gap-2`). The value is
    /// the resolved display string (web `value ?? '—'`); a monospaced design is applied when `mono`.
    private var valueCluster: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Text(verbatim: WidgetDetailCardStrings.displayValue(row.value))
                .font(valueFont)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            if let badge = row.badge {
                TSBadge(LocalizedStringKey(badge.text), tone: badge.variant.tone)
                    .fixedSize()
            }
        }
    }

    /// The value font — the body role, given a monospaced design when `mono` (web `font-mono`). Derived
    /// from the token so it tracks Dynamic Type rather than hardcoding a point size.
    private var valueFont: Font {
        row.mono ? Font.TS.body.monospaced() : Font.TS.body
    }

    /// The combined VoiceOver reading — "{label}, {value}, {badge}" (badge omitted when absent).
    private var accessibilityLabel: String {
        WidgetDetailCardStrings.rowAccessibilityLabel(
            label: row.label,
            value: WidgetDetailCardStrings.displayValue(row.value),
            badge: row.badge?.text
        )
    }
}

// MARK: - WidgetDetailCardEmptyState (web `<EmptyState>`)

/// The friendly empty leaf — the native peer of the web `<EmptyState icon message />` from
/// `@/components/feedback`, rendered via the shared ``TSEmptyState`` (which wraps `ContentUnavailableView`).
/// The message is the caller's `emptyMessage` override or the localized `No details available` default; the
/// glyph is the caller's `emptyIcon` override or the default list motif. Never a bare box (native HIG).
struct WidgetDetailCardEmptyState: View {
    let message: String?
    let iconSymbol: String?

    /// The default empty glyph — a list/details motif (the web default `emptyIcon`).
    static let defaultSymbol = "list.bullet.rectangle"

    /// The caller's `emptyMessage` override, or the localized default (web `emptyMessage ?? 'No details
    /// available'`).
    private var resolvedMessage: String {
        if let message, !message.isEmpty { return message }
        return WidgetDetailCardStrings.emptyMessage
    }

    /// The caller's `emptyIcon` override, or the default list glyph.
    private var resolvedSymbol: String {
        if let iconSymbol, !iconSymbol.isEmpty { return iconSymbol }
        return Self.defaultSymbol
    }

    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(resolvedMessage),
            message: LocalizedStringKey(WidgetDetailCardStrings.emptyHint),
            systemImage: resolvedSymbol
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }
}
