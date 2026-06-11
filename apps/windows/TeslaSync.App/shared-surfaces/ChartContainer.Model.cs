using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.ChartContainerSurface;

// This surface lives in its own per-surface sub-namespace (the same isolation pattern VisuallyHidden uses)
// because its value types — Direction, ChartAxis, AnnotationCategory, HiddenSeriesState, CreateAnnotationInput,
// ChartContainerOptions … — have intentionally generic names that would collide with peer surfaces in the flat
// TeslaSync.App.SharedSurfaces namespace once a chain of integration merges combines them (CS0101).

/// <summary>
/// Canonical metadata + i18n catalog keys for the ChartContainer shared surface — the native analogue of the
/// module-level constants and the <c>t('…')</c> call sites in web/src/components/charts/ChartContainer.tsx. Every
/// user-facing string the web component renders is registered here as a catalog key plus its verbatim English
/// fallback so the native surface resolves the exact same key through the P1/S10 <see cref="ILocalizer"/> facade
/// (the native catalog uses positional <c>{0}</c> interpolation where the web uses i18next <c>{{title}}</c>).
/// </summary>
public static class ChartContainerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ChartContainer";

    /// <summary>The UI-automation id mirroring the web figure's stable identity (web <c>useId()</c> figure root).</summary>
    public const string RootAutomationId = "chart-container-root";

    /// <summary>The "Add annotation" action i18n key (web <c>annotations.add</c>).</summary>
    public const string AddAnnotationKey = "translation.annotations.add";

    /// <summary>The English fallback for the add-annotation action (the web default literal).</summary>
    public const string AddAnnotationFallback = "Add annotation";

    /// <summary>The "Show annotations" toggle i18n key (web <c>annotations.show</c>).</summary>
    public const string ShowAnnotationsKey = "translation.annotations.show";

    /// <summary>The English fallback for the show-annotations toggle (the web default literal).</summary>
    public const string ShowAnnotationsFallback = "Show annotations";

    /// <summary>The "Hide annotations" toggle i18n key (web <c>annotations.hide</c>).</summary>
    public const string HideAnnotationsKey = "translation.annotations.hide";

    /// <summary>The English fallback for the hide-annotations toggle (the web default literal).</summary>
    public const string HideAnnotationsFallback = "Hide annotations";

    /// <summary>The mobile annotation marker-row label i18n key (web <c>annotations.markerRow</c>).</summary>
    public const string MarkerRowKey = "translation.annotations.markerRow";

    /// <summary>The English fallback for the marker-row label (the web default literal).</summary>
    public const string MarkerRowFallback = "Annotations on this chart";

    /// <summary>The empty-state message i18n key (web <c>chart.noData</c>).</summary>
    public const string NoDataKey = "translation.chart.noData";

    /// <summary>The English fallback for the empty-state message (the web default literal).</summary>
    public const string NoDataFallback = "No data available";

    /// <summary>The section-error-boundary fallback title i18n key (web <c>errors.section.chartTitle</c>).</summary>
    public const string ChartFailedKey = "translation.errors.section.chartTitle";

    /// <summary>The English fallback for the chart-failed title (the web default literal).</summary>
    public const string ChartFailedFallback = "This chart failed to load";

    /// <summary>The accessible fallback-table caption i18n key (web <c>chart.a11y.fallbackTableLabel</c>).</summary>
    public const string FallbackTableLabelKey = "translation.chart.a11y.fallbackTableLabel";

    /// <summary>The English fallback template for the fallback-table caption (web <c>{{title}} — data table</c>).</summary>
    public const string FallbackTableLabelFallback = "{0} \u2014 data table";

    /// <summary>The accessible bare-summary i18n key (web <c>chart.a11y.summary</c>).</summary>
    public const string SummaryKey = "translation.chart.a11y.summary";

    /// <summary>The English fallback template for the bare summary (web <c>Chart: {{title}}</c>).</summary>
    public const string SummaryFallback = "Chart: {0}";

    /// <summary>The add-popover date-field label i18n key (the web AddAnnotationPopover's editable date field).</summary>
    public const string DateKey = "translation.common.date";

    /// <summary>The English fallback for the date-field label.</summary>
    public const string DateFallback = "Date";

    /// <summary>The add-popover cancel-action i18n key (the web AddAnnotationPopover's <c>onCancel</c> affordance).</summary>
    public const string CancelKey = "translation.common.cancel";

    /// <summary>The English fallback for the cancel action.</summary>
    public const string CancelFallback = "Cancel";

    /// <summary>Resolve <paramref name="key"/> with its fallback, guarding a null localizer.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="key">The catalog key.</param>
    /// <param name="fallback">The English fallback.</param>
    /// <returns>The localized string, or the fallback.</returns>
    public static string Resolve(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }

    /// <summary>
    /// Interpolate a chart title into a localized template. Substitutes both the native positional token
    /// (<c>{0}</c>) and the web i18next token (<c>{{title}}</c>) so the same projection works whether the string
    /// came from the resw catalog or the English fallback; a token-free template is returned unchanged. Uses a
    /// literal replace (never <see cref="string.Format(IFormatProvider, string, object?)"/>) so a localized value
    /// that happens to contain a stray brace can never throw a <see cref="FormatException"/>.
    /// </summary>
    /// <param name="template">The localized template carrying a <c>{0}</c> / <c>{{title}}</c> title token.</param>
    /// <param name="title">The chart title substituted for the title token.</param>
    /// <returns>The interpolated string.</returns>
    public static string Format(string template, string title)
    {
        ArgumentNullException.ThrowIfNull(template);
        string value = title ?? string.Empty;
        return template
            .Replace("{{title}}", value, StringComparison.Ordinal)
            .Replace("{0}", value, StringComparison.Ordinal);
    }
}

