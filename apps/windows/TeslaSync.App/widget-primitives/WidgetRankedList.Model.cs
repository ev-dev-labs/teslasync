using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// Canonical metadata for the <c>WidgetRankedList</c> widget primitive — the native mirror of the web component
/// at <c>web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx</c>: the stable diagnostics slug. UI-free
/// so the metadata is asserted headlessly.
/// </summary>
public static class WidgetRankedListRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "WidgetRankedList";
}

/// <summary>
/// The semantic badge tone a <see cref="RankedItem"/> can carry — the native mirror of the web
/// <c>RankedItem.badge.variant</c> union (<c>'success' | 'warning' | 'error' | 'neutral'</c> in
/// web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx). The web maps these onto the shared
/// <c>Badge</c>'s own variants via <c>badgeVariantMap</c> (notably <c>error → danger</c>); the native analogue is
/// <see cref="WidgetRankedListProjection.StatusFor"/>, which maps each member to a <see cref="StatusKind"/>.
/// </summary>
public enum RankedBadgeVariant
{
    /// <summary>web <c>'success'</c> → shared Badge <c>success</c> → <see cref="StatusKind.Success"/>.</summary>
    Success,

    /// <summary>web <c>'warning'</c> → shared Badge <c>warning</c> → <see cref="StatusKind.Warning"/>.</summary>
    Warning,

    /// <summary>web <c>'error'</c> → shared Badge <c>danger</c> → <see cref="StatusKind.Danger"/>.</summary>
    Error,

    /// <summary>web <c>'neutral'</c> → shared Badge <c>neutral</c> → <see cref="StatusKind.Neutral"/>.</summary>
    Neutral,
}

/// <summary>
/// An optional trailing chip on a ranked row — the native analogue of the web <c>RankedItem.badge</c>
/// (<c>{ text, variant }</c>). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Text">The chip label (web <c>badge.text</c>).</param>
/// <param name="Variant">The semantic tone (web <c>badge.variant</c>).</param>
public sealed record RankedBadge(string Text, RankedBadgeVariant Variant);

/// <summary>
/// A single ranked row's input — the native analogue of the web <c>RankedItem</c>
/// (web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx). The parent widget owns any data fetching and
/// feeds an already-formatted row, so — exactly like React re-rendering with resolved props — there is no
/// fetch-driven branch here; the row is pure presentational data.
/// </summary>
/// <param name="Id">Stable row key (web <c>id: string | number</c>, stringified here).</param>
/// <param name="Label">The row's primary label (web <c>label</c>).</param>
/// <param name="Value">The numeric value used for ranking and the bar fraction (web <c>value</c>).</param>
/// <param name="FormattedValue">The caller-formatted, display-ready value (web <c>formattedValue</c>).</param>
/// <param name="Badge">Optional trailing chip (web <c>badge</c>); null hides it.</param>
/// <param name="BarColorHex">
/// Optional <c>#RRGGBB</c> bar tint — the native analogue of the web <c>barColor</c> Tailwind class. Treated as a
/// semantic data attribute (like a chart series colour), not an ad-hoc theme colour; null falls back to
/// <see cref="WidgetRankedListProjection.DefaultBarColorHex"/> (the web <c>bg-blue-400</c> default).
/// </param>
public sealed record RankedItem(
    string Id,
    string Label,
    double Value,
    string FormattedValue,
    RankedBadge? Badge = null,
    string? BarColorHex = null);

