using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Commands;

/// <summary>
/// The semantic emphasis of a command tile — the native analogue of the web
/// <c>CommandDef.variant</c> (<c>'default' | 'danger' | 'success'</c> in
/// web/src/features/system/commands.ts). The web component uses it only to tint the tile's
/// hover border (<c>hoverStyles</c>); the native port maps it to the accent brush the surface
/// raises on pointer-over / keyboard focus.
/// </summary>
public enum CommandTileVariant
{
    /// <summary>The neutral tile (web <c>default</c> → <c>hover:border-neon-cyan/30</c>).</summary>
    Default,

    /// <summary>A destructive command (web <c>danger</c> → <c>hover:border-neon-red/30</c>).</summary>
    Danger,

    /// <summary>A confirming command (web <c>success</c> → <c>hover:border-neon-green/30</c>).</summary>
    Success,
}

/// <summary>
/// What activating the tile should do — the native analogue of the web <c>handleClick</c> branch in
/// web/src/features/system/components/CommandTile.tsx (<c>if (loading) return; if (def.dangerous)
/// onRequestDialog(def); else onExecute(def.command, def.params)</c>).
/// </summary>
public enum CommandTileActivation
{
    /// <summary>The tile is loading; the click is a no-op (web <c>if (loading) return</c>).</summary>
    None,

    /// <summary>Execute the command directly (web <c>onExecute(def.command, def.params)</c>).</summary>
    Execute,

    /// <summary>Open the confirm/input/select dialog first (web <c>onRequestDialog(def)</c>).</summary>
    Dialog,
}

