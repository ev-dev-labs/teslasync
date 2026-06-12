using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The relative impact of a tip — the native union of the web <c>TipItem.impact</c>
/// (<c>'high' | 'medium' | 'low'</c>) in
/// web/src/features/dashboard/widgets/shared/WidgetTipCards.tsx. Drives the impact chip tint via
/// <see cref="WidgetTipCardsProjection.ImpactStatus"/> (the web <c>impactBadgeMap</c>).
/// </summary>
public enum TipImpact
{
    /// <summary>High impact — the web <c>'high'</c> (badge variant <c>success</c>).</summary>
    High,

    /// <summary>Medium impact — the web <c>'medium'</c> (badge variant <c>warning</c>).</summary>
    Medium,

    /// <summary>Low impact — the web <c>'low'</c> (badge variant <c>neutral</c>).</summary>
    Low,
}

/// <summary>
/// One recommendation row fed to the <see cref="WidgetTipCards"/> primitive — the native analogue of a
/// web <c>TipItem</c> (web/src/features/dashboard/widgets/shared/WidgetTipCards.tsx). The web
/// <c>icon</c> <c>ReactNode</c> maps to an optional Segoe Fluent <see cref="Glyph"/>; the optional
/// <see cref="Impact"/> + <see cref="ImpactLabel"/> mirror the web's optional impact badge. Pure data —
/// no WinUI types — so a consuming widget composes it without a UI host.
/// </summary>
public sealed record TipItem(
    string Id,
    string Title,
    string Description,
    TipImpact? Impact = null,
    string? ImpactLabel = null,
    string? Glyph = null);

/// <summary>
/// One projected, render-ready tip the WinUI view consumes — the resolved analogue of a single mapped
/// card in the web component's <c>visible.map</c>. Holds the optional leading glyph, the title and
/// description, whether an impact chip shows plus its resolved label + tint, the compact flag (the web
/// <c>line-clamp-2</c> on the description), and a Narrator automation name. Pure data so the projection
/// is unit-tested without a UI host.
/// </summary>
public sealed record TipCardProjection(
    string Id,
    string? Glyph,
    string Title,
    string Description,
    bool HasImpact,
    string ImpactLabel,
    StatusKind ImpactStatus,
    bool Compact,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of a tip list for one footprint — the native analogue of
/// everything the web <c>WidgetTipCards</c> computes before returning JSX (the <c>visible</c>
/// <c>useMemo</c> + the empty-state branch). <see cref="IsEmpty"/> mirrors the web
/// <c>visible.length === 0</c> gate; <see cref="EmptyMessage"/> carries the resolved empty copy; and
/// <see cref="Cards"/> are the capped, projected rows. Pure data so the projection is unit-tested.
/// </summary>
public sealed record WidgetTipCardsDisplay(
    bool IsEmpty,
    string EmptyMessage,
    IReadOnlyList<TipCardProjection> Cards);

/// <summary>
/// PII-safe diagnostics for the <see cref="WidgetTipCards"/> primitive (P1/S11 diagnostics contract).
/// Records only the operational <c>view.opened</c> event with the surface slug — never tip titles,
/// descriptions or impacts — so a diagnostics line can never leak what a recommendation was about.
/// Thread-safe.
/// </summary>
public sealed class WidgetTipCardsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WidgetTipCardsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WidgetTipCards</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WidgetTipCardsProjection.Slug}");
    }
}

