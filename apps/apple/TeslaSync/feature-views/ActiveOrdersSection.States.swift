//
//  ActiveOrdersSection.States.swift
//  TeslaSync — P4 feature view · 0196 · ActiveOrdersSection (Apple)
//
//  The non-content load states composed by `ActiveOrdersSection`: the initial-fetch
//  skeleton, the two resolved-empty messages (web `noOrders` / `noData`), and the
//  fetch-failure error with a retry affordance (web `QueryError`). Every state
//  renders something — never a blank box. Copy resolves through the P1/S10 facade.
//

import SwiftUI

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton: a grid of muted card blocks, respecting Reduce
/// Motion (via `TSSkeleton`).
struct OrdersLoading: View {
    private let columns = [GridItem(.adaptive(minimum: 260), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 2, id: \.self) { _ in
                TSSkeleton(height: 132, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(OrdersStrings.text("settings.orders.loading", "Loading orders"))
    }
}

// MARK: - Empty states (web `EmptyState` — two messages)

/// The resolved-but-empty state. Renders the web `noOrders` message when a sync has
/// happened, or the `noData` message otherwise — never a blank box.
struct OrdersEmpty: View {
    let hasFetchedAt: Bool

    private var message: Text {
        hasFetchedAt
            ? OrdersStrings.text("settings.orders.noOrders", "No active orders found.")
            : OrdersStrings.text(
                "settings.orders.noData",
                "No order data yet. Click Refresh to fetch from Tesla."
            )
    }

    var body: some View {
        ContentUnavailableView {
            Label {
                OrdersStrings.text("settings.orders.title", "Active Orders")
            } icon: {
                Image(systemName: hasFetchedAt ? "shippingbox" : "info.circle")
            }
        } description: {
            message
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct OrdersError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            OrdersStrings.text("settings.orders.errorTitle", "Couldn't load orders")
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
                OrdersStrings.text("settings.orders.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(OrdersStrings.text("settings.orders.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