/// <summary>
/// The mutually-exclusive body a chart figure renders — the native analogue of the web ChartContainer's
/// <c>loading ? &lt;Spinner/&gt; : empty ? &lt;EmptyState/&gt; : children</c> branch (the render-error
/// <c>SectionErrorBoundary</c> wraps the <see cref="Ready"/> body and is a separate concern). A chart never
/// collapses to a blank panel: every state renders a distinct, labelled body.
/// </summary>
public enum ChartBodyState
{
    /// <summary>Initial fetch — the web <c>loading</c> branch shows a centred spinner.</summary>
    Loading,

    /// <summary>Data resolved to nothing — the web <c>empty</c> branch shows the friendly empty state.</summary>
    Empty,

    /// <summary>Data present — the web default branch renders the chart children inside the error boundary.</summary>
    Ready,
}

/// <summary>Writing direction — the native analogue of the web <c>Direction</c> type (web/src/lib/i18nDir.ts).</summary>
public enum Direction
{
    /// <summary>Left-to-right (web <c>'ltr'</c>).</summary>
    Ltr,

    /// <summary>Right-to-left (web <c>'rtl'</c>).</summary>
    Rtl,
}

/// <summary>A cartesian chart axis — the native analogue of the web <c>axis: 'x' | 'y'</c> argument.</summary>
public enum ChartAxis
{
    /// <summary>The horizontal axis (web <c>'x'</c>).</summary>
    X,

    /// <summary>The vertical axis (web <c>'y'</c>).</summary>
    Y,
}

/// <summary>
/// Writing-direction primitives — the native port of web/src/lib/i18nDir.ts. Reproduces <c>getLangDir</c>
/// (language-tag → direction) and <c>textAnchorForDir</c> (the Recharts axis-label anchor flip the web
/// <c>useChartLabelAnchor</c> hook returns), so a native chart's axis labels align to the inside edge in both
/// directions exactly as the web charts do. Pure and side-effect-free so the mapping is unit-tested headlessly.
/// </summary>
public static class ChartDirection
{
    // web RTL_LANGS — the frozen set of RTL ISO-639-1 primary subtags. Ordinal-case-insensitive membership
    // reproduces the web `lang.toLowerCase()` normalisation without a culture-sensitive lowercasing.
    private static readonly HashSet<string> RtlLanguages =
        new(StringComparer.OrdinalIgnoreCase) { "ar", "he", "fa", "ur" };

