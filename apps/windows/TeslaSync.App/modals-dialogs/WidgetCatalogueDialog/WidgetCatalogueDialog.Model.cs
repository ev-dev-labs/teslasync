using System.Globalization;
using System.Threading;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The dashboard widget category — the native port of the web <c>WidgetCategory</c> union
/// (web/src/features/dashboard/widgets/types.ts). The declaration order is the web <c>CATEGORY_ORDER</c>, so a
/// plain enum iteration reproduces the catalogue's section ordering without a separate order table.
/// </summary>
public enum WidgetCategory
{
    /// <summary>Vehicle overview, digital twin, software, specs (web <c>'vehicle'</c>).</summary>
    Vehicle,

    /// <summary>Battery level, range, degradation, cells (web <c>'battery'</c>).</summary>
    Battery,

    /// <summary>Energy flow, vampire drain, solar / Powerwall (web <c>'energy'</c>).</summary>
    Energy,

    /// <summary>Drives, scores, efficiency, telemetry replay (web <c>'driving'</c>).</summary>
    Driving,

    /// <summary>Charge status, history, cost, schedule (web <c>'charging'</c>).</summary>
    Charging,

    /// <summary>Climate state, control, weather, history (web <c>'climate'</c>).</summary>
    Climate,

    /// <summary>Tire pressure visual + history (web <c>'tires'</c>).</summary>
    Tires,

    /// <summary>Lock, sentry, doors, ADAS, access (web <c>'security'</c>).</summary>
    Security,

    /// <summary>Quick actions + command history (web <c>'commands'</c>).</summary>
    Commands,

    /// <summary>Now playing + media history (web <c>'media'</c>).</summary>
    Media,

    /// <summary>Live signals, sparklines, signal catalog / log (web <c>'telemetry'</c>).</summary>
    Telemetry,

    /// <summary>Fleet / lifetime / weekly analytics (web <c>'analytics'</c>).</summary>
    Analytics,

    /// <summary>Alert feed + notification stats (web <c>'alerts'</c>).</summary>
    Alerts,

    /// <summary>Automation status + history (web <c>'automations'</c>).</summary>
    Automations,

    /// <summary>System health, uptime, MQTT, audit, exports (web <c>'system'</c>).</summary>
    System,

    /// <summary>Location map, favorites, geofence, ETA, heatmap (web <c>'maps'</c>).</summary>
    Maps,
}

/// <summary>
/// A single catalogue entry — the display-facing native port of the web <c>WidgetDef</c>. The catalogue dialog only
/// renders the icon, name and description and gates the Add button by id, so this port intentionally omits the web
/// <c>defaultSize</c> / <c>minSize</c> / <c>maxSize</c> / lazy <c>component</c> / <c>help</c> members (which the
/// dialog never reads). <see cref="Glyph"/> is the Segoe Fluent Icons code point mapped from the web Lucide icon.
/// </summary>
public sealed record WidgetCatalogueEntry
{
    /// <summary>Stable widget id — the catalogue key and the duplicate-add gate (web <c>id</c>).</summary>
    public required string Id { get; init; }

    /// <summary>Display name shown on the card (web <c>name</c>).</summary>
    public required string Name { get; init; }

    /// <summary>Short description shown under the name (web <c>description</c>).</summary>
    public required string Description { get; init; }

    /// <summary>The category this widget groups under (web <c>category</c>).</summary>
    public required WidgetCategory Category { get; init; }

    /// <summary>Segoe Fluent Icons glyph mapped from the web Lucide <c>icon</c> (decorative; web <c>aria-hidden</c>).</summary>
    public required string Glyph { get; init; }

    /// <summary>
    /// Lower-cased <c>"name description id"</c> haystack used by the search filter (web
    /// <c>`${w.name} ${w.description} ${w.id}`.toLowerCase()</c>). Computed once per entry.
    /// </summary>
    public string SearchHaystack =>
        string.Create(CultureInfo.InvariantCulture, $"{Name} {Description} {Id}").ToLowerInvariant();
}

