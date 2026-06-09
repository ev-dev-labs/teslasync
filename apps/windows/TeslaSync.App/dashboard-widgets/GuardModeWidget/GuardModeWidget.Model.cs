using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="GuardModeViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>GuardModeWidget</c>
/// renders (web/src/features/dashboard/widgets/GuardModeWidget.tsx via <c>WidgetShell</c>). Every
/// branch maps onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>{config ? … : &lt;EmptyState&gt;}</c> gate — the "No guard data" surface shown when the guard
/// configuration is absent; the status card + event feed render whenever a configuration is known.
/// </summary>
public enum GuardModeState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A guard configuration resolved and a fresh (or non-stale cache) surface is rendered.</summary>
    Loaded,

    /// <summary>No guard configuration resolved — render the "No guard data" empty surface (web <c>!config</c>).</summary>
    Empty,

    /// <summary>The configuration read failed hard with nothing to show — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the surface plus a stale chip.</summary>
    Stale,

    /// <summary>A read failed but the surface is still renderable — render it plus an offline/error chip.</summary>
    Offline,
}

/// <summary>
/// The guard configuration from <c>GET /vehicles/{vehicleID}/guard</c> (web <c>useGuardConfig</c>,
/// shape <c>GuardConfig</c> in web/src/api/hooks/useGuard.ts). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial body never throws. A non-object body
/// resolves to <see langword="null"/> — the same truthiness gate the web component applies to
/// <c>config</c> before choosing the status card over the "No guard data" empty state.
/// </summary>
/// <param name="VehicleId">The owning vehicle id (web <c>vehicle_id</c>).</param>
/// <param name="Enabled">Whether guard mode is armed (web <c>enabled</c>).</param>
/// <param name="Sensitivity">The sensitivity tier (<c>low</c>/<c>medium</c>/<c>high</c>), or null.</param>
/// <param name="AutoPanic">Whether auto-panic is enabled (web <c>auto_panic</c>).</param>
/// <param name="HomeGeofenceId">The home geofence id used to suppress movement alerts, or null.</param>
public sealed record GuardModeConfig(
    long VehicleId,
    bool Enabled,
    string? Sensitivity,
    bool AutoPanic,
    long? HomeGeofenceId)
{
    /// <summary>Project a guard-config JSON body into a <see cref="GuardModeConfig"/>, or null when not an object.</summary>
    public static GuardModeConfig? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new GuardModeConfig(
            VehicleId: GuardModeJson.GetLong(element, "vehicle_id") ?? 0,
            Enabled: GuardModeJson.GetBool(element, "enabled") ?? false,
            Sensitivity: GuardModeJson.GetString(element, "sensitivity"),
            AutoPanic: GuardModeJson.GetBool(element, "auto_panic") ?? false,
            HomeGeofenceId: GuardModeJson.GetLong(element, "home_geofence_id"));
    }
}

