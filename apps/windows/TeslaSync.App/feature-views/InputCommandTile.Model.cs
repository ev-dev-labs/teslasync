using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The accent variant a command tile is keyed with — the native mirror of the web prop
/// <c>variant?: 'default' | 'danger' | 'success'</c>
/// (web/src/features/system/components/InputCommandTile.tsx). In the web source the variant drives only the
/// hover border tint (<c>hoverStyles[variant]</c>): default → cyan, danger → red, success → green. Absent or
/// unknown values collapse to <see cref="Default"/>, exactly as the web <c>def.variant ?? 'default'</c>.
/// </summary>
public enum InputCommandVariant
{
    /// <summary>Web <c>'default'</c> — hover border tints with the cyan accent.</summary>
    Default,

    /// <summary>Web <c>'danger'</c> — hover border tints with the danger (red) accent.</summary>
    Danger,

    /// <summary>Web <c>'success'</c> — hover border tints with the success (green) accent.</summary>
    Success,
}

/// <summary>
/// The tone of the tile's last-command status caption — the native classification of the web
/// <c>lastStatus.startsWith('✓') ? 'text-neon-green/60' : 'text-neon-red/60'</c>
/// (web/src/features/system/components/InputCommandTile.tsx). A check-mark prefix reads as success (green);
/// any other non-blank status reads as a failure (red); a blank / absent status shows no caption.
/// </summary>
public enum InputCommandStatusTone
{
    /// <summary>No status caption is shown (web <c>lastStatus</c> is absent / blank).</summary>
    None,

    /// <summary>The last command succeeded — the web check-mark (<c>✓</c>) prefix, tinted success/green.</summary>
    Success,

    /// <summary>The last command failed — any other non-blank status, tinted danger/red.</summary>
    Error,
}

/// <summary>
/// The mutually-exclusive render branch of the <c>InputCommandTile</c> surface. The web source is a pure
/// presentational tile (its only data source is <c>useTranslation</c>) so — exactly as the sibling
/// <c>ToolCard</c> / <c>HighlightCard</c> / <c>AddWidgetButton</c> ports — there is no fetch-driven
/// empty / error / stale / offline branch to reproduce: those belong to data-backed surfaces and the parent
/// Vehicle-Commands experience owns any query lifecycle. The single lifecycle flag the tile itself renders is
/// the web <c>loading</c> prop (a command dispatch in flight), which swaps the icon for a busy indicator,
/// dims the surface and suppresses the open-dialog click — modelled here as <see cref="Loading"/>. Every
/// branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum InputCommandTileState
{
    /// <summary>Idle (web <c>loading === false</c>) — the command icon shows and the tile opens its dialog on click.</summary>
    Ready,

    /// <summary>A command dispatch is in flight (web <c>loading</c>) — busy indicator, dimmed surface, click suppressed.</summary>
    Loading,
}

/// <summary>
/// The render-time data model the <c>InputCommandTile</c> view binds to — the native analogue of the web
/// <c>InputCommandTileProps</c> (web/src/features/system/components/InputCommandTile.tsx). The web
/// <c>def: CommandDef</c> is flattened to the fields the tile actually renders: the parent-supplied
/// <see cref="IconGlyph"/> (a Segoe Fluent glyph standing in for the web Lucide <c>def.icon</c>), the
/// <see cref="Variant"/> (web <c>def.variant</c>), and the label / sublabel i18n keys with their English
/// fallbacks (the tile resolves them through the i18n facade exactly as the web calls
/// <c>t(def.labelKey, def.labelFallback)</c> / <c>t(def.sublabelKey ?? '', def.sublabelFallback)</c>). The
/// lifecycle props <see cref="Loading"/>, <see cref="LastStatus"/> and <see cref="IsFavorite"/> mirror the web
/// props 1:1. The two web callbacks (<c>onRequestDialog</c> / <c>onToggleFavorite</c>) are modelled as view
/// events rather than fields, so this stays a pure, WinUI-free value — unit-tested without a UI host.
/// </summary>
/// <param name="IconGlyph">Segoe Fluent glyph for the command icon (web <c>def.icon</c>); blank falls back to a generic glyph.</param>
/// <param name="Variant">The accent variant (web <c>def.variant ?? 'default'</c>).</param>
/// <param name="LabelKey">i18n key for the command label (web <c>def.labelKey</c>).</param>
/// <param name="LabelFallback">English fallback for the label (web <c>def.labelFallback</c>).</param>
/// <param name="SublabelKey">Optional i18n key for the sublabel (web <c>def.sublabelKey</c>), or null.</param>
/// <param name="SublabelFallback">Optional English fallback for the sublabel (web <c>def.sublabelFallback</c>), or null.</param>
/// <param name="Loading">Whether a command dispatch is in flight (web <c>loading</c>).</param>
/// <param name="LastStatus">The last command's status caption (web <c>lastStatus</c>), or null.</param>
/// <param name="IsFavorite">Whether the command is pinned as a favorite (web <c>isFavorite</c>).</param>
public sealed record InputCommandTileModel(
    string IconGlyph,
    InputCommandVariant Variant,
    string LabelKey,
    string LabelFallback,
    string? SublabelKey,
    string? SublabelFallback,
    bool Loading,
    string? LastStatus,
    bool IsFavorite)
{
    /// <summary>An idle, non-favorite sample tile (the default render model used by hosts and tests).</summary>
    public static InputCommandTileModel Idle { get; } = new(
        InputCommandTileRegistration.DefaultCommandGlyph,
        InputCommandVariant.Default,
        LabelKey: string.Empty,
        LabelFallback: string.Empty,
        SublabelKey: null,
        SublabelFallback: null,
        Loading: false,
        LastStatus: null,
        IsFavorite: false);
}

