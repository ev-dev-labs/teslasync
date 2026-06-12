using System.Collections.Generic;
using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the date-range picker surface — the native mirror of the web
/// <c>RangePicker</c> (web/src/components/forms/RangePicker.tsx). The web component is a single-trigger date
/// range filter: a compact button (calendar icon + active-preset label, or "Custom range", + the formatted
/// range + a chevron) that opens a popover holding a preset list, a two-month range calendar and an optional
/// comparison toggle. This metadata carries the diagnostics slug the surface registers under and every
/// render-contract i18n key/fallback the web source passes to <c>t()</c>, so the native surface reproduces the
/// web copy verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects
/// (the convention every shipped surface uses) and resolves against the English fallback headlessly. The preset
/// chip labels are owned by the P1 <see cref="DatePresets"/> catalogue; <see cref="PresetLabelKey"/> maps each
/// preset's catalogue key into the prefixed catalog namespace so they resolve through the same bridge. UI-free so
/// it is asserted without a XAML host.
/// </summary>
public static class RangePickerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "RangePicker";

    /// <summary>i18n key for the trigger's accessible name (web <c>date.range.trigger</c>).</summary>
    public const string TriggerKey = "translation.date.range.trigger";

    /// <summary>English fallback for <see cref="TriggerKey"/> (web second arg, verbatim).</summary>
    public const string TriggerFallback = "Date range";

    /// <summary>i18n key for the popover's accessible name (web <c>date.range.popoverLabel</c>).</summary>
    public const string PopoverLabelKey = "translation.date.range.popoverLabel";

    /// <summary>English fallback for <see cref="PopoverLabelKey"/> (web second arg, verbatim).</summary>
    public const string PopoverLabelFallback = "Date range picker";

    /// <summary>i18n key for the preset list's accessible name (web <c>date.preset.label</c>).</summary>
    public const string PresetListKey = "translation.date.preset.label";

    /// <summary>English fallback for <see cref="PresetListKey"/> (web second arg, verbatim).</summary>
    public const string PresetListFallback = "Quick date range";

    /// <summary>i18n key for the "no preset matches" trigger label (web <c>date.range.pickRange</c>).</summary>
    public const string PickRangeKey = "translation.date.range.pickRange";

    /// <summary>English fallback for <see cref="PickRangeKey"/> (web second arg, verbatim).</summary>
    public const string PickRangeFallback = "Custom range";

    /// <summary>i18n key for the comparison toggle (web <c>date.range.compare</c>).</summary>
    public const string CompareKey = "translation.date.range.compare";

    /// <summary>English fallback for <see cref="CompareKey"/> (web second arg, verbatim).</summary>
    public const string CompareFallback = "Compare to previous period";

    /// <summary>i18n key for the cancel button (web <c>date.range.cancel</c>).</summary>
    public const string CancelKey = "translation.date.range.cancel";

    /// <summary>English fallback for <see cref="CancelKey"/> (web second arg, verbatim).</summary>
    public const string CancelFallback = "Cancel";

    /// <summary>i18n key for the apply button (web <c>date.range.apply</c>).</summary>
    public const string ApplyKey = "translation.date.range.apply";

    /// <summary>English fallback for <see cref="ApplyKey"/> (web second arg, verbatim).</summary>
    public const string ApplyFallback = "Apply";

    /// <summary>Base i18n key for the day-count summary (web <c>date.range.summaryDays</c>, before plural resolution).</summary>
    public const string SummaryDaysKey = "translation.date.range.summaryDays";

    /// <summary>i18n key for the singular day-count summary (WinUI <c>.Plural.one</c> form of <see cref="SummaryDaysKey"/>).</summary>
    public const string SummaryDaysOneKey = "translation.date.range.summaryDays.Plural.one";

    /// <summary>English singular fallback for <see cref="SummaryDaysOneKey"/> (the <c>{0}</c>/<c>{{count}}</c> token is interpolated by <see cref="FormatDayCount"/>).</summary>
    public const string SummaryDaysOneFallback = "{0} day";

    /// <summary>i18n key for the plural day-count summary (WinUI <c>.Plural.other</c> form of <see cref="SummaryDaysKey"/>).</summary>
    public const string SummaryDaysOtherKey = "translation.date.range.summaryDays.Plural.other";

    /// <summary>English plural fallback for <see cref="SummaryDaysOtherKey"/> (the <c>{0}</c>/<c>{{count}}</c> token is interpolated by <see cref="FormatDayCount"/>).</summary>
    public const string SummaryDaysOtherFallback = "{0} days";

    /// <summary>
    /// Map a P1 <see cref="DatePreset"/> catalogue key (e.g. <c>date.preset.today</c>) into the prefixed catalog
    /// namespace the WinUI resource bridge expects (<c>translation.date.preset.today</c>), so the preset chip
    /// labels resolve through the same facade as the rest of the surface (web <c>t(p.i18nKey, p.fallback)</c>).
    /// </summary>
    public static string PresetLabelKey(DatePreset preset)
    {
        ArgumentNullException.ThrowIfNull(preset);
        return "translation." + preset.I18nKey;
    }

    /// <summary>
    /// Resolve and interpolate the inclusive day-count summary for <paramref name="count"/> days — the native port
    /// of the web <c>t('date.range.summaryDays', '{{count}} days', { count })</c> plural selection. Picks the
    /// singular catalog key when exactly one day, else the plural key, resolves it through
    /// <paramref name="localizer"/>, and substitutes the WinUI positional token (<c>{0}</c>) and the web i18next
    /// token (<c>{{count}}</c>) via a literal replace (never
    /// <see cref="string.Format(IFormatProvider, string, object?)"/>, so a localized value carrying a stray brace
    /// can never throw a <see cref="System.FormatException"/>).
    /// </summary>
    public static string FormatDayCount(ILocalizer localizer, int count)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        bool singular = count == 1;
        string key = singular ? SummaryDaysOneKey : SummaryDaysOtherKey;
        string fallback = singular ? SummaryDaysOneFallback : SummaryDaysOtherFallback;
        string template = localizer.GetString(key, fallback);
        string rendered = count.ToString(CultureInfo.CurrentCulture);
        return template
            .Replace("{0}", rendered, StringComparison.Ordinal)
            .Replace("{{count}}", rendered, StringComparison.Ordinal);
    }
}

