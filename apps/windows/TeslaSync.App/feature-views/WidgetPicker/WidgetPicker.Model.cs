using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The dashboard widget categories the catalogue is grouped by — the native enum form of the web
/// <c>WidgetCategory</c> union (web/src/features/dashboard/widgets/types.ts). The order mirrors the web
/// <c>WidgetCategory</c> declaration and the order categories first appear in <c>WIDGET_REGISTRY</c>, which is
/// the order the picker's filter pills and grouped sections render in.
/// </summary>
public enum WidgetCategory
{
    /// <summary>Vehicle widgets (web <c>'vehicle'</c>).</summary>
    Vehicle,

    /// <summary>Battery &amp; range widgets (web <c>'battery'</c>).</summary>
    Battery,

    /// <summary>Energy widgets (web <c>'energy'</c>).</summary>
    Energy,

    /// <summary>Driving widgets (web <c>'driving'</c>).</summary>
    Driving,

    /// <summary>Charging widgets (web <c>'charging'</c>).</summary>
    Charging,

    /// <summary>Climate widgets (web <c>'climate'</c>).</summary>
    Climate,

    /// <summary>Tire widgets (web <c>'tires'</c>).</summary>
    Tires,

    /// <summary>Security widgets (web <c>'security'</c>).</summary>
    Security,

    /// <summary>Command widgets (web <c>'commands'</c>).</summary>
    Commands,

    /// <summary>Media widgets (web <c>'media'</c>).</summary>
    Media,

    /// <summary>Telemetry widgets (web <c>'telemetry'</c>).</summary>
    Telemetry,

    /// <summary>Analytics widgets (web <c>'analytics'</c>).</summary>
    Analytics,

    /// <summary>Alert widgets (web <c>'alerts'</c>).</summary>
    Alerts,

    /// <summary>Automation widgets (web <c>'automations'</c>).</summary>
    Automations,

    /// <summary>System widgets (web <c>'system'</c>).</summary>
    System,

    /// <summary>Map widgets (web <c>'maps'</c>).</summary>
    Maps,
}

/// <summary>
/// The category-label metadata the picker renders — the native analogue of the web <c>CATEGORY_LABELS</c> map
/// (web/src/features/dashboard/components/WidgetPicker.tsx). The web hardcodes the English labels (they carry
/// no <c>t()</c> call); the native surface routes them through the i18n facade with a stable
/// <c>widgets.category.{slug}</c> key so the chips stay translatable, falling back to exactly the English the
/// web map uses. The <see cref="Slug"/> is the lower-case wire/category token the web matches search queries
/// against (web <c>w.category.toLowerCase().includes(query)</c>). Pure data — no WinUI types.
/// </summary>
public static class WidgetCategoryInfo
{
    /// <summary>Every category in web declaration / registry order (the filter-pill order).</summary>
    public static IReadOnlyList<WidgetCategory> All { get; } = new[]
    {
        WidgetCategory.Vehicle,
        WidgetCategory.Battery,
        WidgetCategory.Energy,
        WidgetCategory.Driving,
        WidgetCategory.Charging,
        WidgetCategory.Climate,
        WidgetCategory.Tires,
        WidgetCategory.Security,
        WidgetCategory.Commands,
        WidgetCategory.Media,
        WidgetCategory.Telemetry,
        WidgetCategory.Analytics,
        WidgetCategory.Alerts,
        WidgetCategory.Automations,
        WidgetCategory.System,
        WidgetCategory.Maps,
    };

    /// <summary>The lower-case category token (web category string, e.g. <c>'battery'</c>).</summary>
    /// <param name="category">The category.</param>
    public static string Slug(WidgetCategory category) => category switch
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
        _ => string.Empty,
    };

    /// <summary>The i18n key for a category's label (native <c>widgets.category.{slug}</c>).</summary>
    /// <param name="category">The category.</param>
    public static string LabelKey(WidgetCategory category) => "widgets.category." + Slug(category);

    /// <summary>The English fallback for a category's label (web <c>CATEGORY_LABELS[category]</c>).</summary>
    /// <param name="category">The category.</param>
    public static string LabelFallback(WidgetCategory category) => category switch
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
        _ => string.Empty,
    };

    /// <summary>The localized category label (web <c>CATEGORY_LABELS[category]</c>).</summary>
    /// <param name="category">The category.</param>
    /// <param name="localizer">The i18n facade resolving the label key.</param>
    public static string Label(WidgetCategory category, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LabelKey(category), LabelFallback(category));
    }
}

/// <summary>
/// One catalogue widget the picker can add — the native projection of a web <c>WidgetDef</c>
/// (web/src/features/dashboard/widgets/types.ts) narrowed to the fields the picker reads: the id, the display
/// name and description (rendered verbatim, exactly as the web reads <c>w.name</c> / <c>w.description</c> off
/// the registry — they are catalogue data, not <c>t()</c> keys), the category and the default grid span
/// (web <c>w.defaultSize.cols</c> × <c>w.defaultSize.rows</c>). The widget's icon is resolved at the display
/// boundary through <see cref="MiniGridWidgetIcons.GlyphFor"/> (the native <c>getWidgetDef(id).icon</c>) so it
/// is not duplicated here. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">The stable widget id (web <c>WidgetDef.id</c>).</param>
/// <param name="Name">The display name (web <c>WidgetDef.name</c>).</param>
/// <param name="Description">The one-line description (web <c>WidgetDef.description</c>).</param>
/// <param name="Category">The widget's category (web <c>WidgetDef.category</c>).</param>
/// <param name="DefaultCols">The default column span (web <c>WidgetDef.defaultSize.cols</c>).</param>
/// <param name="DefaultRows">The default row span (web <c>WidgetDef.defaultSize.rows</c>).</param>
public sealed record WidgetCatalogEntry(
    string Id,
    string Name,
    string Description,
    WidgetCategory Category,
    int DefaultCols,
    int DefaultRows);