/// <summary>
/// One guard event row sourced from <c>security_events</c> via <c>GET /vehicles/{vehicleID}/guard/events</c>
/// (web <c>useGuardEvents</c>, shape <c>GuardEvent</c> in web/src/api/hooks/useGuard.ts). The endpoint
/// returns an envelope <c>{ vehicle_id, events: [...] }</c>; rows are extracted from <c>events</c> exactly
/// like the web hook's <c>safeArray(data?.events)</c> select. <c>event_type</c> is a free-form string, so
/// the UI uses lookup-with-fallback for labels/icons. Acknowledgement is DERIVED from
/// <see cref="AcknowledgedAt"/> being set (the backend emits no separate boolean).
/// </summary>
/// <param name="Id">The event id.</param>
/// <param name="VehicleId">The owning vehicle id.</param>
/// <param name="Ts">The raw ISO event timestamp (parsed on demand by <see cref="Timestamp"/>).</param>
/// <param name="EventType">The free-form event type key (web <c>event_type</c>).</param>
/// <param name="FromState">The prior state, or null.</param>
/// <param name="ToState">The new state, or null.</param>
/// <param name="AcknowledgedAt">The raw ISO acknowledgement timestamp, or null when unacknowledged.</param>
/// <param name="AcknowledgedBy">Who acknowledged the event, or null.</param>
public sealed record GuardModeEvent(
    long Id,
    long VehicleId,
    string? Ts,
    string EventType,
    string? FromState,
    string? ToState,
    string? AcknowledgedAt,
    string? AcknowledgedBy)
{
    /// <summary>True iff <see cref="AcknowledgedAt"/> is set (web <c>isGuardEventAcknowledged</c>).</summary>
    public bool IsAcknowledged => !string.IsNullOrEmpty(AcknowledgedAt);

    /// <summary>The parsed event instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? Timestamp => GuardModeJson.TryParseTimestamp(Ts);

    /// <summary>
    /// Extract the guard events from the <c>{ vehicle_id, events: [...] }</c> envelope, mirroring the
    /// web hook's <c>safeArray(data?.events)</c>: only an object's <c>events</c> array yields rows, so a
    /// bare array or a missing field resolves to an empty list rather than throwing.
    /// </summary>
    public static IReadOnlyList<GuardModeEvent> ParseEnvelope(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty("events", out var events) ||
            events.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<GuardModeEvent>();
        }

        var list = new List<GuardModeEvent>(events.GetArrayLength());
        foreach (var item in events.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single guard-event JSON object into a <see cref="GuardModeEvent"/>.</summary>
    public static GuardModeEvent FromJson(JsonElement obj) => new(
        Id: GuardModeJson.GetLong(obj, "id") ?? 0,
        VehicleId: GuardModeJson.GetLong(obj, "vehicle_id") ?? 0,
        Ts: GuardModeJson.GetString(obj, "ts"),
        EventType: GuardModeJson.GetString(obj, "event_type") ?? string.Empty,
        FromState: GuardModeJson.GetString(obj, "from_state"),
        ToState: GuardModeJson.GetString(obj, "to_state"),
        AcknowledgedAt: GuardModeJson.GetString(obj, "acknowledged_at"),
        AcknowledgedBy: GuardModeJson.GetString(obj, "acknowledged_by"));
}

/// <summary>
/// The combined guard snapshot folded from the two reads — the configuration (the surface gate) and the
/// event rows (the feed). Mirrors the web component's <c>config</c> + <c>events</c> hook pair. A null
/// <see cref="Config"/> is the "No guard data" gate; <see cref="Events"/> is always a (possibly empty)
/// list so the feed renders its own "No guard events" empty row rather than a hidden region.
/// </summary>
/// <param name="Config">The guard configuration, or null when absent (the empty gate).</param>
/// <param name="Events">The guard event rows (possibly empty).</param>
public sealed record GuardModeSnapshot(GuardModeConfig? Config, IReadOnlyList<GuardModeEvent> Events);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> branch plus the <c>maxItems</c> feed cap in
/// web/src/features/dashboard/widgets/GuardModeWidget.tsx.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct GuardModeSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static GuardModeSize Default => new(2, 4);

    /// <summary>True at one column or fewer (web <c>size.cols &lt;= 1</c>): render the compact status row.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>Maximum feed rows rendered: compact→3, otherwise 5 (web <c>maxItems</c>).</summary>
    public int MaxItems => IsCompact ? 3 : 5;
}

/// <summary>
/// One projected, display-ready guard event consumed by the WinUI view. Holds the resolved severity
/// presentation (glyph + token brush key), the localized title/subtitle, the relative time string, and a
/// Narrator automation name. The native port of the web <c>mapEventToFeedItem</c> + <c>WidgetEventFeed</c>
/// row. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">The source event id.</param>
/// <param name="Glyph">The Segoe Fluent severity glyph.</param>
/// <param name="Severity">The canonical severity level.</param>
/// <param name="AccentBrushKey">Token brush key for the icon / accent.</param>
/// <param name="Title">The localized event label.</param>
/// <param name="Subtitle">The localized acknowledged / unacknowledged line.</param>
/// <param name="RelativeTime">The relative-time string (e.g. "5m ago").</param>
/// <param name="Timestamp">The parsed event instant, if any.</param>
/// <param name="AutomationName">The Narrator name combining label, acknowledgement and time.</param>
public sealed record GuardModeFeedItem(
    long Id,
    string Glyph,
    SeverityLevel Severity,
    string AccentBrushKey,
    string Title,
    string Subtitle,
    string RelativeTime,
    DateTimeOffset? Timestamp,
    string AutomationName);