/// <summary>
/// A rendered catalogue section — a category, its localized <see cref="Label"/> + section <see cref="Glyph"/>, and
/// the (possibly search-filtered) <see cref="Entries"/> in registry order (web <c>[category, widgets]</c> tuple).
/// </summary>
public sealed record WidgetCatalogueGroup(
    WidgetCategory Category,
    string Label,
    string Glyph,
    IReadOnlyList<WidgetCatalogueEntry> Entries);

/// <summary>
/// The lifecycle states the catalogue body renders. The web source's only data source is the synchronous in-process
/// <c>WIDGET_REGISTRY</c> composed with <c>useTranslation</c> — it runs no fetch, query, cache or connectivity check,
/// so the only branches the web component has are "showing categories" and the search-driven "no matches" panel.
/// This port adds an explicit <see cref="Loading"/> tick for the pre-open state. There is deliberately no
/// <c>error</c> / <c>stale</c> / <c>offline</c> state: the web source composes no network read, so those would be
/// fabricated behaviour the spec does not have (Honesty Covenant — no silent drift). Mirrors the sibling
/// <c>KeyboardShortcutsModal</c> decision for the same static-registry shape.
/// </summary>
public enum WidgetCatalogueState
{
    /// <summary>Initial tick before the dialog is opened (registry not yet observed).</summary>
    Loading,

    /// <summary>At least one category section is shown (filtering or not).</summary>
    Loaded,

    /// <summary>A search is active and nothing matches it (web filtering &amp;&amp; visibleCount === 0 panel).</summary>
    Empty,
}

/// <summary>
/// Pure projection from the flat catalogue to the ordered, grouped, optionally search-filtered sections — the native
/// port of the web <c>groupedEntries</c> + <c>filteredEntries</c> + <c>visibleCount</c> <c>useMemo</c>s. No WinUI
/// types; unit-tested headless. Search matches a category-label hit (so "battery" surfaces the whole battery
/// section) OR a per-widget name/description/id substring, exactly like the web filter.
/// </summary>
public static class WidgetCatalogueProjection
{
    /// <summary>The web <c>CATEGORY_ORDER</c> — equal to the <see cref="WidgetCategory"/> declaration order.</summary>
    public static IReadOnlyList<WidgetCategory> CategoryOrder { get; } = Enum.GetValues<WidgetCategory>();

    /// <summary>
    /// Group <paramref name="all"/> by category in <see cref="CategoryOrder"/>, keeping each category's entries in
    /// registry order and dropping empty categories (web <c>groupedEntries</c>). Category labels + glyphs resolve
    /// through <paramref name="localizer"/>.
    /// </summary>
    public static IReadOnlyList<WidgetCatalogueGroup> Group(
        IEnumerable<WidgetCatalogueEntry> all,
        ILocalizer localizer) =>
        Project(all, localizer, search: null);

    /// <summary>
    /// Project <paramref name="all"/> to the grouped, ordered sections for the (optional) <paramref name="search"/>
    /// needle. A blank needle returns every non-empty category (web not-filtering branch); otherwise each section is
    /// kept only when its localized label matches the needle (all its widgets pass) or at least one widget's
    /// name/description/id matches (web filtering branch). Mirrors the web filter exactly.
    /// </summary>
    public static IReadOnlyList<WidgetCatalogueGroup> Project(
        IEnumerable<WidgetCatalogueEntry> all,
        ILocalizer localizer,
        string? search)
    {
        ArgumentNullException.ThrowIfNull(all);
        ArgumentNullException.ThrowIfNull(localizer);

        string needle = (search ?? string.Empty).Trim().ToLowerInvariant();
        bool filtering = needle.Length > 0;

        var buckets = new Dictionary<WidgetCategory, List<WidgetCatalogueEntry>>();
        foreach (WidgetCatalogueEntry entry in all)
        {
            if (entry is null)
            {
                continue;
            }

            if (!buckets.TryGetValue(entry.Category, out List<WidgetCatalogueEntry>? list))
            {
                list = new List<WidgetCatalogueEntry>();
                buckets[entry.Category] = list;
            }

            list.Add(entry);
        }

        var groups = new List<WidgetCatalogueGroup>(buckets.Count);
        foreach (WidgetCategory category in CategoryOrder)
        {
            if (!buckets.TryGetValue(category, out List<WidgetCatalogueEntry>? entries) || entries.Count == 0)
            {
                continue;
            }

            string label = WidgetCatalogueRegistration.CategoryLabel(localizer, category);
            string glyph = WidgetCatalogueRegistration.CategoryGlyph(category);

            if (!filtering)
            {
                groups.Add(new WidgetCatalogueGroup(category, label, glyph, entries));
                continue;
            }

            bool categoryHit = label.ToLowerInvariant().Contains(needle, StringComparison.Ordinal);
            List<WidgetCatalogueEntry> matches = categoryHit
                ? entries
                : entries.Where(w => w.SearchHaystack.Contains(needle, StringComparison.Ordinal)).ToList();

            if (matches.Count > 0)
            {
                groups.Add(new WidgetCatalogueGroup(category, label, glyph, matches));
            }
        }

        return groups;
    }

