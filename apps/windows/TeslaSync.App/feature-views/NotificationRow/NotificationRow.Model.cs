using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The mutually-exclusive render branch of the <c>NotificationRow</c> surface — the native union of the states
/// the P2 feature-view contract requires for one inbox row
/// (web/src/features/notifications/components/NotificationRow.tsx). The web component is a pure presentational
/// child (it takes an already-resolved <c>log</c> plus optional <c>rule</c> / <c>vehicle</c> and performs no
/// fetching), so the hosting inbox owns the query lifecycle and supplies the active state. Every member maps onto
/// a visible surface; none is ever hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum NotificationRowState
{
    /// <summary>The inbox query is in flight and nothing has arrived yet — skeleton row chrome.</summary>
    Loading,

    /// <summary>A resolved notification log to render (the web fall-through) — the inbox row.</summary>
    Ready,

    /// <summary>Resolved with no log — a friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — the row plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached row plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Which timezone the row's timestamp is rendered in — the native mirror of the web <c>in={tzMode}</c> prop,
/// where the row picks the vehicle timezone when the vehicle is known and the user timezone otherwise
/// (web/src/features/notifications/components/NotificationRow.tsx).
/// </summary>
public enum NotificationRowTimeZone
{
    /// <summary>Render in the vehicle's timezone (web <c>'vehicle'</c>) — used when the vehicle is known.</summary>
    Vehicle,

    /// <summary>Render in the user's timezone (web <c>'user'</c>) — the fallback when no vehicle is known.</summary>
    User,
}

/// <summary>
/// One notification log — the native analogue of the fields the web row reads from <c>NotificationLog</c>
/// (web/src/features/notifications/components/NotificationRow.tsx). Narrowed to exactly what the row renders:
/// the title and message, the raised timestamp, and the read / archived stamps that drive the unread accent and
/// the per-row actions. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">Stable notification id (web <c>log.id</c>); forwarded to the host on every per-row action.</param>
/// <param name="Title">The notification title (web <c>log.title</c>).</param>
/// <param name="Message">The notification message (web <c>log.message</c>); may be empty.</param>
/// <param name="CreatedAt">When the notification was raised (web <c>log.created_at</c>); drives the timestamp and the drill-through context.</param>
/// <param name="ReadAt">When the notification was read, or <see langword="null"/> when it is unread (web <c>log.read_at</c>).</param>
/// <param name="ArchivedAt">When the notification was archived, or <see langword="null"/> when it is not (web <c>log.archived_at</c>).</param>
public sealed record NotificationRowLog(
    long Id,
    string Title,
    string Message,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ReadAt,
    DateTimeOffset? ArchivedAt);

/// <summary>
/// The alert rule a notification was raised from — the native analogue of the fields the web row reads from
/// <c>AlertRule</c> (web/src/features/notifications/components/NotificationRow.tsx). The row uses it for the
/// severity accent, the optional rule-name meta chip, and the drill-through context (the rule's signal + scoped
/// vehicle). Pure data — no WinUI types.
/// </summary>
/// <param name="Id">Stable rule id (web <c>rule.id</c>).</param>
/// <param name="Name">The rule's display name, or <see langword="null"/> (web <c>rule.name</c>); shown as a meta chip when present.</param>
/// <param name="Severity">The rule severity (web <c>rule.severity</c>); drives the severity badge and accent.</param>
/// <param name="VehicleId">The rule's scoped vehicle id (web <c>rule.vehicle_id</c>); the drill-through fallback when no vehicle prop is supplied.</param>
/// <param name="SignalName">The rule's telemetry signal, or <see langword="null"/> (web <c>rule.signal_name</c>); selects the drill-through destination page.</param>
public sealed record NotificationRowRule(
    long Id,
    string? Name,
    string Severity,
    long VehicleId,
    string? SignalName);

/// <summary>
/// The vehicle a notification belongs to — the native analogue of the fields the web row reads from
/// <c>Vehicle</c> (web/src/features/notifications/components/NotificationRow.tsx). The row uses it for the vehicle
/// meta chip (<c>vehicle.display_name || #id</c>), the drill-through vehicle id, and to select the vehicle
/// timezone. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">Stable vehicle id (web <c>vehicle.id</c>).</param>
/// <param name="DisplayName">The vehicle's display name, or <see langword="null"/> (web <c>vehicle.display_name</c>); falls back to <c>#id</c>.</param>
public sealed record NotificationRowVehicle(long Id, string? DisplayName);

/// <summary>
/// The render-time data model the <c>NotificationRow</c> view binds to — the native analogue of the web
/// component's <c>log</c> + <c>rule</c> + <c>vehicle</c> + <c>selected</c> props plus the parent-supplied
/// lifecycle <see cref="Status"/> and freshness flags. The view never performs HTTP; the hosting inbox state
/// holder fills this in (the native P1/S8 seam). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The parent-supplied lifecycle state.</param>
/// <param name="Log">The notification log to render, or <see langword="null"/> for the loading / empty / error states.</param>
/// <param name="Rule">The originating alert rule, or <see langword="null"/> when the rule is unknown (web <c>rule?</c>).</param>
/// <param name="Vehicle">The owning vehicle, or <see langword="null"/> when the vehicle is unknown (web <c>vehicle?</c>).</param>
/// <param name="Selected">Whether the row's selection checkbox is checked (web <c>selected</c>).</param>
/// <param name="UpdatedAt">Last successful update timestamp surfaced in the freshness chip.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="ErrorMessage">Already-localized error message for the error / offline surfaces, when set.</param>
public sealed record NotificationRowModel(
    NotificationRowState Status,
    NotificationRowLog? Log,
    NotificationRowRule? Rule = null,
    NotificationRowVehicle? Vehicle = null,
    bool Selected = false,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the inbox query is in flight and nothing has arrived yet.</summary>
    public static NotificationRowModel Loading() => new(NotificationRowState.Loading, null);

    /// <summary>A resolved model with no log — the empty state.</summary>
    public static NotificationRowModel Empty() => new(NotificationRowState.Empty, null);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    /// <param name="message">An already-localized error message, or null for the default copy.</param>
    public static NotificationRowModel Failed(string? message = null) =>
        new(NotificationRowState.Error, null, ErrorMessage: message);

    /// <summary>A fresh resolved model carrying the notification to render.</summary>
    /// <param name="log">The notification log.</param>
    /// <param name="rule">The originating rule, or null.</param>
    /// <param name="vehicle">The owning vehicle, or null.</param>
    /// <param name="selected">Whether the row is selected.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="isFetching">True while a background refresh is in flight.</param>
    public static NotificationRowModel Ready(
        NotificationRowLog log,
        NotificationRowRule? rule = null,
        NotificationRowVehicle? vehicle = null,
        bool selected = false,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false)
    {
        ArgumentNullException.ThrowIfNull(log);
        return new(NotificationRowState.Ready, log, rule, vehicle, selected, updatedAt, isFetching);
    }

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached notification.</summary>
    /// <param name="log">The cached notification log.</param>
    /// <param name="rule">The originating rule, or null.</param>
    /// <param name="vehicle">The owning vehicle, or null.</param>
    /// <param name="selected">Whether the row is selected.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    public static NotificationRowModel Stale(
        NotificationRowLog log,
        NotificationRowRule? rule = null,
        NotificationRowVehicle? vehicle = null,
        bool selected = false,
        DateTimeOffset? updatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(log);
        return new(NotificationRowState.Stale, log, rule, vehicle, selected, updatedAt);
    }

    /// <summary>An offline snapshot (no connectivity) carrying the last cached notification.</summary>
    /// <param name="log">The cached notification log.</param>
    /// <param name="rule">The originating rule, or null.</param>
    /// <param name="vehicle">The owning vehicle, or null.</param>
    /// <param name="selected">Whether the row is selected.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="message">An already-localized offline message, or null for the default copy.</param>
    public static NotificationRowModel Offline(
        NotificationRowLog log,
        NotificationRowRule? rule = null,
        NotificationRowVehicle? vehicle = null,
        bool selected = false,
        DateTimeOffset? updatedAt = null,
        string? message = null)
    {
        ArgumentNullException.ThrowIfNull(log);
        return new(NotificationRowState.Offline, log, rule, vehicle, selected, updatedAt, ErrorMessage: message);
    }
}

