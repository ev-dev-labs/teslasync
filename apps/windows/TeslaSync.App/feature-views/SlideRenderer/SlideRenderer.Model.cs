using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// The slide kind a <see cref="SlideRendererProjection"/> dispatches to — the native union of the ten
/// <c>switch (slide.type)</c> branches in
/// web/src/features/analytics/components/review/SlideRenderer.tsx, plus <see cref="Unknown"/> for the web
/// <c>default: return null</c> arm. SlideRenderer is a pure presentational dispatcher: the parent
/// <c>YearReviewPage</c> owns the <c>useYearReview</c> query (and therefore every loading / error / stale /
/// offline branch); this component only maps a single resolved <c>slide</c> + <c>data</c> onto the slide it
/// should host, so the branch is a direct function of <see cref="SlideDescriptor.Type"/> — there is no
/// fetch-driven state here to reproduce. Each known kind is hosted through the <c>ISlideContentFactory</c>
/// seam (the native analogue of the web child-component imports); <see cref="DriveHighlight"/> additionally
/// carries the emoji + localized label + selected drive that the web source resolves inside SlideRenderer.
/// </summary>
public enum SlideKind
{
    /// <summary>web <c>'title'</c> → <c>TitleSlide</c>.</summary>
    Title,

    /// <summary>web <c>'stat-hero'</c> → <c>StatHeroSlide</c> (uses <see cref="SlideDisplay.Field"/>).</summary>
    StatHero,

    /// <summary>web <c>'stat-chart'</c> → <c>StatChartSlide</c>.</summary>
    StatChart,

    /// <summary>web <c>'drive-highlight'</c> → <c>DriveHighlightSlide</c> (resolved by SlideRenderer).</summary>
    DriveHighlight,

    /// <summary>web <c>'charging-breakdown'</c> → <c>ChargingBreakdownSlide</c>.</summary>
    ChargingBreakdown,

    /// <summary>web <c>'savings'</c> → <c>SavingsSlide</c>.</summary>
    Savings,

    /// <summary>web <c>'environment'</c> → <c>EnvironmentSlide</c>.</summary>
    Environment,

    /// <summary>web <c>'patterns'</c> → <c>PatternsSlide</c>.</summary>
    Patterns,

    /// <summary>web <c>'comparisons'</c> → <c>ComparisonsSlide</c> (fed <c>data.comparisons</c>).</summary>
    Comparisons,

    /// <summary>web <c>'summary'</c> → <c>SummarySlide</c>.</summary>
    Summary,

    /// <summary>An unrecognised slide type — the web <c>default: return null</c> arm (rendered as empty).</summary>
    Unknown,
}

/// <summary>
/// Which extreme a <c>drive-highlight</c> slide highlights — the web
/// <c>slide.field === 'longest' ? data.longest_drive : data.most_efficient_drive</c> selection.
/// </summary>
public enum DriveHighlightKind
{
    /// <summary>The longest drive of the year (web <c>field === 'longest'</c>, mountain emoji).</summary>
    Longest,

    /// <summary>The most efficient drive of the year (the web fall-through, herb emoji).</summary>
    MostEfficient,
}

/// <summary>
/// An 8-bit RGB colour — the WinUI-free stand-in for a gradient stop so the
/// <see cref="SlideRendererProjection.ParseGradient"/> Tailwind-token parse is unit-tested without a UI host.
/// The view converts it to a <c>Windows.UI.Color</c> at render time.
/// </summary>
public readonly record struct SlideColor(byte R, byte G, byte B);

/// <summary>
/// The three-stop diagonal background gradient a slide paints — the native model of the web
/// <c>bg-gradient-to-br from-… via-… to-…</c> class on <c>slide.bg</c>. <see cref="From"/> sits at the
/// top-left (offset 0), <see cref="Via"/> at the midpoint (0.5) and <see cref="To"/> at the bottom-right
/// (offset 1), matching <c>to-br</c>.
/// </summary>
public readonly record struct SlideGradient(SlideColor From, SlideColor Via, SlideColor To);

