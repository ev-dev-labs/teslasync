//
//  AddressInput.States.swift
//  TeslaSync — P4 feature view · 0135 · AddressInput (Apple)
//
//  The suggestion-area envelope for the "Address" autocomplete: the below-minimum "keep typing"
//  idle hint, the searching row (web `Combobox` spinner), the resolved-but-empty no-matches state
//  (web `Combobox` empty menu), and the search-failure state with a retry affordance (web
//  `QueryError`). Token-driven (P1/S9); copy via the P1/S10 facade. Never a blank panel.
//

import SwiftUI

// MARK: - Idle hint (query below the minimum length — web hook disabled)

/// The "keep typing" hint shown before the query reaches the search minimum (web
/// `enabled: query.length >= 3`). Never a blank box.
struct AddressInputIdleHint: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            AddressInputStrings.text(
                "addressInput.typeMore",
                "Type at least 3 characters to search addresses"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading row (web `Combobox` spinner)

/// The searching row shown while the geocode query is in flight (web `loading`): a spinner + label.
struct AddressInputLoadingRow: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView()
                .controlSize(.small)
                .accessibilityHidden(true)
            AddressInputStrings.text("addressInput.loading", "Searching addresses…")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AddressInputStrings.text("addressInput.loading", "Searching addresses…"))
    }
}

// MARK: - Empty state (resolved, no matches — web `Combobox` empty menu)

/// The resolved-but-empty state (the geocoder returned no rows): a friendly `ContentUnavailableView`,
/// never a blank box.
struct AddressInputEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                AddressInputStrings.text("addressInput.noResults", "No matching addresses")
            } icon: {
                Image(systemName: "mappin.slash")
            }
        } description: {
            AddressInputStrings.text(
                "addressInput.noResultsHint",
                "Try a different street, city, or postal code."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 120)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The search-failure state with a retry affordance (web `QueryError`). Mirrors the inline error
/// treatment used across the feature-view surfaces.
struct AddressInputErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            AddressInputStrings.text("addressInput.errorTitle", "Couldn't search addresses")
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
                AddressInputStrings.text("addressInput.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(AddressInputStrings.text("addressInput.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