/// <summary>
/// A drill-through navigation target for a notification — the native port of the web row's
/// <c>getAlertDrillthroughHref(synthetic)</c> (web/src/lib/alertDrillthrough.ts). Maps the rule's
/// <c>signal_name</c> onto the context page (or the Signal Explorer fallback) and forwards the alert context
/// (<c>vehicle_id</c>, <c>t</c>, <c>signal</c>) as snake_case query parameters. The web row builds a synthetic
/// <c>Alert</c> whose <c>vehicle_id</c> is <c>vehicle?.id ?? rule?.vehicle_id ?? 0</c>, whose <c>rule_signal</c>
/// is the rule's signal, and whose <c>created_at</c> is the log's timestamp; this type reproduces that mapping.
/// The view raises the target as an event so the host performs the actual navigation. Pure data — no WinUI types.
/// </summary>
/// <param name="Path">The destination route path (no leading slash, matching the native route table).</param>
/// <param name="Query">The forwarded alert-context query parameters, in web order (<c>vehicle_id</c>, <c>t</c>, <c>signal</c>).</param>
public sealed record NotificationRowDrillthrough(string Path, IReadOnlyList<KeyValuePair<string, string>> Query)
{
    /// <summary>Generic fallback page when no signal-specific page is registered (web <c>SIGNAL_EXPLORER_FALLBACK</c>).</summary>
    public const string SignalExplorerFallback = "signal-explorer";

