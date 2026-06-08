using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ChargingScheduleViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ChargingScheduleWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>{hasScheduleData ? … : &lt;EmptyState&gt;}</c> gate — a successful live-signals read carrying no schedule
/// fields — the "No schedule data" surface.
/// </summary>
public enum ChargingScheduleState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying schedule data to render the schedule view for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the live signals carried no schedule fields — render the "No schedule data" surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the view plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the view plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The schedule signals the widget reads from <c>GET /signals/{vehicleID}/live</c> — the native mirror of the
/// web <c>parseScheduleSignals</c> helper (web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx). Each
/// field is the <c>.value</c> of one entry in the live <c>signals</c> map, read with the same type guards the web
/// applies: <see cref="Mode"/> / <see cref="StartTime"/> / <see cref="DepartureTime"/> keep a value only when it
/// is a JSON string (web <c>typeof === 'string'</c>); <see cref="Pending"/> is true for the boolean
/// <see langword="true"/> or the string <c>"true"</c> (web <c>pending === true || pending === 'true'</c>); and
/// <see cref="ChargeLimit"/> keeps a value only when it is a JSON number (web <c>typeof === 'number'</c>). Parsing
/// is null-tolerant so a partial / empty signals map never throws.
/// </summary>
/// <param name="Mode">Scheduled-charging mode signal (web <c>ScheduledChargingMode</c>); null when absent / non-string.</param>
/// <param name="Pending">Whether a scheduled charge is pending (web <c>ScheduledChargingPending</c>).</param>
/// <param name="StartTime">Scheduled charge start timestamp (web <c>ScheduledChargingStartTime</c>); null when absent / non-string.</param>
/// <param name="DepartureTime">Scheduled departure timestamp (web <c>ScheduledDepartureTime</c>); null when absent / non-string.</param>
/// <param name="ChargeLimit">Target charge limit percent (web <c>ChargeLimitSoc</c>); null when absent / non-number.</param>
public sealed record ScheduleReading(
    string? Mode,
    bool Pending,
    string? StartTime,
    string? DepartureTime,
    double? ChargeLimit)
{
    private const string SignalsProperty = "signals";
    private const string ValueProperty = "value";

    /// <summary>
    /// True when the live signals carried at least one schedule field worth rendering — the native analogue of the
    /// web <c>hasScheduleData = mode != null || startTime != null || chargeLimit != null</c>. Note the web quirk
    /// faithfully reproduced here: a lone <see cref="DepartureTime"/> does NOT make the surface non-empty.
    /// </summary>
    public bool HasScheduleData => Mode is not null || StartTime is not null || ChargeLimit is not null;

    /// <summary>
    /// Project a <c>GET /signals/{vehicleID}/live</c> response into the schedule slice, mirroring the web query's
    /// <c>res.signals ?? {}</c> unwrap followed by <c>parseScheduleSignals</c>. Always returns a reading (never
    /// null); an absent / empty <c>signals</c> map yields an all-null reading whose <see cref="HasScheduleData"/>
    /// is false — the native analogue of the empty body the web renders.
    /// </summary>
    public static ScheduleReading FromLiveResponse(JsonElement root)
    {
        JsonElement? signals = Signals(root);
        return new ScheduleReading(
            Mode: RawString(signals, "ScheduledChargingMode"),
            Pending: RawPending(signals, "ScheduledChargingPending"),
            StartTime: RawString(signals, "ScheduledChargingStartTime"),
            DepartureTime: RawString(signals, "ScheduledDepartureTime"),
            ChargeLimit: RawNumber(signals, "ChargeLimitSoc"));
    }

    // Web parity: const res = request<{ signals?: Record<...> }>(...); return res.signals ?? {}.
    private static JsonElement? Signals(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object &&
        root.TryGetProperty(SignalsProperty, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    // Web parity: raw(key) = signals[key]?.value ?? null.
    private static JsonElement? RawValue(JsonElement? signals, string key)
    {
        if (signals is not { } map ||
            !map.TryGetProperty(key, out var entry) ||
            entry.ValueKind != JsonValueKind.Object ||
            !entry.TryGetProperty(ValueProperty, out var value))
        {
            return null;
        }

        return value;
    }

    // Web parity: typeof value === 'string' ? value : null (an empty string stays a string).
    private static string? RawString(JsonElement? signals, string key) =>
        RawValue(signals, key) is { ValueKind: JsonValueKind.String } v ? v.GetString() : null;

    // Web parity: value === true || value === 'true'.
    private static bool RawPending(JsonElement? signals, string key)
    {
        var value = RawValue(signals, key);
        return value?.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.String => string.Equals(value.Value.GetString(), "true", StringComparison.Ordinal),
            _ => false,
        };
    }

    // Web parity: typeof value === 'number' ? value : null.
    private static double? RawNumber(JsonElement? signals, string key)
    {
        var value = RawValue(signals, key);
        return value is { ValueKind: JsonValueKind.Number } v && v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n)
            ? n
            : null;
    }
}

