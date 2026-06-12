using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>YearReviewPage</c> story player — the native mirror of the
/// data states the web page renders (web/src/features/analytics/pages/YearReviewPage.tsx). The web page runs
/// <c>useVehicles</c> + <c>useYearReview(year, vehicleId)</c> and renders, in precedence order, the full-bleed
/// loading surface (web <c>isLoading || !data</c>), the "no driving data" surface (web
/// <c>total_drives === 0 &amp;&amp; total_charge_sessions === 0</c>), or the swipe-style slide deck (web success).
/// The native port additionally surfaces an explicit <see cref="Error"/> branch (InfoBar + Retry) so a failed
/// fetch never renders a blank region — the never-blank robustness contract (ADR-011). This enum is the
/// top-level summary the ledger / Narrator key off; per-region visibility is driven by the projected flags.
/// </summary>
public enum YearReviewPageState
{
    /// <summary>The vehicles / year-review read is in flight with no review yet (web <c>isLoading || !data</c>).</summary>
    Loading,

    /// <summary>The review resolved with no drives and no charge sessions (web <c>noData</c>) — the friendly empty surface.</summary>
    Empty,

    /// <summary>The read failed (native robustness branch) — an InfoBar + Retry surface, never a blank region.</summary>
    Error,

    /// <summary>The review resolved with activity (web success) — the swipe-style slide deck renders.</summary>
    Success,
}

/// <summary>
/// One selectable vehicle — the native mirror of the web <c>useVehicles</c> row the page maps into the vehicle
/// selector (<c>{ value: String(v.id), label: v.display_name }</c>). Field names mirror the Go API's snake_case
/// JSON tags; parsing is null-tolerant. Pure data — no WinUI types — so the projection is unit-tested without a
/// UI host.
/// </summary>
/// <param name="Id">The vehicle id (web <c>v.id</c>).</param>
/// <param name="DisplayName">The vehicle display name (web <c>v.display_name</c>).</param>
public sealed record YearReviewVehicleOption(long Id, string DisplayName)
{
    /// <summary>Read one vehicle row from a JSON object, tolerating missing / null fields.</summary>
    public static YearReviewVehicleOption FromJson(JsonElement o) => new(
        Id: JsonReads.Long(o, "id"),
        DisplayName: JsonReads.Str(o, "display_name") ?? string.Empty);
}

/// <summary>
/// The year-review payload the page resolves from <c>GET /analytics/year-review</c> (web
/// <c>useYearReview(year, vehicleId)</c>), narrowed to what the page itself reads — the two activity counters
/// that gate the "no data" surface (web <c>total_drives</c> / <c>total_charge_sessions</c>) plus the review
/// <see cref="Year"/> — and carrying the full unwrapped object in <see cref="Raw"/> so the hosted slide deck
/// (<c>SlideRenderer</c> + its sibling slides) reads every other field from the same single fetch, exactly as
/// the web threads one resolved <c>data</c> object into every slide. The tolerant parser unwraps the platform
/// <c>{data:…}</c> envelope so the snake_case wire shape round-trips losslessly. Pure data.
/// </summary>
/// <param name="HasReview">Whether the response carried a year-review object (web <c>!!data</c>).</param>
/// <param name="Year">The review year (web <c>data.year</c>).</param>
/// <param name="TotalDrives">Total drives in the year (web <c>data.total_drives</c>).</param>
/// <param name="TotalChargeSessions">Total charge sessions (web <c>data.total_charge_sessions</c>).</param>
/// <param name="Raw">The unwrapped year-review JSON object, threaded into every hosted slide.</param>
public sealed record YearReviewReport(
    bool HasReview,
    int Year,
    long TotalDrives,
    long TotalChargeSessions,
    JsonElement Raw)
{
    /// <summary>The empty report (no response yet) — the default local-state feed result.</summary>
    public static YearReviewReport Empty { get; } = new(false, 0, 0, 0, default);

    /// <summary>
    /// True when the review carries no drives and no charge sessions — the web "no driving data" branch
    /// (<c>data.total_drives === 0 &amp;&amp; data.total_charge_sessions === 0</c>).
    /// </summary>
    public bool HasNoActivity => TotalDrives == 0 && TotalChargeSessions == 0;

    /// <summary>
    /// Read the year-review response from JSON, tolerating missing / null fields and the platform
    /// <c>{data:…}</c> envelope (internal/platform/httputil.Respond). A non-object payload is treated as "no
    /// review" (the page stays on the loading surface, mirroring the web disabled / unresolved query).
    /// </summary>
    public static YearReviewReport FromJson(JsonElement root)
    {
        JsonElement o = root;
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            o = data;
        }

        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new YearReviewReport(
            HasReview: true,
            Year: (int)JsonReads.Long(o, "year"),
            TotalDrives: JsonReads.Long(o, "total_drives"),
            TotalChargeSessions: JsonReads.Long(o, "total_charge_sessions"),
            Raw: o.Clone());
    }
}

