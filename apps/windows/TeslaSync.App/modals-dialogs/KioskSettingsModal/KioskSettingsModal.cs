using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using Windows.UI;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>KioskSettingsModal</c> surface — a parity port of
/// web/src/features/dashboard/components/KioskSettingsModal.tsx. It presents a <see cref="TsModal"/> ("Kiosk
/// Settings") whose scrollable body stacks the web form in three <see cref="TsFormSection"/>s: <b>Dashboard
/// Rotation</b> (a rotation-interval dropdown and — only while rotation is on and more than one dashboard exists —
/// a scrollable checklist of dashboards to rotate, the user's default layout carrying a "Default" chip and the
/// last selection sticky), <b>Display</b> (an auto-hide-cursor switch with a conditional "Hide After" dropdown, a
/// "Dim Screen After" dropdown with a conditional dimmed-brightness slider, and a show-clock switch with a
/// conditional clock-position dropdown) and <b>Transparency</b> (widget- and background-opacity sliders flanked by
/// "Transparent"/"Solid" captions and a live preview swatch). A footer hint explains kiosk mode; the modal's
/// primary action enters kiosk mode and the close action cancels. The web component is a pure presentational
/// editor with no read query, so the surface has no loading / empty / error / stale / offline chrome — its states
/// are the editable form and the four progressive-disclosure branches above. The view performs no I/O; it binds
/// the shared <see cref="KioskSettingsModalViewModel"/> and re-raises its callback seams (<c>onUpdateConfig</c> →
/// <see cref="ConfigUpdated"/>, <c>onClose</c> → <see cref="Closed"/>, <c>onEnterKiosk</c> →
/// <see cref="EnterKioskRequested"/>). Every string resolves through the i18n facade, every interactive element
/// carries a Narrator name, the dialog inherits the WinUI focus trap and focus restoration, fonts scale with the
/// system text-scaling setting, and the dialog uses the system transition so reduced-motion is honoured.
/// </summary>
public sealed partial class KioskSettingsModal : ContentControl, IDisposable
{
    private const double FormMinWidth = 360;
    private const double FormMaxHeight = 560;
    private const double SectionSpacing = 16;
    private const double FieldSpacing = 16;
    private const double GroupSpacing = 8;
    private const double TightSpacing = 4;
    private const double DashboardListMaxHeight = 168; // web max-h-40 (160px) + a little chrome
    private const double HintIconSize = 16;
    private const double PreviewHeight = 64;
    private const double PreviewCornerRadius = 8;

    private readonly KioskSettingsModalViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _form = new() { Spacing = SectionSpacing, MinWidth = FormMinWidth };
    private readonly TsSelect _rotationSelect = new();
    private readonly StackPanel _dashboardGroup = new() { Spacing = TightSpacing };
    private readonly StackPanel _dashboardList = new() { Spacing = TightSpacing };
    private readonly TsToggle _hideCursorToggle = new();
    private readonly TsSelect _cursorTimeoutSelect = new();
    private readonly TsSelect _dimAfterSelect = new();
    private readonly TsSlider _dimBrightnessSlider = new();
    private readonly Text _dimBrightnessReadout = new();
    private readonly TsToggle _showClockToggle = new();
    private readonly TsSelect _clockPositionSelect = new();
    private readonly TsSlider _widgetOpacitySlider = new();
    private readonly Text _widgetOpacityReadout = new();
    private readonly TsSlider _backgroundOpacitySlider = new();
    private readonly Text _backgroundOpacityReadout = new();
    private readonly Border _previewBackground = new();
    private readonly Border _previewWidget = new();

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _suppressControlEvents;
    private bool _disposed;

    /// <summary>Creates the surface over the initial config, the dashboards, the i18n facade and diagnostics.</summary>
    /// <param name="config">The initial kiosk config (web <c>config</c> prop).</param>
    /// <param name="dashboards">The saved dashboards the rotation list offers (web <c>dashboards</c> prop).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public KioskSettingsModal(
        KioskConfig config,
        IReadOnlyList<KioskDashboard> dashboards,
        ILocalizer localizer,
        KioskSettingsModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(dashboards);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new KioskSettingsModalViewModel(config, dashboards, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "kiosk-settings-modal");
        AutomationProperties.SetName(this, _viewModel.SettingsTitle);

