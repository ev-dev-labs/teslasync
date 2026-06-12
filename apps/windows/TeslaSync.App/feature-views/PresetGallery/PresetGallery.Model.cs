using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="PresetGalleryViewModel"/> can be in — the native
/// union of the branches the Preset-Gallery surface renders. The web component
/// (web/src/features/automations/pages/PresetGallery.tsx) reads <c>useAutomationPresets(category)</c> and
/// renders exactly three branches: a four-card skeleton grid while <c>isLoading</c>, a friendly
/// <c>EmptyState</c> when <c>presets.length === 0</c>, and the card grid otherwise. Because a native Windows
/// surface owns its own cache-then-network read (it is not a pure child fed a prop), it additionally renders
/// the full state matrix the P2 contract mandates: every value maps onto a visible surface (never a blank
/// panel). <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/> render the preset cards (the
/// last two with a freshness chip), <see cref="Empty"/> the friendly empty surface when there are no presets,
/// <see cref="Loading"/> the card skeletons and <see cref="Error"/> the retry affordance.
/// </summary>
public enum PresetGalleryState
{
    /// <summary>Initial fetch with no cached presets — render the card skeletons (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one preset — render the card grid.</summary>
    Loaded,

    /// <summary>No preset templates at all — render the friendly empty surface (web <c>presets.length === 0</c>).</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render the cards plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render the cards plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One automation preset template projected from the <c>/automations/presets</c> response (web
/// <c>AutomationPreset</c> in web/src/api/types.ts), reduced to the fields the web <c>PresetCard</c> reads: the
/// <c>id</c> (used to deep-link the builder), <c>name</c>, <c>description</c>, the <c>icon</c> key (mapped to a
/// glyph), the <c>kind</c> of the first trigger (used to pick the trigger label, web <c>preset.triggers[0]</c>)
/// and the number of actions (web <c>preset.actions.length</c>). Field names mirror the Go API's snake_case
/// wire shape. Pure data so the parse adapter is unit-tested without a network.
/// </summary>
/// <param name="Id">The preset id, deep-linked into the builder (web <c>?preset=${preset.id}</c>).</param>
/// <param name="Name">The preset display name.</param>
/// <param name="Description">The preset description (web <c>line-clamp-2</c> body).</param>
/// <param name="Icon">The icon key (web <c>preset.icon</c>, mapped via <see cref="PresetIconGlyphs"/>).</param>
/// <param name="FirstTriggerKind">The <c>kind</c> of the first trigger, or null when the preset has none.</param>
/// <param name="ActionCount">The number of actions the preset runs (web <c>preset.actions.length</c>).</param>
public sealed record AutomationPresetRow(
    string Id,
    string Name,
    string Description,
    string Icon,
    string? FirstTriggerKind,
    int ActionCount)
{
    /// <summary>
    /// Parse the <c>/automations/presets</c> payload into preset rows. The endpoint returns an object with a
    /// <c>presets</c> array (web <c>AutomationPresetsResponse</c>); a bare array is also accepted defensively.
    /// A null / non-object / missing-array body yields an empty list.
    /// </summary>
    /// <param name="root">The decoded response root element.</param>
    public static IReadOnlyList<AutomationPresetRow> ParseResponse(JsonElement root)
    {
        JsonElement array;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("presets", out var presets))
        {
            array = presets;
        }
        else if (root.ValueKind == JsonValueKind.Array)
        {
            array = root;
        }
        else
        {
            return Array.Empty<AutomationPresetRow>();
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AutomationPresetRow>();
        }

        var rows = new List<AutomationPresetRow>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                rows.Add(FromJson(item));
            }
        }

        return rows;
    }

    /// <summary>Parse one preset object, tolerating missing / non-string fields the same way the web reader does.</summary>
    /// <param name="element">A single preset object from the <c>presets</c> array.</param>
    public static AutomationPresetRow FromJson(JsonElement element)
    {
        return new AutomationPresetRow(
            Id: ReadString(element, "id") ?? string.Empty,
            Name: ReadString(element, "name") ?? string.Empty,
            Description: ReadString(element, "description") ?? string.Empty,
            Icon: ReadString(element, "icon") ?? string.Empty,
            FirstTriggerKind: ReadFirstTriggerKind(element),
            ActionCount: ArrayLength(element, "actions"));
    }

    private static string? ReadFirstTriggerKind(JsonElement element)
    {
        if (!element.TryGetProperty("triggers", out var triggers) || triggers.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var trigger in triggers.EnumerateArray())
        {
            if (trigger.ValueKind == JsonValueKind.Object)
            {
                return ReadString(trigger, "kind");
            }

            break;
        }

        return null;
    }

    private static int ArrayLength(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array
            ? value.GetArrayLength()
            : 0;

    private static string? ReadString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null,
        };
    }
}