    /// <summary>
    /// Resolve the writing direction for an i18next-style language tag (web <c>getLangDir</c>). The tag is split
    /// on <c>'-'</c> so a region subtag (<c>ar-SA</c>, <c>he-IL</c>, <c>pt-BR</c>) resolves to the same direction
    /// as its bare primary subtag; empty / null input falls back to <see cref="Direction.Ltr"/>.
    /// </summary>
    /// <param name="lang">The language tag (e.g. <c>"ar"</c>, <c>"he-IL"</c>, <c>"en"</c>).</param>
    /// <returns>The resolved writing direction.</returns>
    public static Direction Resolve(string? lang)
    {
        if (string.IsNullOrEmpty(lang))
        {
            return Direction.Ltr;
        }

        string primary = lang.Split('-')[0];
        return RtlLanguages.Contains(primary) ? Direction.Rtl : Direction.Ltr;
    }

    /// <summary>
    /// Pick the SVG <c>text-anchor</c> value for an axis label (web <c>textAnchorForDir</c>). X-axis labels are
    /// direction-neutral (<c>"middle"</c>); a Y-axis label reads outward, so it anchors <c>"end"</c> in LTR (the
    /// axis sits on the left) and <c>"start"</c> in RTL (the axis sits on the right).
    /// </summary>
    /// <param name="axis">The axis the label belongs to.</param>
    /// <param name="dir">The active writing direction.</param>
    /// <returns>One of <c>"start"</c>, <c>"middle"</c> or <c>"end"</c>.</returns>
    public static string TextAnchor(ChartAxis axis, Direction dir)
    {
        if (axis == ChartAxis.X)
        {
            return "middle";
        }

        return dir == Direction.Rtl ? "start" : "end";
    }

    /// <summary>
    /// Resolve the axis-label anchor straight from a language tag — the native analogue of the web
    /// <c>useChartLabelAnchor(axis)</c> hook (which reads the active i18n language and returns
    /// <c>textAnchorForDir(axis, getLangDir(language))</c>).
    /// </summary>
    /// <param name="axis">The axis the label belongs to.</param>
    /// <param name="lang">The active language tag.</param>
    /// <returns>One of <c>"start"</c>, <c>"middle"</c> or <c>"end"</c>.</returns>
    public static string LabelAnchor(ChartAxis axis, string? lang) => TextAnchor(axis, Resolve(lang));
}

/// <summary>
/// Annotation colour-coding category — the native analogue of the web <c>AnnotationCategory</c> union
/// (web/src/types/annotations.ts). The wire form is the lowercase token; <see cref="AnnotationCategories"/>
/// maps to and from it.
/// </summary>
public enum AnnotationCategory
{
    /// <summary>web <c>'milestone'</c>.</summary>
    Milestone,

    /// <summary>web <c>'maintenance'</c>.</summary>
    Maintenance,

    /// <summary>web <c>'trip'</c>.</summary>
    Trip,

    /// <summary>web <c>'issue'</c>.</summary>
    Issue,

    /// <summary>web <c>'upgrade'</c>.</summary>
    Upgrade,

    /// <summary>web <c>'custom'</c> — also the fallback for an unrecognised wire token.</summary>
    Custom,
}

/// <summary>Maps <see cref="AnnotationCategory"/> to and from its lowercase wire token (web union members).</summary>
public static class AnnotationCategories
{
    /// <summary>The wire token for <paramref name="category"/> (the web string-union value).</summary>
    /// <param name="category">The category.</param>
    /// <returns>The lowercase wire token.</returns>
    public static string ToWire(AnnotationCategory category) => category switch
    {
        AnnotationCategory.Milestone => "milestone",
        AnnotationCategory.Maintenance => "maintenance",
        AnnotationCategory.Trip => "trip",
        AnnotationCategory.Issue => "issue",
        AnnotationCategory.Upgrade => "upgrade",
        _ => "custom",
    };

