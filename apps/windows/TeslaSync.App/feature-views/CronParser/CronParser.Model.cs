using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.CronParser;

/// <summary>
/// The mutually-exclusive surface state for the <see cref="CronParserViewModel"/>. The web
/// <c>CronParserTool</c> (web/src/features/admin/components/devtools/tools/CronParser.tsx) is a purely
/// client-side calculator — it has no network read, no <c>useQuery</c>, no asynchronous load — so it has
/// only two visual conditions: the parsed result (<see cref="Parsed"/>, the web
/// <c>description &amp;&amp; …</c> / <c>nextRuns.length &gt; 0 &amp;&amp; …</c> branches render) and the
/// no-expression empty surface (<see cref="Empty"/>, the web condition where <c>parts.length !== 5</c> so
/// neither block renders). There is deliberately no loading / error / stale / offline state because the web
/// source has none: the expression is parsed synchronously on every keystroke (<c>useMemo</c>), entirely on
/// the device. The empty surface always renders a friendly hint so the region is never a blank box.
/// </summary>
public enum CronParserState
{
    /// <summary>No valid five-field expression — render the friendly empty surface (never a blank box).</summary>
    Empty,

    /// <summary>A valid five-field expression — render the description and the next-runs section.</summary>
    Parsed,
}

/// <summary>
/// One canonical cron preset — the native analogue of a web preset record
/// (<c>{ label: t('Every Minute'), value: '* * * * *' }</c> in
/// web/src/features/admin/components/devtools/tools/CronParser.tsx). <see cref="LabelKey"/> is the i18n key
/// (the web <c>t(key)</c>) and <see cref="LabelFallback"/> the English default; <see cref="Value"/> is the
/// literal cron expression the chip applies to the input. Pure data so the catalog is asserted in unit tests.
/// </summary>
/// <param name="LabelKey">i18n key for the chip label (web <c>t(key)</c>).</param>
/// <param name="LabelFallback">English fallback label (web translation default).</param>
/// <param name="Value">The literal cron expression applied when the chip is pressed.</param>
public sealed record CronPreset(string LabelKey, string LabelFallback, string Value);

/// <summary>
/// One projected, render-ready preset chip consumed by the WinUI view. <see cref="Label"/> is already
/// resolved through the i18n facade (web <c>t(label)</c>) and <see cref="AutomationName"/> is the Narrator
/// name for the chip. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Label">Localized chip label.</param>
/// <param name="Value">The cron expression the chip applies.</param>
/// <param name="AutomationName">Narrator name for the chip.</param>
public sealed record CronPresetButton(string Label, string Value, string AutomationName);

/// <summary>
/// One projected next-run row — the native analogue of a web <c>nextRuns.map((d, i) =&gt; …)</c> entry
/// (web/src/features/admin/components/devtools/tools/CronParser.tsx). <see cref="Index"/> is the 1-based
/// ordinal shown in the web <c>Badge</c> (<c>i + 1</c>), <see cref="Time"/> the computed local fire time,
/// and <see cref="Formatted"/> the display string (the web <c>formatDateTime(d)</c>). <see cref="AutomationName"/>
/// is the Narrator name for the whole row. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Index">1-based ordinal (web <c>i + 1</c>).</param>
/// <param name="Time">The computed local fire time.</param>
/// <param name="Formatted">The display string (web <c>formatDateTime(d)</c>).</param>
/// <param name="AutomationName">Narrator name for the row.</param>
public sealed record CronRun(int Index, DateTimeOffset Time, string Formatted, string AutomationName);

/// <summary>
/// The fully projected, render-ready view for one cron expression — the native analogue of the web
/// <c>CronParserTool</c> render: the human-readable <see cref="Description"/> (web <c>describeCron</c>) and the
/// ordered <see cref="NextRuns"/> (web <c>getNextCronRuns</c>), plus the mutually-exclusive
/// <see cref="State"/>. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="State">The mutually-exclusive surface state (parsed vs empty).</param>
/// <param name="Description">The human-readable description (empty when <see cref="State"/> is <see cref="CronParserState.Empty"/>).</param>
/// <param name="NextRuns">The ordered upcoming fire times (empty for an impossible schedule).</param>
public sealed record CronDisplay(CronParserState State, string Description, IReadOnlyList<CronRun> NextRuns)
{
    /// <summary>True when a five-field expression parsed (the description renders).</summary>
    public bool HasDescription => State == CronParserState.Parsed && Description.Length > 0;

