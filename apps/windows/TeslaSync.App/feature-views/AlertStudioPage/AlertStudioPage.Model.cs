using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The mutually-exclusive lifecycle state of the primary (alert-rules) data source on the
/// <c>AlertStudioPage</c> surface — the native mirror of the four data states the web page renders
/// (web/src/features/notifications/pages/AlertStudioPage.tsx). The web page runs the <c>useAlertRules</c>
/// query and, in precedence order, shows the loading skeletons (web <c>isLoading</c>), the failure surface
/// (web <c>error</c>), the empty state (web <c>rules.length === 0</c>) and otherwise the rules list. Per-region
/// visibility is still driven by the projected flags so each branch renders exactly as the web composes them.
/// </summary>
public enum AlertStudioState
{
    /// <summary>The rules query is in flight (web <c>isLoading</c>) — the rules panel shows skeletons.</summary>
    Loading,

    /// <summary>The rules query resolved with no rows (web <c>!isLoading &amp;&amp; rules.length === 0</c>).</summary>
    Empty,

    /// <summary>The rules query failed (web <c>error</c>) — the page surfaces the error.</summary>
    Error,

    /// <summary>The rules query produced rows (web <c>rules.length &gt; 0</c>).</summary>
    Success,
}

/// <summary>The two mutually-exclusive operand modes of the rule editor (web <c>AlertRuleKind</c>).</summary>
public enum AlertRuleKindOption
{
    /// <summary>Signal-threshold rule using signal_name / op / value (web <c>'signal'</c>).</summary>
    Signal,

    /// <summary>Computed-metric rule using metric_id / window / op / threshold (web <c>'computed_metric'</c>).</summary>
    ComputedMetric,
}

/// <summary>The editor-only tri-state of the alert-behavior choice (web <c>TriggerModeOrUnset</c>).</summary>
public enum TriggerModeOption
{
    /// <summary>The user has not chosen yet — a brand-new rule blocks Save until they do (web <c>'unset'</c>).</summary>
    Unset,

    /// <summary>Fire once until the condition resets (web <c>'once'</c>).</summary>
    Once,

    /// <summary>Re-alert while the condition stays true (web <c>'repeat'</c>).</summary>
    Repeat,
}

/// <summary>The typed-value operand kind a signal rule edits (web <c>ValueKind</c>).</summary>
public enum AlertValueKind
{
    /// <summary>No operand — the rule fires on any change (web <c>'none'</c>, op <c>changed</c>).</summary>
    None,

    /// <summary>A single numeric operand (web <c>'number'</c>).</summary>
    Number,

    /// <summary>A free-text operand (web <c>'text'</c>).</summary>
    Text,

    /// <summary>A boolean operand (web <c>'bool'</c>).</summary>
    Bool,

    /// <summary>A min/max range operand (web <c>'range'</c>, op <c>between</c>/<c>outside</c>).</summary>
    Range,
}

/// <summary>
/// One alert rule — the native mirror of the slice of the web <c>AlertRule</c> (web/src/api/types.ts) the
/// studio page reads. Parsing is null-tolerant so a partial row never throws. Pure data — no WinUI types — so
/// the projection is unit-tested without a UI host.
/// </summary>
public sealed record AlertStudioRule(
    long Id,
    string Name,
    string SignalName,
    string Op,
    string Severity,
    bool Enabled,
    string TriggerMode,
    string? SnoozedUntil,
    string? UpdatedAt)
{
    /// <summary>Parse a rules JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<AlertStudioRule> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AlertStudioRule>();
        }

        var list = new List<AlertStudioRule>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Read one rule from a JSON object, tolerating missing / null fields.</summary>
    public static AlertStudioRule FromJson(JsonElement o) => new(
        Id: JsonRead.Long(o, "id") ?? 0,
        Name: JsonRead.String(o, "name") ?? string.Empty,
        SignalName: JsonRead.String(o, "signal_name") ?? string.Empty,
        Op: JsonRead.String(o, "op") ?? "=",
        Severity: JsonRead.String(o, "severity") ?? "info",
        Enabled: JsonRead.Bool(o, "enabled") ?? false,
        TriggerMode: JsonRead.String(o, "trigger_mode") ?? "repeat",
        SnoozedUntil: JsonRead.String(o, "snoozed_until"),
        UpdatedAt: JsonRead.String(o, "updated_at"));
}

/// <summary>One notification channel chip (web <c>useNotificationChannels</c> reading: id / name / kind).</summary>
public sealed record AlertStudioChannel(long Id, string Name, string Kind)
{
    /// <summary>Parse a channels JSON array into a tolerant list, preserving order.</summary>
    public static IReadOnlyList<AlertStudioChannel> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AlertStudioChannel>();
        }

        var list = new List<AlertStudioChannel>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(new AlertStudioChannel(
                    JsonRead.Long(item, "id") ?? 0,
                    JsonRead.String(item, "name") ?? string.Empty,
                    JsonRead.String(item, "kind") ?? string.Empty));
            }
        }

        return list;
    }
}

/// <summary>One fleet vehicle option (web <c>useVehicles</c> reading: id / display_name).</summary>
public sealed record AlertStudioVehicle(long Id, string DisplayName)
{
    /// <summary>Parse a vehicles JSON array into a tolerant list, preserving order.</summary>
    public static IReadOnlyList<AlertStudioVehicle> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AlertStudioVehicle>();
        }

        var list = new List<AlertStudioVehicle>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(new AlertStudioVehicle(
                    JsonRead.Long(item, "id") ?? 0,
                    JsonRead.String(item, "display_name") ?? string.Empty));
            }
        }

        return list;
    }
}

/// <summary>One computed-metric summary (web <c>useAlertMetrics</c> reading: id / label).</summary>
public sealed record AlertStudioMetric(string Id, string Label)
{
    /// <summary>Parse a metrics JSON array into a tolerant list, preserving order.</summary>
    public static IReadOnlyList<AlertStudioMetric> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AlertStudioMetric>();
        }

        var list = new List<AlertStudioMetric>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                var id = JsonRead.String(item, "id") ?? JsonRead.String(item, "metric_id") ?? string.Empty;
                if (id.Length == 0)
                {
                    continue;
                }

                list.Add(new AlertStudioMetric(id, JsonRead.String(item, "label") ?? id));
            }
        }

        return list;
    }
}

/// <summary>Tolerant JSON readers shared by the studio parsers (mirrors the sibling AlertRules helpers).</summary>
internal static class JsonRead
{
    public static string? String(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static long? Long(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static bool? Bool(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
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
}
