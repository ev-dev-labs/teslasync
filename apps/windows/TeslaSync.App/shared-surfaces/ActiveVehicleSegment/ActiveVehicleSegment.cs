using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>ActiveVehicleSegment</c> shared surface — a parity port of
/// web/src/components/layout/status-bar/ActiveVehicleSegment.tsx. It is the footer status-bar segment that shows
/// the currently selected vehicle (with an optional live battery / range read-out), reproducing the web source's
/// three vehicle-count branches: nothing for an empty fleet (<see cref="ActiveVehicleSegmentStatus.Hidden"/>, web
/// <c>return null</c>), a static, non-interactive chip for a single-vehicle account
/// (<see cref="ActiveVehicleSegmentStatus.Solo"/>) and a focusable button that opens a switcher popover
/// otherwise (<see cref="ActiveVehicleSegmentStatus.Switcher"/>). The switcher popover (web's <c>role="listbox"</c>)
/// is a Fluent <see cref="Flyout"/> hosting a single-selection <see cref="ListView"/> whose rows carry the
/// vehicle's name + model and a Check glyph on the current selection; picking a row commits the new scope through
/// the bound <see cref="ActiveVehicleSegmentViewModel"/> and dismisses the popover. A
/// <see cref="ActiveVehicleSegment(VehicleSelectState, IActiveVehicleUnitsSource, IActiveVehicleStateSource, ILocalizer, bool, ActiveVehicleSegmentDiagnostics)"/>
/// overload renders the compact icon-only variant (web <c>iconOnly</c> prop) that drops the label, metrics and
/// chevron. All state flows through the view-model; the view performs no I/O and issues no query itself. The
/// decorative glyphs are hidden from Narrator (web <c>aria-hidden</c>) while the chip / button carries the full
/// composed accessible name (web <c>aria-label</c>); every accent is a generated design token (so light / dark /
/// high-contrast all flow from the token set) and the surface uses no entrance animation (the OS reduce-motion
/// preference is honoured by construction). The surface emits the <c>view.opened</c> diagnostic once when shown.
/// </summary>
public sealed partial class ActiveVehicleSegment : ContentControl, IDisposable
{
    private const double IconFontSize = 12;       // web icon h-3 w-3
    private const double RowIconFontSize = 14;    // web popover icon h-3.5 w-3.5
    private const double LabelFontSize = 11;      // web text-[11px]
    private const double RowFontSize = 12;        // web popover text-xs
    private const double RowSpacing = 6;          // web gap-1.5
    private const double RowItemSpacing = 8;      // web popover gap-2
    private const double ChipPaddingX = 6;        // web px-1.5
    private const double ChipPaddingY = 2;        // web py-0.5
    private const double LabelMaxWidth = 160;     // web max-w-[160px] / max-w-[140px]
    private const double ListMinWidth = 220;      // web min-w-[220px]
    private const double ListMaxHeight = 280;     // web max-h-[280px]
    private const string IconFontFamily = "Segoe Fluent Icons";

    private readonly ActiveVehicleSegmentViewModel _viewModel;
    private readonly ActiveVehicleSegmentDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly FontIcon _chipCar = MakeIcon(ActiveVehicleSegmentRegistration.CarGlyph, IconFontSize);
    private readonly TextBlock _chipLabel = MakeLabel();
    private readonly TextBlock _chipMetrics = MakeMetrics();
    private readonly StackPanel _chipRow = MakeRow(RowSpacing);

