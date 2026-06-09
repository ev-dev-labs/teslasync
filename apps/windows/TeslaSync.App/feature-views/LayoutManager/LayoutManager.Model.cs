using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state of the <see cref="LayoutManagerViewModel"/> — the honest native union
/// of what the web <c>LayoutManager</c> (web/src/features/dashboard/components/LayoutManager.tsx) can render.
/// The web component consumes no asynchronous data — it is fully prop-driven and its only hook is
/// <c>useTranslation('dashboard')</c> — so there is deliberately no loading / error / stale / offline branch to
/// mirror. The two states the layout collection can yield are therefore <see cref="Ready"/> (one or more saved
/// layouts → the scrollable tab strip) and <see cref="Empty"/> (no saved layouts → a friendly inline hint shown
/// alongside the always-present "New Layout" affordance, never a blank box).
/// </summary>
public enum LayoutManagerState
{
    /// <summary>At least one saved layout exists — render the tab strip.</summary>
    Ready,

    /// <summary>No saved layouts exist — render the friendly empty hint beside the "New Layout" affordance.</summary>
    Empty,
}

/// <summary>
/// The action a layout context-menu entry performs — the native union of the web context-menu items
/// (web/src/features/dashboard/components/LayoutManager.tsx: <c>Rename</c>, <c>Duplicate</c>, <c>Settings</c>,
/// <c>Delete</c>). Kept UI-free so the per-state menu projection is unit-tested without a XAML host.
/// </summary>
public enum LayoutAction
{
    /// <summary>Begin inline rename of the layout (web <c>startRename</c>).</summary>
    Rename,

    /// <summary>Duplicate the layout (web <c>onDuplicate</c>).</summary>
    Duplicate,

    /// <summary>Open the layout's settings (web <c>onOpenSettings</c>).</summary>
    Settings,

    /// <summary>Delete the layout (web <c>onDelete</c>); disabled for the default layout.</summary>
    Delete,
}

/// <summary>
/// One saved dashboard layout backing the surface — the native subset of the web <c>SavedDashboard</c> shape
/// (web/src/features/dashboard/widgets/types.ts) the <c>LayoutManager</c> actually reads: the stable
/// <see cref="Id"/>, the display <see cref="Name"/>, the optional emoji <see cref="Icon"/> (the web
/// <c>d.icon ?? '📊'</c> fallback is applied at projection time) and the <see cref="IsDefault"/> flag that both
/// shows the "default" badge and disables deletion. Pure data so the projection is unit-tested headlessly.
/// </summary>
/// <param name="Id">The stable layout id (web <c>d.id</c>); the active-layout match is by this value.</param>
/// <param name="Name">The display name (web <c>d.name</c>).</param>
/// <param name="Icon">The optional emoji icon (web <c>d.icon</c>); a null / empty value falls back at projection.</param>
/// <param name="IsDefault">True for the built-in default layout (web <c>d.isDefault</c>).</param>
public sealed record LayoutDashboard(string Id, string Name, string? Icon, bool IsDefault);

/// <summary>
/// A projected, render-ready layout tab — the output of <see cref="LayoutManagerProjection"/> for one
/// <see cref="LayoutDashboard"/>. Carries the resolved <see cref="IconGlyph"/> (web <c>d.icon ?? '📊'</c>), the
/// display <see cref="Name"/>, whether the tab is the <see cref="IsActive"/> selection, the <see cref="IsDefault"/>
/// flag, the localized <see cref="DefaultBadge"/> shown only for the default layout, and the composed
/// <see cref="AutomationName"/> a screen reader announces. Immutable so the view is a thin renderer.
/// </summary>
/// <param name="Id">The stable layout id this tab switches to.</param>
/// <param name="Name">The display name.</param>
/// <param name="IconGlyph">The resolved emoji glyph (icon, or the bar-chart fallback).</param>
/// <param name="IsActive">True when this tab is the active layout (web <c>d.id === activeId</c>).</param>
/// <param name="IsDefault">True for the default layout (badge shown, delete disabled).</param>
/// <param name="DefaultBadge">The localized "default" badge text, or <see langword="null"/> when not default.</param>
/// <param name="AutomationName">The Narrator name (the layout name, suffixed with the badge when default).</param>
public sealed record LayoutTab(
    string Id,
    string Name,
    string IconGlyph,
    bool IsActive,
    bool IsDefault,
    string? DefaultBadge,
    string AutomationName);