    /// <summary>True when at least one upcoming run was computed (the web <c>nextRuns.length &gt; 0</c> block renders).</summary>
    public bool HasRuns => NextRuns.Count > 0;
}

/// <summary>
/// The localized phrase templates the cron <see cref="CronExpression.Describe"/> composer fills — the native
/// home for the English strings the web <c>describeCron</c> helper hard-codes
/// (web/src/features/admin/components/devtools/helpers.ts). Resolving them through the i18n facade keeps the
/// describe logic (which phrase, in what order) identical to the web while routing every word through P1/S10
/// (no English literal in the control or model layer). Pure data so the composer is unit-tested without a
/// resource host.
/// </summary>
/// <param name="EveryMinute">Web <c>'Every minute'</c>.</param>
/// <param name="AtMinuteOfHour">Web <c>`At minute ${min} of every hour`</c> (one <c>{0}</c> slot).</param>
/// <param name="AtTime">Web <c>`At ${hr}:${min}`</c> (two slots: <c>{0}</c> hour, <c>{1}</c> minute).</param>
/// <param name="EveryMinuteOfHour">Web <c>`Every minute of hour ${hr}`</c> (one <c>{0}</c> slot).</param>
/// <param name="OnDay">Web <c>`on day ${dom}`</c> (one <c>{0}</c> slot).</param>
/// <param name="InMonth">Web <c>`in month ${mon}`</c> (one <c>{0}</c> slot).</param>
/// <param name="OnWeekday">Web <c>`on ${day}`</c> (one <c>{0}</c> slot).</param>
/// <param name="DayNames">The seven abbreviated weekday names indexed Sun..Sat (web <c>['Sun', …, 'Sat']</c>).</param>
public sealed record CronDescribeLabels(
    string EveryMinute,
    string AtMinuteOfHour,
    string AtTime,
    string EveryMinuteOfHour,
    string OnDay,
    string InMonth,
    string OnWeekday,
    IReadOnlyList<string> DayNames)
{
    /// <summary>Resolve every describe phrase through <paramref name="localizer"/> with the web English defaults.</summary>
    /// <param name="localizer">The i18n facade resolving every phrase.</param>
    public static CronDescribeLabels FromLocalizer(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new CronDescribeLabels(
            localizer.GetString("devtools.cron.everyMinute", "Every minute"),
            localizer.GetString("devtools.cron.atMinuteOfHour", "At minute {0} of every hour"),
            localizer.GetString("devtools.cron.atTime", "At {0}:{1}"),
            localizer.GetString("devtools.cron.everyMinuteOfHour", "Every minute of hour {0}"),
            localizer.GetString("devtools.cron.onDay", "on day {0}"),
            localizer.GetString("devtools.cron.inMonth", "in month {0}"),
            localizer.GetString("devtools.cron.onWeekday", "on {0}"),
            new[]
            {
                localizer.GetString("devtools.cron.day.sun", "Sun"),
                localizer.GetString("devtools.cron.day.mon", "Mon"),
                localizer.GetString("devtools.cron.day.tue", "Tue"),
                localizer.GetString("devtools.cron.day.wed", "Wed"),
                localizer.GetString("devtools.cron.day.thu", "Thu"),
                localizer.GetString("devtools.cron.day.fri", "Fri"),
                localizer.GetString("devtools.cron.day.sat", "Sat"),
            });
    }
}

/// <summary>
/// The pure cron engine — a faithful native port of the web <c>describeCron</c> and <c>getNextCronRuns</c>
/// helpers (web/src/features/admin/components/devtools/helpers.ts). It reproduces the web's five-field
/// standard-cron grammar (<c>*</c>, <c>*/step</c>, <c>a,b,c</c> lists, <c>a-b</c> ranges, literals), the
/// field-match precedence (<c>/</c> then <c>,</c> then <c>-</c> then literal), the minute-resolution forward
/// scan with its one-year safety bound, and the human-readable description composition — without throwing on
/// malformed input (the web helpers never throw either). Headless and deterministic (the scan start is an
/// argument), so the engine is asserted exhaustively in unit tests.
/// </summary>
public static class CronExpression
{
    /// <summary>The number of fields in a standard cron expression (minute hour day month weekday).</summary>
    public const int FieldCount = 5;