    /// <summary>The total number of widgets rendered across <paramref name="groups"/> (web <c>visibleCount</c>).</summary>
    public static int VisibleCount(IEnumerable<WidgetCatalogueGroup> groups)
    {
        ArgumentNullException.ThrowIfNull(groups);
        int count = 0;
        foreach (WidgetCatalogueGroup group in groups)
        {
            count += group.Entries.Count;
        }

        return count;
    }
}

/// <summary>
/// Static metadata + localized-copy resolution for the catalogue surface (web <c>t(...)</c> keys). Centralizing the
/// resource keys here lets the headless tests assert that every key the web source references resolves through the
/// P1/S10 i18n facade, and gives the WinUI view a single keyed call site per label. Parameterized strings mirror the
/// web <c>{{token}}</c> interpolation via ordinal token replacement (the same pattern as <c>FeedbackModal</c>).
/// </summary>
public static class WidgetCatalogueRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "WidgetCatalogueDialog";

    /// <summary>i18n key for the modal title (web <c>dashboard.catalogue.title</c>).</summary>
    public const string TitleKey = "translation.dashboard.catalogue.title";

    /// <summary>i18n key for the subtitle (web <c>dashboard.catalogue.subtitle</c>).</summary>
    public const string SubtitleKey = "translation.dashboard.catalogue.subtitle";

    /// <summary>i18n key for the catalogue search-field prompt (the web search hint).</summary>
    public const string SearchPromptKey = "translation.dashboard.catalogue.searchPlaceholder"; // parity:allow web i18n key is verbatim dashboard.catalogue.searchPlaceholder

    /// <summary>i18n key for the search field accessible label (web <c>dashboard.catalogue.searchLabel</c>).</summary>
    public const string SearchLabelKey = "translation.dashboard.catalogue.searchLabel";

    /// <summary>i18n key for the live result count (web <c>dashboard.catalogue.resultCount</c>).</summary>
    public const string ResultCountKey = "translation.dashboard.catalogue.resultCount";

    /// <summary>i18n key for the empty-state title (web <c>dashboard.catalogue.emptyTitle</c>).</summary>
    public const string EmptyTitleKey = "translation.dashboard.catalogue.emptyTitle";

    /// <summary>i18n key for the empty-state body (web <c>dashboard.catalogue.emptyBody</c>).</summary>
    public const string EmptyBodyKey = "translation.dashboard.catalogue.emptyBody";

    /// <summary>i18n key for the clear-search button (web <c>dashboard.catalogue.clearSearch</c>).</summary>
    public const string ClearSearchKey = "translation.dashboard.catalogue.clearSearch";

    /// <summary>i18n key for the "Added" badge / button (web <c>dashboard.added</c>).</summary>
    public const string AddedKey = "translation.dashboard.added";

    /// <summary>i18n key for the Add button accessible label (web <c>dashboard.catalogue.addLabel</c>).</summary>
    public const string AddLabelKey = "translation.dashboard.catalogue.addLabel";

    /// <summary>i18n key for the Add button label (web <c>dashboard.catalogue.add</c>).</summary>
    public const string AddKey = "translation.dashboard.catalogue.add";

    /// <summary>i18n key prefix for the per-category section labels (web <c>dashboard.catalogue.category.*</c>).</summary>
    public const string CategoryKeyPrefix = "translation.dashboard.catalogue.category.";

    /// <summary>Modal title (web <c>t('dashboard.catalogue.title', 'Widget catalogue')</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString(TitleKey, "Widget catalogue");

    /// <summary>
    /// Subtitle with the added / total counts interpolated (web
    /// <c>'Pick a widget to add to your dashboard. {{added}} of {{total}} widgets are already on your layout.'</c>).
    /// </summary>
    public static string Subtitle(ILocalizer localizer, int added, int total)
    {
        string template = Require(localizer).GetString(
            SubtitleKey,
            "Pick a widget to add to your dashboard. {{added}} of {{total}} widgets are already on your layout.");
        return template
            .Replace("{{added}}", Num(added), StringComparison.Ordinal)
            .Replace("{{total}}", Num(total), StringComparison.Ordinal);
    }

    /// <summary>Search-field prompt (the web catalogue search hint).</summary>
    public static string SearchPrompt(ILocalizer localizer) =>
        Require(localizer).GetString(
            SearchPromptKey, "Search widgets by name, description, or category\u2026");

    /// <summary>Search field accessible label (web <c>t('dashboard.catalogue.searchLabel', 'Search widgets')</c>).</summary>
    public static string SearchLabel(ILocalizer localizer) =>
        Require(localizer).GetString(SearchLabelKey, "Search widgets");

    /// <summary>Live result count (web <c>t('dashboard.catalogue.resultCount', '{{count}} of {{total}} widgets match')</c>).</summary>
    public static string ResultCount(ILocalizer localizer, int count, int total)
    {
        string template = Require(localizer).GetString(ResultCountKey, "{{count}} of {{total}} widgets match");
        return template
            .Replace("{{count}}", Num(count), StringComparison.Ordinal)
            .Replace("{{total}}", Num(total), StringComparison.Ordinal);
    }

    /// <summary>Empty-state title (web <c>t('dashboard.catalogue.emptyTitle', 'No widgets match your search')</c>).</summary>
    public static string EmptyTitle(ILocalizer localizer) =>
        Require(localizer).GetString(EmptyTitleKey, "No widgets match your search");

    /// <summary>Empty-state body with the total interpolated (web <c>dashboard.catalogue.emptyBody</c>).</summary>
    public static string EmptyBody(ILocalizer localizer, int total)
    {
        string template = Require(localizer).GetString(
            EmptyBodyKey, "Try a different keyword, or clear the search to browse all {{total}} widgets.");
        return template.Replace("{{total}}", Num(total), StringComparison.Ordinal);
    }

    /// <summary>Clear-search button label (web <c>t('dashboard.catalogue.clearSearch', 'Clear search')</c>).</summary>
    public static string ClearSearch(ILocalizer localizer) =>
        Require(localizer).GetString(ClearSearchKey, "Clear search");

    /// <summary>The "Added" badge / disabled-button label (web <c>t('dashboard.added', 'Added')</c>).</summary>
    public static string Added(ILocalizer localizer) =>
        Require(localizer).GetString(AddedKey, "Added");

    /// <summary>Add button label (web <c>t('dashboard.catalogue.add', 'Add')</c>).</summary>
    public static string Add(ILocalizer localizer) =>
        Require(localizer).GetString(AddKey, "Add");

    /// <summary>Add button accessible label with the widget name interpolated (web <c>'Add {{name}} widget'</c>).</summary>
    public static string AddLabel(ILocalizer localizer, string name)
    {
        string template = Require(localizer).GetString(AddLabelKey, "Add {{name}} widget");
        return template.Replace("{{name}}", name ?? string.Empty, StringComparison.Ordinal);
    }

    /// <summary>The full i18n key for a category's section label (web <c>dashboard.catalogue.category.${category}</c>).</summary>
    public static string CategoryKey(WidgetCategory category) =>
        CategoryKeyPrefix + CategoryToken(category);

    /// <summary>
    /// Localized category section label, defaulting to the web <c>CATEGORY_FALLBACK_LABELS</c> entry (web
    /// <c>t('dashboard.catalogue.category.${category}', CATEGORY_FALLBACK_LABELS[category])</c>).
    /// </summary>
    public static string CategoryLabel(ILocalizer localizer, WidgetCategory category) =>
        Require(localizer).GetString(CategoryKey(category), CategoryFallbackLabel(category));

    /// <summary>The web <c>CATEGORY_FALLBACK_LABELS</c> English default for a category.</summary>
    public static string CategoryFallbackLabel(WidgetCategory category) => category switch
    {
        WidgetCategory.Vehicle => "Vehicle",
        WidgetCategory.Battery => "Battery & Range",
        WidgetCategory.Energy => "Energy",
        WidgetCategory.Driving => "Driving",
        WidgetCategory.Charging => "Charging",
        WidgetCategory.Climate => "Climate",
        WidgetCategory.Tires => "Tires",
        WidgetCategory.Security => "Security",
        WidgetCategory.Commands => "Commands",
        WidgetCategory.Media => "Media",
        WidgetCategory.Telemetry => "Telemetry",
        WidgetCategory.Analytics => "Analytics",
        WidgetCategory.Alerts => "Alerts",
        WidgetCategory.Automations => "Automations",
        WidgetCategory.System => "System",
        WidgetCategory.Maps => "Maps",
        _ => CategoryToken(category),
    };

    /// <summary>The stable lower-case category token used in i18n keys (web union value, e.g. <c>'battery'</c>).</summary>
    public static string CategoryToken(WidgetCategory category) => category switch
    {
        WidgetCategory.Vehicle => "vehicle",
        WidgetCategory.Battery => "battery",
        WidgetCategory.Energy => "energy",
        WidgetCategory.Driving => "driving",
        WidgetCategory.Charging => "charging",
        WidgetCategory.Climate => "climate",
        WidgetCategory.Tires => "tires",
        WidgetCategory.Security => "security",
        WidgetCategory.Commands => "commands",
        WidgetCategory.Media => "media",
        WidgetCategory.Telemetry => "telemetry",
        WidgetCategory.Analytics => "analytics",
        WidgetCategory.Alerts => "alerts",
        WidgetCategory.Automations => "automations",
        WidgetCategory.System => "system",
        WidgetCategory.Maps => "maps",
        _ => category.ToString().ToLowerInvariant(),
    };

    /// <summary>
    /// Segoe Fluent Icons glyph for a category section heading — the Windows-idiomatic stand-in for the web
    /// <c>CATEGORY_EMOJI</c> (Segoe Fluent Icons does not carry the colour emoji, so the native surface uses the
    /// matching monochrome Fluent glyph). Decorative only (the web heading emoji is <c>aria-hidden</c>).
    /// </summary>
    public static string CategoryGlyph(WidgetCategory category) => category switch
    {
        WidgetCategory.Vehicle => WidgetGlyphs.Car,
        WidgetCategory.Battery => WidgetGlyphs.Battery,
        WidgetCategory.Energy => WidgetGlyphs.Bolt,
        WidgetCategory.Driving => WidgetGlyphs.Speed,
        WidgetCategory.Charging => WidgetGlyphs.Bolt,
        WidgetCategory.Climate => WidgetGlyphs.Cloud,
        WidgetCategory.Tires => WidgetGlyphs.Tire,
        WidgetCategory.Security => WidgetGlyphs.Shield,
        WidgetCategory.Commands => WidgetGlyphs.Command,
        WidgetCategory.Media => WidgetGlyphs.Music,
        WidgetCategory.Telemetry => WidgetGlyphs.Signal,
        WidgetCategory.Analytics => WidgetGlyphs.Chart,
        WidgetCategory.Alerts => WidgetGlyphs.Bell,
        WidgetCategory.Automations => WidgetGlyphs.Workflow,
        WidgetCategory.System => WidgetGlyphs.Settings,
        WidgetCategory.Maps => WidgetGlyphs.Map,
        _ => WidgetGlyphs.Page,
    };

    private static string Num(int value) => value.ToString(CultureInfo.CurrentCulture);

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Segoe Fluent Icons code points mapped from the web Lucide icons used across the widget registry. Each constant
/// names the originating web Lucide icon so the mapping stays auditable; the glyphs are drawn from the set already
/// shipped by the app's icon surfaces, so each one is guaranteed to render in Segoe Fluent Icons. Icons are
/// decorative on the catalogue cards (the web card icon is <c>aria-hidden</c>), so a close Fluent analogue is used
/// where Lucide has no exact Fluent twin.
/// </summary>
public static class WidgetGlyphs
{
    /// <summary>Web Lucide <c>Car</c>.</summary>
    public const string Car = "\uE804";