/// <summary>
/// The render-time data model the <c>YearReviewPage</c> projects from — the native analogue of the web page's
/// resolved hook state (web/src/features/analytics/pages/YearReviewPage.tsx): the route <see cref="Year"/>, the
/// <see cref="Vehicles"/> list (web <c>useVehicles</c>) and the <see cref="SelectedVehicleId"/> (web
/// <c>vehicle_id</c> query param), the resolved <see cref="Report"/> (web <c>useYearReview</c>) with its
/// presence + loading + error flags, and the swipe deck's <see cref="SlideCount"/> + <see cref="SlideIndex"/>.
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record YearReviewPageModel(
    int Year,
    IReadOnlyList<YearReviewVehicleOption> Vehicles,
    long? SelectedVehicleId,
    YearReviewReport Report,
    bool HasReport,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    int SlideCount,
    int SlideIndex)
{
    /// <summary>The initial model for a given route year — the first load, no vehicles or review yet.</summary>
    public static YearReviewPageModel Initial(int year, int slideCount) => new(
        Year: year,
        Vehicles: Array.Empty<YearReviewVehicleOption>(),
        SelectedVehicleId: null,
        Report: YearReviewReport.Empty,
        HasReport: false,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        SlideCount: slideCount,
        SlideIndex: 0);
}

/// <summary>One projected vehicle-selector choice (web select option): the id, its display label and whether it is selected.</summary>
public sealed record YearReviewVehicleChoice(long Id, string Label, bool IsSelected);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to,
/// with every visible literal already resolved through the i18n facade. Holds the four data-state flags, the
/// nine ported year-review strings, the error surface copy, and the story-player chrome (the review year, the
/// vehicle selector choices + visibility, the slide count / index / counter text, and the prev/next affordance
/// visibility). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record YearReviewPageDisplay(
    YearReviewPageState State,
    bool ShowLoading,
    bool ShowEmpty,
    bool ShowError,
    bool ShowSuccess,
    string LoadingText,
    string NoDataText,
    string NoDataHintText,
    string GoBackText,
    string SelectVehicleText,
    string PrevText,
    string NextText,
    string CloseText,
    string PageTitle,
    string ErrorText,
    string RetryText,
    int Year,
    IReadOnlyList<YearReviewVehicleChoice> VehicleChoices,
    bool ShowVehicleSelector,
    int SlideCount,
    int SlideIndex,
    string SlideCounterText,
    bool ShowPrev,
    bool ShowNext,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="YearReviewPageModel"/> to its <see cref="YearReviewPageDisplay"/> — the