    /// <summary>
    /// Telemetry signal name → native route path (no leading slash, matching the native route table). A 1:1 port
    /// of <c>SIGNAL_TO_PAGE</c> in web/src/lib/alertDrillthrough.ts.
    /// </summary>
    private static readonly Dictionary<string, string> SignalToPage = new(StringComparer.Ordinal)
    {
        // Battery
        ["BatteryLevel"] = "battery",
        ["RatedRange"] = "battery",
        ["ChargeLimitSoc"] = "battery",
        ["EstBatteryRange"] = "battery",
        ["IdealBatteryRange"] = "battery",

        // Charging
        ["ChargeState"] = "charging",
        ["DetailedChargeState"] = "charging",
        ["DCChargingPower"] = "charging",
        ["ACChargingPower"] = "charging",
        ["ChargeAmps"] = "charging",
        ["ChargerVoltage"] = "charging",
        ["ChargerActualCurrent"] = "charging",
        ["ChargingCableType"] = "charging",

        // Driving
        ["Gear"] = "drives",
        ["VehicleSpeed"] = "drives",
        ["Power"] = "drives",
        ["Odometer"] = "drives",

        // Climate
        ["InsideTemp"] = "climate-control",
        ["OutsideTemp"] = "climate-control",
        ["HvacPower"] = "climate-control",
        ["ClimateKeeperMode"] = "climate-control",

        // Tire pressure
        ["TpmsPressureFl"] = "tire-pressure",
        ["TpmsPressureFr"] = "tire-pressure",
        ["TpmsPressureRl"] = "tire-pressure",
        ["TpmsPressureRr"] = "tire-pressure",
        ["TpmsHardWarnings"] = "tire-pressure",
        ["TpmsSoftWarnings"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeFl"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeFr"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeRl"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeRr"] = "tire-pressure",

        // Security / access
        ["Locked"] = "security-access",
        ["SentryMode"] = "security-access",
        ["DoorState"] = "security-access",
        ["WindowState"] = "security-access",
        ["SunroofInstalled"] = "security-access",

        // Software
        ["SoftwareUpdateVersion"] = "software-updates",
        ["SoftwareUpdateDownloadPercentComplete"] = "software-updates",
        ["SoftwareUpdateInstallationPercentComplete"] = "software-updates",
        ["SoftwareUpdateExpectedDurationMinutes"] = "software-updates",

        // Location / navigation
        ["LocatedAtHome"] = "navigation",
        ["LocatedAtWork"] = "navigation",
        ["LocatedAtFavorite"] = "navigation",
        ["DestinationName"] = "navigation",
        ["DestinationLocation"] = "navigation",
    };