/// <summary>
/// The render-time data model the <c>CommandTile</c> view binds to — the native analogue of the web
/// <c>CommandTileProps</c> in web/src/features/system/components/CommandTile.tsx. It carries the slice of
/// <c>CommandDef</c> the tile renders (command id, label / sublabel i18n keys + fallbacks, icon glyph,
/// variant, dangerous flag and the execute params) plus the three parent-owned tile states the web passes
/// as props: <see cref="Loading"/>, <see cref="LastStatus"/> and <see cref="IsFavorite"/>. The parent
/// command-center surface owns every query (latest-command status, the favorites set, the in-flight
/// mutation) and re-renders the tile with already-resolved props, exactly as the React parent does — so
/// there is no fetch-driven empty / error / stale / offline branch in the tile itself (those belong to the
/// parent), only the <see cref="Loading"/> state and the favorite / dangerous / last-status content
/// variations the web source actually renders. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Command">The Tesla command id (web <c>def.command</c>); forwarded on execute and used as the Narrator fallback.</param>
/// <param name="LabelKey">The i18n key for the tile label (web <c>def.labelKey</c>).</param>
/// <param name="LabelFallback">The English fallback for <paramref name="LabelKey"/> (web <c>def.labelFallback</c>).</param>
/// <param name="SublabelKey">The optional i18n key for the sublabel (web <c>def.sublabelKey</c>).</param>
/// <param name="SublabelFallback">The optional English fallback for the sublabel (web <c>def.sublabelFallback</c>); when null/empty no sublabel renders.</param>
/// <param name="IconGlyph">The Segoe Fluent glyph standing in for the web Lucide <c>def.icon</c>.</param>
/// <param name="Variant">The hover-accent variant (web <c>def.variant ?? 'default'</c>).</param>
/// <param name="Dangerous">Whether the command is destructive and routes through a dialog (web <c>def.dangerous</c>).</param>
/// <param name="Loading">Whether a command mutation is in flight (web <c>loading</c> prop).</param>
/// <param name="LastStatus">The last command result caption, e.g. "✓ 5m ago" / "✗ 5m ago" (web <c>lastStatus</c> prop); null/empty hides it.</param>
/// <param name="IsFavorite">Whether the command is pinned to favorites (web <c>isFavorite</c> prop).</param>
/// <param name="Params">The execute params forwarded with the command (web <c>def.params</c>); may be null.</param>
public sealed record CommandTileModel(
    string Command,
    string LabelKey,
    string LabelFallback,
    string? SublabelKey,
    string? SublabelFallback,
    string IconGlyph,
    CommandTileVariant Variant,
    bool Dangerous,
    bool Loading,
    string? LastStatus,
    bool IsFavorite,
    IReadOnlyDictionary<string, object?>? Params = null)
{
    /// <summary>The initial model — an empty, idle, non-favorite tile with the fallback action glyph.</summary>
    public static CommandTileModel Empty { get; } = new(
        Command: string.Empty,
        LabelKey: string.Empty,
        LabelFallback: string.Empty,
        SublabelKey: null,
        SublabelFallback: null,
        IconGlyph: CommandTileRegistration.DefaultIconGlyph,
        Variant: CommandTileVariant.Default,
        Dangerous: false,
        Loading: false,
        LastStatus: null,
        IsFavorite: false);
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="CommandTileModel"/> — the native analogue of
/// everything web/src/features/system/components/CommandTile.tsx derives before returning JSX: the resolved
/// <see cref="Label"/> / <see cref="Sublabel"/>, whether a sublabel and a last-status caption render, the
/// last-status success/failure brush (web <c>lastStatus.startsWith('✓')</c>), the variant hover-accent
/// brush key (web <c>hoverStyles[variant]</c>), the favorite star glyph + brush (web filled amber star vs
/// the muted outline), the localized "Toggle favorite" Narrator label, whether the dangerous mark shows,
/// whether the busy spinner replaces the icon, the resulting <see cref="Activation"/> and the composed
/// Narrator name. Pure data so every value is asserted headlessly.
/// </summary>
public sealed record CommandTileDisplay(
    string Label,
    string Sublabel,
    bool ShowSublabel,
    string LastStatus,
    bool ShowLastStatus,
    bool LastStatusSuccess,
    string LastStatusBrushKey,
    string IconGlyph,
    bool ShowSpinner,
    CommandTileVariant Variant,
    string VariantAccentBrushKey,
    bool ShowDanger,
    bool IsFavorite,
    string FavoriteGlyph,
    string FavoriteBrushKey,
    string FavoriteToggleLabel,
    CommandTileActivation Activation,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="CommandTileModel"/> to its <see cref="CommandTileDisplay"/> — the
/// native port of the derivations in web/src/features/system/components/CommandTile.tsx. Reproduces the web
/// logic exactly: the label is <c>t(def.labelKey, def.labelFallback)</c> and the sublabel is
/// <c>t(def.sublabelKey ?? '', def.sublabelFallback)</c> (rendered only when a sublabel fallback exists);
/// the last-status caption is shown only when non-empty and is coloured green when it
/// <c>startsWith('✓')</c> else red; the variant selects the hover-border accent
/// (<c>default→cyan / danger→red / success→green</c>); the favorite control is the filled amber star when
/// pinned else the muted outline; the dangerous mark shows when <c>def.dangerous</c>; the icon is replaced
/// by a spinner while <c>loading</c>; and activation is <c>loading ? none : dangerous ? dialog : execute</c>.
/// Every string flows through the <see cref="ILocalizer"/> facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class CommandTileProjection
{
    /// <summary>The success marker the web last-status caption starts with (web <c>'✓'</c>, U+2713).</summary>
    public const string SuccessMarker = "\u2713";

    /// <summary>Token brush key for a successful last-status caption (web <c>text-neon-green/60</c>).</summary>
    public const string SuccessBrushKey = "TsColorSuccessBrush";

    /// <summary>Token brush key for a failed last-status caption (web <c>text-neon-red/60</c>).</summary>
    public const string DangerBrushKey = "TsColorDangerBrush";

    /// <summary>Token brush key for the muted, not-favorite star (web <c>text-[var(--text-muted)]</c>).</summary>
    public const string MutedBrushKey = "TsColorTextMutedBrush";

    /// <summary>Token brush key for the pinned, amber favorite star (web <c>text-amber-300</c>).</summary>
    public const string FavoriteBrushKey = "TsColorWarningBrush";

    /// <summary>Token brush key for the default-variant hover accent (web <c>hover:border-neon-cyan/30</c>).</summary>
    public const string DefaultAccentBrushKey = "TsChartSpeedBrush";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static CommandTileDisplay Project(CommandTileModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string label = localizer.GetString(model.LabelKey ?? string.Empty, model.LabelFallback ?? string.Empty);

        bool showSublabel = !string.IsNullOrEmpty(model.SublabelFallback);
        string sublabel = showSublabel
            ? localizer.GetString(model.SublabelKey ?? string.Empty, model.SublabelFallback!)
            : string.Empty;

        string lastStatus = model.LastStatus ?? string.Empty;
        bool showLastStatus = !string.IsNullOrEmpty(lastStatus);
        bool lastStatusSuccess = showLastStatus && lastStatus.StartsWith(SuccessMarker, StringComparison.Ordinal);

        string favoriteLabel = localizer.GetString(
            CommandTileRegistration.FavoriteToggleKey, CommandTileRegistration.FavoriteToggleFallback);

        string iconGlyph = string.IsNullOrEmpty(model.IconGlyph)
            ? CommandTileRegistration.DefaultIconGlyph
            : model.IconGlyph;

        return new CommandTileDisplay(
            Label: label,
            Sublabel: sublabel,
            ShowSublabel: showSublabel,
            LastStatus: lastStatus,
            ShowLastStatus: showLastStatus,
            LastStatusSuccess: lastStatusSuccess,
            LastStatusBrushKey: lastStatusSuccess ? SuccessBrushKey : DangerBrushKey,
            IconGlyph: iconGlyph,
            ShowSpinner: model.Loading,
            Variant: model.Variant,
            VariantAccentBrushKey: VariantAccentKey(model.Variant),
            ShowDanger: model.Dangerous,
            IsFavorite: model.IsFavorite,
            FavoriteGlyph: model.IsFavorite
                ? CommandTileRegistration.FavoriteStarFilledGlyph
                : CommandTileRegistration.FavoriteStarGlyph,
            FavoriteBrushKey: model.IsFavorite ? FavoriteBrushKey : MutedBrushKey,
            FavoriteToggleLabel: favoriteLabel,
            Activation: ActivationOf(model),
            AutomationName: AutomationNameOf(label, model.Command));
    }

    /// <summary>
    /// Select the hover-border accent token for <paramref name="variant"/>, mirroring the web
    /// <c>hoverStyles</c> map (<c>default→neon-cyan / danger→neon-red / success→neon-green</c>).
    /// </summary>
    public static string VariantAccentKey(CommandTileVariant variant) => variant switch
    {
        CommandTileVariant.Danger => DangerBrushKey,
        CommandTileVariant.Success => SuccessBrushKey,
        _ => DefaultAccentBrushKey,
    };

    /// <summary>
    /// The activation a click resolves to, mirroring the web <c>handleClick</c>: a loading tile is a
    /// no-op, a dangerous command opens the dialog, otherwise the command executes.
    /// </summary>
    public static CommandTileActivation ActivationOf(CommandTileModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (model.Loading)
        {
            return CommandTileActivation.None;
        }

        return model.Dangerous ? CommandTileActivation.Dialog : CommandTileActivation.Execute;
    }

    private static string AutomationNameOf(string label, string command) =>
        !string.IsNullOrEmpty(label) ? label : command ?? string.Empty;
}

/// <summary>
/// PII-safe diagnostics for the <c>CommandTile</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the command id, label or last-status
/// caption — so a diagnostics line can never leak which commands a user sends. Thread-safe.
/// </summary>
public sealed class CommandTileDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CommandTileDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CommandTile</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CommandTileRegistration.Slug}");
    }
}