    /// <summary>The category for a wire token, defaulting to <see cref="AnnotationCategory.Custom"/> when unknown.</summary>
    /// <param name="wire">The wire token (case-insensitive).</param>
    /// <returns>The mapped category.</returns>
    public static AnnotationCategory FromWire(string? wire) => wire?.ToUpperInvariant() switch
    {
        "MILESTONE" => AnnotationCategory.Milestone,
        "MAINTENANCE" => AnnotationCategory.Maintenance,
        "TRIP" => AnnotationCategory.Trip,
        "ISSUE" => AnnotationCategory.Issue,
        "UPGRADE" => AnnotationCategory.Upgrade,
        _ => AnnotationCategory.Custom,
    };
}

/// <summary>
/// The chart-render shape of a durable annotation — the native analogue of the web <c>DataAnnotation</c>
/// (web/src/types/annotations.ts). This is what the visible annotation list, the marker chips and the chart's
/// reference-line overlays consume.
/// </summary>
/// <param name="Id">Stringified backend id (web <c>String(row.id)</c>).</param>
/// <param name="Timestamp">ISO timestamp of the annotated point (web <c>occurred_at</c>).</param>
/// <param name="Label">Short label shown on the chart (web <c>title</c>).</param>
/// <param name="Description">Optional longer description shown in the tooltip (web <c>description</c>).</param>
/// <param name="Category">Colour-coding category.</param>
/// <param name="Context">The first scope bucket this annotation belongs to (web <c>scope[0] ?? ''</c>).</param>
/// <param name="VehicleId">Optional specific vehicle (web <c>vehicle_id</c>).</param>
/// <param name="CreatedAt">Created timestamp (web <c>created_at</c>).</param>
public sealed record ChartDataAnnotation(
    string Id,
    string Timestamp,
    string Label,
    string? Description,
    AnnotationCategory Category,
    string Context,
    int? VehicleId,
    string CreatedAt);

/// <summary>
/// The wire shape from <c>GET /api/v1/annotations</c> — the native analogue of the web <c>ChartAnnotationRow</c>
/// (web/src/types/annotations.ts), mirroring <c>models.ChartAnnotation</c>'s snake_case JSON. Projected to the
/// chart-render shape by <see cref="ToDataAnnotation"/>, the native port of the web <c>toDataAnnotation</c>.
/// </summary>
/// <param name="Id">Backend numeric id.</param>
/// <param name="VehicleId">Optional vehicle id (<c>vehicle_id</c>; null = fleet-wide).</param>
/// <param name="OccurredAt">When the annotated event occurred (<c>occurred_at</c>).</param>
/// <param name="Category">Colour-coding category.</param>
/// <param name="Title">Short label (<c>title</c>).</param>
/// <param name="Description">Optional description (<c>description</c>).</param>
/// <param name="Scope">Scope buckets the row appears on (<c>scope</c>).</param>
/// <param name="Color">Optional explicit colour (<c>color</c>).</param>
/// <param name="CreatedAt">Created timestamp (<c>created_at</c>).</param>
/// <param name="UpdatedAt">Updated timestamp (<c>updated_at</c>).</param>
public sealed record ChartAnnotationRow(
    long Id,
    int? VehicleId,
    string OccurredAt,
    AnnotationCategory Category,
    string Title,
    string? Description,
    IReadOnlyList<string> Scope,
    string? Color,
    string CreatedAt,
    string UpdatedAt)
{
    /// <summary>
    /// Project this backend row onto the chart-render shape (web <c>toDataAnnotation</c>): the numeric id is
    /// stringified, <c>occurred_at</c> becomes the timestamp, the first scope bucket becomes the context, and a
    /// missing description / vehicle id collapses to null.
    /// </summary>
    /// <returns>The chart-render annotation.</returns>
    public ChartDataAnnotation ToDataAnnotation() => new(
        Id: Id.ToString(CultureInfo.InvariantCulture),
        Timestamp: OccurredAt,
        Label: Title,
        Description: Description,
        Category: Category,
        Context: Scope.Count > 0 ? Scope[0] : string.Empty,
        VehicleId: VehicleId,
        CreatedAt: CreatedAt);
}