    /// <summary>
    /// Compute the drill-through target for the notification in <paramref name="model"/>, reproducing the web
    /// row's synthetic alert: <c>vehicle_id = vehicle?.id ?? rule?.vehicle_id ?? 0</c> (treated as "no vehicle"
    /// when not positive), <c>signal = rule?.signal_name</c>, and <c>t = log.created_at</c>.
    /// </summary>
    /// <param name="model">The render-time model (its rule, vehicle and log supply the alert context).</param>
    public static NotificationRowDrillthrough For(NotificationRowModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        string? signal = string.IsNullOrEmpty(model.Rule?.SignalName) ? null : model.Rule!.SignalName;

        // web: alert.vehicle_id = vehicle?.id ?? rule?.vehicle_id ?? 0; a 0 / unset id is treated as "no vehicle".
        long resolvedVehicleId = model.Vehicle?.Id ?? model.Rule?.VehicleId ?? 0;
        long? vehicleId = resolvedVehicleId > 0 ? resolvedVehicleId : null;

        var query = new List<KeyValuePair<string, string>>(3);
        if (vehicleId is { } id)
        {
            query.Add(new KeyValuePair<string, string>("vehicle_id", id.ToString(CultureInfo.InvariantCulture)));
        }

        if (model.Log is { } log)
        {
            query.Add(new KeyValuePair<string, string>("t", log.CreatedAt.ToString("o", CultureInfo.InvariantCulture)));
        }

        if (signal is not null)
        {
            query.Add(new KeyValuePair<string, string>("signal", signal));
        }

        string path = signal is not null && SignalToPage.TryGetValue(signal, out string? mapped)
            ? mapped
            : SignalExplorerFallback;

        return new NotificationRowDrillthrough(path, query);
    }

    /// <summary>The target as a single relative href ("path?k=v&amp;…"), mirroring the web helper.</summary>
    public string Href
    {
        get
        {
            if (Query.Count == 0)
            {
                return Path;
            }

            var parts = new string[Query.Count];
            for (int i = 0; i < Query.Count; i++)
            {
                parts[i] = string.Concat(
                    Uri.EscapeDataString(Query[i].Key), "=", Uri.EscapeDataString(Query[i].Value));
            }

            return string.Concat(Path, "?", string.Join('&', parts));
        }
    }
}