        BuildForm();
        Content = _form;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ConfigUpdated += OnViewModelConfigUpdated;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        _viewModel.EnterKioskRequested += OnViewModelEnterKioskRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised when the modal has closed (web <c>onClose</c>): cancel, enter, or system dismissal.</summary>
    public event EventHandler? Closed;

    /// <summary>Raised when the user commits to kiosk mode (web <c>onEnterKiosk</c>).</summary>
    public event EventHandler? EnterKioskRequested;

    /// <summary>Raised with the full updated config on every edit (web <c>onUpdateConfig</c>).</summary>
    public event EventHandler<KioskConfig>? ConfigUpdated;

    /// <summary>The canonical surface slug (<c>KioskSettingsModal</c>).</summary>
    public static string SurfaceId => KioskSettingsModalRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public KioskSettingsModalViewModel ViewModel => _viewModel;

    /// <summary>
    /// Present the modal over <paramref name="xamlRoot"/> (web <c>&lt;Modal open&gt;</c>). Idempotent: a second
    /// call while the dialog is showing is a no-op. Resolves when the modal has closed.
    /// </summary>
    public async Task ShowAsync(XamlRoot xamlRoot)
    {
        ArgumentNullException.ThrowIfNull(xamlRoot);
        if (_shown || _disposed)
        {
            return;
        }

        _shown = true;
        var dialog = new TsModal
        {
            Title = _viewModel.SettingsTitle,
            PrimaryButtonText = _viewModel.EnterLabel,
            CloseButtonText = _viewModel.CancelLabel,
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = xamlRoot,
            Content = new ScrollViewer
            {
                Content = _form,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollMode = ScrollMode.Disabled,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                MaxHeight = FormMaxHeight,
            },
        };
        AutomationProperties.SetAutomationId(dialog, "kiosk-settings-modal-dialog");
        AutomationProperties.SetName(dialog, _viewModel.SettingsTitle);
        dialog.PrimaryButtonClick += OnPrimaryButtonClick;
        dialog.CloseButtonClick += OnCloseButtonClick;
        dialog.Closed += OnDialogClosed;
        _dialog = dialog;

        try
        {
            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Another ContentDialog is already open on this XamlRoot — the host owns ordering; surface nothing.
            _shown = false;
            _dialog = null;
        }
    }

