//
//  ActiveOrdersSection.Adapter.swift
//  TeslaSync — P4 feature view · 0196 · ActiveOrdersSection (Apple)
//
//  The testable projection core for the settings "Active Orders" surface — the
//  faithful port of features/settings/components/ActiveOrdersSection.tsx.
//  Everything here is pure and dependency-free (Foundation only) so it can be
//  unit-tested without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web component reads `useTeslaUserOrders()` → `{ orders, fetched_at }` and
//      maps each `TeslaOrder` to a card. The native source seam (P1/S8) hands this
//      adapter the same shape via `TeslaOrderDTO` + the envelope `fetched_at`, and
//      `OrdersProjection` projects the card rows + the render phase from it.
//    • `orderStatusVariant` (DELIVER→success, READY/TRANSPORT→info, CANCEL/REJECT→
//      danger, PENDING/ORDER→warning, else neutral) becomes `OrdersStatus.tone`.
//    • `formatOrderStatus` (`_`→space, lowercase, capitalize the first letter of
//      each word) becomes `OrdersStatus.label`; null/empty → the "—" em-dash fallback.
//    • The web `orders.length > 0 ? <grid> : <EmptyState …>` split — including BOTH
//      empty messages (`noOrders` when `fetched_at` is set, `noData` otherwise) —
//      becomes the resolved `.content` / `.emptyFetched` / `.emptyNoData` phases,
//      widened with the loading / error load envelope the bound source supplies.
//

import Foundation

// MARK: - Shared display constants

/// Display helpers shared by the status + date projections.
public enum OrdersDisplay {
    /// The universal em-dash fallback the web formatters return for missing values
    /// (web `'—'`), reused for an empty model name, status, or date.
    public static let emDash = "—"
}

// MARK: - Status tone (web `orderStatusVariant`)

/// The semantic tone of an order status, the native parity of the web
/// `orderStatusVariant` → `Badge` variant. Drives the status badge color only;
/// the visible label is the data-derived `OrdersStatus.label`, never a fixed key.
public enum OrderStatusTone: String, Sendable, Equatable, CaseIterable, Identifiable {
    case neutral
    case success
    case info
    case warning
    case danger

    public var id: String {
        rawValue
    }
}

// MARK: - Status projection (web `orderStatusVariant` + `formatOrderStatus`)

/// Pure status helpers: the tone classification + the human label, faithful ports
/// of the web `orderStatusVariant` / `formatOrderStatus` free functions.
public enum OrdersStatus {
    /// Maps a raw Tesla order status to a semantic tone. Mirrors the web
    /// `orderStatusVariant` substring checks (and their order): an empty status is
    /// neutral, `DELIVER*` is success, `READY`/`TRANSPORT` info, `CANCEL`/`REJECT`
    /// danger, `PENDING`/`ORDER` warning, anything else neutral.
    public static func tone(_ raw: String) -> OrderStatusTone {
        guard !raw.isEmpty else { return .neutral }
        let value = raw.uppercased()
        if value.contains("DELIVER") { return .success }
        if value.contains("READY") || value.contains("TRANSPORT") { return .info }
        if value.contains("CANCEL") || value.contains("REJECT") { return .danger }
        if value.contains("PENDING") || value.contains("ORDER") { return .warning }
        return .neutral
    }

    /// Humanizes a raw status the way the web `formatOrderStatus` does: replace
    /// underscores with spaces, lowercase, then uppercase the first letter of each
    /// word (the web `replace(/\b\w/g, c => c.toUpperCase())`). Empty → em-dash fallback.
    public static func label(_ raw: String) -> String {
        guard !raw.isEmpty else { return OrdersDisplay.emDash }
        let lowered = raw.replacingOccurrences(of: "_", with: " ").lowercased()
        var result = ""
        result.reserveCapacity(lowered.count)
        var previousWasWordCharacter = false
        for character in lowered {
            let isWordCharacter = character.isLetter || character.isNumber
            if isWordCharacter, !previousWasWordCharacter {
                result.append(contentsOf: character.uppercased())
            } else {
                result.append(character)
            }
            previousWasWordCharacter = isWordCharacter
        }
        return result
    }
}