/// <summary>
/// The fully projected, render-ready view of one <c>NotificationRow</c> input — the native analogue of everything
/// the web row computes before returning JSX. Holds the active <see cref="State"/>, the read / archived / unread
/// flags, the severity and its token brush key, the timestamp + timezone mode, the title / message, the vehicle
/// and rule meta chips, the drill-through href, the per-row action visibility, every localized label, the
/// freshness chip copy + status, the empty / loading / error copy and retry label, the freshness timestamp +
/// fetching flag, and the surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Id">The notification id forwarded to the host on every per-row action.</param>
/// <param name="Selected">Whether the selection checkbox is checked.</param>
/// <param name="IsRead">Whether the notification is read (web <c>Boolean(log.read_at)</c>).</param>
/// <param name="IsArchived">Whether the notification is archived (web <c>Boolean(log.archived_at)</c>).</param>
/// <param name="IsUnread">Convenience inverse of <see cref="IsRead"/> — the unread accent branch.</param>
/// <param name="Severity">The raw severity string (web <c>rule?.severity ?? 'info'</c>); forwarded to the severity badge.</param>
/// <param name="SeverityAccentBrushKey">The design-token brush key for the severity accent.</param>
/// <param name="CreatedAt">When the notification was raised; rendered by the timestamp control.</param>
/// <param name="TimeZone">Which timezone the timestamp is rendered in (web <c>in={tzMode}</c>).</param>
/// <param name="Title">The notification title.</param>
/// <param name="Message">The notification message (may be empty).</param>
/// <param name="HasMessage">Whether a message is present (web <c>log.message &amp;&amp; …</c>).</param>
/// <param name="ShowVehicle">Whether the vehicle meta chip is shown (web <c>vehicle &amp;&amp; …</c>).</param>
/// <param name="VehicleName">The vehicle meta chip text (web <c>vehicle.display_name || #id</c>).</param>
/// <param name="ShowRuleName">Whether the rule-name meta chip is shown (web <c>rule?.name &amp;&amp; …</c>).</param>
/// <param name="RuleName">The rule-name meta chip text.</param>
/// <param name="HasDrill">Whether the drill-through affordance is shown (web <c>drillHref &amp;&amp; …</c>).</param>
/// <param name="DrillHref">The drill-through target the "View context" affordance navigates to.</param>
/// <param name="ShowMarkRead">Whether the mark-read action is shown (web <c>!isRead</c>).</param>
/// <param name="ShowMarkUnread">Whether the mark-unread action is shown (web <c>isRead</c>).</param>
/// <param name="ShowArchive">Whether the archive action is shown (web <c>!isArchived</c>).</param>
/// <param name="ShowUnarchive">Whether the restore action is shown (web <c>isArchived</c>).</param>
/// <param name="SelectLabel">The accessible label for the selection checkbox (web <c>notifications.inbox.row.select</c>).</param>
/// <param name="MarkReadLabel">The mark-read action label (web <c>notifications.inbox.row.markRead</c>).</param>
/// <param name="MarkUnreadLabel">The mark-unread action label (web <c>notifications.inbox.row.markUnread</c>).</param>
/// <param name="ArchiveLabel">The archive action label (web <c>notifications.inbox.row.archive</c>).</param>
/// <param name="UnarchiveLabel">The restore action label (web <c>notifications.inbox.row.unarchive</c>).</param>
/// <param name="ViewContextLabel">The "View context" affordance label (web <c>alerts.viewContext</c>).</param>
/// <param name="ShowFreshnessChip">Whether a stale / offline freshness chip is shown.</param>
/// <param name="FreshnessChipText">The freshness chip copy.</param>
/// <param name="FreshnessChipStatus">The freshness chip semantic status.</param>
/// <param name="EmptyMessage">The localized empty-state copy.</param>
/// <param name="LoadingLabel">The localized loading copy.</param>
/// <param name="ErrorTitle">The localized error title.</param>
/// <param name="ErrorMessage">The localized error message.</param>
/// <param name="RetryLabel">The localized retry affordance label.</param>
/// <param name="UpdatedAt">The freshness timestamp surfaced to the host.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record NotificationRowDisplay(
    NotificationRowState State,
    long Id,
    bool Selected,
    bool IsRead,
    bool IsArchived,
    bool IsUnread,
    string Severity,
    string SeverityAccentBrushKey,
    DateTimeOffset CreatedAt,
    NotificationRowTimeZone TimeZone,
    string Title,
    string Message,
    bool HasMessage,
    bool ShowVehicle,
    string VehicleName,
    bool ShowRuleName,
    string RuleName,
    bool HasDrill,
    string DrillHref,
    bool ShowMarkRead,
    bool ShowMarkUnread,
    bool ShowArchive,
    bool ShowUnarchive,
    string SelectLabel,
    string MarkReadLabel,
    string MarkUnreadLabel,
    string ArchiveLabel,
    string UnarchiveLabel,
    string ViewContextLabel,
    bool ShowFreshnessChip,
    string FreshnessChipText,
    StatusKind FreshnessChipStatus,
    string EmptyMessage,
    string LoadingLabel,
    string ErrorTitle,
    string ErrorMessage,
    string RetryLabel,
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="NotificationRowModel"/> to its <see cref="NotificationRowDisplay"/> — the
/// native port of web/src/features/notifications/components/NotificationRow.tsx. Branch precedence mirrors the web
/// parent's data lifecycle (loading → error → empty → freshness → ready); a fresh snapshot with no log collapses
/// to a friendly empty state, while a stale / offline snapshot keeps its cached row under a freshness chip. The
/// severity is <c>rule?.severity ?? 'info'</c>, the unread / archived splits follow <c>Boolean(log.read_at)</c> /
/// <c>Boolean(log.archived_at)</c>, the vehicle chip is <c>display_name || #id</c>, the timezone mode is
/// <c>vehicle ? 'vehicle' : 'user'</c>, and the drill-through href is computed only when a rule is present (the
/// web <c>rule ? getAlertDrillthroughHref(synthetic) : null</c>). Every label resolves through the i18n facade
/// using the catalog keys the web source feeds into <c>t()</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class NotificationRowProjection
{
    /// <summary>i18n key for the selection checkbox label (web <c>notifications.inbox.row.select</c>).</summary>
    public const string SelectKey = "notifications.inbox.row.select";

    /// <summary>i18n key for the mark-read action (web <c>notifications.inbox.row.markRead</c>).</summary>
    public const string MarkReadKey = "notifications.inbox.row.markRead";

    /// <summary>i18n key for the mark-unread action (web <c>notifications.inbox.row.markUnread</c>).</summary>
    public const string MarkUnreadKey = "notifications.inbox.row.markUnread";

    /// <summary>i18n key for the archive action (web <c>notifications.inbox.row.archive</c>).</summary>
    public const string ArchiveKey = "notifications.inbox.row.archive";

    /// <summary>i18n key for the restore action (web <c>notifications.inbox.row.unarchive</c>).</summary>
    public const string UnarchiveKey = "notifications.inbox.row.unarchive";

    /// <summary>i18n key for the "View context" drill-through affordance (web <c>alerts.viewContext</c>).</summary>
    public const string ViewContextKey = "alerts.viewContext";

    /// <summary>i18n key for the loading copy (the shared <c>common.loading</c> string).</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>i18n key for the empty copy (the inbox "No notifications" string).</summary>
    public const string EmptyKey = "notifications.inbox.empty.title";

    /// <summary>i18n key for the error title (the shared <c>error.loadFailed</c> string).</summary>
    public const string ErrorTitleKey = "error.loadFailed";

    /// <summary>i18n key for the default error body (the shared network message).</summary>
    public const string ErrorMessageKey = "error.network.message";

    /// <summary>i18n key for the retry affordance (the shared <c>common.retry</c> string).</summary>
    public const string RetryKey = "common.retry";

    /// <summary>i18n key for the offline chip (the shared <c>common.offline</c> string).</summary>
    public const string OfflineKey = "common.offline";

    /// <summary>i18n key for the stale chip (the shared <c>common.stale</c> string).</summary>
    public const string StaleKey = "common.stale";

    /// <summary>English fallback for <see cref="SelectKey"/> (matches the web default).</summary>
    public const string SelectFallback = "Select notification";

    /// <summary>English fallback for <see cref="MarkReadKey"/> (matches the web default).</summary>
    public const string MarkReadFallback = "Mark as read";

    /// <summary>English fallback for <see cref="MarkUnreadKey"/> (matches the web default).</summary>
    public const string MarkUnreadFallback = "Mark as unread";

    /// <summary>English fallback for <see cref="ArchiveKey"/> (matches the web default).</summary>
    public const string ArchiveFallback = "Archive";

    /// <summary>English fallback for <see cref="UnarchiveKey"/> (matches the web default).</summary>
    public const string UnarchiveFallback = "Restore";

    /// <summary>English fallback for <see cref="ViewContextKey"/> (matches the web default).</summary>
    public const string ViewContextFallback = "View context";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading...";

    /// <summary>English fallback for <see cref="EmptyKey"/> (matches the inbox catalog default).</summary>
    public const string EmptyFallback = "No notifications";

    /// <summary>English fallback for <see cref="ErrorTitleKey"/>.</summary>
    public const string ErrorTitleFallback = "Failed to load data";

    /// <summary>English fallback for <see cref="ErrorMessageKey"/>.</summary>
    public const string ErrorMessageFallback = "Check your internet connection and try again.";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "Offline";

    /// <summary>English fallback for <see cref="StaleKey"/>.</summary>
    public const string StaleFallback = "Stale";

    /// <summary>The severity the web row falls back to when no rule severity is known (web <c>'info'</c>).</summary>
    public const string DefaultSeverity = "info";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props plus lifecycle).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static NotificationRowDisplay Project(NotificationRowModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        NotificationRowState state = SelectState(model);
        NotificationRowLog? log = model.Log;

        bool isRead = log?.ReadAt is not null;
        bool isArchived = log?.ArchivedAt is not null;

        // web: rule?.severity ?? 'info' — an unknown rule (or unset severity) reads as info.
        string severity = string.IsNullOrWhiteSpace(model.Rule?.Severity) ? DefaultSeverity : model.Rule!.Severity;

        bool showVehicle = model.Vehicle is not null;
        string vehicleName = showVehicle ? VehicleName(model.Vehicle!) : string.Empty;

        string ruleName = model.Rule?.Name ?? string.Empty;
        bool showRuleName = !string.IsNullOrEmpty(ruleName);

        string title = log?.Title ?? string.Empty;
        string message = log?.Message ?? string.Empty;
        bool hasMessage = !string.IsNullOrEmpty(message);

        // web: const tzMode = vehicle ? 'vehicle' : 'user';
        NotificationRowTimeZone timeZone = showVehicle ? NotificationRowTimeZone.Vehicle : NotificationRowTimeZone.User;

        bool isRow = state is NotificationRowState.Ready or NotificationRowState.Stale or NotificationRowState.Offline;

        // web: const drillHref = rule ? getAlertDrillthroughHref(synthetic) : null;  (synthetic needs the log)
        bool hasDrill = isRow && model.Rule is not null && log is not null;
        string drillHref = hasDrill ? NotificationRowDrillthrough.For(model).Href : string.Empty;

        string selectLabel = localizer.GetString(SelectKey, SelectFallback);
        string markReadLabel = localizer.GetString(MarkReadKey, MarkReadFallback);
        string markUnreadLabel = localizer.GetString(MarkUnreadKey, MarkUnreadFallback);
        string archiveLabel = localizer.GetString(ArchiveKey, ArchiveFallback);
        string unarchiveLabel = localizer.GetString(UnarchiveKey, UnarchiveFallback);
        string viewContextLabel = localizer.GetString(ViewContextKey, ViewContextFallback);

        string loadingLabel = localizer.GetString(LoadingKey, LoadingFallback);
        string emptyMessage = localizer.GetString(EmptyKey, EmptyFallback);
        string errorTitle = localizer.GetString(ErrorTitleKey, ErrorTitleFallback);
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(ErrorMessageKey, ErrorMessageFallback)
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString(RetryKey, RetryFallback);

        bool showChip = state is NotificationRowState.Stale or NotificationRowState.Offline;
        string chipText = state switch
        {
            NotificationRowState.Offline => localizer.GetString(OfflineKey, OfflineFallback),
            NotificationRowState.Stale => localizer.GetString(StaleKey, StaleFallback),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == NotificationRowState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string automationName = BuildAutomationName(
            state, title, message, severity, showVehicle, vehicleName, showRuleName, ruleName,
            showChip, chipText, emptyMessage, loadingLabel, errorTitle);

        return new NotificationRowDisplay(
            State: state,
            Id: log?.Id ?? 0,
            Selected: model.Selected,
            IsRead: isRead,
            IsArchived: isArchived,
            IsUnread: !isRead,
            Severity: severity,
            SeverityAccentBrushKey: SeverityLevels.TokensFor(severity).AccentBrushKey,
            CreatedAt: log?.CreatedAt ?? default,
            TimeZone: timeZone,
            Title: title,
            Message: message,
            HasMessage: hasMessage,
            ShowVehicle: showVehicle,
            VehicleName: vehicleName,
            ShowRuleName: showRuleName,
            RuleName: ruleName,
            HasDrill: hasDrill,
            DrillHref: drillHref,
            ShowMarkRead: isRow && !isRead,
            ShowMarkUnread: isRow && isRead,
            ShowArchive: isRow && !isArchived,
            ShowUnarchive: isRow && isArchived,
            SelectLabel: selectLabel,
            MarkReadLabel: markReadLabel,
            MarkUnreadLabel: markUnreadLabel,
            ArchiveLabel: archiveLabel,
            UnarchiveLabel: unarchiveLabel,
            ViewContextLabel: viewContextLabel,
            ShowFreshnessChip: showChip,
            FreshnessChipText: chipText,
            FreshnessChipStatus: chipStatus,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            UpdatedAt: model.UpdatedAt,
            IsFetching: model.IsFetching,
            AutomationName: automationName);
    }

    /// <summary>
    /// The vehicle meta chip text — the native port of the web <c>vehicle.display_name || `#${vehicle.id}`</c>:
    /// the display name when present, otherwise the id prefixed with <c>#</c>.
    /// </summary>
    /// <param name="vehicle">The owning vehicle.</param>
    public static string VehicleName(NotificationRowVehicle vehicle)
    {
        ArgumentNullException.ThrowIfNull(vehicle);
        return string.IsNullOrEmpty(vehicle.DisplayName)
            ? string.Concat("#", vehicle.Id.ToString(CultureInfo.InvariantCulture))
            : vehicle.DisplayName!;
    }

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; a fresh "Ready" snapshot (or a stale / offline one) with no log
    // has nothing to render and collapses to the friendly empty state.
    private static NotificationRowState SelectState(NotificationRowModel model) => model.Status switch
    {
        NotificationRowState.Loading => NotificationRowState.Loading,
        NotificationRowState.Error => NotificationRowState.Error,
        NotificationRowState.Empty => NotificationRowState.Empty,
        NotificationRowState.Stale => model.Log is null ? NotificationRowState.Empty : NotificationRowState.Stale,
        NotificationRowState.Offline => model.Log is null ? NotificationRowState.Empty : NotificationRowState.Offline,
        _ => model.Log is null ? NotificationRowState.Empty : NotificationRowState.Ready,
    };

    private static string BuildAutomationName(
        NotificationRowState state,
        string title,
        string message,
        string severity,
        bool showVehicle,
        string vehicleName,
        bool showRuleName,
        string ruleName,
        bool showChip,
        string chipText,
        string emptyMessage,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case NotificationRowState.Loading:
                return loadingLabel;
            case NotificationRowState.Empty:
                return emptyMessage;
            case NotificationRowState.Error:
                return errorTitle;
            default:
                // Reading order matches the row: severity, title, message, vehicle, rule, freshness. Only present
                // parts are spoken so the Narrator name never carries a dangling separator.
                var parts = new List<string>(6);
                if (!string.IsNullOrWhiteSpace(severity))
                {
                    parts.Add(severity);
                }

                if (!string.IsNullOrWhiteSpace(title))
                {
                    parts.Add(title);
                }

                if (!string.IsNullOrWhiteSpace(message))
                {
                    parts.Add(message);
                }

                if (showVehicle && !string.IsNullOrWhiteSpace(vehicleName))
                {
                    parts.Add(vehicleName);
                }

                if (showRuleName && !string.IsNullOrWhiteSpace(ruleName))
                {
                    parts.Add(ruleName);
                }

                if (showChip && !string.IsNullOrWhiteSpace(chipText))
                {
                    parts.Add(chipText);
                }

                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>NotificationRow</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the notification title, message, severity,
/// vehicle or rule — so a diagnostics line can never leak what a user saw. Thread-safe.
/// </summary>
public sealed class NotificationRowDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public NotificationRowDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=NotificationRow</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={NotificationRowRegistration.Slug}"));
    }
}

