using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The render-time data model the <c>TemplateGallery</c> surface binds to — the native projection of the data
/// the web component renders (web/src/features/dashboard/components/TemplateGallery.tsx). The web props are
/// <c>{ open, onClose, onApply }</c>; <c>open</c> and the two callbacks are modelled on the view (an
/// <c>Open</c> property and the <c>Apply</c> / <c>Close</c> events) rather than here, so this model stays a
/// pure value carrying only the <see cref="Templates"/> the gallery lists (the web static
/// <c>DASHBOARD_PRESETS</c> import). Construct through <see cref="Create"/> or use the canonical
/// <see cref="Default"/> so the list is never null. Unit-tested without a UI host.
/// </summary>
/// <param name="Templates">The preset dashboards the gallery offers (web <c>DASHBOARD_PRESETS</c>).</param>
public sealed record TemplateGalleryModel(IReadOnlyList<DashboardTemplate> Templates)
{
    /// <summary>The canonical model bound to the full preset catalog (web <c>DASHBOARD_PRESETS</c>).</summary>
    public static TemplateGalleryModel Default { get; } = new(DashboardPresets.All);

    /// <summary>The empty model — no preset templates (the gallery still offers the blank option).</summary>
    public static TemplateGalleryModel Empty { get; } = new(Array.Empty<DashboardTemplate>());

    /// <summary>Build a model, coalescing a null list to empty so the projection never iterates null.</summary>
    /// <param name="templates">The preset dashboards, or null.</param>
    public static TemplateGalleryModel Create(IReadOnlyList<DashboardTemplate>? templates) =>
        new(templates ?? Array.Empty<DashboardTemplate>());

    /// <summary>The template with <paramref name="id"/>, or null (web <c>DASHBOARD_PRESETS.find(...)</c>).</summary>
    /// <param name="id">The preset id selected in the gallery.</param>
    public DashboardTemplate? Find(string? id)
    {
        if (id is null)
        {
            return null;
        }

        foreach (var template in Templates)
        {
            if (string.Equals(template.Id, id, StringComparison.Ordinal))
            {
                return template;
            }
        }

        return null;
    }
}

/// <summary>
/// One category chip on a gallery card — the native analogue of a web <c>useCategoryIcons</c> entry
/// (<c>{ Icon, category }</c> in web/src/features/dashboard/components/TemplateGallery.tsx). <see cref="Glyph"/>
/// is the Segoe Fluent glyph of the first widget in the category (web <c>def.icon</c>), or null when that
/// widget has no mapped glyph (the web renders nothing); <see cref="Category"/> is the raw category slug (the
/// chip's key) and <see cref="CategoryLabel"/> the localized tooltip / Narrator text (web
/// <c>title={category}</c>). Pure data.
/// </summary>
/// <param name="Glyph">The category icon glyph (web <c>def.icon</c>), or null.</param>
/// <param name="Category">The category slug (web <c>def.category</c>).</param>
/// <param name="CategoryLabel">The localized tooltip / accessible label (web <c>title={category}</c>).</param>
public sealed record TemplateCategoryIcon(string? Glyph, string Category, string CategoryLabel);

/// <summary>
/// One row in the detail view's widget list — the native analogue of a web mapped widget
/// (web/src/features/dashboard/components/TemplateGallery.tsx <c>template.widgets.map(...)</c>).
/// <see cref="Glyph"/> is the widget's Segoe Fluent glyph (web <c>def.icon</c>), or null when it has no mapped
/// glyph; <see cref="Name"/> is the localized widget name (web <c>def.name</c>). Rows whose widget id is not in
/// the catalog are dropped during projection (web <c>if (!def) return null</c>), so every row here has a name.
/// Pure data.
/// </summary>
/// <param name="Glyph">The widget icon glyph (web <c>def.icon</c>), or null.</param>
/// <param name="Name">The localized widget name (web <c>def.name</c>).</param>
public sealed record TemplateWidgetRow(string? Glyph, string Name);

