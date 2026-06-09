using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The mutually-exclusive surface the <c>OnboardingChecklistWidget</c> renders — the native union of
/// the visibility branches the web source decides
/// (web/src/features/dashboard/widgets/OnboardingChecklistWidget.tsx + the
/// <c>useChecklistTasks</c>/<c>shouldHideChecklist</c> logic in
/// web/src/features/onboarding/checklist.ts). The widget is deliberately local-first: like the web it
/// NEVER hides the checklist behind a network spinner or error surface — the three backing reads
/// (vehicles, alert rules, notification channels) only flip task completion as they settle, exactly
/// as the web hooks' <c>data?.length</c> reads do. The cache-then-network freshness is surfaced via
/// the separate freshness signals on the view-model, never by collapsing a section.
/// </summary>
public enum OnboardingChecklistState
{
    /// <summary>At least one task is visible — render the progress header, task list and (when 100 %) the celebration footer.</summary>
    Active,

    /// <summary>No tasks are defined (web <c>totalCount === 0</c>) — render the friendly "no setup steps" empty state.</summary>
    Empty,

    /// <summary>Dismissed, or the 24 h celebration window has elapsed (web <c>shouldHideChecklist</c>) — render the small restart affordance.</summary>
    Hidden,
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// registry constraints for <c>onboarding-checklist</c> (default 2×4, min 2×3, max 4×8).
/// </summary>
public readonly record struct OnboardingChecklistSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static OnboardingChecklistSize Default => new(2, 4);

    /// <summary>The registry minimum footprint (2×3).</summary>
    public static OnboardingChecklistSize Min => new(2, 3);

    /// <summary>The registry maximum footprint (4×8).</summary>
    public static OnboardingChecklistSize Max => new(4, 8);

