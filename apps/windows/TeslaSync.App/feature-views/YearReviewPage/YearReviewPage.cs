using System.Collections.Generic;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Notifications;
using TeslaSync.App.Settings;
using TeslaSync.App.SharedSurfaces;
using Windows.System;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// The native WinUI 3 <c>YearReviewPage</c> — a parity port of the web full-screen story player
/// <c>web/src/features/analytics/pages/YearReviewPage.tsx</c> (route <c>/year-review/:year</c>, nav name
/// <c>YearReview</c>). It binds to a <see cref="YearReviewPageViewModel"/> and renders every web region with
/// Fluent components: the full-bleed loading surface (web <c>isLoading || !data</c>), the "no driving data"
/// surface (web <c>noData</c>: the car glyph, the localized no-data line + hint and the Go Back button), the
/// native error surface (InfoBar + Retry), and the swipe-style slide deck (the segmented progress bar, the
/// vehicle selector shown only for multiple vehicles, the <see cref="SlideRenderer"/> deck host fed by the
/// shared <see cref="YearReviewSlideContentFactory"/>, the tap-navigation zones, the prev/next arrows, the close
/// button, the slide counter and the gated <see cref="AIYearReviewNarration"/> mount). The view is a thin
/// renderer: all branch selection, formatting and i18n happen in the view-model's projection. State changes are
/// marshalled onto the UI thread. Keyboard (←/→/Space/Esc), pointer and Narrator are all wired (ADR-015).
/// </summary>
public sealed partial class YearReviewPage : UserControl, IDisposable
{
    private const double StoryMaxContentWidth = 460;
    private const string CarEmoji = "\uD83D\uDE97";   // 🚗 — the web empty-surface emoji
    private const string CloseGlyph = "\uE711";       // Segoe Fluent — Cancel
    private const string PrevGlyph = "\uE76B";        // Segoe Fluent — ChevronLeft
    private const string NextGlyph = "\uE76C";        // Segoe Fluent — ChevronRight

    private readonly YearReviewPageViewModel _viewModel;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly Grid _root = new() { Background = new SolidColorBrush(Colors.Black) };

    // ── Loading surface ────────────────────────────────────────────────────────────────────────────────────
    private readonly Grid _loadingHost = new();
    private readonly TsSpinner _spinner = new() { Size = ControlSize.Large };

    // ── Empty surface (web 🚗 + noData + noDataHint + Go Back) ────────────────────────────────────────────
    private readonly Grid _emptyHost = new();
    private readonly TextBlock _emptyEmoji = new()
    {
        Text = CarEmoji,
        FontSize = 56,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextAlignment = TextAlignment.Center,
        Margin = new Thickness(0, 0, 0, 16),
    };

