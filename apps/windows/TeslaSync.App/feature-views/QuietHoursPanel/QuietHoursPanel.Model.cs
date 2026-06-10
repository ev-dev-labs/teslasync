using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive freshness state the <see cref="QuietHoursPanelViewModel"/> exposes — the native union
/// of the loading / loaded / empty / stale / offline / error branches the P2 feature-view contract mandates.
/// The web source (web/src/features/settings/components/QuietHoursPanel.tsx) reads its windows through the
/// TanStack query <c>useQuietHours()</c>; the native surface owns the same cache-then-network read, so this state
/// is driven by that read while the create/edit form (local draft) always renders inside the resolved surface.
/// </summary>
public enum QuietHoursState
{
    /// <summary>The windows read is in flight with no cached value yet — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh windows snapshot arrived — render the list.</summary>
    Loaded,

    /// <summary>The read resolved with no windows — render the friendly empty state.</summary>
    Empty,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,

    /// <summary>The read failed with no cached snapshot — render the retriable error surface.</summary>
    Error,
}

/// <summary>
/// A notification severity that can bypass a quiet-hours window — the native, strongly-typed mirror of the web
/// <c>SEVERITY_CHOICES</c> union (web/src/features/settings/components/QuietHoursPanel.tsx). Declaration order
/// matches the web array so the severity chips render in the same sequence.
/// </summary>
public enum QuietHoursSeverity
{
    /// <summary>Critical alerts (web <c>'critical'</c>).</summary>
    Critical,

    /// <summary>Warning alerts (web <c>'warn'</c>).</summary>
    Warn,

    /// <summary>Informational alerts (web <c>'info'</c>).</summary>
    Info,
}

/// <summary>
/// The canonical catalog of bypass severities — the native port of the web <c>SEVERITY_CHOICES</c> list, its
/// snake/lower wire values, its <c>quietHours.severity.{value}</c> i18n keys and the web English fallbacks. Pure
/// data so the order, wire keys and labels are unit-tested without a UI host.
/// </summary>
public static class QuietHoursSeverityCatalog
{
    private static readonly QuietHoursSeverity[] OrderedSeverities =
    {
        QuietHoursSeverity.Critical,
        QuietHoursSeverity.Warn,
        QuietHoursSeverity.Info,
    };

    /// <summary>The severities in web declaration order (web <c>SEVERITY_CHOICES</c>).</summary>
    public static IReadOnlyList<QuietHoursSeverity> Ordered => OrderedSeverities;

    /// <summary>The stable lower-case wire value for a severity (web union member, e.g. <c>critical</c>).</summary>
    public static string WireValue(QuietHoursSeverity severity) => severity switch
    {
        QuietHoursSeverity.Critical => "critical",
        QuietHoursSeverity.Warn => "warn",
        _ => "info",
    };

    /// <summary>The i18n key for a severity's label (web <c>quietHours.severity.{value}</c>).</summary>
    public static string I18nKey(QuietHoursSeverity severity) =>
        "quietHours.severity." + WireValue(severity);

    /// <summary>The English fallback for a severity label (web <c>SEVERITY_CHOICES.fallback</c>).</summary>
    public static string Fallback(QuietHoursSeverity severity) => severity switch
    {
        QuietHoursSeverity.Critical => "Critical",
        QuietHoursSeverity.Warn => "Warning",
        _ => "Info",
    };

    /// <summary>Resolves a wire value back to its strongly-typed severity, defaulting to <see cref="QuietHoursSeverity.Info"/>.</summary>
    /// <param name="wire">The lower-case severity wire value.</param>
    public static QuietHoursSeverity FromWire(string wire) => wire switch
    {
        "critical" => QuietHoursSeverity.Critical,
        "warn" => QuietHoursSeverity.Warn,
        _ => QuietHoursSeverity.Info,
    };
}

/// <summary>
/// A weekday in the quiet-hours weekday bitmask — the native port of the web <c>WEEKDAYS</c> table
/// (web/src/features/settings/components/QuietHoursPanel.tsx). The <see cref="Bit"/> positions match the server
/// <c>models.QuietHoursWeekday*</c> constants (Sun=1&lt;&lt;0 .. Sat=1&lt;&lt;6) and the declaration order matches
/// JavaScript's <c>Date#getDay()</c>.
/// </summary>
/// <param name="Bit">The single-bit mask value for this weekday.</param>
/// <param name="I18nKey">The i18n key for this weekday's short label.</param>
/// <param name="Fallback">The English fallback for this weekday's short label.</param>
public sealed record QuietHoursWeekday(int Bit, string I18nKey, string Fallback);

/// <summary>
/// The canonical weekday catalog — the native port of the web <c>WEEKDAYS</c> constant and its
/// <c>quietHours.weekday.{day}</c> i18n keys. Pure data so the order, bit positions and labels are unit-tested
/// without a UI host.
/// </summary>
public static class QuietHoursWeekdayCatalog
{
    /// <summary>The bitmask value for "every day" (web <c>ALL_WEEKDAYS</c>, Sun..Sat).</summary>
    public const int AllWeekdays = 127;

    private static readonly QuietHoursWeekday[] OrderedDays =
    {
        new(1 << 0, "quietHours.weekday.sun", "Sun"),
        new(1 << 1, "quietHours.weekday.mon", "Mon"),
        new(1 << 2, "quietHours.weekday.tue", "Tue"),
        new(1 << 3, "quietHours.weekday.wed", "Wed"),
        new(1 << 4, "quietHours.weekday.thu", "Thu"),
        new(1 << 5, "quietHours.weekday.fri", "Fri"),
        new(1 << 6, "quietHours.weekday.sat", "Sat"),
    };

