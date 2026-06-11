using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 DLQ-Inspector entry drawer — a parity port of
/// <c>web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx</c>. A right-anchored slide-in side
/// sheet that surfaces a full dead-letter entry: a header with the "DLQ entry #{id}" title and a close
/// affordance, a body that shows the busy spinner while the full payload loads, a friendly empty state when
/// there is no entry, or — once a head (full ?? summary) is present — a glass panel of the eight summary
/// fields plus a second glass panel hosting the inner / raw payload tabs (each with a copy affordance and a
/// monospace payload viewer that falls back to a binary marker for non-UTF-8 bodies), and a footer with the
/// Close + Replay actions (Replay disabled per the server flag / replayability / in-flight / loading gate and
/// showing a busy ring while a replay runs). It is a controlled surface: all data and the open state flow in
/// through the shared <see cref="EntryDrawerViewModel"/> and the close / replay intents flow back out through
/// its events; the view never performs HTTP. Every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class EntryDrawer : ContentControl, IDisposable
{
    private const string CloseGlyph = "\uE711"; // Cancel (the web lucide X)
    private const string ReplayGlyph = "\uE724"; // Send (the web lucide Send)
    private const double PaneWidth = 460;
    private const double PayloadMaxHeight = 320;

    private readonly EntryDrawerViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsDrawer _drawer = new() { Side = DrawerSide.Right, PaneWidth = PaneWidth };
    private readonly Grid _root = new();
    private readonly SectionTitle _titleText = new();
    private readonly TsButton _closeIcon = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = CloseGlyph };
    private readonly ScrollViewer _bodyHost = new();
    private readonly TsButton _closeButton = new() { Variant = ButtonVariant.Secondary };
    private readonly TsButton _replayButton = new() { Variant = ButtonVariant.Primary, IconGlyph = ReplayGlyph };

    private bool _wasOpen;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its state-holder and localizer.</summary>
    /// <param name="viewModel">The shared state holder the view renders (P1/S8 seam).</param>
    /// <param name="localizer">The i18n facade (kept for symmetry with the sibling surfaces).</param>
    public EntryDrawer(EntryDrawerViewModel viewModel, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(viewModel);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = viewModel;
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;

        BuildChrome();

        _closeIcon.Click += OnCloseClick;
        _closeButton.Click += OnCloseClick;
        _replayButton.Click += OnReplayClick;
        _drawer.RegisterPropertyChangedCallback(TsDrawer.IsOpenProperty, OnDrawerIsOpenChanged);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _drawer;
        Render();
    }

    /// <summary>Creates the surface, constructing a state holder over the supplied localizer + diagnostics.</summary>
    public EntryDrawer(ILocalizer localizer, EntryDrawerDiagnostics? diagnostics = null)
        : this(new EntryDrawerViewModel(localizer, diagnostics), localizer)
    {
    }

    /// <summary>The state holder the host assigns the entry, lifecycle flags and open state to.</summary>
    public EntryDrawerViewModel ViewModel => _viewModel;

    private void BuildChrome()
    {
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        AutomationProperties.SetName(_closeIcon, _viewModel.CloseLabel);
        ToolTipService.SetToolTip(_closeIcon, _viewModel.CloseLabel);

        var header = new Grid { Padding = new Thickness(20, 16, 12, 16) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleText, 0);
        Grid.SetColumn(_closeIcon, 1);
        header.Children.Add(_titleText);
        header.Children.Add(_closeIcon);
        header.BorderBrush = DisplayTokens.Border;
        header.BorderThickness = new Thickness(0, 0, 0, 1);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(20);

        var footerButtons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        footerButtons.Children.Add(_closeButton);
        footerButtons.Children.Add(_replayButton);

        var footer = new Border
        {
            Child = footerButtons,
            Padding = new Thickness(20, 12, 20, 12),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 1, 0, 0),
        };

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetRow(header, 0);
        Grid.SetRow(_bodyHost, 1);
        Grid.SetRow(footer, 2);
        _root.Children.Add(header);
        _root.Children.Add(_bodyHost);
        _root.Children.Add(footer);

        AutomationProperties.SetLandmarkType(_root, AutomationLandmarkType.Custom);
        _drawer.DrawerContent = _root;
    }

    private void OnLoaded(object sender, RoutedEventArgs e) => Render();

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the state holder (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        GC.SuppressFinalize(this);
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => _viewModel.RequestClose();

    private void OnReplayClick(object sender, RoutedEventArgs e) => _viewModel.RequestReplay();

    private void OnDrawerIsOpenChanged(DependencyObject sender, DependencyProperty dp)
    {
        // Bridge a light-dismiss / Escape close of the underlying popup back to the host (web onClose).
        if (!_drawer.IsOpen && _viewModel.IsOpen)
        {
            _viewModel.RequestClose();
        }
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        // A pure tab switch only changes the active-tab-derived text; the TabView already hosts both tabs'
        // content, so it needs no body rebuild (avoids tab-click flicker).
        if (e.PropertyName is nameof(EntryDrawerViewModel.ActiveTab)
            or nameof(EntryDrawerViewModel.ActivePayloadText)
            or nameof(EntryDrawerViewModel.ActiveCopyText))
        {
            return;
        }

        ScheduleRender();
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        if (_viewModel.IsOpen && !_wasOpen)
        {
            _viewModel.NotifyOpened();
        }

        _wasOpen = _viewModel.IsOpen;

        AutomationProperties.SetName(_root, _viewModel.RegionLabel);

        _titleText.Value = _viewModel.Title;
        AutomationProperties.SetName(_titleText, _viewModel.Title);

        AutomationProperties.SetName(_closeIcon, _viewModel.CloseLabel);
        ToolTipService.SetToolTip(_closeIcon, _viewModel.CloseLabel);

        _closeButton.Text = _viewModel.CloseLabel;
        AutomationProperties.SetName(_closeButton, _viewModel.CloseLabel);

        _replayButton.Text = _viewModel.ReplayLabel;
        AutomationProperties.SetName(_replayButton, _viewModel.ReplayLabel);
        _replayButton.IsLoading = _viewModel.ReplayInFlight;
        _replayButton.IsEnabled = !_viewModel.ReplayDisabled;

        _bodyHost.Content = BuildBody();

        _drawer.IsOpen = _viewModel.IsOpen;
    }

    private UIElement BuildBody() => _viewModel.State switch
    {
        EntryDrawerState.Loading => BuildLoading(),
        EntryDrawerState.Content => BuildContent(),
        _ => BuildEmpty(),
    };

    private static TsSpinner BuildLoading()
    {
        var spinner = new TsSpinner
        {
            Size = ControlSize.Medium,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 48, 0, 48),
        };
        return spinner;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        Message = _viewModel.EmptyMessage,
        Margin = new Thickness(0, 32, 0, 32),
    };

    private StackPanel BuildContent()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildFieldsPanel());
        column.Children.Add(BuildPayloadPanel());
        return column;
    }

    private TsGlassPanel BuildFieldsPanel()
    {
        var rows = new StackPanel { Spacing = 8, Padding = new Thickness(16) };
        foreach (EntryDrawerField field in _viewModel.Fields)
        {
            rows.Children.Add(BuildFieldRow(field));
        }

        return new TsGlassPanel { Content = rows };
    }

    private static Grid BuildFieldRow(EntryDrawerField field)
    {
        var grid = new Grid { ColumnSpacing = 12, MinHeight = 24 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new Caption { Value = field.Label, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        FrameworkElement value = BuildFieldValue(field);
        value.HorizontalAlignment = HorizontalAlignment.Right;
        value.VerticalAlignment = VerticalAlignment.Center;

        Grid.SetColumn(label, 0);
        Grid.SetColumn(value, 1);
        grid.Children.Add(label);
        grid.Children.Add(value);

        AutomationProperties.SetName(grid, $"{field.Label}, {field.Value}");
        return grid;
    }

    private static FrameworkElement BuildFieldValue(EntryDrawerField field) => field.Style switch
    {
        EntryFieldStyle.Mono => new Code { Value = field.Value },
        EntryFieldStyle.Muted => new Caption { Value = field.Value },
        _ => new Text { Value = field.Value },
    };

    private TsGlassPanel BuildPayloadPanel()
    {
        var tabs = new TsTabs { Margin = new Thickness(16) };
        tabs.TabItems.Add(BuildPayloadTab(EntryDrawerTab.Inner, _viewModel.TabInnerLabel, _viewModel.InnerPayloadText, _viewModel.InnerCopyText));
        tabs.TabItems.Add(BuildPayloadTab(EntryDrawerTab.Raw, _viewModel.TabRawLabel, _viewModel.RawPayloadText, _viewModel.RawCopyText));
        tabs.SelectedIndex = (int)_viewModel.ActiveTab;
        tabs.SelectionChanged += OnTabSelectionChanged;

        return new TsGlassPanel { Content = tabs };
    }

    private TabViewItem BuildPayloadTab(EntryDrawerTab tab, string header, string payloadText, string copyText)
    {
        var copyButton = new TsCopyButton
        {
            ValueToCopy = copyText,
            CopyLabel = _viewModel.CopyLabel,
            CopiedLabel = _viewModel.CopiedLabel,
            Text = _viewModel.CopyLabel,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetName(copyButton, $"{_viewModel.CopyLabel} {header}");

        var content = new StackPanel { Spacing = 8, Margin = new Thickness(0, 12, 0, 0) };
        content.Children.Add(copyButton);
        content.Children.Add(BuildPayloadViewer(header, payloadText));

        return new TabViewItem
        {
            Header = header,
            Content = content,
            IsClosable = false,
        };
    }

    private static Border BuildPayloadViewer(string header, string payloadText)
    {
        var code = new Code { Value = payloadText };

        var scroller = new ScrollViewer
        {
            Content = code,
            MaxHeight = PayloadMaxHeight,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            Padding = new Thickness(12),
        };

        var border = new Border
        {
            Child = scroller,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Background = DisplayTokens.Surface,
        };

        AutomationProperties.SetName(border, $"{header}, {payloadText}");
        return border;
    }

    private void OnTabSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is TabView { SelectedIndex: >= 0 } view)
        {
            _viewModel.SetActiveTab(view.SelectedIndex == (int)EntryDrawerTab.Raw ? EntryDrawerTab.Raw : EntryDrawerTab.Inner);
        }
    }
}
