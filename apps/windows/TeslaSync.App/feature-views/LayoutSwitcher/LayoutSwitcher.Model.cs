using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// One saved-dashboard summary the switcher needs — the native projection of the web
/// <c>SavedDashboard</c> shape (web/src/features/dashboard/widgets/types.ts) narrowed to the fields
/// <c>LayoutSwitcher</c> reads: the layout id, its display name, the optional per-vehicle scope
/// (<c>vehicleId</c>: <see langword="null"/> means "applies to all vehicles" / user-global, a value pins the
/// layout to that vehicle) and the shipped-default flag. The widgets/layouts payload the switcher never reads
/// is intentionally omitted. Pure data (no WinUI types) so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">The stable layout id (web <c>SavedDashboard.id</c>).</param>
/// <param name="Name">The layout display name (web <c>SavedDashboard.name</c>).</param>
/// <param name="VehicleId">The pinned vehicle id, or <see langword="null"/> for a user-global layout.</param>
/// <param name="IsDefault">True for the shipped default layout (web <c>SavedDashboard.isDefault</c>).</param>
public sealed record LayoutSummary(string Id, string Name, long? VehicleId, bool IsDefault);

/// <summary>
/// The selected-vehicle labels the switcher reads — the native analogue of the <c>vehicle</c> object returned
/// by the web <c>useSelectedVehicle()</c> hook (web/src/hooks/useSelectedVehicle.ts), narrowed to the two
/// fields the pinned-badge label uses (<c>vehicle.display_name</c> and <c>vehicle.vin</c>). A
/// <see langword="null"/> <see cref="LayoutSwitcherModel.SelectedVehicle"/> models the web <c>vehicle == null</c>
/// case (no vehicle selected / fleet not yet loaded). Pure data — no WinUI types.
/// </summary>
/// <param name="DisplayName">The vehicle's display name (web <c>vehicle.display_name</c>), or null.</param>
/// <param name="Vin">The vehicle VIN (web <c>vehicle.vin</c>), used when no display name exists, or null.</param>
public sealed record LayoutSwitcherVehicle(string? DisplayName, string? Vin);

/// <summary>
/// The complete set of inputs the <see cref="LayoutSwitcherProjection"/> renders from — the native bundle of
/// the web <c>LayoutSwitcher</c> props plus the two values it reads from <c>useSelectedVehicle()</c>
/// (web/src/features/dashboard/components/LayoutSwitcher.tsx). The capability flags mirror the web's optional
/// callbacks: a host that does not supply <c>onToggleEdit</c> / <c>onPinToVehicle</c> / <c>onDuplicate</c>
/// hides the edit button / the pin toggle and falls back from duplicate to create, exactly as the web's
/// <c>{onToggleEdit &amp;&amp; …}</c> / <c>{onPinToVehicle &amp;&amp; active &amp;&amp; …}</c> /
/// <c>onDuplicate ? … : …</c> guards do. Pure data — no WinUI types.
/// </summary>
/// <param name="Dashboards">The saved layouts (web <c>dashboards</c> prop).</param>
/// <param name="ActiveId">The active layout id (web <c>activeId</c> prop).</param>
/// <param name="Dirty">True when the active layout has unsaved changes (web <c>dirty</c> prop).</param>
/// <param name="EditMode">True when the dashboard is in edit mode (web <c>editMode</c> prop).</param>
/// <param name="SelectedVehicleId">The selected vehicle id used to scope the layout list (web <c>vehicleId</c>).</param>
/// <param name="SelectedVehicle">The selected vehicle labels for the pinned badge (web <c>vehicle</c>), or null.</param>
/// <param name="CanToggleEdit">Whether the host supplied <c>onToggleEdit</c> (shows the edit button).</param>
/// <param name="CanPin">Whether the host supplied <c>onPinToVehicle</c> (shows the pin toggle).</param>
/// <param name="CanDuplicate">Whether the host supplied <c>onDuplicate</c> (save-as duplicates rather than creates).</param>
public sealed record LayoutSwitcherModel(
    IReadOnlyList<LayoutSummary> Dashboards,
    string ActiveId,
    bool Dirty,
    bool EditMode,
    long? SelectedVehicleId,
    LayoutSwitcherVehicle? SelectedVehicle,
    bool CanToggleEdit,
    bool CanPin,
    bool CanDuplicate)
{
    /// <summary>The resting model: no layouts, nothing pinned, all host capabilities present.</summary>
    public static LayoutSwitcherModel Empty { get; } = new(
        Array.Empty<LayoutSummary>(),
        string.Empty,
        Dirty: false,
        EditMode: false,
        SelectedVehicleId: null,
        SelectedVehicle: null,
        CanToggleEdit: true,
        CanPin: true,
        CanDuplicate: true);

    /// <summary>The active layout (web <c>dashboards.find(id) ?? dashboards[0]</c>), or null when empty.</summary>
    public LayoutSummary? Active
    {
        get
        {
            foreach (LayoutSummary layout in Dashboards)
            {
                if (string.Equals(layout.Id, ActiveId, StringComparison.Ordinal))
                {
                    return layout;
                }
            }

            return Dashboards.Count > 0 ? Dashboards[0] : null;
        }
    }

    /// <summary>
    /// The layouts visible for the current vehicle scope (web <c>visible</c> filter): every user-global layout
    /// (<c>vehicleId == null</c>) plus any layout pinned to the selected vehicle.
    /// </summary>
    public IReadOnlyList<LayoutSummary> Visible =>
        Dashboards.Where(IsVisible).ToArray();

    private bool IsVisible(LayoutSummary layout)
    {
        if (layout.VehicleId is not { } scope)
        {
            return true;
        }

        return SelectedVehicleId is { } id && scope == id;
    }
}

