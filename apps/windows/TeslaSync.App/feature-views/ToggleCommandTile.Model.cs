using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The accent variant a toggle command tile is keyed with — the native mirror of the web prop
/// <c>variant?: 'default' | 'danger' | 'success'</c>
/// (web/src/features/system/components/ToggleCommandTile.tsx). In the web source the variant drives the
/// whole on-state tint (<c>onStyles[variant]</c>): default → cyan, danger → red, success → green — applied to
/// the panel border + fill, the status dot, the icon badge and the ON caption. Absent or unknown values
/// collapse to <see cref="Default"/>, exactly as the web <c>def.variant ?? 'default'</c>.
/// </summary>
public enum ToggleCommandVariant
{
    /// <summary>Web <c>'default'</c> — the on-state tints with the cyan accent.</summary>
    Default,

    /// <summary>Web <c>'danger'</c> — the on-state tints with the danger (red) accent.</summary>
    Danger,

    /// <summary>Web <c>'success'</c> — the on-state tints with the success (green) accent.</summary>
    Success,
}

/// <summary>
/// The tone of the tile's last-command status caption — the native classification of the web
/// <c>lastStatus.startsWith('✓') ? 'text-neon-green/60' : 'text-neon-red/60'</c>
/// (web/src/features/system/components/ToggleCommandTile.tsx). A check-mark prefix reads as success (green);
/// any other non-blank status reads as a failure (red); a blank / absent status shows no caption.
/// </summary>
public enum ToggleCommandStatusTone
{
    /// <summary>No status caption is shown (web <c>lastStatus</c> is absent / blank).</summary>
    None,

    /// <summary>The last command succeeded — the web check-mark (<c>✓</c>) prefix, tinted success/green.</summary>
    Success,

    /// <summary>The last command failed — any other non-blank status, tinted danger/red.</summary>
    Error,
}

/// <summary>
/// The mutually-exclusive lifecycle branch of the <c>ToggleCommandTile</c> surface. The web source is a pure
/// presentational tile (its only data source is <c>useTranslation</c>), so — exactly as the sibling
/// <c>InputCommandTile</c> / <c>ToolCard</c> ports — there is no fetch-driven empty / error / stale / offline
/// branch to reproduce: those belong to data-backed surfaces and the parent Vehicle-Commands experience owns
/// any query lifecycle. The lifecycle flag the tile itself renders is the web <c>loading</c> prop (a command
/// dispatch in flight), which swaps the icon for a busy indicator, dims the surface and suppresses the click —
/// modelled here as <see cref="Loading"/>. The on / off visual state is orthogonal to this lifecycle branch and
/// is carried by <see cref="ToggleCommandTileDisplay.IsOn"/>. Every branch maps onto a visible surface.
/// </summary>
public enum ToggleCommandTileState
{
    /// <summary>Idle (web <c>loading === false</c>) — the command icon shows and the tile dispatches on click.</summary>
    Ready,

    /// <summary>A command dispatch is in flight (web <c>loading</c>) — busy indicator, dimmed surface, click suppressed.</summary>
    Loading,
}

