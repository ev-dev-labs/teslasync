using System.Globalization;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> helpers for the active-orders surface — the native analogue of the
/// loose envelope reads the web component performs over <c>GET /tesla/user/orders</c>
/// (web/src/features/settings/components/ActiveOrdersSection.tsx). Every helper tolerates a missing or
/// schema-drifted field rather than throwing, so the projection is unit-tested without a UI host.
/// </summary>
internal static class ActiveOrdersJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The boolean value of <paramref name="name"/>, or false when absent / not a JSON boolean.</summary>
    public static bool GetBool(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.True;

    /// <summary>Parse an ISO-8601 timestamp string to a UTC-normalised instant, or null when unparseable.</summary>
    public static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// One parsed Tesla order — the native analogue of the web <c>TeslaOrder</c> row
/// (web/src/api/hooks/useUser.ts) limited to the members the card renders: the human model name, the raw
/// status string, the order id, the optional VIN and delivery date, and the upgradable flag. Parsing is
/// null-tolerant so a partial row never throws. Pure data — no WinUI types.
/// </summary>
public sealed record TeslaOrderModel(
    string OrderId,
    string Model,
    string? Status,
    string? DeliveryDate,
    string? Vin,
    bool IsUpgradable)
{
    /// <summary>Build an order from its raw JSON object, tolerating any missing or drifted member.</summary>
    public static TeslaOrderModel FromJson(JsonElement element) => new(
        ActiveOrdersJson.GetString(element, "order_id") ?? string.Empty,
        ActiveOrdersJson.GetString(element, "model") ?? string.Empty,
        ActiveOrdersJson.GetString(element, "status"),
        ActiveOrdersJson.GetString(element, "delivery_date"),
        ActiveOrdersJson.GetString(element, "vin"),
        ActiveOrdersJson.GetBool(element, "is_upgradable"));
}

/// <summary>
/// The parsed Tesla orders envelope — the native analogue of the web <c>TeslaOrdersEnvelope</c>
/// (<c>{ orders: TeslaOrder[], fetched_at: string | null }</c>) returned by <c>GET /tesla/user/orders</c>.
/// Holds the server-stamped <see cref="FetchedAt"/> (rendered in the "Synced {when}" caption and used to pick
/// the empty-body copy) and the ordered <see cref="Orders"/>. Parsing is null-tolerant so a partial or
/// non-object body never throws. Pure data — unit-tested without a UI host.
/// </summary>
public sealed record OrdersSnapshot(string? FetchedAt, IReadOnlyList<TeslaOrderModel> Orders)
{
    /// <summary>An empty snapshot (no orders, no fetch time) — the parse / projection fallback.</summary>
    public static OrdersSnapshot Empty { get; } = new(null, Array.Empty<TeslaOrderModel>());

    /// <summary>The parsed server fetch instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? FetchedAtInstant => ActiveOrdersJson.TryParseTimestamp(FetchedAt);

    /// <summary>
    /// True when the envelope carried a (non-empty) server fetch time — the native port of the web
    /// <c>ordersData?.fetched_at</c> truthiness that chooses between the "no active orders" and "no data yet"
    /// empty messages.
    /// </summary>
    public bool HasFetchTime => !string.IsNullOrEmpty(FetchedAt);

    /// <summary>Parse the orders envelope object into a tolerant snapshot.</summary>
    public static OrdersSnapshot FromJson(JsonElement envelope)
    {
        if (envelope.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        string? fetchedAt = ActiveOrdersJson.GetString(envelope, "fetched_at");

        var orders = new List<TeslaOrderModel>();
        if (envelope.TryGetProperty("orders", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in list.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object)
                {
                    orders.Add(TeslaOrderModel.FromJson(item));
                }
            }
        }

        return new OrdersSnapshot(fetchedAt, orders);
    }
}

/// <summary>
/// The lifecycle state the active-orders surface can be in. Every branch maps onto a visible surface — none is
/// ever hidden (engineering rule #6). The web shows <c>cards | empty text</c>; the native surface additionally
/// renders explicit <c>loading</c>, <c>error</c> (retry), <c>stale</c> and <c>offline</c> branches — a strict
/// superset of the web that satisfies the prompt's mandated state set.
/// </summary>
public enum ActiveOrdersState
{
    /// <summary>First fetch with nothing cached — render the skeleton cards.</summary>
    Loading,

    /// <summary>A fresh (network or non-stale cache) result with orders to show.</summary>
    Loaded,

    /// <summary>The read resolved with no orders — the friendly empty text.</summary>
    Empty,

    /// <summary>The read failed and no cached orders exist — the retry affordance.</summary>
    Error,

    /// <summary>A cached result older than the freshness window — orders plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached orders remain — orders plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Pure port of the web component's two order-status helpers
/// (web/src/features/settings/components/ActiveOrdersSection.tsx): <c>orderStatusVariant</c> maps a raw status
/// to a semantic <see cref="StatusKind"/> badge colour, and <c>formatOrderStatus</c> turns the raw token into
/// human Title Case. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class OrderStatusPresentation
{
    /// <summary>Em-dash fallback for a missing status (web <c>'\u2014'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>
    /// The semantic badge colour for a raw status — the native port of <c>orderStatusVariant</c>: a delivered
    /// status is success, ready/transport is info, cancelled/rejected is danger, pending/order is warning, and
    /// everything else (including a missing status) is neutral.
    /// </summary>
    public static StatusKind Variant(string? status)
    {
        if (string.IsNullOrEmpty(status))
        {
            return StatusKind.Neutral;
        }

        string s = status.ToUpperInvariant();
        if (s.Contains("DELIVER", StringComparison.Ordinal))
        {
            return StatusKind.Success;
        }

        if (s.Contains("READY", StringComparison.Ordinal) || s.Contains("TRANSPORT", StringComparison.Ordinal))
        {
            return StatusKind.Info;
        }

        if (s.Contains("CANCEL", StringComparison.Ordinal) || s.Contains("REJECT", StringComparison.Ordinal))
        {
            return StatusKind.Danger;
        }

        if (s.Contains("PENDING", StringComparison.Ordinal) || s.Contains("ORDER", StringComparison.Ordinal))
        {
            return StatusKind.Warning;
        }

        return StatusKind.Neutral;
    }

    /// <summary>
    /// Human-readable status — the native port of <c>formatOrderStatus</c>: underscores become spaces, the
    /// token is lower-cased, then the first alphanumeric of each word is upper-cased (the web
    /// <c>\b\w</c> replacement). A missing status renders the em-dash.
    /// </summary>
    public static string Format(string? status)
    {
        if (string.IsNullOrEmpty(status))
        {
            return EmDash;
        }

        string lowered = status.Replace('_', ' ').ToLowerInvariant();
        var builder = new StringBuilder(lowered.Length);
        bool previousWasWordChar = false;
        foreach (char c in lowered)
        {
            bool isWordChar = char.IsLetterOrDigit(c) || c == '_';
            builder.Append(isWordChar && !previousWasWordChar ? char.ToUpperInvariant(c) : c);
            previousWasWordChar = isWordChar;
        }

        return builder.ToString();
    }
}

/// <summary>
/// One projected, render-ready order card — the native analogue of an <c>ordersData.orders.map</c> card in
/// web/src/features/settings/components/ActiveOrdersSection.tsx. Holds the model name (em-dash fallback), the
/// localized status badge label and its token <see cref="StatusKind"/>, the order id, the optional VIN and
/// delivery-date cells (with their visibility gates mirroring the web <c>order.vin &amp;&amp;</c> /
/// <c>order.delivery_date &amp;&amp;</c> conditionals), the upgradable flag and a Narrator name. Pure data so
/// the projection is asserted headlessly.
/// </summary>
public sealed record OrderCardDisplay(
    string ModelText,
    string StatusLabel,
    StatusKind StatusKind,
    string OrderIdValue,
    bool ShowVin,
    string VinValue,
    bool ShowDeliveryDate,
    string DeliveryDateValue,
    bool ShowUpgradable,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the orders grid — the native analogue of the
/// <c>orders.length &gt; 0 ? grid : EmptyState</c> gate in
/// web/src/features/settings/components/ActiveOrdersSection.tsx. <see cref="HasOrders"/> reproduces the web
/// length check; the four shared cell labels mirror the web <c>Order ID</c> / <c>VIN</c> / <c>Delivery Date</c>
/// / <c>Upgradable</c> copy. Pure data so every branch is asserted without a UI host.
/// </summary>
public sealed record ActiveOrdersDisplay(
    bool HasOrders,
    IReadOnlyList<OrderCardDisplay> Cards,
    string OrderIdLabel,
    string VinLabel,
    string DeliveryDateLabel,
    string UpgradableLabel)
{
    /// <summary>An empty display (no cards) — the projection fallback.</summary>
    public static ActiveOrdersDisplay Empty { get; } = new(
        false, Array.Empty<OrderCardDisplay>(), "Order ID", "VIN", "Delivery Date", "Upgradable");
}

/// <summary>
/// Pure projection from the parsed orders to the render-ready grid model — the native port of the
/// <c>ordersData.orders.map</c> render (the status badge, the model name, the order-id / VIN / delivery-date
/// cells and the upgradable chip) plus the "Synced {when}" caption in
/// web/src/features/settings/components/ActiveOrdersSection.tsx. Every label resolves through the i18n facade
/// and <c>now</c> is injected so the date formatting is unit-tested deterministically. No WinUI types.
/// </summary>
public static class ActiveOrdersProjection
{
    /// <summary>i18n key for the order-id cell label (web <c>orders.orderId</c>).</summary>
    public const string OrderIdKey = "translation.orders.orderId";

    /// <summary>i18n key for the VIN cell label (web <c>orders.vin</c>).</summary>
    public const string VinKey = "translation.orders.vin";

    /// <summary>i18n key for the delivery-date cell label (web <c>orders.deliveryDate</c>).</summary>
    public const string DeliveryDateKey = "translation.orders.deliveryDate";

    /// <summary>i18n key for the upgradable chip label (web <c>orders.upgradable</c>).</summary>
    public const string UpgradableKey = "translation.orders.upgradable";

    /// <summary>i18n key for the "Synced" caption prefix (web <c>orders.lastSynced</c>).</summary>
    public const string LastSyncedKey = "translation.orders.lastSynced";

    /// <summary>Project the order list into a render-ready grid display using the i18n facade.</summary>
    public static ActiveOrdersDisplay Project(
        IReadOnlyList<TeslaOrderModel> orders,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(orders);
        ArgumentNullException.ThrowIfNull(localizer);

        string orderIdLabel = localizer.GetString(OrderIdKey, "Order ID");
        string vinLabel = localizer.GetString(VinKey, "VIN");
        string deliveryLabel = localizer.GetString(DeliveryDateKey, "Delivery Date");
        string upgradableLabel = localizer.GetString(UpgradableKey, "Upgradable");

        var cards = new List<OrderCardDisplay>(orders.Count);
        foreach (var order in orders)
        {
            string modelText = string.IsNullOrEmpty(order.Model) ? OrderStatusPresentation.EmDash : order.Model;
            string statusLabel = OrderStatusPresentation.Format(order.Status);
            StatusKind statusKind = OrderStatusPresentation.Variant(order.Status);

            bool showVin = !string.IsNullOrEmpty(order.Vin);
            string vinValue = order.Vin ?? string.Empty;

            bool showDelivery = !string.IsNullOrEmpty(order.DeliveryDate);
            string deliveryValue = showDelivery
                ? DateTimeFormatting.Format(
                    ActiveOrdersJson.TryParseTimestamp(order.DeliveryDate), DateTimeVariant.Date, now)
                : string.Empty;

            string automationName = BuildAutomationName(
                modelText,
                statusLabel,
                orderIdLabel,
                order.OrderId,
                showVin ? vinLabel : null,
                showVin ? vinValue : null,
                showDelivery ? deliveryLabel : null,
                showDelivery ? deliveryValue : null,
                order.IsUpgradable ? upgradableLabel : null);

            cards.Add(new OrderCardDisplay(
                modelText,
                statusLabel,
                statusKind,
                order.OrderId,
                showVin,
                vinValue,
                showDelivery,
                deliveryValue,
                order.IsUpgradable,
                automationName));
        }

        return new ActiveOrdersDisplay(
            cards.Count > 0, cards, orderIdLabel, vinLabel, deliveryLabel, upgradableLabel);
    }

    /// <summary>
    /// The "Synced {when}" caption — the native port of
    /// <c>{t('orders.lastSynced')} {formatDateTime(fetched_at)}</c>. Returns null when no server fetch time is
    /// known (web parity: the caption is only rendered when <c>fetched_at</c> is present).
    /// </summary>
    public static string? LastSyncedLabel(DateTimeOffset? fetchedAt, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (fetchedAt is not { } instant)
        {
            return null;
        }

        string prefix = localizer.GetString(LastSyncedKey, "Synced");
        string formatted = DateTimeFormatting.Format(instant, DateTimeVariant.Full, now);
        return string.Concat(prefix, " ", formatted);
    }

    private static string BuildAutomationName(
        string modelText,
        string statusLabel,
        string orderIdLabel,
        string orderId,
        string? vinLabel,
        string? vinValue,
        string? deliveryLabel,
        string? deliveryValue,
        string? upgradableLabel)
    {
        var builder = new StringBuilder();
        builder.Append(modelText).Append(". ").Append(statusLabel);
        builder.Append(". ").Append(orderIdLabel).Append(' ').Append(orderId);
        if (vinLabel is not null)
        {
            builder.Append(". ").Append(vinLabel).Append(' ').Append(vinValue);
        }

        if (deliveryLabel is not null)
        {
            builder.Append(". ").Append(deliveryLabel).Append(' ').Append(deliveryValue);
        }

        if (upgradableLabel is not null)
        {
            builder.Append(". ").Append(upgradableLabel);
        }

        return builder.ToString();
    }
}

/// <summary>
/// Maps a raw <c>GET /tesla/user/orders</c> emission (<c>RepositoryResult&lt;JsonElement&gt;</c>) to a typed
/// <c>RepositoryResult&lt;OrdersSnapshot&gt;</c>, preserving the cache-then-network status/freshness while
/// parsing the snake_case envelope (the native analogue of the web hook's typed query result). A value-bearing
/// status always carries the parsed snapshot — even when its <c>orders</c> array is empty — so the header's
/// "Synced {when}" caption survives an empty-orders response, exactly as the web header does; the body's empty
/// state is derived downstream from the order count, not from a lost payload. Pure — unit-tested without a
/// network or cache.
/// </summary>
public static class ActiveOrdersResultMapper
{
    /// <summary>Map a raw orders emission to a typed snapshot result.</summary>
    public static RepositoryResult<OrdersSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<OrdersSnapshot>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<OrdersSnapshot>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<OrdersSnapshot>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var snapshot = OrdersSnapshot.FromJson(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<OrdersSnapshot>.Cached(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<OrdersSnapshot>.Refreshing(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<OrdersSnapshot>.OfflineCached(
                snapshot, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<OrdersSnapshot>.Loaded(snapshot, fetchedAt),
        };
    }
}

/// <summary>The severity of an active-orders toast — the native analogue of the web <c>toast.success</c> /
/// <c>toast.error</c> call sites in the refresh mutation.</summary>
public enum ActiveOrdersToastKind
{
    /// <summary>The refresh succeeded (web <c>toast.success</c>).</summary>
    Success,

    /// <summary>The refresh failed (web <c>toast.error</c>).</summary>
    Error,
}

/// <summary>
/// A refresh-mutation toast request — the native analogue of the web
/// <c>toast.success(t('toast.ordersRefreshed'))</c> / <c>toast.error(t('toast.ordersFailed'), err.message)</c>
/// calls. The view-model raises it; the view forwards it to the host toast sink and announces it for
/// accessibility. Pure data so the localized payload is asserted headlessly.
/// </summary>
public sealed record ActiveOrdersToast(ActiveOrdersToastKind Kind, string Title, string? Description)
{
    /// <summary>i18n key for the success toast title (web <c>toast.ordersRefreshed</c>).</summary>
    public const string SuccessKey = "translation.toast.ordersRefreshed";

    /// <summary>i18n key for the failure toast title (web <c>toast.ordersFailed</c>).</summary>
    public const string FailureKey = "translation.toast.ordersFailed";

    /// <summary>Build the success toast (web <c>toast.success(t('toast.ordersRefreshed'))</c>).</summary>
    public static ActiveOrdersToast Success(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new ActiveOrdersToast(
            ActiveOrdersToastKind.Success,
            localizer.GetString(SuccessKey, "Orders refreshed"),
            null);
    }

    /// <summary>
    /// Build the failure toast (web <c>toast.error(t('toast.ordersFailed'), err.message)</c>), carrying the
    /// privacy-safe repository error message as the description when one is available.
    /// </summary>
    public static ActiveOrdersToast Failure(ILocalizer localizer, RepositoryError? error)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new ActiveOrdersToast(
            ActiveOrdersToastKind.Error,
            localizer.GetString(FailureKey, "Failed to refresh orders"),
            error?.Message);
    }
}

/// <summary>
/// The outcome of the orders refresh mutation — the native analogue of the web <c>useRefreshTeslaOrders</c>
/// mutation result. <see cref="Succeeded"/> drives the success-toast + refetch vs. the error-toast branch;
/// <see cref="Error"/> carries the classified failure for the toast description. Pure data.
/// </summary>
public sealed record OrdersRefreshOutcome(bool Succeeded, RepositoryError? Error)
{
    /// <summary>A successful refresh (web mutation <c>onSuccess</c>).</summary>
    public static OrdersRefreshOutcome Success() => new(true, null);

    /// <summary>A failed refresh carrying the classified error (web mutation <c>onError</c>).</summary>
    public static OrdersRefreshOutcome Failure(RepositoryError error) => new(false, error);
}

/// <summary>
/// Canonical registry metadata for the active-orders surface — the native mirror of the web settings
/// component (web/src/features/settings/components/ActiveOrdersSection.tsx). Centralises the stable id, the
/// diagnostics slug, and the localized title/subtitle so the view and view-model stay free of literal copy.
/// </summary>
public static class ActiveOrdersSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "active-orders-section";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ActiveOrdersSection";

    /// <summary>i18n key for the panel title (web <c>orders.title</c>).</summary>
    public const string TitleKey = "translation.orders.title";

    /// <summary>i18n key for the panel subtitle (web <c>orders.subtitle</c>).</summary>
    public const string SubtitleKey = "translation.orders.subtitle";

    /// <summary>Localized panel title (web <c>orders.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString(TitleKey, "Active Orders");

    /// <summary>Localized panel subtitle (web <c>orders.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(SubtitleKey, "Vehicle orders and delivery tracking from Tesla");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the active-orders surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an order id, VIN, model or delivery date
/// — so a diagnostics line can never leak a customer's vehicle order. Thread-safe.
/// </summary>
public sealed class ActiveOrdersSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ActiveOrdersSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ActiveOrdersSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ActiveOrdersSectionRegistration.Slug}");
    }
}