    /// <summary>Web Lucide <c>CreditCard</c>.</summary>
    public const string CreditCard = "\uE8C7";

    /// <summary>Web Lucide <c>Monitor</c>.</summary>
    public const string Monitor = "\uE7F4";

    /// <summary>Web Lucide <c>MonitorSmartphone</c>.</summary>
    public const string Devices = "\uE8EA";

    /// <summary>Web Lucide <c>Download</c>.</summary>
    public const string Download = "\uE896";

    /// <summary>Web Lucide <c>Hash</c>.</summary>
    public const string Hash = "\uE943";

    /// <summary>Web Lucide <c>Cog</c> (also the System category glyph).</summary>
    public const string Settings = "\uE713";

    /// <summary>Web Lucide <c>Zap</c> / <c>Plug</c> (also the Energy / Charging category glyph).</summary>
    public const string Bolt = "\uE945";

    /// <summary>Web Lucide <c>FileText</c> / <c>ScrollText</c> (also the generic fallback).</summary>
    public const string Page = "\uE7C3";

    /// <summary>Web Lucide <c>Watch</c>.</summary>
    public const string Watch = "\uE916";

    /// <summary>Web Lucide <c>Wrench</c>.</summary>
    public const string Wrench = "\uE90F";

    /// <summary>Web Lucide <c>Shield</c> / <c>ShieldCheck</c> (also the Security category glyph).</summary>
    public const string Shield = "\uE730";