/// <summary>
/// Maps a preset's first-trigger <c>kind</c> to the i18n key + English fallback the web <c>triggerLabels</c>
/// table uses (web/src/features/automations/pages/PresetGallery.tsx). The four trigger labels are
/// fallback-only on the web (no <c>automations.builder.trigger*</c> entries exist in the web locale, so
/// <c>t(key, fallback)</c> resolves to the fallback); this table reproduces that behaviour faithfully through
/// the i18n facade. UI-free so the mapping is asserted headlessly.
/// </summary>
public static class PresetTriggerLabels
{
    /// <summary>i18n key for the "no trigger configured" label (web <c>automations.builder.noTrigger</c>).</summary>
    public const string NoTriggerKey = "automations.builder.noTrigger";

    /// <summary>English fallback for <see cref="NoTriggerKey"/>.</summary>
    public const string NoTriggerFallback = "No trigger configured";

    /// <summary>
    /// Resolve the i18n key + fallback for a trigger <paramref name="kind"/>. Returns true with the schedule /
    /// event / geofence / signal label when the kind is one of the four known triggers, false otherwise (the
    /// caller then shows the "no trigger" label, mirroring the web <c>firstTrigger ? … : noTrigger</c>).
    /// </summary>
    /// <param name="kind">The first trigger's <c>kind</c> (web <c>AutomationTriggerKind</c>).</param>
    /// <param name="label">The resolved key + fallback when known.</param>
    public static bool TryResolve(string? kind, out (string Key, string Fallback) label)
    {
        switch (kind)
        {
            case "trigger_schedule":
                label = ("automations.builder.triggerSchedule", "Schedule");
                return true;
            case "trigger_event":
                label = ("automations.builder.triggerEvent", "Vehicle Event");
                return true;
            case "trigger_geofence":
                label = ("automations.builder.triggerGeofence", "Geofence");
                return true;
            case "trigger_signal":
                label = ("automations.builder.triggerSignal", "Signal Threshold");
                return true;
            default:
                label = (NoTriggerKey, NoTriggerFallback);
                return false;
        }
    }
}

/// <summary>
/// Maps a preset's <c>icon</c> key to a Segoe Fluent Icons glyph — the native analogue of the web
/// <c>iconMap</c> (Lucide icons) in web/src/features/automations/pages/PresetGallery.tsx. The web covers eight
/// keys (Shield, Moon, Sun, ShieldCheck, Lock, UserX, CarFront, Siren) and falls back to Shield for any
/// unknown key; this table mirrors that exact fallback. UI-free so the mapping is asserted headlessly.
/// </summary>
public static class PresetIconGlyphs
{
    /// <summary>The Shield glyph shown for the Shield key and as the unknown-key fallback (web <c>?? Shield</c>).</summary>
    public const string Shield = "\uEA18";

    /// <summary>Resolve the Segoe Fluent glyph for an <paramref name="icon"/> key (Shield for any unknown key).</summary>
    /// <param name="icon">The preset's icon key (web <c>preset.icon</c>).</param>
    public static string Resolve(string? icon) => icon switch
    {
        "Shield" => Shield,
        "ShieldCheck" => "\uEA0C",   // SecureApp — a verified-shield analogue
        "Moon" => "\uE708",          // QuietHours — crescent moon
        "Sun" => "\uE706",           // Brightness — sun
        "Lock" => "\uE72E",          // Lock
        "UserX" => "\uE8F8",         // BlockContact — barred user
        "CarFront" => "\uE804",      // Vehicle front
        "Siren" => "\uEA8F",         // IncidentTriangle — alarm
        _ => Shield,
    };
}

