using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Windows.UI.Text;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The native WinUI 3 <c>WidgetShell</c> widget primitive — a parity port of
/// web/src/features/dashboard/widgets/WidgetShell.tsx. It is the shared chrome every dashboard widget renders
/// inside: an optional uppercase muted title row (icon, title, a "?" help affordance, a <see cref="DataFreshness"/>
/// chip, a <see cref="PinButton"/> toggle and caller actions) above a content slot that scrolls when padded and
/// clips when <c>noPadding</c>, with an early <c>loading</c> branch (a full-height <see cref="TsSkeleton"/>), an
/// early <c>error</c> branch (a centered <see cref="TsQueryError"/>) and a transient green glow that fades over
/// 1.5&#160;s whenever the data timestamp advances (suppressed under the OS reduced-motion preference).
///
/// <para>
/// It is purely presentational — it reads no query and performs no fetch — so it reproduces exactly the branches
/// the web source has: the mutually-exclusive loading / error / shell branch (loading wins), the title vs
/// title-less header (the title-less layout floats the freshness chip top-right and right-aligns the actions row),
/// the title-scoped help affordance and pin toggle, and the padded-scroll vs no-padding-clip content slot. All
/// state flows through <see cref="WidgetShellViewModel"/> and the P1/S8 <see cref="IWidgetShellSource"/> props seam;
/// the view performs only platform composition. The freshness chip and pin toggle are composed from their shared
/// surfaces — the freshness chip binds through the in-view <see cref="ShellFreshnessSource"/> (forwarding the web
/// <c>onRefresh</c>), the pin toggle binds through the supplied <see cref="IPinStore"/> as a <c>widget</c> item.
/// Every string flows through the i18n facade. It emits the <c>view.opened</c> diagnostic once when it is shown.
/// </para>
/// </summary>
public sealed partial class WidgetShell : ContentControl, IDisposable
{
    private readonly WidgetShellViewModel _viewModel;
    private readonly WidgetShellDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly ILocalizer _localizer;
    private readonly IPinStore? _pinStore;
    private readonly IToastController? _toast;
    private readonly Action? _onRefresh;

    private readonly Grid _root = new();
    private readonly Border _glowHost;
    private readonly Grid _chromeGrid = new();