/// <summary>
/// Pure projection from raw <see cref="TipItem"/> inputs to the display model — the native port of the
/// presentational logic in web/src/features/dashboard/widgets/shared/WidgetTipCards.tsx. Resolves the
/// visible cap (<c>maxTips ?? (compact ? 1 : 3)</c>), slices the list, maps each impact onto a
/// <see cref="StatusKind"/> tint (the web <c>impactBadgeMap</c>) and a localized label, and falls back
/// to the localized empty copy when nothing is visible. Kept UI-free so every branch is unit-tested
/// without a XAML host.
/// </summary>
public static class WidgetTipCardsProjection
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "WidgetTipCards";

    /// <summary>Default cap for the standard (non-compact) layout — the web <c>compact ? 1 : 3</c> upper arm.</summary>
    public const int DefaultStandardLimit = 3;

    /// <summary>Default cap for the compact layout — the web <c>compact ? 1 : 3</c> lower arm.</summary>
    public const int DefaultCompactLimit = 1;

    /// <summary>i18n key for the fallback empty copy (web default literal <c>'No recommendations'</c>).</summary>
    public const string EmptyMessageKey = "widget.tipCards.empty";

    /// <summary>English fallback for the empty copy (web default literal <c>'No recommendations'</c>).</summary>
    public const string EmptyMessageFallback = "No recommendations";

    /// <summary>The visible cap: <c>maxTips ?? (compact ? 1 : 3)</c> (web <c>limit</c>).</summary>
    public static int ResolveLimit(int? maxTips, bool compact) =>
        maxTips ?? (compact ? DefaultCompactLimit : DefaultStandardLimit);

    /// <summary>
    /// Web <c>impactBadgeMap</c>: high → <c>success</c>, medium → <c>warning</c>, low → <c>neutral</c>.
    /// Drives the impact chip tint.
    /// </summary>
    public static StatusKind ImpactStatus(TipImpact impact) => impact switch
    {
        TipImpact.High => StatusKind.Success,
        TipImpact.Medium => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>The lower-case wire token for an impact (the web <c>impact</c> string used as a label fallback).</summary>
    public static string ImpactToken(TipImpact impact) => impact switch
    {
        TipImpact.High => "high",
        TipImpact.Medium => "medium",
        _ => "low",
    };

    /// <summary>
    /// Project <paramref name="tips"/> for the requested layout. Mirrors the web component: caps to
    /// <see cref="ResolveLimit"/>, and either yields the localized empty state (web
    /// <c>visible.length === 0</c>) or the projected cards. <paramref name="emptyMessage"/> overrides the
    /// localized default (the web <c>emptyMessage</c> prop, already localized by the caller).
    /// </summary>
    public static WidgetTipCardsDisplay Project(
        IReadOnlyList<TipItem>? tips,
        ILocalizer localizer,
        int? maxTips = null,
        bool compact = false,
        string? emptyMessage = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string resolvedEmpty = string.IsNullOrEmpty(emptyMessage)
            ? localizer.GetString(EmptyMessageKey, EmptyMessageFallback)
            : emptyMessage;

        int limit = ResolveLimit(maxTips, compact);
        var source = tips ?? Array.Empty<TipItem>();

        var cards = new List<TipCardProjection>(Math.Max(0, Math.Min(limit, source.Count)));
        for (int i = 0; i < source.Count && cards.Count < limit; i++)
        {
            cards.Add(BuildCard(source[i], localizer, compact));
        }

        return cards.Count == 0
            ? new WidgetTipCardsDisplay(true, resolvedEmpty, Array.Empty<TipCardProjection>())
            : new WidgetTipCardsDisplay(false, resolvedEmpty, cards);
    }

    private static TipCardProjection BuildCard(TipItem tip, ILocalizer localizer, bool compact)
    {
        string title = tip.Title;
        string description = tip.Description;

        bool hasImpact = tip.Impact.HasValue;
        string impactLabel = string.Empty;
        var status = StatusKind.Neutral;

        if (tip.Impact is { } impact)
        {
            string token = ImpactToken(impact);
            impactLabel = tip.ImpactLabel ?? localizer.GetString($"widget.tipCards.impact.{token}", token);
            status = ImpactStatus(impact);
        }

        return new TipCardProjection(
            Id: tip.Id,
            Glyph: tip.Glyph,
            Title: title,
            Description: description,
            HasImpact: hasImpact,
            ImpactLabel: impactLabel,
            ImpactStatus: status,
            Compact: compact,
            AutomationName: BuildAutomationName(hasImpact, impactLabel, title, description));
    }

    private static string BuildAutomationName(bool hasImpact, string impactLabel, string title, string description)
    {
        string head = hasImpact
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", impactLabel, title)
            : title;

        return string.IsNullOrEmpty(description)
            ? head
            : string.Format(CultureInfo.CurrentCulture, "{0}. {1}", head, description);
    }
}
