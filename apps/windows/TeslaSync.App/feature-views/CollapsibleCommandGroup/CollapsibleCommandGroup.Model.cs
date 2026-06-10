using System.Collections.Concurrent;
using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The command category a <c>CollapsibleCommandGroup</c> heads — the native mirror of the web
/// <c>CommandCategory</c> union (web/src/features/system/commands.ts). Each member's canonical wire
/// <see cref="CommandCategoryMetadata.SlugOf(CommandCategory)"/> reproduces the exact web string literal
/// (e.g. <c>climate_protection</c>) because that literal is part of the persisted expansion key
/// <c>teslasync-cat-{vehicleId}-{category}</c> — diverging would silently orphan a user's saved open/closed
/// state. The declaration order matches the web <c>CATEGORY_ORDER</c>.
/// </summary>
public enum CommandCategory
{
    /// <summary>Security &amp; Access (web <c>security</c>).</summary>
    Security,

    /// <summary>Climate &amp; Comfort (web <c>climate</c>).</summary>
    Climate,

    /// <summary>Climate Protection (web <c>climate_protection</c>).</summary>
    ClimateProtection,

    /// <summary>Charging (web <c>charging</c>).</summary>
    Charging,

    /// <summary>Doors &amp; Trunk (web <c>doors</c>).</summary>
    Doors,

    /// <summary>Drive (web <c>drive</c>).</summary>
    Drive,

    /// <summary>Windows (web <c>windows</c>).</summary>
    Windows,

    /// <summary>Sunroof (web <c>sunroof</c>).</summary>
    Sunroof,

    /// <summary>Schedules (web <c>schedules</c>).</summary>
    Schedules,

    /// <summary>Alerts &amp; Location (web <c>alerts</c>).</summary>
    Alerts,

    /// <summary>Navigation (web <c>navigation</c>).</summary>
    Navigation,

    /// <summary>Software (web <c>software</c>).</summary>
    Software,

    /// <summary>Vehicle (web <c>vehicle</c>).</summary>
    Vehicle,

    /// <summary>Media (web <c>media</c>).</summary>
    Media,
}

/// <summary>
/// The resolved presentation metadata for one <see cref="CommandCategory"/> — the native analogue of one entry
/// in the web <c>CATEGORY_META</c> map (web/src/features/system/commands.ts). <see cref="Slug"/> is the exact
/// web wire string (used in the persisted expansion key); <see cref="LabelKey"/> / <see cref="Fallback"/> are
/// the i18n key and English fallback the web feeds into <c>t(meta.labelKey, meta.fallback)</c>; and
/// <see cref="Glyph"/> is the Segoe Fluent code point standing in for the web Lucide icon. Pure data.
/// </summary>
/// <param name="Category">The category this entry describes.</param>
/// <param name="Slug">The canonical web wire string (e.g. <c>climate_protection</c>).</param>
/// <param name="LabelKey">The i18n key the header label resolves through (web <c>meta.labelKey</c>).</param>
/// <param name="Fallback">The English fallback for <see cref="LabelKey"/> (web <c>meta.fallback</c>).</param>
/// <param name="Glyph">The Segoe Fluent header glyph (stands in for the web Lucide <c>meta.icon</c>).</param>
public sealed record CommandCategoryInfo(
    CommandCategory Category,
    string Slug,
    string LabelKey,
    string Fallback,
    string Glyph);