/// <summary>
/// One layout preset shown above the catalogue — the native projection of a web <c>SavedDashboard</c> preset
/// (web <c>DASHBOARD_PRESETS</c> in web/src/features/dashboard/hooks/useDashboardLayout.ts) narrowed to what
/// the picker renders: the preset id (passed to <c>onApplyPreset</c>), the display name (web
/// <c>preset.name</c>) and the count of widgets it seeds (web <c>preset.widgets.length</c>). Pure data.
/// </summary>
/// <param name="Id">The preset id (web <c>SavedDashboard.id</c>), passed to the apply-preset callback.</param>
/// <param name="Name">The preset display name (web <c>SavedDashboard.name</c>).</param>
/// <param name="WidgetCount">The number of widgets the preset seeds (web <c>preset.widgets.length</c>).</param>
/// <param name="IsDefault">True for the shipped default preset (web <c>SavedDashboard.isDefault</c>).</param>
public sealed record WidgetPresetSummary(string Id, string Name, int WidgetCount, bool IsDefault);

/// <summary>
/// The fixed inputs the <see cref="WidgetPickerProjection"/> renders from — the native bundle of the static
/// catalogue/presets the web <c>WidgetPicker</c> imports as module constants plus the one prop that varies at
/// runtime, <c>activeWidgetIds</c> (web/src/features/dashboard/components/WidgetPicker.tsx). The parent-owned
/// callbacks (<c>onAddWidgets</c> / <c>onApplyPreset</c> / <c>onClose</c>) are modelled as view-model events,
/// not fields, so this model stays a pure value. Construct through <see cref="Create"/> (or use
/// <see cref="Default"/>) so the lists are never null. Pure data — no WinUI types.
/// </summary>
/// <param name="Catalog">The widget catalogue (web <c>WIDGET_REGISTRY</c>).</param>
/// <param name="Presets">The layout presets (web <c>DASHBOARD_PRESETS</c>).</param>
/// <param name="ActiveWidgetIds">The ids already on the dashboard (web <c>activeWidgetIds</c> prop).</param>
public sealed record WidgetPickerModel(
    IReadOnlyList<WidgetCatalogEntry> Catalog,
    IReadOnlyList<WidgetPresetSummary> Presets,
    IReadOnlyList<string> ActiveWidgetIds)
{
    /// <summary>The default model: the full shipped catalogue + presets, nothing yet on the dashboard.</summary>
    public static WidgetPickerModel Default { get; } = new(
        WidgetPickerCatalog.DefaultWidgets,
        WidgetPickerCatalog.DefaultPresets,
        Array.Empty<string>());

    /// <summary>
    /// Build a model over the shipped catalogue/presets with the supplied active ids, coalescing a null active
    /// list to empty so the projection never iterates a null collection.
    /// </summary>
    /// <param name="activeWidgetIds">The ids already on the dashboard, or null.</param>
    public static WidgetPickerModel Create(IReadOnlyList<string>? activeWidgetIds) => new(
        WidgetPickerCatalog.DefaultWidgets,
        WidgetPickerCatalog.DefaultPresets,
        activeWidgetIds ?? Array.Empty<string>());
}

/// <summary>
/// The transient interaction state the picker derives its render from — the native bundle of the web
/// component's <c>useState</c> values (web/src/features/dashboard/components/WidgetPicker.tsx): the
/// <see cref="Search"/> box text (web <c>search</c>), the <see cref="CategoryFilter"/> pill selection (web
/// <c>categoryFilter</c>, <see langword="null"/> = the "All" pill), the ids added during this open session (web
/// <c>addedThisSessionIds</c>, drives the footer count), the persisted recently-added ids (web
/// <c>recentlyAddedIds</c>) and the live-region <see cref="Announcement"/> (web <c>announcement</c>). Construct
/// through <see cref="Create"/> (or use <see cref="Empty"/>) so the lists are never null. Pure data.
/// </summary>
/// <param name="Search">The raw search-box text (web <c>search</c>).</param>
/// <param name="CategoryFilter">The selected category, or null for the "All" pill (web <c>categoryFilter</c>).</param>
/// <param name="AddedThisSessionIds">Ids added during this open session (web <c>addedThisSessionIds</c>).</param>
/// <param name="RecentlyAddedIds">The persisted recently-added ids, most-recent first (web <c>recentlyAddedIds</c>).</param>
/// <param name="Announcement">The current live-region message (web <c>announcement</c>).</param>
public sealed record WidgetPickerInteraction(
    string Search,
    WidgetCategory? CategoryFilter,
    IReadOnlyList<string> AddedThisSessionIds,
    IReadOnlyList<string> RecentlyAddedIds,
    string Announcement)
{
    /// <summary>The resting interaction: empty search, "All" pill, nothing added, no announcement.</summary>
    public static WidgetPickerInteraction Empty { get; } = new(
        string.Empty,
        null,
        Array.Empty<string>(),
        Array.Empty<string>(),
        string.Empty);

    /// <summary>
    /// Build an interaction state, coalescing null lists/strings to empty so the projection never dereferences
    /// a null.
    /// </summary>
    /// <param name="search">The raw search text, or null.</param>
    /// <param name="categoryFilter">The selected category, or null for "All".</param>
    /// <param name="addedThisSessionIds">Ids added this session, or null.</param>
    /// <param name="recentlyAddedIds">The recently-added ids, or null.</param>
    /// <param name="announcement">The live-region message, or null.</param>
    public static WidgetPickerInteraction Create(
        string? search = null,
        WidgetCategory? categoryFilter = null,
        IReadOnlyList<string>? addedThisSessionIds = null,
        IReadOnlyList<string>? recentlyAddedIds = null,
        string? announcement = null) => new(
        search ?? string.Empty,
        categoryFilter,
        addedThisSessionIds ?? Array.Empty<string>(),
        recentlyAddedIds ?? Array.Empty<string>(),
        announcement ?? string.Empty);
}

/// <summary>
/// One run of widget-name / description text, flagged as a search match or not — the native analogue of the
/// web <c>highlightMatch</c> helper that wraps the matched substring in a tinted, bold
/// <c>&lt;span&gt;</c> (web/src/features/dashboard/components/WidgetPicker.tsx). A non-matching run is rendered
/// in the normal text colour; a matching run is rendered in the theme-primary colour and semibold. Pure data.
/// </summary>
/// <param name="Text">The run's literal text.</param>
/// <param name="IsMatch">True when this run is the highlighted query match (web the tinted span).</param>
public sealed record WidgetHighlightSpan(string Text, bool IsMatch);