    /// <summary>True at three or more columns — the task rows show their per-task icon chip.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// The observable inputs that decide each checklist task's completion — the native analogue of the
/// values the web <c>useChecklistTasks</c> hook folds together: the three list lengths from the API
/// reads plus the four locally-tracked booleans. Kept a pure value type so the projection is unit
/// tested without a network, a settings store or WinUI.
/// </summary>
public readonly record struct ChecklistInputs(
    int VehicleCount,
    int AlertRuleCount,
    int ChannelCount,
    bool ThemePicked,
    bool CommandPaletteDiscovered,
    bool WebPushGranted,
    bool DashboardCustomized);

/// <summary>
/// The static definition of one checklist task — everything except the live <c>complete</c> boolean,
/// which is computed from <see cref="ChecklistInputs"/> by <see cref="IsComplete"/>. A faithful port
/// of one entry in the web <c>tasks</c> array (web/src/features/onboarding/checklist.ts): the same id,
/// the same i18n keys + English fallbacks, the same CTA target, in the same order. The lucide icon is
/// mapped to its closest Segoe Fluent Icons glyph.
/// </summary>
public sealed record ChecklistTaskDefinition(
    string Id,
    string TitleKey,
    string TitleFallback,
    string DescriptionKey,
    string DescriptionFallback,
    string CtaKey,
    string CtaFallback,
    string CtaTarget,
    string IconGlyph,
    Func<ChecklistInputs, bool> IsComplete)
{
    // ── Task icon glyphs (Segoe Fluent Icons — closest analogue to the web lucide icon) ──
    private const string CarGlyph = "\uE804";          // Car — web Car
    private const string ColorGlyph = "\uE790";        // Color — web Palette
    private const string RingerGlyph = "\uEA8F";       // Ringer — web BellRing
    private const string SendGlyph = "\uE724";         // Send — web Send
    private const string KeyboardGlyph = "\uE765";     // Keyboard — web Command
    private const string NotificationGlyph = "\uE7E7"; // Notification — web BellPlus
    private const string GridGlyph = "\uE80F";         // Tiles/grid — web LayoutGrid

    /// <summary>Sentinel CTA target the view intercepts to toggle the command palette (web <c>COMMAND_PALETTE_CTA</c>).</summary>
    public const string CommandPaletteTarget = "#open-command-palette";

    /// <summary>Native route the "Connect your Tesla" CTA navigates to (web <c>/tesla-account</c>).</summary>
    public const string TeslaAccountRoute = "tesla-account";

    /// <summary>Native route the "Pick a theme" CTA navigates to (web <c>/settings#appearance</c>).</summary>
    public const string SettingsRoute = "settings";

    /// <summary>Native route the "first alert" CTA navigates to (web <c>/notifications/alerts</c>).</summary>
    public const string AlertsRoute = "notifications/alerts";

    /// <summary>Native route the "notification channel" CTA navigates to (web <c>/notifications/channels</c>).</summary>
    public const string ChannelsRoute = "notifications/channels";

    /// <summary>Native route the "enable web push" CTA navigates to (web <c>/notifications/browser</c>).</summary>
    public const string BrowserPushRoute = "notifications/browser";

    /// <summary>Native route the "customize dashboard" CTA navigates to — the index/dashboard route (web <c>/dashboard</c>).</summary>
    public const string DashboardRoute = "";

    /// <summary>
    /// The seven setup tasks, in the same order the web source lists them. Each task auto-completes the
    /// moment its underlying signal flips — there is no manual marking, mirroring the web contract.
    /// </summary>
    public static IReadOnlyList<ChecklistTaskDefinition> All { get; } = new[]
    {
        new ChecklistTaskDefinition(
            "connect-vehicle",
            "checklist.tasks.connectVehicle.title", "Connect your Tesla",
            "checklist.tasks.connectVehicle.description", "Link your Tesla account to start syncing data.",
            "checklist.tasks.connectVehicle.cta", "Connect",
            TeslaAccountRoute, CarGlyph,
            static inputs => inputs.VehicleCount > 0),
        new ChecklistTaskDefinition(
            "pick-theme",
            "checklist.tasks.pickTheme.title", "Pick a theme",
            "checklist.tasks.pickTheme.description", "Choose an accent color that fits your style.",
            "checklist.tasks.pickTheme.cta", "Open",
            SettingsRoute, ColorGlyph,
            static inputs => inputs.ThemePicked),
        new ChecklistTaskDefinition(
            "first-alert",
            "checklist.tasks.firstAlert.title", "Create your first alert rule",
            "checklist.tasks.firstAlert.description", "Get notified when something changes — battery low, charge complete, etc.",
            "checklist.tasks.firstAlert.cta", "Create",
            AlertsRoute, RingerGlyph,
            static inputs => inputs.AlertRuleCount > 0),
        new ChecklistTaskDefinition(
            "notification-channel",
            "checklist.tasks.notify.title", "Add a notification channel",
            "checklist.tasks.notify.description", "Without a channel (Discord, ntfy, email, …) your alerts go to /dev/null.",
            "checklist.tasks.notify.cta", "Configure",
            ChannelsRoute, SendGlyph,
            static inputs => inputs.ChannelCount > 0),
        new ChecklistTaskDefinition(
            "try-command-palette",
            "checklist.tasks.commandPalette.title", "Try the command palette",
            "checklist.tasks.commandPalette.description", "Press Ctrl+K (or ⌘K) to jump anywhere instantly.",
            "checklist.tasks.commandPalette.cta", "Open",
            CommandPaletteTarget, KeyboardGlyph,
            static inputs => inputs.CommandPaletteDiscovered),
        new ChecklistTaskDefinition(
            "enable-push",
            "checklist.tasks.enablePush.title", "Enable web push notifications",
            "checklist.tasks.enablePush.description", "Get alerts in your browser even when TeslaSync is closed.",
            "checklist.tasks.enablePush.cta", "Enable",
            BrowserPushRoute, NotificationGlyph,
            static inputs => inputs.WebPushGranted),
        new ChecklistTaskDefinition(
            "customize-dashboard",
            "checklist.tasks.customizeDashboard.title", "Customize your dashboard",
            "checklist.tasks.customizeDashboard.description", "Add widgets that match how you use TeslaSync.",
            "checklist.tasks.customizeDashboard.cta", "Open",
            DashboardRoute, GridGlyph,
            static inputs => inputs.DashboardCustomized),
    };
}

/// <summary>
/// One projected, display-ready checklist row consumed by the WinUI view: the resolved completion,
/// the localized title/description/CTA label, the status + task glyphs, the CTA navigation target and
/// a Narrator automation name. Pure data — no WinUI types — so the projection is snapshot-tested.
/// </summary>
public sealed record ChecklistTaskView(
    string Id,
    string IconGlyph,
    string StatusGlyph,
    string Title,
    string Description,
    string CtaLabel,
    string CtaTarget,
    bool IsComplete,
    bool IsCommandPalette,
    string AutomationName);

/// <summary>
/// The fully-projected checklist: the display rows plus the derived counts the header renders. Mirrors
/// the web <c>ChecklistState</c>'s <c>visibleTasks</c>/<c>completeCount</c>/<c>totalCount</c>/
/// <c>allComplete</c> together with the <c>progressPct</c> the progress bar uses.
/// </summary>
public sealed record OnboardingChecklistSnapshot(
    IReadOnlyList<ChecklistTaskView> Tasks,
    int CompleteCount,
    int TotalCount,
    bool AllComplete,
    int ProgressPercent);

/// <summary>
/// Pure projection from <see cref="ChecklistInputs"/> to a display-ready
/// <see cref="OnboardingChecklistSnapshot"/> — the native port of the web <c>useChecklistTasks</c>
/// <c>useMemo</c> that builds the task list and the header counts. The localizer resolves every string
/// so no English literal reaches the view, and the progress percentage matches the web
/// <c>Math.round((complete / total) * 100)</c>.
/// </summary>
public static class OnboardingChecklistProjection
{
    private const string CompleteGlyph = "\uE930";   // Completed — web CheckCircle2
    private const string IncompleteGlyph = "\uECCA"; // RadioBtnOff — web Circle

