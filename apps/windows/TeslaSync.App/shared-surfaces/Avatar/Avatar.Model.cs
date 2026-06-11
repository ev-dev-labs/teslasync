using System.Globalization;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the Avatar surface — the native mirror of the module-level constants
/// and default <c>t()</c> calls in <c>web/src/components/data-display/Avatar.tsx</c>. The web component is a
/// presentational identity primitive: it renders one of three visuals in priority order — an image
/// (falling back to initials on load error), deterministic 2-letter initials on a colour-blind-safe colour
/// hashed from the user id/name, or a generic glyph (a person for <c>kind="user"</c>, the Helix brand mark
/// for <c>kind="bot"</c>) — with an optional presence dot and an optional tooltip. This metadata carries the
/// diagnostics slug, the automation ids mirroring the web <c>data-testid</c>s, and every render-contract
/// i18n key/fallback the source passes to <c>t()</c>, so the native surface reproduces the web copy verbatim.
/// Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects and resolves
/// against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class AvatarRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Avatar";

    /// <summary>Root automation id — the native analogue of the web <c>data-testid="avatar"</c>.</summary>
    public const string RootAutomationId = "avatar";

    /// <summary>Automation id for the image child (web <c>data-testid="avatar-image"</c>).</summary>
    public const string ImageAutomationId = "avatar-image";

    /// <summary>Automation id for the initials child (web <c>data-testid="avatar-initials"</c>).</summary>
    public const string InitialsAutomationId = "avatar-initials";

    /// <summary>Automation id for the generic-glyph child (web <c>data-testid="avatar-glyph"</c>).</summary>
    public const string GlyphAutomationId = "avatar-glyph";

    /// <summary>Automation id for the presence dot (web <c>data-testid="avatar-status"</c>).</summary>
    public const string StatusAutomationId = "avatar-status";

    /// <summary>i18n key for the unknown-user label / image alt fallback (web <c>avatar.unknown</c>).</summary>
    public const string UnknownKey = "translation.avatar.unknown";

    /// <summary>English fallback for <see cref="UnknownKey"/> (web second arg, verbatim).</summary>
    public const string UnknownFallback = "Unknown user";

    /// <summary>i18n key for the online presence label (web <c>avatar.statusOnline</c>).</summary>
    public const string StatusOnlineKey = "translation.avatar.statusOnline";

    /// <summary>English fallback for <see cref="StatusOnlineKey"/> (web second arg, verbatim).</summary>
    public const string StatusOnlineFallback = "Online";

    /// <summary>i18n key for the idle presence label (web <c>avatar.statusIdle</c>).</summary>
    public const string StatusIdleKey = "translation.avatar.statusIdle";

    /// <summary>English fallback for <see cref="StatusIdleKey"/> (web second arg, verbatim).</summary>
    public const string StatusIdleFallback = "Idle";

    /// <summary>i18n key for the offline presence label (web <c>avatar.statusOffline</c>).</summary>
    public const string StatusOfflineKey = "translation.avatar.statusOffline";

    /// <summary>English fallback for <see cref="StatusOfflineKey"/> (web second arg, verbatim).</summary>
    public const string StatusOfflineFallback = "Offline";
}

/// <summary>
/// Avatar size token — the native port of the web <c>AvatarSize</c> union (<c>'xs' | 'sm' | 'md' | 'lg'</c>),
/// in pixels 16 / 24 / 32 / 48. The default is <see cref="Sm"/> (the comfortable DataTable size).
/// </summary>
public enum AvatarSize
{
    /// <summary>web <c>'xs'</c> — 16px.</summary>
    Xs,

    /// <summary>web <c>'sm'</c> — 24px (default).</summary>
    Sm,

    /// <summary>web <c>'md'</c> — 32px.</summary>
    Md,

    /// <summary>web <c>'lg'</c> — 48px.</summary>
    Lg,
}

/// <summary>
/// Avatar shape token — the native port of the web <c>AvatarShape</c> union
/// (<c>'circle' | 'rounded'</c>). <see cref="Circle"/> is the default; <see cref="Rounded"/> matches the web
/// Tailwind <c>rounded-lg</c> (8px corner).
/// </summary>
public enum AvatarShape
{
    /// <summary>web <c>'circle'</c> — fully rounded (default).</summary>
    Circle,

    /// <summary>web <c>'rounded'</c> — 8px corner radius (Tailwind <c>rounded-lg</c>).</summary>
    Rounded,
}

