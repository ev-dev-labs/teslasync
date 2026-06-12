using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.A11y;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using Windows.System;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>VehicleMultiSelect</c> shared surface — a parity port of the web
/// <c>VehicleMultiSelect</c> (web/src/components/forms/VehicleMultiSelect.tsx), the Alert Studio's
/// "All vehicles (current + future)" vs explicit-subset picker. Like the web source it composes its own trigger
/// + popover listbox (rather than the platform <see cref="ComboBox"/>): a token-styled trigger
/// <see cref="Button"/> hosting the selection summary <see cref="TsBadge"/> and a chevron, with the option
/// listbox in a <see cref="Popup"/> anchored under the trigger. It binds the <see cref="VehicleMultiSelectViewModel"/>
/// (over the fleet read seam, the i18n facade and the announcer bus) and reproduces every state: the loading
/// skeleton while the fleet loads, the friendly empty-fleet help text under a disabled trigger (web
/// <c>isFleetEmpty</c>), the inline validation error (web <c>errorKey</c>), the stale / offline freshness chips
/// that keep a cached fleet visible, the fleet-load error card with a Retry affordance, and the open listbox of
/// per-vehicle checkboxes — the "All vehicles" sentinel, each known vehicle, and the stored-but-missing
/// "Unknown" rows that are never silently dropped. Each option row is a native <see cref="CheckBox"/> so
/// Narrator voices "checkbox, checked/unchecked"; the trigger carries the expand/collapse semantics and an
/// accessible name; selection changes are announced through the shared announcer. The view performs no I/O and
/// emits the <c>view.opened</c> diagnostic once when shown.
/// </summary>
public sealed partial class VehicleMultiSelect : ContentControl, IDisposable
{
    private const string ChevronDownGlyph = "\uE70D"; // Segoe Fluent "ChevronDown" — listbox closed.
    private const string ChevronUpGlyph = "\uE70E";   // Segoe Fluent "ChevronUp" — listbox open (web rotate-180).
    private const double TriggerCornerRadius = 6;      // web rounded-md.
    private const double DropdownCornerRadius = 6;     // web rounded-md.
    private const double DropdownMaxHeight = 288;      // web max-h-72.
    private const double RowPaddingX = 8;              // web px-2.
    private const double RowPaddingY = 8;              // web py-2.
    private const double HelpFontSize = 11;            // web text-[11px].
    private const double SummaryFontSize = 13;         // web text-sm.