/// <summary>
/// The fully projected, render-ready view of one <see cref="InputCommandTileModel"/> — everything the web
/// component derives before returning JSX. Holds the active <see cref="State"/>, the resolved
/// <see cref="IconGlyph"/>, the variant + its hover-accent token key, the resolved <see cref="Label"/>, the
/// optional sublabel (<see cref="HasSublabel"/> / <see cref="Sublabel"/>), the optional last-command status
/// (<see cref="HasStatus"/> / <see cref="StatusText"/> / <see cref="StatusTone"/> / <see cref="StatusAccentKey"/>),
/// the favorite state with its glyph + accent token key, the resolved favorite-toggle accessible label, and the
/// composed surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved render branch (ready / loading).</param>
/// <param name="IsLoading">Whether a command dispatch is in flight (drives the busy indicator + suppressed click).</param>
/// <param name="IconGlyph">The resolved Segoe Fluent command glyph (never blank).</param>
/// <param name="Variant">The resolved accent variant.</param>
/// <param name="HoverAccentKey">The token brush key the hover / focus border tints with for the variant.</param>
/// <param name="Label">The resolved command label (web <c>t(def.labelKey, def.labelFallback)</c>).</param>
/// <param name="HasSublabel">Whether a non-blank sublabel is present (web <c>def.sublabelFallback</c> truthy).</param>
/// <param name="Sublabel">The resolved sublabel, or empty.</param>
/// <param name="HasStatus">Whether a non-blank last-command status caption is present.</param>
/// <param name="StatusText">The verbatim status caption (web <c>lastStatus</c>), or empty.</param>
/// <param name="StatusTone">The status tone (success / error / none).</param>
/// <param name="StatusAccentKey">The token brush key for the status tone, or empty when there is no status.</param>
/// <param name="IsFavorite">Whether the command is pinned as a favorite.</param>
/// <param name="FavoriteGlyph">The Segoe Fluent star glyph (filled when favorite, outline otherwise).</param>
/// <param name="FavoriteAccentKey">The token brush key for the star (warning/amber when favorite, muted otherwise).</param>
/// <param name="FavoriteToggleLabel">The resolved accessible label for the favorite toggle (web <c>commands.toggleFavorite</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the clickable tile.</param>
public sealed record InputCommandTileDisplay(
    InputCommandTileState State,
    bool IsLoading,
    string IconGlyph,
    InputCommandVariant Variant,
    string HoverAccentKey,
    string Label,
    bool HasSublabel,
    string Sublabel,
    bool HasStatus,
    string StatusText,
    InputCommandStatusTone StatusTone,
    string StatusAccentKey,
    bool IsFavorite,
    string FavoriteGlyph,
    string FavoriteAccentKey,
    string FavoriteToggleLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="InputCommandTileModel"/> to its <see cref="InputCommandTileDisplay"/> —
/// the native port of web/src/features/system/components/InputCommandTile.tsx. Reproduces the web derivations
/// exactly: the icon falls back to a generic glyph when the host supplies none (the web <c>def.icon</c> is
/// always present); the variant maps to its hover-border accent (<c>hoverStyles</c>: default → cyan,
/// danger → red, success → green); the label and sublabel resolve through the i18n facade (the sublabel only
/// renders when the web <c>def.sublabelFallback</c> is truthy); the last-command status keeps the web tone rule
/// (a <c>✓</c> prefix → success/green, any other non-blank text → failure/red); and the favorite toggle resolves
/// its glyph + accent from <see cref="InputCommandTileModel.IsFavorite"/>. No WinUI types — unit-tested without
/// a UI host.
/// </summary>
public static class InputCommandTileProjection
{
    /// <summary>The check-mark prefix the web uses to mark a successful last-command status (U+2713).</summary>
    public const string SuccessPrefix = "\u2713";

    /// <summary>Project <paramref name="model"/> into a render-ready display, resolving copy via <paramref name="localizer"/>.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the labels and the favorite-toggle label resolve through.</param>
    public static InputCommandTileDisplay Project(InputCommandTileModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string iconGlyph = string.IsNullOrEmpty(model.IconGlyph)
            ? InputCommandTileRegistration.DefaultCommandGlyph
            : model.IconGlyph;

        string label = localizer.GetString(model.LabelKey ?? string.Empty, model.LabelFallback ?? string.Empty);

        // Web: the sublabel block only renders when `def.sublabelFallback` is truthy.
        bool hasSublabel = !string.IsNullOrWhiteSpace(model.SublabelFallback);
        string sublabel = hasSublabel
            ? localizer.GetString(model.SublabelKey ?? string.Empty, model.SublabelFallback!)
            : string.Empty;

        string statusText = model.LastStatus ?? string.Empty;
        bool hasStatus = !string.IsNullOrWhiteSpace(statusText);
        InputCommandStatusTone statusTone = ToneFor(model.LastStatus);
        string statusAccentKey = hasStatus ? StatusAccentKey(statusTone) : string.Empty;

        InputCommandTileState state = model.Loading ? InputCommandTileState.Loading : InputCommandTileState.Ready;

        string favoriteToggleLabel = localizer.GetString(
            InputCommandTileRegistration.FavoriteToggleKey,
            InputCommandTileRegistration.FavoriteToggleFallback);

        return new InputCommandTileDisplay(
            State: state,
            IsLoading: model.Loading,
            IconGlyph: iconGlyph,
            Variant: model.Variant,
            HoverAccentKey: HoverAccentKey(model.Variant),
            Label: label,
            HasSublabel: hasSublabel,
            Sublabel: sublabel,
            HasStatus: hasStatus,
            StatusText: statusText,
            StatusTone: statusTone,
            StatusAccentKey: statusAccentKey,
            IsFavorite: model.IsFavorite,
            FavoriteGlyph: model.IsFavorite
                ? InputCommandTileRegistration.FavoriteFilledGlyph
                : InputCommandTileRegistration.FavoriteOutlineGlyph,
            FavoriteAccentKey: model.IsFavorite
                ? InputCommandTileRegistration.FavoriteActiveAccentKey
                : InputCommandTileRegistration.FavoriteInactiveAccentKey,
            FavoriteToggleLabel: favoriteToggleLabel,
            AutomationName: BuildAutomationName(label, hasSublabel, sublabel, hasStatus, statusText));
    }

    /// <summary>
    /// Classify a last-command status caption into its tone — the web rule
    /// <c>lastStatus.startsWith('✓') ? success : failure</c>, with a blank / absent status showing no caption.
    /// </summary>
    public static InputCommandStatusTone ToneFor(string? status)
    {
        if (string.IsNullOrWhiteSpace(status))
        {
            return InputCommandStatusTone.None;
        }

        return status.StartsWith(SuccessPrefix, StringComparison.Ordinal)
            ? InputCommandStatusTone.Success
            : InputCommandStatusTone.Error;
    }

    /// <summary>The token brush key a status <paramref name="tone"/> tints with (success → green, error → red).</summary>
    public static string StatusAccentKey(InputCommandStatusTone tone) => tone switch
    {
        InputCommandStatusTone.Success => "TsColorSuccessBrush",
        InputCommandStatusTone.Error => "TsColorDangerBrush",
        _ => string.Empty,
    };

    /// <summary>
    /// The token brush key a <paramref name="variant"/>'s hover / focus border tints with — the web
    /// <c>hoverStyles</c>: default → cyan accent, danger → red, success → green.
    /// </summary>
    public static string HoverAccentKey(InputCommandVariant variant) => variant switch
    {
        InputCommandVariant.Danger => "TsColorDangerBrush",
        InputCommandVariant.Success => "TsColorSuccessBrush",
        _ => "TsColorAccentBrush",
    };

    /// <summary>
    /// Canonicalise a web variant string (<c>'default'</c> / <c>'danger'</c> / <c>'success'</c>) to an
    /// <see cref="InputCommandVariant"/>, falling back to <see cref="InputCommandVariant.Default"/> for an
    /// unknown, empty or null value (the web <c>def.variant ?? 'default'</c>). Case- and
    /// surrounding-whitespace-insensitive.
    /// </summary>
    public static InputCommandVariant ResolveVariant(string? variant)
    {
        string trimmed = (variant ?? string.Empty).Trim();
        if (string.Equals(trimmed, "danger", StringComparison.OrdinalIgnoreCase))
        {
            return InputCommandVariant.Danger;
        }

        if (string.Equals(trimmed, "success", StringComparison.OrdinalIgnoreCase))
        {
            return InputCommandVariant.Success;
        }

        return InputCommandVariant.Default;
    }

    private static string BuildAutomationName(
        string label,
        bool hasSublabel,
        string sublabel,
        bool hasStatus,
        string statusText)
    {
        // Reading order matches the tile's visual order: label, sublabel, last-command status. Only present
        // parts are spoken so the Narrator name never carries a dangling separator.
        var parts = new List<string>(3);
        if (!string.IsNullOrWhiteSpace(label))
        {
            parts.Add(label);
        }

        if (hasSublabel)
        {
            parts.Add(sublabel);
        }

        if (hasStatus)
        {
            parts.Add(statusText);
        }

        return string.Join(". ", parts);
    }
}

/// <summary>
/// Canonical metadata for the <c>InputCommandTile</c> feature surface — the native mirror of the web component
/// at web/src/features/system/components/InputCommandTile.tsx. Holds the diagnostics slug, the single static
/// i18n key the tile owns (the favorite-toggle accessible label, with the same English fallback the web
/// <c>t('commands.toggleFavorite', 'Toggle favorite')</c> call carries), the Segoe Fluent star glyphs that
/// stand in for the web Lucide <c>Star</c> (filled when favorite, outline otherwise), the favorite accent token
/// keys, and the generic fallback command glyph. UI-free so the metadata is asserted in tests.
/// </summary>
public static class InputCommandTileRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "InputCommandTile";

    /// <summary>The i18n key for the favorite-toggle accessible label (web <c>t('commands.toggleFavorite', ...)</c>).</summary>
    public const string FavoriteToggleKey = "commands.toggleFavorite";

    /// <summary>The English fallback the web <c>t(...)</c> call carries for <see cref="FavoriteToggleKey"/>.</summary>
    public const string FavoriteToggleFallback = "Toggle favorite";

    /// <summary>Segoe Fluent "FavoriteStarFill" glyph — the favorite star when pinned (web <c>Star</c> with <c>fill-current</c>).</summary>
    public const string FavoriteFilledGlyph = "\uE735";

    /// <summary>Segoe Fluent "FavoriteStar" glyph — the favorite star when not pinned (web outline <c>Star</c>).</summary>
    public const string FavoriteOutlineGlyph = "\uE734";

    /// <summary>The token brush key for a pinned favorite star (web <c>text-amber-300</c>).</summary>
    public const string FavoriteActiveAccentKey = "TsColorWarningBrush";

    /// <summary>The token brush key for an unpinned favorite star (web muted <c>--text-muted</c>).</summary>
    public const string FavoriteInactiveAccentKey = "TsColorTextMutedBrush";

    /// <summary>
    /// Segoe Fluent "Setting" glyph used as a generic command icon when the host supplies none. The web
    /// <c>def.icon</c> is always present, so this is a defensive fallback that keeps the icon slot from ever
    /// being blank.
    /// </summary>
    public const string DefaultCommandGlyph = "\uE713";
}