    /// <summary>Project the seven task definitions against <paramref name="inputs"/> into display rows + counts.</summary>
    public static OnboardingChecklistSnapshot Project(ChecklistInputs inputs, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var definitions = ChecklistTaskDefinition.All;
        var rows = new List<ChecklistTaskView>(definitions.Count);
        int complete = 0;

        foreach (var def in definitions)
        {
            bool done = def.IsComplete(inputs);
            if (done)
            {
                complete++;
            }

            string title = localizer.GetString(def.TitleKey, def.TitleFallback);
            string description = localizer.GetString(def.DescriptionKey, def.DescriptionFallback);
            string cta = localizer.GetString(def.CtaKey, def.CtaFallback);

            rows.Add(new ChecklistTaskView(
                Id: def.Id,
                IconGlyph: def.IconGlyph,
                StatusGlyph: done ? CompleteGlyph : IncompleteGlyph,
                Title: title,
                Description: description,
                CtaLabel: cta,
                CtaTarget: def.CtaTarget,
                IsComplete: done,
                IsCommandPalette: string.Equals(def.CtaTarget, ChecklistTaskDefinition.CommandPaletteTarget, StringComparison.Ordinal),
                AutomationName: AutomationName(localizer, done, title, description)));
        }

        int total = rows.Count;
        int percent = total == 0
            ? 0
            : (int)Math.Round(complete / (double)total * 100, MidpointRounding.AwayFromZero);

        return new OnboardingChecklistSnapshot(rows, complete, total, total > 0 && complete == total, percent);
    }

    /// <summary>The "{{done}}/{{total}} complete" progress label, interpolated like the web i18n string.</summary>
    public static string FormatProgress(ILocalizer localizer, int done, int total)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("checklist.progress", "{{done}}/{{total}} complete")
            .Replace("{{done}}", done.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal)
            .Replace("{{total}}", total.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);
    }

    private static string AutomationName(ILocalizer localizer, bool complete, string title, string description)
    {
        string status = complete
            ? localizer.GetString("checklist.status.complete", "Completed")
            : localizer.GetString("checklist.status.incomplete", "Not completed");
        return string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", status, title, description);
    }
}

/// <summary>
/// The checklist's hide / celebrate policy — a 1:1 port of <c>shouldHideChecklist</c> and
/// <c>CELEBRATION_WINDOW_MS</c> in web/src/features/onboarding/checklist.ts. Kept pure (the clock is
/// injected) so the 24 h celebration boundary is unit-tested deterministically.
/// </summary>
public static class OnboardingChecklistVisibility
{
    /// <summary>How long the celebratory "all set" state stays visible after 100 % (web <c>CELEBRATION_WINDOW_MS</c> = 24 h).</summary>
    public static readonly TimeSpan CelebrationWindow = TimeSpan.FromHours(24);

