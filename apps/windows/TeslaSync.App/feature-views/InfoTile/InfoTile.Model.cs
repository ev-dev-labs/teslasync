using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The three shapes an <see cref="InfoTileValue"/> can carry — the native analogue of the web
/// <c>value: string | number | boolean</c> union in
/// web/src/features/vehicles/components/telemetry-panels/InfoTile.tsx. Only the boolean shape changes how the
/// value renders (the web maps it to a Yes / No word); text and numeric values render through their own
/// formatting. Mirrors the established <c>SettingValueKind</c> ('text' | 'number' | 'boolean') discriminator.
/// </summary>
public enum InfoTileValueKind
{
    /// <summary>A free-text value rendered verbatim (web <c>value: string</c>).</summary>
    Text,

    /// <summary>A numeric value rendered with its JavaScript <c>String(value)</c> form (web <c>value: number</c>).</summary>
    Number,

    /// <summary>A boolean value rendered as the localized Yes / No word (web <c>value: boolean</c>).</summary>
    Boolean,
}

/// <summary>
/// The render-time value an <see cref="InfoTileModel"/> carries — the native, statically-typed analogue of the
/// web <c>value: string | number | boolean</c> union. Construct one with <see cref="FromText"/>,
/// <see cref="FromNumber"/> or <see cref="FromBoolean"/>; the <see cref="InfoTileProjection"/> resolves it to its
/// display string exactly as the web does (<c>typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value</c>).
/// Pure data with value equality, so the projection is asserted headlessly. The <c>default</c> value is an empty
/// text value.
/// </summary>
public readonly record struct InfoTileValue
{
    private InfoTileValue(InfoTileValueKind kind, string? text, double number, bool boolean)
    {
        Kind = kind;
        TextValue = text;
        NumberValue = number;
        BooleanValue = boolean;
    }

    /// <summary>Which of the three union shapes this value carries.</summary>
    public InfoTileValueKind Kind { get; }

    /// <summary>The text payload when <see cref="Kind"/> is <see cref="InfoTileValueKind.Text"/>; otherwise <c>null</c>.</summary>
    public string? TextValue { get; }

    /// <summary>The numeric payload when <see cref="Kind"/> is <see cref="InfoTileValueKind.Number"/>; otherwise <c>0</c>.</summary>
    public double NumberValue { get; }

    /// <summary>The boolean payload when <see cref="Kind"/> is <see cref="InfoTileValueKind.Boolean"/>; otherwise <c>false</c>.</summary>
    public bool BooleanValue { get; }

    /// <summary>A text value (web <c>value: string</c>); a <c>null</c> string is normalized to empty.</summary>
    public static InfoTileValue FromText(string? value) => new(InfoTileValueKind.Text, value ?? string.Empty, 0d, false);

    /// <summary>A numeric value (web <c>value: number</c>).</summary>
    public static InfoTileValue FromNumber(double value) => new(InfoTileValueKind.Number, null, value, false);

    /// <summary>A boolean value (web <c>value: boolean</c>).</summary>
    public static InfoTileValue FromBoolean(bool value) => new(InfoTileValueKind.Boolean, null, 0d, value);
}