/// <summary>
/// A projected context-menu entry — the render-ready form of one web context-menu item
/// (web/src/features/dashboard/components/LayoutManager.tsx). Carries the <see cref="Action"/> it performs, the
/// localized <see cref="Label"/>, the Segoe Fluent <see cref="Glyph"/> standing in for the web lucide icon,
/// whether it is the destructive <see cref="IsDanger"/> entry, and whether it <see cref="IsEnabled"/> (the web
/// <c>Delete</c> is disabled for the default layout). Pure data so the menu is unit-tested headlessly.
/// </summary>
/// <param name="Action">The action this entry performs.</param>
/// <param name="Label">The localized entry label.</param>
/// <param name="Glyph">The Segoe Fluent glyph for the entry (web lucide-icon analogue).</param>
/// <param name="IsDanger">True for the destructive delete entry (web <c>danger</c>).</param>
/// <param name="IsEnabled">False when the entry is disabled (web <c>disabled</c> — default layout delete).</param>
public sealed record LayoutMenuItem(
    LayoutAction Action,
    string Label,
    string Glyph,
    bool IsDanger,
    bool IsEnabled);

/// <summary>
/// The fully projected, render-ready view of the whole surface — the native analogue of the web
/// <c>LayoutManager</c> render output (web/src/features/dashboard/components/LayoutManager.tsx). Bundles the
/// chosen <see cref="State"/>, the projected <see cref="Tabs"/>, the always-present "New Layout" affordance copy
/// (<see cref="NewLayoutLabel"/> / <see cref="NewLayoutGlyph"/>), the inline create/rename editor copy (the field
/// hint and the confirm/cancel labels + glyphs that back the web <c>aria-label</c>s), the four context-menu
/// labels, the localized <see cref="DefaultBadge"/>, the accessibility <see cref="RegionName"/> and the friendly
/// <see cref="EmptyMessage"/>. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="State">The chosen render state.</param>
/// <param name="Tabs">The projected, localized layout tabs (empty in the <see cref="LayoutManagerState.Empty"/> state).</param>
/// <param name="NewLayoutLabel">The "New Layout" affordance label (web <c>t('dashboard.newLayout')</c>).</param>
/// <param name="NewLayoutGlyph">The Segoe Fluent add glyph for the affordance (web lucide <c>Plus</c>).</param>
/// <param name="NewNameHint">The inline create field hint (web <c>t('dashboard.newName')</c>).</param>
/// <param name="ConfirmRenameLabel">The confirm-rename Narrator label (web <c>t('dashboard.confirmRename')</c>).</param>
/// <param name="CancelRenameLabel">The cancel-rename Narrator label (web <c>t('dashboard.cancelRename')</c>).</param>
/// <param name="ConfirmCreateLabel">The confirm-create Narrator label (web <c>t('dashboard.confirmCreate')</c>).</param>
/// <param name="CancelCreateLabel">The cancel-create Narrator label (web <c>t('dashboard.cancelCreate')</c>).</param>
/// <param name="ConfirmGlyph">The Segoe Fluent check glyph for both confirm affordances (web lucide <c>Check</c>).</param>
/// <param name="CancelGlyph">The Segoe Fluent cancel glyph for both cancel affordances (web lucide <c>X</c>).</param>
/// <param name="RenameLabel">The rename menu label (web <c>t('dashboard.rename')</c>).</param>
/// <param name="DuplicateLabel">The duplicate menu label (web <c>t('dashboard.duplicate')</c>).</param>
/// <param name="SettingsLabel">The settings menu label (web <c>t('dashboard.settings')</c>).</param>
/// <param name="DeleteLabel">The delete menu label (web <c>t('dashboard.delete')</c>).</param>
/// <param name="DefaultBadge">The localized "default" badge text (web <c>t('dashboard.default')</c>).</param>
/// <param name="RegionName">The localized Narrator landmark name for the whole strip.</param>
/// <param name="EmptyMessage">The friendly inline empty-state message shown when no layouts exist.</param>
public sealed record LayoutManagerDisplay(
    LayoutManagerState State,
    IReadOnlyList<LayoutTab> Tabs,
    string NewLayoutLabel,
    string NewLayoutGlyph,
    string NewNameHint,
    string ConfirmRenameLabel,
    string CancelRenameLabel,
    string ConfirmCreateLabel,
    string CancelCreateLabel,
    string ConfirmGlyph,
    string CancelGlyph,
    string RenameLabel,
    string DuplicateLabel,
    string SettingsLabel,
    string DeleteLabel,
    string DefaultBadge,
    string RegionName,
    string EmptyMessage);