/// <summary>
/// Presence-dot state — the native port of the web <c>AvatarStatus</c> union
/// (<c>'online' | 'idle' | 'offline'</c>). Carried as a nullable on <see cref="AvatarProps"/> so "no dot" is
/// the absence of a value (web optional <c>status</c> prop).
/// </summary>
public enum AvatarStatus
{
    /// <summary>web <c>'online'</c> — green dot.</summary>
    Online,

    /// <summary>web <c>'idle'</c> — amber dot.</summary>
    Idle,

    /// <summary>web <c>'offline'</c> — grey dot.</summary>
    Offline,
}

/// <summary>
/// No-name fallback selector — the native port of the web <c>AvatarKind</c> union
/// (<c>'user' | 'bot'</c>). Picks which generic glyph renders when neither an image nor name initials are
/// available: a person for <see cref="User"/>, the Helix brand mark for <see cref="Bot"/> (the chatbot slot).
/// </summary>
public enum AvatarKind
{
    /// <summary>web <c>'user'</c> — the generic person glyph (default).</summary>
    User,

    /// <summary>web <c>'bot'</c> — the Helix brand mark (assistant / system avatar).</summary>
    Bot,
}

/// <summary>
/// Which of the three avatar visuals renders — the native projection of the web priority chain
/// (<c>src</c> image → name initials → generic glyph). Exposed so the view and tests agree on the rendered
/// branch without a XAML host.
/// </summary>
public enum AvatarContentMode
{
    /// <summary>An image is shown (web <c>showImage</c>: a non-empty <c>src</c> that has not failed to load).</summary>
    Image,

    /// <summary>Deterministic 2-letter initials are shown (web <c>hasNameInitials</c>).</summary>
    Initials,

    /// <summary>A generic glyph is shown (web fallback: neither image nor name initials).</summary>
    Glyph,
}

/// <summary>
/// Which generic glyph the <see cref="AvatarContentMode.Glyph"/> branch renders — the native port of the web
/// <c>GenericIcon = kind === 'bot' ? HelixMark : User</c> decision.
/// </summary>
public enum AvatarGlyphKind
{
    /// <summary>The generic person glyph (web <c>User</c> from lucide-react).</summary>
    Person,

    /// <summary>The Helix brand mark (web <c>HelixMark</c>).</summary>
    Helix,
}

/// <summary>
/// How the avatar chip is filled behind its content — the native projection of the web background decision:
/// an image covers the chip (no fill), an attributed avatar (has a name or user id) gets the deterministic
/// hashed palette colour, and a truly-anonymous avatar gets a neutral surface so it does not suggest a user
/// identity (web <c>fallbackBg = isAttributed ? backgroundColor : undefined</c> / <c>bg-[var(--surface-2)]</c>).
/// </summary>
public enum AvatarBackgroundKind
{
    /// <summary>No fill — an image covers the chip (web image branch).</summary>
    Image,

    /// <summary>The deterministic hashed palette colour (web attributed fallback background).</summary>
    Color,

    /// <summary>A neutral surface (web anonymous <c>--surface-2</c> background).</summary>
    Neutral,
}

/// <summary>
/// The render inputs for an avatar — the native port of the web <c>AvatarProps</c> interface
/// (web/src/components/data-display/Avatar.tsx). Defaults mirror the web defaults exactly: <c>size='sm'</c>,
/// <c>shape='circle'</c>, <c>kind='user'</c>, <c>showTooltip=false</c> and no presence dot. A record so two
/// equal prop sets project identically.
/// </summary>
/// <param name="UserId">
/// Stable user identifier — the deterministic palette seed (web <c>userId</c>). When empty, <see cref="Name"/>
/// falls through as the hash seed so the same name renders the same colour across mounts.
/// </param>
/// <param name="Name">
/// Display name — the first two word-initials are the visible fallback (web <c>name</c>; "John Doe" → "JD").
/// </param>
/// <param name="Src">Optional image URL; renders an image that falls back to initials/glyph on load error (web <c>src</c>).</param>
/// <param name="Size">Size token (web <c>size</c>); defaults to <see cref="AvatarSize.Sm"/>.</param>
/// <param name="Shape">Shape token (web <c>shape</c>); defaults to <see cref="AvatarShape.Circle"/>.</param>
/// <param name="Status">Optional presence dot (web <c>status</c>); null renders no dot.</param>
/// <param name="ShowTooltip">When true, the avatar carries a tooltip of the name / unknown-user label (web <c>showTooltip</c>).</param>
/// <param name="Kind">No-name fallback selector (web <c>kind</c>); defaults to <see cref="AvatarKind.User"/>.</param>
public sealed record AvatarProps(
    string? UserId = null,
    string? Name = null,
    string? Src = null,
    AvatarSize Size = AvatarSize.Sm,
    AvatarShape Shape = AvatarShape.Circle,
    AvatarStatus? Status = null,
    bool ShowTooltip = false,
    AvatarKind Kind = AvatarKind.User);