    private readonly FontIcon _switcherCar = MakeIcon(ActiveVehicleSegmentRegistration.CarGlyph, IconFontSize);
    private readonly TextBlock _switcherLabel = MakeLabel();
    private readonly TextBlock _switcherMetrics = MakeMetrics();
    private readonly FontIcon _switcherChevron = MakeIcon(ActiveVehicleSegmentRegistration.ChevronUpGlyph, IconFontSize);
    private readonly StackPanel _switcherRow = MakeRow(RowSpacing);
    private readonly Button _switcherButton = new()
    {
        Padding = new Thickness(ChipPaddingX, ChipPaddingY, ChipPaddingX, ChipPaddingY),
        MinWidth = 0,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly ListView _list = new()
    {
        SelectionMode = ListViewSelectionMode.Single,
        MinWidth = ListMinWidth,
        MaxHeight = ListMaxHeight,
    };

    private readonly Flyout _flyout = new() { Placement = FlyoutPlacementMode.Top };

    private bool _suppress;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the segment with no live host (the designer / parameterless entry point): it binds an empty fleet
    /// holder and in-memory seams, so it renders the hidden state. Strings resolve through the passthrough
    /// localizer; supply explicit seams via the other constructor to drive i18n, data and scope from the
    /// composition root.
    /// </summary>
    public ActiveVehicleSegment()
        : this(
            new ActiveVehicleSegmentViewModel(
                new VehicleSelectState(),
                new InMemoryActiveVehicleUnitsSource(),
                new InMemoryActiveVehicleStateSource(),
                PassthroughLocalizer.Instance),
            diagnostics: null)
    {
    }

    /// <summary>Creates the segment over the shared fleet state, the units seam, the live-state seam, the i18n facade and diagnostics (the production entry point).</summary>
    /// <param name="state">The shared P1/S8 fleet + scope holder (web <c>useSelectedVehicle()</c> / <c>useVehicles()</c>).</param>
    /// <param name="units">The unit-preference seam (web <c>useUnits()</c>).</param>
    /// <param name="liveState">The live-state seam (web <c>useVehicleState(vehicleId)</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="iconOnly">Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ActiveVehicleSegment(
        VehicleSelectState state,
        IActiveVehicleUnitsSource units,
        IActiveVehicleStateSource liveState,
        ILocalizer localizer,
        bool iconOnly = false,
        ActiveVehicleSegmentDiagnostics? diagnostics = null)
        : this(new ActiveVehicleSegmentViewModel(state, units, liveState, localizer, iconOnly), diagnostics)
    {
    }

    /// <summary>Creates the segment over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ActiveVehicleSegment(ActiveVehicleSegmentViewModel viewModel, ActiveVehicleSegmentDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ActiveVehicleSegmentDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Center;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        // web: the decorative glyph + text spans are hidden from Narrator; the chip / button aria-label is authoritative.
        AutomationProperties.SetAccessibilityView(_chipCar, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_chipLabel, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_chipMetrics, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_switcherCar, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_switcherLabel, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_switcherMetrics, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_switcherChevron, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, ActiveVehicleSegmentRegistration.RootAutomationId);

        _chipRow.Children.Add(_chipCar);
        _chipRow.Children.Add(_chipLabel);
        _chipRow.Children.Add(_chipMetrics);

        _switcherRow.Children.Add(_switcherCar);
        _switcherRow.Children.Add(_switcherLabel);
        _switcherRow.Children.Add(_switcherMetrics);
        _switcherRow.Children.Add(_switcherChevron);

        _switcherButton.Content = _switcherRow;
        _switcherButton.Flyout = _flyout;

        AutomationProperties.SetName(_list, _viewModel.Projection.ListAccessibleName);
        _flyout.Content = _list;

