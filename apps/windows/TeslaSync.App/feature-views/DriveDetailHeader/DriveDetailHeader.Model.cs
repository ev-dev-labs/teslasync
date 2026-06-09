using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The outbound navigation seam the <c>DriveDetailHeader</c> surface drives — the native analogue of the two
/// react-router <c>&lt;Link to="…"&gt;</c> elements the web component renders
/// (web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx): the back link to the drive list
/// (<c>/drives</c>) and the replay link (<c>/drives/{driveId}/replay</c>). The view never touches the shell
/// directly; activating the back affordance calls <see cref="OpenDriveList"/> and activating Replay calls
/// <see cref="OpenReplay(string)"/> with the drive's id, and the host wires these to the in-app navigation
/// (resolving the route + path and invoking the shell). A test double records the requests so the view's
/// navigation behaviour is verified without a shell.
/// </summary>
public interface IDriveDetailHeaderNavigator
{
    /// <summary>Navigate back to the drive list (web <c>&lt;Link to="/drives"&gt;</c>).</summary>
    void OpenDriveList();

    /// <summary>
    /// Open the route replay for <paramref name="driveId"/>
    /// (web <c>&lt;Link to={`/drives/${driveId}/replay`}&gt;</c>).
    /// </summary>
    /// <param name="driveId">The drive identifier whose replay opens (the web <c>driveId</c> prop).</param>
    void OpenReplay(string driveId);
}

/// <summary>
/// The mutually-exclusive surface state for the <c>DriveDetailHeader</c> feature view. The web source
/// (web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx) is a pure presentational
/// component: it receives a fully-resolved <c>drive</c> prop and performs no fetching, so it has a single
/// content state — <see cref="Ready"/> — whose internal conditionals (route-vs-fallback title, present-vs-live
/// end time) are reproduced inside that state. There is deliberately no fetch-driven error / stale / offline
/// branch to reproduce here — those belong to the parent drive-detail page, not this header (the same
/// precedent the sibling <c>StatusHeader</c> / <c>QuickNav</c> surfaces follow). The defensive
/// <see cref="Loading"/> branch renders tokenized skeleton chrome when the parent has not resolved the drive
/// yet, so the surface is never a blank box.
/// </summary>
public enum DriveDetailHeaderState
{
    /// <summary>The parent has not resolved the drive yet — render skeleton chrome.</summary>
    Loading,

    /// <summary>The drive resolved — render the web header composition.</summary>
    Ready,
}

/// <summary>
/// The fields of the web <c>DriveDetail</c> the header actually reads — the start / end street addresses (the
/// title route) and the start / end timestamps (the subtitle). A null field mirrors the web optional being
/// <c>null</c> (<c>drive.startAddress</c>, <c>drive.endAddress</c>, <c>drive.endTs</c> are all nullable; a live
/// in-progress drive has a null <see cref="EndTimestamp"/>). Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="StartAddress">The drive's start street address (web <c>drive.startAddress</c>), or null.</param>
/// <param name="EndAddress">The drive's end street address (web <c>drive.endAddress</c>), or null.</param>
/// <param name="StartTimestamp">When the drive started (web <c>drive.startTs</c>), or null.</param>
/// <param name="EndTimestamp">When the drive ended (web <c>drive.endTs</c>); null for a live drive.</param>
public sealed record DriveHeaderSnapshot(
    string? StartAddress,
    string? EndAddress,
    DateTimeOffset? StartTimestamp,
    DateTimeOffset? EndTimestamp);

/// <summary>
/// The render-time data model the <c>DriveDetailHeader</c> view binds to — the native analogue of the web
/// <c>DriveDetailHeaderProps</c> (<c>drive</c> + <c>driveId</c> + <c>vehicleName</c>; the <c>onShare</c>
/// callback is supplied to the view directly, like the web prop). The header is presentational: the parent
/// drive-detail page owns the query and feeds the resolved <see cref="Drive"/> (or null while it has not
/// resolved). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Drive">The resolved drive fields the header reads, or null while the parent is still loading.</param>
/// <param name="DriveId">The drive identifier the replay link targets (web <c>driveId</c>).</param>
/// <param name="VehicleName">The vehicle display name shown in the subtitle (web <c>vehicleName</c>).</param>
public sealed record DriveDetailHeaderModel(
    DriveHeaderSnapshot? Drive,
    string DriveId,
    string VehicleName)
{
    /// <summary>The initial model: the parent is still resolving the drive, so the skeleton branch renders.</summary>
    public static DriveDetailHeaderModel Pending { get; } = new(null, string.Empty, string.Empty);
}