    private readonly TextBlock _emptyTitle = new()
    {
        FontSize = 20,
        Foreground = OnDark(0.9),
        HorizontalAlignment = HorizontalAlignment.Center,
        TextAlignment = TextAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 0, 0, 8),
    };

    private readonly TextBlock _emptyHint = new()
    {
        FontSize = 14,
        Foreground = OnDark(0.6),
        HorizontalAlignment = HorizontalAlignment.Center,
        TextAlignment = TextAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 0, 0, 24),
    };

    private readonly TsButton _goBackButton = new()
    {
        Variant = ButtonVariant.Subtle,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    // ── Error surface (native InfoBar + Retry) ────────────────────────────────────────────────────────────
    private readonly Grid _errorHost = new();
    private readonly TsQueryError _errorState = new() { MaxWidth = 420, HorizontalAlignment = HorizontalAlignment.Center };

    // ── Success surface (the swipe-style story player) ────────────────────────────────────────────────────
    private readonly Grid _successHost = new();
    private readonly SlideRenderer _slideRenderer;
    private readonly Grid _progressGrid = new()
    {
        VerticalAlignment = VerticalAlignment.Top,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        Height = 3,
        Margin = new Thickness(16, 12, 16, 0),
        ColumnSpacing = 4,
    };

    private readonly List<Border> _progressSegments = new();

    private readonly TsSelect _vehicleSelect = new()
    {
        VerticalAlignment = VerticalAlignment.Top,
        HorizontalAlignment = HorizontalAlignment.Center,
        Margin = new Thickness(0, 28, 0, 0),
        MinWidth = 180,
    };

    private readonly Border _prevZone = new()
    {
        Background = new SolidColorBrush(Colors.Transparent),
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Stretch,
    };

    private readonly Border _nextZone = new()
    {
        Background = new SolidColorBrush(Colors.Transparent),
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Stretch,
    };

    private readonly TsButton _prevButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = PrevGlyph,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(16, 0, 0, 0),
    };

    private readonly TsButton _nextButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = NextGlyph,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(0, 0, 16, 0),
    };

    private readonly TsButton _closeButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = CloseGlyph,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(0, 12, 12, 0),
    };

    private readonly TextBlock _counter = new()
    {
        FontSize = 12,
        Foreground = OnDark(0.6),
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Bottom,
        Margin = new Thickness(0, 0, 0, 12),
    };

    private readonly AIYearReviewNarration _aiNarration;

    private IReadOnlyList<YearReviewVehicleChoice> _vehicleChoices = Array.Empty<YearReviewVehicleChoice>();
    private bool _vehicleOptionsPopulated;
    private bool _suppressVehicleChange;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer (current year).</summary>
    public YearReviewPage()
        : this(EmptyYearReviewPageFeed.Instance, ShellLocalizer.Instance, null)
    {
    }

    /// <summary>Creates the page for an explicit route year (used by the shell deep-link registration).</summary>
    /// <param name="year">The route year (web <c>/year-review/:year</c>).</param>
    public YearReviewPage(int year)
        : this(EmptyYearReviewPageFeed.Instance, ShellLocalizer.Instance, year)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer and year (used by tests / dependency injection).</summary>
    /// <param name="feed">The vehicles + year-review data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="year">The route year; defaults to the current calendar year (web fallback).</param>
    public YearReviewPage(IYearReviewPageFeed feed, ILocalizer localizer, int? year = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new YearReviewPageViewModel(feed, localizer, year);

        var units = ResolveUnits();
        var factory = new YearReviewSlideContentFactory(localizer, units);
        _slideRenderer = new SlideRenderer(localizer, _viewModel.CurrentSlideModel(), factory);
        _aiNarration = new AIYearReviewNarration(
            new NoopNarrationTransport(),
            StaticAiFeatureGate.Off,
            localizer,
            vehicleId: null,
            year: _viewModel.Year);

        IsTabStop = true;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildLoading();
        BuildEmpty();
        BuildError();
        BuildSuccess();

        _root.Children.Add(_loadingHost);
        _root.Children.Add(_emptyHost);
        _root.Children.Add(_errorHost);
        _root.Children.Add(_successHost);
        Content = _root;

        _goBackButton.Click += OnCloseClick;
        _closeButton.Click += OnCloseClick;
        _prevButton.Click += OnPrevClick;
        _nextButton.Click += OnNextClick;
        _errorState.ActionInvoked += OnRetryInvoked;
        _vehicleSelect.SelectionChanged += OnVehicleSelectionChanged;
        _prevZone.PointerPressed += OnPrevZonePressed;
        _nextZone.PointerPressed += OnNextZonePressed;
        KeyDown += OnKeyDown;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the user dismisses the story player (web <c>navigate(-1)</c> — close / Go Back / Esc).</summary>
    public event EventHandler? CloseRequested;

    /// <summary>The diagnostics surface slug (<c>YearReviewPage</c>).</summary>
    public static string Slug => YearReviewPageRegistration.Slug;

    private void BuildLoading()
    {
        _spinner.HorizontalAlignment = HorizontalAlignment.Center;
        _spinner.VerticalAlignment = VerticalAlignment.Center;
        _loadingHost.Children.Add(_spinner);
    }

    private void BuildEmpty()
    {
        var stack = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = StoryMaxContentWidth,
            Padding = new Thickness(32, 0, 32, 0),
        };
        stack.Children.Add(_emptyEmoji);
        stack.Children.Add(_emptyTitle);
        stack.Children.Add(_emptyHint);
        stack.Children.Add(_goBackButton);
        _emptyHost.Children.Add(stack);
    }

    private void BuildError()
    {
        _errorState.VerticalAlignment = VerticalAlignment.Center;
        _errorHost.Children.Add(_errorState);
    }

    private void BuildSuccess()
    {
        // z0 — the deck host (full bleed).
        _successHost.Children.Add(_slideRenderer);

        // z1 — tap-navigation zones (web w-1/3 cursor zones); a transparent third on each edge.
        var tapZones = new Grid();
        tapZones.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        tapZones.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        tapZones.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_prevZone, 0);
        Grid.SetColumn(_nextZone, 2);
        tapZones.Children.Add(_prevZone);
        tapZones.Children.Add(_nextZone);
        _successHost.Children.Add(tapZones);

        // z2 — chrome (progress bar, vehicle selector, prev/next, close, counter, AI narration).
        _successHost.Children.Add(_progressGrid);
        _successHost.Children.Add(_vehicleSelect);
        _successHost.Children.Add(_prevButton);
        _successHost.Children.Add(_nextButton);
        _successHost.Children.Add(_closeButton);

        var bottomStack = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Bottom,
            Spacing = 8,
            MaxWidth = StoryMaxContentWidth,
            Margin = new Thickness(0, 0, 0, 36),
        };
        bottomStack.Children.Add(_aiNarration);
        _successHost.Children.Add(bottomStack);
        _successHost.Children.Add(_counter);
    }

    private void EnsureProgressSegments(int count)
    {
        if (_progressSegments.Count == count)
        {
            return;
        }

        _progressGrid.Children.Clear();
        _progressGrid.ColumnDefinitions.Clear();
        _progressSegments.Clear();

        for (var i = 0; i < count; i++)
        {
            _progressGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var segment = new Border
            {
                CornerRadius = new CornerRadius(2),
                Background = OnDark(0.25),
                Height = 3,
            };
            Grid.SetColumn(segment, i);
            _progressGrid.Children.Add(segment);
            _progressSegments.Add(segment);
        }
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        Focus(FocusState.Programmatic);
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model + child surfaces (CA1001; mirrors the sibling pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _goBackButton.Click -= OnCloseClick;
        _closeButton.Click -= OnCloseClick;
        _prevButton.Click -= OnPrevClick;
        _nextButton.Click -= OnNextClick;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _vehicleSelect.SelectionChanged -= OnVehicleSelectionChanged;
        _prevZone.PointerPressed -= OnPrevZonePressed;
        _nextZone.PointerPressed -= OnNextZonePressed;
        KeyDown -= OnKeyDown;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _aiNarration.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void Render(YearReviewPageDisplay display)
    {
        AutomationProperties.SetName(this, display.AutomationName);

        _loadingHost.Visibility = Show(display.ShowLoading);
        _emptyHost.Visibility = Show(display.ShowEmpty);
        _errorHost.Visibility = Show(display.ShowError);
        _successHost.Visibility = Show(display.ShowSuccess);

        // Loading surface.
        _spinner.Label = display.LoadingText;

        // Empty surface (web 🚗 + noData + noDataHint + Go Back).
        _emptyTitle.Text = display.NoDataText;
        _emptyHint.Text = display.NoDataHintText;
        _goBackButton.Text = display.GoBackText;
        AutomationProperties.SetName(_goBackButton, display.GoBackText);

        // Error surface.
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryText;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        // Story-player chrome.
        AutomationProperties.SetName(_closeButton, display.CloseText);
        ToolTipService.SetToolTip(_closeButton, display.CloseText);
        AutomationProperties.SetName(_prevButton, display.PrevText);
        ToolTipService.SetToolTip(_prevButton, display.PrevText);
        AutomationProperties.SetName(_nextButton, display.NextText);
        ToolTipService.SetToolTip(_nextButton, display.NextText);
        AutomationProperties.SetName(_prevZone, display.PrevText);
        AutomationProperties.SetName(_nextZone, display.NextText);

        _counter.Text = display.SlideCounterText;
        _prevButton.Visibility = Show(display.ShowSuccess && display.ShowPrev);
        _nextButton.Visibility = Show(display.ShowSuccess && display.ShowNext);

        RenderVehicleSelector(display);
        RenderProgress(display);

        if (display.ShowSuccess)
        {
            _slideRenderer.Model = _viewModel.CurrentSlideModel();
            _aiNarration.VehicleId = CurrentVehicleId();
        }
    }

    private void RenderVehicleSelector(YearReviewPageDisplay display)
    {
        _vehicleChoices = display.VehicleChoices;
        _vehicleSelect.Visibility = Show(display.ShowSuccess && display.ShowVehicleSelector);
        AutomationProperties.SetName(_vehicleSelect, display.SelectVehicleText);

        if (!display.ShowVehicleSelector)
        {
            return;
        }

        _suppressVehicleChange = true;
        try
        {
            if (!_vehicleOptionsPopulated)
            {
                var labels = new List<string>(display.VehicleChoices.Count);
                foreach (var choice in display.VehicleChoices)
                {
                    labels.Add(choice.Label);
                }

                _vehicleSelect.ItemsSource = labels;
                _vehicleOptionsPopulated = true;
            }

            int selectedIndex = -1;
            for (var i = 0; i < display.VehicleChoices.Count; i++)
            {
                if (display.VehicleChoices[i].IsSelected)
                {
                    selectedIndex = i;
                    break;
                }
            }

            _vehicleSelect.SelectedIndex = selectedIndex;
        }
        finally
        {
            _suppressVehicleChange = false;
        }
    }

    private void RenderProgress(YearReviewPageDisplay display)
    {
        _progressGrid.Visibility = Show(display.ShowSuccess && display.SlideCount > 0);
        if (!display.ShowSuccess)
        {
            return;
        }

        EnsureProgressSegments(display.SlideCount);
        for (var i = 0; i < _progressSegments.Count; i++)
        {
            _progressSegments[i].Background = OnDark(i <= display.SlideIndex ? 0.95 : 0.25);
        }
    }

    private long? CurrentVehicleId()
    {
        foreach (var choice in _vehicleChoices)
        {
            if (choice.IsSelected)
            {
                return choice.Id;
            }
        }

        return null;
    }

    private void OnVehicleSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressVehicleChange)
        {
            return;
        }

        int index = _vehicleSelect.SelectedIndex;
        if (index < 0 || index >= _vehicleChoices.Count)
        {
            return;
        }

        long vehicleId = _vehicleChoices[index].Id;
        InvokeAsync(() => _viewModel.SelectVehicleAsync(vehicleId));
    }

    private void OnPrevClick(object sender, RoutedEventArgs e) => _viewModel.Prev();

    private void OnNextClick(object sender, RoutedEventArgs e) => _viewModel.Next();

    private void OnPrevZonePressed(object sender, PointerRoutedEventArgs e) => _viewModel.Prev();

    private void OnNextZonePressed(object sender, PointerRoutedEventArgs e) => _viewModel.Next();

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnCloseClick(object sender, RoutedEventArgs e) => CloseRequested?.Invoke(this, EventArgs.Empty);

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case VirtualKey.Left:
                _viewModel.Prev();
                e.Handled = true;
                break;
            case VirtualKey.Right:
            case VirtualKey.Space:
                _viewModel.Next();
                e.Handled = true;
                break;
            case VirtualKey.Escape:
                CloseRequested?.Invoke(this, EventArgs.Empty);
                e.Handled = true;
                break;
        }
    }

    private static UnitPref ResolveUnits()
    {
        try
        {
            return AppSettingsHost.Current.ToUnitPref();
        }
        catch (Exception)
        {
            // Settings host may be unavailable in headless / early-init contexts — default to metric (SI).
            return UnitPref.Metric;
        }
    }

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    // The story player is a full-bleed black overlay (web bg-black), so on-surface text/segments use an explicit
    // white-with-opacity ramp rather than a theme token that would invert to dark-on-dark — the same approach the
    // sibling SlideRenderer documents for its always-dark gradient canvas.
    private static SolidColorBrush OnDark(double opacity) => new(Colors.White) { Opacity = opacity };

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new YearReviewPageAutomationPeer(this);

    private sealed class YearReviewPageAutomationPeer(YearReviewPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }

    /// <summary>
    /// A no-op narration transport — the AI narration card is mounted gated OFF (web off-mode baseline), so its
    /// stream is never opened; this satisfies the surface's non-null transport dependency without any HTTP.
    /// </summary>
    private sealed class NoopNarrationTransport : IAiYearReviewNarrationStreamTransport
    {
        public async IAsyncEnumerable<AiNarrationStreamEvent> StreamAsync(
            AiYearReviewNarrationRequest request,
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await Task.CompletedTask.ConfigureAwait(false);
            yield break;
        }
    }
}