    /// <summary>
    /// Whether the checklist should collapse to the small hidden/restart state: explicitly dismissed,
    /// or finished more than <see cref="CelebrationWindow"/> ago.
    /// </summary>
    public static bool ShouldHide(bool dismissed, bool allComplete, DateTimeOffset? completedAt, DateTimeOffset now)
    {
        if (dismissed)
        {
            return true;
        }

        if (allComplete && completedAt is { } stamped)
        {
            return now - stamped > CelebrationWindow;
        }

        return false;
    }
}

/// <summary>
/// The locally-tracked checklist state — the native analogue of the browser <c>localStorage</c> flags
/// and the theme the web hook reads. <see cref="ThemePicked"/>, <see cref="CommandPaletteDiscovered"/>,
/// <see cref="WebPushGranted"/> and <see cref="DashboardCustomized"/> feed task completion;
/// <see cref="Dismissed"/> and <see cref="CompletedAt"/> are the widget-owned control flags.
/// </summary>
public sealed record ChecklistLocalState(
    bool ThemePicked,
    bool CommandPaletteDiscovered,
    bool WebPushGranted,
    bool DashboardCustomized,
    bool Dismissed,
    DateTimeOffset? CompletedAt)
{
    /// <summary>The first-run state — nothing configured, not dismissed, never completed.</summary>
    public static ChecklistLocalState Empty { get; } = new(false, false, false, false, false, null);
}

/// <summary>
/// The persistence + signal seam the view-model binds to for the locally-tracked checklist state
/// (P1/S8 state holder). It reads the full <see cref="ChecklistLocalState"/>, lets the widget write the
/// two control flags it owns (dismiss / completion stamp), and raises <see cref="Changed"/> when any
/// flag changes — the native analogue of the web <c>CHECKLIST_CHANGED_EVENT</c> + <c>storage</c> +
/// focus listeners. The concrete app store is <c>ApplicationData.LocalSettings</c>-backed; tests and
/// headless callers use <see cref="InMemoryChecklistStateStore"/>.
/// </summary>
public interface IChecklistStateStore
{
    /// <summary>Raised whenever any tracked flag changes (this widget's writes or another surface's).</summary>
    event EventHandler? Changed;

    /// <summary>Read the current local checklist state.</summary>
    ChecklistLocalState Read();

    /// <summary>Persist whether the user has dismissed the checklist (web <c>setChecklistDismissed</c>).</summary>
    void SetDismissed(bool dismissed);

    /// <summary>Persist (or clear) the epoch the checklist first reached 100 % (web <c>setChecklistCompletedAt</c>).</summary>
    void SetCompletedAt(DateTimeOffset? completedAt);
}

/// <summary>
/// An in-memory <see cref="IChecklistStateStore"/> for unit tests and the headless fallback. It raises
/// <see cref="Changed"/> on every mutation so the view-model's re-read path is exercised without a
/// real settings store. Not durable.
/// </summary>
public sealed class InMemoryChecklistStateStore : IChecklistStateStore
{
    private ChecklistLocalState _state;

    /// <summary>Creates the store seeded with <paramref name="initial"/> (first-run defaults when omitted).</summary>
    public InMemoryChecklistStateStore(ChecklistLocalState? initial = null) =>
        _state = initial ?? ChecklistLocalState.Empty;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public ChecklistLocalState Read() => _state;