/// <summary>
/// Pixel metrics for each size/shape token — the native port of the web <c>SIZE_PX</c>, the per-size text and
/// dot Tailwind sizes, and the <c>glyphSize = round(sizePx * 0.6)</c> rule. Pure and side-effect-free so the
/// view and tests share one source of truth for dimensions.
/// </summary>
public static class AvatarMetrics
{
    /// <summary>Corner radius (px) for the web <c>rounded-lg</c> shape (Tailwind 0.5rem).</summary>
    public const double RoundedCornerRadius = 8;

    /// <summary>The chip diameter in pixels (web <c>SIZE_PX</c>: xs=16, sm=24, md=32, lg=48).</summary>
    public static double SizePx(AvatarSize size) => size switch
    {
        AvatarSize.Xs => 16,
        AvatarSize.Sm => 24,
        AvatarSize.Md => 32,
        AvatarSize.Lg => 48,
        _ => 24,
    };

    /// <summary>The initials font size in pixels (web text classes: xs=8, sm=10, md=12, lg=14).</summary>
    public static double FontPx(AvatarSize size) => size switch
    {
        AvatarSize.Xs => 8,
        AvatarSize.Sm => 10,
        AvatarSize.Md => 12,
        AvatarSize.Lg => 14,
        _ => 10,
    };

    /// <summary>The presence-dot diameter in pixels (web h-1.5/h-2/h-2.5/h-3: xs=6, sm=8, md=10, lg=12).</summary>
    public static double DotPx(AvatarSize size) => size switch
    {
        AvatarSize.Xs => 6,
        AvatarSize.Sm => 8,
        AvatarSize.Md => 10,
        AvatarSize.Lg => 12,
        _ => 8,
    };

    /// <summary>The generic-glyph box in pixels — web <c>round(sizePx * 0.6)</c> (xs=10, sm=14, md=19, lg=29).</summary>
    public static double GlyphPx(AvatarSize size) =>
        Math.Round(SizePx(size) * 0.6, MidpointRounding.AwayFromZero);

    /// <summary>The chip corner radius in pixels — half the diameter for a circle, else the rounded token.</summary>
    public static double CornerRadiusPx(AvatarSize size, AvatarShape shape) =>
        shape == AvatarShape.Circle ? SizePx(size) / 2 : RoundedCornerRadius;
}

