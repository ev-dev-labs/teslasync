using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// The mutually-exclusive render branch of the <c>TitleSlide</c> surface — the native union of what the web
/// component renders (web/src/features/analytics/components/review/TitleSlide.tsx). The web source is a pure
/// presentational component: it takes a single already-resolved <c>data: YearReview</c> prop and performs no
/// fetching, so the branch is a direct function of the input <see cref="TitleSlideModel"/> and there is no
/// fetch-driven loading / error / stale / offline branch to reproduce here (the parent year-in-review story
/// page owns those, exactly as React re-renders the slide with already-resolved props). Both branches map onto
/// a visible surface — neither is ever hidden.
/// </summary>
public enum TitleSlideState
{
    /// <summary>
    /// The year-in-review cover (web's single render path): the car emoji, the animated year, the
    /// "Year in Review" title and the vehicle display name.
    /// </summary>
    Content,

    /// <summary>
    /// No year-in-review data resolved (the absent / sentinel model): the car emoji over the "Year in Review"
    /// title and a friendly "no data" line, never a blank box. The web slide is only mounted once
    /// <c>data</c> is present, so this is the native robustness branch for the not-yet-resolved case.
    /// </summary>
    Empty,
}

/// <summary>
/// The render-time data model the <c>TitleSlide</c> view binds to — the native analogue of the web
/// <c>Props</c> (<c>{ data: YearReview }</c> in
/// web/src/features/analytics/components/review/TitleSlide.tsx), narrowed to the two fields the slide actually
/// reads: the year (<c>data.year</c>) and the vehicle display name (<c>data.vehicle.display_name</c>). Field
/// names mirror the Go API's snake_case JSON tags. Parsing is null-tolerant so a partial payload never throws.
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Year">The review year (web <c>data.year</c>).</param>
/// <param name="VehicleName">The vehicle display name (web <c>data.vehicle.display_name</c>), or null.</param>
public sealed record TitleSlideModel(int Year, string? VehicleName)
{
    /// <summary>The initial / absent model — no year and no vehicle, which renders the empty branch.</summary>
    public static TitleSlideModel Empty { get; } = new(0, null);

    /// <summary>
    /// Project a cached year-in-review payload into a model, mirroring the web prop's always-present
    /// <c>YearReview</c> shape: a JSON object is parsed tolerantly via <see cref="FromJson"/>, while a JSON
    /// <c>null</c> (or any non-object) maps to <see cref="Empty"/> (the empty slide).
    /// </summary>
    public static TitleSlideModel Parse(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object ? FromJson(element) : Empty;

    /// <summary>Project a year-in-review JSON object into a tolerant model.</summary>
    public static TitleSlideModel FromJson(JsonElement obj) =>
        new(GetInt(obj, "year"), GetVehicleName(obj));

    private static int GetInt(JsonElement obj, string name)
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

    private static string? GetVehicleName(JsonElement obj)
    {
        if (!obj.TryGetProperty("vehicle", out var vehicle) || vehicle.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return vehicle.TryGetProperty("display_name", out var name) && name.ValueKind == JsonValueKind.String
            ? name.GetString()
            : null;
    }
}

/// <summary>
/// The fully projected, render-ready view of the title slide — the native analogue of everything the web
/// component composes before returning JSX. Holds the resolved <see cref="State"/>, the emoji, the animated
/// year (both its numeric target and its grouped text), the localized title, the vehicle name (content branch),
/// the empty copy (empty branch) and the composed Narrator name. Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Emoji">The car emoji (both branches).</param>
/// <param name="YearValue">The numeric count-up target for the animated year (content branch).</param>
/// <param name="YearText">The grouped year text, e.g. "2,026" (content branch + Narrator name).</param>
/// <param name="Title">The localized "Year in Review" title (both branches).</param>
/// <param name="VehicleName">The vehicle display name, or an em dash when blank (content branch).</param>
/// <param name="EmptyMessage">The localized "no data" copy (empty branch).</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record TitleSlideDisplay(
    TitleSlideState State,
    string Emoji,
    double YearValue,
    string YearText,
    string Title,
    string VehicleName,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// Pure projection from the input <see cref="TitleSlideModel"/> + localizer to the render-ready
/// <see cref="TitleSlideDisplay"/> — the native port of the branch selection, the year formatting and the
/// localized strings in web/src/features/analytics/components/review/TitleSlide.tsx. The year is grouped with
/// the same en-US contract the web <c>AnimatedNumber</c> applies through <c>fmtNumber</c> /
/// <c>toLocaleString</c> (e.g. 2026 → "2,026"). UI-free so the whole contract is unit-tested without a XAML
/// runtime.
/// </summary>
public static class TitleSlideProjection
{
    /// <summary>i18n key for the title (web <c>t('yearReview.title', …)</c>).</summary>
    public const string TitleKey = "yearReview.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (matches the web default).</summary>
    public const string TitleFallback = "Year in Review";

    /// <summary>i18n key for the empty-state copy (the native robustness branch's friendly line).</summary>
    public const string NoDataKey = "yearReview.noDriveData";

    /// <summary>English fallback for <see cref="NoDataKey"/> (matches the catalog value).</summary>
    public const string NoDataFallback = "No drive data for this year";

    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> for the active <paramref name="localizer"/>.</summary>
    public static TitleSlideDisplay Project(TitleSlideModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(TitleKey, TitleFallback);
        bool hasVehicle = !string.IsNullOrWhiteSpace(model.VehicleName);

        // The web slide always renders content from an already-resolved YearReview; the empty branch is the
        // native robustness path for the absent / sentinel model (no year and no vehicle to title).
        if (model.Year <= 0 && !hasVehicle)
        {
            string emptyMessage = localizer.GetString(NoDataKey, NoDataFallback);
            return new TitleSlideDisplay(
                TitleSlideState.Empty,
                TitleSlideRegistration.CarEmoji,
                YearValue: 0,
                YearText: string.Empty,
                title,
                VehicleName: string.Empty,
                emptyMessage,
                AutomationName: string.Concat(title, ", ", emptyMessage));
        }

        string yearText = FormatYear(model.Year);
        string vehicleName = hasVehicle ? model.VehicleName! : EmDash;

        return new TitleSlideDisplay(
            TitleSlideState.Content,
            TitleSlideRegistration.CarEmoji,
            model.Year,
            yearText,
            title,
            vehicleName,
            EmptyMessage: string.Empty,
            AutomationName: string.Join(", ", yearText, title, vehicleName));
    }

    /// <summary>
    /// Format the year with the en-US grouping contract the web <c>AnimatedNumber</c> renders through
    /// <c>fmtNumber</c> / <c>toLocaleString</c> (e.g. 2026 → "2,026"), matching what the live count-up shows.
    /// </summary>
    public static string FormatYear(int year) =>
        NumberFormatting.Format(year, null, 0);
}

/// <summary>
/// Canonical metadata for the Title Slide surface — the stable slug emitted with the <c>view.opened</c> event
/// (P1/S11 diagnostics contract) and the car emoji the web component hard-codes (🚗). UI-free so the metadata
/// is asserted in tests.
/// </summary>
public static class TitleSlideRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TitleSlide";

    /// <summary>The car emoji the web slide hard-codes (🚗, U+1F697).</summary>
    public const string CarEmoji = "\uD83D\uDE97";
}

/// <summary>
/// PII-safe diagnostics for the Title Slide surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the year or the vehicle name — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class TitleSlideDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TitleSlideDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TitleSlide</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TitleSlideRegistration.Slug}");
    }
}