/// <summary>
/// The annotation-integration configuration a chart opts into — the native analogue of the web
/// <c>ChartAnnotationsConfig</c> (web/src/components/charts/ChartContainer.tsx). When supplied, the surface owns
/// the full annotation flow (fetch, add, delete, hide).
/// </summary>
/// <param name="Scope">The annotation scope bucket this chart reads / writes.</param>
/// <param name="VehicleId">Optional vehicle the annotations are pinned to (fleet-wide rows always included).</param>
/// <param name="ChartId">Stable id for persisting the "Hide annotations" toggle; defaults to the chart title.</param>
public sealed record ChartAnnotationsConfig(string Scope, int? VehicleId = null, string? ChartId = null);

/// <summary>
/// The payload sent to <c>POST /api/v1/annotations</c> — the native analogue of the subset of the web
/// <c>CreateAnnotationInput</c> the ChartContainer add-flow sends (web <c>createMutation.mutate({ … })</c>).
/// </summary>
/// <param name="VehicleId">Vehicle the annotation is pinned to, or null for fleet-wide.</param>
/// <param name="OccurredAt">ISO timestamp the annotation marks.</param>
/// <param name="Category">Colour-coding category.</param>
/// <param name="Title">Short label.</param>
/// <param name="Description">Optional description.</param>
/// <param name="Scope">The single scope bucket the chart writes into (web <c>[config.scope]</c>).</param>
public sealed record CreateAnnotationInput(
    int? VehicleId,
    string OccurredAt,
    AnnotationCategory Category,
    string Title,
    string? Description,
    IReadOnlyList<string> Scope);

/// <summary>
/// One row of the screen-reader / forced-colors fallback table — the native analogue of the web
/// <c>ChartDataRow</c> (a <c>Record&lt;string, …&gt;</c>). Cell keys match the declared
/// <see cref="ChartDataColumn.Key"/>s; a missing or null cell renders the em-dash marker.
/// </summary>
/// <param name="Cells">The keyed cell values (string / number / null).</param>
public sealed record ChartDataRow(IReadOnlyDictionary<string, object?> Cells)
{
    /// <summary>Build a row from key/value pairs (a terse call-site factory).</summary>
    /// <param name="cells">The keyed cell values.</param>
    /// <returns>The data row.</returns>
    public static ChartDataRow Of(params (string Key, object? Value)[] cells)
    {
        ArgumentNullException.ThrowIfNull(cells);
        var map = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach ((string key, object? value) in cells)
        {
            map[key] = value;
        }

        return new ChartDataRow(map);
    }
}

/// <summary>
/// A fallback-table column definition — the native analogue of the web <c>ChartDataColumn</c>. <see cref="Format"/>
/// is the unit-aware per-cell formatter; when omitted, values stringify and null renders the em-dash marker.
/// </summary>
/// <param name="Key">The row key to read.</param>
/// <param name="Label">The pre-localized visible column header.</param>
/// <param name="Format">Optional per-cell formatter.</param>
public sealed record ChartDataColumn(string Key, string Label, Func<object?, string>? Format = null);

/// <summary>
/// URL-persisted hidden-series state for a chart — the native analogue of the web <c>HiddenSeriesState</c>
/// returned by <c>useHiddenSeries(chartKey)</c> (web/src/hooks/useHiddenSeries.ts). Tracks which series keys are
/// toggled off; the set is kept ordinally sorted so toggling A then B yields the same canonical state as B then A
/// (the web sorts the URL param for bookmark stability). The web persists to the <c>?hidden_{chartKey}=…</c> URL
/// param; the native surface keeps the same shape in process (a desktop window has no shareable URL) keyed by the
/// same <see cref="ChartKey"/>.
/// </summary>
public sealed class HiddenSeriesState
{
    private readonly SortedSet<string> _hidden = new(StringComparer.Ordinal);