    /// <summary>The weekdays in web declaration order (Sun..Sat).</summary>
    public static IReadOnlyList<QuietHoursWeekday> Ordered => OrderedDays;

    /// <summary>True when <paramref name="bit"/> is set in <paramref name="weekdays"/>.</summary>
    /// <param name="weekdays">The weekday bitmask.</param>
    /// <param name="bit">The single weekday bit to test.</param>
    public static bool IsOn(int weekdays, int bit) => (weekdays & bit) != 0;
}

/// <summary>
/// A persisted quiet-hours window — the native mirror of the web <c>QuietHoursWindow</c> type (web/src/api/types.ts)
/// served by <c>GET /notifications/quiet-hours</c>. Times are local-clock <c>HH:MM</c> strings evaluated against
/// <see cref="Timezone"/> (an IANA name); <see cref="Weekdays"/> is the 7-bit Sun=1..Sat=64 mask and
/// <see cref="BypassSeverities"/> is the allow-list that escapes the gate.
/// </summary>
/// <param name="Id">The server-assigned window id.</param>
/// <param name="UserId">The owning user's subject (server-populated; never edited client-side).</param>
/// <param name="Enabled">Whether the window is currently active.</param>
/// <param name="StartLocal">The local-clock start time as <c>HH:MM</c>.</param>
/// <param name="EndLocal">The local-clock end time as <c>HH:MM</c>.</param>
/// <param name="Timezone">The IANA timezone the window is evaluated in.</param>
/// <param name="Weekdays">The 7-bit weekday mask (Sun=1..Sat=64).</param>
/// <param name="BypassSeverities">The severities that bypass the window.</param>
public sealed record QuietHoursWindow(
    long Id,
    string UserId,
    bool Enabled,
    string StartLocal,
    string EndLocal,
    string Timezone,
    int Weekdays,
    IReadOnlyList<string> BypassSeverities)
{
    /// <summary>"23:00 → 07:00 (UTC)" — the web <c>summarizeWindow</c> label.</summary>
    public string Summary => $"{StartLocal} \u2192 {EndLocal} ({Timezone})";

    /// <summary>
    /// Parse the <c>{ windows: [...] }</c> envelope from <c>GET /notifications/quiet-hours</c> into a list of
    /// windows — the native port of the web <c>safeArray(r?.windows)</c>. A null / non-object body or a missing /
    /// non-array <c>windows</c> field yields an empty list; malformed rows are skipped rather than thrown.
    /// </summary>
    /// <param name="response">The raw response object from the API.</param>
    public static IReadOnlyList<QuietHoursWindow> ListFromResponse(JsonElement response)
    {
        if (response.ValueKind != JsonValueKind.Object
            || !response.TryGetProperty("windows", out var windows)
            || windows.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<QuietHoursWindow>();
        }

        var list = new List<QuietHoursWindow>(windows.GetArrayLength());
        foreach (var element in windows.EnumerateArray())
        {
            if (TryParse(element, out var window))
            {
                list.Add(window);
            }
        }

        return list;
    }

    private static bool TryParse(JsonElement element, out QuietHoursWindow window)
    {
        window = null!;
        if (element.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        window = new QuietHoursWindow(
            ReadInt64(element, "id"),
            ReadString(element, "user_id"),
            ReadBool(element, "enabled"),
            ReadString(element, "start_local"),
            ReadString(element, "end_local"),
            ReadString(element, "timezone"),
            (int)ReadInt64(element, "weekdays"),
            ReadStringArray(element, "bypass_severities"));
        return true;
    }

    private static string ReadString(JsonElement element, string field) =>
        element.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : string.Empty;

    private static bool ReadBool(JsonElement element, string field) =>
        element.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.True;

    private static long ReadInt64(JsonElement element, string field) =>
        element.TryGetProperty(field, out var value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetInt64(out var number)
            ? number
            : 0;

    private static IReadOnlyList<string> ReadStringArray(JsonElement element, string field)
    {
        if (!element.TryGetProperty(field, out var value) || value.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var list = new List<string>(value.GetArrayLength());
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { } str)
            {
                list.Add(str);
            }
        }

        return list;
    }
}

/// <summary>
/// A mutable draft of a quiet-hours window backing the create/edit form — the native port of the web
/// <c>DraftWindow</c> (web/src/features/settings/components/QuietHoursPanel.tsx). <see cref="Id"/> is null for a
/// new window and set when editing an existing one; the times stay as canonical <c>HH:MM</c> strings (the API's
/// wire shape) so the same validation runs for both flows.
/// </summary>
public sealed record QuietHoursDraft
{
    /// <summary>The default start time for a new window (web <c>'23:00'</c>).</summary>
    public const string DefaultStart = "23:00";

    /// <summary>The default end time for a new window (web <c>'07:00'</c>).</summary>
    public const string DefaultEnd = "07:00";

    /// <summary>The edited window's id, or null when creating.</summary>
    public long? Id { get; init; }

    /// <summary>Whether the drafted window is enabled.</summary>
    public bool Enabled { get; init; } = true;

    /// <summary>The local-clock start time as <c>HH:MM</c>.</summary>
    public string StartLocal { get; init; } = DefaultStart;

    /// <summary>The local-clock end time as <c>HH:MM</c>.</summary>
    public string EndLocal { get; init; } = DefaultEnd;

    /// <summary>The IANA timezone the window is evaluated in.</summary>
    public string Timezone { get; init; } = "UTC";

    /// <summary>The 7-bit weekday mask (Sun=1..Sat=64).</summary>
    public int Weekdays { get; init; } = QuietHoursWeekdayCatalog.AllWeekdays;

    /// <summary>The severities that bypass the window.</summary>
    public IReadOnlyList<string> BypassSeverities { get; init; } = new[] { "critical" };

    /// <summary>Builds the default draft for a brand-new window, seeded with <paramref name="localTimezone"/>.</summary>
    /// <param name="localTimezone">The user's resolved IANA timezone (web <c>Intl…timeZone</c>).</param>
    public static QuietHoursDraft CreateDefault(string localTimezone) => new()
    {
        Timezone = string.IsNullOrWhiteSpace(localTimezone) ? "UTC" : localTimezone,
    };

    /// <summary>Builds an editable draft from an existing <paramref name="window"/> (web <c>makeDraft(initial)</c>).</summary>
    /// <param name="window">The persisted window being edited.</param>
    public static QuietHoursDraft FromWindow(QuietHoursWindow window)
    {
        ArgumentNullException.ThrowIfNull(window);
        return new QuietHoursDraft
        {
            Id = window.Id,
            Enabled = window.Enabled,
            StartLocal = window.StartLocal,
            EndLocal = window.EndLocal,
            Timezone = window.Timezone,
            Weekdays = window.Weekdays,
            BypassSeverities = window.BypassSeverities.ToArray(),
        };
    }

    /// <summary>Returns a copy with <paramref name="bit"/> toggled in the weekday mask (web <c>toggleWeekday</c>).</summary>
    /// <param name="bit">The weekday bit to flip.</param>
    public QuietHoursDraft ToggleWeekday(int bit) => this with { Weekdays = Weekdays ^ bit };

    /// <summary>Returns a copy with <paramref name="severity"/> added or removed from the bypass list (web <c>toggleSeverity</c>).</summary>
    /// <param name="severity">The severity wire value to flip.</param>
    public QuietHoursDraft ToggleSeverity(string severity)
    {
        ArgumentException.ThrowIfNullOrEmpty(severity);
        var next = BypassSeverities.Contains(severity, StringComparer.Ordinal)
            ? BypassSeverities.Where(s => !string.Equals(s, severity, StringComparison.Ordinal)).ToArray()
            : BypassSeverities.Append(severity).ToArray();
        return this with { BypassSeverities = next };
    }

    /// <summary>Projects the draft into the snake_case write body sent to the API (web mutation payload).</summary>
    public QuietHoursWriteBody ToWriteBody() => new(
        Enabled,
        StartLocal,
        EndLocal,
        Timezone,
        Weekdays,
        BypassSeverities.ToArray());
}

/// <summary>
/// The snake_case body POSTed / PATCHed to the quiet-hours endpoints — the native mirror of the web
/// <c>QuietHoursWindowInput</c> payload. Every field is sent so a create and an update share one shape, matching
/// the server's full-object upsert.
/// </summary>
/// <param name="Enabled">Whether the window is enabled.</param>
/// <param name="StartLocal">The local-clock start time as <c>HH:MM</c>.</param>
/// <param name="EndLocal">The local-clock end time as <c>HH:MM</c>.</param>
/// <param name="Timezone">The IANA timezone.</param>
/// <param name="Weekdays">The 7-bit weekday mask.</param>
/// <param name="BypassSeverities">The bypass-severity allow-list.</param>
public sealed record QuietHoursWriteBody(
    [property: JsonPropertyName("enabled")] bool Enabled,
    [property: JsonPropertyName("start_local")] string StartLocal,
    [property: JsonPropertyName("end_local")] string EndLocal,
    [property: JsonPropertyName("timezone")] string Timezone,
    [property: JsonPropertyName("weekdays")] int Weekdays,
    [property: JsonPropertyName("bypass_severities")] IReadOnlyList<string> BypassSeverities);

/// <summary>The form field a <see cref="QuietHoursValidationResult"/> points at — the web <c>ValidationResult.field</c>.</summary>
public enum QuietHoursField
{
    /// <summary>The start-time field.</summary>
    StartLocal,

    /// <summary>The end-time field.</summary>
    EndLocal,

    /// <summary>The timezone field.</summary>
    Timezone,

    /// <summary>The weekday mask.</summary>
    Weekdays,

    /// <summary>The bypass-severity list.</summary>
    BypassSeverities,
}

/// <summary>The reason a draft failed validation — the web <c>ValidationResult.message</c> discriminator.</summary>
public enum QuietHoursValidationReason
{
    /// <summary>The field value is malformed (web <c>'invalid'</c>).</summary>
    Invalid,

    /// <summary>The end time equals the start time (web <c>'equal'</c>).</summary>
    Equal,

    /// <summary>The field is required and missing (web <c>'required'</c>).</summary>
    Required,
}

/// <summary>
/// The outcome of validating a <see cref="QuietHoursDraft"/> — the native mirror of the web
/// <c>ValidationResult</c>. When <see cref="Ok"/> is false, <see cref="Field"/> and <see cref="Reason"/> select
/// the localized message the form shows.
/// </summary>
/// <param name="Ok">True when the draft is valid.</param>
/// <param name="Field">The offending field when invalid.</param>
/// <param name="Reason">Why the field is invalid.</param>
public sealed record QuietHoursValidationResult(bool Ok, QuietHoursField Field, QuietHoursValidationReason Reason)
{
    /// <summary>The shared "valid" result.</summary>
    public static QuietHoursValidationResult Valid { get; } =
        new(true, QuietHoursField.StartLocal, QuietHoursValidationReason.Invalid);
}

/// <summary>
/// Pure validation of a quiet-hours draft — the native port of the web <c>validateDraft</c> and its <c>HHMM</c>
/// guard. Also exposes the field/reason → i18n key + English fallback mapping the web <c>submit</c> handler uses,
/// so the form's error message resolves through the localizer with web-identical keys.
/// </summary>
public static partial class QuietHoursValidation
{
    [GeneratedRegex("^([01][0-9]|2[0-3]):[0-5][0-9]$")]
    private static partial Regex HourMinute();

    /// <summary>True when <paramref name="value"/> is a 24-hour <c>HH:MM</c> string (web <c>HHMM</c> regex).</summary>
    /// <param name="value">The candidate time string.</param>
    public static bool IsHourMinute(string value) => value is not null && HourMinute().IsMatch(value);

    /// <summary>
    /// Validate <paramref name="draft"/> in the same order as the web <c>validateDraft</c>: start format, end
    /// format, end-equals-start, timezone presence and the weekday mask range. An empty bypass list is allowed
    /// (the window then defers everything), exactly as the web does.
    /// </summary>
    /// <param name="draft">The draft to validate.</param>
    public static QuietHoursValidationResult Validate(QuietHoursDraft draft)
    {
        ArgumentNullException.ThrowIfNull(draft);

        if (!IsHourMinute(draft.StartLocal))
        {
            return new QuietHoursValidationResult(false, QuietHoursField.StartLocal, QuietHoursValidationReason.Invalid);
        }

        if (!IsHourMinute(draft.EndLocal))
        {
            return new QuietHoursValidationResult(false, QuietHoursField.EndLocal, QuietHoursValidationReason.Invalid);
        }

        if (string.Equals(draft.StartLocal, draft.EndLocal, StringComparison.Ordinal))
        {
            return new QuietHoursValidationResult(false, QuietHoursField.EndLocal, QuietHoursValidationReason.Equal);
        }

        if (string.IsNullOrWhiteSpace(draft.Timezone))
        {
            return new QuietHoursValidationResult(false, QuietHoursField.Timezone, QuietHoursValidationReason.Required);
        }

        if (draft.Weekdays <= 0 || draft.Weekdays > QuietHoursWeekdayCatalog.AllWeekdays)
        {
            return new QuietHoursValidationResult(false, QuietHoursField.Weekdays, QuietHoursValidationReason.Required);
        }

        return QuietHoursValidationResult.Valid;
    }

    /// <summary>The i18n key for a validation failure (web <c>submit</c> message map).</summary>
    /// <param name="result">The failing validation result.</param>
    public static string MessageKey(QuietHoursValidationResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return result.Field switch
        {
            QuietHoursField.EndLocal when result.Reason == QuietHoursValidationReason.Equal => "quietHours.error.endEqual",
            QuietHoursField.EndLocal => "quietHours.error.endInvalid",
            QuietHoursField.Timezone => "quietHours.error.timezoneRequired",
            QuietHoursField.Weekdays => "quietHours.error.weekdaysRequired",
            QuietHoursField.BypassSeverities => "quietHours.error.bypassRequired",
            _ => "quietHours.error.startInvalid",
        };
    }

    /// <summary>The English fallback for a validation failure (web <c>submit</c> message map).</summary>
    /// <param name="result">The failing validation result.</param>
    public static string MessageFallback(QuietHoursValidationResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return result.Field switch
        {
            QuietHoursField.EndLocal when result.Reason == QuietHoursValidationReason.Equal => "End must differ from start.",
            QuietHoursField.EndLocal => "End must be HH:MM (24-hour).",
            QuietHoursField.Timezone => "Timezone is required.",
            QuietHoursField.Weekdays => "Pick at least one weekday.",
            QuietHoursField.BypassSeverities => "Pick at least one severity.",
            _ => "Start must be HH:MM (24-hour).",
        };
    }
}

/// <summary>The kind of the next state change for an active window — drives the localized "next change" label.</summary>
public enum QuietHoursNextChangeKind
{
    /// <summary>No upcoming change today (disabled, off today, or unparseable).</summary>
    None,

    /// <summary>The window starts later today.</summary>
    StartsToday,

    /// <summary>The window ends later today.</summary>
    EndsToday,

    /// <summary>The window (which wraps past midnight) ends tomorrow.</summary>
    EndsTomorrow,

    /// <summary>The window has already run today; it next starts tomorrow.</summary>
    StartsTomorrow,
}

/// <summary>
/// The next state change for a window — a strongly-typed, localizer-free result so the timeline logic is unit
/// tested with a pinned clock. <see cref="Time"/> is the <c>HH:MM</c> string the localized label interpolates.
/// </summary>
/// <param name="Kind">The kind of upcoming change.</param>
/// <param name="Time">The <c>HH:MM</c> time the change happens at (empty for <see cref="QuietHoursNextChangeKind.None"/>).</param>
public sealed record QuietHoursNextChange(QuietHoursNextChangeKind Kind, string Time)
{
    /// <summary>The shared "no upcoming change" result.</summary>
    public static QuietHoursNextChange None { get; } = new(QuietHoursNextChangeKind.None, string.Empty);
}

/// <summary>
/// Pure computation of a window's next state change — the native port of the web <c>nextWindowChangeLabel</c>.
/// The caller passes <c>now</c> (local wall clock) so test code pins the clock; the result is mapped to a
/// localized string by <see cref="QuietHoursProjection"/>.
/// </summary>
public static class QuietHoursTimeline
{
    /// <summary>
    /// Compute the next change for <paramref name="window"/> relative to <paramref name="now"/>. Returns
    /// <see cref="QuietHoursNextChange.None"/> when the window is disabled, not active on the current weekday, or
    /// carries unparseable times — matching the web's early-return branches.
    /// </summary>
    /// <param name="window">The window to evaluate.</param>
    /// <param name="now">The local wall-clock time to evaluate against.</param>
    public static QuietHoursNextChange NextChange(QuietHoursWindow window, DateTime now)
    {
        ArgumentNullException.ThrowIfNull(window);
        if (!window.Enabled)
        {
            return QuietHoursNextChange.None;
        }

        int todayBit = 1 << (int)now.DayOfWeek;
        if (!QuietHoursWeekdayCatalog.IsOn(window.Weekdays, todayBit))
        {
            return QuietHoursNextChange.None;
        }

        int? start = ParseMinutes(window.StartLocal);
        int? end = ParseMinutes(window.EndLocal);
        if (start is not { } startMin || end is not { } endMin)
        {
            return QuietHoursNextChange.None;
        }

        int minutesNow = (now.Hour * 60) + now.Minute;
        bool wraps = endMin <= startMin;
        if (wraps)
        {
            if (minutesNow < endMin)
            {
                return new QuietHoursNextChange(QuietHoursNextChangeKind.EndsToday, window.EndLocal);
            }

            if (minutesNow >= startMin)
            {
                return new QuietHoursNextChange(QuietHoursNextChangeKind.EndsTomorrow, window.EndLocal);
            }

            return new QuietHoursNextChange(QuietHoursNextChangeKind.StartsToday, window.StartLocal);
        }

        if (minutesNow < startMin)
        {
            return new QuietHoursNextChange(QuietHoursNextChangeKind.StartsToday, window.StartLocal);
        }

        if (minutesNow < endMin)
        {
            return new QuietHoursNextChange(QuietHoursNextChangeKind.EndsToday, window.EndLocal);
        }

        return new QuietHoursNextChange(QuietHoursNextChangeKind.StartsTomorrow, window.StartLocal);
    }

    private static int? ParseMinutes(string value)
    {
        if (!QuietHoursValidation.IsHourMinute(value))
        {
            return null;
        }

        var parts = value.Split(':');
        return (int.Parse(parts[0], CultureInfo.InvariantCulture) * 60)
            + int.Parse(parts[1], CultureInfo.InvariantCulture);
    }
}

/// <summary>
/// The IANA timezone catalog backing the form's timezone selector — the native port of the web
/// <c>listTimezones</c>. Mirrors the web curated fallback list and prepends the user's resolved zone when it is
/// outside that list, so the selected value is always present.
/// </summary>
public static class QuietHoursTimezones
{
    private static readonly string[] CuratedZones =
    {
        "UTC",
        "Europe/London",
        "Europe/Paris",
        "Europe/Berlin",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "Asia/Tokyo",
        "Asia/Shanghai",
        "Asia/Kolkata",
        "Australia/Sydney",
    };

    /// <summary>The web curated fallback list (web <c>listTimezones</c> fallback).</summary>
    public static IReadOnlyList<string> Curated => CuratedZones;

    /// <summary>
    /// Build the selectable zone list for <paramref name="currentTimezone"/>, prepending it when it is not already
    /// in the curated list (web <c>listTimezones</c>).
    /// </summary>
    /// <param name="currentTimezone">The currently selected IANA timezone.</param>
    public static IReadOnlyList<string> Options(string currentTimezone)
    {
        if (string.IsNullOrWhiteSpace(currentTimezone)
            || CuratedZones.Contains(currentTimezone, StringComparer.Ordinal))
        {
            return CuratedZones;
        }

        return new[] { currentTimezone }.Concat(CuratedZones).ToArray();
    }

    /// <summary>
    /// Resolve the host's IANA timezone (web <c>Intl.DateTimeFormat().resolvedOptions().timeZone</c>), converting
    /// a Windows zone id when necessary and defaulting to <c>UTC</c> when it cannot be resolved.
    /// </summary>
    public static string ResolveLocal()
    {
        try
        {
            string id = TimeZoneInfo.Local.Id;
            if (CuratedZones.Contains(id, StringComparer.Ordinal) || id.Contains('/', StringComparison.Ordinal))
            {
                return id;
            }

            if (TimeZoneInfo.TryConvertWindowsIdToIanaId(id, out var iana) && !string.IsNullOrEmpty(iana))
            {
                return iana;
            }

            return "UTC";
        }
        catch (TimeZoneNotFoundException)
        {
            return "UTC";
        }
        catch (InvalidTimeZoneException)
        {
            return "UTC";
        }
    }
}

/// <summary>A rendered weekday chip on a list row — a label and whether the day is active.</summary>
/// <param name="Label">The localized short weekday label.</param>
/// <param name="IsOn">Whether the day is active for this window.</param>
public sealed record QuietHoursWeekdayChip(string Label, bool IsOn);

/// <summary>A selectable weekday toggle in the form — a label, its bit and its current state.</summary>
/// <param name="Label">The localized short weekday label.</param>
/// <param name="Bit">The weekday bit this toggle flips.</param>
/// <param name="IsOn">Whether the day is currently selected.</param>
/// <param name="AutomationName">The Narrator name announcing the day and its state.</param>
public sealed record QuietHoursWeekdayToggle(string Label, int Bit, bool IsOn, string AutomationName);

/// <summary>A selectable bypass-severity toggle in the form.</summary>
/// <param name="Label">The localized severity label.</param>
/// <param name="Value">The severity wire value this toggle flips.</param>
/// <param name="IsOn">Whether the severity is currently allowed through.</param>
/// <param name="AutomationName">The Narrator name announcing the severity and its state.</param>
public sealed record QuietHoursSeverityToggle(string Label, string Value, bool IsOn, string AutomationName);

/// <summary>
/// A render-ready quiet-hours list row — the native projection of one <see cref="QuietHoursWindow"/> matching the
/// web list item. Carries the raw <see cref="Window"/> so the view can wire Edit / Delete without re-deriving it.
/// </summary>
/// <param name="Window">The underlying window (for Edit / Delete actions).</param>
/// <param name="StatusLabel">The localized "Enabled" / "Disabled" badge text.</param>
/// <param name="StatusKind">The badge status accent.</param>
/// <param name="Summary">The "start → end (tz)" summary.</param>
/// <param name="NextChangeLabel">The optional "ends at HH:MM" hint (null when none).</param>
/// <param name="Weekdays">The weekday chips in week order.</param>
/// <param name="BypassLabel">The localized "Always allow:" prefix.</param>
/// <param name="BypassSeverities">The localized bypass-severity labels (empty hides the row).</param>
/// <param name="EditLabel">The localized Edit button text.</param>
/// <param name="DeleteLabel">The localized Delete button text.</param>
/// <param name="EditAutomationName">The Narrator name for the Edit button.</param>
/// <param name="DeleteAutomationName">The Narrator name for the Delete button.</param>
/// <param name="AutomationName">The Narrator name for the whole row.</param>
public sealed record QuietHoursRowDisplay(
    QuietHoursWindow Window,
    string StatusLabel,
    StatusKind StatusKind,
    string Summary,
    string? NextChangeLabel,
    IReadOnlyList<QuietHoursWeekdayChip> Weekdays,
    string BypassLabel,
    IReadOnlyList<string> BypassSeverities,
    string EditLabel,
    string DeleteLabel,
    string EditAutomationName,
    string DeleteAutomationName,
    string AutomationName);

/// <summary>
/// The render-ready create/edit form — the native projection of the web draft panel. Null on
/// <see cref="QuietHoursDisplay.Form"/> means no form is open.
/// </summary>
/// <param name="IsEdit">True when editing an existing window (Update) vs. creating (Create).</param>
/// <param name="Title">The localized form heading.</param>
/// <param name="EnabledToggleLabel">The localized "Enabled" toggle label.</param>
/// <param name="Enabled">The drafted enabled state.</param>
/// <param name="StartLabel">The localized Start field label.</param>
/// <param name="StartLocal">The drafted start time as <c>HH:MM</c>.</param>
/// <param name="EndLabel">The localized End field label.</param>
/// <param name="EndLocal">The drafted end time as <c>HH:MM</c>.</param>
/// <param name="TimezoneLabel">The localized timezone field label.</param>
/// <param name="Timezone">The drafted timezone.</param>
/// <param name="TimezoneOptions">The selectable IANA timezones.</param>
/// <param name="WeekdaysLabel">The localized "Weekdays" group label.</param>
/// <param name="WeekdayToggles">The weekday toggles in week order.</param>
/// <param name="BypassLabel">The localized "Always allow these severities through" group label.</param>
/// <param name="SeverityToggles">The bypass-severity toggles in web order.</param>
/// <param name="ValidationError">The localized validation error (null when valid).</param>
/// <param name="CancelLabel">The localized Cancel button text.</param>
/// <param name="SubmitLabel">The localized Update / Create button text.</param>
public sealed record QuietHoursFormDisplay(
    bool IsEdit,
    string Title,
    string EnabledToggleLabel,
    bool Enabled,
    string StartLabel,
    string StartLocal,
    string EndLabel,
    string EndLocal,
    string TimezoneLabel,
    string Timezone,
    IReadOnlyList<string> TimezoneOptions,
    string WeekdaysLabel,
    IReadOnlyList<QuietHoursWeekdayToggle> WeekdayToggles,
    string BypassLabel,
    IReadOnlyList<QuietHoursSeverityToggle> SeverityToggles,
    string? ValidationError,
    string CancelLabel,
    string SubmitLabel);

/// <summary>
/// The complete render-ready model for the quiet-hours surface — the native projection of the web
/// <c>QuietHoursPanel</c>. Every owned string is localized; <see cref="Rows"/> is empty in the empty state and
/// <see cref="Form"/> is null unless the create/edit form is open.
/// </summary>
/// <param name="AutomationName">The Narrator name for the whole surface.</param>
/// <param name="Title">The localized panel title.</param>
/// <param name="Subtitle">The localized panel subtitle.</param>
/// <param name="AddWindowLabel">The localized "Add window" button text.</param>
/// <param name="AddWindowAutomationName">The Narrator name for the Add button.</param>
/// <param name="ShowAddButton">Whether the Add button is shown (hidden while the form is open).</param>
/// <param name="LoadingLabel">The localized "Loading…" text.</param>
/// <param name="EmptyMessage">The localized empty-state message.</param>
/// <param name="Rows">The window rows (empty in the empty state).</param>
/// <param name="Form">The open create/edit form, or null.</param>
public sealed record QuietHoursDisplay(
    string AutomationName,
    string Title,
    string Subtitle,
    string AddWindowLabel,
    string AddWindowAutomationName,
    bool ShowAddButton,
    string LoadingLabel,
    string EmptyMessage,
    IReadOnlyList<QuietHoursRowDisplay> Rows,
    QuietHoursFormDisplay? Form);

/// <summary>
/// Pure projection from the windows + draft state to the render-ready <see cref="QuietHoursDisplay"/> — the native
/// port of the web <c>QuietHoursPanel</c> render. Every owned string resolves through the i18n facade using the
/// web's keys with the web English fallback, the weekday / severity chips are built in web order, and the
/// "next change" hint is localized from the pure <see cref="QuietHoursTimeline"/> result.
/// </summary>
public static class QuietHoursProjection
{
    /// <summary>Segoe Fluent "QuietHours" moon glyph standing in for the web Lucide <c>Moon</c> icon.</summary>
    public const string MoonGlyph = "\uE708";

    /// <summary>
    /// Project the current <paramref name="windows"/> and optional <paramref name="draft"/> into the render-ready
    /// display, resolving every string through <paramref name="localizer"/>.
    /// </summary>
    /// <param name="windows">The current list of persisted windows.</param>
    /// <param name="draft">The open create/edit draft, or null.</param>
    /// <param name="validationError">The current localized validation message, or null.</param>
    /// <param name="now">The local wall-clock time used for the "next change" hint.</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public static QuietHoursDisplay Project(
        IReadOnlyList<QuietHoursWindow> windows,
        QuietHoursDraft? draft,
        string? validationError,
        DateTime now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(windows);
        ArgumentNullException.ThrowIfNull(localizer);

        var rows = new List<QuietHoursRowDisplay>(windows.Count);
        foreach (var window in windows)
        {
            rows.Add(ProjectRow(window, now, localizer));
        }

        QuietHoursFormDisplay? form = draft is null ? null : ProjectForm(draft, validationError, localizer);

        return new QuietHoursDisplay(
            AutomationName: localizer.GetString("quietHours.title", "Quiet hours / Do-Not-Disturb"),
            Title: localizer.GetString("quietHours.title", "Quiet hours / Do-Not-Disturb"),
            Subtitle: localizer.GetString(
                "quietHours.subtitle",
                "Defer non-critical notifications during sleep, meetings, or other time-of-day windows."),
            AddWindowLabel: localizer.GetString("quietHours.addWindow", "Add window"),
            AddWindowAutomationName: localizer.GetString("quietHours.addWindow", "Add window"),
            ShowAddButton: draft is null,
            LoadingLabel: localizer.GetString("quietHours.loading", "Loading quiet-hours windows\u2026"),
            EmptyMessage: localizer.GetString(
                "quietHours.empty",
                "No quiet-hours windows yet. Add one to defer non-critical notifications during sleep or meetings."),
            Rows: rows,
            Form: form);
    }

    private static QuietHoursRowDisplay ProjectRow(QuietHoursWindow window, DateTime now, ILocalizer localizer)
    {
        bool enabled = window.Enabled;
        string statusLabel = enabled
            ? localizer.GetString("quietHours.enabled", "Enabled")
            : localizer.GetString("quietHours.disabled", "Disabled");

        var chips = new List<QuietHoursWeekdayChip>(QuietHoursWeekdayCatalog.Ordered.Count);
        foreach (var day in QuietHoursWeekdayCatalog.Ordered)
        {
            chips.Add(new QuietHoursWeekdayChip(
                localizer.GetString(day.I18nKey, day.Fallback),
                QuietHoursWeekdayCatalog.IsOn(window.Weekdays, day.Bit)));
        }

        string? nextLabel = NextChangeLabel(QuietHoursTimeline.NextChange(window, now), localizer);

        string editLabel = localizer.GetString("quietHours.edit", "Edit");
        string deleteLabel = localizer.GetString("quietHours.delete", "Delete");

        return new QuietHoursRowDisplay(
            Window: window,
            StatusLabel: statusLabel,
            StatusKind: enabled ? StatusKind.Success : StatusKind.Neutral,
            Summary: window.Summary,
            NextChangeLabel: nextLabel,
            Weekdays: chips,
            BypassLabel: localizer.GetString("quietHours.bypassLabel", "Always allow:"),
            BypassSeverities: window.BypassSeverities,
            EditLabel: editLabel,
            DeleteLabel: deleteLabel,
            EditAutomationName: $"{editLabel} \u2014 {window.Summary}",
            DeleteAutomationName: $"{deleteLabel} \u2014 {window.Summary}",
            AutomationName: $"{statusLabel} \u2014 {window.Summary}");
    }

    private static QuietHoursFormDisplay ProjectForm(
        QuietHoursDraft draft,
        string? validationError,
        ILocalizer localizer)
    {
        bool isEdit = draft.Id is > 0;

        var weekdayToggles = new List<QuietHoursWeekdayToggle>(QuietHoursWeekdayCatalog.Ordered.Count);
        foreach (var day in QuietHoursWeekdayCatalog.Ordered)
        {
            string label = localizer.GetString(day.I18nKey, day.Fallback);
            bool on = QuietHoursWeekdayCatalog.IsOn(draft.Weekdays, day.Bit);
            weekdayToggles.Add(new QuietHoursWeekdayToggle(label, day.Bit, on, label));
        }

        var severityToggles = new List<QuietHoursSeverityToggle>(QuietHoursSeverityCatalog.Ordered.Count);
        foreach (var severity in QuietHoursSeverityCatalog.Ordered)
        {
            string value = QuietHoursSeverityCatalog.WireValue(severity);
            string label = localizer.GetString(
                QuietHoursSeverityCatalog.I18nKey(severity),
                QuietHoursSeverityCatalog.Fallback(severity));
            bool on = draft.BypassSeverities.Contains(value, StringComparer.Ordinal);
            severityToggles.Add(new QuietHoursSeverityToggle(label, value, on, label));
        }

        return new QuietHoursFormDisplay(
            IsEdit: isEdit,
            Title: isEdit
                ? localizer.GetString("quietHours.form.editTitle", "Edit window")
                : localizer.GetString("quietHours.form.addTitle", "New quiet-hours window"),
            EnabledToggleLabel: localizer.GetString("quietHours.form.enabled", "Enabled"),
            Enabled: draft.Enabled,
            StartLabel: localizer.GetString("quietHours.form.start", "Start"),
            StartLocal: draft.StartLocal,
            EndLabel: localizer.GetString("quietHours.form.end", "End"),
            EndLocal: draft.EndLocal,
            TimezoneLabel: localizer.GetString("quietHours.form.timezone", "Timezone (IANA)"),
            Timezone: draft.Timezone,
            TimezoneOptions: QuietHoursTimezones.Options(draft.Timezone),
            WeekdaysLabel: localizer.GetString("quietHours.form.weekdays", "Weekdays"),
            WeekdayToggles: weekdayToggles,
            BypassLabel: localizer.GetString("quietHours.form.bypass", "Always allow these severities through"),
            SeverityToggles: severityToggles,
            ValidationError: validationError,
            CancelLabel: localizer.GetString("quietHours.form.cancel", "Cancel"),
            SubmitLabel: isEdit
                ? localizer.GetString("quietHours.form.update", "Update")
                : localizer.GetString("quietHours.form.create", "Create"));
    }

    private static string? NextChangeLabel(QuietHoursNextChange next, ILocalizer localizer) => next.Kind switch
    {
        QuietHoursNextChangeKind.StartsToday =>
            Format(localizer.GetString("quietHours.next.startsAt", "starts at {0}"), next.Time),
        QuietHoursNextChangeKind.EndsToday =>
            Format(localizer.GetString("quietHours.next.endsAt", "ends at {0}"), next.Time),
        QuietHoursNextChangeKind.EndsTomorrow =>
            Format(localizer.GetString("quietHours.next.endsTomorrowAt", "ends tomorrow at {0}"), next.Time),
        QuietHoursNextChangeKind.StartsTomorrow =>
            Format(localizer.GetString("quietHours.next.startsTomorrowAt", "starts tomorrow at {0}"), next.Time),
        _ => null,
    };

    private static string Format(string template, string time) =>
        string.Format(CultureInfo.InvariantCulture, template, time);
}

