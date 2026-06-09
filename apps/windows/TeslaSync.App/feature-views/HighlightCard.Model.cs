using System.Globalization;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>HighlightCard</c> surface — the native union of the states
/// the web component renders (web/src/features/analytics/components/weekly-digest/HighlightCard.tsx). The web
/// source is a pure presentational card: it takes already-resolved <c>icon</c> / <c>label</c> / <c>value</c> /
/// <c>change</c> / <c>subtitle</c> / <c>color</c> props and performs no fetching, so the branch is a direct
/// function of the input <see cref="HighlightCardModel"/>. There is no fetch-driven error / stale / offline
/// branch to reproduce here: the parent weekly-digest experience owns the query lifecycle (the web
/// <c>DigestSkeleton</c> / <c>QueryError</c> are rendered once for the whole digest before any
/// <c>HighlightCard</c> is mounted, exactly as React only renders the card with resolved props). The
/// <see cref="Loading"/> and <see cref="Empty"/> branches are the card-local skeleton and missing-value
/// fallbacks a parent grid drives directly. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum HighlightCardState
{
    /// <summary>The parent has not resolved the value yet (<c>model.Loading</c>) — tokenized skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no <see cref="HighlightCardModel.Value"/> — the card chrome over an em-dash stand-in, never a blank box.</summary>
    Empty,

    /// <summary>A value is present (the web render) — the label row, the value and the optional change / subtitle.</summary>
    Ready,
}

/// <summary>
/// The accent colour a <c>HighlightCard</c> is keyed with — the native mirror of the web prop
/// <c>color?: 'cyan' | 'green' | 'purple' | 'amber' | 'red'</c>
/// (web/src/features/analytics/components/weekly-digest/HighlightCard.tsx). In the web source the colour drives
/// nothing but the panel glow (via <c>glowMap</c>): the label is always secondary, the value always primary and
/// the change always success/danger — so this enum's only effect is the resolved <see cref="HighlightGlow"/>.
/// </summary>
public enum HighlightColor
{
    /// <summary>Cyan accent (web <c>'cyan'</c>) — glows cyan.</summary>
    Cyan,

    /// <summary>Green accent (web <c>'green'</c>) — glows green.</summary>
    Green,

    /// <summary>Purple accent (web <c>'purple'</c>) — glows purple.</summary>
    Purple,

    /// <summary>Amber accent (web <c>'amber'</c>) — no glow (web <c>glowMap.amber === 'none'</c>).</summary>
    Amber,

    /// <summary>Red accent (web <c>'red'</c>) — no glow (web <c>glowMap.red === 'none'</c>).</summary>
    Red,
}

/// <summary>
/// The panel glow a <c>HighlightCard</c> resolves to — the native, WinUI-free analogue of the web
/// <c>glowMap[color]</c> result. Mirrors the members of the view layer's <c>GlassGlow</c> so the colour→glow
/// mapping is unit-tested headlessly and bridged to the WinUI enum only in the view.
/// </summary>
public enum HighlightGlow
{
    /// <summary>No accent glow (web <c>'none'</c> — amber / red).</summary>
    None,

    /// <summary>Cyan accent glow (web <c>'cyan'</c>).</summary>
    Cyan,

    /// <summary>Green accent glow (web <c>'green'</c>).</summary>
    Green,

    /// <summary>Purple accent glow (web <c>'purple'</c>).</summary>
    Purple,
}

/// <summary>
/// The render-time data model the <c>HighlightCard</c> view binds to — the native analogue of the web
/// <c>HighlightCardProps</c> (web/src/features/analytics/components/weekly-digest/HighlightCard.tsx). The web
/// <c>icon: React.ReactNode</c> becomes an optional Segoe Fluent <see cref="IconGlyph"/> (the parent supplies a
/// glyph, exactly as it supplies a Lucide node on the web); <see cref="Value"/> and <see cref="ChangeValue"/>
/// are already-formatted display strings the card renders verbatim (the web does no formatting of its own); and
/// <see cref="Loading"/> is the card-local flag the parent grid drives. The component is presentational, so the
/// only user-facing strings the projection resolves from i18n are the shared loading / empty copy. Pure data —
/// no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">When true the parent has not resolved the value yet (the loading branch).</param>
/// <param name="IconGlyph">Optional Segoe Fluent glyph rendered before the label (web <c>icon</c>), or null.</param>
/// <param name="Label">The metric label shown beside the icon (web <c>label</c>).</param>
/// <param name="Value">The already-formatted metric value (web <c>value</c>); blank renders the empty branch.</param>
/// <param name="ChangeValue">Optional already-formatted change caption (web <c>change.value</c>), or null.</param>
/// <param name="ChangePositive">Whether the change is favourable (web <c>change.positive</c>) — drives arrow + tone.</param>
/// <param name="Subtitle">Optional muted subtitle under the value (web <c>subtitle</c>), or null.</param>
/// <param name="Color">The accent colour key (web <c>color</c>, default <see cref="HighlightColor.Cyan"/>).</param>
public sealed record HighlightCardModel(
    bool Loading,
    string? IconGlyph,
    string Label,
    string Value,
    string? ChangeValue,
    bool ChangePositive,
    string? Subtitle,
    HighlightColor Color)
{
    /// <summary>The initial model: the parent is still resolving the value, so the loading branch renders.</summary>
    public static HighlightCardModel Pending { get; } =
        new(true, null, string.Empty, string.Empty, null, false, null, HighlightColor.Cyan);

    /// <summary>A resolved model with no value — the empty (em-dash) branch.</summary>
    public static HighlightCardModel Blank { get; } =
        new(false, null, string.Empty, string.Empty, null, false, null, HighlightColor.Cyan);
}