/// <summary>
/// The canonical, WinUI-free registry of <see cref="CommandCategoryInfo"/> — the native port of the web
/// <c>CATEGORY_META</c> map and <c>CATEGORY_ORDER</c> array (web/src/features/system/commands.ts). The slugs
/// reproduce the web wire strings verbatim (they appear in the persisted expansion key); the label keys and
/// fallbacks are taken row-for-row from the web map; and each Lucide icon is mapped to a Segoe Fluent code point
/// already used elsewhere in the app. Unit-tested without a UI host.
/// </summary>
public static class CommandCategoryMetadata
{
    // Segoe Fluent code points (each already used by a sibling surface), mapped from the web Lucide icons.
    private const string LockGlyph = "\uE72E";          // web security (shield/lock)
    private const string ThermometerGlyph = "\uE9CA";   // web wind -> Climate & Comfort (temperature)
    private const string ShieldGlyph = "\uEA18";        // web securityAlert -> Climate Protection
    private const string LightningGlyph = "\uE945";     // web charging (Zap)
    private const string DoorGlyph = "\uE8D7";          // web doorOpen (door / hatch)
    private const string CarGlyph = "\uE804";           // web vehicle (Car)
    private const string AirflowGlyph = "\uEB3A";       // web wind -> Windows (airflow / Frigid)
    private const string UpGlyph = "\uE74A";            // web arrowUpFromDot (Up)
    private const string CalendarGlyph = "\uE787";      // web calendarPlus (Calendar)
    private const string RingerGlyph = "\uEA8F";        // web speaker -> Alerts (Ringer)
    private const string NavigationGlyph = "\uE81D";    // web navigation (location / navigation)
    private const string DownloadGlyph = "\uE896";      // web download (Download)
    private const string PlayGlyph = "\uE768";          // web play (Play)

    private static readonly IReadOnlyList<CommandCategoryInfo> Entries =
    [
        new(CommandCategory.Security, "security", "commands.cat.security", "Security & Access", LockGlyph),
        new(CommandCategory.Climate, "climate", "commands.cat.climate", "Climate & Comfort", ThermometerGlyph),
        new(CommandCategory.ClimateProtection, "climate_protection", "commands.cat.climateProtect", "Climate Protection", ShieldGlyph),
        new(CommandCategory.Charging, "charging", "commands.cat.charging", "Charging", LightningGlyph),
        new(CommandCategory.Doors, "doors", "commands.cat.doors", "Doors & Trunk", DoorGlyph),
        new(CommandCategory.Drive, "drive", "commands.cat.drive", "Drive", CarGlyph),
        new(CommandCategory.Windows, "windows", "commands.cat.windows", "Windows", AirflowGlyph),
        new(CommandCategory.Sunroof, "sunroof", "commands.cat.sunroof", "Sunroof", UpGlyph),
        new(CommandCategory.Schedules, "schedules", "commands.cat.schedules", "Schedules", CalendarGlyph),
        new(CommandCategory.Alerts, "alerts", "commands.cat.alerts", "Alerts & Location", RingerGlyph),
        new(CommandCategory.Navigation, "navigation", "commands.cat.navigation", "Navigation", NavigationGlyph),
        new(CommandCategory.Software, "software", "commands.cat.software", "Software", DownloadGlyph),
        new(CommandCategory.Vehicle, "vehicle", "commands.cat.vehicle", "Vehicle", CarGlyph),
        new(CommandCategory.Media, "media", "commands.cat.media", "Media", PlayGlyph),
    ];

    private static readonly Dictionary<CommandCategory, CommandCategoryInfo> ByCategory =
        Entries.ToDictionary(static e => e.Category);

    /// <summary>The categories in the web <c>CATEGORY_ORDER</c> sequence.</summary>
    public static IReadOnlyList<CommandCategory> Order { get; } =
        Entries.Select(static e => e.Category).ToArray();

    /// <summary>Resolve the metadata for <paramref name="category"/>.</summary>
    public static CommandCategoryInfo For(CommandCategory category) =>
        ByCategory.TryGetValue(category, out CommandCategoryInfo? info)
            ? info
            : throw new ArgumentOutOfRangeException(nameof(category), category, "Unknown command category.");

    /// <summary>The canonical web wire string for <paramref name="category"/> (e.g. <c>climate_protection</c>).</summary>
    public static string SlugOf(CommandCategory category) => For(category).Slug;
}