    /// <summary>Web Lucide <c>ArrowUpCircle</c>.</summary>
    public const string Upload = "\uE897";

    /// <summary>Web Lucide <c>Battery</c> / <c>BatteryFull</c> (also the Battery category glyph).</summary>
    public const string Battery = "\uE83F";

    /// <summary>Web Lucide <c>Gauge</c> (also the Driving category glyph).</summary>
    public const string Speed = "\uE9D9";

    /// <summary>Web Lucide <c>TrendingUp</c> / <c>TrendingDown</c>.</summary>
    public const string Trending = "\uEB0F";

    /// <summary>Web Lucide <c>Activity</c>.</summary>
    public const string Pulse = "\uE9D2";

    /// <summary>Web Lucide <c>Navigation</c> / <c>Navigation2</c> / <c>Route</c> / <c>Map</c> (also the Maps category glyph).</summary>
    public const string Map = "\uE707";

    /// <summary>Web Lucide <c>Cpu</c>.</summary>
    public const string Chip = "\uE950";

    /// <summary>Web Lucide <c>HeartPulse</c>.</summary>
    public const string Health = "\uE95E";

    /// <summary>Web Lucide <c>Workflow</c> (also the Automations category glyph).</summary>
    public const string Workflow = "\uE72C";

    /// <summary>Web Lucide <c>BatteryWarning</c> / <c>AlertTriangle</c> / <c>ShieldAlert</c>.</summary>
    public const string Warning = "\uE7BA";

