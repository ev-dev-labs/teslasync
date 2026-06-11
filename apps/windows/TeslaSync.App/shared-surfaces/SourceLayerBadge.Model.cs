using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One immutable badge sample — the two inputs the web <c>&lt;SourceLayerBadge&gt;</c> renders from
/// (web/src/components/data-display/SourceLayerBadge.tsx): the layered live-state <c>source</c> string
/// (<c>l1</c>/<c>l2</c>/<c>log</c>/<c>stale</c>, or null/unrecognized which projects to the unknown badge) and the
/// optional <c>ageMs</c> value age surfaced in the tooltip. It is the data the P1/S8
/// <see cref="ISourceLayerBadgeSource"/> exposes and the pure <see cref="SourceLayerBadgeProjection.Project"/>
/// consumes. <see cref="FromRepositoryResult{T}"/> derives the sample from a cache-then-network
/// <see cref="RepositoryResult{T}"/> by pulling the source layer (and optional age) out of the latest value,
/// exactly as a web diagnostics surface passes a signal's source metadata into the badge. Pure data — no WinUI
/// types — so it is unit-tested without a UI host.
/// </summary>
/// <param name="Source">The wire source-layer string (web <c>source</c>), or null for the unknown badge.</param>
/// <param name="AgeMs">The value age in milliseconds (web <c>ageMs</c>), or null when no age is known.</param>
public sealed record SourceLayerBadgeSnapshot(string? Source, double? AgeMs)
{
    /// <summary>The no-value sample — a null source, which projects to the unknown em-dash badge (web <c>source == null</c>).</summary>
    public static SourceLayerBadgeSnapshot Empty { get; } = new((string?)null, null);

    /// <summary>Create a sample for a known source layer with no age (the common debugger call site).</summary>
    /// <param name="source">The wire source-layer string (web <c>source</c>).</param>
    public static SourceLayerBadgeSnapshot Of(string? source) => new(source, null);

    /// <summary>Create a sample for a known source layer with a value age in milliseconds.</summary>
    /// <param name="source">The wire source-layer string (web <c>source</c>).</param>
    /// <param name="ageMs">The value age in milliseconds (web <c>ageMs</c>).</param>
    public static SourceLayerBadgeSnapshot Of(string? source, double ageMs) => new(source, ageMs);

    /// <summary>
    /// Derive a sample from a cache-then-network <see cref="RepositoryResult{T}"/> by selecting the source layer
    /// (and optional value age) out of the latest value — the native wiring for "where did this signal value come
    /// from". When the result carries a value (cached, refreshing, loaded or offline-cached) the selectors pull
    /// the source and age out of it; when there is no value yet (initial load, a success-but-empty response, or a
    /// hard failure with no cache) the sample is the no-value <see cref="Empty"/> equivalent, which projects to
    /// the unknown em-dash badge (the always-visible default — never a hidden surface, matching the web
    /// <c>source ?? 'unknown'</c> fallback). The whole derivation is WinUI-free so it is unit-tested against an
    /// in-memory result.
    /// </summary>
    /// <typeparam name="T">The repository's domain read-model type whose value carries the source metadata.</typeparam>
    /// <param name="result">The repository emission to read the latest value from.</param>
    /// <param name="selectSource">Selector that pulls the wire source-layer string out of the value.</param>
    /// <param name="selectAgeMs">Optional selector that pulls the value age (ms) out of the value; null when unused.</param>
    public static SourceLayerBadgeSnapshot FromRepositoryResult<T>(
        RepositoryResult<T> result,
        Func<T, string?> selectSource,
        Func<T, double?>? selectAgeMs = null)
    {
        ArgumentNullException.ThrowIfNull(result);
        ArgumentNullException.ThrowIfNull(selectSource);

        // A source layer exists only in the cache-then-network value-bearing states; Loading / Empty / Error
        // carry none and fall back to the unknown badge (HasValue keys off Value != null, which is unreliable for
        // a value-type T whose default is non-null).
        var hasValue = result.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;
        if (!hasValue)
        {
            return Empty;
        }

        var value = result.Value!;
        return new SourceLayerBadgeSnapshot(selectSource(value), selectAgeMs?.Invoke(value));
    }
}