/// <summary>
/// The render-time data model the <c>CollapsibleCommandGroup</c> view binds to — the native analogue of the web
/// <c>CollapsibleCommandGroupProps</c> (web/src/features/system/components/CollapsibleCommandGroup.tsx). The web
/// <c>children</c> (the command tiles) are supplied to the view directly as WinUI elements and so are NOT part of
/// this pure-data model; everything that drives the header and the persisted open/closed state lives here. The
/// component is purely presentational — it has no fetch lifecycle (its only data source is <c>useTranslation</c>)
/// — so there is no loading / error / stale / offline branch to model; the only state is whether the group is
/// expanded, which is resolved from the session expansion store falling back to <see cref="DefaultOpen"/>. Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Category">The command category this group heads (web <c>category</c>).</param>
/// <param name="VehicleId">The owning vehicle id, part of the persisted expansion key (web <c>vehicleId</c>).</param>
/// <param name="Count">The number of commands in the group, shown as <c>(N)</c> (web <c>count</c>).</param>
/// <param name="DefaultOpen">Whether the group starts expanded when no saved state exists (web <c>defaultOpen</c>).</param>
public sealed record CollapsibleCommandGroupModel(
    CommandCategory Category,
    long VehicleId,
    int Count,
    bool DefaultOpen = false);

/// <summary>
/// The fully projected, render-ready view of one <c>CollapsibleCommandGroup</c> input — the native analogue of
/// everything the web component computes before returning JSX. Holds the localized <see cref="Label"/> (spoken in
/// its natural casing) and its upper-cased <see cref="DisplayLabel"/> (the web <c>uppercase</c> header), the
/// header <see cref="Glyph"/>, the parenthesised <see cref="CountText"/> (web <c>({count})</c>), the raw
/// <see cref="Count"/>, the persisted <see cref="StorageKey"/>, and the composed header
/// <see cref="AutomationName"/>. Pure data so every field is asserted headlessly.
/// </summary>
/// <param name="Label">The localized category label, spoken verbatim (web <c>t(meta.labelKey, meta.fallback)</c>).</param>
/// <param name="DisplayLabel">The upper-cased label shown in the header (web <c>uppercase</c>).</param>
/// <param name="Glyph">The Segoe Fluent header glyph (web <c>meta.icon</c>).</param>
/// <param name="Count">The command count (web <c>count</c>).</param>
/// <param name="CountText">The parenthesised count, e.g. <c>(5)</c> (web <c>({count})</c>).</param>
/// <param name="StorageKey">The persisted expansion key <c>teslasync-cat-{vehicleId}-{category}</c>.</param>
/// <param name="AutomationName">The composed Narrator name for the disclosure header.</param>
public sealed record CollapsibleCommandGroupDisplay(
    string Label,
    string DisplayLabel,
    string Glyph,
    int Count,
    string CountText,
    string StorageKey,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="CollapsibleCommandGroupModel"/> to its
/// <see cref="CollapsibleCommandGroupDisplay"/> — the native port of
/// web/src/features/system/components/CollapsibleCommandGroup.tsx. The header label resolves through the i18n
/// facade using the same key + fallback the web feeds into <c>t(meta.labelKey, meta.fallback)</c>; the count is
/// rendered ungrouped as <c>(N)</c> matching the web <c>({count})</c>; and the persisted expansion key reproduces
/// the web <c>teslasync-cat-${vehicleId}-${category}</c> verbatim (using the canonical category slug) so the
/// native and web clients address the same saved state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class CollapsibleCommandGroupProjection
{
    /// <summary>The persisted expansion key prefix (web <c>teslasync-cat-</c>).</summary>
    public const string StorageKeyPrefix = "teslasync-cat-";

    /// <summary>
    /// Build the persisted expansion key for a vehicle + category — the web
    /// <c>teslasync-cat-${vehicleId}-${category}</c>, where <c>category</c> is the canonical wire slug.
    /// </summary>
    public static string StorageKey(long vehicleId, CommandCategory category) =>
        string.Create(
            CultureInfo.InvariantCulture,
            $"{StorageKeyPrefix}{vehicleId}-{CommandCategoryMetadata.SlugOf(category)}");

    /// <summary>
    /// Resolve whether the group starts expanded — the web initial-state rule: use the saved value when one
    /// exists, otherwise fall back to <see cref="CollapsibleCommandGroupModel.DefaultOpen"/>.
    /// </summary>
    /// <param name="model">The render-time data model.</param>
    /// <param name="store">The session expansion store (the native analogue of the web <c>sessionStorage</c>).</param>
    public static bool ResolveInitialExpanded(
        CollapsibleCommandGroupModel model,
        ICommandGroupExpansionStore store)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(store);

        bool? stored = store.GetExpanded(StorageKey(model.VehicleId, model.Category));
        return stored ?? model.DefaultOpen;
    }

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props minus the children).</param>
    /// <param name="localizer">The i18n facade the header label resolves through.</param>
    public static CollapsibleCommandGroupDisplay Project(
        CollapsibleCommandGroupModel model,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        CommandCategoryInfo meta = CommandCategoryMetadata.For(model.Category);
        string label = localizer.GetString(meta.LabelKey, meta.Fallback);
        string displayLabel = label.ToUpper(CultureInfo.CurrentCulture);
        int count = Math.Max(0, model.Count);
        string countNumber = count.ToString(CultureInfo.CurrentCulture);
        string countText = string.Concat("(", countNumber, ")");

        // Reading order matches the web header (label then count); the disclosure's open/closed state is spoken
        // by the Expander control itself, so it is not duplicated into the name.
        string automationName = string.Create(CultureInfo.CurrentCulture, $"{label} {countText}");

        return new CollapsibleCommandGroupDisplay(
            Label: label,
            DisplayLabel: displayLabel,
            Glyph: meta.Glyph,
            Count: count,
            CountText: countText,
            StorageKey: StorageKey(model.VehicleId, model.Category),
            AutomationName: automationName);
    }
}