/// <summary>
/// The render-time data model the <c>ToggleCommandTile</c> view binds to — the native analogue of the web
/// <c>ToggleCommandTileProps</c> (web/src/features/system/components/ToggleCommandTile.tsx). The web
/// <c>def: CommandDef</c> is flattened to the fields the tile actually renders or dispatches: the on / off
/// Segoe Fluent glyphs (web <c>def.icon</c> / <c>def.iconOff ?? def.icon</c>), the <see cref="Variant"/>
/// (web <c>def.variant</c>), the label i18n key with its English fallback (resolved through the i18n facade
/// exactly as the web <c>t(def.labelKey, def.labelFallback)</c>), and the dispatch metadata the web
/// <c>handleClick</c> reads — the on / off command ids, whether the command is backed by a vehicle
/// <see cref="HasStateField"/> (web <c>def.stateField</c>) and whether turning it on opens an input dialog
/// (<see cref="HasInputConfig"/>, web <c>def.inputConfig</c>), plus the optional <see cref="Parameters"/> the
/// on-command is dispatched with (web <c>def.params</c>). The web <c>isOn</c> derivation
/// (<c>def.stateField &amp;&amp; state ? Boolean(state[def.stateField]) : localToggle</c>) is resolved by the
/// parent / state-holder into <see cref="IsOn"/>; the view keeps the optimistic local toggle for the
/// no-state-field case. The lifecycle props <see cref="Loading"/>, <see cref="LastStatus"/> and
/// <see cref="IsFavorite"/> mirror the web props 1:1. The three web callbacks (<c>onExecute</c> /
/// <c>onRequestDialog</c> / <c>onToggleFavorite</c>) are modelled as view events rather than fields, so this
/// stays a pure, WinUI-free value — unit-tested without a UI host.
/// </summary>
/// <param name="IconOnGlyph">Segoe Fluent glyph shown when on (web <c>def.icon</c>); blank falls back to a generic glyph.</param>
/// <param name="IconOffGlyph">Segoe Fluent glyph shown when off (web <c>def.iconOff</c>); null falls back to <paramref name="IconOnGlyph"/>.</param>
/// <param name="Variant">The accent variant (web <c>def.variant ?? 'default'</c>).</param>
/// <param name="LabelKey">i18n key for the command label (web <c>def.labelKey</c>).</param>
/// <param name="LabelFallback">English fallback for the label (web <c>def.labelFallback</c>).</param>
/// <param name="Command">The command id dispatched when turning the toggle on (web <c>def.command</c>).</param>
/// <param name="CommandOff">The command id dispatched when turning the toggle off (web <c>def.commandOff</c>), or null.</param>
/// <param name="HasStateField">Whether the on / off state is backed by a vehicle field (web <c>def.stateField</c> truthy).</param>
/// <param name="HasInputConfig">Whether turning the toggle on opens an input dialog (web <c>def.inputConfig</c> truthy).</param>
/// <param name="Parameters">Optional parameters the on-command is dispatched with (web <c>def.params</c>), or null.</param>
/// <param name="IsOn">The resolved on / off state (web <c>isOn</c>).</param>
/// <param name="Loading">Whether a command dispatch is in flight (web <c>loading</c>).</param>
/// <param name="LastStatus">The last command's status caption (web <c>lastStatus</c>), or null.</param>
/// <param name="IsFavorite">Whether the command is pinned as a favorite (web <c>isFavorite</c>).</param>
public sealed record ToggleCommandTileModel(
    string IconOnGlyph,
    string? IconOffGlyph,
    ToggleCommandVariant Variant,
    string LabelKey,
    string LabelFallback,
    string Command,
    string? CommandOff,
    bool HasStateField,
    bool HasInputConfig,
    IReadOnlyDictionary<string, object?>? Parameters,
    bool IsOn,
    bool Loading,
    string? LastStatus,
    bool IsFavorite)
{
    /// <summary>An idle, off, non-favorite sample tile (the default render model used by hosts and tests).</summary>
    public static ToggleCommandTileModel Idle { get; } = new(
        IconOnGlyph: ToggleCommandTileRegistration.DefaultCommandGlyph,
        IconOffGlyph: null,
        Variant: ToggleCommandVariant.Default,
        LabelKey: string.Empty,
        LabelFallback: string.Empty,
        Command: string.Empty,
        CommandOff: null,
        HasStateField: false,
        HasInputConfig: false,
        Parameters: null,
        IsOn: false,
        Loading: false,
        LastStatus: null,
        IsFavorite: false);
}

