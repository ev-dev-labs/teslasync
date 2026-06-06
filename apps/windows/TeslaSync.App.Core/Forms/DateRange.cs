namespace TeslaSync.App.Core.Forms;

/// <summary>
/// An inclusive calendar-day range backing <c>TsRangePicker</c> /
/// <c>TsDateRangeFilter</c>. Uses <see cref="DateOnly"/> so it is wall-clock,
/// timezone-agnostic and trivially testable.
/// </summary>
public readonly record struct DateRange(DateOnly Start, DateOnly End)
{
    /// <summary>True when the end is on or after the start.</summary>
    public bool IsValid => End >= Start;

    /// <summary>Inclusive day count (0 when invalid).</summary>
    public int Days => IsValid ? End.DayNumber - Start.DayNumber + 1 : 0;

    /// <summary>Return a copy clamped so start ≤ end (swapping when reversed).</summary>
    public DateRange Normalized() => IsValid ? this : new DateRange(End, Start);
}

/// <summary>
/// A quick-select date preset. <see cref="Resolve"/> derives the concrete range
/// from a supplied "today" so the result is deterministic and testable. Ports
/// the web <c>DATE_PRESETS</c> table.
/// </summary>
public sealed record DatePreset(string Id, string I18nKey, string Fallback)
{
    /// <summary>Resolve the preset's range relative to <paramref name="today"/>.</summary>
    public DateRange Resolve(DateOnly today) => Id switch
    {
        "today" => new DateRange(today, today),
        "yesterday" => new DateRange(today.AddDays(-1), today.AddDays(-1)),
        "7d" => new DateRange(today.AddDays(-6), today),
        "30d" => new DateRange(today.AddDays(-29), today),
        "90d" => new DateRange(today.AddDays(-89), today),
        "mtd" => new DateRange(new DateOnly(today.Year, today.Month, 1), today),
        "qtd" => new DateRange(new DateOnly(today.Year, (((today.Month - 1) / 3) * 3) + 1, 1), today),
        "ytd" => new DateRange(new DateOnly(today.Year, 1, 1), today),
        "lastMonth" => ResolveLastMonth(today),
        "1y" => new DateRange(today.AddYears(-1), today),
        "all" => new DateRange(new DateOnly(2015, 1, 1), today),
        _ => new DateRange(today, today),
    };

    private static DateRange ResolveLastMonth(DateOnly today)
    {
        var firstOfThisMonth = new DateOnly(today.Year, today.Month, 1);
        var lastOfPrevMonth = firstOfThisMonth.AddDays(-1);
        var firstOfPrevMonth = new DateOnly(lastOfPrevMonth.Year, lastOfPrevMonth.Month, 1);
        return new DateRange(firstOfPrevMonth, lastOfPrevMonth);
    }
}

/// <summary>Catalogue of date presets and lookup/match helpers (ports the web lib).</summary>
public static class DatePresets
{
    /// <summary>Every available preset, in display order.</summary>
    public static IReadOnlyList<DatePreset> All { get; } =
    [
        new("today", "date.preset.today", "Today"),
        new("yesterday", "date.preset.yesterday", "Yesterday"),
        new("7d", "date.preset.last7", "Last 7 days"),
        new("30d", "date.preset.last30", "Last 30 days"),
        new("90d", "date.preset.last90", "Last 90 days"),
        new("mtd", "date.preset.mtd", "Month to date"),
        new("qtd", "date.preset.qtd", "Quarter to date"),
        new("ytd", "date.preset.ytd", "Year to date"),
        new("lastMonth", "date.preset.lastMonth", "Last month"),
        new("1y", "date.preset.last1y", "Last year"),
        new("all", "date.preset.all", "All time"),
    ];

    /// <summary>Default chip set rendered when callers do not pass ids.</summary>
    public static IReadOnlyList<string> DefaultIds { get; } =
        ["today", "7d", "30d", "mtd", "ytd", "all"];

    /// <summary>Look up a preset by id (null when unknown).</summary>
    public static DatePreset? Get(string id) =>
        All.FirstOrDefault(p => string.Equals(p.Id, id, StringComparison.Ordinal));

    /// <summary>Return the presets for the given ids, preserving id order.</summary>
    public static IReadOnlyList<DatePreset> ForIds(IEnumerable<string> ids)
    {
        ArgumentNullException.ThrowIfNull(ids);
        var result = new List<DatePreset>();
        foreach (var id in ids)
        {
            if (Get(id) is { } preset)
            {
                result.Add(preset);
            }
        }

        return result;
    }

    /// <summary>The id of the preset whose resolved range matches, or null.</summary>
    public static string? Match(DateRange range, DateOnly today)
    {
        foreach (var preset in All)
        {
            if (preset.Resolve(today) == range)
            {
                return preset.Id;
            }
        }

        return null;
    }
}