/// <summary>
/// The render-time data model the <c>WidgetRankedList</c> view binds to — the native analogue of the web
/// <c>WidgetRankedListProps</c> (web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx). The web
/// component is purely presentational (its parent widget owns the data), so there is no fetch-driven
/// loading / error / stale / offline branch to reproduce — only the populated list and the always-rendered empty
/// state. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record WidgetRankedListModel
{
    /// <summary>Creates the model; <paramref name="items"/> defaults to an empty list so the view never dereferences null.</summary>
    /// <param name="items">The candidate rows (web <c>items</c>); sorted + capped by the projection.</param>
    /// <param name="maxItems">Optional explicit cap (web <c>maxItems</c>); null uses the compact-aware default.</param>
    /// <param name="compact">Compact mode (web <c>compact</c>, default false): caps at 3 and hides the bars.</param>
    /// <param name="showBars">Whether to show the background bars (web <c>showBars</c>, default true).</param>
    /// <param name="emptyMessage">Optional caller-localized empty message (web <c>emptyMessage</c>); null uses the localized default.</param>
    /// <param name="emptyIconGlyph">Optional Segoe Fluent glyph for the empty state (web <c>emptyIcon</c>); null keeps the shared default.</param>
    public WidgetRankedListModel(
        IReadOnlyList<RankedItem>? items = null,
        int? maxItems = null,
        bool compact = false,
        bool showBars = true,
        string? emptyMessage = null,
        string? emptyIconGlyph = null)
    {
        Items = items ?? Array.Empty<RankedItem>();
        MaxItems = maxItems;
        Compact = compact;
        ShowBars = showBars;
        EmptyMessage = emptyMessage;
        EmptyIconGlyph = emptyIconGlyph;
    }

    /// <summary>The candidate rows (web <c>items</c>); never null.</summary>
    public IReadOnlyList<RankedItem> Items { get; }

    /// <summary>Optional explicit row cap (web <c>maxItems</c>); null uses the compact-aware default.</summary>
    public int? MaxItems { get; }

    /// <summary>Compact mode (web <c>compact</c>): caps at 3 rows and hides the background bars.</summary>
    public bool Compact { get; }

    /// <summary>Whether the background bars are shown (web <c>showBars</c>); ignored in compact mode.</summary>
    public bool ShowBars { get; }

    /// <summary>Optional caller-localized empty message (web <c>emptyMessage</c>); null uses the localized default.</summary>
    public string? EmptyMessage { get; }

    /// <summary>Optional Segoe Fluent glyph for the empty state (web <c>emptyIcon</c>); null keeps the shared default.</summary>
    public string? EmptyIconGlyph { get; }

    /// <summary>The empty model — no rows, rendering the always-visible empty state.</summary>
    public static WidgetRankedListModel Empty { get; } = new();
}

/// <summary>
/// A fully projected, render-ready badge chip — the resolved <see cref="Text"/> and the native
/// <see cref="Status"/> (the web <c>badgeVariantMap</c> result). Pure data.
/// </summary>
/// <param name="Text">The chip label (web <c>badge.text</c>).</param>
/// <param name="Status">The mapped semantic status driving the chip colour (web <c>badgeVariantMap[variant]</c>).</param>
public sealed record RankedBadgeDisplay(string Text, StatusKind Status);

/// <summary>
/// A fully projected, render-ready ranked row — everything the web <c>&lt;li&gt;</c> needs before layout
/// (web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx). Pure data so every value is asserted
/// headlessly.
/// </summary>
/// <param name="Rank">The 1-based rank (web <c>index + 1</c>).</param>
/// <param name="Label">The row's primary label (web <c>item.label</c>).</param>
/// <param name="FormattedValue">The display-ready value (web <c>item.formattedValue</c>).</param>
/// <param name="Badge">Optional trailing chip (web <c>item.badge</c>); null hides it.</param>
/// <param name="BarColorHex">The resolved bar tint (web <c>item.barColor ?? 'bg-blue-400'</c>).</param>
/// <param name="BarPercent">The clamped 0–100 bar width (the rendered width of web <c>barPct%</c>).</param>
/// <param name="ShowBar">Whether the background bar renders (web <c>!hideBars</c>).</param>
/// <param name="AccessibleName">The composed Narrator name for the whole row.</param>
public sealed record RankedRow(
    int Rank,
    string Label,
    string FormattedValue,
    RankedBadgeDisplay? Badge,
    string BarColorHex,
    double BarPercent,
    bool ShowBar,
    string AccessibleName);