    /// <summary>The forward-scan safety bound — one year of minutes (web <c>safety &lt; 525960</c>).</summary>
    public const int ScanLimitMinutes = 525960;

    /// <summary>
    /// Split <paramref name="expression"/> into whitespace-separated fields (the web
    /// <c>expr.trim().split(/\s+/)</c>). A null / blank / whitespace-only expression yields an empty array, so
    /// the <c>== <see cref="FieldCount"/></c> validity gate behaves exactly as the web's
    /// <c>parts.length === 5</c> check.
    /// </summary>
    /// <param name="expression">The raw cron expression (may be null).</param>
    public static IReadOnlyList<string> SplitFields(string? expression)
    {
        if (string.IsNullOrWhiteSpace(expression))
        {
            return Array.Empty<string>();
        }

        return expression.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
    }

    /// <summary>
    /// Compose the human-readable description for <paramref name="parts"/> using the localized
    /// <paramref name="labels"/> — the native port of the web <c>describeCron</c>. Mirrors the web's phrase
    /// selection and ordering exactly: the minute/hour clause, then optional day-of-month, month and weekday
    /// clauses, joined by spaces. A non-five-field input yields the empty string (the web caller only calls
    /// <c>describeCron</c> when <c>parts.length === 5</c>).
    /// </summary>
    /// <param name="parts">The split cron fields.</param>
    /// <param name="labels">The localized phrase templates.</param>
    public static string Describe(IReadOnlyList<string> parts, CronDescribeLabels labels)
    {
        ArgumentNullException.ThrowIfNull(parts);
        ArgumentNullException.ThrowIfNull(labels);

        if (parts.Count != FieldCount)
        {
            return string.Empty;
        }

        string min = parts[0];
        string hr = parts[1];
        string dom = parts[2];
        string mon = parts[3];
        string dow = parts[4];

        var pieces = new List<string>(4);

        if (IsWildcard(min) && IsWildcard(hr))
        {
            pieces.Add(labels.EveryMinute);
        }
        else if (!IsWildcard(min) && IsWildcard(hr))
        {
            pieces.Add(Fill(labels.AtMinuteOfHour, min));
        }
        else if (!IsWildcard(min) && !IsWildcard(hr))
        {
            pieces.Add(Fill(labels.AtTime, hr.PadLeft(2, '0'), min.PadLeft(2, '0')));
        }
        else
        {
            pieces.Add(Fill(labels.EveryMinuteOfHour, hr));
        }

        if (!IsWildcard(dom))
        {
            pieces.Add(Fill(labels.OnDay, dom));
        }

        if (!IsWildcard(mon))
        {
            pieces.Add(Fill(labels.InMonth, mon));
        }

        if (!IsWildcard(dow))
        {
            int? idx = JsParseInt(dow);
            string day = idx is >= 0 and < 7 ? labels.DayNames[idx.Value] : dow;
            pieces.Add(Fill(labels.OnWeekday, day));
        }

        return string.Join(" ", pieces);
    }

    /// <summary>
    /// Compute the next <paramref name="count"/> fire times for <paramref name="parts"/> at or after
    /// <paramref name="now"/> — the native port of the web <c>getNextCronRuns</c>. Reproduces the web's
    /// minute-resolution forward scan: it zeroes seconds, advances one minute, and walks minute by minute
    /// (capped at <see cref="ScanLimitMinutes"/>, one year) collecting every minute whose five fields all
    /// match. A non-five-field input yields an empty list, as does an impossible schedule once the scan bound
    /// is reached.
    /// </summary>
    /// <param name="parts">The split cron fields.</param>
    /// <param name="count">The maximum number of upcoming runs to return.</param>
    /// <param name="now">The instant the scan starts from (its zone is preserved on every result).</param>
    public static IReadOnlyList<DateTimeOffset> NextRuns(IReadOnlyList<string> parts, int count, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(parts);

        if (parts.Count != FieldCount || count <= 0)
        {
            return Array.Empty<DateTimeOffset>();
        }

        string min = parts[0];
        string hr = parts[1];
        string dom = parts[2];
        string mon = parts[3];
        string dow = parts[4];

        var results = new List<DateTimeOffset>(count);
        var check = new DateTimeOffset(now.Year, now.Month, now.Day, now.Hour, now.Minute, 0, now.Offset)
            .AddMinutes(1);

        int safety = 0;
        while (results.Count < count && safety < ScanLimitMinutes)
        {
            safety++;
            if (MatchField(min, check.Minute) &&
                MatchField(hr, check.Hour) &&
                MatchField(dom, check.Day) &&
                MatchField(mon, check.Month) &&
                MatchField(dow, (int)check.DayOfWeek))
            {
                results.Add(check);
            }

            check = check.AddMinutes(1);
        }

        return results;
    }