/// <summary>
/// The fully projected, render-ready view of the header for one input model — the native analogue of what the
/// web <c>DriveDetailHeader</c> returns: the resolved <see cref="State"/>, the route-or-fallback
/// <see cref="Title"/>, the subtitle inputs (<see cref="VehicleName"/> + <see cref="StartTimestamp"/> +
/// <see cref="EndTimestamp"/> gated by <see cref="ShowEndTime"/>), the localized action labels and the
/// Narrator name. The actual date/time strings are produced by the shared <c>TsDateTime</c> control at render
/// time (the native counterpart of the web <c>DateTime</c> component); the projection only decides which
/// values and which branch. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The mutually-exclusive surface state (<see cref="DriveDetailHeaderState"/>).</param>
/// <param name="Title">The header title — <c>start → end</c> when both addresses resolved, else the localized "Drive Details".</param>
/// <param name="HasRoute">True when both addresses resolved, so <see cref="Title"/> is the start → end route.</param>
/// <param name="VehicleName">The vehicle display name shown in the subtitle.</param>
/// <param name="StartTimestamp">The drive start used for the subtitle date + time, or null.</param>
/// <param name="EndTimestamp">The drive end used for the subtitle end time, or null for a live drive.</param>
/// <param name="ShowEndTime">True when <see cref="EndTimestamp"/> resolved (web <c>drive.endTs &amp;&amp; …</c>).</param>
/// <param name="DriveId">The drive identifier the replay action targets.</param>
/// <param name="ReplayLabel">Localized "Replay" action label.</param>
/// <param name="ShareLabel">Localized "Share" action label.</param>
/// <param name="BackLabel">Localized Narrator label for the back affordance.</param>
/// <param name="LoadingLabel">Localized Narrator label announced while the skeleton renders.</param>
/// <param name="AutomationName">Narrator name for the whole surface.</param>
public sealed record DriveDetailHeaderDisplay(
    DriveDetailHeaderState State,
    string Title,
    bool HasRoute,
    string VehicleName,
    DateTimeOffset? StartTimestamp,
    DateTimeOffset? EndTimestamp,
    bool ShowEndTime,
    string DriveId,
    string ReplayLabel,
    string ShareLabel,
    string BackLabel,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="DriveDetailHeaderModel"/> to its <see cref="DriveDetailHeaderDisplay"/> —
/// the native port of web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx. Reproduces the
/// web derivations exactly: the title is <c>`${startAddress} → ${endAddress}`</c> when both addresses are
/// present, else <c>t('driveDetail.title', 'Drive Details')</c>; the subtitle end time is shown only when
/// <c>drive.endTs</c> is set (a live drive omits it). Every label resolves through the i18n facade using the
/// same keys the web source feeds into <c>t()</c>. No SI conversion applies (the surface carries no
/// measurements — only addresses, names and timestamps). No WinUI types — unit-tested without a UI host.
/// </summary>
public static class DriveDetailHeaderProjection
{
    /// <summary>The web "→" route separator (U+2192) joining the start and end addresses.</summary>
    public const string RouteArrow = "\u2192";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static DriveDetailHeaderDisplay Project(DriveDetailHeaderModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string replayLabel = localizer.GetString(
            DriveDetailHeaderRegistration.ReplayKey, DriveDetailHeaderRegistration.ReplayFallback);
        string shareLabel = localizer.GetString(
            DriveDetailHeaderRegistration.ShareKey, DriveDetailHeaderRegistration.ShareFallback);
        string backLabel = localizer.GetString(
            DriveDetailHeaderRegistration.BackKey, DriveDetailHeaderRegistration.BackFallback);
        string loadingLabel = localizer.GetString(
            DriveDetailHeaderRegistration.LoadingKey, DriveDetailHeaderRegistration.LoadingFallback);

        if (model.Drive is not { } drive)
        {
            // The parent has not resolved the drive yet → skeleton chrome. The web parent gates this header on
            // the loaded drive, so the header itself never renders a blank surface.
            return new DriveDetailHeaderDisplay(
                State: DriveDetailHeaderState.Loading,
                Title: string.Empty,
                HasRoute: false,
                VehicleName: model.VehicleName,
                StartTimestamp: null,
                EndTimestamp: null,
                ShowEndTime: false,
                DriveId: model.DriveId,
                ReplayLabel: replayLabel,
                ShareLabel: shareLabel,
                BackLabel: backLabel,
                LoadingLabel: loadingLabel,
                AutomationName: loadingLabel);
        }

        // Web: drive.startAddress && drive.endAddress ? `${start} → ${end}` : t('driveDetail.title','Drive Details').
        bool hasRoute = !string.IsNullOrEmpty(drive.StartAddress) && !string.IsNullOrEmpty(drive.EndAddress);
        string title = hasRoute
            ? string.Create(CultureInfo.CurrentCulture, $"{drive.StartAddress} {RouteArrow} {drive.EndAddress}")
            : localizer.GetString(DriveDetailHeaderRegistration.TitleKey, DriveDetailHeaderRegistration.TitleFallback);

        // Web: {drive.endTs && ( → <DateTime …/> )} — a live (in-progress) drive has no endTs, so omit the end time.
        bool showEndTime = drive.EndTimestamp is not null;

        return new DriveDetailHeaderDisplay(
            State: DriveDetailHeaderState.Ready,
            Title: title,
            HasRoute: hasRoute,
            VehicleName: model.VehicleName,
            StartTimestamp: drive.StartTimestamp,
            EndTimestamp: drive.EndTimestamp,
            ShowEndTime: showEndTime,
            DriveId: model.DriveId,
            ReplayLabel: replayLabel,
            ShareLabel: shareLabel,
            BackLabel: backLabel,
            LoadingLabel: loadingLabel,
            AutomationName: BuildAutomationName(title, model.VehicleName));
    }

    private static string BuildAutomationName(string title, string vehicleName) =>
        string.IsNullOrEmpty(vehicleName)
            ? title
            : string.Create(CultureInfo.CurrentCulture, $"{title}, {vehicleName}");
}

/// <summary>
/// Canonical metadata for the <c>DriveDetailHeader</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx</c>: the stable diagnostics
/// slug, the i18n keys + English fallbacks the web source feeds into <c>t()</c> (plus the <c>common.back</c> /
/// <c>common.loading</c> keys backing the Narrator-only affordances the web renders as a bare icon), and the
/// Segoe Fluent glyphs standing in for the web Lucide icons. UI-free so the metadata is asserted in tests.
/// </summary>
public static class DriveDetailHeaderRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "DriveDetailHeader";

    /// <summary>i18n key for the fallback title (web <c>t('driveDetail.title', 'Drive Details')</c>).</summary>
    public const string TitleKey = "driveDetail.title";

    /// <summary>English fallback for the title — verbatim from the web source.</summary>
    public const string TitleFallback = "Drive Details";

    /// <summary>i18n key for the Replay action (web <c>t('driveDetail.replay', 'Replay')</c>).</summary>
    public const string ReplayKey = "driveDetail.replay";

    /// <summary>English fallback for the Replay action — verbatim from the web source.</summary>
    public const string ReplayFallback = "Replay";

    /// <summary>i18n key for the Share action (web <c>t('driveDetail.share', 'Share')</c>).</summary>
    public const string ShareKey = "driveDetail.share";

    /// <summary>English fallback for the Share action — verbatim from the web source.</summary>
    public const string ShareFallback = "Share";

    /// <summary>
    /// i18n key for the back affordance's Narrator label. The web back link is icon-only with no accessible
    /// name; Windows Narrator minimums require one, so the surface resolves the shared <c>common.back</c> key.
    /// </summary>
    public const string BackKey = "common.back";

    /// <summary>English fallback for the back affordance's Narrator label.</summary>
    public const string BackFallback = "Back";

    /// <summary>i18n key for the skeleton's Narrator announcement.</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for the skeleton's Narrator announcement.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>Segoe Fluent "Route" glyph — the web Lucide <c>Route</c> icon (matches the Drives nav-pane glyph).</summary>
    public const string RouteGlyph = "\uE7C0";

    /// <summary>Segoe Fluent "Back" glyph — the web Lucide <c>ArrowLeft</c> icon.</summary>
    public const string BackGlyph = "\uE72B";

    /// <summary>Segoe Fluent "Play" glyph — the web Lucide <c>Play</c> icon (Replay).</summary>
    public const string PlayGlyph = "\uE768";

    /// <summary>Segoe Fluent "Share" glyph — the web Lucide <c>Share2</c> icon.</summary>
    public const string ShareGlyph = "\uE72D";
}