    private readonly Grid _titleHeader = new();
    private readonly StackPanel _titleLeft = new() { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _titleRight = new() { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Right };
    private readonly ContentPresenter _iconHost = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly ContentPresenter _helpHost = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentPresenter _freshnessHostTitle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentPresenter _pinHost = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentPresenter _actionsHostTitle = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly Grid _titlelessHeader = new();
    private readonly ContentPresenter _actionsHostTitleless = new() { HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentPresenter _freshnessOverlayHost = new();

    private readonly ScrollViewer _contentScroll = new();
    private readonly ContentPresenter _contentPresenter = new();

    private readonly TsSkeleton _skeleton = new()
    {
        Radius = 12,
        BlockHeight = double.NaN,
        ReduceMotion = MotionPreference.ReduceMotion,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Stretch,
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
        VerticalContentAlignment = VerticalAlignment.Stretch,
    };

    private readonly Grid _errorContainer = new() { Padding = new Thickness(16) };
    private readonly TsQueryError _errorView = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Stretch,
    };

    private readonly TsHelpTooltip _helpTooltip = new();

    private DataFreshness? _freshnessElement;
    private ShellFreshnessSource? _freshnessSource;
    private bool _freshnessCompactCurrent;
    private bool _freshnessCanRefreshCurrent;

    private PinButton? _pinElement;
    private string _pinWidgetIdCurrent = string.Empty;
    private string _pinDashboardIdCurrent = string.Empty;

    private UIElement? _icon;
    private UIElement? _actions;
    private UIElement? _widgetContent;

    private Storyboard? _glowStoryboard;
    private DateTimeOffset? _prevUpdatedAt;
    private bool _hasPrevUpdatedAt;

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the shell with no inputs and no pin store (the designer / parameterless host entry point): it renders
    /// the empty title-less shell. Strings resolve through the passthrough facade; supply an explicit
    /// <see cref="ILocalizer"/>, a bound <see cref="IWidgetShellSource"/> and (optionally) an
    /// <see cref="IPinStore"/> / refresh callback via the other constructors to drive i18n, props, the pin toggle
    /// and the freshness refresh from the composition root.
    /// </summary>
    public WidgetShell()
        : this(PassthroughLocalizer.Instance, new StaticWidgetShellSource(), pinStore: null, toast: null, onRefresh: null, diagnostics: null)
    {
    }

    /// <summary>Creates the surface over the i18n facade and a bound props seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="source">The props state-holder seam (web component props).</param>
    /// <param name="pinStore">The pin seam the composed <see cref="PinButton"/> binds through; null hides the pin toggle.</param>
    /// <param name="toast">The shared toast queue the composed <see cref="PinButton"/> raises pin/unpin toasts through.</param>
    /// <param name="onRefresh">The freshness refresh callback (web <c>onRefresh</c> / <c>query.refetch</c>); null disables the refresh affordance.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WidgetShell(
        ILocalizer localizer,
        IWidgetShellSource source,
        IPinStore? pinStore = null,
        IToastController? toast = null,
        Action? onRefresh = null,
        WidgetShellDiagnostics? diagnostics = null)
        : this(new WidgetShellViewModel(localizer, source), pinStore, toast, onRefresh, diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and its composition seams.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="pinStore">The pin seam the composed <see cref="PinButton"/> binds through; null hides the pin toggle.</param>
    /// <param name="toast">The shared toast queue the composed <see cref="PinButton"/> raises pin/unpin toasts through.</param>
    /// <param name="onRefresh">The freshness refresh callback (web <c>onRefresh</c>); null disables the refresh affordance.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WidgetShell(
        WidgetShellViewModel viewModel,
        IPinStore? pinStore = null,
        IToastController? toast = null,
        Action? onRefresh = null,
        WidgetShellDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new WidgetShellDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _localizer = viewModel.Localizer;
        _pinStore = pinStore;
        _toast = toast;
        _onRefresh = onRefresh;

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _glowHost = BuildGlowHost();
        BuildChromeTree();

        _root.Children.Add(_chromeGrid);
        _root.Children.Add(_skeleton);
        _root.Children.Add(_errorContainer);
        _root.Children.Add(_glowHost);
        Content = _root;

        AutomationProperties.SetAutomationId(this, WidgetShellRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>WidgetShell</c>).</summary>
    public static string Slug => WidgetShellRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public WidgetShellViewModel ViewModel => _viewModel;

    /// <summary>
    /// The leading title-row icon slot (web <c>icon</c>). Shown only in the title layout, before the title text.
    /// Setting a non-null element hosts it; clearing it (null) empties the slot.
    /// </summary>
    public UIElement? Icon
    {
        get => _icon;
        set
        {
            _icon = value;
            ApplyIcon();
        }
    }

    /// <summary>
    /// The trailing header actions slot (web <c>actions</c>). In the title layout it sits after the freshness chip
    /// and pin toggle; in the title-less layout it forms a right-aligned actions row. Setting a non-null element
    /// hosts it; clearing it (null) empties the slot.
    /// </summary>
    public UIElement? Actions
    {
        get => _actions;
        set
        {
            _actions = value;
            ApplyActions();
        }
    }

    /// <summary>
    /// The widget body slot (web <c>children</c>). Hosted in the content area, which scrolls when padded and clips
    /// when <c>noPadding</c>. Setting a non-null element hosts it; clearing it (null) empties the slot.
    /// </summary>
    public UIElement? WidgetContent
    {
        get => _widgetContent;
        set
        {
            _widgetContent = value;
            _contentPresenter.Content = value;
        }
    }

    /// <summary>The accessible name the automation peer reports — the title when present, else empty.</summary>
    internal string AccessibleName => _viewModel.Display.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopGlow();

        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        DetachFreshnessHosts();
        _freshnessElement?.Dispose();
        _freshnessElement = null;

        _pinHost.Content = null;
        _pinElement?.Dispose();
        _pinElement = null;

        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new WidgetShellAutomationPeer(this);

    private static FontWeight Weight(double value) => new() { Weight = (ushort)value };

    private static Border BuildGlowHost()
    {
        // The web "just updated" effect is an outset green box-shadow that eases away. The native form is a brief
        // emerald wash + hairline ring on a non-interactive overlay whose opacity animates to zero over the same
        // window — reduced-motion suppresses it entirely.
        var ring = Windows.UI.Color.FromArgb(
            (byte)(255 * 0.30),
            WidgetShellRegistration.PulseGlowRed,
            WidgetShellRegistration.PulseGlowGreen,
            WidgetShellRegistration.PulseGlowBlue);
        var fill = Windows.UI.Color.FromArgb(
            (byte)(255 * WidgetShellRegistration.PulseGlowOpacity),
            WidgetShellRegistration.PulseGlowRed,
            WidgetShellRegistration.PulseGlowGreen,
            WidgetShellRegistration.PulseGlowBlue);

        return new Border
        {
            IsHitTestVisible = false,
            Opacity = 0,
            CornerRadius = new CornerRadius(12),
            BorderThickness = new Thickness(1.5),
            BorderBrush = new SolidColorBrush(ring),
            Background = new SolidColorBrush(fill),
        };
    }

    private void BuildChromeTree()
    {
        // web "flex h-full flex-col": header takes its natural height at the top, content fills the rest.
        _chromeGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _chromeGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        BuildTitleHeader();
        BuildTitlelessHeader();
        BuildContentArea();

        Grid.SetRow(_titleHeader, 0);
        Grid.SetRow(_titlelessHeader, 0);
        Grid.SetRow(_contentScroll, 1);

        // The title-less freshness overlay floats at the widget's top-right corner over the content (web absolute
        // top-1.5 right-1.5 z-5); add it last so it renders above the content.
        _freshnessOverlayHost.HorizontalAlignment = HorizontalAlignment.Right;
        _freshnessOverlayHost.VerticalAlignment = VerticalAlignment.Top;
        _freshnessOverlayHost.Margin = new Thickness(0, WidgetShellRegistration.FreshnessOverlayTop, WidgetShellRegistration.FreshnessOverlayRight, 0);
        Grid.SetRow(_freshnessOverlayHost, 0);
        Grid.SetRowSpan(_freshnessOverlayHost, 2);

        _chromeGrid.Children.Add(_titleHeader);
        _chromeGrid.Children.Add(_titlelessHeader);
        _chromeGrid.Children.Add(_contentScroll);
        _chromeGrid.Children.Add(_freshnessOverlayHost);

        _errorContainer.Children.Add(_errorView);
    }

    private void BuildTitleHeader()
    {
        _titleHeader.Padding = new Thickness(
            WidgetShellRegistration.HeaderPaddingLeft,
            WidgetShellRegistration.HeaderPaddingTop,
            WidgetShellRegistration.HeaderPaddingRight,
            WidgetShellRegistration.HeaderPaddingBottom);
        _titleHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _titleHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _titleLeft.Spacing = WidgetShellRegistration.IconTitleGap;
        _titleRight.Spacing = WidgetShellRegistration.HeaderActionsGap;

        _titleText.FontSize = WidgetShellRegistration.TitleFontSize;
        _titleText.FontWeight = Weight(WidgetShellRegistration.TitleFontWeight);
        _titleText.CharacterSpacing = (int)WidgetShellRegistration.TitleCharacterSpacing;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.VerticalAlignment = VerticalAlignment.Center;
        _titleText.TextTrimming = TextTrimming.CharacterEllipsis;
        _titleText.TextWrapping = TextWrapping.NoWrap;
        AutomationProperties.SetHeadingLevel(_titleText, AutomationHeadingLevel.Level3);

        _titleLeft.Children.Add(_iconHost);
        _titleLeft.Children.Add(_titleText);
        _titleLeft.Children.Add(_helpHost);

        _titleRight.Children.Add(_freshnessHostTitle);
        _titleRight.Children.Add(_pinHost);
        _titleRight.Children.Add(_actionsHostTitle);

        Grid.SetColumn(_titleLeft, 0);
        Grid.SetColumn(_titleRight, 1);
        _titleHeader.Children.Add(_titleLeft);
        _titleHeader.Children.Add(_titleRight);
    }

    private void BuildTitlelessHeader()
    {
        _titlelessHeader.Padding = new Thickness(
            WidgetShellRegistration.HeaderPaddingLeft,
            WidgetShellRegistration.HeaderPaddingTop,
            WidgetShellRegistration.HeaderPaddingRight,
            WidgetShellRegistration.HeaderPaddingBottom);
        _titlelessHeader.Children.Add(_actionsHostTitleless);
    }

    private void BuildContentArea()
    {
        _contentScroll.HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _contentScroll.HorizontalScrollMode = ScrollMode.Disabled;
        _contentScroll.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _contentScroll.ZoomMode = ZoomMode.Disabled;
        _contentScroll.Content = _contentPresenter;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(WidgetShellViewModel.Display))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        WidgetShellDisplay d = _viewModel.Display;

        AutomationProperties.SetName(this, d.AccessibleName);

        _skeleton.Visibility = d.ShowSkeleton ? Visibility.Visible : Visibility.Collapsed;
        _errorContainer.Visibility = d.ShowError ? Visibility.Visible : Visibility.Collapsed;

        bool showChrome = !d.ShowSkeleton && !d.ShowError;
        _chromeGrid.Visibility = showChrome ? Visibility.Visible : Visibility.Collapsed;

        if (d.ShowError)
        {
            _errorView.Message = d.ErrorMessage;
        }

        if (showChrome)
        {
            UpdateChrome(d);
        }

        UpdatePulse(d);
    }

