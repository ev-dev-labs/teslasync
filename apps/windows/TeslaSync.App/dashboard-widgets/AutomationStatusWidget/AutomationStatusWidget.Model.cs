using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state an <see cref="AutomationStatusViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>AutomationStatusWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/AutomationStatusWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>items.length === 0</c> gate
/// (the automation list resolved with no rows → the "No automations configured" empty state).
/// </summary>
public enum AutomationStatusState
{
    /// <summary>Initial fetch with no cached rows — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or non-stale cache).</summary>
    Loaded,

    /// <summary>The request resolved with no automations — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached rows exist — render the retry affordance.</summary>
    Error,

    /// <summary>Cached rows older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached rows remain — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Tolerant JSON readers shared by <see cref="Automation"/>. Each returns <see langword="null"/> (or a
/// zero/false default) for an absent / wrong-kind property so a partial wire body never throws —
/// mirroring the web hook's defensive <c>?? 0</c> / <c>?? null</c> reads and <c>safeArray</c> select.
/// </summary>
internal static class AutomationStatusJson
{
    internal static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    internal static long GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    internal static int GetInt(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt32(out var n) => n,
            JsonValueKind.String when int.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    internal static bool GetBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(v.GetString(), out var b) => b,
            _ => false,
        };
    }
}

/// <summary>
/// One automation from <c>GET /automations</c> (web <c>useAutomations</c>, shape <c>Automation</c> in
/// web/src/api/types.ts). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant
/// so a partial row never throws. Only the fields the widget renders are projected — id, name, the
/// enabled/auto-disabled flags, the consecutive-failure count, the last success/trigger times and the
/// next scheduled fire. Timestamps are kept as raw wire strings (as the web does) and parsed on demand.
/// </summary>
public sealed record Automation(
    long Id,
    string Name,
    bool Enabled,
    bool AutoDisabled,
    int ConsecutiveFailures,
    string? LastSuccessAt,
    string? LastTriggeredAt,
    string? NextFireTime)
{
    /// <summary>The parsed last-trigger instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? LastTriggeredAtTime => TryParseTimestamp(LastTriggeredAt);

    /// <summary>The parsed next-scheduled-fire instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? NextFireTimeValue => TryParseTimestamp(NextFireTime);

    /// <summary>Project a single automation JSON object into an <see cref="Automation"/>.</summary>
    public static Automation FromJson(JsonElement obj) => new(
        Id: AutomationStatusJson.GetLong(obj, "id"),
        Name: AutomationStatusJson.GetString(obj, "name") ?? string.Empty,
        Enabled: AutomationStatusJson.GetBool(obj, "enabled"),
        AutoDisabled: AutomationStatusJson.GetBool(obj, "auto_disabled"),
        ConsecutiveFailures: AutomationStatusJson.GetInt(obj, "consecutive_failures"),
        LastSuccessAt: AutomationStatusJson.GetString(obj, "last_success_at"),
        LastTriggeredAt: AutomationStatusJson.GetString(obj, "last_triggered_at"),
        NextFireTime: AutomationStatusJson.GetString(obj, "next_fire_time"));

    private static DateTimeOffset? TryParseTimestamp(string? raw)
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

/// <summary>
/// The parsed <c>GET /automations</c> payload: the automation <see cref="Items"/>. <see cref="HasData"/>
/// distinguishes a present array body from an absent / non-array body — the web gates its empty state on
/// <c>items.length === 0</c>, so a configured-but-empty fleet renders the friendly empty surface rather
/// than a blank box.
/// </summary>
public sealed record AutomationStatusSnapshot(IReadOnlyList<Automation> Items)
{
    /// <summary>An absent-body fallback flagged as having no payload (the parse fallback for a non-array body).</summary>
    public static AutomationStatusSnapshot Empty { get; } =
        new(Array.Empty<Automation>()) { HasData = false };

    /// <summary>True when an array payload is present (web <c>data</c> truthiness). False only for <see cref="Empty"/>.</summary>
    public bool HasData { get; init; } = true;

    /// <summary>Project a <c>GET /automations</c> JSON array into a tolerant snapshot.</summary>
    public static AutomationStatusSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var list = new List<Automation>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(Automation.FromJson(item));
            }
        }

        return new AutomationStatusSnapshot(list);
    }

    /// <summary>
    /// Return a snapshot with the automation matching <paramref name="id"/> flipped to
    /// <paramref name="enabled"/> — the native analogue of the web optimistic mutation updater
    /// (<c>prev?.map((a) =&gt; (a.id === id ? { ...a, enabled } : a))</c>). Unchanged when nothing matches.
    /// </summary>
    public AutomationStatusSnapshot WithEnabled(long id, bool enabled)
    {
        if (Items.Count == 0)
        {
            return this;
        }

        var list = new List<Automation>(Items.Count);
        var changed = false;
        foreach (var a in Items)
        {
            if (a.Id == id && a.Enabled != enabled)
            {
                list.Add(a with { Enabled = enabled });
                changed = true;
            }
            else
            {
                list.Add(a);
            }
        }

        return changed ? this with { Items = list } : this;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> logic in web/src/features/dashboard/widgets/AutomationStatusWidget.tsx
/// (a single column or single row renders the active/total hero; three-plus columns add a per-row enable
/// toggle). The header (title + icon) is suppressed only at a single column, matching the web
/// <c>isCompact &amp;&amp; size.cols &lt;= 1</c> title gate.
/// </summary>
public readonly record struct AutomationStatusSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static AutomationStatusSize Default => new(2, 4);

    /// <summary>True at a single column or single row (web <c>isCompact</c>): show the active/total hero.</summary>
    public bool IsCompact => Cols <= 1 || Rows <= 1;

    /// <summary>True at three-plus columns (web <c>isWide</c>): render the per-row enable toggle.</summary>
    public bool IsWide => Cols >= 3;

    /// <summary>True when the title + icon header is shown (web hides it only at a single column).</summary>
    public bool ShowHeader => Cols > 1;
}