/// <summary>
/// PII-safe diagnostics for the <c>InputCommandTile</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event and the data-free <c>dialog.requested</c> / <c>favorite.toggled</c>
/// activations with the surface slug — never the command label, sublabel or status — so a diagnostics line can
/// never leak fleet state. Thread-safe.
/// </summary>
public sealed class InputCommandTileDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _dialogsRequested;
    private long _favoritesToggled;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or null.</param>
    public InputCommandTileDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the tile requested its command dialog (web <c>onRequestDialog</c>).</summary>
    public long DialogsRequested => Interlocked.Read(ref _dialogsRequested);

    /// <summary>Number of times the favorite toggle was activated (web <c>onToggleFavorite</c>).</summary>
    public long FavoritesToggled => Interlocked.Read(ref _favoritesToggled);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=InputCommandTile</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={InputCommandTileRegistration.Slug}");
    }

    /// <summary>Record that the command dialog was requested, emitting <c>dialog.requested slug=InputCommandTile</c>.</summary>
    public void RecordDialogRequested()
    {
        Interlocked.Increment(ref _dialogsRequested);
        _sink?.Invoke($"dialog.requested slug={InputCommandTileRegistration.Slug}");
    }

    /// <summary>Record that the favorite toggle was activated, emitting <c>favorite.toggled slug=InputCommandTile</c>.</summary>
    public void RecordFavoriteToggled()
    {
        Interlocked.Increment(ref _favoritesToggled);
        _sink?.Invoke($"favorite.toggled slug={InputCommandTileRegistration.Slug}");
    }
}