/// <summary>
/// The projected, render-ready guard model the WinUI view binds to — the native mirror of the web
/// component's derived values (<c>enabled</c>, <c>sensitivity</c>, <c>autoPanic</c>, <c>eventCount</c>)
/// plus the composed status card copy and the capped, newest-first event feed. Every string is localized
/// in the projection so the view is a thin renderer.
/// </summary>
/// <param name="Enabled">Whether guard mode is armed.</param>
/// <param name="IsCompact">True when the compact (1×2) status row should render instead of the full panel.</param>
/// <param name="StatusLabel">The localized "Armed" / "Disarmed" label.</param>
/// <param name="StatusBadgeLabel">The localized "ON" / "OFF" badge label.</param>
/// <param name="SubtitleLine">The localized "Sensitivity: x · Auto-panic" status subtitle.</param>
/// <param name="Sensitivity">The sensitivity value with the em-dash fallback applied.</param>
/// <param name="AutoPanic">Whether auto-panic is enabled.</param>
/// <param name="EventCount">The total guard event count (uncapped).</param>
/// <param name="EventCountLabel">The localized "{n} events" badge label.</param>
/// <param name="StatusAutomationName">The Narrator name for the status card.</param>
/// <param name="FeedItems">The newest-first, capped event feed rows.</param>
public sealed record GuardModeDisplay(
    bool Enabled,
    bool IsCompact,
    string StatusLabel,
    string StatusBadgeLabel,
    string SubtitleLine,
    string Sensitivity,
    bool AutoPanic,
    int EventCount,
    string EventCountLabel,
    string StatusAutomationName,
    IReadOnlyList<GuardModeFeedItem> FeedItems)
{
    /// <summary>True when the event-count badge should read as a warning (web <c>eventCount &gt; 0</c>).</summary>
    public bool HasEvents => EventCount > 0;
}

/// <summary>
/// Pure projection from a combined snapshot to the display model — the native port of the web component's
/// derived values plus the <c>mapEventToFeedItem</c> mapping and <c>WidgetEventFeed</c>'s newest-first sort
/// and <c>maxItems</c> slice. <c>now</c> is injected so the relative-time tiers are unit-tested
/// deterministically.
/// </summary>
public static class GuardModeProjection
{
    /// <summary>The Segoe Fluent shield glyph used for the header, status icon and empty states.</summary>
    public const string ShieldGlyph = "\uE72E";

    private const string EmDash = "\u2014";

    // Event type → severity + fallback label. A 1:1 port of EVENT_TYPE_MAP in
    // web/src/features/dashboard/widgets/GuardModeWidget.tsx: the web hex colours map onto the canonical
    // severity tokens (so theming flows through W1) while the label is the i18n fallback. Unknown types
    // fall back to Info + the raw event_type, mirroring the web lookup-with-fallback.
    private static readonly Dictionary<string, GuardEventVisual> EventVisuals =
        new(StringComparer.Ordinal)
        {
            ["vehicle_moved"] = new(SeverityLevel.Warn, "Vehicle Moved"),
            ["unauthorized_unlock"] = new(SeverityLevel.Critical, "Unauthorized Unlock"),
            ["unauthorized_drive"] = new(SeverityLevel.Critical, "Unauthorized Drive"),
            ["sentry_triggered"] = new(SeverityLevel.Warn, "Sentry Triggered"),
            ["manual_panic"] = new(SeverityLevel.Critical, "Panic Alert"),
            ["test_alert"] = new(SeverityLevel.Info, "Test Alert"),
            ["locked"] = new(SeverityLevel.Info, "Lock State Changed"),
            ["sentry_mode"] = new(SeverityLevel.Warn, "Sentry Mode"),
            ["valet_mode_enabled"] = new(SeverityLevel.Info, "Valet Mode"),
        };