        _list.SelectionChanged += OnListSelectionChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>ActiveVehicleSegment</c>).</summary>
    public static string Slug => ActiveVehicleSegmentRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ActiveVehicleSegmentViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _list.SelectionChanged -= OnListSelectionChanged;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private static FontIcon MakeIcon(string glyph, double size) => new()
    {
        Glyph = glyph,
        FontSize = size,
        FontFamily = new FontFamily(IconFontFamily),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static TextBlock MakeLabel() => new()
    {
        FontSize = LabelFontSize,
        FontWeight = FontWeights.Medium,
        VerticalAlignment = VerticalAlignment.Center,
        TextTrimming = TextTrimming.CharacterEllipsis,
        MaxLines = 1,
        MaxWidth = LabelMaxWidth,
    };

    private static TextBlock MakeMetrics() => new()
    {
        FontSize = LabelFontSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel MakeRow(double spacing) => new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = spacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void OnListSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        if (_list.SelectedItem is ListViewItem { Tag: ActiveVehicleSegmentOption option })
        {
            _viewModel.Pick(option.Id);
            _flyout.Hide();
        }
    }

    private void Render()
    {
        var projection = _viewModel.Projection;

        switch (projection.Status)
        {
            case ActiveVehicleSegmentStatus.Solo:
                RenderChip(projection);
                Content = _chipRow;
                Visibility = Visibility.Visible;
                break;

            case ActiveVehicleSegmentStatus.Switcher:
                RenderSwitcher(projection);
                Content = _switcherButton;
                Visibility = Visibility.Visible;
                break;

            default:
                // web: empty fleet renders nothing.
                Visibility = Visibility.Collapsed;
                break;
        }
    }

    private void RenderChip(ActiveVehicleSegmentProjection projection)
    {
        _chipCar.Foreground = DisplayTokens.TextSecondary;

        _chipLabel.Text = projection.Label;
        _chipLabel.Foreground = DisplayTokens.TextSecondary;
        _chipLabel.Visibility = projection.ShowLabel ? Visibility.Visible : Visibility.Collapsed;

        _chipMetrics.Text = ComposeMetricsSuffix(projection);
        _chipMetrics.Foreground = DisplayTokens.TextMuted;
        _chipMetrics.Visibility = projection.ShowMetrics ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(_chipRow, projection.AutomationName);
        ToolTipService.SetToolTip(_chipRow, projection.TooltipText);
    }

    private void RenderSwitcher(ActiveVehicleSegmentProjection projection)
    {
        _switcherCar.Foreground = DisplayTokens.TextSecondary;

        _switcherLabel.Text = projection.Label;
        _switcherLabel.Foreground = DisplayTokens.TextSecondary;
        _switcherLabel.Visibility = projection.ShowLabel ? Visibility.Visible : Visibility.Collapsed;

        _switcherMetrics.Text = ComposeMetricsSuffix(projection);
        _switcherMetrics.Foreground = DisplayTokens.TextMuted;
        _switcherMetrics.Visibility = projection.ShowMetrics ? Visibility.Visible : Visibility.Collapsed;

        _switcherChevron.Foreground = DisplayTokens.TextSecondary;
        _switcherChevron.Visibility = projection.ShowChevron ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(_switcherButton, projection.AutomationName);
        AutomationProperties.SetName(_list, projection.ListAccessibleName);
        ToolTipService.SetToolTip(_switcherButton, projection.TooltipText);

        RebuildOptions(projection);
    }

    private void RebuildOptions(ActiveVehicleSegmentProjection projection)
    {
        _suppress = true;

        _list.Items.Clear();
        ListViewItem? selected = null;
        foreach (var option in projection.Options)
        {
            var item = new ListViewItem
            {
                Content = BuildOptionContent(option),
                Tag = option,
            };
            AutomationProperties.SetName(item, ComposeOptionAccessibleName(option));
            _list.Items.Add(item);

            if (option.Selected)
            {
                selected = item;
            }
        }

        _list.SelectedItem = selected;
        _suppress = false;
    }

    private static StackPanel BuildOptionContent(ActiveVehicleSegmentOption option)
    {
        var row = MakeRow(RowItemSpacing);

        var car = MakeIcon(ActiveVehicleSegmentRegistration.CarGlyph, RowIconFontSize);
        car.Foreground = DisplayTokens.TextMuted;
        AutomationProperties.SetAccessibilityView(car, AccessibilityView.Raw);
        row.Children.Add(car);

        var name = new TextBlock
        {
            Text = option.Name,
            FontSize = RowFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = option.Selected ? DisplayTokens.TextPrimary : DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(name, AccessibilityView.Raw);
        row.Children.Add(name);

        if (!string.IsNullOrEmpty(option.Model))
        {
            var model = new TextBlock
            {
                Text = option.Model,
                FontSize = RowFontSize,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(model, AccessibilityView.Raw);
            row.Children.Add(model);
        }

        if (option.Selected)
        {
            var check = MakeIcon(ActiveVehicleSegmentRegistration.CheckGlyph, RowIconFontSize);
            check.Foreground = DisplayTokens.Brush("TsColorSuccessBrush");
            AutomationProperties.SetAccessibilityView(check, AccessibilityView.Raw);
            row.Children.Add(check);
        }

        return row;
    }

    private static string ComposeMetricsSuffix(ActiveVehicleSegmentProjection projection) =>
        projection.ShowMetrics
            ? $"{ActiveVehicleSegmentRegistration.MiddleDot} {projection.MetricsText}"
            : string.Empty;

    private static string ComposeOptionAccessibleName(ActiveVehicleSegmentOption option) =>
        string.IsNullOrEmpty(option.Model)
            ? option.Name
            : $"{option.Name} {ActiveVehicleSegmentRegistration.MiddleDot} {option.Model}";

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }
}
