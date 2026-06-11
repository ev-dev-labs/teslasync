using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.BatteryDeltaSurface;

/// <summary>
/// Canonical metadata for the <c>BatteryDelta</c> shared surface — the native mirror of the web component at
/// <c>web/src/components/data-display/BatteryDelta.tsx</c>: the stable diagnostics slug and the Segoe Fluent
/// Icons glyph that stands in for the web Lucide <c>Battery</c> icon (the same <c>\uE83F</c> "Battery10"
/// glyph the battery widgets and <c>BatteryPill</c> use). UI-free so the metadata is asserted in tests.
/// </summary>
public static class BatteryDeltaRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "BatteryDelta";

    /// <summary>Segoe Fluent "Battery10" glyph — the web Lucide <c>Battery</c> icon, shared with the battery widgets.</summary>
    public const string BatteryGlyph = "\uE83F";
}

/// <summary>
/// The display variant — the native mirror of the web <c>BatteryDeltaProps.variant</c>
/// (web/src/components/data-display/BatteryDelta.tsx).
/// </summary>
public enum BatteryDeltaVariant
{
    /// <summary>web <c>'compact'</c> (default): just the delta — "−1%", "+12%", "—".</summary>
    Compact,

    /// <summary>web <c>'pair'</c>: the legacy charging-card style — "79% → 78%".</summary>
    Pair,
}

/// <summary>
/// The semantic colour tone of the rendered delta — the native mirror of the web <c>tone</c> selection
/// (web/src/components/data-display/BatteryDelta.tsx). Unlike the generic <c>TeslaSync.App.Core.DataDisplay.DeltaLogic</c>
/// (whose <c>Negative</c> is danger/red and which is direction-aware), <c>BatteryDelta</c> has its own fixed
/// convention: a rise in state-of-charge (charging) is emerald, a drop (the normal outcome of a drive) is
/// amber — never red — and zero / missing is muted. This enum therefore carries the surface-specific tone, and
/// <see cref="BatteryDeltaProjection.AccentBrushKey"/> maps it to the matching design token.
/// </summary>
public enum BatteryDeltaTone
{
    /// <summary>web <c>text-emerald-300</c> — the SoC rose (delta &gt; 0, charging).</summary>
    Positive,

    /// <summary>web <c>text-amber-300</c> — the SoC dropped (delta &lt; 0, a drive drained the battery).</summary>
    Negative,

    /// <summary>web <c>text-[var(--text-muted)]</c> — no change (delta == 0) or no data.</summary>
    Neutral,
}