/// <summary>
/// The fully projected, render-ready view of one <c>HighlightCard</c> input — the native analogue of everything
/// the web component computes before returning JSX. Holds the active <see cref="State"/>, the resolved
/// <see cref="Glow"/>, the optional <see cref="IconGlyph"/> + <see cref="Label"/>, the verbatim
/// <see cref="Value"/>, the optional change (<see cref="HasChange"/> / <see cref="ChangeText"/> /
/// <see cref="ChangePositive"/> / <see cref="ChangeAccentKey"/>), the optional <see cref="Subtitle"/>, the shared
/// empty + loading copy, the em-dash <see cref="EmptyValueText"/>, and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Glow">The resolved panel glow (the web <c>glowMap[color]</c> result).</param>
/// <param name="IconGlyph">The Segoe Fluent label glyph, or null when the web <c>icon</c> was absent.</param>
/// <param name="Label">The metric label (web <c>label</c>).</param>
/// <param name="HasLabel">Whether a non-blank label is present.</param>
/// <param name="Value">The already-formatted metric value, rendered verbatim (web <c>value</c>).</param>
/// <param name="HasChange">Whether a change caption is present (web <c>change</c> truthy).</param>
/// <param name="ChangeText">The verbatim change caption (web <c>change.value</c>).</param>
/// <param name="ChangePositive">Whether the change is favourable — up arrow + success, else down arrow + danger.</param>
/// <param name="ChangeAccentKey">The token brush key for the change tone (success / danger).</param>
/// <param name="HasSubtitle">Whether a subtitle is present (web <c>subtitle</c> truthy).</param>
/// <param name="Subtitle">The muted subtitle (web <c>subtitle</c>).</param>
/// <param name="EmptyMessage">The localized "No data available" copy (empty branch).</param>
/// <param name="LoadingLabel">The localized "Loading" copy (loading branch).</param>
/// <param name="EmptyValueText">The em dash shown in place of a missing value (empty branch).</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record HighlightCardDisplay(
    HighlightCardState State,
    HighlightGlow Glow,
    string? IconGlyph,
    string Label,
    bool HasLabel,
    string Value,
    bool HasChange,
    string ChangeText,
    bool ChangePositive,
    string ChangeAccentKey,
    bool HasSubtitle,
    string Subtitle,
    string EmptyMessage,
    string LoadingLabel,
    string EmptyValueText,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="HighlightCardModel"/> to its <see cref="HighlightCardDisplay"/> — the native