/// <summary>
/// One highlighted drive — the native mirror of the web <c>YearReviewDriveHighlight</c>
/// (<c>drive_id</c>, <c>date</c>, <c>distance_km</c> SI km, <c>duration_min</c>, <c>start_address</c>,
/// <c>end_address</c>, <c>efficiency_wh_km</c> SI Wh/km). Named <c>SlideDriveHighlight</c> here (not
/// <c>YearReviewDriveHighlight</c>) so it does not clash with the sibling <c>DriveHighlightSlide</c>
/// surface's own same-named model in this namespace. Pure data; the detailed stat card + its unit
/// conversion are the sibling <c>DriveHighlightSlide</c> surface's job — SlideRenderer only forwards the
/// drive plus the route/date its own caption shows.
/// </summary>
public sealed record SlideDriveHighlight(
    long DriveId,
    string Date,
    double DistanceKm,
    int DurationMin,
    string StartAddress,
    string EndAddress,
    double EfficiencyWhKm)
{
    /// <summary>Project a year-review drive-highlight JSON object (null-tolerant).</summary>
    public static SlideDriveHighlight FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new SlideDriveHighlight(0, string.Empty, 0, 0, string.Empty, string.Empty, 0);
        }

        return new SlideDriveHighlight(
            DriveId: JsonScalars.GetLong(element, "drive_id"),
            Date: JsonScalars.GetString(element, "date"),
            DistanceKm: JsonScalars.GetDouble(element, "distance_km"),
            DurationMin: (int)Math.Round(JsonScalars.GetDouble(element, "duration_min")),
            StartAddress: JsonScalars.GetString(element, "start_address"),
            EndAddress: JsonScalars.GetString(element, "end_address"),
            EfficiencyWhKm: JsonScalars.GetDouble(element, "efficiency_wh_km"));
    }
}

/// <summary>
/// One "fun comparison" chip — the native mirror of the web <c>YearReviewComparison</c>
/// (<c>label</c>, <c>value</c>, <c>emoji</c>). SlideRenderer forwards the list to the <c>ComparisonsSlide</c>
/// child (web <c>comparisons={data.comparisons}</c>); it is modelled here so the dispatcher can carry it.
/// </summary>
public sealed record YearReviewComparison(string Label, string Value, string Emoji)
{
    /// <summary>Project a comparison JSON object (null-tolerant).</summary>
    public static YearReviewComparison FromJson(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object
            ? new YearReviewComparison(
                JsonScalars.GetString(element, "label"),
                JsonScalars.GetString(element, "value"),
                JsonScalars.GetString(element, "emoji"))
            : new YearReviewComparison(string.Empty, string.Empty, string.Empty);
}

/// <summary>
/// The year-review payload SlideRenderer receives as a prop — the native mirror of the web
/// <c>YearReview</c> object the parent <c>YearReviewPage</c> resolves from
/// <c>GET /analytics/year-review</c> and threads into every slide. The dispatcher itself only reads
/// <see cref="LongestDrive"/> / <see cref="MostEfficientDrive"/> (the <c>drive-highlight</c> selection),
/// <see cref="Comparisons"/> (forwarded to <c>ComparisonsSlide</c>) and <see cref="Year"/> (the accessible
/// region name); the full payload rides along in <see cref="Raw"/> so the <c>ISlideContentFactory</c> can
/// build the remaining sibling slides without SlideRenderer re-modelling all 30 fields. Pure data — the
/// <see cref="FromJson"/> adapter is unit-tested without a UI host.
/// </summary>
public sealed record YearReviewSnapshot(
    int Year,
    SlideDriveHighlight? LongestDrive,
    SlideDriveHighlight? MostEfficientDrive,
    IReadOnlyList<YearReviewComparison> Comparisons,
    JsonElement Raw)
{
    /// <summary>An empty snapshot — the parse fallback for an absent / non-object body.</summary>
    public static YearReviewSnapshot Empty { get; } =
        new(0, null, null, Array.Empty<YearReviewComparison>(), default);

    /// <summary>Project a <c>GET /analytics/year-review</c> JSON object into a tolerant snapshot.</summary>
    public static YearReviewSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new YearReviewSnapshot(
            Year: (int)Math.Round(JsonScalars.GetDouble(element, "year")),
            LongestDrive: ReadDrive(element, "longest_drive"),
            MostEfficientDrive: ReadDrive(element, "most_efficient_drive"),
            Comparisons: ReadComparisons(element),
            Raw: element.Clone());
    }