/// <summary>
/// Event payload for the <c>CommandTile</c> execute / dialog requests — the native analogue of the web
/// <c>onExecute(def.command, def.params)</c> / <c>onRequestDialog(def)</c> callbacks. Carries the command
/// id and (for execute) the forwarded params so the host can act without re-deriving them. WinUI-free.
/// </summary>
public sealed class CommandTileCommandEventArgs : EventArgs
{
    /// <summary>Creates the payload over the command id and optional execute params.</summary>
    public CommandTileCommandEventArgs(string command, IReadOnlyDictionary<string, object?>? @params = null)
    {
        Command = command ?? string.Empty;
        Params = @params;
    }

    /// <summary>The Tesla command id (web <c>def.command</c>).</summary>
    public string Command { get; }

    /// <summary>The forwarded execute params (web <c>def.params</c>); null when none.</summary>
    public IReadOnlyDictionary<string, object?>? Params { get; }
}

/// <summary>
/// Canonical metadata for the <c>CommandTile</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/system/components/CommandTile.tsx</c>: the stable diagnostics slug, the Segoe Fluent
/// glyphs that stand in for the web Lucide icons (the favorite <c>Star</c> outline / fill and the
/// <c>AlertTriangle</c> dangerous mark), a neutral fallback action glyph for the per-command icon, and the
/// one i18n key the source resolves (<c>commands.toggleFavorite</c>). UI-free so the metadata is asserted in tests.
/// </summary>
public static class CommandTileRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "CommandTile";

    /// <summary>Segoe Fluent "FavoriteStar" glyph — the web Lucide <c>Star</c> outline (not favorited).</summary>
    public const string FavoriteStarGlyph = "\uE734";

    /// <summary>Segoe Fluent "FavoriteStarFill" glyph — the web Lucide <c>Star</c> with <c>fill-current</c> (favorited).</summary>
    public const string FavoriteStarFilledGlyph = "\uE735";

    /// <summary>Segoe Fluent "Warning" glyph — the web Lucide <c>AlertTriangle</c> dangerous mark.</summary>
    public const string DangerGlyph = "\uE7BA";

    /// <summary>Neutral Segoe Fluent "Lightning" fallback for the per-command icon when none is supplied (the web always passes <c>def.icon</c>).</summary>
    public const string DefaultIconGlyph = "\uE945";

    /// <summary>i18n key for the favorite toggle's Narrator label (web <c>t('commands.toggleFavorite', …)</c>).</summary>
    public const string FavoriteToggleKey = "commands.toggleFavorite";

    /// <summary>English fallback for <see cref="FavoriteToggleKey"/> (web <c>'Toggle favorite'</c>).</summary>
    public const string FavoriteToggleFallback = "Toggle favorite";
}