/// port of web/src/features/analytics/components/weekly-digest/HighlightCard.tsx. The branch precedence mirrors
/// the card's lifecycle (loading → empty → ready); the colour→glow mapping reproduces the web <c>glowMap</c>
/// (cyan/green/purple keep their glow, amber/red collapse to none); and the change tone reuses the shared
/// <see cref="DeltaLogic.AccentBrushKey(DeltaTone)"/> so a favourable change tints success and an unfavourable
/// one tints danger, exactly as the web's <c>emerald-400</c> / <c>red-400</c> classes do. The value and change
/// captions are rendered verbatim (the web interpolates the resolved strings unchanged). The only i18n the card
/// owns is the shared loading / empty copy. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class HighlightCardProjection
{
    /// <summary>The em dash shown in place of a missing value (the project-wide null-safety fallback marker).</summary>
    public const string EmDash = "\u2014";

    /// <summary>i18n key for the empty-state copy (the shared <c>chart.noData</c> string).</summary>
    public const string EmptyMessageKey = "chart.noData";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/>.</summary>
    public const string EmptyMessageFallback = "No data available";

    /// <summary>i18n key for the loading copy (the shared <c>common.loading</c> string).</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the loading / empty copy resolves through.</param>
    public static HighlightCardDisplay Project(HighlightCardModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string label = model.Label ?? string.Empty;
        string value = model.Value ?? string.Empty;
        string? iconGlyph = string.IsNullOrEmpty(model.IconGlyph) ? null : model.IconGlyph;
        bool hasLabel = !string.IsNullOrWhiteSpace(label);

        string changeText = model.ChangeValue ?? string.Empty;
        bool hasChange = !string.IsNullOrWhiteSpace(changeText);
        string changeAccentKey = DeltaLogic.AccentBrushKey(
            model.ChangePositive ? DeltaTone.Positive : DeltaTone.Negative);

        string subtitle = model.Subtitle ?? string.Empty;
        bool hasSubtitle = !string.IsNullOrWhiteSpace(subtitle);

        string emptyMessage = localizer.GetString(EmptyMessageKey, EmptyMessageFallback);
        string loadingLabel = localizer.GetString(LoadingKey, LoadingFallback);

        HighlightCardState state = SelectState(model, value);

        return new HighlightCardDisplay(
            State: state,
            Glow: GlowFor(model.Color),
            IconGlyph: iconGlyph,
            Label: label,
            HasLabel: hasLabel,
            Value: value,
            HasChange: hasChange,
            ChangeText: changeText,
            ChangePositive: model.ChangePositive,
            ChangeAccentKey: changeAccentKey,
            HasSubtitle: hasSubtitle,
            Subtitle: subtitle,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            EmptyValueText: EmDash,
            AutomationName: BuildAutomationName(
                state, hasLabel, label, value, hasChange, changeText, hasSubtitle, subtitle, emptyMessage, loadingLabel));
    }

    /// <summary>
    /// Map a <see cref="HighlightColor"/> to its panel glow — the web <c>glowMap</c>: cyan/green/purple keep their
    /// glow, amber and red collapse to <see cref="HighlightGlow.None"/>.
    /// </summary>
    public static HighlightGlow GlowFor(HighlightColor color) => color switch
    {
        HighlightColor.Cyan => HighlightGlow.Cyan,
        HighlightColor.Green => HighlightGlow.Green,
        HighlightColor.Purple => HighlightGlow.Purple,
        _ => HighlightGlow.None,
    };

    /// <summary>Branch precedence from the card lifecycle: loading → empty (no value) → ready.</summary>
    private static HighlightCardState SelectState(HighlightCardModel model, string value)
    {
        if (model.Loading)
        {
            return HighlightCardState.Loading;
        }

        // A resolved card with no value has nothing to highlight — render the em-dash fallback rather than an empty
        // (blank) panel, mirroring the project-wide "always show a fallback" rule.
        return string.IsNullOrWhiteSpace(value)
            ? HighlightCardState.Empty
            : HighlightCardState.Ready;
    }

    private static string BuildAutomationName(
        HighlightCardState state,
        bool hasLabel,
        string label,
        string value,
        bool hasChange,
        string changeText,
        bool hasSubtitle,
        string subtitle,
        string emptyMessage,
        string loadingLabel)
    {
        switch (state)
        {
            case HighlightCardState.Loading:
                return loadingLabel;

            case HighlightCardState.Empty:
                return hasLabel
                    ? string.Create(CultureInfo.CurrentCulture, $"{label}. {emptyMessage}")
                    : emptyMessage;

            default:
                // Reading order matches the web card: label, value, change, subtitle. Only present parts are
                // spoken so the Narrator name never carries a dangling separator.
                var parts = new List<string>(4);
                if (hasLabel)
                {
                    parts.Add(label);
                }

                parts.Add(value);
                if (hasChange)
                {
                    parts.Add(changeText);
                }

                if (hasSubtitle)
                {
                    parts.Add(subtitle);
                }

                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>HighlightCard</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the label, value, change or subtitle — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class HighlightCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public HighlightCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HighlightCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HighlightCardRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>HighlightCard</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/analytics/components/weekly-digest/HighlightCard.tsx</c>. Holds the diagnostics slug and
/// the Segoe Fluent glyphs that stand in for the web Lucide trend icons (<c>TrendingUp</c> / <c>TrendingDown</c>).
/// UI-free so the metadata is asserted in tests.
/// </summary>
public static class HighlightCardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "HighlightCard";

    /// <summary>Segoe Fluent "ChevronUp" glyph for a favourable change (web <c>TrendingUp</c>).</summary>
    public const string TrendingUpGlyph = "\uE70E";

    /// <summary>Segoe Fluent "ChevronDown" glyph for an unfavourable change (web <c>TrendingDown</c>).</summary>
    public const string TrendingDownGlyph = "\uE70D";
}