/// <summary>
/// One render-ready widget card in the picker — the native analogue of the web <c>renderWidgetCard</c> output
/// (web/src/features/dashboard/components/WidgetPicker.tsx). Carries the widget id (added on click), the
/// resolved icon glyph, the name/description split into <see cref="WidgetHighlightSpan"/> runs, whether the
/// widget is already on the dashboard (web <c>isAdded</c> → the disabled, dimmed card with the "Added" badge),
/// the grid-size caption (web <c>{cols}×{rows} grid</c>), the optional category label shown only while
/// searching (web <c>{query &amp;&amp; CATEGORY_LABELS[w.category]}</c>) and the composed Narrator name. Pure
/// data so every card is asserted headlessly.
/// </summary>
/// <param name="Id">The widget id added when the card is activated.</param>
/// <param name="IconGlyph">The Segoe Fluent glyph, or null when the id is unknown (web <c>w.icon</c>).</param>
/// <param name="Name">The plain display name (the concatenation of <see cref="NameSpans"/>).</param>
/// <param name="Description">The plain description (the concatenation of <see cref="DescriptionSpans"/>).</param>
/// <param name="NameSpans">The display name split into highlighted/plain runs.</param>
/// <param name="DescriptionSpans">The description split into highlighted/plain runs.</param>
/// <param name="IsAdded">True when the widget is already on the dashboard (web <c>isAdded</c>; disables the card).</param>
/// <param name="AddedBadgeLabel">The "Added" badge text shown when <paramref name="IsAdded"/> is true.</param>
/// <param name="SizeText">The grid-size caption (web <c>{cols}×{rows} grid</c>).</param>
/// <param name="ShowCategoryLabel">True when the trailing category label is shown (web <c>query</c> truthy).</param>
/// <param name="CategoryLabel">The trailing category label (web <c>CATEGORY_LABELS[w.category]</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the card.</param>
public sealed record WidgetCardView(
    string Id,
    string? IconGlyph,
    string Name,
    string Description,
    IReadOnlyList<WidgetHighlightSpan> NameSpans,
    IReadOnlyList<WidgetHighlightSpan> DescriptionSpans,
    bool IsAdded,
    string AddedBadgeLabel,
    string SizeText,
    bool ShowCategoryLabel,
    string CategoryLabel,
    string AutomationName);

/// <summary>
/// One category filter pill — the native analogue of a web <c>role="tab"</c> chip in the filter row
/// (web/src/features/dashboard/components/WidgetPicker.tsx), including the leading "All" pill. Carries the
/// category it selects (<see langword="null"/> for the "All" pill), the localized label, whether it is the
/// active selection (web <c>aria-selected</c>) and the Narrator name. Pure data.
/// </summary>
/// <param name="Category">The category this pill selects, or null for the "All" pill.</param>
/// <param name="IsAll">True for the leading "All" pill (web the <c>categoryFilter === 'all'</c> chip).</param>
/// <param name="Label">The localized pill label.</param>
/// <param name="IsSelected">True when this pill is the active selection (web <c>aria-selected</c>).</param>
public sealed record WidgetCategoryPill(WidgetCategory? Category, bool IsAll, string Label, bool IsSelected);

/// <summary>
/// One render-ready preset card — the native analogue of a web <c>DASHBOARD_PRESETS.map(...)</c> button
/// (web/src/features/dashboard/components/WidgetPicker.tsx). Carries the preset id (applied on click), the
/// display name and the "{n} widgets" caption (web <c>{preset.widgets.length} {t('dashboard.widgets')}</c>).
/// Pure data.
/// </summary>
/// <param name="Id">The preset id applied when the card is activated.</param>
/// <param name="Name">The preset display name.</param>
/// <param name="WidgetCountText">The "{n} widgets" caption.</param>
/// <param name="AutomationName">The composed Narrator name (name + widget-count caption).</param>
public sealed record WidgetPresetCard(string Id, string Name, string WidgetCountText, string AutomationName);

/// <summary>
/// One category section in the grouped (non-search) view — the native analogue of a web
/// <c>groupedEntries.map(([cat, widgets]) =&gt; …)</c> block
/// (web/src/features/dashboard/components/WidgetPicker.tsx): the localized heading, an "+ Add all {n}" action
/// over the widgets in the group that are not yet on the dashboard (web <c>addableCategoryWidgets</c>) and the
/// group's widget cards. Pure data.
/// </summary>
/// <param name="Category">The section's category.</param>
/// <param name="Heading">The localized category heading (web <c>CATEGORY_LABELS[cat]</c>).</param>
/// <param name="AddAllLabel">The "+ Add all {n}" action label (web <c>addAllCount</c>).</param>
/// <param name="AddAllEnabled">True when the group has addable widgets (web <c>disabled={length === 0}</c>).</param>
/// <param name="AddAllIds">The ids the "Add all" action adds (web <c>addableCategoryWidgets</c> ids).</param>
/// <param name="Cards">The group's widget cards, in registry order.</param>
public sealed record WidgetGroupView(
    WidgetCategory Category,
    string Heading,
    string AddAllLabel,
    bool AddAllEnabled,
    IReadOnlyList<string> AddAllIds,
    IReadOnlyList<WidgetCardView> Cards);