/// <summary>
/// Pure projection from the injected <see cref="LayoutDashboard"/> collection to the render-ready
/// <see cref="LayoutManagerDisplay"/> — the native port of the web <c>LayoutManager</c> render
/// (web/src/features/dashboard/components/LayoutManager.tsx). It resolves every owned string through the i18n
/// facade using the web's <c>dashboard.*</c> keys (with the web English fallbacks), applies the web emoji
/// fallback (<c>d.icon ?? '📊'</c>), marks the active tab (<c>d.id === activeId</c>), and composes the per-tab
/// Narrator name and the per-layout context menu (with the web rule that <c>Delete</c> is disabled for the
/// default layout). WinUI-free so it is unit-tested without a UI host. No SI conversion applies — the surface
/// carries no measurements.
/// </summary>
public static class LayoutManagerProjection
{
    /// <summary>i18n key + English fallback for the confirm-rename label (web <c>t('dashboard.confirmRename')</c>).</summary>
    public const string ConfirmRenameKey = "dashboard.confirmRename";

    /// <summary>i18n key + English fallback for the cancel-rename label (web <c>t('dashboard.cancelRename')</c>).</summary>
    public const string CancelRenameKey = "dashboard.cancelRename";

    /// <summary>i18n key + English fallback for the "default" badge (web <c>t('dashboard.default')</c>).</summary>
    public const string DefaultKey = "dashboard.default";

    /// <summary>i18n key + English fallback for the inline create field hint (web <c>t('dashboard.newName')</c>).</summary>
    public const string NewNameKey = "dashboard.newName";

    /// <summary>i18n key + English fallback for the confirm-create label (web <c>t('dashboard.confirmCreate')</c>).</summary>
    public const string ConfirmCreateKey = "dashboard.confirmCreate";

    /// <summary>i18n key + English fallback for the cancel-create label (web <c>t('dashboard.cancelCreate')</c>).</summary>
    public const string CancelCreateKey = "dashboard.cancelCreate";

    /// <summary>i18n key + English fallback for the "New Layout" affordance (web <c>t('dashboard.newLayout')</c>).</summary>
    public const string NewLayoutKey = "dashboard.newLayout";

    /// <summary>i18n key + English fallback for the rename menu entry (web <c>t('dashboard.rename')</c>).</summary>
    public const string RenameKey = "dashboard.rename";

    /// <summary>i18n key + English fallback for the duplicate menu entry (web <c>t('dashboard.duplicate')</c>).</summary>
    public const string DuplicateKey = "dashboard.duplicate";

    /// <summary>i18n key + English fallback for the settings menu entry (web <c>t('dashboard.settings')</c>).</summary>
    public const string SettingsKey = "dashboard.settings";

    /// <summary>i18n key + English fallback for the delete menu entry (web <c>t('dashboard.delete')</c>).</summary>
    public const string DeleteKey = "dashboard.delete";