/// <summary>
/// The resolved render decisions for an avatar — the native port of the web component body
/// (web/src/components/data-display/Avatar.tsx): the content branch, the deterministic seed colour and
/// initials (from the shared <see cref="AvatarLogic"/>), the attributed-vs-anonymous background, the resolved
/// accessible name / tooltip, and the localized presence label + its semantic token. A
/// <see langword="readonly"/> <see langword="record"/> <see langword="struct"/> so a given input projects to a
/// stable, value-equal snapshot the tests assert per state. Side-effect-free; both the
/// <see cref="AvatarViewModel"/> and the WinUI view render from it.
/// </summary>
public readonly record struct AvatarProjection
{
    private AvatarProjection(
        AvatarContentMode contentMode,
        AvatarGlyphKind glyphKind,
        string initials,
        bool isAttributed,
        AvatarBackgroundKind backgroundKind,
        string seedColorHex,
        string accessibleName,
        string tooltipLabel,
        bool showTooltip,
        AvatarStatus? status,
        string statusLabel,
        string statusBrushKey,
        AvatarSize size,
        AvatarShape shape,
        double sizePx,
        double cornerRadiusPx,
        double fontPx,
        double glyphPx,
        double dotPx,
        string? imageSource)
    {
        ContentMode = contentMode;
        GlyphKind = glyphKind;
        Initials = initials;
        IsAttributed = isAttributed;
        BackgroundKind = backgroundKind;
        SeedColorHex = seedColorHex;
        AccessibleName = accessibleName;
        TooltipLabel = tooltipLabel;
        ShowTooltip = showTooltip;
        Status = status;
        StatusLabel = statusLabel;
        StatusBrushKey = statusBrushKey;
        Size = size;
        Shape = shape;
        SizePx = sizePx;
        CornerRadiusPx = cornerRadiusPx;
        FontPx = fontPx;
        GlyphPx = glyphPx;
        DotPx = dotPx;
        ImageSource = imageSource;
    }

    /// <summary>Which of the three visuals renders (image → initials → glyph).</summary>
    public AvatarContentMode ContentMode { get; }

    /// <summary>Which generic glyph renders when <see cref="ContentMode"/> is <see cref="AvatarContentMode.Glyph"/>.</summary>
    public AvatarGlyphKind GlyphKind { get; }

    /// <summary>The visible initials (web <c>avatarInitials(name)</c>); "?" when no name is available.</summary>
    public string Initials { get; }

    /// <summary>Whether the avatar attributes to a known identity — a name or user id was supplied (web <c>isAttributed</c>).</summary>
    public bool IsAttributed { get; }

    /// <summary>How the chip is filled (image / hashed colour / neutral surface).</summary>
    public AvatarBackgroundKind BackgroundKind { get; }

    /// <summary>The deterministic palette colour for the seed, as a "#RRGGBB" hex (web <c>backgroundColor</c>).</summary>
    public string SeedColorHex { get; }

    /// <summary>
    /// The avatar's accessible name — the display name when known, otherwise the localized "Unknown user"
    /// label (web image <c>alt</c> / tooltip content). Narrator announces this for the chip.
    /// </summary>
    public string AccessibleName { get; }

    /// <summary>The tooltip text (web <c>tooltipLabel</c>) — identical to <see cref="AccessibleName"/>.</summary>
    public string TooltipLabel { get; }

    /// <summary>Whether the avatar carries a tooltip (web <c>showTooltip</c>).</summary>
    public bool ShowTooltip { get; }

    /// <summary>The presence-dot state, or null when no dot is shown (web optional <c>status</c>).</summary>
    public AvatarStatus? Status { get; }

    /// <summary>True when a presence dot is shown.</summary>
    public bool HasStatus => Status.HasValue;

    /// <summary>The localized presence label (web dot <c>aria-label</c>); empty when no dot is shown.</summary>
    public string StatusLabel { get; }

    /// <summary>The semantic brush token key for the presence dot; empty when no dot is shown.</summary>
    public string StatusBrushKey { get; }

    /// <summary>The size token.</summary>
    public AvatarSize Size { get; }

    /// <summary>The shape token.</summary>
    public AvatarShape Shape { get; }

    /// <summary>The chip diameter in pixels.</summary>
    public double SizePx { get; }

    /// <summary>The chip corner radius in pixels.</summary>
    public double CornerRadiusPx { get; }

    /// <summary>The initials font size in pixels.</summary>
    public double FontPx { get; }

    /// <summary>The generic-glyph box in pixels.</summary>
    public double GlyphPx { get; }

    /// <summary>The presence-dot diameter in pixels.</summary>
    public double DotPx { get; }

    /// <summary>The raw image source string the view binds when <see cref="ContentMode"/> is image (web <c>src</c>).</summary>
    public string? ImageSource { get; }

    /// <summary>
    /// The semantic brush token key for a presence state — the native analogue of the web
    /// <c>STATUS_CLASSES</c> map (online → emerald, idle → amber, offline → grey), expressed as the same
    /// semantic tokens every other live indicator uses (success / warning / muted) so colour-meaning stays
    /// consistent across surfaces.
    /// </summary>
    public static string StatusBrushKeyFor(AvatarStatus status) => status switch
    {
        AvatarStatus.Online => "TsColorSuccessBrush",
        AvatarStatus.Idle => "TsColorWarningBrush",
        AvatarStatus.Offline => "TsColorTextMutedBrush",
        _ => "TsColorTextMutedBrush",
    };

    /// <summary>
    /// Project the render decisions from the props, the i18n facade and whether the image is currently
    /// loadable. Mirrors the web component body exactly: the seed is the user id when present else the trimmed
    /// name (else "?"); the content branch is image → initials → glyph; the background is image / hashed colour
    /// (attributed) / neutral (anonymous); the accessible name is the name or the localized unknown-user label;
    /// and the presence label resolves through the facade.
    /// </summary>
    /// <param name="props">The avatar render inputs.</param>
    /// <param name="localizer">The i18n facade the unknown-user and presence labels resolve through.</param>
    /// <param name="hasImage">
    /// Whether a usable image is available now (web <c>showImage = Boolean(src) &amp;&amp; !imageFailed</c>):
    /// a non-empty <c>src</c> that has not failed to load.
    /// </param>
    public static AvatarProjection Project(AvatarProps props, ILocalizer localizer, bool hasImage)
    {
        ArgumentNullException.ThrowIfNull(props);
        ArgumentNullException.ThrowIfNull(localizer);

        string trimmedName = props.Name?.Trim() ?? string.Empty;
        bool hasUserId = !string.IsNullOrEmpty(props.UserId);

        // web: seed = (userId && userId.length > 0 ? userId : trimmedName) || '?'.
        string seed = hasUserId
            ? props.UserId!
            : (trimmedName.Length > 0 ? trimmedName : "?");
        string seedColorHex = AvatarLogic.ColorFor(seed);

        string initials = AvatarLogic.Initials(props.Name);
        bool hasNameInitials = !string.Equals(initials, "?", StringComparison.Ordinal);

        // web: isAttributed = trimmedName.length > 0 || (userId != null && userId !== '').
        bool isAttributed = trimmedName.Length > 0 || hasUserId;

        AvatarContentMode contentMode = hasImage
            ? AvatarContentMode.Image
            : hasNameInitials
                ? AvatarContentMode.Initials
                : AvatarContentMode.Glyph;

        AvatarGlyphKind glyphKind = props.Kind == AvatarKind.Bot
            ? AvatarGlyphKind.Helix
            : AvatarGlyphKind.Person;

        AvatarBackgroundKind backgroundKind = hasImage
            ? AvatarBackgroundKind.Image
            : isAttributed
                ? AvatarBackgroundKind.Color
                : AvatarBackgroundKind.Neutral;

        // web: tooltipLabel = trimmedName.length > 0 ? trimmedName : t('avatar.unknown', 'Unknown user').
        string label = trimmedName.Length > 0
            ? trimmedName
            : localizer.GetString(AvatarRegistration.UnknownKey, AvatarRegistration.UnknownFallback);

        string statusLabel = props.Status is { } status
            ? StatusLabelFor(status, localizer)
            : string.Empty;
        string statusBrushKey = props.Status is { } s ? StatusBrushKeyFor(s) : string.Empty;

        return new AvatarProjection(
            contentMode,
            glyphKind,
            initials,
            isAttributed,
            backgroundKind,
            seedColorHex,
            accessibleName: label,
            tooltipLabel: label,
            props.ShowTooltip,
            props.Status,
            statusLabel,
            statusBrushKey,
            props.Size,
            props.Shape,
            AvatarMetrics.SizePx(props.Size),
            AvatarMetrics.CornerRadiusPx(props.Size, props.Shape),
            AvatarMetrics.FontPx(props.Size),
            AvatarMetrics.GlyphPx(props.Size),
            AvatarMetrics.DotPx(props.Size),
            imageSource: string.IsNullOrEmpty(props.Src) ? null : props.Src);
    }

    /// <summary>
    /// Resolve the localized presence label for a status (web dot <c>aria-label</c>: online → "Online",
    /// idle → "Idle", offline → "Offline"). Exposed so tests assert the label routing without a view.
    /// </summary>
    public static string StatusLabelFor(AvatarStatus status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return status switch
        {
            AvatarStatus.Online => localizer.GetString(
                AvatarRegistration.StatusOnlineKey, AvatarRegistration.StatusOnlineFallback),
            AvatarStatus.Idle => localizer.GetString(
                AvatarRegistration.StatusIdleKey, AvatarRegistration.StatusIdleFallback),
            AvatarStatus.Offline => localizer.GetString(
                AvatarRegistration.StatusOfflineKey, AvatarRegistration.StatusOfflineFallback),
            _ => localizer.GetString(
                AvatarRegistration.StatusOfflineKey, AvatarRegistration.StatusOfflineFallback),
        };
    }
}

/// <summary>
/// PII-safe diagnostics for the Avatar surface (P1/S11 diagnostics contract). An avatar carries user
/// identity (name, user id, image), so the collector records ONLY the operational <c>view.opened</c> signal
/// with the surface slug — never the name, id, image url or initials. Thread-safe; mirrors the shipped
/// surfaces' collectors.
/// </summary>
public sealed class AvatarDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AvatarDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Avatar</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"view.opened slug={AvatarRegistration.Slug}"));
    }
}