/// <summary>
/// The fully projected, render-ready view of one <see cref="ToggleCommandTileModel"/> — everything the web
/// component derives before returning JSX. Holds the lifecycle <see cref="State"/>, the on / off
/// <see cref="IsOn"/> flag, the on / off-resolved <see cref="IconGlyph"/>, the variant + its accent token key,
/// the per-element token keys for the icon glyph / status dot / ON-OFF caption (each switching between the
/// variant accent when on and the muted / surface token when off), the resolved <see cref="Label"/> and
/// <see cref="ToggleStateText"/> (the localized ON / OFF word), the optional last-command status
/// (<see cref="HasStatus"/> / <see cref="StatusText"/> / <see cref="StatusTone"/> / <see cref="StatusAccentKey"/>),
/// the favorite state with its glyph + accent token key, the resolved favorite-toggle accessible label, and the
/// composed surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved lifecycle branch (ready / loading).</param>
/// <param name="IsLoading">Whether a command dispatch is in flight (drives the busy indicator + suppressed click).</param>
/// <param name="IsOn">Whether the toggle reads as on (web <c>isOn</c>).</param>
/// <param name="IconGlyph">The on / off-resolved Segoe Fluent command glyph (never blank).</param>
/// <param name="Variant">The resolved accent variant.</param>
/// <param name="AccentKey">The variant's accent token brush key (cyan / red / green) used for every on-state tint.</param>
/// <param name="IconForegroundKey">The token brush key for the icon glyph (accent when on, muted when off).</param>
/// <param name="DotBrushKey">The token brush key for the status dot (accent when on, surface when off).</param>
/// <param name="Label">The resolved command label (web <c>t(def.labelKey, def.labelFallback)</c>).</param>
/// <param name="ToggleStateText">The localized ON / OFF caption (web <c>t('commands.on'|'commands.off', …)</c>).</param>
/// <param name="ToggleStateAccentKey">The token brush key for the ON / OFF caption (accent when on, muted when off).</param>
/// <param name="HasStatus">Whether a non-blank last-command status caption is present.</param>
/// <param name="StatusText">The verbatim status caption (web <c>lastStatus</c>), or empty.</param>
/// <param name="StatusTone">The status tone (success / error / none).</param>
/// <param name="StatusAccentKey">The token brush key for the status tone, or empty when there is no status.</param>
/// <param name="IsFavorite">Whether the command is pinned as a favorite.</param>
/// <param name="FavoriteGlyph">The Segoe Fluent star glyph (filled when favorite, outline otherwise).</param>
/// <param name="FavoriteAccentKey">The token brush key for the star (warning/amber when favorite, muted otherwise).</param>
/// <param name="FavoriteToggleLabel">The resolved accessible label for the favorite toggle (web <c>commands.toggleFavorite</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the clickable tile.</param>
public sealed record ToggleCommandTileDisplay(
    ToggleCommandTileState State,
    bool IsLoading,
    bool IsOn,
    string IconGlyph,
    ToggleCommandVariant Variant,
    string AccentKey,
    string IconForegroundKey,
    string DotBrushKey,
    string Label,
    string ToggleStateText,
    string ToggleStateAccentKey,
    bool HasStatus,
    string StatusText,
    ToggleCommandStatusTone StatusTone,
    string StatusAccentKey,
    bool IsFavorite,
    string FavoriteGlyph,
    string FavoriteAccentKey,
    string FavoriteToggleLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="ToggleCommandTileModel"/> to its <see cref="ToggleCommandTileDisplay"/> —
/// the native port of web/src/features/system/components/ToggleCommandTile.tsx. Reproduces the web derivations
/// exactly: the icon switches on the on / off state (web <c>isOn ? def.icon : (def.iconOff ?? def.icon)</c>)
/// and falls back to a generic glyph when the host supplies none; the variant maps to its accent token
/// (<c>onStyles</c>: default → cyan, danger → red, success → green) which tints the panel, dot, icon badge and
/// ON caption while on, the off-state collapsing to the muted / surface tokens; the label resolves through the
/// i18n facade; the ON / OFF word resolves from <c>commands.on</c> / <c>commands.off</c>; and the last-command
/// status keeps the web tone rule (a <c>✓</c> prefix → success/green, any other non-blank text → failure/red).
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ToggleCommandTileProjection
{
    /// <summary>The check-mark prefix the web uses to mark a successful last-command status (U+2713).</summary>
    public const string SuccessPrefix = "\u2713";

    /// <summary>Project <paramref name="model"/> into a render-ready display, resolving copy via <paramref name="localizer"/>.</summary>
    /// <param name="model">The render-time data model (the web props, with the on / off state already resolved).</param>
    /// <param name="localizer">The i18n facade the label, the ON / OFF word and the favorite-toggle label resolve through.</param>
    public static ToggleCommandTileDisplay Project(ToggleCommandTileModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool isOn = model.IsOn;

        // Web icon swap: `isOn ? def.icon : (def.iconOff ?? def.icon)`, with a defensive fallback when blank.
        string onGlyph = string.IsNullOrEmpty(model.IconOnGlyph)
            ? ToggleCommandTileRegistration.DefaultCommandGlyph
            : model.IconOnGlyph;
        string offGlyph = string.IsNullOrEmpty(model.IconOffGlyph) ? onGlyph : model.IconOffGlyph!;
        string iconGlyph = isOn ? onGlyph : offGlyph;

        string accentKey = AccentKey(model.Variant);

        string label = localizer.GetString(model.LabelKey ?? string.Empty, model.LabelFallback ?? string.Empty);

        // Web: `isOn ? t('commands.on', 'ON') : t('commands.off', 'OFF')`.
        string toggleStateText = isOn
            ? localizer.GetString(ToggleCommandTileRegistration.OnKey, ToggleCommandTileRegistration.OnFallback)
            : localizer.GetString(ToggleCommandTileRegistration.OffKey, ToggleCommandTileRegistration.OffFallback);

        string statusText = model.LastStatus ?? string.Empty;
        bool hasStatus = !string.IsNullOrWhiteSpace(statusText);
        ToggleCommandStatusTone statusTone = ToneFor(model.LastStatus);
        string statusAccentKey = hasStatus ? StatusAccentKey(statusTone) : string.Empty;

        ToggleCommandTileState state = model.Loading ? ToggleCommandTileState.Loading : ToggleCommandTileState.Ready;

        string favoriteToggleLabel = localizer.GetString(
            ToggleCommandTileRegistration.FavoriteToggleKey,
            ToggleCommandTileRegistration.FavoriteToggleFallback);

        return new ToggleCommandTileDisplay(
            State: state,
            IsLoading: model.Loading,
            IsOn: isOn,
            IconGlyph: iconGlyph,
            Variant: model.Variant,
            AccentKey: accentKey,
            IconForegroundKey: isOn ? accentKey : ToggleCommandTileRegistration.OffForegroundKey,
            DotBrushKey: isOn ? accentKey : ToggleCommandTileRegistration.OffSurfaceKey,
            Label: label,
            ToggleStateText: toggleStateText,
            ToggleStateAccentKey: isOn ? accentKey : ToggleCommandTileRegistration.OffForegroundKey,
            HasStatus: hasStatus,
            StatusText: statusText,
            StatusTone: statusTone,
            StatusAccentKey: statusAccentKey,
            IsFavorite: model.IsFavorite,
            FavoriteGlyph: model.IsFavorite
                ? ToggleCommandTileRegistration.FavoriteFilledGlyph
                : ToggleCommandTileRegistration.FavoriteOutlineGlyph,
            FavoriteAccentKey: model.IsFavorite
                ? ToggleCommandTileRegistration.FavoriteActiveAccentKey
                : ToggleCommandTileRegistration.FavoriteInactiveAccentKey,
            FavoriteToggleLabel: favoriteToggleLabel,
            AutomationName: BuildAutomationName(label, toggleStateText, hasStatus, statusText));
    }

    /// <summary>
    /// Classify a last-command status caption into its tone — the web rule
    /// <c>lastStatus.startsWith('✓') ? success : failure</c>, with a blank / absent status showing no caption.
    /// </summary>
    public static ToggleCommandStatusTone ToneFor(string? status)
    {
        if (string.IsNullOrWhiteSpace(status))
        {
            return ToggleCommandStatusTone.None;
        }

        return status.StartsWith(SuccessPrefix, StringComparison.Ordinal)
            ? ToggleCommandStatusTone.Success
            : ToggleCommandStatusTone.Error;
    }

    /// <summary>The token brush key a status <paramref name="tone"/> tints with (success → green, error → red).</summary>
    public static string StatusAccentKey(ToggleCommandStatusTone tone) => tone switch
    {
        ToggleCommandStatusTone.Success => "TsColorSuccessBrush",
        ToggleCommandStatusTone.Error => "TsColorDangerBrush",
        _ => string.Empty,
    };

    /// <summary>
    /// The accent token brush key a <paramref name="variant"/> tints its on-state with — the web
    /// <c>onStyles</c>: default → cyan accent, danger → red, success → green.
    /// </summary>
    public static string AccentKey(ToggleCommandVariant variant) => variant switch
    {
        ToggleCommandVariant.Danger => "TsColorDangerBrush",
        ToggleCommandVariant.Success => "TsColorSuccessBrush",
        _ => "TsColorAccentBrush",
    };

    /// <summary>
    /// Canonicalise a web variant string (<c>'default'</c> / <c>'danger'</c> / <c>'success'</c>) to a
    /// <see cref="ToggleCommandVariant"/>, falling back to <see cref="ToggleCommandVariant.Default"/> for an
    /// unknown, empty or null value (the web <c>def.variant ?? 'default'</c>). Case- and
    /// surrounding-whitespace-insensitive.
    /// </summary>
    public static ToggleCommandVariant ResolveVariant(string? variant)
    {
        string trimmed = (variant ?? string.Empty).Trim();
        if (string.Equals(trimmed, "danger", StringComparison.OrdinalIgnoreCase))
        {
            return ToggleCommandVariant.Danger;
        }

        if (string.Equals(trimmed, "success", StringComparison.OrdinalIgnoreCase))
        {
            return ToggleCommandVariant.Success;
        }

        return ToggleCommandVariant.Default;
    }

    private static string BuildAutomationName(string label, string toggleStateText, bool hasStatus, string statusText)
    {
        // Reading order matches the tile's visual order: label, ON / OFF state, last-command status. Only present
        // parts are spoken so the Narrator name never carries a dangling separator; the ON / OFF word is always
        // present so the toggle state is announced.
        var parts = new List<string>(3);
        if (!string.IsNullOrWhiteSpace(label))
        {
            parts.Add(label);
        }

        if (!string.IsNullOrWhiteSpace(toggleStateText))
        {
            parts.Add(toggleStateText);
        }

        if (hasStatus)
        {
            parts.Add(statusText);
        }

        return string.Join(". ", parts);
    }
}

/// <summary>
/// Canonical metadata for the <c>ToggleCommandTile</c> feature surface — the native mirror of the web component
/// at web/src/features/system/components/ToggleCommandTile.tsx. Holds the diagnostics slug, the static i18n keys
/// the tile owns (the favorite-toggle accessible label and the ON / OFF captions, each with the same English
/// fallback the matching web <c>t(...)</c> call carries), the Segoe Fluent star glyphs that stand in for the web
/// Lucide <c>Star</c> (filled when favorite, outline otherwise), the favorite accent token keys, the off-state
/// token keys (muted foreground + surface for the dimmed dot / icon badge) and the generic fallback command
/// glyph. UI-free so the metadata is asserted in tests.
/// </summary>
public static class ToggleCommandTileRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ToggleCommandTile";

    /// <summary>The i18n key for the favorite-toggle accessible label (web <c>t('commands.toggleFavorite', ...)</c>).</summary>
    public const string FavoriteToggleKey = "commands.toggleFavorite";

    /// <summary>The English fallback the web <c>t(...)</c> call carries for <see cref="FavoriteToggleKey"/>.</summary>
    public const string FavoriteToggleFallback = "Toggle favorite";

    /// <summary>The i18n key for the on caption (web <c>t('commands.on', 'ON')</c>).</summary>
    public const string OnKey = "commands.on";

    /// <summary>The English fallback the web <c>t(...)</c> call carries for <see cref="OnKey"/>.</summary>
    public const string OnFallback = "ON";

    /// <summary>The i18n key for the off caption (web <c>t('commands.off', 'OFF')</c>).</summary>
    public const string OffKey = "commands.off";

    /// <summary>The English fallback the web <c>t(...)</c> call carries for <see cref="OffKey"/>.</summary>
    public const string OffFallback = "OFF";

    /// <summary>Segoe Fluent "FavoriteStarFill" glyph — the favorite star when pinned (web <c>Star</c> with <c>fill-current</c>).</summary>
    public const string FavoriteFilledGlyph = "\uE735";

    /// <summary>Segoe Fluent "FavoriteStar" glyph — the favorite star when not pinned (web outline <c>Star</c>).</summary>
    public const string FavoriteOutlineGlyph = "\uE734";

    /// <summary>The token brush key for a pinned favorite star (web <c>text-amber-300</c>).</summary>
    public const string FavoriteActiveAccentKey = "TsColorWarningBrush";

    /// <summary>The token brush key for an unpinned favorite star (web muted <c>--text-muted</c>).</summary>
    public const string FavoriteInactiveAccentKey = "TsColorTextMutedBrush";

    /// <summary>The token brush key for the off-state foreground (web <c>--text-muted</c> on the off icon + OFF caption).</summary>
    public const string OffForegroundKey = "TsColorTextMutedBrush";

    /// <summary>The token brush key for the off-state surface (web <c>--surface-2</c> on the dimmed dot + icon badge).</summary>
    public const string OffSurfaceKey = "TsColorSurfaceGlassBrush";

    /// <summary>
    /// Segoe Fluent "Setting" glyph used as a generic command icon when the host supplies none. The web
    /// <c>def.icon</c> is always present, so this is a defensive fallback that keeps the icon slot from ever
    /// being blank.
    /// </summary>
    public const string DefaultCommandGlyph = "\uE713";
}