/// <summary>
/// The per-session expansion store a <c>CollapsibleCommandGroup</c> persists its open/closed state to — the
/// native seam standing in for the web component's <c>sessionStorage</c>
/// (web/src/features/system/components/CollapsibleCommandGroup.tsx). State is keyed by the web-compatible
/// <c>teslasync-cat-{vehicleId}-{category}</c> string and lives only for the lifetime of the app session, exactly
/// as a browser tab's session storage does. Abstracted as an interface so the view can be driven by an isolated
/// store in tests and a shared one in the app.
/// </summary>
public interface ICommandGroupExpansionStore
{
    /// <summary>The saved expanded state for <paramref name="key"/>, or null when nothing has been saved.</summary>
    bool? GetExpanded(string key);

    /// <summary>Persist the expanded state for <paramref name="key"/>.</summary>
    void SetExpanded(string key, bool expanded);
}

/// <summary>
/// The default in-memory <see cref="ICommandGroupExpansionStore"/> — the native analogue of the browser's
/// per-tab <c>sessionStorage</c>. Thread-safe (a <see cref="ConcurrentDictionary{TKey, TValue}"/>), process-scoped
/// (state is intentionally not persisted across app restarts, matching the web's session lifetime), and exposed as
/// a shared singleton so every group on a page shares one map. The view falls back to this when no store is
/// injected.
/// </summary>
public sealed class SessionCommandGroupExpansionStore : ICommandGroupExpansionStore
{
    private readonly ConcurrentDictionary<string, bool> _state = new(StringComparer.Ordinal);

    /// <summary>The shared, app-session-scoped store every group uses unless a different one is injected.</summary>
    public static SessionCommandGroupExpansionStore Shared { get; } = new();

    /// <inheritdoc />
    public bool? GetExpanded(string key)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        return _state.TryGetValue(key, out bool value) ? value : null;
    }

    /// <inheritdoc />
    public void SetExpanded(string key, bool expanded)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        _state[key] = expanded;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>CollapsibleCommandGroup</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never the vehicle id, category or command
/// count — so a diagnostics line can never identify a vehicle or reveal which command groups a user opens.
/// Thread-safe.
/// </summary>
public sealed class CollapsibleCommandGroupDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public CollapsibleCommandGroupDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CollapsibleCommandGroup</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CollapsibleCommandGroupRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>CollapsibleCommandGroup</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/system/components/CollapsibleCommandGroup.tsx</c>. Holds the diagnostics slug
/// emitted with the <c>view.opened</c> event. UI-free so the metadata is asserted in tests.
/// </summary>
public static class CollapsibleCommandGroupRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "CollapsibleCommandGroup";
}