/// <summary>
/// A transient save/delete feedback cue — the native mirror of the web <c>useToast()</c> success/error toasts the
/// panel raises. Rendered as a dismissible inline callout so the outcome is announced without a global toast host.
/// </summary>
/// <param name="Message">The localized feedback message.</param>
/// <param name="IsError">True for a failure (danger styling), false for success.</param>
public sealed record QuietHoursFeedback(string Message, bool IsError);

/// <summary>
/// Canonical metadata for the QuietHoursPanel surface — the native anchor for the web component at
/// web/src/features/settings/components/QuietHoursPanel.tsx. Centralises the diagnostics <see cref="Slug"/>
/// emitted with the <c>view.opened</c> event (P1/S11) and the generated CRUD operation ids the source reads and
/// writes.
/// </summary>
public static class QuietHoursRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "QuietHoursPanel";

    /// <summary>The web component this surface mirrors.</summary>
    public const string WebSource = "features/settings/components/QuietHoursPanel.tsx";

    /// <summary>The generated operation id for <c>GET /notifications/quiet-hours</c> (web <c>useQuietHours</c>).</summary>
    public const string ListOperation = "get_api_v1_notifications_quiet_hours";

    /// <summary>The generated operation id for <c>POST /notifications/quiet-hours</c> (web create).</summary>
    public const string CreateOperation = "post_api_v1_notifications_quiet_hours";

    /// <summary>The generated operation id for <c>PATCH /notifications/quiet-hours/{id}</c> (web update).</summary>
    public const string UpdateOperation = "patch_api_v1_notifications_quiet_hours_id";

    /// <summary>The generated operation id for <c>DELETE /notifications/quiet-hours/{id}</c> (web delete).</summary>
    public const string DeleteOperation = "delete_api_v1_notifications_quiet_hours_id";
}

/// <summary>
/// PII-safe diagnostics for the QuietHoursPanel surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a window's times, timezone or severities —
/// so a diagnostics line can never leak user configuration. Thread-safe.
/// </summary>
public sealed class QuietHoursDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public QuietHoursDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=QuietHoursPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={QuietHoursRegistration.Slug}");
    }
}