/// <summary>
/// The payload of the <c>ToggleCommandTile</c>'s <see cref="ToggleCommandTile.CommandExecuted"/> event — the
/// native analogue of the web <c>onExecute(command, params?)</c> call
/// (web/src/features/system/components/ToggleCommandTile.tsx). Carries the dispatched command id and, for the
/// turn-on dispatch, the optional parameters the web forwards as <c>def.params</c> (the turn-off dispatch
/// carries no parameters, matching the web <c>onExecute(def.commandOff!)</c>).
/// </summary>
public sealed class ToggleCommandExecutedEventArgs : EventArgs
{
    /// <summary>Creates the payload for a dispatched command.</summary>
    /// <param name="command">The dispatched command id (web <c>def.command</c> / <c>def.commandOff</c>).</param>
    /// <param name="parameters">Optional parameters the command is dispatched with (web <c>def.params</c>), or null.</param>
    public ToggleCommandExecutedEventArgs(string command, IReadOnlyDictionary<string, object?>? parameters)
    {
        Command = command;
        Parameters = parameters;
    }

    /// <summary>The dispatched command id.</summary>
    public string Command { get; }

    /// <summary>The optional parameters the command is dispatched with (web <c>def.params</c>), or null.</summary>
    public IReadOnlyDictionary<string, object?>? Parameters { get; }
}