/// <summary>
/// A single preset entry projected for the view — the native port of the web preset list item
/// (web/src/components/forms/RangePicker.tsx L238-L259). Carries the preset's stable <see cref="Id"/> (web
/// <c>p.id</c>) and its localized <see cref="Label"/> (web <c>t(p.i18nKey, p.fallback)</c>). The active-highlight
/// state is not baked in here — the view compares each entry's id against
/// <see cref="RangePickerViewModel.ActivePresetId"/> so a committed-value change re-highlights without rebuilding
/// the list.
/// </summary>
/// <param name="Id">The preset id (web <c>p.id</c>), e.g. <c>today</c>, <c>7d</c>, <c>all</c>.</param>
/// <param name="Label">The localized preset label (web <c>t(p.i18nKey, p.fallback)</c>).</param>
public sealed record RangePickerPreset(string Id, string Label);

/// <summary>
/// The pure range/format/staging maths behind the date-range picker — the native port of the web module-level
/// helpers (web/src/components/forms/RangePicker.tsx L78-L110 + L155-L196 and <c>resolveAllTimeStart</c> from
/// web/src/lib/datePresets.ts). <see cref="FormatRange"/> renders the trigger sublabel (web <c>formatRange</c>);
/// <see cref="ResolveAllTimeStart"/> floors the "All time" start at the user's first data point (web
/// <c>resolveAllTimeStart</c>); <see cref="ResolvePreset"/> turns a clicked preset into a concrete range (web
/// <c>handlePreset</c>, including the "all" special case); <see cref="StageDay"/> reproduces the calendar's
/// range-selection contract (web react-day-picker <c>mode="range"</c>); and <see cref="IsStagedDirty"/> /
/// <see cref="StagedRange"/> back the Apply-enabled and committed-range projections (web <c>stagedDirty</c> /
/// <c>handleApply</c>). Static and side-effect-free so the maths is unit-tested without a view-model or a UI
/// thread.
/// </summary>
public static class RangePickerLogic
{
    private static readonly DateOnly AllTimeBaseline = new(2015, 1, 1);

