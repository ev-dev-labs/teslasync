using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>HistoryListRow</c> shared surface — a parity port of
/// <c>web/src/components/data-display/HistoryListRow.tsx</c>. It is the generic, slot-based row the history-style
/// pages compose (the web <c>DriveCard</c> under <c>/drives</c> and <c>ChargingSessionCard</c> under
/// <c>/charging</c> both render the same row with different leading badges, metric chips and hover actions). The
/// layout reproduces the web slots top-down: an optional leading checkbox column (a sibling of the row body so a
/// selection toggle never navigates), the row body — a <see cref="TsGlassPanel"/> (the native
/// <c>GlassPanel</c>) holding a fixed-width leading badge, a stacked primary / route / metrics / insight column,
/// hover-revealed action buttons pinned to the top-right and a trailing chevron. Activation reproduces the web
/// row's mutually-exclusive <c>href</c> / <c>onClick</c> contract: a navigable row drives the
/// <see cref="IHistoryListRowNavigator"/> seam (the react-router <c>&lt;Link&gt;</c>), an invoke-only row raises
/// <see cref="Activated"/> (the web <c>onClick</c>); clicks inside the checkbox and actions regions are swallowed
/// so they never activate the row (the web <c>stopPropagation</c>). All render decisions flow through
/// <see cref="HistoryListRowViewModel"/> and its pure projection; the view performs no I/O.
///
/// <para>
/// State coverage: the web source is a pure presentational slot container with no data source and no
/// asynchronous read, so it has no loading / error / stale / offline chrome to reproduce. The states it actually
/// has are reproduced in full: the ready row, the defensive empty row (no primary content → a muted dash marker
/// rather than a blank box), each slot present/absent, the hover-revealed actions present/absent, the chevron
/// shown/hidden, the selected tint, each glow accent, and the navigable / invoke-only / inert activation
/// branches. The body is a keyboard-focusable button when activatable (Narrator name + Invoke/Enter/Space) and
/// inert group chrome otherwise. The <c>view.opened</c> diagnostic is emitted once when the row is shown.
/// </para>
/// </summary>
public sealed partial class HistoryListRow : ContentControl, IDisposable
{
    private const double RootColumnSpacing = 8;   // web outer flex gap-2
    private const double ContentColumnSpacing = 12; // web inner flex gap-3
    private const double LineSpacing = 4;          // web mb-1 between the stacked lines
    private const double ActionsSpacing = 4;       // web actions gap-1
    private const double ActionsInset = 8;         // web actions right-2 top-2
    private const double CheckboxInset = 8;        // web checkbox pl-2
    private const double ChevronFontSize = 16;     // web chevron h-4 w-4