/// <summary>
/// PII-safe diagnostics for the <c>ToggleCommandTile</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event and the data-free <c>command.executed</c> / <c>dialog.requested</c> /
/// <c>favorite.toggled</c> activations with the surface slug — never the command id, label or status — so a
/// diagnostics line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class ToggleCommandTileDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _commandsExecuted;
    private long _dialogsRequested;
    private long _favoritesToggled;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or null.</param>
    public ToggleCommandTileDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the tile dispatched a command (web <c>onExecute</c>).</summary>
    public long CommandsExecuted => Interlocked.Read(ref _commandsExecuted);

    /// <summary>Number of times the tile requested its input dialog (web <c>onRequestDialog</c>).</summary>
    public long DialogsRequested => Interlocked.Read(ref _dialogsRequested);

    /// <summary>Number of times the favorite toggle was activated (web <c>onToggleFavorite</c>).</summary>
    public long FavoritesToggled => Interlocked.Read(ref _favoritesToggled);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ToggleCommandTile</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ToggleCommandTileRegistration.Slug}");
    }

    /// <summary>Record that a command was dispatched, emitting <c>command.executed slug=ToggleCommandTile</c>.</summary>
    public void RecordCommandExecuted()
    {
        Interlocked.Increment(ref _commandsExecuted);
        _sink?.Invoke($"command.executed slug={ToggleCommandTileRegistration.Slug}");
    }

    /// <summary>Record that the input dialog was requested, emitting <c>dialog.requested slug=ToggleCommandTile</c>.</summary>
    public void RecordDialogRequested()
    {
        Interlocked.Increment(ref _dialogsRequested);
        _sink?.Invoke($"dialog.requested slug={ToggleCommandTileRegistration.Slug}");
    }

    /// <summary>Record that the favorite toggle was activated, emitting <c>favorite.toggled slug=ToggleCommandTile</c>.</summary>
    public void RecordFavoriteToggled()
    {
        Interlocked.Increment(ref _favoritesToggled);
        _sink?.Invoke($"favorite.toggled slug={ToggleCommandTileRegistration.Slug}");
    }
}