/// <summary>
/// The render-time data model the <c>InfoTile</c> view binds to — the native analogue of the web
/// <c>InfoTileProps</c> (<c>{ icon, label, value, color?, sub? }</c> in
/// web/src/features/vehicles/components/telemetry-panels/InfoTile.tsx). The web component is a pure presentational
/// tile: the parent telemetry panel owns any data fetching and feeds an already-localized <see cref="Label"/> /
/// <see cref="Sub"/>, the typed <see cref="Value"/>, the Segoe Fluent <see cref="IconGlyph"/> standing in for the
/// web Lucide icon, and an optional value-colour token (<see cref="ColorBrushKey"/>). There is therefore no
/// fetch-driven loading / empty / error / stale / offline branch to reproduce here (those belong to the parent,
/// exactly as React re-renders the tile with already-resolved props). Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="IconGlyph">The Segoe Fluent glyph standing in for the web Lucide <c>icon</c>; falls back to <see cref="InfoTileRegistration.DefaultIconGlyph"/> when empty.</param>
/// <param name="Label">The already-localized caption shown beside the icon (web <c>label</c>).</param>
/// <param name="Value">The typed value (web <c>value: string | number | boolean</c>).</param>
/// <param name="ColorBrushKey">The token brush key for the value text (web <c>color</c>); <c>null</c> / empty uses <see cref="InfoTileRegistration.DefaultColorBrushKey"/> (web default <c>text-[var(--text-primary)]</c>).</param>
/// <param name="Sub">The optional sublabel (web <c>sub</c>); <c>null</c> / empty hides the sub line (web <c>sub &amp;&amp; …</c>).</param>
public sealed record InfoTileModel(
    string IconGlyph,
    string Label,
    InfoTileValue Value,
    string? ColorBrushKey = null,
    string? Sub = null)
{
    /// <summary>The initial model — an empty, unlabeled tile with the neutral fallback glyph and an empty value.</summary>
    public static InfoTileModel Empty { get; } = new(
        IconGlyph: InfoTileRegistration.DefaultIconGlyph,
        Label: string.Empty,
        Value: InfoTileValue.FromText(string.Empty));
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="InfoTileModel"/> — the native analogue of everything
/// web/src/features/vehicles/components/telemetry-panels/InfoTile.tsx derives before returning JSX: the resolved
/// <see cref="IconGlyph"/>, the passthrough <see cref="Label"/>, the resolved value <see cref="Value"/> (web
/// <c>display</c>) with its hover <see cref="ValueTooltip"/> (web <c>title={String(display)}</c>), the
/// token-backed value <see cref="ColorBrushKey"/>, whether a sub line renders and its <see cref="Sub"/> text, and
/// the composed Narrator name. Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="Label">The caption shown beside the icon, verbatim.</param>
/// <param name="IconGlyph">The Segoe Fluent glyph for the leading icon.</param>
/// <param name="Value">The resolved value string (web <c>display</c>).</param>
/// <param name="ValueTooltip">The full value shown on hover (web <c>title={String(display)}</c>).</param>
/// <param name="ColorBrushKey">The token brush key the value text tints with.</param>
/// <param name="Sub">The sublabel text, verbatim (empty when hidden).</param>
/// <param name="ShowSub">Whether the sub line renders (web <c>sub &amp;&amp; …</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record InfoTileDisplay(
    string Label,
    string IconGlyph,
    string Value,
    string ValueTooltip,
    string ColorBrushKey,
    string Sub,
    bool ShowSub,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="InfoTileModel"/> to its <see cref="InfoTileDisplay"/> — the native port of
/// the derivations in web/src/features/vehicles/components/telemetry-panels/InfoTile.tsx. Reproduces the web logic
/// exactly: the value is <c>typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value</c> (the Yes / No words
/// flow through the i18n facade so the tile emits no hardcoded English of its own); the hover tooltip is the
/// rendered value (web <c>title={String(display)}</c>); the icon falls back to the neutral glyph when none is
/// supplied; the value colour is the supplied token brush key or the primary-text default (web <c>color ??
/// 'text-[var(--text-primary)]'</c>); and the sub line renders only when a sub string is present (web <c>sub
/// &amp;&amp; …</c>). No WinUI types — unit-tested without a UI host.
/// </summary>
public static class InfoTileProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the Yes / No words resolve through.</param>
    public static InfoTileDisplay Project(InfoTileModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string label = model.Label ?? string.Empty;
        string value = ResolveValue(model.Value, localizer);
        string sub = model.Sub ?? string.Empty;
        bool showSub = !string.IsNullOrEmpty(sub);

        string iconGlyph = string.IsNullOrEmpty(model.IconGlyph)
            ? InfoTileRegistration.DefaultIconGlyph
            : model.IconGlyph;

        string colorBrushKey = string.IsNullOrEmpty(model.ColorBrushKey)
            ? InfoTileRegistration.DefaultColorBrushKey
            : model.ColorBrushKey!;

        return new InfoTileDisplay(
            Label: label,
            IconGlyph: iconGlyph,
            Value: value,
            ValueTooltip: value,
            ColorBrushKey: colorBrushKey,
            Sub: sub,
            ShowSub: showSub,
            AutomationName: AutomationNameOf(label, value, sub, showSub));
    }

    /// <summary>
    /// Resolve <paramref name="value"/> to its rendered string, mirroring the web
    /// <c>typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value</c>: a boolean resolves the localized
    /// Yes / No word, a number uses its <see cref="FormatNumber"/> form and text renders verbatim.
    /// </summary>
    /// <param name="value">The typed value (the web union).</param>
    /// <param name="localizer">The i18n facade the Yes / No words resolve through.</param>
    public static string ResolveValue(InfoTileValue value, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return value.Kind switch
        {
            InfoTileValueKind.Boolean => value.BooleanValue
                ? localizer.GetString(InfoTileRegistration.YesKey, InfoTileRegistration.YesFallback)
                : localizer.GetString(InfoTileRegistration.NoKey, InfoTileRegistration.NoFallback),
            InfoTileValueKind.Number => FormatNumber(value.NumberValue),
            _ => value.TextValue ?? string.Empty,
        };
    }

    /// <summary>
    /// Format <paramref name="value"/> as React renders a number child — its JavaScript <c>String(value)</c>
    /// form, NOT the grouped <c>Intl.NumberFormat</c> the rest of the app uses (the web <c>InfoTile</c> renders
    /// the raw number, so a thousands value shows ungrouped). The shortest round-trip invariant representation
    /// matches <c>String()</c> for the finite values a tile shows; a signed zero collapses to "0" and the
    /// non-finite values use the same NaN / Infinity / -Infinity tokens <c>String()</c> emits.
    /// </summary>
    /// <param name="value">The numeric value to render.</param>
    public static string FormatNumber(double value)
    {
        if (double.IsNaN(value))
        {
            return "NaN";
        }

        if (double.IsPositiveInfinity(value))
        {
            return "Infinity";
        }

        if (double.IsNegativeInfinity(value))
        {
            return "-Infinity";
        }

        if (value == 0d)
        {
            return "0";
        }

        return value.ToString(CultureInfo.InvariantCulture);
    }

    private static string AutomationNameOf(string label, string value, string sub, bool showSub)
    {
        string head =
            string.IsNullOrEmpty(label) ? value
            : string.IsNullOrEmpty(value) ? label
            : string.Concat(label, ": ", value);

        if (!showSub || string.IsNullOrEmpty(sub))
        {
            return head;
        }

        return string.IsNullOrEmpty(head) ? sub : string.Concat(head, ", ", sub);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>InfoTile</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the label, value or sublabel — so a
/// diagnostics line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class InfoTileDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public InfoTileDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=InfoTile</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={InfoTileRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>InfoTile</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/vehicles/components/telemetry-panels/InfoTile.tsx</c>: the stable diagnostics slug, the
/// neutral Segoe Fluent fallback glyph used when a caller supplies no icon (the web always passes one), the
/// default value-colour token brush key (web <c>text-[var(--text-primary)]</c>) and the two shared i18n keys the
/// boolean value resolves through (<c>common.yes</c> / <c>common.no</c>). UI-free so the metadata is asserted in
/// tests.
/// </summary>
public static class InfoTileRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "InfoTile";

    /// <summary>Segoe Fluent "Info" glyph — the neutral fallback for the leading icon when a caller supplies none.</summary>
    public const string DefaultIconGlyph = "\uE946";

    /// <summary>Default value-colour token brush key — the web default <c>text-[var(--text-primary)]</c>.</summary>
    public const string DefaultColorBrushKey = "TsColorTextPrimaryBrush";

    /// <summary>i18n key for the true boolean word (web hardcoded <c>'Yes'</c>; shared <c>common.yes</c>).</summary>
    public const string YesKey = "common.yes";

    /// <summary>English fallback for <see cref="YesKey"/> (web <c>'Yes'</c>).</summary>
    public const string YesFallback = "Yes";

    /// <summary>i18n key for the false boolean word (web hardcoded <c>'No'</c>; shared <c>common.no</c>).</summary>
    public const string NoKey = "common.no";

    /// <summary>English fallback for <see cref="NoKey"/> (web <c>'No'</c>).</summary>
    public const string NoFallback = "No";
}