/// <summary>
/// The render-ready "blank dashboard" option that opens the gallery grid — the native analogue of the web
/// blank <c>StaggerItem</c> (web/src/features/dashboard/components/TemplateGallery.tsx). It carries the
/// localized <see cref="Title"/> (web <c>t('templates.blank', 'Blank Dashboard')</c>), the localized
/// <see cref="Description"/> (web <c>t('templates.blank.desc', ...)</c>), the decorative <see cref="Glyph"/>
/// (web Lucide <c>LayoutGrid</c>) and the composed Narrator <see cref="AutomationName"/>. Selecting it applies
/// the <c>__blank__</c> sentinel (web <c>onApply('__blank__')</c>). Pure data.
/// </summary>
/// <param name="Title">The localized blank-option title (web <c>templates.blank</c>).</param>
/// <param name="Description">The localized blank-option description (web <c>templates.blank.desc</c>).</param>
/// <param name="Glyph">The decorative grid glyph (web Lucide <c>LayoutGrid</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the blank option.</param>
public sealed record TemplateBlankCardDisplay(string Title, string Description, string Glyph, string AutomationName);

/// <summary>
/// The render-ready view of one preset card in the gallery grid — the native analogue of the web
/// <c>TemplateCard</c> (web/src/features/dashboard/components/TemplateGallery.tsx). It carries the preset
/// <see cref="Id"/> (selecting the card opens its detail), the localized <see cref="Name"/> (web
/// <c>templates.${id}.name</c>), the <see cref="WidgetCount"/> badge value (web
/// <c>template.widgets.length</c>), the optional localized <see cref="Description"/> (web
/// <c>desc &amp;&amp; ...</c>), the <see cref="CategoryIcons"/> (web <c>useCategoryIcons</c>), the
/// <see cref="Preview"/> model the shared <see cref="MiniGridPreview"/> binds to and the composed Narrator
/// <see cref="AutomationName"/>. Pure data.
/// </summary>
/// <param name="Id">The preset id (web <c>template.id</c>).</param>
/// <param name="Name">The localized preset name (web <c>templates.${id}.name</c>).</param>
/// <param name="WidgetCount">The widget count badge value (web <c>template.widgets.length</c>).</param>
/// <param name="Description">The localized preset description, or null (web <c>desc &amp;&amp; ...</c>).</param>
/// <param name="CategoryIcons">The category chips (web <c>useCategoryIcons</c>).</param>
/// <param name="Preview">The preview model the shared <see cref="MiniGridPreview"/> renders.</param>
/// <param name="AutomationName">The composed Narrator name for the card.</param>
public sealed record TemplateCardDisplay(
    string Id,
    string Name,
    int WidgetCount,
    string? Description,
    IReadOnlyList<TemplateCategoryIcon> CategoryIcons,
    MiniGridPreviewModel Preview,
    string AutomationName);