    /// <summary>Creates the tracker for a chart key (web <c>hidden_{chartKey}</c> param name).</summary>
    /// <param name="chartKey">The stable chart key the toggle state is scoped to.</param>
    public HiddenSeriesState(string chartKey) => ChartKey = chartKey ?? string.Empty;

    /// <summary>The chart key this state is scoped to (web <c>chartKey</c>).</summary>
    public string ChartKey { get; }

    /// <summary>The currently hidden series keys, ordinally sorted (web <c>hidden</c> set).</summary>
    public IReadOnlyCollection<string> Hidden => _hidden;

    /// <summary>Whether <paramref name="seriesKey"/> is currently hidden (web <c>isHidden</c>).</summary>
    /// <param name="seriesKey">The series data key.</param>
    /// <returns>True when the series is toggled off.</returns>
    public bool IsHidden(string seriesKey) => _hidden.Contains(seriesKey);

    /// <summary>Toggle a series' visibility (web <c>toggle</c>).</summary>
    /// <param name="seriesKey">The series data key.</param>
    public void Toggle(string seriesKey)
    {
        ArgumentNullException.ThrowIfNull(seriesKey);
        if (!_hidden.Remove(seriesKey))
        {
            _hidden.Add(seriesKey);
        }
    }

    /// <summary>Clear every hidden flag (web <c>reset</c>).</summary>
    public void Reset() => _hidden.Clear();
}

/// <summary>
/// The localStorage persistence key helper for the "Hide annotations" toggle — the native port of the web
/// <c>HIDDEN_STORAGE_PREFIX</c> + <c>readHiddenPref</c> / <c>writeHiddenPref</c> key composition
/// (web/src/components/charts/ChartContainer.tsx). Pure key arithmetic so it is unit-tested without a store.
/// </summary>
public static class HiddenPreference
{
    /// <summary>The storage key prefix (web <c>'teslasync-annotations-hidden:'</c>).</summary>
    public const string StoragePrefix = "teslasync-annotations-hidden:";

    /// <summary>The full storage key for an annotation key (web <c>HIDDEN_STORAGE_PREFIX + key</c>).</summary>
    /// <param name="annotationKey">The per-chart annotation key (chart id or title).</param>
    /// <returns>The composed storage key.</returns>
    public static string StorageKey(string annotationKey) => StoragePrefix + (annotationKey ?? string.Empty);
}

/// <summary>
/// The fully projected, render-ready labels of the ChartContainer chrome — the native analogue of every
/// <c>t('…')</c> the web component evaluates. Pure data so the projection is asserted headlessly; the view binds
/// to it and resolves no strings itself. The two title-parameterized strings stay as templates so the title can be
/// interpolated per chart.
/// </summary>
/// <param name="AddAnnotation">The "Add annotation" action label / Narrator name.</param>
/// <param name="ShowAnnotations">The "Show annotations" toggle label (shown while annotations are hidden).</param>
/// <param name="HideAnnotations">The "Hide annotations" toggle label (shown while annotations are visible).</param>
/// <param name="MarkerRow">The annotation marker-row accessible name.</param>
/// <param name="NoData">The empty-state message.</param>
/// <param name="ChartFailed">The render-error fallback title.</param>
/// <param name="FallbackTableLabelTemplate">The fallback-table caption template (carries the title token).</param>
/// <param name="SummaryTemplate">The bare accessible-summary template (carries the title token).</param>
/// <param name="DateLabel">The add-popover date-field label.</param>
/// <param name="CancelLabel">The add-popover cancel-action label.</param>
public sealed record ChartContainerDisplay(
    string AddAnnotation,
    string ShowAnnotations,
    string HideAnnotations,
    string MarkerRow,
    string NoData,
    string ChartFailed,
    string FallbackTableLabelTemplate,
    string SummaryTemplate,
    string DateLabel,
    string CancelLabel)
{
    /// <summary>The fallback-table caption for a chart title (web <c>{{title}} — data table</c>).</summary>
    /// <param name="title">The chart title.</param>
    /// <returns>The interpolated caption.</returns>
    public string FallbackTableLabel(string title) =>
        ChartContainerRegistration.Format(FallbackTableLabelTemplate, title);

    /// <summary>The bare accessible summary for a chart title (web <c>Chart: {{title}}</c>).</summary>
    /// <param name="title">The chart title.</param>
    /// <returns>The interpolated summary.</returns>
    public string Summary(string title) => ChartContainerRegistration.Format(SummaryTemplate, title);
}