/// <summary>
/// Canonical metadata for the SourceLayerBadge surface — the native analogue of the module-level <c>STYLE</c>
/// table, the <c>min-w</c> widths and the <c>formatAge</c> tiers in
/// web/src/components/data-display/SourceLayerBadge.tsx. Carries the diagnostics slug, the automation id, the
/// per-layer description i18n keys (each with the English fallback the web source renders verbatim — shared with
/// the <c>Strings/{lang}/Resources.resw</c> <c>translation.sourceLayer.*</c> catalog), the age-word key, the
/// lowercase layer tokens (the web <c>data-source</c> attribute), and the badge metrics. The per-layer glyph and
/// the token brush key are sourced from the shared <see cref="SourceLayers"/> logic so the surface, the atomic
/// <c>TsSourceLayerBadge</c> and the debugger tables all tint and label identically. UI-free so it is asserted in
/// tests.
/// </summary>
public static class SourceLayerBadgeRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "SourceLayerBadge";

    /// <summary>The root automation id Narrator and UI-automation resolve the surface by (web <c>data-testid</c>).</summary>
    public const string RootAutomationId = "source-layer-badge";

    /// <summary>ARIA role the surface exposes — a read-only diagnostics status indicator (native idiom; the web span carries no role).</summary>
    public const string StatusRole = "status";

    /// <summary>i18n key for the "age" tooltip word (web <c>t('sourceLayer.age', 'age')</c>).</summary>
    public const string AgeKey = "translation.sourceLayer.age";

    /// <summary>English fallback for <see cref="AgeKey"/> — the web literal.</summary>
    public const string AgeFallback = "age";

    /// <summary>Minimum badge width when the label is spelled out (web <c>min-w-[2.5rem]</c>, 40 DIPs).</summary>
    public const double ExpandedMinWidth = 40;

    /// <summary>Minimum badge width for the compact glyph (web <c>min-w-[1.5rem]</c>, 24 DIPs).</summary>
    public const double CompactMinWidth = 24;

    /// <summary>Badge glyph/label font size (web <c>text-[10px]</c>).</summary>
    public const double FontSize = 10;

    /// <summary>Corner radius fallback for the badge (web <c>rounded</c>, 4 DIPs) when the token is absent.</summary>
    public const double CornerRadiusFallback = 4;

    /// <summary>Letter spacing in 1/1000 em (web <c>tracking-wider</c> ≈ 0.05em).</summary>
    public const int CharacterSpacing = 50;

    /// <summary>The lowercase layer token the badge reports for query-by-attribute (web <c>data-source</c>).</summary>
    public static string LayerToken(SourceLayer layer) => layer switch
    {
        SourceLayer.L1 => "l1",
        SourceLayer.L2 => "l2",
        SourceLayer.Log => "log",
        SourceLayer.Stale => "stale",
        _ => "unknown",
    };

    /// <summary>i18n key for a layer's tooltip description (web <c>STYLE[key].descKey</c>).</summary>
    public static string DescriptionKey(SourceLayer layer) => layer switch
    {
        SourceLayer.L1 => "translation.sourceLayer.l1.desc",
        SourceLayer.L2 => "translation.sourceLayer.l2.desc",
        SourceLayer.Log => "translation.sourceLayer.log.desc",
        SourceLayer.Stale => "translation.sourceLayer.stale.desc",
        _ => "translation.sourceLayer.unknown.desc",
    };

    /// <summary>English fallback for a layer's tooltip description (web <c>STYLE[key].descFallback</c>; the shared <see cref="SourceLayers"/> description).</summary>
    public static string DescriptionFallback(SourceLayer layer) => SourceLayers.Tokens(layer).Description;

    /// <summary>The compact glyph/label a layer renders (web <c>STYLE[key].label</c>): L1 / L2 / LOG / STALE / em dash.</summary>
    public static string Label(SourceLayer layer) => SourceLayers.Tokens(layer).Label;

    /// <summary>The generated design-token brush key a layer tints from (web <c>STYLE[key].tint</c>).</summary>
    public static string AccentBrushKey(SourceLayer layer) => SourceLayers.Tokens(layer).AccentBrushKey;
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="SourceLayerBadgeSnapshot"/> — everything the web
/// component derives before returning JSX (web/src/components/data-display/SourceLayerBadge.tsx): the resolved
/// <see cref="Layer"/> and its lowercase <see cref="SourceToken"/> (web <c>data-source</c>), the compact
/// <see cref="Label"/> glyph (web <c>style.label</c>), the token <see cref="AccentBrushKey"/> the badge tints
/// from, whether the label is spelled out (<see cref="ShowLabel"/>) and the resulting <see cref="MinWidth"/>
/// (web <c>min-w</c>), the localized relative <see cref="AgeText"/> (web <c>formatAge(ageMs)</c>), the composed
/// hover/Narrator <see cref="Tooltip"/> (web <c>tooltip</c>) and the accessible <see cref="AutomationName"/>.
/// Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct SourceLayerBadgeProjection
{
    private SourceLayerBadgeProjection(
        SourceLayer layer,
        string sourceToken,
        string label,
        string accentBrushKey,
        bool showLabel,
        double minWidth,
        string? ageText,
        string description,
        string tooltip,
        string automationName)
    {
        Layer = layer;
        SourceToken = sourceToken;
        Label = label;
        AccentBrushKey = accentBrushKey;
        ShowLabel = showLabel;
        MinWidth = minWidth;
        AgeText = ageText;
        Description = description;
        Tooltip = tooltip;
        AutomationName = automationName;
    }

    /// <summary>The resolved source layer (web <c>STYLE[key] ?? unknown</c>).</summary>
    public SourceLayer Layer { get; }

    /// <summary>The lowercase source token for query-by-attribute (web <c>data-source={key}</c>).</summary>
    public string SourceToken { get; }

    /// <summary>The compact glyph/label (web <c>style.label</c>): L1 / L2 / LOG / STALE / em dash.</summary>
    public string Label { get; }

    /// <summary>The generated design-token brush key the badge tints from (web <c>style.tint</c>).</summary>
    public string AccentBrushKey { get; }

    /// <summary>Whether the label is spelled out — drives the wider min-width (web <c>showLabel</c>).</summary>
    public bool ShowLabel { get; }

    /// <summary>The badge minimum width in DIPs (web <c>min-w-[2.5rem]</c> / <c>min-w-[1.5rem]</c>).</summary>
    public double MinWidth { get; }

    /// <summary>The localized relative value age (web <c>formatAge(ageMs)</c>), or null when no age is known.</summary>
    public string? AgeText { get; }

    /// <summary>The localized layer description (web <c>t(style.descKey, style.descFallback)</c>).</summary>
    public string Description { get; }

    /// <summary>The composed hover / Narrator tooltip (web <c>tooltip</c>): description, plus the age clause when present.</summary>
    public string Tooltip { get; }

    /// <summary>The accessible name the automation peer reports (the composed tooltip — the colour-only badge's semantic).</summary>
    public string AutomationName { get; }

    /// <summary>
    /// Project a sample into a render-ready value, reproducing the web component body exactly
    /// (web/src/components/data-display/SourceLayerBadge.tsx L75-100): the <c>(source ?? 'unknown').toLowerCase()</c>
    /// key, the <c>STYLE[key] ?? unknown</c> classification (via the shared <see cref="SourceLayers.Parse"/>), the
    /// <c>formatAge(ageMs)</c> relative age (via the shared <see cref="FreshnessLogic.FormatSourceAge"/>), the
    /// description + age tooltip composition and the <c>min-w</c> width.
    /// </summary>
    /// <param name="snapshot">The badge sample (web <c>source</c> + <c>ageMs</c> props).</param>
    /// <param name="showLabel">Whether the label is spelled out (web <c>showLabel</c>).</param>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    public static SourceLayerBadgeProjection Project(
        SourceLayerBadgeSnapshot snapshot,
        bool showLabel,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var layer = SourceLayers.Parse(snapshot.Source);

        // web: key = (source ?? 'unknown').toLowerCase(); the data-source attribute is the lowercased raw input.
        var sourceToken = (snapshot.Source ?? "unknown").ToLowerInvariant();

        var description = localizer.GetString(
            SourceLayerBadgeRegistration.DescriptionKey(layer),
            SourceLayerBadgeRegistration.DescriptionFallback(layer));

        var ageText = FreshnessLogic.FormatSourceAge(snapshot.AgeMs);

        // web: ageText ? `${desc} (${t('sourceLayer.age','age')}: ${ageText})` : desc.
        string tooltip;
        if (ageText is null)
        {
            tooltip = description;
        }
        else
        {
            var ageWord = localizer.GetString(SourceLayerBadgeRegistration.AgeKey, SourceLayerBadgeRegistration.AgeFallback);
            tooltip = $"{description} ({ageWord}: {ageText})";
        }

        var minWidth = showLabel
            ? SourceLayerBadgeRegistration.ExpandedMinWidth
            : SourceLayerBadgeRegistration.CompactMinWidth;

        return new SourceLayerBadgeProjection(
            layer: layer,
            sourceToken: sourceToken,
            label: SourceLayerBadgeRegistration.Label(layer),
            accentBrushKey: SourceLayerBadgeRegistration.AccentBrushKey(layer),
            showLabel: showLabel,
            minWidth: minWidth,
            ageText: ageText,
            description: description,
            tooltip: tooltip,
            automationName: tooltip);
    }
}

/// <summary>
/// PII-safe diagnostics for the SourceLayerBadge surface (P1/S11 diagnostics contract). The badge carries no user
/// content (only a source-layer token and a relative age), so the collector records ONLY the operational
/// <c>view.opened</c> event with the surface slug — never the source value or the age. Thread-safe; mirrors the
/// peer surfaces' diagnostics collectors.
/// </summary>
public sealed class SourceLayerBadgeDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public SourceLayerBadgeDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SourceLayerBadge</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SourceLayerBadgeRegistration.Slug}");
    }
}