/// <summary>
/// The fully projected gallery-grid view — everything the web component derives before returning the grid
/// branch (web/src/features/dashboard/components/TemplateGallery.tsx, the <c>: (</c> branch of the
/// <c>selectedTemplate ? ... : ...</c> ternary): the modal <see cref="Title"/> (web
/// <c>t('templates.title', 'Dashboard Templates')</c>), the <see cref="Blank"/> option, the preset
/// <see cref="Cards"/>, whether the preset list is <see cref="IsEmpty"/> (defensive — the blank option always
/// shows) plus the localized <see cref="EmptyMessage"/>, and the Narrator <see cref="AutomationName"/>. Pure
/// data so every state renders.
/// </summary>
/// <param name="Title">The modal title in gallery mode (web <c>templates.title</c>).</param>
/// <param name="Blank">The always-present blank-dashboard option.</param>
/// <param name="Cards">The preset cards, in catalog order.</param>
/// <param name="IsEmpty">True when there are no preset cards (the blank option still renders).</param>
/// <param name="EmptyMessage">The localized friendly note shown when there are no presets.</param>
/// <param name="AutomationName">The Narrator name for the gallery surface.</param>
public sealed record TemplateGalleryDisplay(
    string Title,
    TemplateBlankCardDisplay Blank,
    IReadOnlyList<TemplateCardDisplay> Cards,
    bool IsEmpty,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// The fully projected detail view — everything the web <c>TemplateDetail</c> derives before returning JSX
/// (web/src/features/dashboard/components/TemplateGallery.tsx, the <c>selectedTemplate ? (</c> branch): the
/// modal <see cref="Title"/> (web <c>t('templates.detail', 'Template Preview')</c>), the localized
/// <see cref="Name"/>, the optional <see cref="Description"/>, the <see cref="WidgetCountText"/> (web
/// <c>t('templates.widgetCount', '{{count}} widgets', { count })</c>), the per-widget <see cref="Widgets"/>
/// rows, the <see cref="Preview"/> model, the <see cref="BackLabel"/> / <see cref="ApplyLabel"/> action labels
/// and the Narrator <see cref="AutomationName"/>. Pure data.
/// </summary>
/// <param name="Id">The preset id (web <c>template.id</c>).</param>
/// <param name="Title">The modal title in detail mode (web <c>templates.detail</c>).</param>
/// <param name="Name">The localized preset name (web <c>templates.${id}.name</c>).</param>
/// <param name="Description">The localized preset description, or null (web <c>desc &amp;&amp; ...</c>).</param>
/// <param name="WidgetCountText">The localized "{{count}} widgets" line (web <c>templates.widgetCount</c>).</param>
/// <param name="Widgets">The per-widget rows (web <c>template.widgets.map</c>).</param>
/// <param name="Preview">The preview model the shared <see cref="MiniGridPreview"/> renders.</param>
/// <param name="BackLabel">The localized back-action label (web <c>common.back</c>).</param>
/// <param name="ApplyLabel">The localized apply-action label (web <c>templates.apply</c>).</param>
/// <param name="AutomationName">The Narrator name for the detail surface.</param>
public sealed record TemplateDetailDisplay(
    string Id,
    string Title,
    string Name,
    string? Description,
    string WidgetCountText,
    IReadOnlyList<TemplateWidgetRow> Widgets,
    MiniGridPreviewModel Preview,
    string BackLabel,
    string ApplyLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="TemplateGalleryModel"/> (and a selected template) to the render-ready
/// gallery / detail displays — the native port of
/// web/src/features/dashboard/components/TemplateGallery.tsx. It reproduces the web derivations exactly: the
/// gallery grid (blank option + a card per preset), the per-card category icons (the local
/// <c>useCategoryIcons</c> memo: first widget per category, max five), the detail view (preview, name,
/// description, widget-count line, per-widget rows skipping unknown ids like the web
/// <c>if (!def) return null</c>, back / apply actions) and the modal title that swaps with the selection. No
/// WinUI types — unit-tested without a UI host.
/// </summary>
public static class TemplateGalleryProjection
{
    /// <summary>Project the gallery-grid view (web's non-selected branch).</summary>
    /// <param name="model">The render-time data model (the preset templates).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static TemplateGalleryDisplay ProjectGallery(TemplateGalleryModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var cards = new List<TemplateCardDisplay>(model.Templates.Count);
        foreach (var template in model.Templates)
        {
            cards.Add(ProjectCard(template, localizer));
        }

        return new TemplateGalleryDisplay(
            Title: TemplateGalleryRegistration.GalleryTitle(localizer),
            Blank: ProjectBlank(localizer),
            Cards: cards,
            IsEmpty: cards.Count == 0,
            EmptyMessage: TemplateGalleryRegistration.EmptyMessage(localizer),
            AutomationName: TemplateGalleryRegistration.GalleryTitle(localizer));
    }

    /// <summary>Project the always-present blank-dashboard option (web blank <c>StaggerItem</c>).</summary>
    /// <param name="localizer">The i18n facade the labels resolve through.</param>
    public static TemplateBlankCardDisplay ProjectBlank(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var title = TemplateGalleryRegistration.BlankTitle(localizer);
        var description = TemplateGalleryRegistration.BlankDescription(localizer);
        return new TemplateBlankCardDisplay(
            Title: title,
            Description: description,
            Glyph: TemplateGalleryRegistration.BlankGlyph,
            AutomationName: Compose(title, description));
    }

    /// <summary>Project one preset card (web <c>TemplateCard</c>).</summary>
    /// <param name="template">The preset the card represents.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static TemplateCardDisplay ProjectCard(DashboardTemplate template, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(localizer);

        var name = TemplateGalleryRegistration.Name(localizer, template);
        var description = TemplateGalleryRegistration.Description(localizer, template.Id);
        var countText = TemplateGalleryRegistration.WidgetCountText(localizer, template.WidgetCount);

        return new TemplateCardDisplay(
            Id: template.Id,
            Name: name,
            WidgetCount: template.WidgetCount,
            Description: description,
            CategoryIcons: CategoryIcons(template, localizer),
            Preview: template.ToPreviewModel(),
            AutomationName: description is null
                ? Compose(name, countText)
                : Compose(name, countText, description));
    }

    /// <summary>
    /// The native port of the web <c>useCategoryIcons</c> memo: the first widget per distinct category, in
    /// placement order, capped at <see cref="TemplateGalleryRegistration.MaxCategoryIcons"/>. Widgets whose id
    /// is not in the catalog are skipped (web <c>getWidgetDef(...)</c> returning undefined).
    /// </summary>
    /// <param name="template">The preset whose widgets are scanned.</param>
    /// <param name="localizer">The i18n facade the category labels resolve through.</param>
    public static IReadOnlyList<TemplateCategoryIcon> CategoryIcons(DashboardTemplate template, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(localizer);

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var icons = new List<TemplateCategoryIcon>(TemplateGalleryRegistration.MaxCategoryIcons);

        foreach (var widget in template.Widgets)
        {
            if (!DashboardWidgetCatalog.TryGet(widget.WidgetId, out var def) || !seen.Add(def.Category))
            {
                continue;
            }

            icons.Add(new TemplateCategoryIcon(
                Glyph: DashboardWidgetCatalog.GlyphFor(widget.WidgetId),
                Category: def.Category,
                CategoryLabel: DashboardWidgetCatalog.CategoryLabel(localizer, def.Category)));

            if (icons.Count >= TemplateGalleryRegistration.MaxCategoryIcons)
            {
                break;
            }
        }

        return icons;
    }

    /// <summary>Project the detail view for a selected preset (web <c>TemplateDetail</c>).</summary>
    /// <param name="template">The selected preset.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static TemplateDetailDisplay ProjectDetail(DashboardTemplate template, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(localizer);

        var rows = new List<TemplateWidgetRow>(template.Widgets.Count);
        foreach (var widget in template.Widgets)
        {
            // web: const def = getWidgetDef(w.widgetId); if (!def) return null;
            if (!DashboardWidgetCatalog.TryGet(widget.WidgetId, out _))
            {
                continue;
            }

            rows.Add(new TemplateWidgetRow(
                Glyph: DashboardWidgetCatalog.GlyphFor(widget.WidgetId),
                Name: DashboardWidgetCatalog.Name(localizer, widget.WidgetId)));
        }

        return new TemplateDetailDisplay(
            Id: template.Id,
            Title: TemplateGalleryRegistration.DetailTitle(localizer),
            Name: TemplateGalleryRegistration.Name(localizer, template),
            Description: TemplateGalleryRegistration.Description(localizer, template.Id),
            WidgetCountText: TemplateGalleryRegistration.WidgetCountText(localizer, template.WidgetCount),
            Widgets: rows,
            Preview: template.ToPreviewModel(),
            BackLabel: TemplateGalleryRegistration.BackLabel(localizer),
            ApplyLabel: TemplateGalleryRegistration.ApplyLabel(localizer),
            AutomationName: TemplateGalleryRegistration.Name(localizer, template));
    }

    // Join non-empty parts into a single Narrator sentence (the web button reads its child text in order).
    private static string Compose(params string[] parts)
    {
        var kept = new List<string>(parts.Length);
        foreach (var part in parts)
        {
            if (!string.IsNullOrWhiteSpace(part))
            {
                kept.Add(part.Trim());
            }
        }

        return string.Join(". ", kept);
    }
}

