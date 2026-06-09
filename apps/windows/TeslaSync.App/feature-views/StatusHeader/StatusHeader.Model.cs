using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.DlqInspector;

/// <summary>
/// The render branch of the DLQ-inspector <c>StatusHeader</c> surface — the native union of the two
/// branches the web component renders (web/src/features/admin/components/dlq-inspector/StatusHeader.tsx).
/// The web source is a pure presentational component (it takes <c>data</c> + <c>loading</c> as props and
/// performs no fetching), so the branch is a direct function of the input <see cref="StatusHeaderModel"/>;
/// there is no fetch-driven error / stale / offline branch to reproduce — those belong to the parent
/// DLQ-inspector page, not this header. Both branches render every tile (an absent response renders zeros,
/// never a blank box).
/// </summary>
public enum StatusHeaderState
{
    /// <summary>The list query is in flight (web <c>loading</c>) — every tile shows an em dash.</summary>
    Loading,

    /// <summary>The query resolved (web <c>!loading</c>) — tiles show counts and the replay-mode chip.</summary>
    Ready,
}

/// <summary>
/// The DLQ list response the header summarises — the native mirror of the web <c>DLQListResponse</c>
/// (<c>count</c>, <c>replay_enabled</c>, <c>entries</c>). A null model <see cref="StatusHeaderModel.Data"/>
/// mirrors the web <c>data: DLQListResponse | undefined</c> being <c>undefined</c> (counts fall back to
/// zero and replay falls back to disabled). Pure data — no WinUI types.
/// </summary>
public sealed record DlqListSnapshot(
    int Count,
    bool ReplayEnabled,
    IReadOnlyList<DlqEntrySummary> Entries);

/// <summary>
/// The render-time data model the <c>StatusHeader</c> view binds to — the native analogue of the web
/// <c>StatusHeaderProps</c> (<c>data</c> + <c>loading</c>). The component is presentational: the parent
/// DLQ-inspector page owns the query and feeds the resolved <see cref="Data"/> (or null while it has not
/// resolved) and the <see cref="Loading"/> flag. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record StatusHeaderModel(bool Loading, DlqListSnapshot? Data)
{
    /// <summary>The initial state: the list query is loading and no response has arrived yet.</summary>
    public static StatusHeaderModel Initial { get; } = new(true, null);
}