    /// <summary>i18n key for the strip's accessibility landmark name (native a11y addition).</summary>
    public const string RegionKey = "dashboard.layoutsRegion";

    /// <summary>i18n key for the friendly empty-state message (native empty-surface addition).</summary>
    public const string EmptyKey = "dashboard.noLayouts";

    /// <summary>The emoji icon fallback for a layout with no icon (web <c>'📊'</c>, U+1F4CA bar chart).</summary>
    public const string DefaultIcon = "\U0001F4CA";

    /// <summary>Segoe Fluent "Add" glyph for the "New Layout" affordance (web lucide <c>Plus</c>).</summary>
    public const string AddGlyph = "\uE710";

    /// <summary>Segoe Fluent "Accept" check glyph for the confirm affordances (web lucide <c>Check</c>).</summary>
    public const string ConfirmGlyph = "\uE73E";

    /// <summary>Segoe Fluent "Cancel" glyph for the cancel affordances (web lucide <c>X</c>).</summary>
    public const string CancelGlyph = "\uE711";

    /// <summary>Segoe Fluent "Edit" glyph for the rename entry (web lucide <c>Pencil</c>).</summary>
    public const string RenameGlyph = "\uE70F";

    /// <summary>Segoe Fluent "Copy" glyph for the duplicate entry (web lucide <c>Copy</c>).</summary>
    public const string DuplicateGlyph = "\uE8C8";

    /// <summary>Segoe Fluent "Setting" glyph for the settings entry (web lucide <c>Settings</c>).</summary>
    public const string SettingsGlyph = "\uE713";

    /// <summary>Segoe Fluent "Delete" glyph for the delete entry (web lucide <c>Trash2</c>).</summary>
    public const string DeleteGlyph = "\uE74D";

    /// <summary>
    /// Project <paramref name="dashboards"/> and the active id into the render-ready display, resolving every
    /// owned string through <paramref name="localizer"/>. A <see langword="null"/> / empty collection yields the
    /// <see cref="LayoutManagerState.Empty"/> state (with no tabs); each tab's icon falls back to the web
    /// bar-chart emoji and the active tab is the one whose id equals <paramref name="activeId"/>.
    /// </summary>
    /// <param name="dashboards">The saved layouts to project (null is treated as empty).</param>
    /// <param name="activeId">The active layout id (web <c>activeId</c>); null matches nothing.</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public static LayoutManagerDisplay Project(
        IReadOnlyList<LayoutDashboard>? dashboards,
        string? activeId,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<LayoutDashboard> source = dashboards ?? Array.Empty<LayoutDashboard>();
        string defaultBadge = localizer.GetString(DefaultKey, "default");

        var tabs = new List<LayoutTab>(source.Count);
        foreach (LayoutDashboard dashboard in source)
        {
            bool isActive = activeId is not null && string.Equals(dashboard.Id, activeId, StringComparison.Ordinal);
            string glyph = string.IsNullOrEmpty(dashboard.Icon) ? DefaultIcon : dashboard.Icon!;
            string name = dashboard.Name ?? string.Empty;
            string automationName = dashboard.IsDefault ? $"{name}, {defaultBadge}" : name;

            tabs.Add(new LayoutTab(
                Id: dashboard.Id,
                Name: name,
                IconGlyph: glyph,
                IsActive: isActive,
                IsDefault: dashboard.IsDefault,
                DefaultBadge: dashboard.IsDefault ? defaultBadge : null,
                AutomationName: automationName));
        }