    private static SlideDriveHighlight? ReadDrive(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var drive) && drive.ValueKind == JsonValueKind.Object
            ? SlideDriveHighlight.FromJson(drive)
            : null;

    private static IReadOnlyList<YearReviewComparison> ReadComparisons(JsonElement parent)
    {
        if (!parent.TryGetProperty("comparisons", out var list) || list.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<YearReviewComparison>();
        }

        var result = new List<YearReviewComparison>(list.GetArrayLength());
        foreach (var item in list.EnumerateArray())
        {
            result.Add(YearReviewComparison.FromJson(item));
        }

        return result;
    }
}

/// <summary>
/// One slide's definition — the native mirror of the web <c>SlideDefinition</c> (<c>type</c>, <c>bg</c>,
/// optional <c>field</c>). The parent story player owns the ordered <c>SLIDE_DEFS</c> list and hands a
/// single descriptor (plus its index + the shared <see cref="YearReviewSnapshot"/>) to the dispatcher.
/// </summary>
public sealed record SlideDescriptor(string Type, string Background, string? Field = null);

/// <summary>
/// The render-time input SlideRenderer binds to — the native analogue of the web component's three props
/// (<c>slideIndex</c>, <c>slide</c>, <c>data</c>). Pure data so the projection is unit-tested without a UI
/// host.
/// </summary>
public sealed record SlideRenderModel(int SlideIndex, SlideDescriptor Slide, YearReviewSnapshot Data);

/// <summary>
/// The fully resolved <c>drive-highlight</c> selection — the native form of the props the web SlideRenderer
/// hands to <c>DriveHighlightSlide</c>: which extreme, the localized <see cref="Label"/>
/// (<c>t('yearReview.longestDrive' | 'mostEfficient')</c>), the <see cref="Emoji"/> and the chosen
/// <see cref="Drive"/> (<c>data.longest_drive</c> / <c>data.most_efficient_drive</c>, possibly null).
/// </summary>
public sealed record DriveHighlightSelection(
    DriveHighlightKind Kind,
    string Label,
    string Emoji,
    SlideDriveHighlight? Drive);