/// <summary>
/// The supplementary vehicle state the schedule view reads from <c>GET /vehicles/{vehicleID}/state</c> — the
/// native mirror of the <c>useVehicleState</c> slice the web component consumes for its tall detail row
/// (<c>battery_level</c>, <c>is_charging</c>). It is supplementary: a <see langword="null"/> instance (no
/// resolved state) simply hides the detail row, mirroring the web <c>isTall &amp;&amp; state &amp;&amp; …</c>
/// guard. Parsing reuses the same <c>useVehicleState</c> normalisation the other charging widgets apply.
/// </summary>
/// <param name="BatteryLevel">State-of-charge percent (0–100, unit-free; web <c>state.battery_level</c>).</param>
/// <param name="IsCharging">Whether the vehicle is actively charging (web <c>state.is_charging</c>).</param>
public sealed record VehicleScheduleState(double BatteryLevel, bool IsCharging)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the schedule detail slice, mirroring the web
    /// <c>useVehicleState</c> normalisation: prefer the canonical <c>state</c> object (the one carrying
    /// <c>vehicle_id</c>), otherwise a plain <c>state</c> object, otherwise reconstruct from
    /// <c>position.battery_level</c> + the top-level <c>is_charging</c> when a <c>vehicle</c>/<c>position</c> is
    /// present. Returns <see langword="null"/> when none of those yield a state — the detail row is then hidden.
    /// </summary>
    public static VehicleScheduleState? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (Object(root, "state") is { } state && Has(state, "vehicle_id"))
        {
            return FromStateObject(state);
        }

        var vehicle = Object(root, "vehicle");
        var position = Object(root, "position");
        if (vehicle is null && position is null)
        {
            return Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        return new VehicleScheduleState(
            BatteryLevel: position is { } p ? ReadDouble(p, "battery_level") ?? 0 : 0,
            IsCharging: ReadBool(root, "is_charging"));
    }

    private static VehicleScheduleState FromStateObject(JsonElement state) => new(
        BatteryLevel: ReadDouble(state, "battery_level") ?? 0,
        IsCharging: ReadBool(state, "is_charging"));

    private static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    private static bool Has(JsonElement obj, string name) => obj.TryGetProperty(name, out _);

    private static double? ReadDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static bool ReadBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String => bool.TryParse(v.GetString(), out var b) && b,
            _ => false,
        };
    }
}

/// <summary>
/// The combined schedule snapshot the view-model projects — the native union of the two web queries the component
/// composes: the live <see cref="Schedule"/> signals (primary, drives the body + the freshness/error chrome) plus
/// the best-effort vehicle <see cref="State"/> (supplementary, may be <see langword="null"/> → no detail row).
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargingScheduleSnapshot(ScheduleReading Schedule, VehicleScheduleState? State);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isTall</c> logic in web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct ChargingScheduleSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static ChargingScheduleSize Default => new(2, 2);

    /// <summary>True at a single 1×1 cell (web <c>isCompact = size.cols &lt;= 1 &amp;&amp; size.rows &lt;= 1</c>): the big charge-limit readout.</summary>
    public bool IsCompact => Cols <= 1 && Rows <= 1;

    /// <summary>True at two or more rows (web <c>isTall = size.rows &gt;= 2</c>): adds the Current Level / Status detail row.</summary>
    public bool IsTall => Rows >= 2;
}