    /// <summary>Project the snapshot's configuration + events into the localized, capped display model.</summary>
    public static GuardModeDisplay Project(
        GuardModeSnapshot snapshot,
        GuardModeSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var config = snapshot.Config;
        bool enabled = config?.Enabled ?? false;
        string sensitivity = string.IsNullOrEmpty(config?.Sensitivity) ? EmDash : config!.Sensitivity!;
        bool autoPanic = config?.AutoPanic ?? false;
        var events = snapshot.Events ?? Array.Empty<GuardModeEvent>();
        int eventCount = events.Count;

        string statusLabel = enabled
            ? localizer.GetString("widget.guardArmed", "Armed")
            : localizer.GetString("widget.guardDisarmed", "Disarmed");
        string statusBadge = enabled
            ? localizer.GetString("widget.guardOn", "ON")
            : localizer.GetString("widget.guardOff", "OFF");

        string sensitivityLabel = localizer.GetString("widget.guardSensitivity", "Sensitivity");
        string subtitle = autoPanic
            ? string.Format(
                CultureInfo.CurrentCulture,
                "{0}: {1} \u00b7 {2}",
                sensitivityLabel,
                sensitivity,
                localizer.GetString("widget.guardAutoPanic", "Auto-panic"))
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}", sensitivityLabel, sensitivity);

        string eventCountLabel = string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            eventCount.ToString("N0", CultureInfo.CurrentCulture),
            localizer.GetString("widget.guardEvents", "events"));

        var feed = events
            .OrderByDescending(e => e.Timestamp ?? DateTimeOffset.MinValue)
            .Take(size.MaxItems)
            .Select(e => MapFeedItem(e, localizer, now))
            .ToList();

        string statusAutomation = string.Format(CultureInfo.CurrentCulture, "{0}. {1}", statusLabel, subtitle);

        return new GuardModeDisplay(
            Enabled: enabled,
            IsCompact: size.IsCompact,
            StatusLabel: statusLabel,
            StatusBadgeLabel: statusBadge,
            SubtitleLine: subtitle,
            Sensitivity: sensitivity,
            AutoPanic: autoPanic,
            EventCount: eventCount,
            EventCountLabel: eventCountLabel,
            StatusAutomationName: statusAutomation,
            FeedItems: feed);
    }

    /// <summary>Map a single guard event into its localized, severity-resolved feed row (web <c>mapEventToFeedItem</c>).</summary>
    public static GuardModeFeedItem MapFeedItem(GuardModeEvent ev, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(ev);
        ArgumentNullException.ThrowIfNull(localizer);

        var visual = EventVisuals.TryGetValue(ev.EventType, out var mapped)
            ? mapped
            : new GuardEventVisual(SeverityLevel.Info, string.IsNullOrEmpty(ev.EventType) ? EmDash : ev.EventType);

        var tokens = SeverityLevels.Tokens(visual.Severity);
        string title = localizer.GetString($"widget.guardEvent.{ev.EventType}", visual.Label);
        string subtitle = ev.IsAcknowledged
            ? localizer.GetString("widget.guardAcknowledged", "Acknowledged")
            : localizer.GetString("widget.guardUnacknowledged", "Unacknowledged");
        string relative = DateTimeFormatting.Format(ev.Timestamp, DateTimeVariant.Relative, now);
        string automation = string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", title, subtitle, relative);

        return new GuardModeFeedItem(
            Id: ev.Id,
            Glyph: tokens.IconGlyph,
            Severity: visual.Severity,
            AccentBrushKey: tokens.AccentBrushKey,
            Title: title,
            Subtitle: subtitle,
            RelativeTime: relative,
            Timestamp: ev.Timestamp,
            AutomationName: automation);
    }

    private readonly record struct GuardEventVisual(SeverityLevel Severity, string Label);
}