    /// <summary>
    /// True when <paramref name="field"/> matches <paramref name="value"/> — the native port of the web
    /// <c>matchField</c>. Honours the web precedence: <c>*</c> matches anything; a <c>/</c> step matches
    /// multiples of the step; a <c>,</c> list matches membership; a <c>-</c> range matches the inclusive
    /// interval; otherwise a literal matches equality. Malformed fields never throw — they simply fail to
    /// match (the web's <c>NaN</c> comparisons resolve to <c>false</c>).
    /// </summary>
    /// <param name="field">The cron field token.</param>
    /// <param name="value">The candidate value to test.</param>
    public static bool MatchField(string field, int value)
    {
        ArgumentNullException.ThrowIfNull(field);

        if (IsWildcard(field))
        {
            return true;
        }

        if (field.Contains('/', StringComparison.Ordinal))
        {
            string[] segments = field.Split('/');
            int? step = segments.Length > 1 ? JsParseInt(segments[1]) : null;
            if (step is null || step.Value == 0)
            {
                return false;
            }

            return value % step.Value == 0;
        }

        if (field.Contains(',', StringComparison.Ordinal))
        {
            foreach (string token in field.Split(','))
            {
                if (TryParseStrict(token, out int member) && member == value)
                {
                    return true;
                }
            }

            return false;
        }

        if (field.Contains('-', StringComparison.Ordinal))
        {
            string[] bounds = field.Split('-');
            if (bounds.Length >= 2 &&
                TryParseStrict(bounds[0], out int low) &&
                TryParseStrict(bounds[1], out int high))
            {
                return value >= low && value <= high;
            }

            return false;
        }

        int? literal = JsParseInt(field);
        return literal.HasValue && literal.Value == value;
    }

    private static bool IsWildcard(string field) => string.Equals(field, "*", StringComparison.Ordinal);

    private static string Fill(string template, params object[] args) =>
        string.Format(CultureInfo.CurrentCulture, template, args);

    private static bool TryParseStrict(string token, out int value) =>
        int.TryParse(token, NumberStyles.Integer, CultureInfo.InvariantCulture, out value);

    // Mirrors JavaScript parseInt(token, 10): skip leading whitespace, an optional sign, then consume the
    // leading run of decimal digits and ignore any trailing characters. Returns null for "no digits" (the
    // JS NaN), so callers fail to match exactly as the web's NaN comparisons do.
    private static int? JsParseInt(string? token)
    {
        if (string.IsNullOrEmpty(token))
        {
            return null;
        }

        int i = 0;
        int length = token.Length;
        while (i < length && char.IsWhiteSpace(token[i]))
        {
            i++;
        }

        int sign = 1;
        if (i < length && (token[i] == '+' || token[i] == '-'))
        {
            if (token[i] == '-')
            {
                sign = -1;
            }

            i++;
        }

        int start = i;
        long magnitude = 0;
        while (i < length && token[i] >= '0' && token[i] <= '9')
        {
            magnitude = (magnitude * 10) + (token[i] - '0');
            if (magnitude > int.MaxValue)
            {
                magnitude = int.MaxValue;
            }

            i++;
        }

        if (i == start)
        {
            return null;
        }

        return (int)(sign * magnitude);
    }
}