    private void UpdateChrome(WidgetShellDisplay d)
    {
        _titleHeader.Visibility = d.HasTitle ? Visibility.Visible : Visibility.Collapsed;
        _titlelessHeader.Visibility = (!d.HasTitle && _actions is not null) ? Visibility.Visible : Visibility.Collapsed;

        if (d.HasTitle)
        {
            _titleText.Text = d.TitleDisplay;
            AutomationProperties.SetName(_titleText, d.Title);
            _titleText.Visibility = Visibility.Visible;
        }

        if (d.ShowHelp)
        {
            _helpTooltip.Hint = d.HelpTooltipText;
            AutomationProperties.SetName(_helpTooltip, d.HelpAccessibleName);
            _helpHost.Content = _helpTooltip;
            _helpHost.Visibility = Visibility.Visible;
        }
        else
        {
            _helpHost.Content = null;
            _helpHost.Visibility = Visibility.Collapsed;
        }

        ReconcileFreshness(d);
        PlaceFreshness(d);

        ReconcilePin(d);
        PlacePin(d);

        ApplyIcon();
        ApplyActions();
        ApplyContentPadding(d.NoPadding);
        _contentPresenter.Content = _widgetContent;
    }

    private void ReconcileFreshness(WidgetShellDisplay d)
    {
        if (!d.ShowFreshness)
        {
            if (_freshnessElement is not null)
            {
                DetachFreshnessHosts();
                _freshnessElement.Dispose();
                _freshnessElement = null;
                _freshnessSource = null;
            }

            return;
        }

        var snapshot = new DataFreshnessSnapshot(d.UpdatedAt, d.IsFetching, d.IsStale, d.IsError);
        bool canRefresh = d.FreshnessCanRefresh && _onRefresh is not null;

        bool needsRebuild = _freshnessElement is null
            || _freshnessCompactCurrent != d.FreshnessCompact
            || _freshnessCanRefreshCurrent != canRefresh;

        if (needsRebuild)
        {
            DetachFreshnessHosts();
            _freshnessElement?.Dispose();

            _freshnessSource = new ShellFreshnessSource(snapshot, canRefresh, _onRefresh);
            _freshnessElement = new DataFreshness(_localizer, _freshnessSource, d.FreshnessCompact);
            _freshnessCompactCurrent = d.FreshnessCompact;
            _freshnessCanRefreshCurrent = canRefresh;
        }
        else
        {
            _freshnessSource!.Set(snapshot);
        }
    }

