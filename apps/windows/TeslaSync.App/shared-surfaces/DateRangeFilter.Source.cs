using System.Collections.Generic;
using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The atomic range-writer seam the surface routes a preset selection through when the host opts into batched
/// updates (P1/S8 state-holder layer) — the native port of the web <c>useUrlBatch()</c> contract
/// (web/src/hooks/useUrlBatch.ts) as consumed by <c>DateRangeFilter</c>'s <c>onRangeChange</c>
/// (web/src/components/forms/DateRangeFilter.tsx L13-L31, L71-L73). The web hook returns a single
/// <c>setBatch({ from, to })</c> that writes both query params in one tick, avoiding the same-tick URL-setter
/// race two separate <c>onStartDateChange</c> / <c>onEndDateChange</c> calls would cause. The native analogue
/// writes both ends of the range in one call. The real implementation lives in the host; the view-model only
/// depends on this seam, so its atomic-vs-granular routing is verified headlessly with the inert / recording
/// doubles.
/// </summary>
public interface IDateRangeUrlWriter
{
    /// <summary>
    /// Atomically write both ends of the range (web <c>setBatch({ from: start, to: end })</c>). Both values are
    /// ISO <c>yyyy-MM-dd</c> calendar-day strings (or empty for "unset").
    /// </summary>
    void WriteRange(string startDate, string endDate);
}

/// <summary>
/// The inert writer used when no batched-URL host is wired (galleries / design hosts / the granular-callback
/// path) — <see cref="WriteRange"/> is a no-op, so the surface falls back to its granular
/// <c>StartDateChanged</c> / <c>EndDateChanged</c> events exactly as the web source falls back to
/// <c>onStartDateChange</c> + <c>onEndDateChange</c> when <c>onRangeChange</c> is not supplied. The view
/// supplies the real batched writer in production.
/// </summary>
public sealed class InertDateRangeUrlWriter : IDateRangeUrlWriter
{
    /// <summary>The shared inert instance.</summary>
    public static InertDateRangeUrlWriter Instance { get; } = new();

    private InertDateRangeUrlWriter()
    {
    }

    /// <inheritdoc />
    public void WriteRange(string startDate, string endDate)
    {
    }
}

/// <summary>
/// A writer that records every <see cref="WriteRange"/> call — used by headless tests to assert the atomic
/// path fires once with the resolved range (web <c>onRangeChange({ start, end })</c>) instead of two granular
/// setters. Not thread-safe; drive it from one confinement, as the tests do.
/// </summary>
public sealed class RecordingDateRangeUrlWriter : IDateRangeUrlWriter
{
    /// <summary>The ordered list of (start, end) pairs written, one per <see cref="WriteRange"/> call.</summary>
    public List<DateRangeSelection> Writes { get; } = new();

    /// <inheritdoc />
    public void WriteRange(string startDate, string endDate) => Writes.Add(new DateRangeSelection(startDate, endDate));
}

/// <summary>
/// ISO <c>yyyy-MM-dd</c> calendar-day parsing/formatting — the native analogue of the web
/// <c>&lt;input type="date"&gt;</c> value contract (web/src/components/forms/DateRangeFilter.tsx L84-L98) and
/// the <c>iso(d)</c> helper the preset table emits (web/src/lib/datePresets.ts L22-L28). Pure, culture-invariant
/// and UI-free so the view-model's active-preset matching is verified headlessly. An empty or malformed value
/// (web "unset" input) parses to no date.
/// </summary>
public static class IsoDate
{
    /// <summary>The ISO calendar-day format both ends of the range use (web <c>YYYY-MM-DD</c>).</summary>
    public const string Format = "yyyy-MM-dd";

    /// <summary>Parse an ISO <c>yyyy-MM-dd</c> string to a <see cref="DateOnly"/>, returning false when empty/malformed.</summary>
    public static bool TryParse(string? value, out DateOnly date)
    {
        if (!string.IsNullOrEmpty(value) &&
            DateOnly.TryParseExact(value, Format, CultureInfo.InvariantCulture, DateTimeStyles.None, out date))
        {
            return true;
        }

        date = default;
        return false;
    }

    /// <summary>Format a <see cref="DateOnly"/> as an ISO <c>yyyy-MM-dd</c> string (web <c>iso()</c>).</summary>
    public static string ToIso(DateOnly date) => date.ToString(Format, CultureInfo.InvariantCulture);

    /// <summary>True when <paramref name="value"/> is a well-formed ISO calendar day.</summary>
    public static bool IsValid(string? value) => TryParse(value, out _);
}