/// <summary>
/// The fully projected, render-ready view of a single slide — everything the WinUI view needs to paint the
/// gradient canvas, host the slide body and announce the surface. Pure data so every branch is asserted
/// headlessly: <see cref="Kind"/> + <see cref="Field"/> (the dispatch), <see cref="Gradient"/> (the parsed
/// <c>slide.bg</c>), <see cref="DriveHighlight"/> (set only for <see cref="SlideKind.DriveHighlight"/>),
/// <see cref="Comparisons"/> (forwarded), <see cref="DelegatesContent"/> (the body comes from the
/// sibling-slide factory), <see cref="IsEmpty"/> + <see cref="EmptyMessage"/> (the never-blank fallback for
/// the web <c>default: null</c> / absent data) and the Narrator <see cref="AutomationName"/>.
/// </summary>
public sealed record SlideDisplay(
    int SlideIndex,
    SlideKind Kind,
    string Field,
    SlideGradient Gradient,
    DriveHighlightSelection? DriveHighlight,
    IReadOnlyList<YearReviewComparison> Comparisons,
    bool DelegatesContent,
    bool IsEmpty,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// The payload SlideRenderer hands to an <c>ISlideContentFactory</c> so the host can build the sibling slide
/// for a known kind — the native analogue of the props the web SlideRenderer spreads onto each child
/// component. WinUI-free so the seam contract is exercised headlessly.
/// </summary>
public sealed record SlideContentRequest(
    int SlideIndex,
    SlideKind Kind,
    string Field,
    DriveHighlightSelection? DriveHighlight,
    YearReviewSnapshot Data,
    SlideGradient Gradient);

/// <summary>
/// Pure projection from a <see cref="SlideRenderModel"/> to its <see cref="SlideDisplay"/> — the native port
/// of web/src/features/analytics/components/review/SlideRenderer.tsx. Reproduces the web dispatch exactly:
/// the <c>switch (slide.type)</c> kind map, the <c>field ?? 'distance'</c> stat-hero default, the
/// <c>drive-highlight</c> selection (which drive + the <c>t()</c> label + the emoji), the
/// <c>bg-gradient-to-br</c> Tailwind-token parse and the <c>default: null</c> arm (rendered as a never-blank
/// empty surface). Every label resolves through the i18n facade with the same two keys the source feeds into
/// <c>t()</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SlideRendererProjection
{
    /// <summary>i18n key for the longest-drive label (web <c>t('yearReview.longestDrive')</c>).</summary>
    public const string LongestDriveKey = "translation.yearReview.longestDrive";

    /// <summary>i18n key for the most-efficient-drive label (web <c>t('yearReview.mostEfficient')</c>).</summary>
    public const string MostEfficientKey = "translation.yearReview.mostEfficient";

    /// <summary>i18n key for the never-blank empty fallback (the wider year-review feature's no-data string).</summary>
    public const string NoDataKey = "translation.yearReview.noData";

    /// <summary>i18n key for the accessible slide region name on the populated kinds.</summary>
    public const string PageTitleKey = "translation.yearReview.pageTitle";

    /// <summary>The mountain emoji the web source pins to the longest-drive slide.</summary>
    public const string LongestEmoji = "\U0001F3D4\uFE0F";

    /// <summary>The herb emoji the web source pins to the most-efficient-drive slide.</summary>
    public const string MostEfficientEmoji = "\U0001F33F";

    /// <summary>The web stat-hero default field (<c>slide.field ?? 'distance'</c>).</summary>
    public const string DefaultStatHeroField = "distance";

    /// <summary>The web <c>slide.field</c> value selecting the longest drive.</summary>
    public const string LongestField = "longest";

    private const string EmDash = "\u2014";

    // slate-900 — the gradient fallback. A literal (not a TailwindPalette lookup) so it is independent of
    // static field initialization order.
    private static readonly SlideColor FallbackColor = new(0x0F, 0x17, 0x2A);

    /// <summary>Project <paramref name="model"/> into a render-ready slide display using the i18n facade.</summary>
    public static SlideDisplay Project(SlideRenderModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var kind = ParseKind(model.Slide.Type);
        string field = ResolveField(kind, model.Slide.Field);
        var gradient = ParseGradient(model.Slide.Background);
        var driveHighlight = kind == SlideKind.DriveHighlight
            ? ResolveDriveHighlight(model.Slide.Field, model.Data, localizer)
            : null;

        bool isEmpty = kind == SlideKind.Unknown;
        bool delegatesContent = !isEmpty && kind != SlideKind.DriveHighlight;

        // The localized no-data string is always resolved so the view has a never-blank fallback for both the
        // unknown-kind arm (web default: null) and a known kind whose sibling-slide body is not wired.
        string emptyMessage = EmptyMessage(model.Data.Year, localizer);
        string automationName = BuildAutomationName(kind, driveHighlight, model.Data.Year, emptyMessage, localizer);

        return new SlideDisplay(
            SlideIndex: model.SlideIndex,
            Kind: kind,
            Field: field,
            Gradient: gradient,
            DriveHighlight: driveHighlight,
            Comparisons: model.Data.Comparisons,
            DelegatesContent: delegatesContent,
            IsEmpty: isEmpty,
            EmptyMessage: emptyMessage,
            AutomationName: automationName);
    }

    /// <summary>Map a web <c>slide.type</c> string onto its <see cref="SlideKind"/> (unknown → <see cref="SlideKind.Unknown"/>).</summary>
    public static SlideKind ParseKind(string? type) => type switch
    {
        "title" => SlideKind.Title,
        "stat-hero" => SlideKind.StatHero,
        "stat-chart" => SlideKind.StatChart,
        "drive-highlight" => SlideKind.DriveHighlight,
        "charging-breakdown" => SlideKind.ChargingBreakdown,
        "savings" => SlideKind.Savings,
        "environment" => SlideKind.Environment,
        "patterns" => SlideKind.Patterns,
        "comparisons" => SlideKind.Comparisons,
        "summary" => SlideKind.Summary,
        _ => SlideKind.Unknown,
    };

    /// <summary>Resolve the slide field — the web <c>field ?? 'distance'</c> default applies to stat-hero only.</summary>
    public static string ResolveField(SlideKind kind, string? field) => kind switch
    {
        SlideKind.StatHero => string.IsNullOrEmpty(field) ? DefaultStatHeroField : field,
        _ => field ?? string.Empty,
    };

    /// <summary>Resolve the drive-highlight selection (web <c>slide.field === 'longest'</c> branch).</summary>
    public static DriveHighlightSelection ResolveDriveHighlight(
        string? field,
        YearReviewSnapshot data,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        if (string.Equals(field, LongestField, StringComparison.Ordinal))
        {
            return new DriveHighlightSelection(
                DriveHighlightKind.Longest,
                localizer.GetString(LongestDriveKey, "Longest Drive"),
                LongestEmoji,
                data.LongestDrive);
        }

        return new DriveHighlightSelection(
            DriveHighlightKind.MostEfficient,
            localizer.GetString(MostEfficientKey, "Most Efficient Drive"),
            MostEfficientEmoji,
            data.MostEfficientDrive);
    }

    /// <summary>
    /// Parse a Tailwind <c>bg-gradient-to-br from-… via-… to-…</c> class string into a three-stop
    /// <see cref="SlideGradient"/>. Unknown / missing tokens fall back to <c>slate-900</c>; an absent
    /// <c>via</c> stop is interpolated as the midpoint of <c>from</c> and <c>to</c>.
    /// </summary>
    public static SlideGradient ParseGradient(string? background)
    {
        SlideColor? from = null;
        SlideColor? via = null;
        SlideColor? to = null;

        if (!string.IsNullOrWhiteSpace(background))
        {
            var tokens = background.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            foreach (var token in tokens)
            {
                if (TryStop(token, "from-", out var f))
                {
                    from = f;
                }
                else if (TryStop(token, "via-", out var v))
                {
                    via = v;
                }
                else if (TryStop(token, "to-", out var t))
                {
                    to = t;
                }
            }
        }

        var fromColor = from ?? FallbackColor;
        var toColor = to ?? fromColor;
        var viaColor = via ?? Midpoint(fromColor, toColor);
        return new SlideGradient(fromColor, viaColor, toColor);
    }

    /// <summary>Resolve the named Tailwind colour (the <c>-900</c> palette the slide defs use) to RGB.</summary>
    public static SlideColor Tailwind(string colorName) =>
        TailwindPalette.TryGetValue(colorName, out var color) ? color : FallbackColor;

    /// <summary>A short "start → end" route summary for the drive-highlight caption / Narrator name.</summary>
    public static string RouteSummary(SlideDriveHighlight? drive)
    {
        if (drive is null)
        {
            return string.Empty;
        }

        string start = string.IsNullOrWhiteSpace(drive.StartAddress) ? EmDash : drive.StartAddress;
        string end = string.IsNullOrWhiteSpace(drive.EndAddress) ? EmDash : drive.EndAddress;
        if (start == EmDash && end == EmDash)
        {
            return string.Empty;
        }

        return string.Format(CultureInfo.CurrentCulture, "{0} \u2192 {1}", start, end);
    }

    private static bool TryStop(string token, string prefix, out SlideColor color)
    {
        if (token.StartsWith(prefix, StringComparison.Ordinal))
        {
            color = Tailwind(token[prefix.Length..]);
            return true;
        }

        color = default;
        return false;
    }

    private static SlideColor Midpoint(SlideColor a, SlideColor b) => new(
        (byte)((a.R + b.R) / 2),
        (byte)((a.G + b.G) / 2),
        (byte)((a.B + b.B) / 2));

    private static string EmptyMessage(int year, ILocalizer localizer) =>
        string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(NoDataKey, "No driving data for {0}"),
            year);

    private static string BuildAutomationName(
        SlideKind kind,
        DriveHighlightSelection? driveHighlight,
        int year,
        string emptyMessage,
        ILocalizer localizer)
    {
        if (kind == SlideKind.Unknown)
        {
            return emptyMessage;
        }

        if (kind == SlideKind.DriveHighlight && driveHighlight is { } highlight)
        {
            string route = RouteSummary(highlight.Drive);
            return string.IsNullOrEmpty(route)
                ? highlight.Label
                : string.Format(CultureInfo.CurrentCulture, "{0}. {1}", highlight.Label, route);
        }

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(PageTitleKey, "{0} Year in Review"),
            year);
    }

    private static readonly Dictionary<string, SlideColor> TailwindPalette =
        new(StringComparer.Ordinal)
        {
            ["slate-900"] = new(0x0F, 0x17, 0x2A),
            ["blue-900"] = new(0x1E, 0x3A, 0x8A),
            ["indigo-900"] = new(0x31, 0x2E, 0x81),
            ["emerald-900"] = new(0x06, 0x4E, 0x3B),
            ["green-900"] = new(0x14, 0x53, 0x2D),
            ["teal-900"] = new(0x13, 0x4E, 0x4A),
            ["purple-900"] = new(0x58, 0x1C, 0x87),
            ["violet-900"] = new(0x4C, 0x1D, 0x95),
            ["amber-900"] = new(0x78, 0x35, 0x0F),
            ["orange-900"] = new(0x7C, 0x2D, 0x12),
            ["yellow-900"] = new(0x71, 0x3F, 0x12),
            ["cyan-900"] = new(0x16, 0x4E, 0x63),
            ["sky-900"] = new(0x0C, 0x4A, 0x6E),
            ["red-900"] = new(0x7F, 0x1D, 0x1D),
            ["pink-900"] = new(0x83, 0x18, 0x43),
            ["lime-900"] = new(0x36, 0x53, 0x14),
            ["rose-900"] = new(0x88, 0x13, 0x37),
            ["fuchsia-900"] = new(0x70, 0x1A, 0x75),
        };
}

/// <summary>Null-tolerant JSON scalar readers shared by the year-review adapters.</summary>
internal static class JsonScalars
{
    public static string GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() ?? string.Empty
            : string.Empty;

    public static double GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => Finite(n),
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => Finite(n),
            _ => 0,
        };
    }

    public static long GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    private static double Finite(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0 : value;
}

/// <summary>
/// Canonical metadata for the <c>SlideRenderer</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/analytics/components/review/SlideRenderer.tsx</c>.
/// </summary>
public static class SlideRendererRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "slide-renderer";

    /// <summary>Surface category (the analytics year-in-review feature).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SlideRenderer";
}

/// <summary>
/// PII-safe diagnostics for the <c>SlideRenderer</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a drive, route, VIN or any year-review
/// metric — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SlideRendererDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SlideRendererDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SlideRenderer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SlideRendererRegistration.Slug}");
    }
}