/// <summary>
/// The fully projected, render-ready view of the <see cref="WidgetPicker"/> surface — the native analogue of
/// the entire web <c>WidgetPicker</c> render output (web/src/features/dashboard/components/WidgetPicker.tsx).
/// It carries the drawer title, the sticky search box copy + available count, the category filter pills, the
/// optional "Recently Added" and "Layout Presets" sections (shown only on the unsearched, "All" view), and the
/// main body — either the flat search results (with the results-count bar, the "Add all" action and a friendly
/// no-results message) or the registry-grouped category sections — plus the footer "{n} added" summary and the
/// live-region announcement. There is deliberately no loading / error / stale / offline branch: the web source
/// is a controlled component that reads a static catalogue and its <c>activeWidgetIds</c> prop, with no
/// asynchronous data read (the same shape as the sibling <c>AddWidgetButton</c> / <c>LayoutSwitcher</c> /
/// <c>MiniGridPreview</c> surfaces). The only "no rows" surface is the search no-results state, which renders a
/// friendly message, never a blank box. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record WidgetPickerDisplay
{
    /// <summary>The drawer title (web <c>t('dashboard.addWidget')</c>).</summary>
    public required string Title { get; init; }

    /// <summary>The drawer's Narrator name (reuses the title).</summary>
    public required string AutomationName { get; init; }

    /// <summary>The raw search-box text (web <c>search</c>; the controlled input value).</summary>
    public required string SearchText { get; init; }

    /// <summary>The search-box hint (web <c>t('widgets.search')</c>).</summary>
    public required string SearchHint { get; init; }

    /// <summary>The "{n} widgets available" caption (web <c>{filteredWidgets.length} {t('widgets.available')}</c>).</summary>
    public required string AvailableCountText { get; init; }

    /// <summary>The filter row's Narrator name (web <c>aria-label={t('widgets.categoryFilter')}</c>).</summary>
    public required string CategoryFilterLabel { get; init; }

    /// <summary>The category filter pills, including the leading "All" pill.</summary>
    public required IReadOnlyList<WidgetCategoryPill> Pills { get; init; }

    /// <summary>True when the "Recently Added" section is shown (web <c>recentlyAddedVisible.length &gt; 0</c>).</summary>
    public required bool ShowRecentlyAdded { get; init; }

    /// <summary>The "Recently Added" heading (web <c>t('widgets.recentlyAdded')</c>).</summary>
    public required string RecentlyAddedHeading { get; init; }

    /// <summary>The recently-added widget cards (web <c>recentlyAddedVisible.map(...)</c>).</summary>
    public required IReadOnlyList<WidgetCardView> RecentlyAddedCards { get; init; }

    /// <summary>True when the "Layout Presets" section is shown (web <c>!query &amp;&amp; categoryFilter === 'all'</c>).</summary>
    public required bool ShowPresets { get; init; }

    /// <summary>The "Layout Presets" heading (web <c>t('dashboard.presets')</c>).</summary>
    public required string PresetsHeading { get; init; }

    /// <summary>The preset cards (web <c>DASHBOARD_PRESETS.map(...)</c>).</summary>
    public required IReadOnlyList<WidgetPresetCard> Presets { get; init; }

    /// <summary>True when the search (flat) view is shown instead of the grouped view (web <c>query</c> truthy).</summary>
    public required bool IsSearching { get; init; }

    /// <summary>True when the results-count bar is shown (web <c>filteredWidgets.length &gt; 1</c>).</summary>
    public required bool ShowSearchResultsBar { get; init; }

    /// <summary>The "{n} results for "{q}"" bar text (web <c>t('widgets.searchResults')</c>).</summary>
    public required string SearchResultsText { get; init; }

    /// <summary>The search "+ Add all {n}" action label (web <c>t('widgets.addAllCount')</c>).</summary>
    public required string SearchAddAllLabel { get; init; }

    /// <summary>True when the search "Add all" action is enabled (web <c>addableSearchWidgets.length &gt; 0</c>).</summary>
    public required bool SearchAddAllEnabled { get; init; }

    /// <summary>The ids the search "Add all" action adds (web <c>addableSearchWidgets</c> ids).</summary>
    public required IReadOnlyList<string> SearchAddAllIds { get; init; }

    /// <summary>The flat search-result cards (web <c>filteredWidgets.map(renderWidgetCard)</c>).</summary>
    public required IReadOnlyList<WidgetCardView> SearchResults { get; init; }

    /// <summary>True when the no-results message is shown (web <c>filteredWidgets.length === 0</c> while searching).</summary>
    public required bool ShowNoResults { get; init; }

    /// <summary>The no-results message (web <c>t('widgets.noResults')</c>).</summary>
    public required string NoResultsText { get; init; }

    /// <summary>The registry-grouped category sections (web <c>groupedEntries.map(...)</c>); empty while searching.</summary>
    public required IReadOnlyList<WidgetGroupView> Groups { get; init; }

    /// <summary>True when the footer "{n} added" summary is shown (web <c>addedThisSessionCount &gt; 0</c>).</summary>
    public required bool ShowFooter { get; init; }

    /// <summary>The footer "{n} widget(s) added" text (web <c>addedCountText</c>).</summary>
    public required string AddedCountText { get; init; }

    /// <summary>The footer "Done" button label (web <c>t('dashboard.done')</c>).</summary>
    public required string DoneLabel { get; init; }

    /// <summary>The current live-region message (web <c>announcement</c>; empty when nothing to announce).</summary>
    public required string Announcement { get; init; }
}