// MARK: - Transport DTO (the P1/S8 source seam input)

/// One Tesla order as handed to the surface by its bound source — the native
/// parity of the web `TeslaOrder` (snake_case JSON → camelCase here). A plain
/// value type so previews + tests can build orders without a network.
public struct TeslaOrderDTO: Sendable, Equatable {
    /// The numeric primary key (web `id`); retained for fidelity, not displayed.
    public var id: Int
    /// The Tesla reference number (web `order_id`) — the row's stable identity.
    public var orderID: String
    /// The vehicle model (web `model`), e.g. "Model 3".
    public var model: String
    /// The raw order status (web `status`), e.g. "IN_PRODUCTION".
    public var status: String
    /// The scheduled delivery date as an ISO string, when known (web `delivery_date`).
    public var deliveryDate: String?
    /// The assigned VIN, once allocated (web `vin`).
    public var vin: String?
    /// Whether the order is eligible for an upgrade (web `is_upgradable`).
    public var isUpgradable: Bool

    public init(
        id: Int,
        orderID: String,
        model: String,
        status: String,
        deliveryDate: String? = nil,
        vin: String? = nil,
        isUpgradable: Bool = false
    ) {
        self.id = id
        self.orderID = orderID
        self.model = model
        self.status = status
        self.deliveryDate = deliveryDate
        self.vin = vin
        self.isUpgradable = isUpgradable
    }
}

// MARK: - Projected row (one web order card)

/// The view-ready projection of one order: the resolved model name, status label +
/// tone, and the key/value fields the card renders. Identifiable by the order
/// reference exactly like the web `key={order.order_id}`.
public struct OrderRow: Sendable, Equatable, Identifiable {
    public var orderID: String
    /// The model name, or the "—" em-dash fallback for an empty value (web `order.model || '—'`).
    public var modelName: String
    /// The humanized status label (web `formatOrderStatus`).
    public var statusLabel: String
    /// The semantic tone for the status badge (web `orderStatusVariant`).
    public var statusTone: OrderStatusTone
    /// The VIN, shown only when present (web `{order.vin && …}`).
    public var vin: String?
    /// The raw delivery-date ISO string, formatted at the display boundary; shown
    /// only when present (web `{order.delivery_date && …}`).
    public var deliveryDateISO: String?
    /// Whether to show the "Upgradable" badge (web `{order.is_upgradable && …}`).
    public var isUpgradable: Bool

    public var id: String {
        orderID
    }

    public init(
        orderID: String,
        modelName: String,
        statusLabel: String,
        statusTone: OrderStatusTone,
        vin: String? = nil,
        deliveryDateISO: String? = nil,
        isUpgradable: Bool = false
    ) {
        self.orderID = orderID
        self.modelName = modelName
        self.statusLabel = statusLabel
        self.statusTone = statusTone
        self.vin = vin
        self.deliveryDateISO = deliveryDateISO
        self.isUpgradable = isUpgradable
    }
}

// MARK: - Load status + connection + render phase

/// The bound source's load status for the orders query (web `useTeslaUserOrders`
/// `isLoading` / resolved / failure), projected into a phase by `resolvePhase`.
public enum OrdersLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached order list is clearly labeled while reconnecting / offline.
public enum OrdersConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render. The web distinguishes content vs. two empty
/// messages (`fetched_at ? 'No active orders found.' : 'No order data yet …'`);
/// the loading / error envelope around it (prompt P4 states) comes from the source.
public enum OrdersPhase: Sendable, Equatable {
    case loading
    case content
    /// Resolved, zero orders, a sync has happened → web `orders.noOrders`.
    case emptyFetched
    /// Resolved, zero orders, no sync yet → web `orders.noData`.
    case emptyNoData
    case error(String)
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the raw order list + load status to
/// view-ready rows + a render phase. A faithful port of the web component's read of
/// `ordersData.orders` / `ordersData.fetched_at`.
public enum OrdersProjection {
    /// View-ready rows for the order grid, preserving the source order exactly like
    /// the web `ordersData.orders.map(...)`.
    public static func rows(from orders: [TeslaOrderDTO]) -> [OrderRow] {
        orders.map { order in
            OrderRow(
                orderID: order.orderID,
                modelName: order.model.isEmpty ? OrdersDisplay.emDash : order.model,
                statusLabel: OrdersStatus.label(order.status),
                statusTone: OrdersStatus.tone(order.status),
                vin: order.vin,
                deliveryDateISO: order.deliveryDate,
                isUpgradable: order.isUpgradable
            )
        }
    }