    private readonly VehicleMultiSelectViewModel _viewModel;
    private readonly VehicleMultiSelectDiagnostics _diagnostics;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Stretch };

    private readonly Button _trigger = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
        Padding = new Thickness(12, 8, 12, 8),
        CornerRadius = new CornerRadius(TriggerCornerRadius),
    };

    private readonly Grid _triggerGrid = new();
    private readonly TsBadge _summaryBadge = new() { Status = StatusKind.Neutral, VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _loadingPanel = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly ProgressRing _loadingRing = new() { Width = 16, Height = 16, IsActive = false };
    private readonly TextBlock _loadingText = new() { FontSize = SummaryFontSize, VerticalAlignment = VerticalAlignment.Center };
    private readonly FontIcon _chevron = new()
    {
        Glyph = ChevronDownGlyph,
        FontSize = 14,
        FontFamily = new FontFamily("Segoe Fluent Icons"),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _chipsPanel = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        Visibility = Visibility.Collapsed,
    };

    private readonly TsBadge _freshnessChip = new() { Status = StatusKind.Warning };

    private readonly TextBlock _helpText = new()
    {
        FontSize = HelpFontSize,
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
    };

    private readonly TextBlock _validationText = new()
    {
        FontSize = HelpFontSize,
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
    };

    private readonly StackPanel _errorPanel = new()
    {
        Spacing = 6,
        Visibility = Visibility.Collapsed,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly TextBlock _errorTitle = new() { FontSize = SummaryFontSize, TextWrapping = TextWrapping.Wrap };
    private readonly TsButton _retry = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small };

    private readonly Popup _popup = new() { DesiredPlacement = PopupPlacementMode.BottomEdgeAlignedLeft };
    private readonly Border _dropdown = new()
    {
        CornerRadius = new CornerRadius(DropdownCornerRadius),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(4),
    };

    private readonly ScrollViewer _scroll = new()
    {
        MaxHeight = DropdownMaxHeight,
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        HorizontalScrollMode = ScrollMode.Disabled,
    };

    private readonly StackPanel _list = new() { Orientation = Orientation.Vertical, Spacing = 2 };

    private bool _opened;
    private bool _disposed;
    private bool _suppressRowEvents;

    /// <summary>
    /// Creates a headless-safe surface over an empty static fleet and the passthrough localizer — the native
    /// analogue of mounting the web component in an isolated gallery host. It renders the empty-fleet state.
    /// Production callers use the seam constructor.
    /// </summary>
    public VehicleMultiSelect()
        : this(new StaticVehicleMultiSelectFleetSource(), PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its fleet read seam, the i18n facade and optional seams.</summary>
    /// <param name="fleetSource">The fleet read port (web <c>useVehicles</c>); the surface's P1/S8 seam.</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="initialSelection">The initial value (web <c>value</c>); defaults to the fleet-wide sentinel.</param>
    /// <param name="announcer">The announcer bus (web <c>useAnnouncer()</c>); defaults to the shared bus.</param>
    /// <param name="validationErrorKey">An inline validation error i18n key (web <c>errorKey</c>); null when valid.</param>
    /// <param name="disabled">When true the trigger is non-interactive (web <c>disabled</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleMultiSelect(
        IVehicleMultiSelectFleetSource fleetSource,
        ILocalizer localizer,
        VehicleMultiSelection? initialSelection = null,
        IAnnouncerBus? announcer = null,
        string? validationErrorKey = null,
        bool disabled = false,
        VehicleMultiSelectDiagnostics? diagnostics = null)
        : this(
            new VehicleMultiSelectViewModel(
                fleetSource, localizer, initialSelection, announcer, validationErrorKey, disabled),
            diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleMultiSelect(VehicleMultiSelectViewModel viewModel, VehicleMultiSelectDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new VehicleMultiSelectDiagnostics();
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        BuildLayout();

        _trigger.Click += OnTriggerClicked;
        _trigger.KeyDown += OnTriggerKeyDown;
        _retry.Click += OnRetryClicked;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>VehicleMultiSelect</c>).</summary>
    public static string Slug => VehicleMultiSelectRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public VehicleMultiSelectViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _trigger.Click -= OnTriggerClicked;
        _trigger.KeyDown -= OnTriggerKeyDown;
        _retry.Click -= OnRetryClicked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _popup.IsOpen = false;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new VehicleMultiSelectAutomationPeer(this);

    private void BuildLayout()
    {
        _triggerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _triggerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _loadingPanel.Children.Add(_loadingRing);
        _loadingPanel.Children.Add(_loadingText);

        var summaryHost = new Grid { VerticalAlignment = VerticalAlignment.Center };
        summaryHost.Children.Add(_summaryBadge);
        summaryHost.Children.Add(_loadingPanel);
        Grid.SetColumn(summaryHost, 0);
        Grid.SetColumn(_chevron, 1);
        _triggerGrid.Children.Add(summaryHost);
        _triggerGrid.Children.Add(_chevron);
        _trigger.Content = _triggerGrid;

        _chipsPanel.Children.Add(_freshnessChip);

        _errorPanel.Children.Add(_errorTitle);
        _errorPanel.Children.Add(_retry);

        _scroll.Content = _list;
        _dropdown.Child = _scroll;
        _popup.Child = _dropdown;

        _root.Children.Add(_trigger);
        _root.Children.Add(_errorPanel);
        _root.Children.Add(_chipsPanel);
        _root.Children.Add(_helpText);
        _root.Children.Add(_validationText);
        _root.Children.Add(_popup);
        Content = _root;

        _loadingText.Foreground = DisplayTokens.TextSecondary;
        _helpText.Foreground = DisplayTokens.TextMuted;
        _validationText.Foreground = DisplayTokens.Brush("TsColorDangerBrush");
        _errorTitle.Foreground = DisplayTokens.TextPrimary;
        _chevron.Foreground = DisplayTokens.TextMuted;
        _dropdown.Background = DisplayTokens.Surface;
        _dropdown.BorderBrush = DisplayTokens.Border;

        // The validation error is an assertive live region (web role="alert").
        AutomationProperties.SetLiveSetting(_validationText, AutomationLiveSetting.Assertive);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _popup.XamlRoot = XamlRoot;
        _popup.PlacementTarget = _trigger;

        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
            await _viewModel.LoadVehiclesAsync().ConfigureAwait(true);
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void OnTriggerClicked(object sender, RoutedEventArgs e) => _viewModel.Toggle();

    private void OnTriggerKeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case VirtualKey.Down:
                _viewModel.Open();
                e.Handled = true;
                break;
            case VirtualKey.Escape when _viewModel.IsOpen:
                _viewModel.Close();
                e.Handled = true;
                break;
            default:
                break;
        }
    }

    private async void OnRetryClicked(object sender, RoutedEventArgs e) =>
        await _viewModel.RetryVehiclesAsync().ConfigureAwait(true);

    private void Render()
    {
        // Field + listbox accessible name (web label).
        AutomationProperties.SetName(this, _viewModel.Label);
        AutomationProperties.SetName(_trigger, _viewModel.Label);

        bool isError = _viewModel.IsFleetError;
        bool isLoading = _viewModel.IsLoading;

        // Trigger / error-card swap (the fleet-load error replaces the trigger with a retry card).
        _trigger.Visibility = isError ? Visibility.Collapsed : Visibility.Visible;
        _errorPanel.Visibility = isError ? Visibility.Visible : Visibility.Collapsed;
        _trigger.IsEnabled = !_viewModel.IsDisabled && !isLoading;

        // Loading vs summary inside the trigger.
        _loadingPanel.Visibility = isLoading ? Visibility.Visible : Visibility.Collapsed;
        _summaryBadge.Visibility = isLoading ? Visibility.Collapsed : Visibility.Visible;
        _chevron.Visibility = isLoading ? Visibility.Collapsed : Visibility.Visible;
        _loadingRing.IsActive = isLoading;
        _loadingText.Text = _viewModel.LoadingLabel;
        AutomationProperties.SetName(_loadingRing, _viewModel.LoadingLabel);

        _summaryBadge.Content = _viewModel.TriggerSummary;
        _summaryBadge.Opacity = _viewModel.IsDisabled ? 0.6 : 1.0;
        AutomationProperties.SetName(_summaryBadge, _viewModel.TriggerSummary);
        _chevron.Glyph = _viewModel.IsOpen ? ChevronUpGlyph : ChevronDownGlyph;

        // Fleet-load error card (web QueryError equivalent).
        _errorTitle.Text = _viewModel.ErrorTitle;
        _retry.Text = _viewModel.RetryLabel;
        AutomationProperties.SetName(_retry, _viewModel.RetryLabel);

        // Freshness chip (stale / offline) — a cached fleet is never hidden behind a refresh.
        bool showChip = _viewModel.IsStale || _viewModel.IsOffline;
        _chipsPanel.Visibility = showChip ? Visibility.Visible : Visibility.Collapsed;
        if (showChip)
        {
            _freshnessChip.Status = _viewModel.IsOffline ? StatusKind.Danger : StatusKind.Warning;
            string chip = _viewModel.IsOffline ? _viewModel.OfflineLabel : _viewModel.StaleLabel;
            _freshnessChip.Content = chip;
            AutomationProperties.SetName(_freshnessChip, chip);
        }

        // Empty-fleet help (web isFleetEmpty).
        _helpText.Visibility = _viewModel.IsFleetEmpty ? Visibility.Visible : Visibility.Collapsed;
        _helpText.Text = _viewModel.EmptyFleetHelp;

        // Inline validation error (web errorKey).
        _validationText.Visibility = _viewModel.HasValidationError ? Visibility.Visible : Visibility.Collapsed;
        _validationText.Text = _viewModel.ValidationError ?? string.Empty;
        _trigger.BorderBrush = _viewModel.HasValidationError
            ? DisplayTokens.Brush("TsColorDangerBrush")
            : DisplayTokens.Border;

        RenderList();

        _dropdown.MinWidth = _trigger.ActualWidth;
        _popup.IsOpen = _viewModel.IsOpen && IsLoaded;
    }

    private void RenderList()
    {
        _suppressRowEvents = true;
        try
        {
            _list.Children.Clear();
            AutomationProperties.SetName(_list, _viewModel.Label);

            VehicleMultiSelectOptionKind? previousKind = null;
            foreach (VehicleMultiSelectOption option in _viewModel.Options)
            {
                // A hairline divider separates the sentinel, the fleet rows and the unknown rows (web dividers).
                if (previousKind is { } prev && prev != option.Kind)
                {
                    _list.Children.Add(BuildDivider());
                }

                _list.Children.Add(BuildOptionRow(option));
                previousKind = option.Kind;
            }
        }
        finally
        {
            _suppressRowEvents = false;
        }
    }

    private CheckBox BuildOptionRow(VehicleMultiSelectOption option)
    {
        var label = new TextBlock
        {
            Text = option.Label,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = option.Kind == VehicleMultiSelectOptionKind.Unknown
                ? DisplayTokens.TextMuted
                : DisplayTokens.TextPrimary,
        };

        FrameworkElement content;
        if (option.Kind == VehicleMultiSelectOptionKind.Unknown)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            row.Children.Add(label);
            var badge = new TsBadge { Status = StatusKind.Warning, Content = _viewModel.UnknownBadge };
            AutomationProperties.SetName(badge, _viewModel.UnknownBadge);
            row.Children.Add(badge);
            content = row;
        }
        else
        {
            content = label;
        }

        var checkbox = new CheckBox
        {
            Content = content,
            IsChecked = option.IsChecked,
            MinWidth = 0,
            Padding = new Thickness(RowPaddingX, RowPaddingY, RowPaddingX, RowPaddingY),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };

        AutomationProperties.SetName(checkbox, option.Label);
        AutomationProperties.SetAutomationId(checkbox, option.AutomationId);

        long id = option.Id;
        VehicleMultiSelectOptionKind kind = option.Kind;
        checkbox.Click += (_, _) =>
        {
            if (_suppressRowEvents)
            {
                return;
            }

            if (kind == VehicleMultiSelectOptionKind.AllSentinel)
            {
                _viewModel.ToggleAll();
            }
            else
            {
                _viewModel.ToggleVehicle(id);
            }
        };

        return checkbox;
    }

    private static Border BuildDivider() => new()
    {
        Height = 1,
        Margin = new Thickness(0, 4, 0, 4),
        Background = DisplayTokens.Border,
    };

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

    private sealed class VehicleMultiSelectAutomationPeer : FrameworkElementAutomationPeer, IExpandCollapseProvider
    {
        public VehicleMultiSelectAutomationPeer(VehicleMultiSelect owner)
            : base(owner)
        {
        }

        private VehicleMultiSelect Surface => (VehicleMultiSelect)Owner;

        // web aria-expanded: the picker reports whether its listbox is open.
        public ExpandCollapseState ExpandCollapseState =>
            Surface.ViewModel.IsOpen ? ExpandCollapseState.Expanded : ExpandCollapseState.Collapsed;

        public void Expand() => Surface.ViewModel.Open();

        public void Collapse() => Surface.ViewModel.Close();

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.ComboBox;

        protected override object? GetPatternCore(PatternInterface patternInterface) =>
            patternInterface == PatternInterface.ExpandCollapse ? this : base.GetPatternCore(patternInterface);

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.ViewModel.Label : name;
        }
    }
}