/// <summary>
/// The pure projection from a <see cref="WidgetPickerModel"/> + <see cref="WidgetPickerInteraction"/> to the
/// render-ready <see cref="WidgetPickerDisplay"/> — the native port of the web <c>WidgetPicker</c> render
/// (web/src/features/dashboard/components/WidgetPicker.tsx). It reproduces the component branch-for-branch: the
/// trimmed query, the category + query filter (<c>filteredWidgets</c>), the registry-ordered grouping
/// (<c>groupedEntries</c>), the recently-added-visible slice (hidden while searching or filtering), the
/// addable-widget sets behind every "Add all" action, the per-card name/description highlight runs and
/// grid-size caption, and the footer plural count. Every owned string resolves through the i18n facade using
/// the web's keys (with the resw catalogue's positional <c>{0}</c>/<c>{1}</c> fallbacks); the widget
/// names/descriptions are rendered verbatim as catalogue data, exactly as the web reads them off the registry.
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class WidgetPickerProjection
{
    /// <summary>The most recently-added widgets the surface keeps (web <c>RECENTLY_ADDED_MAX</c>).</summary>
    public const int RecentlyAddedMax = 8;

    /// <summary>i18n key for the drawer title (web <c>dashboard.addWidget</c>).</summary>
    public const string TitleKey = "dashboard.addWidget";

    /// <summary>i18n key for the search hint (web <c>widgets.search</c>).</summary>
    public const string SearchKey = "widgets.search";

    /// <summary>i18n key for the available-count noun (web <c>widgets.available</c>).</summary>
    public const string AvailableKey = "widgets.available";

    /// <summary>i18n key for the filter row's Narrator name (web <c>widgets.categoryFilter</c>).</summary>
    public const string CategoryFilterKey = "widgets.categoryFilter";

    /// <summary>i18n key for the "All" pill (web <c>widgets.allCategories</c>).</summary>
    public const string AllCategoriesKey = "widgets.allCategories";

    /// <summary>i18n key for the "Recently Added" heading (web <c>widgets.recentlyAdded</c>).</summary>
    public const string RecentlyAddedKey = "widgets.recentlyAdded";

    /// <summary>i18n key for the "Layout Presets" heading (web <c>dashboard.presets</c>).</summary>
    public const string PresetsKey = "dashboard.presets";

    /// <summary>i18n key for the preset "widgets" noun (web <c>dashboard.widgets</c>).</summary>
    public const string WidgetsNounKey = "dashboard.widgets";

    /// <summary>i18n key for the per-card "Added" badge (web <c>dashboard.added</c>).</summary>
    public const string AddedBadgeKey = "dashboard.added";

    /// <summary>i18n key for the search results-count bar (web <c>widgets.searchResults</c>).</summary>
    public const string SearchResultsKey = "widgets.searchResults";

    /// <summary>i18n key for the "+ Add all {n}" action (web <c>widgets.addAllCount</c>).</summary>
    public const string AddAllCountKey = "widgets.addAllCount";

    /// <summary>i18n key for the no-results message (web <c>widgets.noResults</c>).</summary>
    public const string NoResultsKey = "widgets.noResults";

    /// <summary>i18n key for the footer "Done" button (web <c>dashboard.done</c>).</summary>
    public const string DoneKey = "dashboard.done";

    /// <summary>i18n key for the single-widget footer count (web <c>widgets.addedCount_one</c>).</summary>
    public const string AddedCountOneKey = "widgets.addedCount_one";

    /// <summary>i18n key for the multi-widget footer count (web <c>widgets.addedCount_other</c>).</summary>
    public const string AddedCountOtherKey = "widgets.addedCount_other";

    /// <summary>i18n key for the single-widget add announcement (web <c>widgets.addedAnnouncement</c>).</summary>
    public const string AddedAnnouncementKey = "widgets.addedAnnouncement";

    /// <summary>i18n key for the multi-widget add announcement (web <c>widgets.addedBatchAnnouncement</c>).</summary>
    public const string AddedBatchAnnouncementKey = "widgets.addedBatchAnnouncement";

    /// <summary>Native-only i18n key for the per-card grid-size caption (web hardcodes <c>{cols}×{rows} grid</c>).</summary>
    public const string GridSizeKey = "widgets.gridSize";

    private const string TitleFallback = "Add Widget";
    private const string SearchFallback = "Search widgets... (e.g. battery, chart, map)";
    private const string AvailableFallback = "widgets available";
    private const string CategoryFilterFallback = "Filter by category";
    private const string AllCategoriesFallback = "All";
    private const string RecentlyAddedFallback = "Recently Added";
    private const string PresetsFallback = "Layout Presets";
    private const string WidgetsNounFallback = "widgets";
    private const string AddedBadgeFallback = "Added";
    private const string SearchResultsFallback = "{0} results for \"{1}\"";
    private const string AddAllCountFallback = "+ Add all {0}";
    private const string NoResultsFallback = "No widgets match \"{0}\"";
    private const string DoneFallback = "Done";
    private const string AddedCountOneFallback = "{0} widget added";
    private const string AddedCountOtherFallback = "{0} widgets added";
    private const string AddedAnnouncementFallback = "{0} added to dashboard";
    private const string AddedBatchAnnouncementFallback = "{0} widgets added to dashboard";
    private const string GridSizeFallback = "{0}×{1} grid";

    /// <summary>
    /// Project the catalogue + interaction into the render-ready display, resolving copy through
    /// <paramref name="localizer"/> and each card's icon through <paramref name="iconResolver"/> (defaulting to
    /// <see cref="MiniGridWidgetIcons.GlyphFor"/>, the native <c>getWidgetDef(id).icon</c>).
    /// </summary>
    /// <param name="model">The catalogue, presets and active ids (the web module constants + the prop).</param>
    /// <param name="interaction">The search / filter / added / announcement state (the web <c>useState</c> values).</param>
    /// <param name="localizer">The i18n facade every owned string resolves through.</param>
    /// <param name="iconResolver">
    /// The widget-id to Segoe Fluent glyph resolver (web <c>getWidgetDef(id).icon</c>); a null result means the
    /// card shows no icon. Defaults to <see cref="MiniGridWidgetIcons.GlyphFor"/>.
    /// </param>
    public static WidgetPickerDisplay Project(
        WidgetPickerModel model,
        WidgetPickerInteraction interaction,
        ILocalizer localizer,
        Func<string, string?>? iconResolver = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(interaction);
        ArgumentNullException.ThrowIfNull(localizer);

        Func<string, string?> resolveIcon = iconResolver ?? MiniGridWidgetIcons.GlyphFor;

        IReadOnlyList<WidgetCatalogEntry> catalog = model.Catalog;
        var activeSet = new HashSet<string>(model.ActiveWidgetIds, StringComparer.Ordinal);
        var widgetById = BuildWidgetIndex(catalog);

        string queryTrimmed = interaction.Search.Trim();
        bool isSearching = queryTrimmed.Length > 0;
        WidgetCategory? categoryFilter = interaction.CategoryFilter;

        string addedBadge = localizer.GetString(AddedBadgeKey, AddedBadgeFallback);

        // web: filteredWidgets — pool filtered by category, then by the query across name/description/category.
        var filteredWidgets = FilterWidgets(catalog, categoryFilter, queryTrimmed);

        // web: addableSearchWidgets = filteredWidgets.filter(w => !active.has(w.id)).
        var addableSearch = Addable(filteredWidgets, activeSet);

        // web: groupedEntries — registry-ordered grouping of the category-filtered catalogue.
        var groupedEntries = GroupByCategory(catalog, categoryFilter);

        // web: recentlyAddedVisible — hidden while searching or filtering; mapped, de-active-d, capped.
        var recentlyAddedVisible = RecentlyAddedVisible(
            interaction.RecentlyAddedIds, widgetById, activeSet, isSearching, categoryFilter);

        var searchResultCards = isSearching
            ? filteredWidgets.Select(w => Card(w, queryTrimmed, activeSet, addedBadge, localizer, resolveIcon)).ToArray()
            : Array.Empty<WidgetCardView>();

        var recentlyAddedCards = recentlyAddedVisible
            .Select(w => Card(w, queryTrimmed, activeSet, addedBadge, localizer, resolveIcon))
            .ToArray();

        var groups = isSearching
            ? Array.Empty<WidgetGroupView>()
            : groupedEntries
                .Select(g => Group(g.Category, g.Widgets, queryTrimmed, activeSet, addedBadge, localizer, resolveIcon))
                .ToArray();

        int addedThisSession = interaction.AddedThisSessionIds.Count;

        return new WidgetPickerDisplay
        {
            Title = localizer.GetString(TitleKey, TitleFallback),
            AutomationName = localizer.GetString(TitleKey, TitleFallback),
            SearchText = interaction.Search,
            SearchHint = localizer.GetString(SearchKey, SearchFallback),
            AvailableCountText = string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}",
                filteredWidgets.Count,
                localizer.GetString(AvailableKey, AvailableFallback)),
            CategoryFilterLabel = localizer.GetString(CategoryFilterKey, CategoryFilterFallback),
            Pills = BuildPills(catalog, categoryFilter, localizer),
            ShowRecentlyAdded = recentlyAddedVisible.Count > 0,
            RecentlyAddedHeading = localizer.GetString(RecentlyAddedKey, RecentlyAddedFallback),
            RecentlyAddedCards = recentlyAddedCards,
            ShowPresets = !isSearching && categoryFilter is null,
            PresetsHeading = localizer.GetString(PresetsKey, PresetsFallback),
            Presets = BuildPresetCards(model.Presets, localizer),
            IsSearching = isSearching,
            ShowSearchResultsBar = isSearching && filteredWidgets.Count > 1,
            SearchResultsText = string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(SearchResultsKey, SearchResultsFallback),
                filteredWidgets.Count,
                queryTrimmed),
            SearchAddAllLabel = string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(AddAllCountKey, AddAllCountFallback),
                addableSearch.Count),
            SearchAddAllEnabled = addableSearch.Count > 0,
            SearchAddAllIds = addableSearch.Select(w => w.Id).ToArray(),
            SearchResults = searchResultCards,
            ShowNoResults = isSearching && filteredWidgets.Count == 0,
            NoResultsText = string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(NoResultsKey, NoResultsFallback),
                queryTrimmed),
            Groups = groups,
            ShowFooter = addedThisSession > 0,
            AddedCountText = AddedCountText(addedThisSession, localizer),
            DoneLabel = localizer.GetString(DoneKey, DoneFallback),
            Announcement = interaction.Announcement,
        };
    }

    /// <summary>
    /// The widgets that can actually be added from <paramref name="widgetIds"/> — the web <c>handleAddMany</c>
    /// guard: de-duplicated, dropping ids already on the dashboard or not in the catalogue, preserving order.
    /// </summary>
    /// <param name="model">The catalogue + active ids.</param>
    /// <param name="widgetIds">The candidate ids to add.</param>
    public static IReadOnlyList<string> ResolveAddable(WidgetPickerModel model, IEnumerable<string> widgetIds)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(widgetIds);

        var activeSet = new HashSet<string>(model.ActiveWidgetIds, StringComparer.Ordinal);
        var known = BuildWidgetIndex(model.Catalog);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<string>();
        foreach (string id in widgetIds)
        {
            if (seen.Contains(id) || activeSet.Contains(id) || !known.ContainsKey(id))
            {
                continue;
            }

            seen.Add(id);
            result.Add(id);
        }

        return result;
    }

    /// <summary>
    /// The next recently-added list after adding <paramref name="addedIds"/> — the web <c>setRecentlyAddedIds</c>
    /// update: the newly-added ids first, then the previous ids with those removed, capped at
    /// <see cref="RecentlyAddedMax"/>.
    /// </summary>
    /// <param name="previous">The current recently-added ids (most-recent first).</param>
    /// <param name="addedIds">The ids just added (already de-duplicated/addable).</param>
    public static IReadOnlyList<string> NextRecentlyAdded(
        IReadOnlyList<string> previous,
        IReadOnlyList<string> addedIds)
    {
        ArgumentNullException.ThrowIfNull(previous);
        ArgumentNullException.ThrowIfNull(addedIds);

        var addedSet = new HashSet<string>(addedIds, StringComparer.Ordinal);
        var next = new List<string>(addedIds);
        foreach (string id in previous)
        {
            if (!addedSet.Contains(id))
            {
                next.Add(id);
            }
        }

        if (next.Count > RecentlyAddedMax)
        {
            next.RemoveRange(RecentlyAddedMax, next.Count - RecentlyAddedMax);
        }

        return next;
    }

    /// <summary>
    /// The live-region message for adding <paramref name="addedNames"/> — the web <c>handleAddMany</c>
    /// announcement: a single widget reads "{name} added to dashboard" (web <c>addedAnnouncement</c>); multiple
    /// read "{n} widgets added to dashboard" (web <c>addedBatchAnnouncement</c>). An empty list yields an empty
    /// message (no announcement).
    /// </summary>
    /// <param name="addedNames">The display names of the widgets just added, in add order.</param>
    /// <param name="localizer">The i18n facade resolving the announcement templates.</param>
    public static string AddedAnnouncement(IReadOnlyList<string> addedNames, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(addedNames);
        ArgumentNullException.ThrowIfNull(localizer);

        if (addedNames.Count == 0)
        {
            return string.Empty;
        }

        if (addedNames.Count == 1)
        {
            return string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(AddedAnnouncementKey, AddedAnnouncementFallback),
                addedNames[0]);
        }

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(AddedBatchAnnouncementKey, AddedBatchAnnouncementFallback),
            addedNames.Count);
    }

    /// <summary>The footer "{n} widget(s) added" text — the web <c>addedCountText</c> plural selection.</summary>
    /// <param name="count">The number of widgets added this session.</param>
    /// <param name="localizer">The i18n facade resolving the singular/plural templates.</param>
    public static string AddedCountText(int count, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string template = count == 1
            ? localizer.GetString(AddedCountOneKey, AddedCountOneFallback)
            : localizer.GetString(AddedCountOtherKey, AddedCountOtherFallback);
        return string.Format(CultureInfo.CurrentCulture, template, count);
    }

    /// <summary>
    /// Split <paramref name="text"/> into highlighted/plain runs around the first case-insensitive occurrence
    /// of <paramref name="query"/> — the native <c>highlightMatch</c>. An empty query or no match yields a
    /// single non-matching run.
    /// </summary>
    /// <param name="text">The text to highlight.</param>
    /// <param name="query">The (trimmed) search query; empty disables highlighting.</param>
    public static IReadOnlyList<WidgetHighlightSpan> Highlight(string text, string query)
    {
        ArgumentNullException.ThrowIfNull(text);
        ArgumentNullException.ThrowIfNull(query);

        if (query.Length == 0)
        {
            return new[] { new WidgetHighlightSpan(text, false) };
        }

        int idx = text.IndexOf(query, StringComparison.OrdinalIgnoreCase);
        if (idx < 0)
        {
            return new[] { new WidgetHighlightSpan(text, false) };
        }

        var spans = new List<WidgetHighlightSpan>(3);
        if (idx > 0)
        {
            spans.Add(new WidgetHighlightSpan(text.Substring(0, idx), false));
        }

        spans.Add(new WidgetHighlightSpan(text.Substring(idx, query.Length), true));

        int tail = idx + query.Length;
        if (tail < text.Length)
        {
            spans.Add(new WidgetHighlightSpan(text.Substring(tail), false));
        }

        return spans;
    }

    private static Dictionary<string, WidgetCatalogEntry> BuildWidgetIndex(IReadOnlyList<WidgetCatalogEntry> catalog)
    {
        var index = new Dictionary<string, WidgetCatalogEntry>(catalog.Count, StringComparer.Ordinal);
        foreach (WidgetCatalogEntry entry in catalog)
        {
            index[entry.Id] = entry;
        }

        return index;
    }

    private static bool InCategory(WidgetCatalogEntry widget, WidgetCategory? filter) =>
        filter is null || widget.Category == filter;

    private static List<WidgetCatalogEntry> FilterWidgets(
        IReadOnlyList<WidgetCatalogEntry> catalog,
        WidgetCategory? filter,
        string queryTrimmed)
    {
        var result = new List<WidgetCatalogEntry>();
        foreach (WidgetCatalogEntry widget in catalog)
        {
            if (!InCategory(widget, filter))
            {
                continue;
            }

            if (queryTrimmed.Length == 0 || MatchesQuery(widget, queryTrimmed))
            {
                result.Add(widget);
            }
        }

        return result;
    }

    private static bool MatchesQuery(WidgetCatalogEntry widget, string queryTrimmed) =>
        widget.Name.Contains(queryTrimmed, StringComparison.OrdinalIgnoreCase) ||
        widget.Description.Contains(queryTrimmed, StringComparison.OrdinalIgnoreCase) ||
        WidgetCategoryInfo.Slug(widget.Category).Contains(queryTrimmed, StringComparison.OrdinalIgnoreCase);

    private static List<WidgetCatalogEntry> Addable(
        IReadOnlyList<WidgetCatalogEntry> widgets,
        HashSet<string> activeSet)
    {
        var result = new List<WidgetCatalogEntry>();
        foreach (WidgetCatalogEntry widget in widgets)
        {
            if (!activeSet.Contains(widget.Id))
            {
                result.Add(widget);
            }
        }

        return result;
    }

    private static List<(WidgetCategory Category, IReadOnlyList<WidgetCatalogEntry> Widgets)> GroupByCategory(
        IReadOnlyList<WidgetCatalogEntry> catalog,
        WidgetCategory? filter)
    {
        var order = new List<WidgetCategory>();
        var buckets = new Dictionary<WidgetCategory, List<WidgetCatalogEntry>>();
        foreach (WidgetCatalogEntry widget in catalog)
        {
            if (!InCategory(widget, filter))
            {
                continue;
            }

            if (!buckets.TryGetValue(widget.Category, out List<WidgetCatalogEntry>? bucket))
            {
                bucket = new List<WidgetCatalogEntry>();
                buckets[widget.Category] = bucket;
                order.Add(widget.Category);
            }

            bucket.Add(widget);
        }

        var result = new List<(WidgetCategory, IReadOnlyList<WidgetCatalogEntry>)>(order.Count);
        foreach (WidgetCategory category in order)
        {
            result.Add((category, buckets[category]));
        }

        return result;
    }

    private static IReadOnlyList<WidgetCatalogEntry> RecentlyAddedVisible(
        IReadOnlyList<string> recentlyAddedIds,
        Dictionary<string, WidgetCatalogEntry> widgetById,
        HashSet<string> activeSet,
        bool isSearching,
        WidgetCategory? categoryFilter)
    {
        if (isSearching || categoryFilter is not null)
        {
            return Array.Empty<WidgetCatalogEntry>();
        }

        var result = new List<WidgetCatalogEntry>();
        foreach (string id in recentlyAddedIds)
        {
            if (result.Count >= RecentlyAddedMax)
            {
                break;
            }

            if (widgetById.TryGetValue(id, out WidgetCatalogEntry? widget) && !activeSet.Contains(widget.Id))
            {
                result.Add(widget);
            }
        }

        return result;
    }

    private static List<WidgetCategoryPill> BuildPills(
        IReadOnlyList<WidgetCatalogEntry> catalog,
        WidgetCategory? filter,
        ILocalizer localizer)
    {
        var pills = new List<WidgetCategoryPill>
        {
            new(null, true, localizer.GetString(AllCategoriesKey, AllCategoriesFallback), filter is null),
        };

        foreach (WidgetCategory category in AvailableCategories(catalog))
        {
            pills.Add(new WidgetCategoryPill(
                category,
                false,
                WidgetCategoryInfo.Label(category, localizer),
                filter == category));
        }

        return pills;
    }

    private static List<WidgetCategory> AvailableCategories(IReadOnlyList<WidgetCatalogEntry> catalog)
    {
        var seen = new HashSet<WidgetCategory>();
        var order = new List<WidgetCategory>();
        foreach (WidgetCatalogEntry widget in catalog)
        {
            if (seen.Add(widget.Category))
            {
                order.Add(widget.Category);
            }
        }

        return order;
    }

    private static List<WidgetPresetCard> BuildPresetCards(
        IReadOnlyList<WidgetPresetSummary> presets,
        ILocalizer localizer)
    {
        string widgetsNoun = localizer.GetString(WidgetsNounKey, WidgetsNounFallback);
        var cards = new List<WidgetPresetCard>(presets.Count);
        foreach (WidgetPresetSummary preset in presets)
        {
            string countText = string.Format(CultureInfo.CurrentCulture, "{0} {1}", preset.WidgetCount, widgetsNoun);
            cards.Add(new WidgetPresetCard(
                preset.Id,
                preset.Name,
                countText,
                string.Format(CultureInfo.CurrentCulture, "{0}, {1}", preset.Name, countText)));
        }

        return cards;
    }

    private static WidgetGroupView Group(
        WidgetCategory category,
        IReadOnlyList<WidgetCatalogEntry> widgets,
        string queryTrimmed,
        HashSet<string> activeSet,
        string addedBadge,
        ILocalizer localizer,
        Func<string, string?> resolveIcon)
    {
        var addable = Addable(widgets, activeSet);
        var cards = widgets
            .Select(w => Card(w, queryTrimmed, activeSet, addedBadge, localizer, resolveIcon))
            .ToArray();

        return new WidgetGroupView(
            category,
            WidgetCategoryInfo.Label(category, localizer),
            string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(AddAllCountKey, AddAllCountFallback),
                addable.Count),
            addable.Count > 0,
            addable.Select(w => w.Id).ToArray(),
            cards);
    }

    private static WidgetCardView Card(
        WidgetCatalogEntry widget,
        string queryTrimmed,
        HashSet<string> activeSet,
        string addedBadge,
        ILocalizer localizer,
        Func<string, string?> resolveIcon)
    {
        bool isAdded = activeSet.Contains(widget.Id);
        bool showCategory = queryTrimmed.Length > 0;
        string categoryLabel = WidgetCategoryInfo.Label(widget.Category, localizer);
        string sizeText = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(GridSizeKey, GridSizeFallback),
            widget.DefaultCols,
            widget.DefaultRows);

        string automationName = isAdded
            ? string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", widget.Name, widget.Description, addedBadge)
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}", widget.Name, widget.Description);

        return new WidgetCardView(
            widget.Id,
            resolveIcon(widget.Id),
            widget.Name,
            widget.Description,
            Highlight(widget.Name, queryTrimmed),
            Highlight(widget.Description, queryTrimmed),
            isAdded,
            addedBadge,
            sizeText,
            showCategory,
            categoryLabel,
            automationName);
    }
}