    private void PlaceFreshness(WidgetShellDisplay d)
    {
        _freshnessHostTitle.Content = null;
        _freshnessOverlayHost.Content = null;

        if (d.ShowFreshness && _freshnessElement is not null)
        {
            if (d.HasTitle)
            {
                _freshnessHostTitle.Content = _freshnessElement;
            }
            else
            {
                _freshnessOverlayHost.Content = _freshnessElement;
            }
        }

        _freshnessHostTitle.Visibility = (d.ShowFreshness && d.HasTitle) ? Visibility.Visible : Visibility.Collapsed;
        _freshnessOverlayHost.Visibility = (d.ShowFreshness && !d.HasTitle) ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ReconcilePin(WidgetShellDisplay d)
    {
        bool show = d.ShowPin && _pinStore is not null;
        if (!show)
        {
            if (_pinElement is not null)
            {
                _pinHost.Content = null;
                _pinElement.Dispose();
                _pinElement = null;
                _pinWidgetIdCurrent = string.Empty;
                _pinDashboardIdCurrent = string.Empty;
            }

            return;
        }

        bool needsRebuild = _pinElement is null
            || _pinWidgetIdCurrent != d.PinWidgetId
            || _pinDashboardIdCurrent != d.PinDashboardId;

        if (needsRebuild)
        {
            _pinHost.Content = null;
            _pinElement?.Dispose();

            _pinElement = new PinButton(_pinStore!, PinItemType.Widget, d.PinWidgetId, d.PinDashboardId, _localizer, _toast)
            {
                Size = PinButtonSize.Small,
            };
            _pinWidgetIdCurrent = d.PinWidgetId;
            _pinDashboardIdCurrent = d.PinDashboardId;
        }
    }

    private void PlacePin(WidgetShellDisplay d)
    {
        bool show = d.ShowPin && _pinElement is not null;
        _pinHost.Content = show ? _pinElement : null;
        _pinHost.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ApplyIcon()
    {
        bool show = _icon is not null && _viewModel.Display.HasTitle;
        _iconHost.Content = show ? _icon : null;
        _iconHost.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ApplyActions()
    {
        WidgetShellDisplay d = _viewModel.Display;

        _actionsHostTitle.Content = null;
        _actionsHostTitleless.Content = null;

        if (_actions is null)
        {
            _actionsHostTitle.Visibility = Visibility.Collapsed;
            _actionsHostTitleless.Visibility = Visibility.Collapsed;
            if (!d.HasTitle)
            {
                _titlelessHeader.Visibility = Visibility.Collapsed;
            }

            return;
        }

        if (d.HasTitle)
        {
            _actionsHostTitle.Content = _actions;
            _actionsHostTitle.Visibility = Visibility.Visible;
            _actionsHostTitleless.Visibility = Visibility.Collapsed;
        }
        else
        {
            _actionsHostTitleless.Content = _actions;
            _actionsHostTitleless.Visibility = Visibility.Visible;
            _actionsHostTitle.Visibility = Visibility.Collapsed;
            _titlelessHeader.Visibility = Visibility.Visible;
        }
    }

    private void ApplyContentPadding(bool noPadding)
    {
        if (noPadding)
        {
            // web overflow-hidden: no padding, clipped, no scrolling.
            _contentScroll.Padding = new Thickness(0);
            _contentScroll.VerticalScrollMode = ScrollMode.Disabled;
            _contentScroll.VerticalScrollBarVisibility = ScrollBarVisibility.Hidden;
            _contentScroll.VerticalContentAlignment = VerticalAlignment.Stretch;
        }
        else
        {
            // web px-4 pb-3 overflow-auto: padded, vertically scrollable.
            _contentScroll.Padding = new Thickness(
                WidgetShellRegistration.ContentPaddingLeft,
                0,
                WidgetShellRegistration.ContentPaddingRight,
                WidgetShellRegistration.ContentPaddingBottom);
            _contentScroll.VerticalScrollMode = ScrollMode.Auto;
            _contentScroll.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
            _contentScroll.VerticalContentAlignment = VerticalAlignment.Top;
        }
    }

    private void DetachFreshnessHosts()
    {
        _freshnessHostTitle.Content = null;
        _freshnessOverlayHost.Content = null;
    }

    private void UpdatePulse(WidgetShellDisplay d)
    {
        DateTimeOffset? current = d.EffectiveUpdatedAt;

        // web: pulse only when a real, changed timestamp arrives after the first render (prev defined & different).
        if (_hasPrevUpdatedAt && current.HasValue && _prevUpdatedAt != current)
        {
            PlayPulse();
        }

        _prevUpdatedAt = current;
        _hasPrevUpdatedAt = true;
    }

    private void PlayPulse()
    {
        if (MotionPreference.ReduceMotion || !IsLoaded)
        {
            return;
        }

        StopGlow();

        _glowHost.Opacity = 1;
        var animation = new DoubleAnimation
        {
            From = 1,
            To = 0,
            Duration = new Duration(TimeSpan.FromMilliseconds(WidgetShellRegistration.PulseDurationMs)),
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(animation, _glowHost);
        Storyboard.SetTargetProperty(animation, "Opacity");

        _glowStoryboard = new Storyboard();
        _glowStoryboard.Children.Add(animation);
        _glowStoryboard.Begin();
    }

    private void StopGlow()
    {
        _glowStoryboard?.Stop();
        _glowStoryboard = null;
        _glowHost.Opacity = 0;
    }

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

    /// <summary>
    /// The in-view freshness seam the composed <see cref="DataFreshness"/> binds through — the native analogue of
    /// the web <c>updatedAt</c>/<c>isFetching</c>/<c>isStale</c>/<c>isError</c>/<c>onRefresh</c> props the shell
    /// forwards to its freshness chip. <see cref="Refresh"/> invokes the shell's <c>onRefresh</c> callback (web
    /// <c>query.refetch()</c>); <see cref="Set"/> moves the snapshot and notifies so the chip re-projects.
    /// </summary>
    private sealed class ShellFreshnessSource : IDataFreshnessSource
    {
        private readonly Action? _onRefresh;
        private DataFreshnessSnapshot _current;

        public ShellFreshnessSource(DataFreshnessSnapshot current, bool canRefresh, Action? onRefresh)
        {
            _current = current;
            CanRefresh = canRefresh;
            _onRefresh = onRefresh;
        }

        public event EventHandler? Changed;

        public DataFreshnessSnapshot Current => _current;

        public bool CanRefresh { get; }

        public void Refresh() => _onRefresh?.Invoke();

        public void Set(DataFreshnessSnapshot snapshot)
        {
            _current = snapshot;
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    private sealed class WidgetShellAutomationPeer : FrameworkElementAutomationPeer
    {
        public WidgetShellAutomationPeer(WidgetShell owner)
            : base(owner)
        {
        }

        private WidgetShell Surface => (WidgetShell)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