/// native port of web/src/features/analytics/pages/YearReviewPage.tsx. Reproduces the web render precedence
/// (loading → no-data → deck, plus the native error branch), resolves every one of the nine ported year-review
/// strings through the i18n facade with the same key names the web source feeds into <c>t()</c> (and the same
/// English defaults), formats the page title + no-data line with the route year (web
/// <c>t('yearReview.pageTitle', { year })</c> / <c>t('yearReview.noData', { year })</c>), and derives the
/// vehicle selector + slide-counter chrome. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class YearReviewPageProjection
{
    /// <summary>i18n key for the full-bleed loading line (web <c>t('yearReview.loading')</c>).</summary>
    public const string LoadingKey = "translation.yearReview.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/> (matches the catalog + web default).</summary>
    public const string LoadingFallback = "Building your year in review...";

    /// <summary>i18n key for the "no driving data for {year}" line (web <c>t('yearReview.noData', { year })</c>).</summary>
    public const string NoDataKey = "translation.yearReview.noData";

    /// <summary>English fallback for <see cref="NoDataKey"/> ("{0}" is the year).</summary>
    public const string NoDataFallback = "No driving data for {0}";

    /// <summary>i18n key for the no-data hint (web <c>t('yearReview.noDataHint')</c>).</summary>
    public const string NoDataHintKey = "translation.yearReview.noDataHint";

    /// <summary>English fallback for <see cref="NoDataHintKey"/>.</summary>
    public const string NoDataHintFallback = "Start driving and charging to build your annual review!";

    /// <summary>i18n key for the go-back button (web <c>t('yearReview.goBack')</c>).</summary>
    public const string GoBackKey = "translation.yearReview.goBack";

    /// <summary>English fallback for <see cref="GoBackKey"/>.</summary>
    public const string GoBackFallback = "Go Back";

    /// <summary>i18n key for the vehicle selector label (web <c>t('yearReview.selectVehicle')</c>).</summary>
    public const string SelectVehicleKey = "translation.yearReview.selectVehicle";

    /// <summary>English fallback for <see cref="SelectVehicleKey"/>.</summary>
    public const string SelectVehicleFallback = "Select vehicle";

    /// <summary>i18n key for the previous-slide affordance (web <c>t('yearReview.prev')</c>).</summary>
    public const string PrevKey = "translation.yearReview.prev";

    /// <summary>English fallback for <see cref="PrevKey"/> (matches the catalog value).</summary>
    public const string PrevFallback = "Previous slide";

    /// <summary>i18n key for the next-slide affordance (web <c>t('yearReview.next')</c>).</summary>
    public const string NextKey = "translation.yearReview.next";

    /// <summary>English fallback for <see cref="NextKey"/> (matches the catalog value).</summary>
    public const string NextFallback = "Next slide";

    /// <summary>i18n key for the close button (web <c>t('yearReview.close')</c>).</summary>
    public const string CloseKey = "translation.yearReview.close";

    /// <summary>English fallback for <see cref="CloseKey"/>.</summary>
    public const string CloseFallback = "Close";

    /// <summary>i18n key for the page title (web <c>usePageTitle(t('yearReview.pageTitle', { year }))</c>).</summary>
    public const string PageTitleKey = "translation.yearReview.pageTitle";

    /// <summary>English fallback for <see cref="PageTitleKey"/> ("{0}" is the year).</summary>
    public const string PageTitleFallback = "{0} Year in Review";

    /// <summary>i18n key for the generic load-failure surface (native error branch).</summary>
    public const string LoadFailedKey = "translation.error.loadFailed";

    /// <summary>English fallback for <see cref="LoadFailedKey"/>.</summary>
    public const string LoadFailedFallback = "Failed to load data";

    /// <summary>i18n key for the retry action (native error branch).</summary>
    public const string RetryKey = "translation.common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    public static YearReviewPageDisplay Project(YearReviewPageModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── State precedence (web render order + the native never-blank error branch) ──────────────────────
        YearReviewPageState state;
        if (model.HasError)
        {
            state = YearReviewPageState.Error;
        }
        else if (!model.HasReport)
        {
            // web isLoading || !data: no resolved review yet (includes the disabled-query no-vehicle case).
            state = YearReviewPageState.Loading;
        }
        else if (model.Report.HasNoActivity)
        {
            state = YearReviewPageState.Empty;
        }
        else
        {
            state = YearReviewPageState.Success;
        }

        // ── The nine ported year-review strings ─────────────────────────────────────────────────────────────
        string loadingText = localizer.GetString(LoadingKey, LoadingFallback);
        string noDataText = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(NoDataKey, NoDataFallback),
            model.Year);
        string noDataHintText = localizer.GetString(NoDataHintKey, NoDataHintFallback);
        string goBackText = localizer.GetString(GoBackKey, GoBackFallback);
        string selectVehicleText = localizer.GetString(SelectVehicleKey, SelectVehicleFallback);
        string prevText = localizer.GetString(PrevKey, PrevFallback);
        string nextText = localizer.GetString(NextKey, NextFallback);
        string closeText = localizer.GetString(CloseKey, CloseFallback);
        string pageTitle = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(PageTitleKey, PageTitleFallback),
            model.Year);

        // ── Error surface (native InfoBar + Retry) ──────────────────────────────────────────────────────────
        string loadFailed = localizer.GetString(LoadFailedKey, LoadFailedFallback);
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;
        string retryText = localizer.GetString(RetryKey, RetryFallback);

        // ── Vehicle selector (web: shown only when more than one vehicle) ───────────────────────────────────
        var choices = new List<YearReviewVehicleChoice>(model.Vehicles.Count);
        foreach (var vehicle in model.Vehicles)
        {
            string label = string.IsNullOrEmpty(vehicle.DisplayName)
                ? vehicle.Id.ToString(CultureInfo.CurrentCulture)
                : vehicle.DisplayName;
            choices.Add(new YearReviewVehicleChoice(
                vehicle.Id,
                label,
                model.SelectedVehicleId == vehicle.Id));
        }

        bool showVehicleSelector = model.Vehicles.Count > 1;

        // ── Slide-counter chrome (web "{slideIndex + 1} / {slides.length}") ─────────────────────────────────
        int slideCount = Math.Max(model.SlideCount, 0);
        int slideIndex = slideCount == 0 ? 0 : Math.Clamp(model.SlideIndex, 0, slideCount - 1);
        string slideCounterText = slideCount == 0
            ? string.Empty
            : string.Format(CultureInfo.CurrentCulture, "{0} / {1}", slideIndex + 1, slideCount);
        bool showPrev = slideIndex > 0;
        bool showNext = slideIndex < slideCount - 1;

        string automationName = state switch
        {
            YearReviewPageState.Loading => loadingText,
            YearReviewPageState.Empty => $"{noDataText}. {noDataHintText}",
            YearReviewPageState.Error => errorText,
            _ => $"{pageTitle}. {slideCounterText}",
        };

        return new YearReviewPageDisplay(
            State: state,
            ShowLoading: state == YearReviewPageState.Loading,
            ShowEmpty: state == YearReviewPageState.Empty,
            ShowError: state == YearReviewPageState.Error,
            ShowSuccess: state == YearReviewPageState.Success,
            LoadingText: loadingText,
            NoDataText: noDataText,
            NoDataHintText: noDataHintText,
            GoBackText: goBackText,
            SelectVehicleText: selectVehicleText,
            PrevText: prevText,
            NextText: nextText,
            CloseText: closeText,
            PageTitle: pageTitle,
            ErrorText: errorText,
            RetryText: retryText,
            Year: model.Year,
            VehicleChoices: choices,
            ShowVehicleSelector: showVehicleSelector,
            SlideCount: slideCount,
            SlideIndex: slideIndex,
            SlideCounterText: slideCounterText,
            ShowPrev: showPrev,
            ShowNext: showNext,
            AutomationName: automationName);
    }
}