/// <summary>
/// Projects the ChartContainer i18n catalog into a render-ready <see cref="ChartContainerDisplay"/> — the
/// UI-thread-free core the view-model exposes and the view binds to. Mirrors the web component's <c>t('…')</c>
/// call sites one-for-one.
/// </summary>
public static class ChartContainerProjection
{
    /// <summary>Builds the display from the i18n facade.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready label model.</returns>
    public static ChartContainerDisplay Project(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new ChartContainerDisplay(
            AddAnnotation: ChartContainerRegistration.Resolve(
                localizer, ChartContainerRegistration.AddAnnotationKey, ChartContainerRegistration.AddAnnotationFallback),
            ShowAnnotations: ChartContainerRegistration.Resolve(
                localizer, ChartContainerRegistration.ShowAnnotationsKey, ChartContainerRegistration.ShowAnnotationsFallback),
            HideAnnotations: ChartContainerRegistration.Resolve(
                localizer, ChartContainerRegistration.HideAnnotationsKey, ChartContainerRegistration.HideAnnotationsFallback),
            MarkerRow: ChartContainerRegistration.Resolve(
                localizer, ChartContainerRegistration.MarkerRowKey, ChartContainerRegistration.MarkerRowFallback),
            NoData: ChartContainerRegistration.Resolve(
                localizer, ChartContainerRegistration.NoDataKey, ChartContainerRegistration.NoDataFallback),
            ChartFailed: ChartContainerRegistration.Resolve(
                localizer, ChartContainerRegistration.ChartFailedKey, ChartContainerRegistration.ChartFailedFallback),
            FallbackTableLabelTemplate: ChartContainerRegistration.Resolve(
                localizer, ChartContainerRegistration.FallbackTableLabelKey, ChartContainerRegistration.FallbackTableLabelFallback),
            SummaryTemplate: ChartContainerRegistration.Resolve(
                localizer, ChartContainerRegistration.SummaryKey, ChartContainerRegistration.SummaryFallback),
            DateLabel: ChartContainerRegistration.Resolve(
                localizer, ChartContainerRegistration.DateKey, ChartContainerRegistration.DateFallback),
            CancelLabel: ChartContainerRegistration.Resolve(
                localizer, ChartContainerRegistration.CancelKey, ChartContainerRegistration.CancelFallback));
    }
}

/// <summary>
/// The immutable composition inputs of a ChartContainer surface — the native analogue of the web
/// <c>ChartContainerProps</c> that are not the chart body itself (web/src/components/charts/ChartContainer.tsx).
/// The chart control and the header action slot are supplied to the view directly; this record carries everything
/// the UI-thread-free state holder reasons about.
/// </summary>
public sealed record ChartContainerOptions
{
    /// <summary>The chart heading (web <c>title</c>).</summary>
    public required string Title { get; init; }

    /// <summary>The required accessible name for the chart figure (web <c>ariaLabel</c>).</summary>
    public required string AriaLabel { get; init; }

    /// <summary>Optional supporting sub-heading (web <c>subtitle</c>).</summary>
    public string? Subtitle { get; init; }

