using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Onboarding;

/// <summary>
/// The native WinUI 3 <c>OnboardingPage</c> — a parity port of the web first-run page
/// <c>web/src/features/onboarding/pages/OnboardingPage.tsx</c> (route <c>/onboarding</c>, nav name <c>Onboarding</c>).
/// It binds to an <see cref="OnboardingPageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the page header (title + subtitle), and the <see cref="TsGlassPanel"/> setup checklist (GlassPanel1) whose
/// body switches between the loading shimmer and the resolved content — the intro header (sparkles chip + title +
/// description), the three-step <c>Stepper</c> (Connect Tesla account → wait for vehicles → wait for telemetry, each
/// with its satisfied / current / pending indicator and the current step's CTA) and the footer (the complete-vs-polling
/// status line, the Check again / Skip / Continue affordances and the help links). The view is a thin renderer: all
/// branch selection, formatting and i18n happen in the view-model's <see cref="OnboardingDisplay"/> projection. State
/// changes are marshalled onto the UI thread; the GlassPanel is always visible so the region never collapses.
/// </summary>
public sealed partial class OnboardingPage : UserControl, IDisposable
{
    private const double IndicatorSize = 36;
    private const double IndicatorColumnWidth = 36;
    private const double ConnectorMinHeight = 28;

    private readonly OnboardingPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly DispatcherQueueTimer _pollTimer;
    private bool _disposed;
    private bool _started;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsGlassPanel _panel = new() { Glow = GlassGlow.None, Padding = new Thickness(24) };
    private readonly StackPanel _loadingSkeleton = new() { Spacing = 16, Padding = new Thickness(8) };
    private readonly StackPanel _content = new() { Spacing = 24, Visibility = Visibility.Collapsed };

    // Intro header (web Sparkles chip + intro.title + intro.desc).
    private readonly PanelTitle _introTitle = new();
    private readonly Text _introDescription = new();

    // Stepper (rebuilt per render from the projected steps).
    private readonly StackPanel _steps = new() { Spacing = 24 };

