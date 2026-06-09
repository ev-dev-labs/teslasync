using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>AddWidgetButton</c> feature surface — a parity port of
/// web/src/features/dashboard/components/AddWidgetButton.tsx. It composes the web fragment: a circular,
/// primary-filled floating action button carrying a bold "+" glyph (the web Lucide <c>Plus</c>) inside a
/// left-anchored <see cref="TsTooltip"/>, anchored to the bottom-right of its host so it clears the status
/// bar / tab bar stack (web <c>fixed bottom-20 right-6</c>). Clicking it raises <see cref="Click"/> — the
/// native analogue of the web <c>onClick</c> — which the host wires to open the widget catalogue. When the
/// dashboard is in edit mode the button hides (web <c>if (isEditing) return null</c>) because the dashboard
/// header already exposes an "Add Widget" action; the surface is purely presentational and fetches nothing,
/// so there is no loading / empty / error / stale / offline branch. The label resolves through the i18n
/// facade for both the tooltip and the Narrator name, and the decorative glyph is hidden from Narrator (web
/// <c>aria-hidden</c>). All UI-free decisions live in <see cref="AddWidgetButtonProjection"/> so they are
/// verified without a UI host.
/// </summary>
public sealed partial class AddWidgetButton : ContentControl
{
    private const double FabDiameter = 56;       // web `h-14 w-14`
    private const double IconFontSize = 28;      // web `<Icons.add className="h-8 w-8" />` at FAB scale
    private const double EdgeMarginRight = 24;   // web `right-6`
    private const double EdgeMarginBottom = 80;  // web `bottom-20`

    /// <summary>Whether the dashboard is in edit mode (web <c>isEditing</c>); hides the FAB when true.</summary>
    public static readonly DependencyProperty IsEditingProperty = DependencyProperty.Register(
        nameof(IsEditing), typeof(bool), typeof(AddWidgetButton),
        new PropertyMetadata(false, OnIsEditingChanged));

    private readonly ILocalizer _localizer;
    private readonly AddWidgetButtonDiagnostics _diagnostics;
    private readonly TsTooltip _tooltip = new();
    private readonly TsButton _button;

    private bool _opened;

    /// <summary>Creates the surface over its localizer and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade resolving the button label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AddWidgetButton(ILocalizer localizer, AddWidgetButtonDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _diagnostics = diagnostics ?? new AddWidgetButtonDiagnostics();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Right;
        VerticalAlignment = VerticalAlignment.Bottom;
        HorizontalContentAlignment = HorizontalAlignment.Right;
        VerticalContentAlignment = VerticalAlignment.Bottom;
        Margin = new Thickness(0, 0, EdgeMarginRight, EdgeMarginBottom);

        _button = BuildButton();
        _tooltip.Content = _button;
        Content = _tooltip;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the FAB is activated — the native analogue of the web <c>onClick</c>.</summary>
    public event RoutedEventHandler? Click;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AddWidgetButton</c>).</summary>
    public static string Slug => AddWidgetButtonRegistration.Slug;

    /// <summary>Whether the dashboard is in edit mode; hides the FAB when true (web <c>isEditing</c>).</summary>
    public bool IsEditing
    {
        get => (bool)GetValue(IsEditingProperty);
        set => SetValue(IsEditingProperty, value);
    }

    private static void OnIsEditingChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((AddWidgetButton)d).Render();

    private TsButton BuildButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Large,
            Width = FabDiameter,
            Height = FabDiameter,
            MinWidth = FabDiameter,
            MinHeight = FabDiameter,
            Padding = new Thickness(0),
            CornerRadius = new CornerRadius(FabDiameter / 2),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom,
        };

        var icon = new FontIcon
        {
            Glyph = AddWidgetButtonRegistration.AddGlyph,
            FontSize = IconFontSize,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative — the button's Narrator name already carries the localized label (web `aria-hidden`).
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        button.Content = icon;
        button.Click += OnButtonClick;
        return button;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnButtonClick(object sender, RoutedEventArgs e)
    {
        _diagnostics.RecordActivated();
        Click?.Invoke(this, e);
    }

    private void Render()
    {
        var display = AddWidgetButtonProjection.Project(new AddWidgetButtonModel(IsEditing), _localizer);

        Visibility = display.IsVisible ? Visibility.Visible : Visibility.Collapsed;
        _tooltip.Hint = display.TooltipHint;
        AutomationProperties.SetName(_button, display.AutomationName);
        AutomationProperties.SetName(this, display.AutomationName);
    }
}