/// <summary>
/// Status → presentation mapping for one automation — the native port of <c>getStatusBadge</c> in
/// web/src/features/dashboard/widgets/AutomationStatusWidget.tsx. The same precedence is preserved:
/// auto-disabled (danger) beats disabled (neutral) beats failing (warning) beats a prior success (OK)
/// beats idle. Every label resolves through the i18n facade.
/// </summary>
public static class AutomationStatusBadge
{
    /// <summary>Resolve the semantic tone + localized label for <paramref name="automation"/>.</summary>
    public static (StatusKind Variant, string Label) Resolve(Automation automation, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(automation);
        ArgumentNullException.ThrowIfNull(localizer);

        if (automation.AutoDisabled)
        {
            return (StatusKind.Danger, localizer.GetString("widget.autoDisabled", "Auto-disabled"));
        }

        if (!automation.Enabled)
        {
            return (StatusKind.Neutral, localizer.GetString("widget.disabled", "Disabled"));
        }

        if (automation.ConsecutiveFailures > 0)
        {
            return (StatusKind.Warning, localizer.GetString("widget.failing", "Failing"));
        }

        if (!string.IsNullOrEmpty(automation.LastSuccessAt))
        {
            return (StatusKind.Success, localizer.GetString("widget.ok", "OK"));
        }

        return (StatusKind.Neutral, localizer.GetString("widget.idle", "Idle"));
    }
}

/// <summary>
/// One projected, display-ready automation row consumed by the WinUI full/wide views. Holds the resolved
/// status tone + label, the relative last-run and next-fire strings (with presence flags so absent times
/// collapse exactly as the web does), the current enabled flag (for the toggle), and Narrator names for
/// the row and its toggle. Pure data — no WinUI types.
/// </summary>
public sealed record AutomationStatusRow(
    long Id,
    string Name,
    bool Enabled,
    StatusKind StatusVariant,
    string StatusLabel,
    bool HasLastRun,
    string LastRunRelative,
    bool HasNextFire,
    string NextFireRelative,
    string ToggleLabel,
    string RowName);

/// <summary>
/// The fully projected, render-ready view of the automation list for one footprint — the native analogue
/// of everything the web component computes (the <c>enabled</c> / <c>failing</c> / auto-disabled counts,
/// the compact <c>{enabled}/{total}</c> hero, the summary chips and the per-row projection) before
/// returning JSX. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record AutomationStatusDisplay(
    bool HasData,
    bool IsCompact,
    bool IsWide,
    bool ShowHeader,
    bool HasItems,
    IReadOnlyList<AutomationStatusRow> Items,
    int EnabledCount,
    int TotalCount,
    int FailingCount,
    int AutoDisabledCount,
    string CompactValueText,
    string ActiveLabel,
    string FailingLabel,
    string ActiveSummaryText,
    string FailingSummaryText,
    string AutoDisabledSummaryText,
    bool HasFailing,
    bool HasAutoDisabled);