/// <summary>
/// Canonical metadata for the Year-in-Review page surface — the stable slug emitted with the
/// <c>view.opened</c> event (P1/S11 diagnostics contract), the canonical surface id, and the empty-state glyph.
/// UI-free so the metadata is asserted in tests.
/// </summary>
public static class YearReviewPageRegistration
{
    /// <summary>The diagnostics slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "YearReviewPage";

    /// <summary>The canonical kebab-case surface id.</summary>
    public const string Id = "year-review-page";

    /// <summary>The surface category (the route group).</summary>
    public const string Category = "analytics";

    /// <summary>Segoe Fluent Icons glyph for the empty surface (Calendar — the web 🚗 is decorative).</summary>
    public const string EmptyGlyph = "\uE787";

    /// <summary>The localized page title for the route year (web <c>yearReview.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer, int year)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(YearReviewPageProjection.PageTitleKey, YearReviewPageProjection.PageTitleFallback),
            year);
    }
}

/// <summary>
/// PII-safe diagnostics for the Year-in-Review page surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the year, the vehicle or any review figure
/// — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class YearReviewPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public YearReviewPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=YearReviewPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={YearReviewPageRegistration.Slug}");
    }
}

/// <summary>
/// Minimal null-tolerant JSON scalar reads for the page's own model parse (vehicle id / name, the review year
/// and activity counters). Kept internal to this surface so the page does not couple to a sibling's helper; the
/// hosted slides parse their own slices from the same <see cref="YearReviewReport.Raw"/> object.
/// </summary>
internal static class JsonReads
{
    public static long Long(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) && !double.IsNaN(d) && !double.IsInfinity(d) => (long)d,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    public static double Double(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    public static string? Str(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
