using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The render-time data model the <c>AddWidgetButton</c> surface binds to — the native analogue of the web
/// <c>AddWidgetButtonProps</c> (<c>{ onClick, isEditing }</c> in
/// web/src/features/dashboard/components/AddWidgetButton.tsx). The web component is a purely presentational,
/// dependency-free fragment: it fetches nothing, so there is no loading / empty / error / stale / offline
/// branch to reproduce here (those belong to data-backed surfaces). Only the <see cref="IsEditing"/> flag
/// drives what renders — when the dashboard is in edit mode the floating action button hides (web
/// <c>return null</c>), because the dashboard header already exposes its own "Add Widget" action. The click
/// callback (web <c>onClick</c>) is modelled as the view's <c>Click</c> event rather than a field, so this
/// model stays a pure, UI-free value. Unit-tested without a UI host.
/// </summary>
/// <param name="IsEditing">Whether the dashboard is in edit mode (web <c>isEditing</c>); hides the FAB when true.</param>
public sealed record AddWidgetButtonModel(bool IsEditing)
{
    /// <summary>The default model — the FAB shown (the dashboard is not in edit mode).</summary>
    public static AddWidgetButtonModel Visible { get; } = new(false);

    /// <summary>The edit-mode model — the FAB hidden (the header owns the add action).</summary>
    public static AddWidgetButtonModel Editing { get; } = new(true);
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="AddWidgetButtonModel"/> — everything the web
/// component derives before returning JSX: whether the floating button is shown at all (web
/// <c>if (isEditing) return null</c>), the localized <see cref="Label"/> (web
/// <c>t('dashboard.addWidget', 'Add Widget')</c>) reused for the tooltip content and the accessible name, and
/// the composed Narrator <see cref="AutomationName"/>. Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="IsVisible">True when the FAB renders; false in edit mode (web <c>return null</c>).</param>
/// <param name="Label">The resolved button label.</param>
/// <param name="AutomationName">The Narrator name for the button (web <c>aria-label</c>).</param>
/// <param name="TooltipHint">The tooltip text shown on hover/focus (web <c>Tooltip content</c>).</param>
public sealed record AddWidgetButtonDisplay(
    bool IsVisible,
    string Label,
    string AutomationName,
    string TooltipHint);

/// <summary>
/// Pure projection from an <see cref="AddWidgetButtonModel"/> to its <see cref="AddWidgetButtonDisplay"/> —
/// the native port of web/src/features/dashboard/components/AddWidgetButton.tsx. Reproduces the web
/// derivations exactly: visibility is <c>!isEditing</c> (the web early <c>return null</c>), and the single
/// label is the resolved <c>dashboard.addWidget</c> string, reused verbatim for the tooltip content (web
/// <c>Tooltip content</c>) and the button <c>aria-label</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AddWidgetButtonProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display, resolving copy via <paramref name="localizer"/>.</summary>
    /// <param name="model">The render-time data model (the web props minus the click callback).</param>
    /// <param name="localizer">The i18n facade resolving the single label key.</param>
    public static AddWidgetButtonDisplay Project(AddWidgetButtonModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var label = AddWidgetButtonRegistration.Label(localizer);
        return new AddWidgetButtonDisplay(
            IsVisible: !model.IsEditing,
            Label: label,
            AutomationName: label,
            TooltipHint: label);
    }
}

/// <summary>
/// Canonical metadata for the <c>AddWidgetButton</c> feature surface — the native mirror of the web component
/// at web/src/features/dashboard/components/AddWidgetButton.tsx: the stable diagnostics slug, the single i18n
/// key (with the same English fallback the web <c>t(...)</c> call carries) and the Segoe Fluent Icons glyph
/// that stands in for the web Lucide <c>Plus</c> icon. UI-free so the metadata is asserted in tests.
/// </summary>
public static class AddWidgetButtonRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "AddWidgetButton";

    /// <summary>The i18n key for the button label (web <c>t('dashboard.addWidget', ...)</c>).</summary>
    public const string LabelKey = "dashboard.addWidget";

    /// <summary>The English fallback the web <c>t(...)</c> call carries for <see cref="LabelKey"/>.</summary>
    public const string LabelFallback = "Add Widget";

    /// <summary>Segoe Fluent "Add" glyph — the native stand-in for the web Lucide <c>Plus</c> icon.</summary>
    public const string AddGlyph = "\uE710";

    /// <summary>The localized button label (tooltip content + accessible name).</summary>
    public static string Label(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LabelKey, LabelFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AddWidgetButton</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event and the data-free catalogue-open activation with the surface slug —
/// never any dashboard or widget content — so a diagnostics line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class AddWidgetButtonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _activations;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AddWidgetButtonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the FAB has been activated (the widget catalogue requested).</summary>
    public long Activations => Interlocked.Read(ref _activations);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AddWidgetButton</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AddWidgetButtonRegistration.Slug}");
    }

    /// <summary>Record that the FAB was activated, emitting <c>add-widget.activated slug=AddWidgetButton</c>.</summary>
    public void RecordActivated()
    {
        Interlocked.Increment(ref _activations);
        _sink?.Invoke($"add-widget.activated slug={AddWidgetButtonRegistration.Slug}");
    }
}