    /// <summary>Web Lucide <c>Moon</c>.</summary>
    public const string Moon = "\uE708";

    /// <summary>Web Lucide <c>Sun</c>.</summary>
    public const string Sun = "\uE706";

    /// <summary>Web Lucide <c>Home</c> (also the Energy site widget).</summary>
    public const string Home = "\uE80F";

    /// <summary>Web Lucide <c>List</c>.</summary>
    public const string List = "\uE8FD";

    /// <summary>Web Lucide <c>Grid3X3</c> / <c>LayoutDashboard</c>.</summary>
    public const string Grid = "\uE80A";

    /// <summary>Web Lucide <c>RotateCcw</c>.</summary>
    public const string Regen = "\uE7A7";

    /// <summary>Web Lucide <c>Lightbulb</c>.</summary>
    public const string Idea = "\uE9CA";

    /// <summary>Web Lucide <c>BarChart3</c> / <c>BarChart2</c> (also the Analytics category glyph).</summary>
    public const string Chart = "\uE9D2";

    /// <summary>Web Lucide <c>DollarSign</c>.</summary>
    public const string Money = "\uE1D3";

    /// <summary>Web Lucide <c>Calendar</c> / <c>CalendarRange</c> / <c>CalendarDays</c>.</summary>
    public const string Calendar = "\uE787";

