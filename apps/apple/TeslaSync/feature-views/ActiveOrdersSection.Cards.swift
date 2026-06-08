//
//  ActiveOrdersSection.Cards.swift
//  TeslaSync — P4 feature view · 0196 · ActiveOrdersSection (Apple)
//
//  The populated order grid + the individual order card — the SwiftUI parity of the
//  web `grid-cols-1 sm:grid-cols-2` of order tiles. Each card shows the model name +
//  status badge, then the Order ID / VIN / Delivery Date lines and the optional
//  "Upgradable" badge. Copy resolves through the P1/S10 facade (`OrdersStrings`);
//  chrome is token-driven (P1/S9). No networking lives here.
//

import SwiftUI

// MARK: - Key/value row (web card `flex justify-between`)

/// One key/value line inside an order card (web inner `<div class="flex
/// justify-between">`): a muted key on the left, a caller-supplied value trailing.
struct OrderKVRow<Value: View>: View {
    let key: String
    @ViewBuilder let value: () -> Value

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: key)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            value()
        }
    }
}

/// A monospaced value (web `font-mono`) for the Order ID / VIN lines.
struct OrderMonoValue: View {
    let value: String

    var body: some View {
        Text(verbatim: value)
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .truncationMode(.middle)
    }
}

// MARK: - Order card (web order tile)

/// One order tile (web `<div class="rounded-lg … p-4 space-y-3">`): the model name +
/// status badge header, then the Order ID / VIN / Delivery Date lines and the
/// optional "Upgradable" badge. Combined into a single VoiceOver element.
struct OrderCard: View {
    let row: OrderRow

    private var deliveryText: String? {
        guard let iso = row.deliveryDateISO else { return nil }
        return OrdersDateFormat.date(iso)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            details
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: OrdersAccessibility.cardLabel(
                row,
                deliveryText: deliveryText,
                localize: OrdersStrings.string
            ))
        )
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "shippingbox.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: row.modelName)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            OrdersBadge(label: row.statusLabel, tone: row.statusTone)
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            OrderKVRow(key: OrdersStrings.string("settings.orders.orderId", "Order ID")) {
                OrderMonoValue(value: row.orderID)
            }
            if let vin = row.vin, !vin.isEmpty {
                OrderKVRow(key: OrdersStrings.string("settings.orders.vin", "VIN")) {
                    OrderMonoValue(value: vin)
                }
            }
            if let deliveryText {
                OrderKVRow(key: OrdersStrings.string("settings.orders.deliveryDate", "Delivery Date")) {
                    HStack(spacing: TSSpacing.xs) {
                        Image(systemName: "calendar")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.TS.textMuted)
                            .accessibilityHidden(true)
                        Text(verbatim: deliveryText)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                }
            }
            if row.isUpgradable {
                HStack {
                    Spacer(minLength: 0)
                    OrdersBadge(
                        label: OrdersStrings.string("settings.orders.upgradable", "Upgradable"),
                        tone: .info
                    )
                }
            }
        }
    }
}

// MARK: - Content (web `grid-cols-1 sm:grid-cols-2`)

/// The populated order grid: one column when compact, two when wide
/// (web `grid-cols-1 sm:grid-cols-2`).
struct OrdersContent: View {
    let rows: [OrderRow]

    private let columns = [GridItem(.adaptive(minimum: 260), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(rows) { row in
                OrderCard(row: row)
            }
        }
    }
}