    // Footer (web bottom row + help paragraph).
    private readonly Text _statusLine = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _checkAgainButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE72C" };
    private readonly TsButton _skipButton = new() { Variant = ButtonVariant.Outline, Size = ControlSize.Small, IconGlyph = "\uEB9D" };
    private readonly TsButton _continueButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small, IconGlyph = "\uE72A" };
    private readonly ContentControl _footerHelpHost = new();

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public OnboardingPage()
        : this(EmptyOnboardingStatusFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The onboarding-status data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public OnboardingPage(IOnboardingStatusFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new OnboardingPageViewModel(feed, localizer);

        _pollTimer = _dispatcher.CreateTimer();
        _pollTimer.Interval = TimeSpan.FromSeconds(OnboardingRegistration.PollIntervalSeconds);
        _pollTimer.IsRepeating = true;
        _pollTimer.Tick += OnPollTick;

        BuildLoadingSkeleton();
        BuildContent();

        Content = BuildLayout();

        _checkAgainButton.Click += (_, _) => InvokeAsync(() => _viewModel.RefreshAsync());
        _skipButton.Click += (_, _) => RaiseNavigation(OnboardingRegistration.DashboardRoute);
        _continueButton.Click += (_, _) => RaiseNavigation(OnboardingRegistration.DashboardRoute);
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when an internal app route should be navigated to (web <c>navigate</c> / <c>Link to</c>).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>Raised when an external documentation link should be opened (web <c>a href target="_blank"</c>).</summary>
    public event EventHandler<string>? DocumentationRequested;

    /// <summary>The diagnostics surface slug (<c>OnboardingPage</c>).</summary>
    public static string Slug => OnboardingRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_panel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private StackPanel BuildHeader()
    {
        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        return header;
    }

    private void BuildLoadingSkeleton()
    {
        // web: the PageContainer loading spinner over the checklist. Native: a shimmer mirroring the intro + steps.
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 44, BlockWidth = 320, Radius = 10 });
        for (var i = 0; i < 3; i++)
        {
            _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 56, Radius = 10 });
        }
    }

    private void BuildContent()
    {
        _content.Children.Add(BuildIntroHeader());
        _content.Children.Add(_steps);
        _content.Children.Add(BuildFooter());

        var host = new Grid();
        host.Children.Add(_loadingSkeleton);
        host.Children.Add(_content);
        _panel.Content = host;
        AutomationProperties.SetName(_panel, Slug);
    }

    private Grid BuildIntroHeader()
    {
        var chip = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(12),
            VerticalAlignment = VerticalAlignment.Top,
            Background = TokenBrush("TsColorSurfaceGlassBrush"),
            BorderBrush = TokenBrush("TsColorBorderBrush"),
            BorderThickness = new Thickness(1),
            Child = new FontIcon { Glyph = OnboardingRegistration.IntroGlyph, FontSize = 18, Foreground = AccentBrush() },
        };
        AutomationProperties.SetAccessibilityView(chip, AccessibilityView.Raw);

        var copy = new StackPanel { Spacing = 4 };
        copy.Children.Add(_introTitle);
        copy.Children.Add(_introDescription);

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(chip, 0);
        Grid.SetColumn(copy, 1);
        grid.Children.Add(chip);
        grid.Children.Add(copy);
        return grid;
    }

    private Border BuildFooter()
    {
        var statusRow = new Grid { ColumnSpacing = 12 };
        statusRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        statusRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_checkAgainButton);
        actions.Children.Add(_skipButton);
        actions.Children.Add(_continueButton);

        Grid.SetColumn(_statusLine, 0);
        Grid.SetColumn(actions, 1);
        statusRow.Children.Add(_statusLine);
        statusRow.Children.Add(actions);

        var footer = new StackPanel { Spacing = 16 };
        footer.Children.Add(statusRow);
        footer.Children.Add(_footerHelpHost);

        return new Border
        {
            Padding = new Thickness(0, 20, 0, 0),
            BorderThickness = new Thickness(0, 1, 0, 0),
            BorderBrush = TokenBrush("TsColorBorderBrush"),
            Child = footer,
        };
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
        StartOrStopPolling();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _pollTimer.Stop();
        _pollTimer.Tick -= OnPollTick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private async void OnPollTick(DispatcherQueueTimer sender, object args)
    {
        // web refetchInterval: keep re-reading every 30s while setup is incomplete, then stop.
        if (!_viewModel.ShouldPoll)
        {
            _pollTimer.Stop();
            return;
        }

        await _viewModel.RefreshAsync().ConfigureAwait(true);
        StartOrStopPolling();
    }

    private void StartOrStopPolling()
    {
        if (_disposed)
        {
            return;
        }

        if (_viewModel.ShouldPoll)
        {
            _pollTimer.Start();
        }
        else
        {
            _pollTimer.Stop();
        }
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

    private void Render(OnboardingDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.DocumentTitle);

        _introTitle.Value = display.IntroTitle;
        _introDescription.Value = display.IntroDescription;

        // GlassPanel1 is always visible; its body switches between the loading shimmer and the resolved checklist.
        var loading = display.State == OnboardingState.Loading;
        _loadingSkeleton.Visibility = loading ? Visibility.Visible : Visibility.Collapsed;
        _content.Visibility = loading ? Visibility.Collapsed : Visibility.Visible;

        RenderSteps(display.Steps);

        _statusLine.Value = display.StatusLine;
        _checkAgainButton.Text = display.CheckAgainLabel;
        _checkAgainButton.IsEnabled = display.CheckAgainEnabled;

        _skipButton.Text = display.SkipLabel;
        _skipButton.Visibility = display.ShowSkip ? Visibility.Visible : Visibility.Collapsed;
        ToolTipService.SetToolTip(_skipButton, display.SkipHint);
        AutomationProperties.SetHelpText(_skipButton, display.SkipHint);

        _continueButton.Text = display.ContinueLabel;
        _continueButton.Visibility = display.ShowContinue ? Visibility.Visible : Visibility.Collapsed;

        RenderFooterHelp(display);
    }

    private void RenderSteps(IReadOnlyList<OnboardingStepDisplay> steps)
    {
        _steps.Children.Clear();
        for (var i = 0; i < steps.Count; i++)
        {
            _steps.Children.Add(BuildStepRow(steps[i], isLast: i == steps.Count - 1));
        }
    }

    private Grid BuildStepRow(OnboardingStepDisplay step, bool isLast)
    {
        var indicatorColumn = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
        indicatorColumn.Children.Add(BuildIndicator(step));
        if (!isLast)
        {
            indicatorColumn.Children.Add(new Border
            {
                Width = 1,
                MinHeight = ConnectorMinHeight,
                Margin = new Thickness(0, 4, 0, 0),
                HorizontalAlignment = HorizontalAlignment.Center,
                Background = step.Done ? AccentBrush(GlassGlow.Green) : TokenBrush("TsColorBorderBrush"),
            });
        }

        var copy = new StackPanel { Spacing = 4 };
        var title = new PanelTitle { Value = step.Title };
        copy.Children.Add(title);
        copy.Children.Add(new Text { Value = step.Description });

        if (step.IsCurrent)
        {
            copy.Children.Add(BuildStepCta(step));
        }

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(IndicatorColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(indicatorColumn, 0);
        Grid.SetColumn(copy, 1);
        grid.Children.Add(indicatorColumn);
        grid.Children.Add(copy);

        AutomationProperties.SetName(grid, step.Title);
        return grid;
    }

    private static Border BuildIndicator(OnboardingStepDisplay step)
    {
        var circle = new Border
        {
            Width = IndicatorSize,
            Height = IndicatorSize,
            CornerRadius = new CornerRadius(IndicatorSize / 2),
            Background = TokenBrush("TsColorSurfaceGlassBrush"),
            BorderBrush = step.Done ? AccentBrush(GlassGlow.Green) : step.IsCurrent ? AccentBrush(GlassGlow.Cyan) : TokenBrush("TsColorBorderBrush"),
            BorderThickness = new Thickness(1),
        };
        AutomationProperties.SetAccessibilityView(circle, AccessibilityView.Raw);

        if (step.Done)
        {
            circle.Child = new FontIcon { Glyph = "\uE73E", FontSize = 16, Foreground = AccentBrush(GlassGlow.Green) };
        }
        else if (step.IsCurrent)
        {
            circle.Child = new ProgressRing { IsActive = true, Width = 18, Height = 18 };
        }
        else
        {
            circle.Child = new Caption
            {
                Value = step.StepNumber.ToString(System.Globalization.CultureInfo.InvariantCulture),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        return circle;
    }

    private TsButton BuildStepCta(OnboardingStepDisplay step)
    {
        var variant = step.CtaAction == OnboardingStepAction.Navigate ? ButtonVariant.Primary : ButtonVariant.Outline;
        var glyph = step.CtaAction switch
        {
            OnboardingStepAction.Navigate => "\uE72A",
            OnboardingStepAction.Refresh => "\uE72C",
            _ => "\uE8A7",
        };

        var button = new TsButton
        {
            Variant = variant,
            Size = ControlSize.Small,
            Text = step.CtaLabel,
            IconGlyph = glyph,
            IsEnabled = step.CtaEnabled,
            Margin = new Thickness(0, 4, 0, 0),
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        var action = step.CtaAction;
        var target = step.CtaTarget;
        button.Click += (_, _) =>
        {
            switch (action)
            {
                case OnboardingStepAction.Navigate:
                    RaiseNavigation(target);
                    break;
                case OnboardingStepAction.Refresh:
                    InvokeAsync(() => _viewModel.RefreshAsync());
                    break;
                default:
                    RaiseDocumentation(target);
                    break;
            }
        };

        return button;
    }

    private void RenderFooterHelp(OnboardingDisplay display)
    {
        var paragraph = new Paragraph();
        paragraph.Inlines.Add(new Run { Text = display.FooterHelp + " " });
        paragraph.Inlines.Add(BuildHelpLink(display.FooterAccountLabel, OnboardingStepAction.Navigate, OnboardingRegistration.TeslaAccountRoute));
        paragraph.Inlines.Add(new Run { Text = display.FooterOr });
        paragraph.Inlines.Add(BuildHelpLink(display.FooterDocsLabel, OnboardingStepAction.DocumentationLink, OnboardingRegistration.DocsRootPath));
        paragraph.Inlines.Add(new Run { Text = "." });

        var block = new RichTextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 12, Foreground = TokenBrush("TsColorTextMutedBrush") };
        block.Blocks.Add(paragraph);
        _footerHelpHost.Content = block;
    }

    private Hyperlink BuildHelpLink(string label, OnboardingStepAction action, string target)
    {
        var link = new Hyperlink { UnderlineStyle = UnderlineStyle.None };
        link.Inlines.Add(new Run { Text = label });
        link.Click += (_, _) =>
        {
            if (action == OnboardingStepAction.Navigate)
            {
                RaiseNavigation(target);
            }
            else
            {
                RaiseDocumentation(target);
            }
        };
        return link;
    }

    private void RaiseNavigation(string route) => NavigationRequested?.Invoke(this, route);

    private void RaiseDocumentation(string relativePath) => DocumentationRequested?.Invoke(this, relativePath);

    private static Brush? TokenBrush(string resourceKey) =>
        Application.Current.Resources.TryGetValue(resourceKey, out var value) && value is Brush brush ? brush : null;

    private static Brush? AccentBrush(GlassGlow glow = GlassGlow.Cyan)
    {
        var key = glow switch
        {
            GlassGlow.Green => "TsChartBatteryBrush",
            GlassGlow.Purple => "TsChartPowerBrush",
            _ => "TsChartSpeedBrush",
        };
        return TokenBrush(key);
    }

    private static async void InvokeAsync(Func<Task> action) =>
        await action().ConfigureAwait(true);

    protected override AutomationPeer OnCreateAutomationPeer() => new OnboardingPageAutomationPeer(this);

    private sealed class OnboardingPageAutomationPeer(OnboardingPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
