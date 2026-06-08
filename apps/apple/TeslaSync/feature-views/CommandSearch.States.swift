//
//  CommandSearch.States.swift
//  TeslaSync — P4 feature view · 0225 · CommandSearch (Apple)
//
//  The result-area envelope for the vehicle-command search: the empty-box "type to search" idle hint
//  (web favorites / category groups stand-in), the catalog-loading row, the resolved-but-empty
//  no-matches state (web `commands.search.noResults`), and the catalog-failure state with a retry
//  affordance (web query error). Token-driven (P1/S9); copy via the P1/S10 facade. Never a blank panel.
//

import SwiftUI

// MARK: - Idle hint (empty box — web returns `null` → favorites / categories)

/// The "type to search" hint shown while the box is empty (web `!search.trim()`), naming the catalog
/// size so the surface is informative rather than a blank box. `catalogCount == 0` falls back to a
/// generic prompt.
struct CommandSearchIdleHint: View {
    let catalogCount: Int

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "command")
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
                    format: CommandSearchStrings.string(
                        "commandSearch.idleHintCount",
                        "Search across %d vehicle commands"
                    ),
                    catalogCount
                )
            )
        } else {
            CommandSearchStrings.text("commandSearch.idleHint", "Type to search vehicle commands")
        }
    }
}

// MARK: - Loading row (web command-status query in flight)

/// The catalog-loading row shown while the command catalog / status resolves (web `isLoading`): a
/// spinner + label.
struct CommandSearchLoadingRow: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView()
                .controlSize(.small)
                .accessibilityHidden(true)
            CommandSearchStrings.text("commandSearch.loading", "Loading commands…")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(CommandSearchStrings.text("commandSearch.loading", "Loading commands…"))
    }
}

// MARK: - Empty state (resolved, no matches — web `commands.search.noResults`)

/// The resolved-but-empty state (the query matched no commands): a friendly `ContentUnavailableView`,
/// never a blank box. The title is the web `commands.search.noResults` string.
struct CommandSearchEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                CommandSearchStrings.text("commands.search.noResults", "No commands match your search")
            } icon: {
                Image(systemName: "magnifyingglass")
            }
        } description: {
            CommandSearchStrings.text(
                "commandSearch.noResultsHint",
                "Try a different command name or category."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 120)
    }
}

// MARK: - Error state (web query error with retry)

/// The catalog-failure state with a retry affordance (web query error). Mirrors the inline error
/// treatment used across the feature-view surfaces.
struct CommandSearchErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            CommandSearchStrings.text("commandSearch.errorTitle", "Couldn't load commands")
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
                CommandSearchStrings.text("commandSearch.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CommandSearchStrings.text("commandSearch.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