/// <summary>
/// Canonical metadata for the <c>WidgetPicker</c> feature surface — the native mirror of the web component at
/// web/src/features/dashboard/components/WidgetPicker.tsx. The diagnostics <see cref="Slug"/> is the stable
/// surface name emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class WidgetPickerRegistration
{
    /// <summary>The stable surface id.</summary>
    public const string Id = "widget-picker";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "WidgetPicker";

    /// <summary>Segoe Fluent "Search" glyph — the native stand-in for the web Lucide <c>Search</c> icon.</summary>
    public const string SearchGlyph = "\uE721";

    /// <summary>Segoe Fluent "Clock"/recent glyph — the native stand-in for the web Lucide <c>Clock</c> icon.</summary>
    public const string RecentGlyph = "\uE823";

    /// <summary>Segoe Fluent "CheckMark" glyph — the native stand-in for the web Lucide <c>Check</c> icon.</summary>
    public const string CheckGlyph = "\uE73E";
}

/// <summary>
/// PII-safe diagnostics for the <c>WidgetPicker</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never a widget id, a widget name, a search query or a preset
/// name — so a diagnostics line can never leak which widgets a user browses, searches for or adds. Thread-safe.
/// </summary>
public sealed class WidgetPickerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _widgetsAdded;
    private long _presetsApplied;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public WidgetPickerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of widgets added through the picker (counts, never ids).</summary>
    public long WidgetsAdded => Interlocked.Read(ref _widgetsAdded);

    /// <summary>Number of presets applied through the picker.</summary>
    public long PresetsApplied => Interlocked.Read(ref _presetsApplied);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WidgetPicker</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WidgetPickerRegistration.Slug}");
    }

    /// <summary>
    /// Record that <paramref name="count"/> widgets were added, emitting <c>widget.added slug=WidgetPicker
    /// count=N</c> — the count only, never which widgets.
    /// </summary>
    /// <param name="count">The number of widgets added in the batch (must be positive to record).</param>
    public void RecordWidgetsAdded(int count)
    {
        if (count <= 0)
        {
            return;
        }

        Interlocked.Add(ref _widgetsAdded, count);
        _sink?.Invoke(string.Format(
            CultureInfo.InvariantCulture,
            "widget.added slug={0} count={1}",
            WidgetPickerRegistration.Slug,
            count));
    }

    /// <summary>Record that a preset was applied, emitting <c>preset.applied slug=WidgetPicker</c> (no id).</summary>
    public void RecordPresetApplied()
    {
        Interlocked.Increment(ref _presetsApplied);
        _sink?.Invoke($"preset.applied slug={WidgetPickerRegistration.Slug}");
    }
}