    /// <summary>Web Lucide <c>Clock</c>.</summary>
    public const string Clock = "\uE917";

    /// <summary>Web Lucide <c>Sparkles</c>.</summary>
    public const string Sparkles = "\uEC0A";

    /// <summary>Web Lucide <c>Thermometer</c> / <c>ThermometerSun</c>.</summary>
    public const string Thermometer = "\uE9CA";

    /// <summary>Web Lucide <c>CloudSun</c> (also the Climate category glyph).</summary>
    public const string Cloud = "\uE753";

    /// <summary>Web Lucide <c>CircleDot</c> (also the Tires category glyph).</summary>
    public const string Tire = "\uECCA";

    /// <summary>Web Lucide <c>DoorOpen</c>.</summary>
    public const string Door = "\uED1A";

    /// <summary>Web Lucide <c>Eye</c>.</summary>
    public const string Eye = "\uE890";

    /// <summary>Web Lucide <c>AlertOctagon</c> / <c>AlertCircle</c>.</summary>
    public const string Alert = "\uEA39";

    /// <summary>Web Lucide <c>Users</c>.</summary>
    public const string People = "\uE77B";

    /// <summary>Web Lucide <c>Command</c> / <c>Terminal</c> (also the Commands category glyph).</summary>
    public const string Command = "\uE756";

    /// <summary>Web Lucide <c>Music</c> / <c>ListMusic</c> (also the Media category glyph).</summary>
    public const string Music = "\uE8D6";

    /// <summary>Web Lucide <c>Wifi</c> / <c>Radio</c> (also the Telemetry category glyph).</summary>
    public const string Signal = "\uEA80";

    /// <summary>Web Lucide <c>BookOpen</c>.</summary>
    public const string Book = "\uE82D";

    /// <summary>Web Lucide <c>Trophy</c>.</summary>
    public const string Trophy = "\uE735";

    /// <summary>Web Lucide <c>GitBranch</c>.</summary>
    public const string Branch = "\uEC05";

    /// <summary>Web Lucide <c>PieChart</c>.</summary>
    public const string Pie = "\uE9F5";

    /// <summary>Web Lucide <c>Bell</c> (also the Alerts category glyph).</summary>
    public const string Bell = "\uEA8F";

    /// <summary>Web Lucide <c>PlayCircle</c>.</summary>
    public const string Play = "\uE768";

    /// <summary>Web Lucide <c>Server</c> / <c>HardDrive</c>.</summary>
    public const string Storage = "\uEDA2";

    /// <summary>Web Lucide <c>FileSearch</c>.</summary>
    public const string Search = "\uE721";

    /// <summary>Web Lucide <c>Info</c>.</summary>
    public const string Info = "\uE946";

    /// <summary>Web Lucide <c>Rocket</c>.</summary>
    public const string Rocket = "\uE7B8";

    /// <summary>Web Lucide <c>Crosshair</c> / <c>MapPin</c>.</summary>
    public const string Location = "\uE81D";
}

/// <summary>
/// PII-safe diagnostics for the catalogue surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a widget id, name or fleet datum — so a diagnostics line
/// can never leak user data. Thread-safe.
/// </summary>
public sealed class WidgetCatalogueDialogDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WidgetCatalogueDialogDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WidgetCatalogueDialog</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WidgetCatalogueRegistration.Slug}");
    }
}