    /// <summary>Whether the chart is loading (web <c>loading</c>).</summary>
    public bool Loading { get; init; }

    /// <summary>Whether the chart resolved to no data (web <c>empty</c>).</summary>
    public bool Empty { get; init; }

    /// <summary>The fixed body height in effective pixels (web <c>height</c>, default 300).</summary>
    public double Height { get; init; } = 300;

    /// <summary>Whether the export menu is offered (web <c>exportable</c>, default true).</summary>
    public bool Exportable { get; init; } = true;

    /// <summary>Whether a fullscreen toggle is offered (web <c>fullscreen</c>).</summary>
    public bool Fullscreen { get; init; }

    /// <summary>The annotation-integration config; non-null opts the surface into the annotation flow (web <c>annotations</c>).</summary>
    public ChartAnnotationsConfig? Annotations { get; init; }

    /// <summary>Optional long description wired to the accessible figcaption (web <c>ariaDescription</c>).</summary>
    public string? AriaDescription { get; init; }

    /// <summary>Optional stable key enabling the hidden-series legend toggle state (web <c>chartKey</c>).</summary>
    public string? ChartKey { get; init; }

    /// <summary>Optional base file name for exports (web <c>exportFilename</c>).</summary>
    public string? ExportFileName { get; init; }

    /// <summary>Optional rows for the accessible fallback table (web <c>data</c>).</summary>
    public IReadOnlyList<ChartDataRow>? Data { get; init; }

    /// <summary>Optional column definitions for the fallback table (web <c>dataColumns</c>).</summary>
    public IReadOnlyList<ChartDataColumn>? DataColumns { get; init; }
}

/// <summary>
/// Pure helpers for rendering the accessible fallback table — the native port of the web ChartContainer's
/// <c>hasFallbackTable</c> guard and per-cell formatter (<c>format != null ? format(raw) : raw == null ? '—' :
/// String(raw)</c>). Kept static so the table projection is unit-testable.
/// </summary>
public static class ChartFallbackTable
{
    /// <summary>The em-dash rendered for a null / missing cell (web <c>'—'</c>).</summary>
    public const string EmptyCell = "\u2014";

    /// <summary>
    /// Whether the caller supplied enough to render the fallback <c>&lt;table&gt;</c> (web <c>hasFallbackTable</c>):
    /// both non-empty rows and non-empty columns.
    /// </summary>
    /// <param name="data">The fallback rows.</param>
    /// <param name="columns">The fallback columns.</param>
    /// <returns>True when a table can be rendered.</returns>
    public static bool HasTable(
        IReadOnlyList<ChartDataRow>? data,
        IReadOnlyList<ChartDataColumn>? columns) =>
        data is { Count: > 0 } && columns is { Count: > 0 };

    /// <summary>
    /// Format one cell (web <c>col.format != null ? col.format(raw) : raw == null ? '—' : String(raw)</c>).
    /// </summary>
    /// <param name="column">The column whose formatter / key is used.</param>
    /// <param name="row">The row to read the cell from.</param>
    /// <returns>The formatted cell text.</returns>
    public static string FormatCell(ChartDataColumn column, ChartDataRow row)
    {
        ArgumentNullException.ThrowIfNull(column);
        ArgumentNullException.ThrowIfNull(row);

        row.Cells.TryGetValue(column.Key, out object? raw);
        if (column.Format is not null)
        {
            return column.Format(raw);
        }

        return raw is null ? EmptyCell : Convert.ToString(raw, CultureInfo.CurrentCulture) ?? EmptyCell;
    }
}

/// <summary>
/// PII-safe diagnostics for the ChartContainer surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> signal with the surface slug — never a chart title, annotation text, vehicle id, or any data
/// row — so a diagnostics line can never leak chart content. Thread-safe.
/// </summary>
public sealed class ChartContainerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ChartContainerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChartContainer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChartContainerRegistration.Slug}");
    }
}