    /// Resolves the render phase from the load status, the row count, and whether a
    /// sync timestamp exists (web `orders.length > 0 ? grid : (fetched_at ? noOrders
    /// : noData)`).
    public static func resolvePhase(
        _ status: OrdersLoadStatus,
        count: Int,
        hasFetchedAt: Bool
    ) -> OrdersPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            count > 0 ? .content : (hasFetchedAt ? .emptyFetched : .emptyNoData)
        }
    }
}

// MARK: - Date formatting (web `formatDateTime` / `useDateFormat().formatDate`)

/// Locale + time-zone-aware date formatting, the native parity of the web
/// `formatDateTime` (synced timestamp) and `useDateFormat().formatDate` (delivery
/// date). Pure + testable: every entry point takes an explicit locale + zone and
/// returns the "—" em-dash fallback for missing / unparseable input (web contract).
public enum OrdersDateFormat {
    /// Parses an ISO-8601 timestamp (with or without fractional seconds) or a bare
    /// `yyyy-MM-dd` date. Returns `nil` for empty / unparseable input so callers can
    /// fall back to the em-dash fallback (web `isNaN(date) → '—'`).
    public static func parse(_ iso: String) -> Date? {
        guard !iso.isEmpty else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: iso) { return date }
        let dateOnly = DateFormatter()
        dateOnly.locale = Locale(identifier: "en_US_POSIX")
        dateOnly.timeZone = TimeZone(identifier: "UTC")
        dateOnly.dateFormat = "yyyy-MM-dd"
        return dateOnly.date(from: iso)
    }

    /// Full date + time for the "Synced" label (web `formatDateTime` —
    /// "Apr 4, 2026, 2:30 AM"). `nil` → em-dash fallback.
    public static func dateTime(
        _ date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return OrdersDisplay.emDash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Date-only for the delivery date (web `useDateFormat().formatDate` —
    /// "Apr 4, 2026"). Empty / unparseable / `nil` → em-dash fallback.
    public static func date(
        _ iso: String?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let iso, let parsed = parse(iso) else { return OrdersDisplay.emDash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        return formatter.string(from: parsed)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum ActiveOrdersSurface {
    public static let slug = "ActiveOrdersSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum OrdersAccessibility {
    /// The section-level summary: title + order count, or the friendly empty message
    /// (the same `noOrders` / `noData` split the body renders).
    public static func sectionSummary(
        rows: [OrderRow],
        hasFetchedAt: Bool,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("settings.orders.title", "Active Orders")
        guard !rows.isEmpty else {
            let message = hasFetchedAt
                ? localize("settings.orders.noOrders", "No active orders found.")
                : localize("settings.orders.noData", "No order data yet. Click Refresh to fetch from Tesla.")
            return "\(title): \(message)"
        }
        return "\(title): \(rows.count)"
    }

    /// One order card's combined VoiceOver value: model, status, and each present
    /// field (Order ID, VIN, Delivery Date, Upgradable). `deliveryText` is the
    /// already-formatted date the view computed (nil when the order has no date).
    public static func cardLabel(
        _ row: OrderRow,
        deliveryText: String?,
        localize: (String, String) -> String
    ) -> String {
        var parts: [String] = [row.modelName, row.statusLabel]
        parts.append("\(localize("settings.orders.orderId", "Order ID")) \(row.orderID)")
        if let vin = row.vin, !vin.isEmpty {
            parts.append("\(localize("settings.orders.vin", "VIN")) \(vin)")
        }
        if let deliveryText, !deliveryText.isEmpty {
            parts.append("\(localize("settings.orders.deliveryDate", "Delivery Date")) \(deliveryText)")
        }
        if row.isUpgradable {
            parts.append(localize("settings.orders.upgradable", "Upgradable"))
        }
        return parts.joined(separator: ", ")
    }
}