/// <summary>
/// The fully projected view of a <see cref="WidgetRankedListModel"/> — either the always-rendered empty state
/// (<see cref="IsEmpty"/> with its <see cref="EmptyMessage"/> + <see cref="EmptyIconGlyph"/>) or the ordered
/// <see cref="Rows"/>. Pure data.
/// </summary>
/// <param name="IsEmpty">True when no rows resolved (web <c>visible.length === 0</c>) — the empty branch.</param>
/// <param name="EmptyMessage">The localized empty-state message (web <c>emptyMessage</c>); empty when populated.</param>
/// <param name="EmptyIconGlyph">Optional empty-state glyph (web <c>emptyIcon</c>); null keeps the shared default.</param>
/// <param name="Rows">The ordered, capped rows (web <c>visible</c>); empty when <see cref="IsEmpty"/>.</param>
public sealed record WidgetRankedListDisplay(
    bool IsEmpty,
    string EmptyMessage,
    string? EmptyIconGlyph,
    IReadOnlyList<RankedRow> Rows);

/// <summary>
/// Pure projection from a <see cref="WidgetRankedListModel"/> to its <see cref="WidgetRankedListDisplay"/> — the
/// native port of web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx. Reproduces the web derivations
/// exactly:
/// <list type="bullet">
///   <item><description>the row cap is <c>maxItems ?? (compact ? 3 : 5)</c> (<see cref="LimitFor"/>); a
///   non-positive cap yields the empty state (the native analogue of <c>slice(0, 0)</c>).</description></item>
///   <item><description>rows are sorted descending by value then capped (web
///   <c>[...items].sort((a, b) =&gt; b.value - a.value).slice(0, limit)</c>); LINQ <c>OrderByDescending</c> is
///   stable, matching the JS stable sort so equal values keep input order.</description></item>
///   <item><description>the bar scale is <c>max(0, max value)</c> (web <c>reduce(Math.max, 0)</c>), so an
///   all-negative set yields a zero scale and zero-width bars.</description></item>
///   <item><description>each bar width is <c>value / maxValue * 100</c> (web <c>barPct</c>), clamped to the
///   0–100 the browser actually renders.</description></item>
///   <item><description>the badge tone maps through <see cref="StatusFor"/> (web <c>badgeVariantMap</c>,
///   <c>error → danger</c>); a missing <c>barColor</c> falls back to <see cref="DefaultBarColorHex"/> (web
///   <c>bg-blue-400</c>).</description></item>
///   <item><description>the empty message is the caller override if present, else the localized
///   <c>widgets.rankedList.emptyDefault</c> (web <c>emptyMessage ?? 'No data available'</c>).</description></item>
/// </list>
/// Every string resolves through the i18n facade. No WinUI types — so the projection is unit-tested without a UI
/// host.
/// </summary>
public static class WidgetRankedListProjection
{
    /// <summary>Compact-mode row cap (web <c>compact ? 3 : 5</c>, the compact arm).</summary>
    public const int CompactLimit = 3;

    /// <summary>Default row cap when not compact and no explicit cap is given (web <c>5</c>).</summary>
    public const int DefaultLimit = 5;

    /// <summary>Default bar tint when a row supplies none — Tailwind <c>blue-400</c> (web <c>bg-blue-400</c>).</summary>
    public const string DefaultBarColorHex = "#60a5fa";

    /// <summary>i18n key for the default empty-state message (web <c>'No data available'</c> default).</summary>
    public const string EmptyMessageKey = "widgets.rankedList.emptyDefault";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/> (verbatim from the web default prop).</summary>
    public const string EmptyMessageFallback = "No data available";

    /// <summary>i18n key for a row's composed accessible name (no badge).</summary>
    public const string RowAccessibleNameKey = "widgets.rankedList.rowAccessibleName";

    /// <summary>English fallback for <see cref="RowAccessibleNameKey"/>, with the interpolation tokens.</summary>
    public const string RowAccessibleNameFallback = "{{rank}}. {{label}}, {{value}}";

    /// <summary>i18n key for a row's composed accessible name when a badge is present.</summary>
    public const string RowAccessibleNameWithBadgeKey = "widgets.rankedList.rowAccessibleNameWithBadge";

    /// <summary>English fallback for <see cref="RowAccessibleNameWithBadgeKey"/>, with the interpolation tokens.</summary>
    public const string RowAccessibleNameWithBadgeFallback = "{{rank}}. {{label}}, {{value}} ({{badge}})";

    private const string RankToken = "{{rank}}";
    private const string LabelToken = "{{label}}";
    private const string ValueToken = "{{value}}";
    private const string BadgeToken = "{{badge}}";

