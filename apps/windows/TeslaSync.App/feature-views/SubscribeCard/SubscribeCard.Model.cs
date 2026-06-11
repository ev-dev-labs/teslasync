using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The outbound navigation seam the <c>SubscribeCard</c> feature surface drives — the native analogue of the
/// web react-router <c>&lt;Link to="…"&gt;</c> wrapping each channel tile in
/// web/src/features/system/components/status/SubscribeCard.tsx. The view never touches the shell directly;
/// activating a tile calls <see cref="Navigate(string)"/> with the canonical native route name and the host
/// wires this to the in-app navigation (resolving the route name to its path and invoking the shell). A test
/// substitute records the requested route so the view's navigation behaviour is verified without a shell.
/// </summary>
public interface ISubscribeCardNavigator
{
    /// <summary>Navigate the shell to the destination identified by <paramref name="routeName"/>.</summary>
    /// <param name="routeName">The stable native route name (e.g. <c>NotificationsChannels</c>).</param>
    void Navigate(string routeName);
}

/// <summary>
/// The source of the surface's channel entries (P1/S8 state-holder seam). <c>SubscribeCard</c> is
/// presentational, so the entries are the fixed set the web component hard-codes (the five
/// <c>&lt;ChannelTile&gt;</c>s in web/src/features/system/components/status/SubscribeCard.tsx) rather than a
/// network read — but routing the list through a seam keeps the view free of literals and lets a test
/// substitute an empty or alternate catalog to exercise the empty branch.
/// </summary>
public interface ISubscribeCardChannelSource
{
    /// <summary>The ordered channel entries to project into tiles.</summary>
    IReadOnlyList<SubscribeCardChannel> GetChannels();
}

/// <summary>
/// The mutually-exclusive surface state for the <c>SubscribeCard</c> feature view. The web source
/// (web/src/features/system/components/status/SubscribeCard.tsx) is a pure presentational component with no
/// data source and no asynchronous reads, so it has a single content state — <see cref="Ready"/> — plus the
/// defensive <see cref="Empty"/> branch so a degenerate empty projection renders a friendly empty surface
/// rather than a blank box. There is deliberately no loading / error / stale / offline state because the web
/// source has none (those belong to data-backed surfaces).
/// </summary>
public enum SubscribeCardState
{
    /// <summary>The channel tiles are projected and ready to render (the web grid).</summary>
    Ready,

    /// <summary>No channels resolved — render a friendly empty surface (never a blank panel).</summary>
    Empty,
}

/// <summary>
/// One canonical channel entry — the native analogue of a web <c>&lt;ChannelTile&gt;</c> record
/// (<c>{ to, icon, label, description }</c> in web/src/features/system/components/status/SubscribeCard.tsx).
/// <see cref="Glyph"/> is the Segoe Fluent code point standing in for the web Lucide icon, and
/// <see cref="RouteName"/> is the stable native route identifier the tile navigates to (the native analogue of
/// the web <c>to</c> path — see <see cref="SubscribeCardRegistration"/> for the path-to-route mapping). The
/// label and description are carried as i18n key + English fallback so the projection resolves them through the
/// localizer (the web component renders fixed English literals; the native port routes them through i18n).
/// </summary>
/// <param name="RouteName">Stable native route name the tile opens (the native analogue of the web <c>to</c> path).</param>
/// <param name="Glyph">Segoe Fluent glyph (the web Lucide icon).</param>
/// <param name="LabelKey">i18n key for the channel label.</param>
/// <param name="LabelFallback">English fallback label (the web literal).</param>
/// <param name="DescriptionKey">i18n key for the channel description.</param>
/// <param name="DescriptionFallback">English fallback description (the web literal).</param>
public sealed record SubscribeCardChannel(
    string RouteName,
    string Glyph,
    string LabelKey,
    string LabelFallback,
    string DescriptionKey,
    string DescriptionFallback);