/// <summary>
/// PII-safe diagnostics for the <c>DriveDetailHeader</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event and the data-free Replay / Share / back activations with the
/// surface slug — never a drive id, address, vehicle name or timestamp — so a diagnostics line can never leak
/// a user's trip. Thread-safe.
/// </summary>
public sealed class DriveDetailHeaderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _replaysOpened;
    private long _shares;
    private long _backNavigations;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DriveDetailHeaderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times Replay has been activated.</summary>
    public long ReplaysOpened => Interlocked.Read(ref _replaysOpened);

    /// <summary>Number of times Share has been activated.</summary>
    public long Shares => Interlocked.Read(ref _shares);

    /// <summary>Number of times the back affordance has been activated.</summary>
    public long BackNavigations => Interlocked.Read(ref _backNavigations);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DriveDetailHeader</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DriveDetailHeaderRegistration.Slug}");
    }

    /// <summary>Record that Replay was activated, emitting <c>drive-detail-header.replay slug=DriveDetailHeader</c>.</summary>
    public void RecordReplayOpened()
    {
        Interlocked.Increment(ref _replaysOpened);
        _sink?.Invoke($"drive-detail-header.replay slug={DriveDetailHeaderRegistration.Slug}");
    }

    /// <summary>Record that Share was activated, emitting <c>drive-detail-header.share slug=DriveDetailHeader</c>.</summary>
    public void RecordShared()
    {
        Interlocked.Increment(ref _shares);
        _sink?.Invoke($"drive-detail-header.share slug={DriveDetailHeaderRegistration.Slug}");
    }

    /// <summary>Record that the back affordance was activated, emitting <c>drive-detail-header.back slug=DriveDetailHeader</c>.</summary>
    public void RecordBackToList()
    {
        Interlocked.Increment(ref _backNavigations);
        _sink?.Invoke($"drive-detail-header.back slug={DriveDetailHeaderRegistration.Slug}");
    }
}