    /// <summary>The compact-aware row cap (web <c>maxItems ?? (compact ? 3 : 5)</c>).</summary>
    /// <param name="model">The render-time model.</param>
    public static int LimitFor(WidgetRankedListModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        return model.MaxItems ?? (model.Compact ? CompactLimit : DefaultLimit);
    }

    /// <summary>The native status for a badge variant (web <c>badgeVariantMap</c>, including <c>error → danger</c>).</summary>
    /// <param name="variant">The source badge variant.</param>
    public static StatusKind StatusFor(RankedBadgeVariant variant) => variant switch
    {
        RankedBadgeVariant.Success => StatusKind.Success,
        RankedBadgeVariant.Warning => StatusKind.Warning,
        RankedBadgeVariant.Error => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every string resolves through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static WidgetRankedListDisplay Project(WidgetRankedListModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        int limit = LimitFor(model);
        bool hideBars = model.Compact || !model.ShowBars;

        // web: [...items].sort((a, b) => b.value - a.value).slice(0, limit). LINQ OrderByDescending is a stable
        // sort, matching JS's stable Array.prototype.sort so rows with equal values keep their input order.
        List<RankedItem> visible = model.Items
            .OrderByDescending(item => item.Value)
            .Take(Math.Max(0, limit))
            .ToList();

        if (visible.Count == 0)
        {
            string message = model.EmptyMessage ?? localizer.GetString(EmptyMessageKey, EmptyMessageFallback);
            return new WidgetRankedListDisplay(true, message, model.EmptyIconGlyph, Array.Empty<RankedRow>());
        }

        // web: visible.reduce((max, item) => Math.max(max, item.value), 0) — seeded at 0, so the scale is never
        // negative and an all-negative set produces zero-width bars.
        double maxValue = 0;
        foreach (RankedItem item in visible)
        {
            maxValue = Math.Max(maxValue, item.Value);
        }

        var rows = new List<RankedRow>(visible.Count);
        for (int index = 0; index < visible.Count; index++)
        {
            RankedItem item = visible[index];
            int rank = index + 1;

            // web: barPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0; clamp to the width the browser
            // actually paints (a negative / over-unity percentage is never rendered).
            double barPercent = maxValue > 0 ? item.Value / maxValue * 100 : 0;
            barPercent = Math.Clamp(barPercent, 0, 100);

            RankedBadgeDisplay? badge = item.Badge is { } source
                ? new RankedBadgeDisplay(source.Text, StatusFor(source.Variant))
                : null;

            string barColor = string.IsNullOrWhiteSpace(item.BarColorHex) ? DefaultBarColorHex : item.BarColorHex;
            string accessibleName = ComposeAccessibleName(localizer, rank, item.Label, item.FormattedValue, badge?.Text);

            rows.Add(new RankedRow(rank, item.Label, item.FormattedValue, badge, barColor, barPercent, !hideBars, accessibleName));
        }

        return new WidgetRankedListDisplay(false, string.Empty, null, rows);
    }

    private static string ComposeAccessibleName(ILocalizer localizer, int rank, string label, string value, string? badgeText)
    {
        string rankText = rank.ToString(CultureInfo.InvariantCulture);

        if (string.IsNullOrEmpty(badgeText))
        {
            return localizer.GetString(RowAccessibleNameKey, RowAccessibleNameFallback)
                .Replace(RankToken, rankText, StringComparison.Ordinal)
                .Replace(LabelToken, label, StringComparison.Ordinal)
                .Replace(ValueToken, value, StringComparison.Ordinal);
        }

        return localizer.GetString(RowAccessibleNameWithBadgeKey, RowAccessibleNameWithBadgeFallback)
            .Replace(RankToken, rankText, StringComparison.Ordinal)
            .Replace(LabelToken, label, StringComparison.Ordinal)
            .Replace(ValueToken, value, StringComparison.Ordinal)
            .Replace(BadgeToken, badgeText, StringComparison.Ordinal);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>WidgetRankedList</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never row labels or values — so a diagnostics
/// line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class WidgetRankedListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public WidgetRankedListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WidgetRankedList</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WidgetRankedListRegistration.Slug}");
    }
}