/// <summary>
/// One projected preset card — the native analogue of the web <c>PresetCard</c> (icon + name + trigger label +
/// action-count chip + description + Install button). Every string is already localized and ready to render;
/// <see cref="AutomationName"/> is the composed Narrator name. Pure data.
/// </summary>
/// <param name="Id">The preset id, deep-linked into the builder when Install is invoked.</param>
/// <param name="Name">The preset display name (em-dash when the source name is blank).</param>
/// <param name="Description">The preset description body.</param>
/// <param name="IconGlyph">The Segoe Fluent glyph for the preset's icon key.</param>
/// <param name="TriggerLabel">The localized first-trigger label (or "No trigger configured").</param>
/// <param name="ActionCountLabel">The localized, interpolated "{count} actions" chip text.</param>
/// <param name="InstallLabel">The localized Install button label.</param>
/// <param name="AutomationName">The composed Narrator name for the card.</param>
public sealed record PresetCardModel(
    string Id,
    string Name,
    string Description,
    string IconGlyph,
    string TriggerLabel,
    string ActionCountLabel,
    string InstallLabel,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Preset-Gallery surface — the localized preset cards the web
/// component lays out in its responsive 1/2/3/4-column grid. <see cref="HasData"/> is the empty gate (true
/// when there is at least one preset). Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="Cards">The projected preset cards, in source order.</param>
/// <param name="HasData">True when there is at least one preset to show (gates the empty state).</param>
public sealed record PresetGalleryDisplay(
    IReadOnlyList<PresetCardModel> Cards,
    bool HasData);

/// <summary>
/// Pure projection from the parsed preset rows to the render-ready <see cref="PresetGalleryDisplay"/> — the
/// native port of the render logic in web/src/features/automations/pages/PresetGallery.tsx. Each card resolves
/// its icon glyph (<see cref="PresetIconGlyphs"/>), its first-trigger label (<see cref="PresetTriggerLabels"/>,
/// falling back to "No trigger configured"), and its action-count chip by interpolating the localized
/// <c>{{count}} actions</c> template the same way the web <c>t()</c> call does. Every label resolves through
/// the i18n facade using the keys the web source passes to <c>t()</c>. WinUI-free — unit-tested without a UI
/// host.
/// </summary>
public static class PresetGalleryProjection
{
    /// <summary>The em-dash shown for a blank preset name.</summary>
    public const string EmDash = "\u2014";

    /// <summary>i18n key for the action-count chip (web <c>automations.presets.actionCount</c>).</summary>
    public const string ActionCountKey = "automations.presets.actionCount";

    /// <summary>English fallback / template for <see cref="ActionCountKey"/> (carries the <c>{{count}}</c> token).</summary>
    public const string ActionCountFallback = "{{count}} actions";

    /// <summary>i18n key for the Install button (web <c>automations.presets.install</c>).</summary>
    public const string InstallKey = "automations.presets.install";

    /// <summary>English fallback for <see cref="InstallKey"/>.</summary>
    public const string InstallFallback = "Install";

    /// <summary>i18n key for the empty-state message (web <c>automations.presets.empty</c>).</summary>
    public const string EmptyKey = "automations.presets.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "No preset templates available";

    /// <summary>The i18next count token replaced when interpolating <see cref="ActionCountKey"/>.</summary>
    public const string CountToken = "{{count}}";

    /// <summary>Project <paramref name="presets"/> into the localized display (one card per preset).</summary>
    /// <param name="presets">The parsed preset rows.</param>
    /// <param name="localizer">The i18n facade every card label resolves through.</param>
    public static PresetGalleryDisplay Project(IReadOnlyList<AutomationPresetRow> presets, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(presets);
        ArgumentNullException.ThrowIfNull(localizer);

        var cards = new List<PresetCardModel>(presets.Count);
        foreach (var preset in presets)
        {
            cards.Add(ProjectCard(preset, localizer));
        }

        return new PresetGalleryDisplay(cards, cards.Count > 0);
    }

    /// <summary>Project one preset row into a render-ready card.</summary>
    /// <param name="preset">The parsed preset row.</param>
    /// <param name="localizer">The i18n facade the card labels resolve through.</param>
    public static PresetCardModel ProjectCard(AutomationPresetRow preset, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(preset);
        ArgumentNullException.ThrowIfNull(localizer);

        string name = string.IsNullOrWhiteSpace(preset.Name) ? EmDash : preset.Name;
        string glyph = PresetIconGlyphs.Resolve(preset.Icon);
        string triggerLabel = TriggerLabelText(preset.FirstTriggerKind, localizer);
        string actionCount = ActionCountText(preset.ActionCount, localizer);
        string install = localizer.GetString(PresetGalleryRegistration.CatalogKey(InstallKey), InstallFallback);
        string automationName = ComposeAutomationName(name, triggerLabel, actionCount);

        return new PresetCardModel(
            Id: preset.Id,
            Name: name,
            Description: preset.Description,
            IconGlyph: glyph,
            TriggerLabel: triggerLabel,
            ActionCountLabel: actionCount,
            InstallLabel: install,
            AutomationName: automationName);
    }

    /// <summary>The localized first-trigger label, or "No trigger configured" (web <c>firstTrigger ? … : noTrigger</c>).</summary>
    /// <param name="kind">The first trigger's <c>kind</c>, or null.</param>
    /// <param name="localizer">The i18n facade.</param>
    public static string TriggerLabelText(string? kind, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (!string.IsNullOrEmpty(kind) && PresetTriggerLabels.TryResolve(kind, out var label))
        {
            return localizer.GetString(PresetGalleryRegistration.CatalogKey(label.Key), label.Fallback);
        }

        return localizer.GetString(
            PresetGalleryRegistration.CatalogKey(PresetTriggerLabels.NoTriggerKey),
            PresetTriggerLabels.NoTriggerFallback);
    }

    /// <summary>The localized, interpolated action-count chip (web <c>t('…actionCount', { count })</c>).</summary>
    /// <param name="count">The number of actions.</param>
    /// <param name="localizer">The i18n facade.</param>
    public static string ActionCountText(int count, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string template = localizer.GetString(PresetGalleryRegistration.CatalogKey(ActionCountKey), ActionCountFallback);
        return template.Replace(CountToken, count.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);
    }

    private static string ComposeAutomationName(string name, string triggerLabel, string actionCount) =>
        string.Create(CultureInfo.CurrentCulture, $"{name}. {triggerLabel}. {actionCount}");
}

/// <summary>
/// The resolved "install this preset" navigation intent — the native analogue of the web
/// <c>navigate(`/automations/new?preset=${preset.id}`)</c> the Install button fires
/// (web/src/features/automations/pages/PresetGallery.tsx). Holds the canonical native <see cref="RoutePath"/>
/// the shell navigator resolves (no leading slash, matches the route table's <c>AutomationBuilder</c> entry
/// <c>automations/new</c>), the preserved <see cref="Search"/> query carrying the preset id, and the web-parity
/// absolute <see cref="Href"/> for deep-link parity assertions. Pure data, asserted headlessly.
/// </summary>
/// <param name="PresetId">The preset id being installed.</param>
/// <param name="RoutePath">The native builder route path with no leading slash (<c>automations/new</c>).</param>
/// <param name="Search">The preserved query carrying the preset id (<c>?preset={id}</c>).</param>
/// <param name="Href">The web-parity absolute target (<c>/automations/new?preset={id}</c>).</param>
public sealed record PresetInstallTarget(string PresetId, string RoutePath, string Search, string Href);

/// <summary>
/// The navigation port the Preset-Gallery surface drives when an Install button is invoked (the native
/// analogue of the web <c>useNavigate()</c> call). A shell adapter performs the actual navigation to
/// <see cref="PresetInstallTarget.RoutePath"/> (carrying <see cref="PresetInstallTarget.Search"/>); a test fake
/// records the requested target. Keeping navigation behind this seam keeps the view free of any router
/// dependency and lets the install logic be asserted headlessly.
/// </summary>
public interface IPresetGalleryNavigator
{
    /// <summary>Navigate to the automation builder pre-filled with <paramref name="target"/>'s preset.</summary>
    /// <param name="target">The resolved install navigation intent.</param>
    void OpenBuilder(PresetInstallTarget target);
}

/// <summary>
/// Canonical metadata for the Preset-Gallery feature surface — the native mirror of the web component at
/// web/src/features/automations/pages/PresetGallery.tsx. Pins the stable surface id, the category, the
/// diagnostics slug and the builder deep-link route the Install button targets. UI-free so the metadata is
/// asserted headlessly.
/// </summary>
public static class PresetGalleryRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "preset-gallery";

    /// <summary>Surface category.</summary>
    public const string Category = "automations";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "PresetGallery";

    /// <summary>The native builder route path (no leading slash — matches the route table's <c>automations/new</c>).</summary>
    public const string BuilderRoutePath = "automations/new";

    /// <summary>The web-style absolute builder target prefix (web <c>`/automations/new?preset=${id}`</c>).</summary>
    public const string BuilderHrefPrefix = "/automations/new";

    /// <summary>The query parameter carrying the preset id (web <c>?preset=</c>).</summary>
    public const string PresetQueryParam = "preset";

    /// <summary>
    /// The i18n namespace every generated <c>Strings/*.resw</c> resource key carries. The web i18n key
    /// <c>foo.bar</c> (ported verbatim from <c>web/src/i18n</c>) is emitted into the native catalog as
    /// <c>translation.foo.bar</c> — apps/shared/i18n keys the neutral catalog by
    /// <c>translation.&lt;dotted.key&gt;</c> (ADR-014). Resolution prepends this so labels bind to the
    /// catalog (every locale) instead of falling back to the English default.
    /// </summary>
    public const string CatalogNamespace = "translation.";

    /// <summary>Map a web i18n key (ported verbatim) to its generated <c>.resw</c> resource key.</summary>
    /// <param name="webKey">The web <c>t()</c> key, e.g. <c>automations.presets.install</c>.</param>
    public static string CatalogKey(string webKey)
    {
        ArgumentNullException.ThrowIfNull(webKey);
        return string.Concat(CatalogNamespace, webKey);
    }

    /// <summary>
    /// Build the install navigation intent for a preset, mirroring the web
    /// <c>navigate(`/automations/new?preset=${presetId}`)</c> exactly (no extra encoding — preset ids are
    /// slug-safe and the web does not encode them either).
    /// </summary>
    /// <param name="presetId">The preset id to deep-link into the builder.</param>
    public static PresetInstallTarget BuildInstallTarget(string presetId)
    {
        ArgumentNullException.ThrowIfNull(presetId);

        string search = string.Create(CultureInfo.InvariantCulture, $"?{PresetQueryParam}={presetId}");
        return new PresetInstallTarget(presetId, BuilderRoutePath, search, BuilderHrefPrefix + search);
    }
}

/// <summary>
/// The cache-then-network result mapper for the Preset-Gallery surface. Maps a
/// <see cref="RepositoryResult{T}"/> of raw <see cref="JsonElement"/> into a
/// <see cref="RepositoryResult{T}"/> of parsed <see cref="AutomationPresetRow"/> list, preserving every
/// freshness flag (cached / refreshing / stale / offline) so the view-model can render the full state matrix.
/// Pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class PresetGalleryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">One raw cache-then-network emission.</param>
    public static RepositoryResult<IReadOnlyList<AutomationPresetRow>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<AutomationPresetRow> Parse() =>
            raw.HasValue ? AutomationPresetRow.ParseResponse(raw.Value) : Array.Empty<AutomationPresetRow>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<AutomationPresetRow>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// PII-safe diagnostics for the Preset-Gallery surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a preset id, name or action count — so a
/// diagnostics line can never leak automation-template data. Thread-safe.
/// </summary>
public sealed class PresetGalleryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public PresetGalleryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PresetGallery</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PresetGalleryRegistration.Slug}");
    }
}