/// <summary>
/// Combines the two cache-then-network reads (guard configuration + guard events) into a single
/// <see cref="RepositoryResult{T}"/> over a merged <see cref="GuardModeSnapshot"/>, preserving the
/// freshness contract. The configuration is the surface gate (web <c>config ? … : &lt;EmptyState&gt;</c>):
/// when it is absent the surface collapses to <see cref="RepositoryResult{T}.Empty"/> ("No guard data"),
/// or — when the configuration read failed hard with nothing cached — to a retry surface. When a
/// configuration is present the surface always renders; the read statuses only decide whether the
/// freshness chip reads fresh / refreshing / stale / offline. The loading gate is
/// <c>configLoading || eventsLoading</c> (web parity). Kept pure so the combine contract is unit-tested
/// without a network or cache.
/// </summary>
public static class GuardModeResultMapper
{
    /// <summary>
    /// Fold the configuration and events emissions into one combined snapshot result. A null side models
    /// its read still loading (the channel has not produced its first emission yet), which — like a
    /// <see cref="LoadStatus.Loading"/> status — keeps the surface in <see cref="LoadStatus.Loading"/>.
    /// </summary>
    public static RepositoryResult<GuardModeSnapshot> Combine(
        RepositoryResult<JsonElement>? config,
        RepositoryResult<JsonElement>? events)
    {
        // Web parity: isLoading = configLoading || eventsLoading — stay loading until BOTH sides resolve.
        if (IsLoadingSide(config) || IsLoadingSide(events))
        {
            return RepositoryResult<GuardModeSnapshot>.Loading();
        }

        var cfg = config!.Value is { } configBody ? GuardModeConfig.FromJson(configBody) : null;
        var evs = events!.Value is { } eventsBody
            ? GuardModeEvent.ParseEnvelope(eventsBody)
            : Array.Empty<GuardModeEvent>();
        var snapshot = new GuardModeSnapshot(cfg, evs);

        DateTimeOffset? updatedAt = Latest(config.FetchedAt, events.FetchedAt);
        RepositoryError? error = config.Error ?? events.Error;

        if (cfg is null)
        {
            // Web parity: with no guard configuration the widget shows the "No guard data" empty surface.
            // Native: when the configuration read hard-failed with nothing cached, surface the retry
            // affordance instead so the failure is recoverable (the state matrix's Error branch).
            return config.Status == LoadStatus.Error
                ? RepositoryResult<GuardModeSnapshot>.Failure(
                    error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load guard mode"))
                : RepositoryResult<GuardModeSnapshot>.Empty(updatedAt);
        }

        bool offline = config.Status == LoadStatus.Offline || events.Status == LoadStatus.Offline;
        bool errored = config.Status == LoadStatus.Error || events.Status == LoadStatus.Error;
        bool stale = config.IsStale || events.IsStale;
        bool refreshing = config.Status == LoadStatus.Refreshing || events.Status == LoadStatus.Refreshing;

        if (offline || errored)
        {
            return RepositoryResult<GuardModeSnapshot>.OfflineCached(
                snapshot,
                updatedAt ?? DateTimeOffset.UtcNow,
                error ?? new RepositoryError(RepositoryErrorKind.Network, "A guard read is unavailable"));
        }

        if (stale)
        {
            return RepositoryResult<GuardModeSnapshot>.Cached(snapshot, updatedAt ?? DateTimeOffset.UtcNow, stale: true);
        }

        if (refreshing)
        {
            return RepositoryResult<GuardModeSnapshot>.Refreshing(snapshot, updatedAt ?? DateTimeOffset.UtcNow, stale: false);
        }

        return RepositoryResult<GuardModeSnapshot>.Loaded(snapshot, updatedAt ?? DateTimeOffset.UtcNow);
    }

    private static bool IsLoadingSide(RepositoryResult<JsonElement>? side) =>
        side is null || side.Status == LoadStatus.Loading;

    private static DateTimeOffset? Latest(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (a is { } av && b is { } bv)
        {
            return av >= bv ? av : bv;
        }

        return a ?? b;
    }
}

/// <summary>
/// Null-tolerant accessors for reading the guard wire shapes out of a <see cref="JsonElement"/>. Shared
/// by <see cref="GuardModeConfig"/> and <see cref="GuardModeEvent"/> so the snake_case projection is
/// expressed once (DRY) and a partial / mistyped field never throws.
/// </summary>
internal static class GuardModeJson
{
    /// <summary>Read a string property, or null when absent / not a string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read an integer property (number or numeric string), or null when absent / unparseable.</summary>
    public static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Read a boolean property, or null when absent / not a boolean.</summary>
    public static bool? GetBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    /// <summary>Parse a round-trip ISO timestamp, or null when absent / unparseable.</summary>
    public static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}