/// <summary>
/// Canonical metadata for the <c>TemplateGallery</c> feature surface — the native mirror of the web component
/// at web/src/features/dashboard/components/TemplateGallery.tsx: the stable diagnostics slug, every i18n key
/// (with the same English fallback the web <c>t(...)</c> calls carry), the per-template name + description key
/// map (including the web's camelCase description keys), the <c>__blank__</c> apply sentinel and the Segoe
/// Fluent glyphs that stand in for the web Lucide icons (<c>LayoutGrid</c>, <c>ArrowLeft</c>, <c>Sparkles</c>).
/// UI-free so the metadata is asserted in tests.
/// </summary>
public static class TemplateGalleryRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TemplateGallery";

    /// <summary>The apply payload for the blank option (web <c>onApply('__blank__')</c>).</summary>
    public const string BlankApplyId = "__blank__";

    /// <summary>The maximum number of category chips per card (web <c>icons.slice(0, 5)</c>).</summary>
    public const int MaxCategoryIcons = 5;

    /// <summary>i18n key for the gallery modal title (web <c>t('templates.title', ...)</c>).</summary>
    public const string TitleKey = "templates.title";

    /// <summary>English fallback for <see cref="TitleKey"/>.</summary>
    public const string TitleFallback = "Dashboard Templates";

    /// <summary>i18n key for the detail modal title (web <c>t('templates.detail', ...)</c>).</summary>
    public const string DetailTitleKey = "templates.detail";

    /// <summary>English fallback for <see cref="DetailTitleKey"/>.</summary>
    public const string DetailTitleFallback = "Template Preview";

    /// <summary>i18n key for the blank-option title (web <c>t('templates.blank', ...)</c>).</summary>
    public const string BlankTitleKey = "templates.blank";

    /// <summary>English fallback for <see cref="BlankTitleKey"/>.</summary>
    public const string BlankTitleFallback = "Blank Dashboard";

    /// <summary>i18n key for the blank-option description (web <c>t('templates.blank.desc', ...)</c>).</summary>
    public const string BlankDescriptionKey = "templates.blank.desc";

    /// <summary>English fallback for <see cref="BlankDescriptionKey"/>.</summary>
    public const string BlankDescriptionFallback = "Start from scratch and add widgets manually";

    /// <summary>i18n key for the widget-count line (web <c>t('templates.widgetCount', ...)</c>).</summary>
    public const string WidgetCountKey = "templates.widgetCount";

    /// <summary>English fallback for <see cref="WidgetCountKey"/> (carries the <c>{{count}}</c> count token).</summary>
    public const string WidgetCountFallback = "{{count}} widgets";

    /// <summary>i18n key for the apply action (web <c>t('templates.apply', ...)</c>).</summary>
    public const string ApplyKey = "templates.apply";

    /// <summary>English fallback for <see cref="ApplyKey"/>.</summary>
    public const string ApplyFallback = "Use This Template";

    /// <summary>i18n key for the back action (web <c>t('common.back', ...)</c>).</summary>
    public const string BackKey = "common.back";

    /// <summary>English fallback for <see cref="BackKey"/>.</summary>
    public const string BackFallback = "Back";

    /// <summary>i18n key for the friendly empty-state note shown when no presets exist.</summary>
    public const string EmptyKey = "templates.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "No templates available";

    /// <summary>i18n key for the modal close affordance (the web Modal's close control).</summary>
    public const string CloseKey = "common.close";

    /// <summary>English fallback for <see cref="CloseKey"/>.</summary>
    public const string CloseFallback = "Close";

    /// <summary>Segoe Fluent "GridView" glyph — the native stand-in for the web Lucide <c>LayoutGrid</c>.</summary>
    public const string BlankGlyph = "\uE80A";

    /// <summary>Segoe Fluent "Back" glyph — the native stand-in for the web Lucide <c>ArrowLeft</c>.</summary>
    public const string BackGlyph = "\uE72B";

    /// <summary>Segoe Fluent "Sparkle" glyph — the native stand-in for the web Lucide <c>Sparkles</c>.</summary>
    public const string ApplyGlyph = "\uE734";

    /// <summary>Segoe Fluent "Cancel" glyph — the native stand-in for the web Modal close (X) control.</summary>
    public const string CloseGlyph = "\uE711";

    /// <summary>
    /// The web <c>TEMPLATE_DESCRIPTIONS</c> map (web/src/features/dashboard/components/TemplateGallery.tsx),
    /// keyed by preset id and carrying the i18n key (note the web uses camelCase description keys even though
    /// the preset ids are snake_case) plus the English fallback. A preset with no entry has no description (web
    /// <c>desc &amp;&amp; ...</c>).
    /// </summary>
    private static readonly Dictionary<string, (string Key, string Fallback)> Descriptions =
        new(StringComparer.Ordinal)
        {
            ["default"] = ("templates.default.desc", "Balanced overview of vehicle status, battery, climate, and recent drives"),
            ["commuter"] = ("templates.commuter.desc", "Essentials for your daily drive — range, charging, climate, and security"),
            ["fleet_manager"] = ("templates.fleetManager.desc", "Fleet-wide metrics, drive history, and charging analytics"),
            ["data_nerd"] = ("templates.dataNerd.desc", "Live signals, energy flow, and deep telemetry data"),
            ["charging_focus"] = ("templates.chargingFocus.desc", "Focus on charging status, costs, and energy flow"),
            ["security_monitor"] = ("templates.securityMonitor.desc", "Keep an eye on doors, windows, sentry events, and location"),
            ["road_trip"] = ("templates.roadTrip.desc", "Everything you need for a long drive — range, weather, tires, and maps"),
            ["performance"] = ("templates.performance.desc", "Track driving performance, efficiency, and vehicle health"),
            ["kiosk_wall"] = ("templates.kioskWall.desc", "Clean layout designed for always-on screens and kiosk mode"),
            ["minimal"] = ("templates.minimal.desc", "Just the essentials — battery, charging, climate, and navigation"),
        };

    /// <summary>The i18n key a preset's name resolves through (web <c>templates.${id}.name</c>).</summary>
    /// <param name="presetId">The preset id.</param>
    public static string NameKey(string presetId) => $"templates.{presetId}.name";

    /// <summary>The localized gallery modal title (web <c>templates.title</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string GalleryTitle(ILocalizer localizer) => Resolve(localizer, TitleKey, TitleFallback);

    /// <summary>The localized detail modal title (web <c>templates.detail</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string DetailTitle(ILocalizer localizer) => Resolve(localizer, DetailTitleKey, DetailTitleFallback);

    /// <summary>The localized blank-option title (web <c>templates.blank</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string BlankTitle(ILocalizer localizer) => Resolve(localizer, BlankTitleKey, BlankTitleFallback);

    /// <summary>The localized blank-option description (web <c>templates.blank.desc</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string BlankDescription(ILocalizer localizer) =>
        Resolve(localizer, BlankDescriptionKey, BlankDescriptionFallback);

    /// <summary>The localized apply-action label (web <c>templates.apply</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ApplyLabel(ILocalizer localizer) => Resolve(localizer, ApplyKey, ApplyFallback);

    /// <summary>The localized back-action label (web <c>common.back</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string BackLabel(ILocalizer localizer) => Resolve(localizer, BackKey, BackFallback);

    /// <summary>The localized empty-state note shown when no presets exist.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string EmptyMessage(ILocalizer localizer) => Resolve(localizer, EmptyKey, EmptyFallback);

    /// <summary>The localized modal close label (the web Modal close control).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string CloseLabel(ILocalizer localizer) => Resolve(localizer, CloseKey, CloseFallback);

    /// <summary>The localized preset name (web <c>t(`templates.${id}.name`, template.name)</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="template">The preset whose name is resolved (its English name is the fallback).</param>
    public static string Name(ILocalizer localizer, DashboardTemplate template)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(template);
        return localizer.GetString(NameKey(template.Id), template.NameFallback);
    }

    /// <summary>
    /// The localized preset description (web <c>t(desc.key, desc.fallback)</c>), or null when the preset has no
    /// description entry (web <c>desc &amp;&amp; ...</c>).
    /// </summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="presetId">The preset id.</param>
    public static string? Description(ILocalizer localizer, string presetId)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(presetId);
        return Descriptions.TryGetValue(presetId, out var entry)
            ? localizer.GetString(entry.Key, entry.Fallback)
            : null;
    }

    /// <summary>
    /// The localized "{{count}} widgets" line (web
    /// <c>t('templates.widgetCount', '{{count}} widgets', { count })</c>), with the i18next <c>{{count}}</c>
    /// count token substituted.
    /// </summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="count">The widget count.</param>
    public static string WidgetCountText(ILocalizer localizer, int count)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var template = localizer.GetString(WidgetCountKey, WidgetCountFallback);
        return template.Replace("{{count}}", count.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);
    }

    private static string Resolve(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>TemplateGallery</c> surface (P1/S11 diagnostics contract). Records the
/// operational <c>view.opened</c> event plus the preset-selection and apply actions. The only identifier ever
/// emitted is a preset id — a fixed, compile-time catalog slug (e.g. <c>fleet_manager</c>, or the
/// <c>__blank__</c> sentinel) — never any dashboard, widget or fleet content, so a diagnostics line can never
/// leak user state. Thread-safe.
/// </summary>
public sealed class TemplateGalleryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _selections;
    private long _applies;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or null.</param>
    public TemplateGalleryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times a preset has been selected (its detail opened).</summary>
    public long Selections => Interlocked.Read(ref _selections);

    /// <summary>Number of times a template (or the blank option) has been applied.</summary>
    public long Applies => Interlocked.Read(ref _applies);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TemplateGallery</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TemplateGalleryRegistration.Slug}");
    }

    /// <summary>Record that a preset's detail was opened, emitting the selection line with its catalog id.</summary>
    /// <param name="presetId">The selected preset id (a fixed catalog slug, never PII).</param>
    public void RecordTemplateSelected(string presetId)
    {
        ArgumentNullException.ThrowIfNull(presetId);
        Interlocked.Increment(ref _selections);
        _sink?.Invoke($"template.selected slug={TemplateGalleryRegistration.Slug} id={presetId}");
    }

    /// <summary>
    /// Record that a template (or the blank option) was applied, emitting the apply line with its catalog id
    /// (web <c>onApply(presetId)</c>; the blank option passes <see cref="TemplateGalleryRegistration.BlankApplyId"/>).
    /// </summary>
    /// <param name="presetId">The applied preset id, or the blank sentinel (a fixed catalog slug, never PII).</param>
    public void RecordTemplateApplied(string presetId)
    {
        ArgumentNullException.ThrowIfNull(presetId);
        Interlocked.Increment(ref _applies);
        _sink?.Invoke($"template.applied slug={TemplateGalleryRegistration.Slug} id={presetId}");
    }
}