/// <summary>
/// One projected, render-ready channel tile consumed by the WinUI view (a web rendered <c>ChannelTile</c>).
/// <see cref="Label"/> and <see cref="Description"/> are already resolved through the i18n facade, and
/// <see cref="AutomationName"/> is the Narrator name for the whole tile (label then description, mirroring the
/// web link's accessible name). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="RouteName">Stable native route name the tile opens.</param>
/// <param name="Glyph">Segoe Fluent glyph for the accent icon.</param>
/// <param name="Label">Localized channel label.</param>
/// <param name="Description">Localized channel description.</param>
/// <param name="AutomationName">Narrator name for the tile (label then description).</param>
public sealed record SubscribeCardTile(
    string RouteName,
    string Glyph,
    string Label,
    string Description,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the surface — the native analogue of the web <c>SubscribeCard</c>
/// render output: the resolved <see cref="State"/> and the ordered list of channel <see cref="Tiles"/> (the web
/// five <c>&lt;ChannelTile&gt;</c>s). The card heading, sub-line and empty-state copy are surface-level concerns
/// resolved from <see cref="SubscribeCardRegistration"/>, not baked into the projection. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="State">The mutually-exclusive surface state (<see cref="SubscribeCardState.Ready"/> / <see cref="SubscribeCardState.Empty"/>).</param>
/// <param name="Tiles">The ordered channel tiles (the web <c>ChannelTile</c> list).</param>
public sealed record SubscribeCardDisplay(SubscribeCardState State, IReadOnlyList<SubscribeCardTile> Tiles)
{
    /// <summary>True when at least one tile resolved (the web grid renders); false drives the empty surface.</summary>
    public bool HasTiles => Tiles.Count > 0;
}

/// <summary>
/// The canonical <see cref="ISubscribeCardChannelSource"/> — the five channel entries the web
/// <c>SubscribeCard</c> component renders, in the same order (Email, Slack, Discord, Webhook, Browser push).
/// Headless and immutable, so the catalog is asserted in unit tests.
/// </summary>
public sealed class SubscribeCardChannelSource : ISubscribeCardChannelSource
{
    /// <inheritdoc />
    public IReadOnlyList<SubscribeCardChannel> GetChannels() => SubscribeCardRegistration.Canonical;
}

/// <summary>
/// Pure projection from the canonical <see cref="SubscribeCardChannel"/> list to the render-ready
/// <see cref="SubscribeCardDisplay"/> — the native port of the five <c>&lt;ChannelTile&gt;</c>s in
/// web/src/features/system/components/status/SubscribeCard.tsx. Every label and description resolves through the
/// i18n facade; the Narrator name joins them as the web link's accessible name does. The surface carries no
/// measurements, so no SI conversion applies. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SubscribeCardProjection
{
    /// <summary>Project <paramref name="channels"/>, resolving every label/description via <paramref name="localizer"/>.</summary>
    /// <param name="channels">The channel entries (the canonical catalog, or a test substitute).</param>
    /// <param name="localizer">The i18n facade every label and description resolves through.</param>
    public static SubscribeCardDisplay Project(IReadOnlyList<SubscribeCardChannel> channels, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(channels);
        ArgumentNullException.ThrowIfNull(localizer);

        var tiles = new List<SubscribeCardTile>(channels.Count);
        foreach (var channel in channels)
        {
            string label = localizer.GetString(channel.LabelKey, channel.LabelFallback);
            string description = localizer.GetString(channel.DescriptionKey, channel.DescriptionFallback);
            string automationName = string.Create(CultureInfo.CurrentCulture, $"{label}, {description}");
            tiles.Add(new SubscribeCardTile(channel.RouteName, channel.Glyph, label, description, automationName));
        }

        var state = tiles.Count > 0 ? SubscribeCardState.Ready : SubscribeCardState.Empty;
        return new SubscribeCardDisplay(state, tiles);
    }
}

/// <summary>
/// The responsive column logic for the <c>SubscribeCard</c> grid — the native port of the web Tailwind classes
/// <c>grid-cols-1 sm:grid-cols-2</c> (web/src/features/system/components/status/SubscribeCard.tsx). The web grid
/// lays out a single column until the container reaches the Tailwind <c>sm</c> breakpoint (640&#160;px), then
/// two. Pure arithmetic so the breakpoint is asserted without a UI host.
/// </summary>
public static class SubscribeCardLayout
{
    /// <summary>The Tailwind <c>sm</c> breakpoint in effective pixels (web <c>sm:</c> == 640&#160;px).</summary>
    public const double SmBreakpointPx = 640;

    /// <summary>Columns at narrow widths (web <c>grid-cols-1</c>).</summary>
    public const int NarrowColumns = 1;

    /// <summary>Columns at or above the <c>sm</c> breakpoint (web <c>sm:grid-cols-2</c>).</summary>
    public const int WideColumns = 2;

    /// <summary>
    /// The number of tile columns for an available <paramref name="width"/>: one below the <c>sm</c>
    /// breakpoint, two at or above it (web <c>grid-cols-1 sm:grid-cols-2</c>). A non-positive or
    /// not-a-number width (a control not yet measured) collapses to the narrow count so the first paint is
    /// never wider than the surface.
    /// </summary>
    public static int ColumnsForWidth(double width) =>
        double.IsNaN(width) || width < SmBreakpointPx ? NarrowColumns : WideColumns;
}

/// <summary>
/// Canonical metadata for the <c>SubscribeCard</c> feature surface — the native mirror of the web component at
/// web/src/features/system/components/status/SubscribeCard.tsx: the stable diagnostics slug, the heading /
/// sub-line / empty-state copy, the Segoe Fluent header bell glyph, and the fixed channel catalog (the five
/// <c>&lt;ChannelTile&gt;</c>s) with the same Segoe Fluent glyphs and native route names.
///
/// Route mapping (the native analogue of the web <c>to</c> paths — documented so the mapping is explicit, not
/// silent drift): the web <c>/notifications/channels</c> target (Email / Slack / Discord / Webhook) maps to the
/// native route <c>NotificationsChannels</c> (the exact path port). The web Browser-push target
/// <c>/settings/notifications</c> has no one-for-one native route — on the web the Browser-notifications page
/// (<c>/notifications/browser</c>) and the Settings notifications section render the same
/// <c>NotificationSettings</c> surface — so it maps to the canonical native route <c>NotificationsBrowser</c>,
/// the destination that owns that exact browser/PWA push opt-in. UI-free so the metadata is asserted in tests.
/// </summary>
public static class SubscribeCardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SubscribeCard";

    /// <summary>i18n key for the card heading (the web <c>&lt;h3&gt;</c>).</summary>
    public const string TitleKey = "subscribeCard.title";

    /// <summary>English fallback for the card heading (the web literal).</summary>
    public const string TitleFallback = "Get notified about incidents";

    /// <summary>i18n key for the muted sub-line under the heading (the web <c>&lt;p&gt;</c>).</summary>
    public const string SubtitleKey = "subscribeCard.subtitle";

    /// <summary>English fallback for the sub-line (the web literal).</summary>
    public const string SubtitleFallback = "Self-hosted: configure your own channels for status events.";

    /// <summary>i18n key for the empty-state message (shown only in the defensive empty branch).</summary>
    public const string EmptyMessageKey = "subscribeCard.empty";

    /// <summary>English fallback for the empty-state message.</summary>
    public const string EmptyMessageFallback = "No notification channels available";

    /// <summary>Segoe Fluent "Ringer" glyph for the heading icon (the web Lucide <c>Bell</c>).</summary>
    public const string BellGlyph = "\uEA8F";

    /// <summary>Stable native route the channel-configuration tiles open (the web <c>/notifications/channels</c>).</summary>
    public const string ChannelsRoute = "NotificationsChannels";

    /// <summary>Stable native route the browser-push tile opens (the web <c>/settings/notifications</c> surface).</summary>
    public const string BrowserPushRoute = "NotificationsBrowser";

    // Segoe Fluent Icons code points standing in for the web Lucide icons (matching the glyphs the rest of the
    // shell already uses for these channel kinds, e.g. NotificationChannelsView / BrowserPushChannelCard).
    private const string MailGlyph = "\uE715";       // web Mail
    private const string MessageGlyph = "\uE8BD";    // web MessageSquare (Slack)
    private const string HashGlyph = "\uE8EF";       // web Hash (Discord)
    private const string WebhookGlyph = "\uE71B";    // web Webhook
    private const string DeviceGlyph = "\uE8EA";     // web Smartphone (Browser push)

    /// <summary>The canonical, ordered channel catalog (the web five <c>ChannelTile</c>s).</summary>
    public static IReadOnlyList<SubscribeCardChannel> Canonical { get; } = new[]
    {
        new SubscribeCardChannel(
            ChannelsRoute, MailGlyph,
            "subscribeCard.channel.email.label", "Email",
            "subscribeCard.channel.email.description", "SMTP-based delivery"),
        new SubscribeCardChannel(
            ChannelsRoute, MessageGlyph,
            "subscribeCard.channel.slack.label", "Slack",
            "subscribeCard.channel.slack.description", "Webhook channel"),
        new SubscribeCardChannel(
            ChannelsRoute, HashGlyph,
            "subscribeCard.channel.discord.label", "Discord",
            "subscribeCard.channel.discord.description", "Webhook channel"),
        new SubscribeCardChannel(
            ChannelsRoute, WebhookGlyph,
            "subscribeCard.channel.webhook.label", "Webhook",
            "subscribeCard.channel.webhook.description", "Custom HTTP endpoint"),
        new SubscribeCardChannel(
            BrowserPushRoute, DeviceGlyph,
            "subscribeCard.channel.browserPush.label", "Browser push",
            "subscribeCard.channel.browserPush.description", "Opt-in PWA notifications"),
    };

    /// <summary>The localized card heading (also the surface's Narrator region name).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>The localized muted sub-line under the heading.</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SubtitleKey, SubtitleFallback);
    }

    /// <summary>The localized empty-state message.</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyMessageKey, EmptyMessageFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SubscribeCard</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event and the data-free per-tile navigation activation with the surface
/// slug — never a route, label or any user data — so a diagnostics line can never leak operational data.
/// Thread-safe.
/// </summary>
public sealed class SubscribeCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _navigations;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or null.</param>
    public SubscribeCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times a tile has been activated (a navigation requested).</summary>
    public long Navigations => Interlocked.Read(ref _navigations);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SubscribeCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SubscribeCardRegistration.Slug}");
    }

    /// <summary>Record that a tile was activated, emitting <c>subscribe-card.activated slug=SubscribeCard</c>.</summary>
    public void RecordNavigated()
    {
        Interlocked.Increment(ref _navigations);
        _sink?.Invoke($"subscribe-card.activated slug={SubscribeCardRegistration.Slug}");
    }
}