        return new LayoutManagerDisplay(
            State: tabs.Count > 0 ? LayoutManagerState.Ready : LayoutManagerState.Empty,
            Tabs: tabs,
            NewLayoutLabel: localizer.GetString(NewLayoutKey, "New Layout"),
            NewLayoutGlyph: AddGlyph,
            NewNameHint: localizer.GetString(NewNameKey, "Layout name..."),
            ConfirmRenameLabel: localizer.GetString(ConfirmRenameKey, "Confirm rename"),
            CancelRenameLabel: localizer.GetString(CancelRenameKey, "Cancel rename"),
            ConfirmCreateLabel: localizer.GetString(ConfirmCreateKey, "Confirm create"),
            CancelCreateLabel: localizer.GetString(CancelCreateKey, "Cancel create"),
            ConfirmGlyph: ConfirmGlyph,
            CancelGlyph: CancelGlyph,
            RenameLabel: localizer.GetString(RenameKey, "Rename"),
            DuplicateLabel: localizer.GetString(DuplicateKey, "Duplicate"),
            SettingsLabel: localizer.GetString(SettingsKey, "Settings"),
            DeleteLabel: localizer.GetString(DeleteKey, "Delete"),
            DefaultBadge: defaultBadge,
            RegionName: localizer.GetString(RegionKey, "Dashboard layouts"),
            EmptyMessage: localizer.GetString(EmptyKey, "No layouts yet"));
    }

    /// <summary>
    /// Build the ordered context menu for one layout — the native port of the web menu
    /// (<c>Rename</c>, <c>Duplicate</c>, <c>Settings</c>, then the destructive <c>Delete</c>). The labels are read
    /// from <paramref name="display"/> (already localized) and <paramref name="isDefault"/> disables the delete
    /// entry exactly as the web <c>disabled={!!ctxDash.isDefault}</c> does.
    /// </summary>
    /// <param name="display">The projected display carrying the localized menu labels.</param>
    /// <param name="isDefault">True when the layout is the default (disables the delete entry).</param>
    public static IReadOnlyList<LayoutMenuItem> BuildMenu(LayoutManagerDisplay display, bool isDefault)
    {
        ArgumentNullException.ThrowIfNull(display);

        return new[]
        {
            new LayoutMenuItem(LayoutAction.Rename, display.RenameLabel, RenameGlyph, IsDanger: false, IsEnabled: true),
            new LayoutMenuItem(LayoutAction.Duplicate, display.DuplicateLabel, DuplicateGlyph, IsDanger: false, IsEnabled: true),
            new LayoutMenuItem(LayoutAction.Settings, display.SettingsLabel, SettingsGlyph, IsDanger: false, IsEnabled: true),
            new LayoutMenuItem(LayoutAction.Delete, display.DeleteLabel, DeleteGlyph, IsDanger: true, IsEnabled: !isDefault),
        };
    }

    /// <summary>
    /// Move the item at <paramref name="from"/> to <paramref name="to"/>, returning a new list — the pure
    /// reorder the web <c>onReorder(fromIndex, toIndex)</c> contract implies (drop-to-reposition). Out-of-range
    /// indices or a no-op move (<paramref name="from"/> == <paramref name="to"/>) return an unchanged copy, so a
    /// drag that lands on its origin leaves the order untouched (web <c>dragIndex !== targetIndex</c>).
    /// </summary>
    /// <typeparam name="T">The element type.</typeparam>
    /// <param name="items">The source order (null is treated as empty).</param>
    /// <param name="from">The source index.</param>
    /// <param name="to">The destination index.</param>
    public static IReadOnlyList<T> Reorder<T>(IReadOnlyList<T>? items, int from, int to)
    {
        var list = items is null ? new List<T>() : new List<T>(items);
        if (from < 0 || from >= list.Count || to < 0 || to >= list.Count || from == to)
        {
            return list;
        }

        T moved = list[from];
        list.RemoveAt(from);
        list.Insert(to, moved);
        return list;
    }
}

/// <summary>
/// Canonical metadata for the LayoutManager surface — the native anchor for the web component at
/// web/src/features/dashboard/components/LayoutManager.tsx. The diagnostics <see cref="Slug"/> is the stable
/// surface name emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class LayoutManagerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LayoutManager";
}

/// <summary>
/// PII-safe diagnostics for the LayoutManager surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a layout id, name or count — so a
/// diagnostics line can never leak anything user-specific. Thread-safe.
/// </summary>
public sealed class LayoutManagerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public LayoutManagerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LayoutManager</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LayoutManagerRegistration.Slug}");
    }
}
