using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;

namespace TeslaSync.App.FeatureViews.StateMachine;

/// <summary>
/// The native WinUI 3 <c>LiveControls</c> feature surface — a parity port of
/// web/src/features/system/components/state-machine/LiveControls.tsx. It is the FSM-debugger's controlled
/// Live/Freeze/Step toolbar: assign a <see cref="Model"/> (the web <c>isLive</c> / <c>canStepPrev</c> /
/// <c>canStepNext</c> / <c>windowMinutes</c> / <c>windowCount</c> / <c>totalCount</c> / <c>bufferCount</c>
/// props) and it renders the Live toggle (a primary <see cref="TsButton"/> carrying a status dot that pulses
/// while live — honouring the OS reduce-motion preference, the native analogue of the web
/// <c>animate-pulse</c>), the Freeze toggle, the step-previous / step-next ghost buttons (disabled exactly as
/// the web <c>disabled={!canStep…}</c>), the "Window" <see cref="TsSelect"/> dropdown, the "Clear buffer"
/// button, and the right-aligned counter chip whose <see cref="TsTooltip"/> explains the window-vs-24 h scope
/// difference. Interacting raises the typed <see cref="LiveToggled"/> / <see cref="StepPrevRequested"/> /
/// <see cref="StepNextRequested"/> / <see cref="WindowChanged"/> / <see cref="ClearBufferRequested"/> event the
/// host applies (the web <c>onToggleLive</c> / <c>onStepPrev</c> / <c>onStepNext</c> / <c>onWindowChange</c> /
/// <c>onClearBuffer</c> callbacks); the surface never mutates its own model. All branch selection and label
/// resolution happen in the WinUI-free <see cref="LiveControlsProjection"/>; every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class LiveControls : ContentControl
{
    private const string StepPrevGlyph = "\uE72B"; // Segoe Fluent — Back (web ← step-previous)
    private const string StepNextGlyph = "\uE72A"; // Segoe Fluent — Forward (web → step-next)
    private const double DotSize = 8;              // web h-2 w-2
    private const double SeparatorHeight = 20;     // web h-5
    private const double WindowSelectWidth = 104;

    private readonly ILocalizer _localizer;
    private readonly LiveControlsDiagnostics _diagnostics;

    private readonly Grid _root = new();
    private readonly StackPanel _controls = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _liveButton = new() { Size = ControlSize.Small };
    private readonly Ellipse _liveDot = new() { Width = DotSize, Height = DotSize };
    private readonly TextBlock _liveLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _freezeButton = new() { Size = ControlSize.Small };
    private readonly TsButton _stepPrevButton = new() { Size = ControlSize.Small, Variant = ButtonVariant.Subtle, IconGlyph = StepPrevGlyph };
    private readonly TsButton _stepNextButton = new() { Size = ControlSize.Small, Variant = ButtonVariant.Subtle, IconGlyph = StepNextGlyph };
    private readonly Caption _windowCaption = new();
    private readonly TsSelect _windowSelect = new() { Width = WindowSelectWidth, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _clearButton = new() { Size = ControlSize.Small, Variant = ButtonVariant.Subtle };
    private readonly Caption _counterCaption = new();
    private readonly TsTooltip _counterTooltip = new()
    {
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private LiveControlsModel _model;
    private Storyboard? _pulse;
    private bool _loaded;
    private bool _opened;
    private bool _suppress;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="LiveControlsModel.Initial"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LiveControls(
        ILocalizer localizer,
        LiveControlsModel? model = null,
        LiveControlsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? LiveControlsModel.Initial;
        _diagnostics = diagnostics ?? new LiveControlsDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Center;

        BuildChrome();

        _liveButton.Click += OnLiveClick;
        _freezeButton.Click += OnFreezeClick;
        _stepPrevButton.Click += OnStepPrevClick;
        _stepNextButton.Click += OnStepNextClick;
        _clearButton.Click += OnClearClick;
        _windowSelect.SelectionChanged += OnWindowSelectionChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Raised when the operator toggles streaming (true = Live, false = Freeze; web <c>onToggleLive</c>).</summary>
    public event EventHandler<bool>? LiveToggled;

    /// <summary>Raised when the operator steps to the previous transition (web <c>onStepPrev</c>).</summary>
    public event EventHandler? StepPrevRequested;

    /// <summary>Raised when the operator steps to the next transition (web <c>onStepNext</c>).</summary>
    public event EventHandler? StepNextRequested;

    /// <summary>Raised when the operator picks a different buffer-window in minutes (web <c>onWindowChange</c>).</summary>
    public event EventHandler<int>? WindowChanged;

    /// <summary>Raised when the operator clears the transition buffer (web <c>onClearBuffer</c>).</summary>
    public event EventHandler? ClearBufferRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>LiveControls</c>).</summary>
    public static string Slug => LiveControlsRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public LiveControlsModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    private void BuildChrome()
    {
        _liveDot.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetAccessibilityView(_liveDot, AccessibilityView.Raw);

        var liveContent = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        liveContent.Children.Add(_liveDot);
        liveContent.Children.Add(_liveLabel);
        _liveButton.Content = liveContent;

        _controls.Children.Add(_liveButton);
        _controls.Children.Add(_freezeButton);
        _controls.Children.Add(Separator());
        _controls.Children.Add(_stepPrevButton);
        _controls.Children.Add(_stepNextButton);
        _controls.Children.Add(Separator());
        _controls.Children.Add(_windowCaption);
        _controls.Children.Add(_windowSelect);
        _controls.Children.Add(_clearButton);

        _counterCaption.VerticalAlignment = VerticalAlignment.Center;
        _counterTooltip.Content = _counterCaption;

        _root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _root.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _root.ColumnSpacing = 8;
        Grid.SetColumn(_controls, 0);
        Grid.SetColumn(_counterTooltip, 1);
        _root.Children.Add(_controls);
        _root.Children.Add(_counterTooltip);

        Content = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(12, 8, 12, 8),
            Child = _root,
        };
    }

    private static Border Separator() => new()
    {
        Width = 1,
        Height = SeparatorHeight,
        Background = DisplayTokens.Border,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        _loaded = true;
        ApplyPulse(_model.IsLive);

        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        _loaded = false;
        StopPulse();
    }

    private void OnLiveClick(object sender, RoutedEventArgs e) => LiveToggled?.Invoke(this, true);

    private void OnFreezeClick(object sender, RoutedEventArgs e) => LiveToggled?.Invoke(this, false);

    private void OnStepPrevClick(object sender, RoutedEventArgs e) => StepPrevRequested?.Invoke(this, EventArgs.Empty);

    private void OnStepNextClick(object sender, RoutedEventArgs e) => StepNextRequested?.Invoke(this, EventArgs.Empty);

    private void OnClearClick(object sender, RoutedEventArgs e) => ClearBufferRequested?.Invoke(this, EventArgs.Empty);

    private void OnWindowSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        if (_windowSelect.SelectedItem is ComboBoxItem { Tag: string value }
            && int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int minutes))
        {
            WindowChanged?.Invoke(this, minutes);
        }
    }

    private void Render()
    {
        var display = LiveControlsProjection.Project(_model, _localizer);

        _liveLabel.Text = display.LiveLabel;
        _liveButton.Variant = display.IsLive ? ButtonVariant.Primary : ButtonVariant.Secondary;
        AutomationProperties.SetName(_liveButton, display.LiveLabel);

        _freezeButton.Text = display.FreezeLabel;
        _freezeButton.Variant = display.IsLive ? ButtonVariant.Secondary : ButtonVariant.Primary;
        AutomationProperties.SetName(_freezeButton, display.FreezeLabel);

        _stepPrevButton.IsEnabled = display.CanStepPrev;
        AutomationProperties.SetName(_stepPrevButton, display.StepPrevLabel);
        _stepNextButton.IsEnabled = display.CanStepNext;
        AutomationProperties.SetName(_stepNextButton, display.StepNextLabel);

        _windowCaption.Value = display.WindowLabel;
        AutomationProperties.SetName(_windowSelect, display.WindowLabel);
        FillWindowSelect(display.WindowOptions, display.SelectedWindowValue);

        _clearButton.Text = display.ClearLabel;
        AutomationProperties.SetName(_clearButton, display.ClearLabel);

        _counterCaption.Value = display.CounterLabel;
        AutomationProperties.SetName(_counterCaption, display.CounterLabel);
        _counterTooltip.Hint = display.TooltipLabel;

        ApplyPulse(display.IsLive);

        AutomationProperties.SetName(this, display.AutomationName);
    }

    private void FillWindowSelect(IReadOnlyList<ComboOption> options, string selectedValue)
    {
        _suppress = true;

        _windowSelect.Items.Clear();
        ComboBoxItem? selected = null;

        foreach (var option in options)
        {
            var item = new ComboBoxItem { Content = option.Label, Tag = option.Value };
            AutomationProperties.SetName(item, option.Label);
            _windowSelect.Items.Add(item);

            if (string.Equals(option.Value, selectedValue, StringComparison.Ordinal))
            {
                selected = item;
            }
        }

        _windowSelect.SelectedItem = selected;
        _suppress = false;
    }

    private void ApplyPulse(bool isLive)
    {
        _liveDot.Fill = isLive
            ? DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success))
            : DisplayTokens.TextMuted;

        if (isLive && _loaded && !MotionPreference.ReduceMotion)
        {
            StartPulse();
        }
        else
        {
            StopPulse();
        }
    }

    private void StartPulse()
    {
        if (_pulse is null)
        {
            var animation = new DoubleAnimation
            {
                From = 1.0,
                To = 0.35,
                Duration = new Duration(TimeSpan.FromMilliseconds(900)),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
            };
            Storyboard.SetTarget(animation, _liveDot);
            Storyboard.SetTargetProperty(animation, "Opacity");
            _pulse = new Storyboard();
            _pulse.Children.Add(animation);
        }

        _pulse.Begin();
    }

    private void StopPulse()
    {
        _pulse?.Stop();
        _liveDot.Opacity = 1.0;
    }
}