/// <summary>
/// Canonical registry metadata for the Cron Parser surface — the native mirror of the web devtools
/// <c>CronParserTool</c>. The diagnostics <see cref="Slug"/> is the stable surface identifier emitted with
/// the <c>view.opened</c> event (P1/S11 diagnostics contract); the localized <see cref="Name(ILocalizer)"/> /
/// <see cref="Description(ILocalizer)"/> back the surface's title chrome and Narrator name. The keys mirror
/// the web <c>t('Cron Parser')</c> / <c>t('Cron Parser Desc')</c> calls exactly.
/// </summary>
public static class CronParserRegistration
{
    /// <summary>Stable kebab-case surface id.</summary>
    public const string Id = "cron-parser";

    /// <summary>Surface category (the web devtools live under the admin feature).</summary>
    public const string Category = "admin";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "CronParser";

    /// <summary>The tool id this surface registers under inside the Client Utilities host (web <c>id: 'cron'</c>).</summary>
    public const string ToolId = "cron";

    /// <summary>Localized surface display name (web <c>t('Cron Parser')</c>).</summary>
    /// <param name="localizer">The i18n facade resolving the label.</param>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Cron Parser", "Cron Parser");
    }

    /// <summary>Localized surface description (web <c>t('Cron Parser Desc')</c>).</summary>
    /// <param name="localizer">The i18n facade resolving the label.</param>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Cron Parser Desc", "Cron Parser Desc");
    }
}

/// <summary>
/// PII-safe diagnostics for the Cron Parser surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an expression, a parsed result or any
/// user data — so a diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class CronParserDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public CronParserDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CronParser</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CronParserRegistration.Slug}");
    }
}

/// <summary>
/// Pure projection from a raw cron expression to the render-ready <see cref="CronDisplay"/> — the native port
/// of the web <c>CronParserTool</c>'s <c>useMemo</c> pipeline
/// (web/src/features/admin/components/devtools/tools/CronParser.tsx). It splits and validates the expression,
/// composes the localized description (web <c>describeCron</c>), computes the upcoming runs (web
/// <c>getNextCronRuns</c>) and formats each through the supplied display formatter (web
/// <c>formatDateTime</c>), tagging every row with a Narrator name. The scan start (<c>now</c>) and the
/// formatter are arguments, so the projection is deterministic and unit-tested without a clock or UI host.
/// </summary>
public static class CronProjection
{
    /// <summary>The number of upcoming runs the surface previews (web <c>getNextCronRuns(parts, 5)</c>).</summary>
    public const int DefaultRunCount = 5;

    /// <summary>
    /// Project <paramref name="expression"/> into a render-ready <see cref="CronDisplay"/>. A non-five-field
    /// expression yields the empty state with no description and no runs (web <c>parts.length !== 5</c>); a
    /// valid expression yields the parsed state with the localized description and up to
    /// <paramref name="runCount"/> formatted runs.
    /// </summary>
    /// <param name="expression">The raw cron expression (may be null).</param>
    /// <param name="localizer">The i18n facade resolving the description phrases and the row Narrator name.</param>
    /// <param name="now">The instant the run scan starts from.</param>
    /// <param name="runCount">The maximum number of upcoming runs to compute.</param>
    /// <param name="formatRun">The display formatter for each run time (web <c>formatDateTime</c>).</param>
    public static CronDisplay Project(
        string? expression,
        ILocalizer localizer,
        DateTimeOffset now,
        int runCount,
        Func<DateTimeOffset, string> formatRun)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(formatRun);

        var parts = CronExpression.SplitFields(expression);
        if (parts.Count != CronExpression.FieldCount)
        {
            return new CronDisplay(CronParserState.Empty, string.Empty, Array.Empty<CronRun>());
        }

        var labels = CronDescribeLabels.FromLocalizer(localizer);
        string description = CronExpression.Describe(parts, labels);

        var times = CronExpression.NextRuns(parts, runCount, now);
        string rowTemplate = localizer.GetString("devtools.cron.runLabel", "Run {0}: {1}");

        var runs = new List<CronRun>(times.Count);
        for (int i = 0; i < times.Count; i++)
        {
            string formatted = formatRun(times[i]);
            string automationName = string.Format(CultureInfo.CurrentCulture, rowTemplate, i + 1, formatted);
            runs.Add(new CronRun(i + 1, times[i], formatted, automationName));
        }

        return new CronDisplay(CronParserState.Parsed, description, runs);
    }
}
