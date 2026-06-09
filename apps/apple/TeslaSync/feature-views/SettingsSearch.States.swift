//
//  SettingsSearch.States.swift
//  TeslaSync — P4 feature view · 0215 · SettingsSearch (Apple)
//
//  The result-area envelope for the settings find-as-you-type box: the blank-box "type to search" idle
//  hint (web shows no dropdown while the box is empty), the index-loading row, the resolved-but-empty
//  no-matches state (web `settings.search.noResults` — "No matching settings."), and the index-failure
//  state with a retry affordance. Token-driven (P1/S9); copy via the P1/S10 facade. Never a blank panel.
//

import SwiftUI

// MARK: - Idle hint (blank box — web renders no dropdown)

/// The "type to search" hint shown while the box is blank (web `showDropdown = open && query.length > 0`
/// is false), naming the index size so the surface is informative rather than a blank box.
/// `catalogCount == 0` falls back to a generic prompt.
struct SettingsSearchIdleHint: View {
    let catalogCount: Int

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            label
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var label: some View {
        if catalogCount > 0 {
            Text(
                String(
                    format: SettingsSearchStrings.string(
                        "settingsSearch.idleHintCount",
                        "Search across %d settings"
                    ),
                    catalogCount
                )
            )
        } else {
            SettingsSearchStrings.text("settingsSearch.idleHint", "Type to search settings")
        }
    }
}

// MARK: - Loading row (index building)

/// The index-loading row shown while the settings index resolves: a spinner + label.
struct SettingsSearchLoadingRow: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView()
                .controlSize(.small)
                .accessibilityHidden(true)
            SettingsSearchStrings.text("settingsSearch.loading", "Loading settings…")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SettingsSearchStrings.text("settingsSearch.loading", "Loading settings…"))
    }
}

// MARK: - Empty state (resolved, no matches — web `settings.search.noResults`)

/// The resolved-but-empty state (the query matched no settings): a friendly `ContentUnavailableView`,
/// never a blank box. The title is the web `settings.search.noResults` string ("No matching settings.").
struct SettingsSearchEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SettingsSearchStrings.text("settings.search.noResults", "No matching settings.")
            } icon: {
                Image(systemName: "magnifyingglass")
            }
        } description: {
            SettingsSearchStrings.text(
                "settingsSearch.noResultsHint",
                "Try a different name, unit, or keyword."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 120)
    }
}

// MARK: - Error state (index failure with retry)

/// The index-failure state with a retry affordance. Mirrors the inline error treatment used across the
/// feature-view surfaces.
struct SettingsSearchErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SettingsSearchStrings.text("settingsSearch.errorTitle", "Couldn't load settings")
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
            Button(action: onRetry) {
                SettingsSearchStrings.text("settingsSearch.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SettingsSearchStrings.text("settingsSearch.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
