//
//  FormatterPrefsBridge.States.swift
//  TeslaSync — P4 shared surface · 0146 · FormatterPrefsBridge (Apple)
//
//  The P4 leaf-contract chrome composed by `FormatterPrefsBridge` when it is not presenting the active
//  formatter-prefs card: the loading skeleton (a card-shaped shimmer), the friendly "device defaults"
//  state (the native parity of the web `resolveLocale('') → en-US` + `decimal_precision ?? 2` fallbacks
//  taking effect with nothing configured — never a blank box), and the error tile with a retry
//  affordance (the web `QueryError` peer). All copy resolves through the P1/S10 facade; all colour
//  comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (settings query in flight)

/// The initial-fetch chrome — a card-shaped skeleton (title line + two value rows) so the layout does
/// not jump when the settings resolve. Shimmer respects Reduce Motion via the shared `TSSkeleton`.
struct FormatterPrefsBridgeLoadingView: View {
    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 160, height: 14)
                TSSkeleton(width: 220, height: 10)
                TSSkeleton(height: 12)
                TSSkeleton(height: 12)
            }
        }
        .frame(maxWidth: 360, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: FormatterPrefsBridgeStrings.string(
            "settings.formatter.loadingA11y",
            "Loading formatting preferences"
        )))
    }
}

// MARK: - Using defaults (resolved, nothing configured — never a blank box)

/// The friendly defaults state — the native parity of the web bridge applying the resolved fallbacks
/// (`en-US`, 2 decimals) when the user has set neither a locale nor a precision. Shows the resolved
/// fallback values so the surface is informative rather than a collapsed `null`.
struct FormatterPrefsBridgeDefaultsView: View {
    let applied: FormatterPrefsBridgeApplied

    private var title: String {
        FormatterPrefsBridgeStrings.string("settings.formatter.defaults.title", "Using device defaults")
    }

    private var message: String {
        FormatterPrefsBridgeStrings.string(
            "settings.formatter.defaults.message",
            "No locale or decimal preference is set yet, so numbers and dates use the device defaults."
        )
    }

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    TSIconBox(systemName: "globe", tone: .info)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        Text(verbatim: title)
                            .font(Font.TS.panel)
                            .foregroundStyle(Color.TS.textPrimary)
                        Text(verbatim: message)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                FormatterPrefsBridgeValueGrid(applied: applied)
            }
        }
        .frame(maxWidth: 360, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FormatterPrefsBridgeAccessibility.titledLabel(
            title: title,
            message: message
        )))
    }
}

// MARK: - Unavailable (web `QueryError` peer)

/// The query-failure state (web `QueryError` peer) — a compact error card with a retry affordance that
/// re-requests the settings snapshot.
struct FormatterPrefsBridgeUnavailableView: View {
    let onRetry: () -> Void

    private var title: String {
        FormatterPrefsBridgeStrings.string(
            "settings.formatter.errorTitle",
            "Couldn't load formatting preferences"
        )
    }

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: FormatterPrefsBridgeStrings.string("settings.formatter.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: FormatterPrefsBridgeStrings.string(
                    "settings.formatter.retryA11y",
                    "Retry loading formatting preferences"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: 360)
        .accessibilityElement(children: .contain)
    }
}