/// <summary>
/// The render-time data model the <c>BatteryDelta</c> view binds to — the native analogue of the web
/// <c>BatteryDeltaProps</c> (<c>{ startPct, endPct, showIcon?, variant? }</c> in
/// web/src/components/data-display/BatteryDelta.tsx). The web component is purely presentational: its parent
/// (a Drives or Charging row) owns any data fetching and feeds an already-resolved start / end state-of-charge,
/// so — exactly like React re-rendering the element with already-resolved props — there is no fetch-driven
/// loading / error / stale / offline branch to reproduce here; the only branches are "data" and "no data" (the
/// web <c>hasData</c> guard, surfaced as the muted em-dash). Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="StartPct">The starting state-of-charge percentage 0-100 (web <c>startPct</c>); null / non-finite renders the unknown dash.</param>
/// <param name="EndPct">The ending state-of-charge percentage 0-100 (web <c>endPct</c>); null / non-finite renders the unknown dash.</param>
/// <param name="ShowIcon">When true the leading battery icon is rendered (web <c>showIcon</c>, default true).</param>
/// <param name="Variant">The display variant (web <c>variant</c>, default <see cref="BatteryDeltaVariant.Compact"/>).</param>
public sealed record BatteryDeltaModel(
    double? StartPct,
    double? EndPct,
    bool ShowIcon = true,
    BatteryDeltaVariant Variant = BatteryDeltaVariant.Compact)
{
    /// <summary>The initial / no-data model — both endpoints missing, rendering the muted unknown dash.</summary>
    public static BatteryDeltaModel Unknown { get; } = new(null, null);

    /// <summary>A compact-variant model for a resolved start / end pair (web default variant).</summary>
    /// <param name="startPct">The starting state-of-charge percentage (web <c>startPct</c>).</param>
    /// <param name="endPct">The ending state-of-charge percentage (web <c>endPct</c>).</param>
    /// <param name="showIcon">When true the leading battery icon is rendered (web <c>showIcon</c>, default true).</param>
    public static BatteryDeltaModel Compact(double? startPct, double? endPct, bool showIcon = true) =>
        new(startPct, endPct, showIcon, BatteryDeltaVariant.Compact);

    /// <summary>A pair-variant model for a resolved start / end pair (the legacy charging-card style).</summary>
    /// <param name="startPct">The starting state-of-charge percentage (web <c>startPct</c>).</param>
    /// <param name="endPct">The ending state-of-charge percentage (web <c>endPct</c>).</param>
    /// <param name="showIcon">When true the leading battery icon is rendered (web <c>showIcon</c>, default true).</param>
    public static BatteryDeltaModel Pair(double? startPct, double? endPct, bool showIcon = true) =>
        new(startPct, endPct, showIcon, BatteryDeltaVariant.Pair);
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="BatteryDeltaModel"/> — the native analogue of
/// everything the web component derives before returning JSX (web/src/components/data-display/BatteryDelta.tsx):
/// the <see cref="HasData"/> guard, the <see cref="ShowIcon"/> / <see cref="IconGlyph"/> passthrough, the
/// <see cref="VisibleText"/> (the compact delta, the pair string, or the em dash), the semantic
/// <see cref="Tone"/> with its token-backed <see cref="AccentBrushKey"/>, and the composed
/// <see cref="AutomationName"/> (the web <c>aria-label</c>, always present in both branches). Pure data so every
/// value is asserted headlessly.
/// </summary>
/// <param name="HasData">True when both endpoints are present and finite (web <c>hasData</c>).</param>
/// <param name="ShowIcon">Whether the leading battery icon is rendered (web <c>showIcon</c>).</param>
/// <param name="IconGlyph">The Segoe Fluent battery glyph (web Lucide <c>Battery</c>).</param>
/// <param name="VisibleText">The visible label: the compact delta, the pair string, or the em dash.</param>
/// <param name="Tone">The semantic colour tone (web <c>tone</c>).</param>
/// <param name="AccentBrushKey">The generated design-token brush key the tone resolves to.</param>
/// <param name="AutomationName">The accessible name Narrator reads (web <c>aria-label</c>).</param>
public sealed record BatteryDeltaDisplay(
    bool HasData,
    bool ShowIcon,
    string IconGlyph,
    string VisibleText,
    BatteryDeltaTone Tone,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="BatteryDeltaModel"/> to its <see cref="BatteryDeltaDisplay"/> — the native
/// port of web/src/components/data-display/BatteryDelta.tsx. Reproduces the web derivations exactly:
/// <list type="bullet">
///   <item><description><c>hasData</c> requires both endpoints non-null and finite; otherwise the surface is the
///   muted em dash (U+2014) with the <c>battery.delta.unknown</c> accessible name.</description></item>
///   <item><description><c>delta = endPct − startPct</c>; the sign is <c>'+'</c> / <c>'−'</c> (U+2212 minus sign,
///   not a hyphen) / empty; the magnitude is <c>|delta|</c>.</description></item>
///   <item><description>the tone is emerald for a rise, amber for a drop (a drained battery is the normal drive
///   outcome, so it is amber and never red) and muted for no change.</description></item>
///   <item><description>compact text is the em dash when the delta is zero, else <c>{sign}{magnitude}%</c>; pair
///   text is <c>{startPct}% → {endPct}%</c> (U+2192 rightwards arrow).</description></item>
///   <item><description>numbers are stringified exactly as the web template literal does (a raw <c>${n}</c>, not
///   the locale number formatter), i.e. the shortest round-trippable invariant form, so "78" stays "78".</description></item>
///   <item><description>the accessible name is the interpolated <c>battery.delta.aria</c>
///   ("Battery {{from}}% to {{to}}%").</description></item>
/// </list>
/// Every string resolves through the i18n facade with the exact keys the web source uses. No WinUI types — so
/// the projection is unit-tested without a UI host.
/// </summary>
public static class BatteryDeltaProjection
{
    /// <summary>The em dash (U+2014) shown when there is no data or no change (web <c>dash</c>).</summary>
    public const string Dash = "\u2014";

    /// <summary>The leading sign for a rising delta (web <c>'+'</c>).</summary>
    public const string PositiveSign = "+";

    /// <summary>The leading sign for a falling delta — the U+2212 minus sign, not a hyphen (web <c>'−'</c>).</summary>
    public const string NegativeSign = "\u2212";

    /// <summary>The percent sign appended to every numeric label (web literal <c>'%'</c>).</summary>
    public const string PercentSign = "%";

    /// <summary>The arrow joining the pair values, surrounded by spaces (web <c>` → `</c>, U+2192).</summary>
    public const string PairArrow = " \u2192 ";

    /// <summary>i18n key for the no-data accessible name (web <c>'battery.delta.unknown'</c>).</summary>
    public const string UnknownAriaKey = "battery.delta.unknown";

    /// <summary>English fallback for <see cref="UnknownAriaKey"/> (web default value).</summary>
    public const string UnknownAriaFallback = "Battery delta unknown";

    /// <summary>i18n key for the data accessible name (web <c>'battery.delta.aria'</c>).</summary>
    public const string AriaKey = "battery.delta.aria";

    /// <summary>English fallback for <see cref="AriaKey"/>, with the web interpolation tokens (web default value).</summary>
    public const string AriaFallback = "Battery {{from}}% to {{to}}%";

    private const string FromToken = "{{from}}";
    private const string ToToken = "{{to}}";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static BatteryDeltaDisplay Project(BatteryDeltaModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool hasData =
            model.StartPct is { } start && double.IsFinite(start) &&
            model.EndPct is { } end && double.IsFinite(end);

        if (!hasData)
        {
            // web: !hasData → muted em dash + aria-label t('battery.delta.unknown', 'Battery delta unknown').
            return new BatteryDeltaDisplay(
                HasData: false,
                ShowIcon: model.ShowIcon,
                IconGlyph: BatteryDeltaRegistration.BatteryGlyph,
                VisibleText: Dash,
                Tone: BatteryDeltaTone.Neutral,
                AccentBrushKey: AccentBrushKey(BatteryDeltaTone.Neutral),
                AutomationName: localizer.GetString(UnknownAriaKey, UnknownAriaFallback));
        }

        double startPct = model.StartPct!.Value;
        double endPct = model.EndPct!.Value;
        double delta = endPct - startPct;

        BatteryDeltaTone tone = ToneFor(delta);
        string visible = model.Variant == BatteryDeltaVariant.Pair
            ? FormatPair(startPct, endPct)
            : FormatCompact(delta);
        string aria = FormatAria(localizer.GetString(AriaKey, AriaFallback), startPct, endPct);

        return new BatteryDeltaDisplay(
            HasData: true,
            ShowIcon: model.ShowIcon,
            IconGlyph: BatteryDeltaRegistration.BatteryGlyph,
            VisibleText: visible,
            Tone: tone,
            AccentBrushKey: AccentBrushKey(tone),
            AutomationName: aria);
    }

    /// <summary>
    /// The semantic tone for a signed delta, mirroring the web ternary
    /// (<c>delta &gt; 0 ? emerald : delta &lt; 0 ? amber : muted</c>).
    /// </summary>
    /// <param name="delta">The signed change <c>endPct − startPct</c>.</param>
    public static BatteryDeltaTone ToneFor(double delta) =>
        delta > 0 ? BatteryDeltaTone.Positive
        : delta < 0 ? BatteryDeltaTone.Negative
        : BatteryDeltaTone.Neutral;

    /// <summary>
    /// The generated design-token brush key for a tone: emerald (success) for a rise, amber (warning) for a
    /// drop, muted for no change / no data. This is the surface-specific mapping the web colours imply — a
    /// drop is amber, never the red the generic <c>DeltaLogic</c> uses.
    /// </summary>
    /// <param name="tone">The semantic tone.</param>
    public static string AccentBrushKey(BatteryDeltaTone tone) => tone switch
    {
        BatteryDeltaTone.Positive => "TsColorSuccessBrush",
        BatteryDeltaTone.Negative => "TsColorWarningBrush",
        _ => "TsColorTextMutedBrush",
    };

    /// <summary>
    /// The compact label (web <c>compactLabel</c>): the em dash when the delta is zero, otherwise the sign
    /// followed by the magnitude and a percent sign.
    /// </summary>
    /// <param name="delta">The signed change <c>endPct − startPct</c> (assumed finite).</param>
    public static string FormatCompact(double delta)
    {
        if (delta == 0)
        {
            return Dash;
        }

        string sign = delta > 0 ? PositiveSign : NegativeSign;
        return sign + FormatNumber(Math.Abs(delta)) + PercentSign;
    }

    /// <summary>The pair label (web <c>pairLabel</c>): <c>{startPct}% → {endPct}%</c>.</summary>
    /// <param name="startPct">The starting state-of-charge percentage (assumed finite).</param>
    /// <param name="endPct">The ending state-of-charge percentage (assumed finite).</param>
    public static string FormatPair(double startPct, double endPct) =>
        FormatNumber(startPct) + PercentSign + PairArrow + FormatNumber(endPct) + PercentSign;

    /// <summary>
    /// Stringify a percentage exactly as the web template literal does. The web source embeds the raw value
    /// (<c>${n}</c>) rather than passing it through the locale number formatter, so this reproduces JavaScript's
    /// <c>Number.prototype.toString</c>: the shortest round-trippable invariant representation, with no grouping
    /// and no forced decimals (78 → "78", 12.5 → "12.5").
    /// </summary>
    /// <param name="value">The finite percentage value.</param>
    public static string FormatNumber(double value) => value.ToString(CultureInfo.InvariantCulture);

    // react-i18next interpolation of the resolved 'battery.delta.aria' template — substitutes the {{from}} /
    // {{to}} tokens with the same raw-stringified percentages the web passes in its options object.
    private static string FormatAria(string template, double from, double to) =>
        template
            .Replace(FromToken, FormatNumber(from), StringComparison.Ordinal)
            .Replace(ToToken, FormatNumber(to), StringComparison.Ordinal);
}

/// <summary>
/// PII-safe diagnostics for the <c>BatteryDelta</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the state-of-charge values — so a
/// diagnostics line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class BatteryDeltaDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public BatteryDeltaDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryDelta</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryDeltaRegistration.Slug}");
    }
}