/// <summary>
/// Pure projection from a parsed <see cref="AutomationStatusSnapshot"/> to the display model — the native
/// port of the <c>CompactView</c> / <c>FullView</c> / <c>AutomationRow</c> computations in
/// web/src/features/dashboard/widgets/AutomationStatusWidget.tsx. Counts are dimensionless (no SI
/// conversion); every label resolves through the i18n facade; <c>now</c> is injected so the relative-time
/// tiers are unit-tested deterministically.
/// </summary>
public static class AutomationStatusProjection
{
    /// <summary>Em-dash fallback for a missing name / timestamp (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> at <paramref name="now"/> using the i18n facade.</summary>
    public static AutomationStatusDisplay Project(
        AutomationStatusSnapshot data,
        AutomationStatusSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        var items = data.Items;
        var enabledCount = 0;
        var failingCount = 0;
        var autoDisabledCount = 0;
        foreach (var a in items)
        {
            if (a.Enabled)
            {
                enabledCount++;
            }

            if (a.ConsecutiveFailures > 0 && a.Enabled)
            {
                failingCount++;
            }

            if (a.AutoDisabled)
            {
                autoDisabledCount++;
            }
        }

        var totalCount = items.Count;
        var activeLabel = localizer.GetString("widget.active", "Active");
        var failingLabel = localizer.GetString("widget.failing", "Failing");
        var autoDisabledLabel = localizer.GetString("widget.autoDisabled", "Auto-disabled");

        var rows = ProjectRows(items, localizer, now);

        return new AutomationStatusDisplay(
            HasData: data.HasData,
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            ShowHeader: size.ShowHeader,
            HasItems: rows.Count > 0,
            Items: rows,
            EnabledCount: enabledCount,
            TotalCount: totalCount,
            FailingCount: failingCount,
            AutoDisabledCount: autoDisabledCount,
            CompactValueText: string.Format(CultureInfo.InvariantCulture, "{0}/{1}", enabledCount, totalCount),
            ActiveLabel: activeLabel,
            FailingLabel: failingLabel,
            ActiveSummaryText: string.Format(CultureInfo.CurrentCulture, "{0} {1}", enabledCount, activeLabel),
            FailingSummaryText: string.Format(CultureInfo.CurrentCulture, "{0} {1}", failingCount, failingLabel),
            AutoDisabledSummaryText: string.Format(CultureInfo.CurrentCulture, "{0} {1}", autoDisabledCount, autoDisabledLabel),
            HasFailing: failingCount > 0,
            HasAutoDisabled: autoDisabledCount > 0);
    }

    /// <summary>
    /// Format a wire timestamp relative to <paramref name="now"/> exactly as the web
    /// <c>formatRelativeTime</c> does: the em-dash for a null/unparseable value, "Just now" under a
    /// minute, then "<c>{m}m ago</c>", "<c>{h}h ago</c>", "<c>{d}d ago</c>" — with "ago" localized.
    /// </summary>
    public static string FormatRelativeTime(DateTimeOffset? value, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (value is not { } d)
        {
            return EmDash;
        }

        var minutes = (long)Math.Floor((now - d).TotalMinutes);
        if (minutes < 1)
        {
            return localizer.GetString("widget.justNow", "Just now");
        }

        var ago = localizer.GetString("widget.ago", "ago");
        if (minutes < 60)
        {
            return string.Format(CultureInfo.CurrentCulture, "{0}m {1}", minutes, ago);
        }

        var hours = minutes / 60;
        if (hours < 24)
        {
            return string.Format(CultureInfo.CurrentCulture, "{0}h {1}", hours, ago);
        }

        var days = hours / 24;
        return string.Format(CultureInfo.CurrentCulture, "{0}d {1}", days, ago);
    }

    private static List<AutomationStatusRow> ProjectRows(
        IReadOnlyList<Automation> items,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        var toggleWord = localizer.GetString("widget.toggle", "Toggle");
        var rows = new List<AutomationStatusRow>(items.Count);
        foreach (var a in items)
        {
            var (variant, label) = AutomationStatusBadge.Resolve(a, localizer);
            var name = string.IsNullOrEmpty(a.Name) ? EmDash : a.Name;

            var hasLastRun = !string.IsNullOrEmpty(a.LastTriggeredAt);
            var lastRunRelative = hasLastRun ? FormatRelativeTime(a.LastTriggeredAtTime, localizer, now) : string.Empty;

            var hasNextFire = !string.IsNullOrEmpty(a.NextFireTime);
            var nextFireRelative = hasNextFire ? FormatRelativeTime(a.NextFireTimeValue, localizer, now) : string.Empty;

            var rowName = hasLastRun
                ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", name, label, lastRunRelative)
                : string.Format(CultureInfo.CurrentCulture, "{0}: {1}", name, label);

            rows.Add(new AutomationStatusRow(
                Id: a.Id,
                Name: name,
                Enabled: a.Enabled,
                StatusVariant: variant,
                StatusLabel: label,
                HasLastRun: hasLastRun,
                LastRunRelative: lastRunRelative,
                HasNextFire: hasNextFire,
                NextFireRelative: nextFireRelative,
                ToggleLabel: string.Format(CultureInfo.CurrentCulture, "{0} {1}", toggleWord, name),
                RowName: rowName));
        }

        return rows;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;AutomationStatusSnapshot&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure
/// so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class AutomationStatusResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<AutomationStatusSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        AutomationStatusSnapshot Parse() =>
            raw.HasValue ? AutomationStatusSnapshot.FromJson(raw.Value) : AutomationStatusSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<AutomationStatusSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<AutomationStatusSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<AutomationStatusSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<AutomationStatusSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<AutomationStatusSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<AutomationStatusSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<AutomationStatusSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