    /// <summary>
    /// Render the formatted, inclusive range shown on the trigger (web <c>formatRange</c>): a single day collapses
    /// to one date-with-year ("Jun 5, 2026"); a same-year span drops the start's year ("Jun 5 – Jun 10, 2026");
    /// a cross-year span carries both years ("Dec 30, 2025 – Jan 2, 2026"). The month/day order and month name
    /// come from <paramref name="culture"/> (web <c>Intl.DateTimeFormat(locale, { month:'short', day:'numeric' })</c>).
    /// </summary>
    public static string FormatRange(DateRange range, CultureInfo culture)
    {
        ArgumentNullException.ThrowIfNull(culture);
        DateOnly start = range.Start;
        DateOnly end = range.End;
        if (start == end)
        {
            return FormatDay(start, withYear: true, culture);
        }

        bool sameYear = start.Year == end.Year;
        return FormatDay(start, withYear: !sameYear, culture) + " \u2013 " + FormatDay(end, withYear: true, culture);
    }

    /// <summary>
    /// The start date for the "All time" preset (web <c>resolveAllTimeStart</c>): the <paramref name="minDate"/>
    /// floor when it is later than the 2015-01-01 Tesla-history baseline, otherwise the baseline — so a user whose
    /// data starts in 2024 does not see years of empty buckets.
    /// </summary>
    public static DateOnly ResolveAllTimeStart(DateOnly? minDate) =>
        minDate is { } floor && floor > AllTimeBaseline ? floor : AllTimeBaseline;

    /// <summary>
    /// Resolve a clicked preset into a concrete inclusive range relative to <paramref name="today"/> (web
    /// <c>handlePreset</c>). All presets defer to <see cref="DatePreset.Resolve"/>; the "all" preset additionally
    /// floors its start through <see cref="ResolveAllTimeStart"/> with the supplied <paramref name="minDate"/>.
    /// </summary>
    public static DateRange ResolvePreset(DatePreset preset, DateOnly today, DateOnly? minDate)
    {
        ArgumentNullException.ThrowIfNull(preset);
        DateRange resolved = preset.Resolve(today);
        if (string.Equals(preset.Id, "all", StringComparison.Ordinal))
        {
            return new DateRange(ResolveAllTimeStart(minDate), resolved.End);
        }

        return resolved;
    }

    /// <summary>
    /// Apply a calendar day tap to the staged range and return the next staged endpoints — the native port of the
    /// web range calendar's selection contract (react-day-picker <c>mode="range"</c>). With no range yet, or when
    /// a complete range already exists, the tap starts a fresh range (<paramref name="day"/> becomes the start,
    /// the end is cleared). With a start but no end, the tap completes the range, normalizing so the earlier day
    /// is the start (tapping the start day again yields a single-day range). The committed value is never touched
    /// here — staging only commits on Apply.
    /// </summary>
    public static (DateOnly? From, DateOnly? To) StageDay((DateOnly? From, DateOnly? To) current, DateOnly day)
    {
        if (current.From is not { } from || current.To is not null)
        {
            return (day, null);
        }

        return day < from ? (day, from) : (from, day);
    }

    /// <summary>
    /// True when the staged range is complete and differs from the committed <paramref name="value"/> — the native
    /// port of the web <c>stagedDirty</c> guard that enables the Apply button only once the user has picked a
    /// different range.
    /// </summary>
    public static bool IsStagedDirty((DateOnly? From, DateOnly? To) staged, DateRange value)
    {
        if (staged.From is not { } from || staged.To is not { } to)
        {
            return false;
        }

        return from != value.Start || to != value.End;
    }

    /// <summary>The staged endpoints as a complete <see cref="DateRange"/>, or null when staging is incomplete.</summary>
    public static DateRange? StagedRange((DateOnly? From, DateOnly? To) staged) =>
        staged.From is { } from && staged.To is { } to ? new DateRange(from, to) : null;

    private static string FormatDay(DateOnly day, bool withYear, CultureInfo culture) =>
        day.ToString(withYear ? "MMM d, yyyy" : "MMM d", culture);
}

/// <summary>
/// PII-safe diagnostics for the date-range picker (P1/S11 diagnostics contract). The picker carries a transient
/// UI range selection, so the collector records ONLY the operational <see cref="RecordViewOpened"/> signal with
/// the surface slug — never the chosen dates, the active preset, or any interaction. Thread-safe; mirrors the
/// shipped surfaces' collectors.
/// </summary>
public sealed class RangePickerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public RangePickerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RangePicker</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={RangePickerRegistration.Slug}"));
    }
}