    /// <summary>Detach from the view-model, dismiss the dialog and release handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.ConfigUpdated -= OnViewModelConfigUpdated;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        _viewModel.EnterKioskRequested -= OnViewModelEnterKioskRequested;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        DismissDialog();
        GC.SuppressFinalize(this);
    }

    private void BuildForm()
    {
        _form.Children.Add(BuildRotationSection());
        _form.Children.Add(BuildDisplaySection());
        _form.Children.Add(BuildTransparencySection());
        _form.Children.Add(BuildHint());
        ApplyConditionalVisibility();
        ApplyPreview();
    }

    private TsFormSection BuildRotationSection()
    {
        PopulateIntSelect(_rotationSelect, _viewModel.RotationOptions, _viewModel.RotateIntervalSeconds);
        _rotationSelect.Header = _viewModel.RotationIntervalLabel;
        AutomationProperties.SetName(_rotationSelect, _viewModel.RotationIntervalLabel);
        AutomationProperties.SetAutomationId(_rotationSelect, "kiosk-settings-rotation-interval");
        _rotationSelect.SelectionChanged += OnRotationChanged;

        BuildDashboardList();

        var content = new StackPanel { Spacing = GroupSpacing };
        content.Children.Add(_rotationSelect);
        content.Children.Add(_dashboardGroup);

        return new TsFormSection { Title = _viewModel.RotationTitle, SectionContent = content };
    }

    private void BuildDashboardList()
    {
        _dashboardGroup.Children.Add(new Label { Value = _viewModel.DashboardsToRotateLabel });

        foreach (var dashboard in _viewModel.Dashboards)
        {
            _dashboardList.Children.Add(BuildDashboardRow(dashboard));
        }

        var scroller = new ScrollViewer
        {
            Content = _dashboardList,
            MaxHeight = DashboardListMaxHeight,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        _dashboardGroup.Children.Add(scroller);
    }

    private TsCheckbox BuildDashboardRow(KioskDashboard dashboard)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = GroupSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new Text { Value = dashboard.Name, VerticalAlignment = VerticalAlignment.Center });
        if (dashboard.IsDefault)
        {
            row.Children.Add(new Caption
            {
                Value = _viewModel.DefaultBadge,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        var checkbox = new TsCheckbox
        {
            Content = row,
            IsChecked = _viewModel.IsSelected(dashboard.Id),
            Tag = dashboard.Id,
        };
        AutomationProperties.SetName(checkbox, dashboard.Name);
        AutomationProperties.SetAutomationId(checkbox, "kiosk-settings-dashboard");
        checkbox.Click += OnDashboardClicked;
        return checkbox;
    }

    private TsFormSection BuildDisplaySection()
    {
        _hideCursorToggle.Header = _viewModel.HideCursorLabel;
        _hideCursorToggle.IsOn = _viewModel.HideCursor;
        AutomationProperties.SetName(_hideCursorToggle, _viewModel.HideCursorLabel);
        AutomationProperties.SetAutomationId(_hideCursorToggle, "kiosk-settings-hide-cursor");
        _hideCursorToggle.Toggled += OnHideCursorToggled;

        PopulateIntSelect(_cursorTimeoutSelect, _viewModel.CursorTimeoutOptions, _viewModel.CursorTimeoutSeconds);
        _cursorTimeoutSelect.Header = _viewModel.CursorTimeoutLabel;
        AutomationProperties.SetName(_cursorTimeoutSelect, _viewModel.CursorTimeoutLabel);
        AutomationProperties.SetAutomationId(_cursorTimeoutSelect, "kiosk-settings-cursor-timeout");
        _cursorTimeoutSelect.SelectionChanged += OnCursorTimeoutChanged;

        var cursorGroup = new StackPanel { Spacing = GroupSpacing };
        cursorGroup.Children.Add(_hideCursorToggle);
        cursorGroup.Children.Add(_cursorTimeoutSelect);

        PopulateIntSelect(_dimAfterSelect, _viewModel.DimAfterOptions, _viewModel.DimAfterMinutes);
        _dimAfterSelect.Header = _viewModel.DimAfterLabel;
        AutomationProperties.SetName(_dimAfterSelect, _viewModel.DimAfterLabel);
        AutomationProperties.SetAutomationId(_dimAfterSelect, "kiosk-settings-dim-after");
        _dimAfterSelect.SelectionChanged += OnDimAfterChanged;

        ConfigureSlider(
            _dimBrightnessSlider,
            _dimBrightnessReadout,
            KioskSettingsModalRegistration.DimLevelMinPercent,
            KioskSettingsModalRegistration.DimLevelMaxPercent,
            1,
            _viewModel.DimLevelPercent,
            _viewModel.DimLevelDisplay,
            _viewModel.BrightnessLabel,
            "kiosk-settings-dim-brightness",
            OnDimBrightnessChanged);

        var dimGroup = new StackPanel { Spacing = GroupSpacing };
        dimGroup.Children.Add(_dimAfterSelect);
        dimGroup.Children.Add(_dimBrightnessSlider);

        _showClockToggle.Header = _viewModel.ShowClockLabel;
        _showClockToggle.IsOn = _viewModel.ShowClock;
        AutomationProperties.SetName(_showClockToggle, _viewModel.ShowClockLabel);
        AutomationProperties.SetAutomationId(_showClockToggle, "kiosk-settings-show-clock");
        _showClockToggle.Toggled += OnShowClockToggled;

        PopulateClockSelect(_clockPositionSelect, _viewModel.ClockPositionOptions, _viewModel.ClockPosition);
        _clockPositionSelect.Header = _viewModel.ClockPositionLabel;
        AutomationProperties.SetName(_clockPositionSelect, _viewModel.ClockPositionLabel);
        AutomationProperties.SetAutomationId(_clockPositionSelect, "kiosk-settings-clock-position");
        _clockPositionSelect.SelectionChanged += OnClockPositionChanged;

        var clockGroup = new StackPanel { Spacing = GroupSpacing };
        clockGroup.Children.Add(_showClockToggle);
        clockGroup.Children.Add(_clockPositionSelect);

        var content = new StackPanel { Spacing = FieldSpacing };
        content.Children.Add(cursorGroup);
        content.Children.Add(dimGroup);
        content.Children.Add(clockGroup);

        return new TsFormSection { Title = _viewModel.DisplayTitle, SectionContent = content };
    }

    private TsFormSection BuildTransparencySection()
    {
        ConfigureSlider(
            _widgetOpacitySlider,
            _widgetOpacityReadout,
            KioskSettingsModalRegistration.WidgetOpacityMinPercent,
            KioskSettingsModalRegistration.WidgetOpacityMaxPercent,
            KioskSettingsModalRegistration.OpacityStepPercent,
            _viewModel.WidgetOpacityPercent,
            _viewModel.WidgetOpacityDisplay,
            _viewModel.WidgetOpacityLabel,
            "kiosk-settings-widget-opacity",
            OnWidgetOpacityChanged);

        ConfigureSlider(
            _backgroundOpacitySlider,
            _backgroundOpacityReadout,
            KioskSettingsModalRegistration.BackgroundOpacityMinPercent,
            KioskSettingsModalRegistration.BackgroundOpacityMaxPercent,
            KioskSettingsModalRegistration.OpacityStepPercent,
            _viewModel.BackgroundOpacityPercent,
            _viewModel.BackgroundOpacityDisplay,
            _viewModel.BackgroundOpacityLabel,
            "kiosk-settings-background-opacity",
            OnBackgroundOpacityChanged);

        var widgetGroup = new StackPanel { Spacing = TightSpacing };
        widgetGroup.Children.Add(_widgetOpacitySlider);
        widgetGroup.Children.Add(BuildScaleCaptions());

        var backgroundGroup = new StackPanel { Spacing = TightSpacing };
        backgroundGroup.Children.Add(_backgroundOpacitySlider);
        backgroundGroup.Children.Add(BuildScaleCaptions());

        var content = new StackPanel { Spacing = FieldSpacing };
        content.Children.Add(new HelperText { Value = _viewModel.TransparencyDescription });
        content.Children.Add(widgetGroup);
        content.Children.Add(backgroundGroup);
        content.Children.Add(BuildPreview());

        return new TsFormSection { Title = _viewModel.TransparencyTitle, SectionContent = content };
    }

    private Grid BuildScaleCaptions()
    {
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var transparent = new Caption { Value = _viewModel.TransparentLabel };
        var solid = new Caption { Value = _viewModel.SolidLabel, HorizontalAlignment = HorizontalAlignment.Right };
        Grid.SetColumn(transparent, 0);
        Grid.SetColumn(solid, 1);
        row.Children.Add(transparent);
        row.Children.Add(solid);
        return row;
    }

    private Border BuildPreview()
    {
        var previewText = new Text
        {
            Value = _viewModel.PreviewText,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        _previewWidget.CornerRadius = new CornerRadius(PreviewCornerRadius / 2);
        _previewWidget.BorderBrush = DisplayTokens.Border;
        _previewWidget.BorderThickness = new Thickness(1);
        _previewWidget.Padding = new Thickness(GroupSpacing);
        _previewWidget.Margin = new Thickness(GroupSpacing);
        _previewWidget.HorizontalAlignment = HorizontalAlignment.Stretch;
        _previewWidget.VerticalAlignment = VerticalAlignment.Center;
        _previewWidget.Child = previewText;

        var layers = new Grid();
        layers.Children.Add(_previewBackground);
        layers.Children.Add(_previewWidget);

        var frame = new Border
        {
            Height = PreviewHeight,
            CornerRadius = new CornerRadius(PreviewCornerRadius),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Child = layers,
        };
        AutomationProperties.SetName(frame, _viewModel.PreviewText);
        AutomationProperties.SetAccessibilityView(frame, AccessibilityView.Raw);
        return frame;
    }

    private StackPanel BuildHint()
    {
        var icon = new FontIcon
        {
            Glyph = KioskSettingsModalRegistration.MonitorGlyph,
            FontSize = HintIconSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var hint = new HelperText { Value = _viewModel.HintText };

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = GroupSpacing };
        row.Children.Add(icon);
        row.Children.Add(hint);
        return row;
    }

    private static void PopulateIntSelect(
        TsSelect select, IReadOnlyList<KioskSelectOption<int>> options, int currentValue)
    {
        select.Items.Clear();
        int selectedIndex = -1;
        for (int i = 0; i < options.Count; i++)
        {
            select.Items.Add(new ComboBoxItem { Content = options[i].Label });
            if (options[i].Value == currentValue)
            {
                selectedIndex = i;
            }
        }

        select.SelectedIndex = selectedIndex;
    }

    private static void PopulateClockSelect(
        TsSelect select, IReadOnlyList<KioskSelectOption<ClockCorner>> options, ClockCorner currentValue)
    {
        select.Items.Clear();
        int selectedIndex = -1;
        for (int i = 0; i < options.Count; i++)
        {
            select.Items.Add(new ComboBoxItem { Content = options[i].Label });
            if (options[i].Value == currentValue)
            {
                selectedIndex = i;
            }
        }

        select.SelectedIndex = selectedIndex;
    }

    private static void ConfigureSlider(
        TsSlider slider,
        Text readout,
        int minimum,
        int maximum,
        int step,
        int value,
        string display,
        string label,
        string automationId,
        RangeBaseValueChangedEventHandler handler)
    {
        readout.Value = display;
        readout.Foreground = DisplayTokens.TextSecondary;
        readout.HorizontalAlignment = HorizontalAlignment.Right;

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var labelText = new Label { Value = label, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(labelText, 0);
        Grid.SetColumn(readout, 1);
        header.Children.Add(labelText);
        header.Children.Add(readout);

        slider.Minimum = minimum;
        slider.Maximum = maximum;
        slider.StepFrequency = step;
        slider.Value = value;
        slider.Header = header;
        slider.IsThumbToolTipEnabled = false;
        AutomationProperties.SetName(slider, label);
        AutomationProperties.SetAutomationId(slider, automationId);
        slider.ValueChanged += handler;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        if (XamlRoot is { } xamlRoot)
        {
            _ = ShowAsync(xamlRoot);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRotationChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressControlEvents)
        {
            return;
        }

        int index = _rotationSelect.SelectedIndex;
        if (index >= 0 && index < _viewModel.RotationOptions.Count)
        {
            _viewModel.RotateIntervalSeconds = _viewModel.RotationOptions[index].Value;
        }
    }

    private void OnCursorTimeoutChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressControlEvents)
        {
            return;
        }

        int index = _cursorTimeoutSelect.SelectedIndex;
        if (index >= 0 && index < _viewModel.CursorTimeoutOptions.Count)
        {
            _viewModel.CursorTimeoutSeconds = _viewModel.CursorTimeoutOptions[index].Value;
        }
    }

    private void OnDimAfterChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressControlEvents)
        {
            return;
        }

        int index = _dimAfterSelect.SelectedIndex;
        if (index >= 0 && index < _viewModel.DimAfterOptions.Count)
        {
            _viewModel.DimAfterMinutes = _viewModel.DimAfterOptions[index].Value;
        }
    }

    private void OnClockPositionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressControlEvents)
        {
            return;
        }

        int index = _clockPositionSelect.SelectedIndex;
        if (index >= 0 && index < _viewModel.ClockPositionOptions.Count)
        {
            _viewModel.ClockPosition = _viewModel.ClockPositionOptions[index].Value;
        }
    }

    private void OnHideCursorToggled(object? sender, EventArgs e)
    {
        if (!_suppressControlEvents)
        {
            _viewModel.HideCursor = _hideCursorToggle.IsOn;
        }
    }

    private void OnShowClockToggled(object? sender, EventArgs e)
    {
        if (!_suppressControlEvents)
        {
            _viewModel.ShowClock = _showClockToggle.IsOn;
        }
    }

    private void OnDimBrightnessChanged(object sender, RangeBaseValueChangedEventArgs e)
    {
        if (!_suppressControlEvents)
        {
            _viewModel.DimLevel = KioskSettingsModalProjection.PercentToOpacity((int)Math.Round(e.NewValue));
        }
    }

    private void OnWidgetOpacityChanged(object sender, RangeBaseValueChangedEventArgs e)
    {
        if (!_suppressControlEvents)
        {
            _viewModel.WidgetOpacity = KioskSettingsModalProjection.PercentToOpacity((int)Math.Round(e.NewValue));
        }
    }

    private void OnBackgroundOpacityChanged(object sender, RangeBaseValueChangedEventArgs e)
    {
        if (!_suppressControlEvents)
        {
            _viewModel.BackgroundOpacity =
                KioskSettingsModalProjection.PercentToOpacity((int)Math.Round(e.NewValue));
        }
    }

    private void OnDashboardClicked(object sender, RoutedEventArgs e)
    {
        if (_suppressControlEvents || sender is not CheckBox checkbox || checkbox.Tag is not string id)
        {
            return;
        }

        _viewModel.ToggleDashboard(id);

        // Reconcile: the last selected dashboard can't be deselected, so re-assert the view-model's decision.
        _suppressControlEvents = true;
        checkbox.IsChecked = _viewModel.IsSelected(id);
        _suppressControlEvents = false;
    }

    private void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        _viewModel.RequestEnterKiosk();

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        _viewModel.RequestClose();

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.PrimaryButtonClick -= OnPrimaryButtonClick;
        sender.CloseButtonClick -= OnCloseButtonClick;
        sender.Closed -= OnDialogClosed;
        _dialog = null;
        RaiseClosed();
    }

    private void OnViewModelConfigUpdated(object? sender, KioskConfig config) =>
        Marshal(() => ConfigUpdated?.Invoke(this, config));

    private void OnViewModelEnterKioskRequested(object? sender, EventArgs e) =>
        Marshal(() => EnterKioskRequested?.Invoke(this, EventArgs.Empty));

    private void OnViewModelCloseRequested(object? sender, EventArgs e) =>
        Marshal(() =>
        {
            RaiseClosed();
            DismissDialog();
        });

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(() => ApplyViewModelState(e.PropertyName));

    private void ApplyViewModelState(string? propertyName)
    {
        switch (propertyName)
        {
            case nameof(KioskSettingsModalViewModel.ShowDashboardList):
            case nameof(KioskSettingsModalViewModel.ShowCursorTimeout):
            case nameof(KioskSettingsModalViewModel.ShowDimBrightness):
            case nameof(KioskSettingsModalViewModel.ShowClockPosition):
                ApplyConditionalVisibility();
                break;
            case nameof(KioskSettingsModalViewModel.WidgetOpacityDisplay):
                _widgetOpacityReadout.Value = _viewModel.WidgetOpacityDisplay;
                ApplyPreview();
                break;
            case nameof(KioskSettingsModalViewModel.BackgroundOpacityDisplay):
                _backgroundOpacityReadout.Value = _viewModel.BackgroundOpacityDisplay;
                ApplyPreview();
                break;
            case nameof(KioskSettingsModalViewModel.DimLevelDisplay):
                _dimBrightnessReadout.Value = _viewModel.DimLevelDisplay;
                break;
            case nameof(KioskSettingsModalViewModel.Preview):
                ApplyPreview();
                break;
            default:
                break;
        }
    }

    private void ApplyConditionalVisibility()
    {
        _dashboardGroup.Visibility = ToVisibility(_viewModel.ShowDashboardList);
        _cursorTimeoutSelect.Visibility = ToVisibility(_viewModel.ShowCursorTimeout);
        _dimBrightnessSlider.Visibility = ToVisibility(_viewModel.ShowDimBrightness);
        _clockPositionSelect.Visibility = ToVisibility(_viewModel.ShowClockPosition);
    }

    private void ApplyPreview()
    {
        KioskPreview preview = _viewModel.Preview;
        _previewBackground.Background = new SolidColorBrush(Color.FromArgb(
            preview.BackgroundAlpha,
            KioskSettingsModalRegistration.PreviewBackgroundRed,
            KioskSettingsModalRegistration.PreviewBackgroundGreen,
            KioskSettingsModalRegistration.PreviewBackgroundBlue));
        _previewWidget.Background = new SolidColorBrush(Color.FromArgb(
            preview.WidgetAlpha,
            KioskSettingsModalRegistration.PreviewWidgetChannel,
            KioskSettingsModalRegistration.PreviewWidgetChannel,
            KioskSettingsModalRegistration.PreviewWidgetChannel));
    }

    private void DismissDialog() => _dialog?.Hide();

    private void RaiseClosed()
    {
        if (_closeRaised)
        {
            return;
        }

        _closeRaised = true;
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private static Visibility ToVisibility(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private void Marshal(DispatcherQueueHandler action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(action);
        }
        else
        {
            action();
        }
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new KioskSettingsModalAutomationPeer(this);

    private sealed class KioskSettingsModalAutomationPeer(KioskSettingsModal owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((KioskSettingsModal)Owner)._viewModel.SettingsTitle : name;
        }
    }
}