/// <summary>
/// One render-ready row in the saved-layouts menu — the native analogue of the web
/// <c>visible.map(d =&gt; …)</c> <c>menuitemradio</c> button
/// (web/src/features/dashboard/components/LayoutSwitcher.tsx). Carries the layout id and name, whether it is
/// the active layout (web <c>isActive</c> → the trailing check + tinted row), whether to show the "default"
/// badge (web <c>d.isDefault</c>) and the pin glyph (web <c>d.vehicleId != null</c>), and a Narrator name that
/// folds in the default context. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">The layout id this row switches to.</param>
/// <param name="Name">The layout display name.</param>
/// <param name="IsActive">True when this is the active layout (web <c>isActive</c>).</param>
/// <param name="ShowDefaultBadge">True when the "default" badge should be shown (web <c>d.isDefault</c>).</param>
/// <param name="ShowPinGlyph">True when the pin glyph should be shown (web <c>d.vehicleId != null</c>).</param>
/// <param name="AutomationName">The Narrator name (the layout name, plus the default badge context).</param>
public sealed record LayoutMenuEntry(
    string Id,
    string Name,
    bool IsActive,
    bool ShowDefaultBadge,
    bool ShowPinGlyph,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view for the <see cref="LayoutSwitcher"/> surface — the native analogue
/// of the entire web <c>LayoutSwitcher</c> render output
/// (web/src/features/dashboard/components/LayoutSwitcher.tsx). Carries the trigger button chrome (the
/// uppercase "Layout" caption, the active layout name, the "modified" and pinned badges), the inline
/// edit / save-as / reset actions, every row of the saved-layouts menu (or the empty-state message), the
/// menu's new-layout / pin-toggle / reset items and footer, and the localized copy for the save-as prompt and
/// the reset confirmation. Pure data — no WinUI types — so the projection is unit-tested headlessly.
/// </summary>
public sealed record LayoutSwitcherDisplay
{
    /// <summary>The uppercase "Layout" caption on the trigger (web <c>t('layout.label')</c>, CSS-uppercased).</summary>
    public required string LabelText { get; init; }

    /// <summary>The active layout name shown on the trigger (web <c>activeName</c>).</summary>
    public required string ActiveName { get; init; }

    /// <summary>The trigger's Narrator name (web <c>aria-label</c> = <c>t('layout.switcherLabel')</c>).</summary>
    public required string SwitcherAutomationName { get; init; }

    /// <summary>True when the "modified" badge should be shown (web <c>dirty</c>).</summary>
    public required bool ShowModifiedBadge { get; init; }

    /// <summary>The "modified" badge text (web <c>t('layout.modified')</c>).</summary>
    public required string ModifiedText { get; init; }

    /// <summary>True when the pinned-vehicle badge should be shown (web <c>pinnedLabel != null</c>).</summary>
    public required bool ShowPinnedBadge { get; init; }

    /// <summary>The pinned-vehicle badge label, or null when not pinned (web <c>pinnedLabel</c>).</summary>
    public string? PinnedLabel { get; init; }

    /// <summary>True when the inline edit button should be shown (web <c>onToggleEdit</c> present).</summary>
    public required bool ShowEditButton { get; init; }

    /// <summary>True when the dashboard is in edit mode (web <c>editMode</c>; drives the pressed state).</summary>
    public required bool EditActive { get; init; }

    /// <summary>The inline edit button label — "Done" when editing, "Edit" otherwise (web ternary).</summary>
    public required string EditButtonLabel { get; init; }

    /// <summary>The inline edit button tooltip / Narrator name (web <c>t('layout.editTitle')</c>).</summary>
    public required string EditButtonTooltip { get; init; }

    /// <summary>The inline save-as button label (web <c>t('layout.saveAsShort')</c>).</summary>
    public required string SaveAsLabel { get; init; }

    /// <summary>The inline save-as button tooltip / Narrator name (web <c>t('layout.saveAs')</c>).</summary>
    public required string SaveAsTooltip { get; init; }

    /// <summary>The inline reset button tooltip / Narrator name (web <c>t('layout.reset')</c>).</summary>
    public required string ResetTooltip { get; init; }

    /// <summary>The menu's Narrator name (web <c>aria-label</c> = <c>t('layout.menuLabel')</c>).</summary>
    public required string MenuAutomationName { get; init; }

    /// <summary>True when no layouts are visible for the current vehicle (web <c>visible.length === 0</c>).</summary>
    public required bool IsEmpty { get; init; }

    /// <summary>The empty-state message (web <c>t('layout.noneVisible')</c>).</summary>
    public required string EmptyMessage { get; init; }

    /// <summary>The visible saved-layout rows (web <c>visible.map(...)</c>); empty when <see cref="IsEmpty"/>.</summary>
    public required IReadOnlyList<LayoutMenuEntry> Entries { get; init; }

    /// <summary>The "default" badge text reused by every default row (web <c>t('layout.defaultBadge')</c>).</summary>
    public required string DefaultBadgeText { get; init; }

    /// <summary>The "new layout from current" menu item label (web <c>t('layout.newFromCurrent')</c>).</summary>
    public required string NewFromCurrentLabel { get; init; }

    /// <summary>True when the pin-toggle menu item should be shown (web <c>onPinToVehicle &amp;&amp; active</c>).</summary>
    public required bool ShowPinToggle { get; init; }

    /// <summary>
    /// True when the pin toggle is actionable — false mirrors the web <c>disabled</c> guard
    /// (<c>active.vehicleId == null &amp;&amp; vehicleId == null</c>: nothing to pin to and nothing to unpin).
    /// </summary>
    public required bool PinToggleEnabled { get; init; }

    /// <summary>The pin-toggle label — "Unpin from vehicle" when pinned, "Pin to current vehicle" otherwise.</summary>
    public required string PinToggleLabel { get; init; }

    /// <summary>The destructive "reset to default" menu item label (web <c>t('layout.reset')</c>).</summary>
    public required string ResetItemLabel { get; init; }

    /// <summary>The menu footer hint (web <c>t('layout.menuFooter')</c>).</summary>
    public required string MenuFooterText { get; init; }

    /// <summary>The save-as prompt title (web <c>t('layout.saveAsPrompt')</c>).</summary>
    public required string SaveAsPromptTitle { get; init; }

    /// <summary>The save-as prompt's pre-filled suggestion (web <c>`${active.name} (Copy)`</c> / new-layout default).</summary>
    public required string SaveAsSuggestion { get; init; }

    /// <summary>The save-as prompt confirm-button label (web prompt OK; localized as <c>t('layout.saveAsShort')</c>).</summary>
    public required string SaveAsConfirmLabel { get; init; }

    /// <summary>The shared cancel label for the prompt and confirm dialogs (<c>t('common.cancel')</c>).</summary>
    public required string CancelLabel { get; init; }

    /// <summary>The reset confirmation title (web <c>t('layout.resetTitle')</c>).</summary>
    public required string ResetConfirmTitle { get; init; }

    /// <summary>The reset confirmation message (web <c>t('layout.resetMessage')</c>).</summary>
    public required string ResetConfirmMessage { get; init; }

    /// <summary>The reset confirmation primary-button label (web <c>t('layout.resetConfirm')</c>).</summary>
    public required string ResetConfirmLabel { get; init; }
}

/// <summary>
/// The pure projection from a <see cref="LayoutSwitcherModel"/> to the render-ready
/// <see cref="LayoutSwitcherDisplay"/> — the native port of the web <c>LayoutSwitcher</c> render
/// (web/src/features/dashboard/components/LayoutSwitcher.tsx). It reproduces the component branch-for-branch:
/// it resolves the active layout (<c>find(activeId) ?? dashboards[0]</c>), filters the visible layouts by the
/// selected-vehicle scope, computes the active name (<c>active?.name ?? t('layout.untitled')</c>) and the
/// pinned-badge label (<c>active.vehicleId != null &amp;&amp; vehicle</c>), composes every menu row, and
/// resolves every owned string through the i18n facade using the web's <c>dashboard</c>-namespaced keys. The
/// surface carries no measurements, so no SI conversion applies. There is deliberately no loading / stale /
/// error / offline branch because the web source has none — <c>LayoutSwitcher</c> is a controlled component
/// driven entirely by its props, not an asynchronous data read.
/// </summary>
public static class LayoutSwitcherProjection
{
    /// <summary>i18n key for the trigger's "Layout" caption (web <c>layout.label</c>).</summary>
    public const string LabelKey = "dashboard.layout.label";

    /// <summary>i18n key for the trigger's Narrator name (web <c>layout.switcherLabel</c>).</summary>
    public const string SwitcherLabelKey = "dashboard.layout.switcherLabel";

    /// <summary>i18n key for the "modified" badge (web <c>layout.modified</c>).</summary>
    public const string ModifiedKey = "dashboard.layout.modified";

    /// <summary>i18n key for the untitled-layout fallback name (web <c>layout.untitled</c>).</summary>
    public const string UntitledKey = "dashboard.layout.untitled";

    /// <summary>i18n key for the inline edit button tooltip (web <c>layout.editTitle</c>).</summary>
    public const string EditTitleKey = "dashboard.layout.editTitle";

    /// <summary>i18n key for the edit button label while editing (web <c>layout.editExit</c>).</summary>
    public const string EditExitKey = "dashboard.layout.editExit";

    /// <summary>i18n key for the edit button label when idle (web <c>layout.editEnter</c>).</summary>
    public const string EditEnterKey = "dashboard.layout.editEnter";

    /// <summary>i18n key for the inline save-as button tooltip (web <c>layout.saveAs</c>).</summary>
    public const string SaveAsKey = "dashboard.layout.saveAs";

    /// <summary>i18n key for the inline save-as button label (web <c>layout.saveAsShort</c>).</summary>
    public const string SaveAsShortKey = "dashboard.layout.saveAsShort";

    /// <summary>i18n key for the reset tooltip and the destructive reset menu item (web <c>layout.reset</c>).</summary>
    public const string ResetKey = "dashboard.layout.reset";

    /// <summary>i18n key for the menu's Narrator name (web <c>layout.menuLabel</c>).</summary>
    public const string MenuLabelKey = "dashboard.layout.menuLabel";

    /// <summary>i18n key for the empty-state message (web <c>layout.noneVisible</c>).</summary>
    public const string NoneVisibleKey = "dashboard.layout.noneVisible";

    /// <summary>i18n key for the per-row "default" badge (web <c>layout.defaultBadge</c>).</summary>
    public const string DefaultBadgeKey = "dashboard.layout.defaultBadge";

    /// <summary>i18n key for the "new layout from current" menu item (web <c>layout.newFromCurrent</c>).</summary>
    public const string NewFromCurrentKey = "dashboard.layout.newFromCurrent";

    /// <summary>i18n key for the unpin menu item (web <c>layout.unpin</c>).</summary>
    public const string UnpinKey = "dashboard.layout.unpin";

    /// <summary>i18n key for the pin menu item (web <c>layout.pin</c>).</summary>
    public const string PinKey = "dashboard.layout.pin";

    /// <summary>i18n key for the menu footer hint (web <c>layout.menuFooter</c>).</summary>
    public const string MenuFooterKey = "dashboard.layout.menuFooter";

    /// <summary>i18n key for the save-as prompt title (web <c>layout.saveAsPrompt</c>).</summary>
    public const string SaveAsPromptKey = "dashboard.layout.saveAsPrompt";

    /// <summary>i18n key for the new-layout default suggestion (web <c>layout.newLayoutDefault</c>).</summary>
    public const string NewLayoutDefaultKey = "dashboard.layout.newLayoutDefault";

    /// <summary>i18n key for the reset confirmation title (web <c>layout.resetTitle</c>).</summary>
    public const string ResetTitleKey = "dashboard.layout.resetTitle";

    /// <summary>i18n key for the reset confirmation message (web <c>layout.resetMessage</c>).</summary>
    public const string ResetMessageKey = "dashboard.layout.resetMessage";

    /// <summary>i18n key for the reset confirmation primary-button label (web <c>layout.resetConfirm</c>).</summary>
    public const string ResetConfirmKey = "dashboard.layout.resetConfirm";

    /// <summary>i18n key for the shared cancel label on the prompt / confirm dialogs (<c>common.cancel</c>).</summary>
    public const string CancelKey = "common.cancel";

    private const string LabelFallback = "Layout";
    private const string SwitcherLabelFallback = "Switch dashboard layout";
    private const string ModifiedFallback = "modified";
    private const string UntitledFallback = "Untitled";
    private const string EditTitleFallback = "Edit dashboard (E)";
    private const string EditExitFallback = "Done";
    private const string EditEnterFallback = "Edit";
    private const string SaveAsFallback = "Save as new layout";
    private const string SaveAsShortFallback = "Save as";
    private const string ResetFallback = "Reset to default";
    private const string MenuLabelFallback = "Saved layouts";
    private const string NoneVisibleFallback = "No layouts available for this vehicle.";
    private const string DefaultBadgeFallback = "default";
    private const string NewFromCurrentFallback = "New layout from current";
    private const string UnpinFallback = "Unpin from vehicle";
    private const string PinFallback = "Pin to current vehicle";
    private const string MenuFooterFallback = "Manage layouts in the tab strip below";
    private const string SaveAsPromptFallback = "Name for the new layout:";
    private const string NewLayoutDefaultFallback = "New Layout";
    private const string ResetTitleFallback = "Reset dashboard to default?";

    private const string ResetMessageFallback =
        "This removes all customizations and restores the shipped default dashboard. " +
        "Your other saved layouts are not affected.";

    private const string ResetConfirmFallback = "Reset";
    private const string CancelFallback = "Cancel";

    // The web composes the save-as suggestion inline as `${active.name} (Copy)`; this is not a t() key in the
    // source, so it is routed through the facade with the literal English fallback rather than claimed as a
    // catalog key.
    private const string CopySuffixKey = "dashboard.layout.copySuffix";
    private const string CopySuffixFallback = " (Copy)";

    /// <summary>
    /// Project <paramref name="model"/> into the render-ready display, resolving every owned string through
    /// <paramref name="localizer"/>.
    /// </summary>
    /// <param name="model">The switcher inputs (props + selected vehicle + host capabilities).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public static LayoutSwitcherDisplay Project(LayoutSwitcherModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        LayoutSummary? active = model.Active;
        IReadOnlyList<LayoutSummary> visible = model.Visible;

        string activeName = active is { } a && !string.IsNullOrEmpty(a.Name)
            ? a.Name
            : localizer.GetString(UntitledKey, UntitledFallback);

        string defaultBadge = localizer.GetString(DefaultBadgeKey, DefaultBadgeFallback);

        var entries = new List<LayoutMenuEntry>(visible.Count);
        foreach (LayoutSummary layout in visible)
        {
            bool isActive = active is { } current && string.Equals(layout.Id, current.Id, StringComparison.Ordinal);
            string name = string.IsNullOrEmpty(layout.Name)
                ? localizer.GetString(UntitledKey, UntitledFallback)
                : layout.Name;
            entries.Add(new LayoutMenuEntry(
                Id: layout.Id,
                Name: name,
                IsActive: isActive,
                ShowDefaultBadge: layout.IsDefault,
                ShowPinGlyph: layout.VehicleId is not null,
                AutomationName: layout.IsDefault
                    ? string.Create(CultureInfo.CurrentCulture, $"{name}, {defaultBadge}")
                    : name));
        }

        bool pinned = active?.VehicleId is not null;
        bool showPinToggle = model.CanPin && active is not null;

        return new LayoutSwitcherDisplay
        {
            LabelText = localizer.GetString(LabelKey, LabelFallback).ToUpperInvariant(),
            ActiveName = activeName,
            SwitcherAutomationName = localizer.GetString(SwitcherLabelKey, SwitcherLabelFallback),
            ShowModifiedBadge = model.Dirty,
            ModifiedText = localizer.GetString(ModifiedKey, ModifiedFallback),
            ShowPinnedBadge = TryPinnedLabel(model, active, out string? pinnedLabel),
            PinnedLabel = pinnedLabel,
            ShowEditButton = model.CanToggleEdit,
            EditActive = model.EditMode,
            EditButtonLabel = model.EditMode
                ? localizer.GetString(EditExitKey, EditExitFallback)
                : localizer.GetString(EditEnterKey, EditEnterFallback),
            EditButtonTooltip = localizer.GetString(EditTitleKey, EditTitleFallback),
            SaveAsLabel = localizer.GetString(SaveAsShortKey, SaveAsShortFallback),
            SaveAsTooltip = localizer.GetString(SaveAsKey, SaveAsFallback),
            ResetTooltip = localizer.GetString(ResetKey, ResetFallback),
            MenuAutomationName = localizer.GetString(MenuLabelKey, MenuLabelFallback),
            IsEmpty = visible.Count == 0,
            EmptyMessage = localizer.GetString(NoneVisibleKey, NoneVisibleFallback),
            Entries = entries,
            DefaultBadgeText = defaultBadge,
            NewFromCurrentLabel = localizer.GetString(NewFromCurrentKey, NewFromCurrentFallback),
            ShowPinToggle = showPinToggle,
            PinToggleEnabled = showPinToggle && (pinned || model.SelectedVehicleId is not null),
            PinToggleLabel = pinned
                ? localizer.GetString(UnpinKey, UnpinFallback)
                : localizer.GetString(PinKey, PinFallback),
            ResetItemLabel = localizer.GetString(ResetKey, ResetFallback),
            MenuFooterText = localizer.GetString(MenuFooterKey, MenuFooterFallback),
            SaveAsPromptTitle = localizer.GetString(SaveAsPromptKey, SaveAsPromptFallback),
            SaveAsSuggestion = SaveAsSuggestion(active, localizer),
            SaveAsConfirmLabel = localizer.GetString(SaveAsShortKey, SaveAsShortFallback),
            CancelLabel = localizer.GetString(CancelKey, CancelFallback),
            ResetConfirmTitle = localizer.GetString(ResetTitleKey, ResetTitleFallback),
            ResetConfirmMessage = localizer.GetString(ResetMessageKey, ResetMessageFallback),
            ResetConfirmLabel = localizer.GetString(ResetConfirmKey, ResetConfirmFallback),
        };
    }

    /// <summary>
    /// Compute the save-as prompt suggestion exactly as the web does:
    /// <c>active ? `${active.name} (Copy)` : t('layout.newLayoutDefault')</c>.
    /// </summary>
    /// <param name="active">The active layout, or null when there are no layouts.</param>
    /// <param name="localizer">The i18n facade resolving the new-layout default and the copy suffix.</param>
    public static string SaveAsSuggestion(LayoutSummary? active, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (active is not { } a || string.IsNullOrEmpty(a.Name))
        {
            return localizer.GetString(NewLayoutDefaultKey, NewLayoutDefaultFallback);
        }

        return a.Name + localizer.GetString(CopySuffixKey, CopySuffixFallback);
    }

    // pinnedLabel parity: web `active?.vehicleId != null && vehicle ? (display_name ?? vin ?? `#${id}`) : null`.
    private static bool TryPinnedLabel(LayoutSwitcherModel model, LayoutSummary? active, out string? label)
    {
        if (active?.VehicleId is { } vehicleId && model.SelectedVehicle is { } vehicle)
        {
            label = !string.IsNullOrEmpty(vehicle.DisplayName)
                ? vehicle.DisplayName
                : !string.IsNullOrEmpty(vehicle.Vin)
                    ? vehicle.Vin
                    : string.Create(CultureInfo.InvariantCulture, $"#{vehicleId}");
            return true;
        }

        label = null;
        return false;
    }
}