    private readonly HistoryListRowViewModel _viewModel;
    private readonly HistoryListRowDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ContentControl _checkboxHost = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(CheckboxInset, 0, 0, 0),
    };

    private readonly HistoryRowBody _body = new();
    private readonly Grid _bodyGrid = new();
    private readonly Grid _contentRow = new() { ColumnSpacing = ContentColumnSpacing };

    private readonly ContentControl _leadingHost = new()
    {
        Width = HistoryListRowRegistration.LeadingColumnWidth,
        HorizontalContentAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _mainStack = new() { Spacing = LineSpacing };
    private readonly ContentControl _primaryHost = new();
    private readonly TextBlock _emptyMark = new() { Text = "\u2014" }; // em dash — locale-neutral empty marker
    private readonly ContentControl _routeHost = new();
    private readonly ContentControl _metricsHost = new();
    private readonly ContentControl _insightHost = new();

    private readonly StackPanel _actionsOverlay = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = ActionsSpacing,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(0, ActionsInset, ActionsInset, 0),
        Opacity = 0,
    };

    private readonly FontIcon _chevron = new()
    {
        Glyph = HistoryListRowRegistration.ChevronGlyph,
        FontSize = ChevronFontSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly List<UIElement> _actions = new();

    private bool _initialized;
    private bool _opened;
    private bool _renderQueued;
    private bool _pointerOver;
    private bool _focusWithin;
    private bool _disposed;

    /// <summary>Creates a headless-safe, empty, non-interactive row (the designer / isolated-host entry point).</summary>
    public HistoryListRow()
        : this(new HistoryListRowViewModel(), diagnostics: null)
    {
    }

    /// <summary>Creates the row over an optional navigation seam and diagnostics sink.</summary>
    /// <param name="navigator">The navigation seam a navigable row drives (web react-router <c>&lt;Link&gt;</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> / activation events.</param>
    public HistoryListRow(IHistoryListRowNavigator? navigator, HistoryListRowDiagnostics? diagnostics = null)
        : this(new HistoryListRowViewModel(navigator), diagnostics)
    {
    }

    /// <summary>Creates the row over an explicit state holder (tests / headless hosts) and diagnostics sink.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> / activation events.</param>
    public HistoryListRow(HistoryListRowViewModel viewModel, HistoryListRowDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new HistoryListRowDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        BuildChrome();
        WireUp();

        _initialized = true;
        Sync();
    }

    /// <summary>Raised when an invoke-only row is activated (web <c>onClick</c>); the host runs its handler.</summary>
    public event EventHandler? Activated;

    /// <summary>The canonical surface slug (<c>HistoryListRow</c>).</summary>
    public static string Slug => HistoryListRowRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public HistoryListRowViewModel ViewModel => _viewModel;

    /// <summary>Optional leading checkbox slot (web <c>checkbox</c>); clicks here never activate the row.</summary>
    public object? Checkbox
    {
        get => GetValue(CheckboxProperty);
        set => SetValue(CheckboxProperty, value);
    }

    /// <summary>Optional fixed-width leading badge slot (web <c>leading</c>).</summary>
    public object? Leading
    {
        get => GetValue(LeadingProperty);
        set => SetValue(LeadingProperty, value);
    }

    /// <summary>Required primary line slot (web <c>primary</c>); when null the row renders the empty marker.</summary>
    public object? Primary
    {
        get => GetValue(PrimaryProperty);
        set => SetValue(PrimaryProperty, value);
    }

    /// <summary>Optional second line slot (web <c>route</c>).</summary>
    public object? Route
    {
        get => GetValue(RouteProperty);
        set => SetValue(RouteProperty, value);
    }

    /// <summary>Optional metric-chips line slot (web <c>metrics</c>).</summary>
    public object? Metrics
    {
        get => GetValue(MetricsProperty);
        set => SetValue(MetricsProperty, value);
    }

    /// <summary>Optional inline-insight line slot (web <c>insight</c>).</summary>
    public object? Insight
    {
        get => GetValue(InsightProperty);
        set => SetValue(InsightProperty, value);
    }

    /// <summary>Navigation target (web <c>href</c>); when set, activating the row drives the navigation seam.</summary>
    public string? Href
    {
        get => (string?)GetValue(HrefProperty);
        set => SetValue(HrefProperty, value);
    }

    /// <summary>
    /// Whether the host wired a click handler (web <c>onClick</c>). Set true and subscribe to
    /// <see cref="Activated"/> for an invoke-only row; ignored when <see cref="Href"/> is set (href wins).
    /// </summary>
    public bool Clickable
    {
        get => (bool)GetValue(ClickableProperty);
        set => SetValue(ClickableProperty, value);
    }

    /// <summary>Whether the row carries the selected tint (web <c>selected</c>).</summary>
    public bool Selected
    {
        get => (bool)GetValue(SelectedProperty);
        set => SetValue(SelectedProperty, value);
    }

    /// <summary>The hover glow accent (web <c>glow</c>); defaults to <see cref="HistoryListRowGlow.Cyan"/>.</summary>
    public HistoryListRowGlow Glow
    {
        get => (HistoryListRowGlow)GetValue(GlowProperty);
        set => SetValue(GlowProperty, value);
    }

    /// <summary>Whether to hide the trailing chevron (web <c>hideChevron</c>).</summary>
    public bool HideChevron
    {
        get => (bool)GetValue(HideChevronProperty);
        set => SetValue(HideChevronProperty, value);
    }

    /// <summary>The row's Narrator name when activatable (the caller-composed web link accessible content).</summary>
    public string? AccessibleName
    {
        get => (string?)GetValue(AccessibleNameProperty);
        set => SetValue(AccessibleNameProperty, value);
    }

    /// <summary>Stable automation hook (web <c>testId</c>); null uses the surface default id.</summary>
    public string? TestId
    {
        get => (string?)GetValue(TestIdProperty);
        set => SetValue(TestIdProperty, value);
    }

    /// <summary>
    /// Replace the hover-revealed action buttons (web <c>actions</c>). They are pinned to the row body's
    /// top-right and are revealed on pointer-hover or keyboard focus; clicks on them never activate the row.
    /// </summary>
    /// <param name="actions">The action elements, in order; null or empty clears them.</param>
    public void SetActions(IReadOnlyList<UIElement>? actions)
    {
        _actions.Clear();
        if (actions is not null)
        {
            _actions.AddRange(actions);
        }

        Sync();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _body.Invoked -= OnBodyInvoked;
        _body.PointerEntered -= OnBodyPointerEntered;
        _body.PointerExited -= OnBodyPointerExited;
        _body.GotFocus -= OnBodyGotFocus;
        _body.LostFocus -= OnBodyLostFocus;
        _checkboxHost.Tapped -= OnRegionTapped;
        _actionsOverlay.Tapped -= OnRegionTapped;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void BuildChrome()
    {
        _emptyMark.Foreground = DisplayTokens.TextMuted;
        _emptyMark.VerticalAlignment = VerticalAlignment.Center;

        _mainStack.Children.Add(_primaryHost);
        _mainStack.Children.Add(_routeHost);
        _mainStack.Children.Add(_metricsHost);
        _mainStack.Children.Add(_insightHost);

        _contentRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _contentRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _contentRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_leadingHost, 0);
        Grid.SetColumn(_mainStack, 1);
        Grid.SetColumn(_chevron, 2);
        _contentRow.Children.Add(_leadingHost);
        _contentRow.Children.Add(_mainStack);
        _contentRow.Children.Add(_chevron);

        // The actions overlay sits above the content row in the same cell, pinned top-right (web absolute right-2 top-2).
        _bodyGrid.Children.Add(_contentRow);
        _bodyGrid.Children.Add(_actionsOverlay);

        _body.Padding = new Thickness(HistoryListRowRegistration.PanelPadding);
        _body.Content = _bodyGrid;

        _root.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _root.ColumnSpacing = RootColumnSpacing;

        Grid.SetColumn(_checkboxHost, 0);
        Grid.SetColumn(_body, 1);
        _root.Children.Add(_checkboxHost);
        _root.Children.Add(_body);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Content = _root;
    }

    private void WireUp()
    {
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _body.Invoked += OnBodyInvoked;
        _body.PointerEntered += OnBodyPointerEntered;
        _body.PointerExited += OnBodyPointerExited;
        _body.GotFocus += OnBodyGotFocus;
        _body.LostFocus += OnBodyLostFocus;

        // Clicks inside the checkbox and actions regions never activate the row (web stopPropagation).
        _checkboxHost.Tapped += OnRegionTapped;
        _actionsOverlay.Tapped += OnRegionTapped;

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private static void OnAnyPropertyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((HistoryListRow)d).Sync();

    private void OnBodyInvoked(object? sender, EventArgs e)
    {
        HistoryListRowActivation activation = _viewModel.Activate();
        if (activation == HistoryListRowActivation.None)
        {
            return;
        }

        _diagnostics.RecordActivated();
        Activated?.Invoke(this, EventArgs.Empty);
    }

    private static void OnRegionTapped(object sender, TappedRoutedEventArgs e) => e.Handled = true;

    private void OnBodyPointerEntered(object sender, PointerRoutedEventArgs e)
    {
        _pointerOver = true;
        UpdateActionsReveal();
        UpdateChevronAccent();
    }

    private void OnBodyPointerExited(object sender, PointerRoutedEventArgs e)
    {
        _pointerOver = false;
        UpdateActionsReveal();
        UpdateChevronAccent();
    }

    private void OnBodyGotFocus(object sender, RoutedEventArgs e)
    {
        _focusWithin = true;
        UpdateActionsReveal();
    }

    private void OnBodyLostFocus(object sender, RoutedEventArgs e)
    {
        _focusWithin = false;
        UpdateActionsReveal();
    }

    private void Sync()
    {
        if (!_initialized)
        {
            return;
        }

        var props = new HistoryListRowProps(
            HasPrimary: Primary is not null,
            HasCheckbox: Checkbox is not null,
            HasLeading: Leading is not null,
            HasRoute: Route is not null,
            HasMetrics: Metrics is not null,
            HasInsight: Insight is not null,
            ActionCount: _actions.Count,
            Href: Href,
            HasClickHandler: Clickable,
            Selected: Selected,
            Glow: Glow,
            HideChevron: HideChevron,
            AccessibleName: AccessibleName,
            TestId: TestId);

        _viewModel.UpdateProps(props);
        ScheduleRender();
    }

    private void ScheduleRender()
    {
        if (_renderQueued || _disposed)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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
        HistoryListRowProjection projection = _viewModel.Projection;

        // Checkbox column (web: sibling of the body so a toggle never navigates).
        _checkboxHost.Content = Checkbox;
        _checkboxHost.Visibility = projection.ShowCheckbox ? Visibility.Visible : Visibility.Collapsed;

        // Leading badge column (web w-9 centred).
        _leadingHost.Content = Leading;
        _leadingHost.Visibility = projection.ShowLeading ? Visibility.Visible : Visibility.Collapsed;

        // Primary line, or the defensive empty marker (web primary is required; never a blank box).
        _primaryHost.Content = projection.ShowPrimary ? Primary : _emptyMark;

        _routeHost.Content = Route;
        _routeHost.Visibility = projection.ShowRoute ? Visibility.Visible : Visibility.Collapsed;

        _metricsHost.Content = Metrics;
        _metricsHost.Visibility = projection.ShowMetrics ? Visibility.Visible : Visibility.Collapsed;

        _insightHost.Content = Insight;
        _insightHost.Visibility = projection.ShowInsight ? Visibility.Visible : Visibility.Collapsed;

        RenderActions(projection);

        _chevron.Visibility = projection.ShowChevron ? Visibility.Visible : Visibility.Collapsed;
        UpdateChevronAccent();

        RenderGlowAndSelection(projection);
        RenderActivation(projection);
        RenderAutomation(projection);
    }

    private void RenderActions(HistoryListRowProjection projection)
    {
        _actionsOverlay.Children.Clear();
        if (!projection.ShowActions)
        {
            _actionsOverlay.Visibility = Visibility.Collapsed;
            return;
        }

        foreach (UIElement action in _actions)
        {
            _actionsOverlay.Children.Add(action);
        }

        _actionsOverlay.Visibility = Visibility.Visible;
        UpdateActionsReveal();
    }

    private void RenderGlowAndSelection(HistoryListRowProjection projection)
    {
        _body.Glow = MapGlow(projection.Glow);

        // web: a selected row tints its border cyan; otherwise the glow accent drives the border.
        string borderKey = projection.IsSelected
            ? HistoryListRowRegistration.SelectedBorderBrushKey
            : projection.GlowBrushKey;
        _body.BorderBrush = DisplayTokens.Brush(borderKey);
    }

    private void RenderActivation(HistoryListRowProjection projection)
    {
        _body.Interactive = projection.IsInteractive;
        _body.IsTabStop = projection.IsInteractive;
    }

    private void RenderAutomation(HistoryListRowProjection projection)
    {
        AutomationProperties.SetAutomationId(this, projection.AutomationId ?? HistoryListRowRegistration.RootAutomationId);

        if (projection.PanelAutomationId is { } panelId)
        {
            AutomationProperties.SetAutomationId(_body, panelId);
        }

        // The activatable body carries the row's Narrator name (web link accessible content); otherwise it
        // inherits its name from the composed primary content.
        if (projection.IsInteractive && projection.AccessibleName.Length > 0)
        {
            AutomationProperties.SetName(_body, projection.AccessibleName);
        }
        else
        {
            _body.ClearValue(AutomationProperties.NameProperty);
        }

        _body.AccessibleName = projection.AccessibleName;

        // The trailing chevron is decorative; the body's name carries the row meaning.
        AutomationProperties.SetAccessibilityView(_chevron, AccessibilityView.Raw);
    }

    private void UpdateActionsReveal()
    {
        if (_viewModel.Projection.ShowActions)
        {
            // web group-hover / group-focus-within: actions fade in on hover or keyboard focus.
            _actionsOverlay.Opacity = _pointerOver || _focusWithin ? 1 : 0;
        }
    }

    private void UpdateChevronAccent() =>
        _chevron.Foreground = _pointerOver
            ? DisplayTokens.Brush(HistoryListRowRegistration.SelectedBorderBrushKey)
            : DisplayTokens.TextMuted;

    private static GlassGlow MapGlow(HistoryListRowGlow glow) => glow switch
    {
        HistoryListRowGlow.Cyan => GlassGlow.Cyan,
        HistoryListRowGlow.Green => GlassGlow.Green,
        HistoryListRowGlow.Purple => GlassGlow.Purple,
        _ => GlassGlow.None,
    };

    /// <summary>Optional leading checkbox slot dependency property (web <c>checkbox</c>).</summary>
    public static readonly DependencyProperty CheckboxProperty = DependencyProperty.Register(
        nameof(Checkbox), typeof(object), typeof(HistoryListRow), new PropertyMetadata(null, OnAnyPropertyChanged));

    /// <summary>Optional leading badge slot dependency property (web <c>leading</c>).</summary>
    public static readonly DependencyProperty LeadingProperty = DependencyProperty.Register(
        nameof(Leading), typeof(object), typeof(HistoryListRow), new PropertyMetadata(null, OnAnyPropertyChanged));

    /// <summary>Required primary line slot dependency property (web <c>primary</c>).</summary>
    public static readonly DependencyProperty PrimaryProperty = DependencyProperty.Register(
        nameof(Primary), typeof(object), typeof(HistoryListRow), new PropertyMetadata(null, OnAnyPropertyChanged));

    /// <summary>Optional second line slot dependency property (web <c>route</c>).</summary>
    public static readonly DependencyProperty RouteProperty = DependencyProperty.Register(
        nameof(Route), typeof(object), typeof(HistoryListRow), new PropertyMetadata(null, OnAnyPropertyChanged));

    /// <summary>Optional metric-chips line slot dependency property (web <c>metrics</c>).</summary>
    public static readonly DependencyProperty MetricsProperty = DependencyProperty.Register(
        nameof(Metrics), typeof(object), typeof(HistoryListRow), new PropertyMetadata(null, OnAnyPropertyChanged));

    /// <summary>Optional inline-insight line slot dependency property (web <c>insight</c>).</summary>
    public static readonly DependencyProperty InsightProperty = DependencyProperty.Register(
        nameof(Insight), typeof(object), typeof(HistoryListRow), new PropertyMetadata(null, OnAnyPropertyChanged));

    /// <summary>Navigation target dependency property (web <c>href</c>).</summary>
    public static readonly DependencyProperty HrefProperty = DependencyProperty.Register(
        nameof(Href), typeof(string), typeof(HistoryListRow), new PropertyMetadata(null, OnAnyPropertyChanged));

    /// <summary>Click-handler-present dependency property (web <c>onClick</c>).</summary>
    public static readonly DependencyProperty ClickableProperty = DependencyProperty.Register(
        nameof(Clickable), typeof(bool), typeof(HistoryListRow), new PropertyMetadata(false, OnAnyPropertyChanged));

    /// <summary>Selected-tint dependency property (web <c>selected</c>).</summary>
    public static readonly DependencyProperty SelectedProperty = DependencyProperty.Register(
        nameof(Selected), typeof(bool), typeof(HistoryListRow), new PropertyMetadata(false, OnAnyPropertyChanged));

    /// <summary>Hover-glow accent dependency property (web <c>glow</c>).</summary>
    public static readonly DependencyProperty GlowProperty = DependencyProperty.Register(
        nameof(Glow), typeof(HistoryListRowGlow), typeof(HistoryListRow),
        new PropertyMetadata(HistoryListRowRegistration.DefaultGlow, OnAnyPropertyChanged));

    /// <summary>Hide-chevron dependency property (web <c>hideChevron</c>).</summary>
    public static readonly DependencyProperty HideChevronProperty = DependencyProperty.Register(
        nameof(HideChevron), typeof(bool), typeof(HistoryListRow), new PropertyMetadata(false, OnAnyPropertyChanged));

    /// <summary>Narrator-name dependency property for an activatable row.</summary>
    public static readonly DependencyProperty AccessibleNameProperty = DependencyProperty.Register(
        nameof(AccessibleName), typeof(string), typeof(HistoryListRow), new PropertyMetadata(null, OnAnyPropertyChanged));

    /// <summary>Automation-hook dependency property (web <c>testId</c>).</summary>
    public static readonly DependencyProperty TestIdProperty = DependencyProperty.Register(
        nameof(TestId), typeof(string), typeof(HistoryListRow), new PropertyMetadata(null, OnAnyPropertyChanged));
}

/// <summary>
/// The activatable row body — a <see cref="TsGlassPanel"/> (the native <c>GlassPanel</c>) that becomes a
/// keyboard-focusable button when the row is interactive. It is the native analogue of the web row's
/// react-router <c>&lt;Link&gt;</c> / clickable <c>GlassPanel</c>: pointer-tap and Enter/Space raise
/// <see cref="Invoked"/> (which the owning <see cref="HistoryListRow"/> routes to navigation or its activation
/// event), and its automation peer reports the Button control type with the Invoke pattern only while
/// <see cref="Interactive"/> — otherwise it is inert group chrome. Lives beside the surface so the checkbox can
/// be a sibling outside the activatable region (the web <c>stopPropagation</c> structure).
/// </summary>
internal sealed partial class HistoryRowBody : TsGlassPanel
{
    /// <summary>Creates the body and wires its tap / keyboard activation.</summary>
    public HistoryRowBody()
    {
        IsTabStop = false;
        UseSystemFocusVisuals = true;
        Tapped += OnTapped;
        KeyDown += OnKeyDown;
    }

    /// <summary>Raised when the body is activated by pointer, keyboard or automation while interactive.</summary>
    public event EventHandler? Invoked;

    /// <summary>Whether the body is currently activatable (drives the Button vs group automation role).</summary>
    public bool Interactive { get; set; }

    /// <summary>The body's Narrator name (the row's accessible name); empty falls back to the composed content.</summary>
    public string AccessibleName { get; set; } = string.Empty;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new HistoryRowBodyAutomationPeer(this);

    /// <summary>Raise <see cref="Invoked"/> on the UI thread (used by the automation Invoke pattern).</summary>
    internal void InvokeFromAutomation()
    {
        if (!Interactive)
        {
            return;
        }

        if (DispatcherQueue is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => Invoked?.Invoke(this, EventArgs.Empty));
        }
        else
        {
            Invoked?.Invoke(this, EventArgs.Empty);
        }
    }

    private void OnTapped(object sender, TappedRoutedEventArgs e)
    {
        if (!Interactive)
        {
            return;
        }

        e.Handled = true;
        Invoked?.Invoke(this, EventArgs.Empty);
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (!Interactive)
        {
            return;
        }

        if (e.Key is Windows.System.VirtualKey.Enter or Windows.System.VirtualKey.Space)
        {
            e.Handled = true;
            Invoked?.Invoke(this, EventArgs.Empty);
        }
    }

    private sealed class HistoryRowBodyAutomationPeer : FrameworkElementAutomationPeer, IInvokeProvider
    {
        public HistoryRowBodyAutomationPeer(HistoryRowBody owner)
            : base(owner)
        {
        }

        private HistoryRowBody Body => (HistoryRowBody)Owner;

        public void Invoke() => Body.InvokeFromAutomation();

        protected override AutomationControlType GetAutomationControlTypeCore() =>
            Body.Interactive ? AutomationControlType.Button : AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Body.AccessibleName : name;
        }

        protected override object? GetPatternCore(PatternInterface patternInterface)
        {
            if (patternInterface == PatternInterface.Invoke && Body.Interactive)
            {
                return this;
            }

            return base.GetPatternCore(patternInterface);
        }
    }
}