/// <summary>
/// One timeline row — the native counterpart of a web <c>Timeline</c> item (a coloured leading glyph, a title, an
/// optional subtitle, and a right-aligned time/value), plus a Narrator name combining them. Pure data — no WinUI
/// types — so the timeline composition is unit-tested without a UI host.
/// </summary>
/// <param name="Glyph">The Segoe Fluent glyph for the leading icon (web lucide icon).</param>
/// <param name="Accent">The semantic accent tinting the marker (web hex colour → token status).</param>
/// <param name="Title">The localized row title.</param>
/// <param name="Subtitle">The optional localized detail line (e.g. "Pending"); null when absent.</param>
/// <param name="TimeText">The pre-formatted time-of-day or percent shown on the right.</param>
/// <param name="AutomationName">The Narrator name (title + subtitle + time).</param>
public sealed record ScheduleTimelineEntry(
    string Glyph,
    StatusKind Accent,
    string Title,
    string? Subtitle,
    string TimeText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the schedule surface for one footprint — the native analogue of
/// everything the web component computes before returning JSX (the mode label + badge variant, the
/// <c>timelineItems</c> memo, the compact charge-limit readout, and the tall detail row). Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargingScheduleDisplay(
    bool IsCompact,
    bool IsTall,
    string ModeLabel,
    StatusKind ModeStatus,
    bool Pending,
    string PendingLabel,
    IReadOnlyList<ScheduleTimelineEntry> TimelineEntries,
    bool HasTimelineEntries,
    string NoTimesText,
    string CompactLimitText,
    string LimitLabel,
    bool ShowDetailRow,
    string CurrentLevelLabel,
    string CurrentLevelText,
    string StatusLabel,
    string StatusText,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ChargingScheduleSnapshot"/> to the display model — the native port of the
/// web component's <c>modeLabel</c> / <c>modeBadgeVariant</c> helpers, its <c>timelineItems</c> memo and its
/// compact / full JSX branches in web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx. The charge limit
/// and battery percent reproduce the web's raw <c>{value}%</c> interpolation; the start / departure times
/// reproduce the web <c>useDateFormat().formatTime</c> (locale time-of-day, em dash for an absent / unparseable
/// value) via the shared <see cref="DateTimeFormatting"/> facade. Every label resolves through the i18n facade.
/// </summary>
public static class ChargingScheduleProjection
{
    /// <summary>Segoe Fluent "Calendar" glyph — the web <c>Calendar</c> icon (header + empty surfaces).</summary>
    public const string CalendarGlyph = "\uE787";

    /// <summary>Segoe Fluent "LightningBolt" glyph — the web <c>Zap</c> icon (the Start Charging row).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent "Recent" (clock) glyph — the web <c>Clock</c> icon (the Departure row).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Segoe Fluent "Battery10" (full) glyph — the web <c>BatteryFull</c> icon (the Target Limit row).</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>The em dash the shared date facade renders for an absent / unparseable time (web <c>'—'</c>).</summary>
    public const string EmDash = DateTimeFormatting.DefaultEmptyDisplay;

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static ChargingScheduleDisplay Project(
        ChargingScheduleSnapshot snapshot,
        ChargingScheduleSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var schedule = snapshot.Schedule;
        var state = snapshot.State;

        string modeLabel = ModeLabel(schedule.Mode, localizer);
        StatusKind modeStatus = ModeStatus(schedule.Mode);
        string pendingLabel = localizer.GetString("widget.chargingSchedule.pending", "Pending");
        string noTimesText = localizer.GetString("widget.chargingSchedule.noTimes", "No scheduled times set");
        string limitLabel = localizer.GetString("widget.chargingSchedule.limit", "Charge Limit");
        string currentLevelLabel = localizer.GetString("widget.chargingSchedule.currentLevel", "Current Level");
        string statusLabel = localizer.GetString("widget.chargingSchedule.status", "Status");

        var entries = BuildTimeline(schedule, localizer);

        string compactLimitText = schedule.ChargeLimit is { } limit ? FormatPercent(limit) : EmDash;

        bool showDetailRow = size.IsTall && state is not null;
        string currentLevelText = FormatPercent(state?.BatteryLevel ?? 0);
        string statusText = (state?.IsCharging ?? false)
            ? localizer.GetString("widget.charging", "Charging")
            : localizer.GetString("widget.notCharging", "Not Charging");

        string automationName = BuildAutomationName(
            modeLabel, schedule.Pending, pendingLabel, entries,
            showDetailRow, currentLevelLabel, currentLevelText, statusLabel, statusText);

        return new ChargingScheduleDisplay(
            IsCompact: size.IsCompact,
            IsTall: size.IsTall,
            ModeLabel: modeLabel,
            ModeStatus: modeStatus,
            Pending: schedule.Pending,
            PendingLabel: pendingLabel,
            TimelineEntries: entries,
            HasTimelineEntries: entries.Count > 0,
            NoTimesText: noTimesText,
            CompactLimitText: compactLimitText,
            LimitLabel: limitLabel,
            ShowDetailRow: showDetailRow,
            CurrentLevelLabel: currentLevelLabel,
            CurrentLevelText: currentLevelText,
            StatusLabel: statusLabel,
            StatusText: statusText,
            AutomationName: automationName);
    }

    /// <summary>Localized mode label (web <c>modeLabel</c>): StartAt / DepartBy / Off, else the raw mode or "Unknown".</summary>
    public static string ModeLabel(string? mode, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return mode switch
        {
            "StartAt" => localizer.GetString("widget.chargingSchedule.modeStartAt", "Start At"),
            "DepartBy" => localizer.GetString("widget.chargingSchedule.modeDepartBy", "Depart By"),
            "Off" => localizer.GetString("widget.chargingSchedule.modeOff", "Off"),
            _ => mode ?? localizer.GetString("widget.chargingSchedule.modeUnknown", "Unknown"),
        };
    }

    /// <summary>Mode badge accent (web <c>modeBadgeVariant</c>): StartAt/DepartBy → success, Off → neutral, else warning.</summary>
    public static StatusKind ModeStatus(string? mode) => mode switch
    {
        "StartAt" or "DepartBy" => StatusKind.Success,
        "Off" => StatusKind.Neutral,
        _ => StatusKind.Warning,
    };

    /// <summary>
    /// Build the timeline rows the web <c>timelineItems</c> memo derives: the Start Charging row (when a start
    /// time is set, with a "Pending" subtitle when pending), the Departure row (when a departure time is set), and
    /// the Target Limit row (when the charge limit is a number). Reproduces the web ordering and per-row colours.
    /// </summary>
    public static IReadOnlyList<ScheduleTimelineEntry> BuildTimeline(ScheduleReading schedule, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(schedule);
        ArgumentNullException.ThrowIfNull(localizer);

        var entries = new List<ScheduleTimelineEntry>(3);

        // Web parity: if (schedule.startTime) — an empty string is falsy, so only a non-empty string adds the row.
        if (!string.IsNullOrEmpty(schedule.StartTime))
        {
            string title = localizer.GetString("widget.chargingSchedule.startCharging", "Start Charging");
            string? subtitle = schedule.Pending ? localizer.GetString("widget.chargingSchedule.pending", "Pending") : null;
            string time = FormatScheduleTime(schedule.StartTime);
            entries.Add(new ScheduleTimelineEntry(
                ZapGlyph, StatusKind.Success, title, subtitle, time,
                AutomationName: Join(title, subtitle, time)));
        }

        if (!string.IsNullOrEmpty(schedule.DepartureTime))
        {
            string title = localizer.GetString("widget.chargingSchedule.departure", "Departure");
            string time = FormatScheduleTime(schedule.DepartureTime);
            entries.Add(new ScheduleTimelineEntry(
                ClockGlyph, StatusKind.Info, title, null, time,
                AutomationName: Join(title, null, time)));
        }

        // Web parity: chargeLimit = schedule.chargeLimit ?? (state.battery_level != null ? undefined : null);
        // both undefined and null fail the `!= null` guard, so the row shows iff schedule.chargeLimit is a number.
        if (schedule.ChargeLimit is { } limit)
        {
            string title = localizer.GetString("widget.chargingSchedule.targetLimit", "Target Limit");
            string time = FormatPercent(limit);
            entries.Add(new ScheduleTimelineEntry(
                BatteryGlyph, StatusKind.Warning, title, null, time,
                AutomationName: Join(title, null, time)));
        }

        return entries;
    }

    /// <summary>Format a percent the way the web interpolates <c>{value}%</c> (raw number + "%").</summary>
    public static string FormatPercent(double value)
    {
        double safe = double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
        return safe.ToString(CultureInfo.InvariantCulture) + "%";
    }

    /// <summary>
    /// Format a schedule timestamp the way the web <c>useDateFormat().formatTime</c> does — a locale time-of-day
    /// ("hh:mm tt"), or the em dash for an absent / unparseable value (web <c>new Date(iso)</c> → Invalid Date →
    /// <c>'—'</c>). Delegates to the shared <see cref="DateTimeFormatting"/> facade for the em-dash fallback and
    /// the time variant.
    /// </summary>
    public static string FormatScheduleTime(string? value) =>
        DateTimeFormatting.Format(ParseTimestamp(value), DateTimeVariant.Time, DateTimeOffset.Now);

    private static DateTimeOffset? ParseTimestamp(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dto)
            ? dto
            : null;
    }

    private static string Join(string title, string? subtitle, string time) =>
        string.IsNullOrEmpty(subtitle) ? $"{title}, {time}" : $"{title}, {subtitle}, {time}";

    private static string BuildAutomationName(
        string modeLabel,
        bool pending,
        string pendingLabel,
        IReadOnlyList<ScheduleTimelineEntry> entries,
        bool showDetailRow,
        string currentLevelLabel,
        string currentLevelText,
        string statusLabel,
        string statusText)
    {
        var parts = new List<string> { modeLabel };
        if (pending)
        {
            parts.Add(pendingLabel);
        }

        foreach (var entry in entries)
        {
            parts.Add(entry.AutomationName);
        }

        if (showDetailRow)
        {
            parts.Add($"{currentLevelLabel} {currentLevelText}");
            parts.Add($"{statusLabel} {statusText}");
        }

        return string.Join(", ", parts);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> live-signals emissions onto parsed
/// <c>RepositoryResult&lt;ChargingScheduleSnapshot&gt;</c>, attaching the best-effort <paramref name="state"/> to
/// every content-bearing emission and preserving every freshness flag (cached / refreshing / stale / offline). A
/// successful emission whose signals carry no schedule fields collapses to <see cref="RepositoryResult{T}.Empty"/>
/// — the native analogue of the web <c>{hasScheduleData ? … : empty}</c> gate. Kept pure so the
/// parse-combine-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ChargingScheduleResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s signals payload (when present + schedule-bearing), attach <paramref name="state"/>, and preserve the status.</summary>
    public static RepositoryResult<ChargingScheduleSnapshot> Map(
        RepositoryResult<JsonElement> raw,
        VehicleScheduleState? state)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ChargingScheduleSnapshot? Combine()
        {
            if (!raw.HasValue)
            {
                return null;
            }

            var schedule = ScheduleReading.FromLiveResponse(raw.Value);
            return schedule.HasScheduleData ? new ChargingScheduleSnapshot(schedule, state) : null;
        }

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ChargingScheduleSnapshot>.Loading(),
            LoadStatus.Cached => Combine() is { } cached
                ? RepositoryResult<ChargingScheduleSnapshot>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ChargingScheduleSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Combine() is { } refreshing
                ? RepositoryResult<ChargingScheduleSnapshot>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ChargingScheduleSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Combine() is { } loaded
                ? RepositoryResult<ChargingScheduleSnapshot>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<ChargingScheduleSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<ChargingScheduleSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Combine() is { } offline
                ? RepositoryResult<ChargingScheduleSnapshot>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<ChargingScheduleSnapshot>.Empty(raw.FetchedAt),
            _ => RepositoryResult<ChargingScheduleSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