/// <summary>
/// Canonical metadata for the LayoutSwitcher surface — the native anchor for the web component at
/// web/src/features/dashboard/components/LayoutSwitcher.tsx. The diagnostics <see cref="Slug"/> is the stable
/// surface name emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class LayoutSwitcherRegistration
{
    /// <summary>The stable surface id.</summary>
    public const string Id = "layout-switcher";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LayoutSwitcher";
}

/// <summary>
/// PII-safe diagnostics for the LayoutSwitcher surface (P1/S11 diagnostics contract). Records only operational
/// counters with the surface slug — never a layout name, a vehicle id, a VIN or any user-entered text — so a
/// diagnostics line can never leak which dashboards a user keeps or what they named them. Thread-safe.
/// </summary>
public sealed class LayoutSwitcherDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _layoutsSwitched;
    private long _layoutsCreated;
    private long _layoutsReset;
    private long _pinsToggled;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public LayoutSwitcherDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of layout switches performed.</summary>
    public long LayoutsSwitched => Interlocked.Read(ref _layoutsSwitched);

    /// <summary>Number of save-as / duplicate actions performed.</summary>
    public long LayoutsCreated => Interlocked.Read(ref _layoutsCreated);

    /// <summary>Number of reset-to-default actions confirmed.</summary>
    public long LayoutsReset => Interlocked.Read(ref _layoutsReset);

    /// <summary>Number of pin / unpin toggles performed.</summary>
    public long PinsToggled => Interlocked.Read(ref _pinsToggled);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LayoutSwitcher</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LayoutSwitcherRegistration.Slug}");
    }

    /// <summary>Record a layout switch (no layout id or name is ever logged).</summary>
    public void RecordLayoutSwitched()
    {
        Interlocked.Increment(ref _layoutsSwitched);
        _sink?.Invoke($"layout.switched slug={LayoutSwitcherRegistration.Slug}");
    }

    /// <summary>Record a save-as / duplicate action (no name is ever logged).</summary>
    public void RecordLayoutCreated()
    {
        Interlocked.Increment(ref _layoutsCreated);
        _sink?.Invoke($"layout.created slug={LayoutSwitcherRegistration.Slug}");
    }

    /// <summary>Record a confirmed reset-to-default action.</summary>
    public void RecordLayoutReset()
    {
        Interlocked.Increment(ref _layoutsReset);
        _sink?.Invoke($"layout.reset slug={LayoutSwitcherRegistration.Slug}");
    }

    /// <summary>Record a pin / unpin toggle (no layout id or vehicle id is ever logged).</summary>
    public void RecordPinToggled()
    {
        Interlocked.Increment(ref _pinsToggled);
        _sink?.Invoke($"layout.pinToggled slug={LayoutSwitcherRegistration.Slug}");
    }
}