/// <summary>
/// Canonical metadata for the <c>NotificationRow</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/notifications/components/NotificationRow.tsx</c>, plus the Segoe Fluent Icons glyphs that
/// stand in for the web Lucide icons (<c>MailOpen</c>, <c>Mail</c>, <c>Archive</c>, <c>ArchiveRestore</c>,
/// <c>ChevronRight</c>). UI-free so the metadata is asserted in tests.
/// </summary>
public static class NotificationRowRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "NotificationRow";

    /// <summary>Segoe Fluent "MailOpen" glyph — the mark-read action (web Lucide <c>MailOpen</c>).</summary>
    public const string MarkReadGlyph = "\uE8C3";

    /// <summary>Segoe Fluent "Mail" glyph — the mark-unread action (web Lucide <c>Mail</c>).</summary>
    public const string MarkUnreadGlyph = "\uE715";

    /// <summary>Segoe Fluent "Archive" glyph — the archive action (web Lucide <c>Archive</c>).</summary>
    public const string ArchiveGlyph = "\uE7B8";

    /// <summary>Segoe Fluent "Undo" glyph — the restore action (web Lucide <c>ArchiveRestore</c>).</summary>
    public const string UnarchiveGlyph = "\uE7A7";

    /// <summary>Segoe Fluent "ChevronRight" glyph — the drill-through affordance (web Lucide <c>ChevronRight</c>).</summary>
    public const string DrillGlyph = "\uE76C";
}