/// <summary>
/// One projected, render-ready stat tile — the resolved label, the formatted value, the sub-line, the
/// accent glyph and a Narrator name. Mirrors a single web <c>StatCard</c>. Pure data so every value is
/// asserted headlessly.
/// </summary>
public sealed record StatusHeaderCard(
    string Label,
    string Value,
    string Sublabel,
    string Glyph,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the header for one input model — the native analogue of what
/// the web <c>StatusHeader</c> returns: the three stat <see cref="Cards"/> and the conditional
/// disabled-replay banner (<see cref="ShowBanner"/> + its title/message). Pure data so both branches are
/// asserted headlessly.
/// </summary>
public sealed record StatusHeaderDisplay(
    StatusHeaderState State,
    IReadOnlyList<StatusHeaderCard> Cards,
    bool ShowBanner,
    string BannerTitle,
    string BannerMessage,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="StatusHeaderModel"/> to its <see cref="StatusHeaderDisplay"/> — the
/// native port of web/src/features/admin/components/dlq-inspector/StatusHeader.tsx. Reproduces the web
/// derivations exactly: <c>count = data?.count ?? 0</c>, <c>replayable = entries.filter(replayable).length</c>,
/// <c>enabled = data?.replay_enabled ?? false</c>; every value is an em dash while loading; the warning
/// banner is shown iff <c>!loading &amp;&amp; !enabled</c>. Integers format through
/// <see cref="NumberFormatting"/> (the native <c>fmtInt</c>) and every label resolves through the i18n
/// facade using the same keys the web source feeds into <c>t()</c>. No WinUI types — unit-tested without a
/// UI host.
/// </summary>
public static class StatusHeaderProjection
{
    /// <summary>Segoe Fluent "Mail" glyph — the web lucide <c>Inbox</c> icon (the dead-letter queue).</summary>
    public const string InboxGlyph = "\uE715";

    /// <summary>Segoe Fluent "Security" glyph — the web lucide <c>ShieldCheck</c> icon (replayable count).</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent "ErrorBadge" glyph — the web lucide <c>AlertOctagon</c> icon (replay mode).</summary>
    public const string AlertGlyph = "\uEA39";

    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static StatusHeaderDisplay Project(StatusHeaderModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool loading = model.Loading;
        DlqListSnapshot? data = model.Data;
        int count = data?.Count ?? 0;
        int replayable = CountReplayable(data);
        bool enabled = data?.ReplayEnabled ?? false;

        string totalLabel = localizer.GetString("admin.dlq.stats.total", "Total entries");
        string totalSub = localizer.GetString("admin.dlq.stats.totalSub", "in dead-letter queue");
        string replayableLabel = localizer.GetString("admin.dlq.stats.replayable", "Replayable");
        string replayableSub = localizer.GetString("admin.dlq.stats.replayableSub", "parsed with source topic");
        string replayModeLabel = localizer.GetString("admin.dlq.stats.replayMode", "Replay mode");
        string replayModeSub = localizer.GetString("admin.dlq.stats.replayModeSub", "DLQ_REPLAY_ENABLED env");

        string totalValue = loading ? EmDash : FormatInt(count);
        string replayableValue = loading ? EmDash : FormatInt(replayable);
        string replayModeValue = loading
            ? EmDash
            : enabled
                ? localizer.GetString("admin.dlq.stats.enabled", "Enabled")
                : localizer.GetString("admin.dlq.stats.disabled", "Disabled");

        var cards = new List<StatusHeaderCard>(3)
        {
            Card(totalLabel, totalValue, totalSub, InboxGlyph),
            Card(replayableLabel, replayableValue, replayableSub, ShieldGlyph),
            Card(replayModeLabel, replayModeValue, replayModeSub, AlertGlyph),
        };

        // Web parity: the banner — and therefore its two t() calls — exists only inside the
        // `{!loading && !enabled && (...)}` branch, so the strings are resolved only when it is shown.
        bool showBanner = !loading && !enabled;
        string bannerTitle = showBanner
            ? localizer.GetString("admin.dlq.banners.disabledTitle", "DLQ replay is disabled")
            : string.Empty;
        string bannerMessage = showBanner
            ? localizer.GetString(
                "admin.dlq.banners.disabledMessage",
                "The DLQ_REPLAY_ENABLED env flag is not set on this server. Replay attempts will return HTTP 403 and be logged as result=\"disabled\".")
            : string.Empty;

        StatusHeaderState state = loading ? StatusHeaderState.Loading : StatusHeaderState.Ready;

        return new StatusHeaderDisplay(
            State: state,
            Cards: cards,
            ShowBanner: showBanner,
            BannerTitle: bannerTitle,
            BannerMessage: bannerMessage,
            AutomationName: BuildAutomationName(cards, showBanner, bannerTitle));
    }

    // Web parity: `replayable = (data?.entries ?? []).filter((e) => e.replayable).length`.
    private static int CountReplayable(DlqListSnapshot? data)
    {
        if (data is null)
        {
            return 0;
        }

        int count = 0;
        foreach (var entry in data.Entries)
        {
            if (entry.Replayable)
            {
                count++;
            }
        }

        return count;
    }

    // Web parity for `fmtInt`: locale-aware grouping, zero fraction digits.
    private static string FormatInt(int value) => NumberFormatting.Format(value, null, 0);

    private static StatusHeaderCard Card(string label, string value, string sublabel, string glyph) =>
        new(label, value, sublabel, glyph, $"{label}: {value}. {sublabel}");

    private static string BuildAutomationName(
        List<StatusHeaderCard> cards,
        bool showBanner,
        string bannerTitle)
    {
        var parts = new List<string>(cards.Count + 1);
        foreach (var card in cards)
        {
            parts.Add(card.AutomationName);
        }

        if (showBanner)
        {
            parts.Add(bannerTitle);
        }

        return string.Join(". ", parts);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>StatusHeader</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a count, a VIN or any DLQ payload — so
/// a diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class StatusHeaderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public StatusHeaderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StatusHeader</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StatusHeaderRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>StatusHeader</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/admin/components/dlq-inspector/StatusHeader.tsx</c>.
/// </summary>
public static class StatusHeaderRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "StatusHeader";
}