    /// <summary>Replace the externally-tracked signals (theme / palette / push / dashboard), raising <see cref="Changed"/>.</summary>
    public void SetSignals(bool? themePicked = null, bool? commandPaletteDiscovered = null, bool? webPushGranted = null, bool? dashboardCustomized = null)
    {
        _state = _state with
        {
            ThemePicked = themePicked ?? _state.ThemePicked,
            CommandPaletteDiscovered = commandPaletteDiscovered ?? _state.CommandPaletteDiscovered,
            WebPushGranted = webPushGranted ?? _state.WebPushGranted,
            DashboardCustomized = dashboardCustomized ?? _state.DashboardCustomized,
        };
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void SetDismissed(bool dismissed)
    {
        _state = _state with { Dismissed = dismissed };
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void SetCompletedAt(DateTimeOffset? completedAt)
    {
        _state = _state with { CompletedAt = completedAt };
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The three list lengths the API contributes to the checklist — the remote half of
/// <see cref="ChecklistInputs"/>. Parsing is null-tolerant: a missing or non-array payload counts as
/// zero, so a partial / failed read simply leaves the corresponding task incomplete (web parity:
/// <c>data?.length ?? 0</c>).
/// </summary>
public sealed record OnboardingChecklistRemoteCounts(int VehicleCount, int AlertRuleCount, int ChannelCount)
{
    /// <summary>A snapshot with all counts zero — the value used while the reads are still in flight.</summary>
    public static OnboardingChecklistRemoteCounts Zero { get; } = new(0, 0, 0);

    /// <summary>Count the elements of a JSON array payload, treating any non-array (null/object) as zero.</summary>
    public static int CountArray(JsonElement element) =>
        element.ValueKind == JsonValueKind.Array ? element.GetArrayLength() : 0;
}

/// <summary>
/// Combines the three independent cache-then-network reads (vehicles, alert rules, notification
/// channels) into one <see cref="RepositoryResult{T}"/> of counts. Because the web widget is
/// local-first — every read is "enrichment", none gates the surface — the combine keeps the
/// best-available counts on every emission and folds the per-read freshness into a single status:
/// still-loading until the first read settles, then loaded / cached(stale) / offline as the reads
/// degrade. Kept pure so the fold is unit-tested without a network or cache.
/// </summary>
public static class OnboardingChecklistResultMapper
{
    /// <summary>Combine the latest <paramref name="vehicles"/>, <paramref name="rules"/> and <paramref name="channels"/> emissions.</summary>
    public static RepositoryResult<OnboardingChecklistRemoteCounts> Combine(
        RepositoryResult<JsonElement> vehicles,
        RepositoryResult<JsonElement> rules,
        RepositoryResult<JsonElement> channels)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(channels);

        var parts = new[] { vehicles, rules, channels };

        var counts = new OnboardingChecklistRemoteCounts(
            CountOf(vehicles),
            CountOf(rules),
            CountOf(channels));

        // NB: RepositoryResult.HasValue is unreliable for the JsonElement payload (a struct is never
        // null), so the fold branches on Status — the same approach the shared DashboardStatsSource uses.
        int settled = 0;
        bool allError = true;
        bool inFlight = false;
        bool anyOffline = false;
        bool anyError = false;
        bool anyStale = false;
        RepositoryError? error = null;
        DateTimeOffset? fetchedAt = null;

        foreach (var part in parts)
        {
            if (part.Status is not LoadStatus.Loading)
            {
                settled++;
            }

            if (part.Status is not LoadStatus.Error)
            {
                allError = false;
            }

            switch (part.Status)
            {
                case LoadStatus.Loading:
                case LoadStatus.Refreshing:
                    inFlight = true;
                    break;
                case LoadStatus.Offline:
                    anyOffline = true;
                    error ??= part.Error;
                    break;
                case LoadStatus.Error:
                    anyError = true;
                    error ??= part.Error;
                    break;
                default:
                    break;
            }

            if (part.IsStale)
            {
                anyStale = true;
            }

            if (part.FetchedAt is { } at && (fetchedAt is null || at < fetchedAt))
            {
                fetchedAt = at;
            }
        }

        // Nothing has settled yet — every read is still on its first emission.
        if (settled == 0)
        {
            return RepositoryResult<OnboardingChecklistRemoteCounts>.Loading();
        }

        // Every read failed outright with no value to fall back to.
        if (allError)
        {
            return RepositoryResult<OnboardingChecklistRemoteCounts>.Failure(
                error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Checklist reads failed"));
        }

        var stamp = fetchedAt ?? DateTimeOffset.UtcNow;

        if (anyOffline)
        {
            return RepositoryResult<OnboardingChecklistRemoteCounts>.OfflineCached(
                counts, stamp, error ?? new RepositoryError(RepositoryErrorKind.Offline, "Offline"));
        }

        bool stale = anyStale || anyError;

        // A read is still settling — keep content visible while it refreshes.
        if (inFlight)
        {
            return RepositoryResult<OnboardingChecklistRemoteCounts>.Refreshing(counts, stamp, stale);
        }

        return stale
            ? RepositoryResult<OnboardingChecklistRemoteCounts>.Cached(counts, stamp, stale: true)
            : RepositoryResult<OnboardingChecklistRemoteCounts>.Loaded(counts, stamp);
    }

    private static int CountOf(RepositoryResult<JsonElement> part) =>
        part.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline
            ? OnboardingChecklistRemoteCounts.CountArray(part.Value)
            : 0;
}
