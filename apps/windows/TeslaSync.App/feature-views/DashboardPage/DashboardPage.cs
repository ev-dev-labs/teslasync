using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>The cross-cutting chrome commands the dashboard toolbar raises for the host (widget / layout / kiosk /
/// print subsystems — each a separate parity unit). The page owns edit-mode, refresh, sync and navigation itself.</summary>
public enum DashboardCommandKind
{
    /// <summary>Undo the last layout edit (web Undo).</summary>
    Undo,

    /// <summary>Redo the last undone layout edit (web Redo).</summary>
    Redo,

    /// <summary>Open the widget picker (web Add Widget).</summary>
    AddWidget,

    /// <summary>Auto-arrange the widget grid (web Auto Arrange).</summary>
    AutoArrange,

    /// <summary>Open the template gallery (web Templates).</summary>
    Templates,

    /// <summary>Create a blank dashboard (web New Dashboard).</summary>
    NewDashboard,

    /// <summary>Reset the layout to the shipped default (web Reset, after confirmation).</summary>
    Reset,

    /// <summary>Enter kiosk mode (web Kiosk).</summary>
    Kiosk,

    /// <summary>Print a snapshot of the dashboard (web Print snapshot).</summary>
    PrintSnapshot,
}

/// <summary>
/// The native WinUI 3 <c>DashboardPage</c> — a parity port of the web page
/// <c>web/src/features/dashboard/pages/DashboardPage.tsx</c> (route <c>/</c>, nav name <c>Dashboard</c>). It binds
/// to a <see cref="DashboardPageViewModel"/> and renders every web region the manifest enumerates with Fluent
/// components and design tokens: the page header (title + subtitle + freshness chip); the customize / normal toolbar
/// (undo, redo, add widget, auto-arrange, templates, reset, done — and kiosk, customize, print snapshot); the
/// theme first-run prompt, the customize hint, the failure banner (web <c>anyError</c>) and the
/// account-not-connected warning; the edit-mode hint; the reset-confirmation and new-dashboard surfaces; and the
/// body's three-state switch (loading skeleton / retry surface / the welcome-or-sync onboarding hero, whose footer
/// is the four feature cards). The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="DashboardDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class DashboardPage : UserControl, IDisposable
{
    private readonly DashboardPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    // Normal-mode toolbar (web !editMode branch).
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE72C" };
    private readonly TsButton _kioskButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE7F4" };
    private readonly TsButton _customizeButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE713" };
    private readonly TsButton _printButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE749" };
    private readonly StackPanel _normalActions;

    // Edit-mode toolbar (web editMode branch).
    private readonly TsButton _undoButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE7A7" };
    private readonly TsButton _redoButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE7A6" };
    private readonly TsButton _addWidgetButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE710" };
    private readonly TsButton _autoArrangeButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE80A" };
    private readonly TsButton _templatesButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE8A9" };
    private readonly TsButton _resetButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE894" };
    private readonly TsButton _doneButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small, IconGlyph = "\uE73E" };
    private readonly StackPanel _editActions;

    // Conditional banners (web ThemeFirstRunBanner / customize hint / anyError / auth warning).
    private readonly TsAlertBanner _themeBanner = new() { Variant = CalloutVariant.Info, Dismissible = true, IsOpen = true };
    private readonly TsAlertBanner _customizeHintBanner = new() { Variant = CalloutVariant.Info, Dismissible = true, IsOpen = false };
    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, Dismissible = false, IsOpen = false };
    private readonly TsAlertBanner _authBanner = new() { Variant = CalloutVariant.Warning, Dismissible = false, IsOpen = false };
    private bool _themeDismissed;
    private bool _customizeHintDismissed;

    // Edit-mode hint + reset confirmation + new-dashboard surface.
    private readonly TsGlassPanel _editHintPanel = new() { Padding = new Thickness(16) };
    private readonly Text _editHint = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsAlertBanner _resetConfirmBanner = new() { Variant = CalloutVariant.Warning, Dismissible = true, IsOpen = false };
    private readonly TsGlassPanel _templatesPanel = new() { Padding = new Thickness(16), Visibility = Visibility.Collapsed };
    private readonly TsButton _newDashboardButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = "\uE710" };

    // Body — three data states (web vehiclesLoading / anyError / onboarding).
    private readonly StackPanel _loadingPanel;
    private readonly TsQueryError _errorState = new();
    private readonly StackPanel _successPanel = new() { Spacing = 16 };

    // GlassPanel1 — the welcome / sync onboarding hero (web EmptyOnboarding).
    private readonly TsGlassPanel _onboardingPanel = new() { Padding = new Thickness(32) };
    private readonly Heading _onboardingHeading = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Text _onboardingDescription = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsButton _onboardingAction = new() { Variant = ButtonVariant.Primary };

    // GlassPanel2 — the four feature-highlight cards (web onboarding footer grid).
    private readonly TsGlassPanel[] _featureCards = [new(), new(), new(), new()];
    private readonly FontIcon[] _featureIcons = [new(), new(), new(), new()];
    private readonly Caption[] _featureLabels = [new(), new(), new(), new()];
    private readonly Grid _featureGrid;

    private bool _suppressEvents;

    /// <summary>Creates the page over the default local-state sources and the shell resource localizer.</summary>
    public DashboardPage()
        : this(EmptyAuthStatusSource.Instance, NoopVehicleSyncGateway.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit data ports and a localizer (used by tests / DI hosts).</summary>
    /// <param name="authSource">The cache-then-network connected-account port (native <c>useAuthStatus</c>).</param>
    /// <param name="syncGateway">The one-shot vehicle-sync command port (native <c>useSyncVehicles</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DashboardPage(IAuthStatusSource authSource, IVehicleSyncGateway syncGateway, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(authSource);
        ArgumentNullException.ThrowIfNull(syncGateway);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new DashboardPageViewModel(authSource, syncGateway, localizer);
        _localizer = localizer;

        _normalActions = BuildNormalActions();
        _editActions = BuildEditActions();
        _loadingPanel = BuildLoadingPanel();
        _featureGrid = BuildFeatureGrid();

        Content = BuildLayout();

        _refreshButton.Click += OnRefreshClick;
        _customizeButton.Click += OnCustomizeClick;
        _doneButton.Click += OnDoneClick;
        _resetButton.Click += OnResetClick;
        _templatesButton.Click += OnTemplatesClick;
        _newDashboardButton.Click += (_, _) => RaiseCommand(DashboardCommandKind.NewDashboard);
        _undoButton.Click += (_, _) => RaiseCommand(DashboardCommandKind.Undo);
        _redoButton.Click += (_, _) => RaiseCommand(DashboardCommandKind.Redo);
        _addWidgetButton.Click += (_, _) => RaiseCommand(DashboardCommandKind.AddWidget);
        _autoArrangeButton.Click += (_, _) => RaiseCommand(DashboardCommandKind.AutoArrange);
        _kioskButton.Click += (_, _) => RaiseCommand(DashboardCommandKind.Kiosk);
        _printButton.Click += (_, _) => RaiseCommand(DashboardCommandKind.PrintSnapshot);
        _onboardingAction.Click += OnOnboardingActionClick;

        _authBanner.ActionInvoked += (_, _) => RaiseNavigation("settings");
        _resetConfirmBanner.ActionInvoked += OnResetConfirmed;
        _customizeHintBanner.ActionInvoked += OnCustomizeClick;
        _themeBanner.Dismissed += (_, _) => _themeDismissed = true;
        _customizeHintBanner.Dismissed += (_, _) => _customizeHintDismissed = true;
        _errorState.ActionInvoked += OnRetryInvoked;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        AutomationProperties.SetName(_refreshButton, _localizer.GetString("dashboard.refresh", "Refresh"));
        _errorState.IconGlyph = "\uE783";
        _errorState.ActionText = _localizer.GetString("error.retry", "Retry");

        Render();
    }

    /// <summary>Raised when a toolbar chrome command (widget / layout / kiosk / print) is invoked.</summary>
    public event EventHandler<DashboardCommandKind>? CommandRequested;

    /// <summary>Raised when the page requests navigation to another route (web Settings link / Connect action).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The diagnostics surface slug (<c>DashboardPage</c>).</summary>
    public static string Slug => DashboardRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var header = BuildHeader();

        _editHintPanel.Content = _editHint;
        _editHintPanel.Visibility = Visibility.Collapsed;

        _resetConfirmBanner.IsOpen = false;

        _templatesPanel.Content = BuildTemplatesContent();

        BuildOnboarding();

        _errorState.IconGlyph = "\uE783";
        _errorState.Visibility = Visibility.Collapsed;
        _loadingPanel.Visibility = Visibility.Collapsed;

        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(_loadingPanel);
        body.Children.Add(_errorState);
        body.Children.Add(_successPanel);

        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(header);
        stack.Children.Add(_themeBanner);
        stack.Children.Add(_customizeHintBanner);
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_authBanner);
        stack.Children.Add(_editHintPanel);
        stack.Children.Add(_resetConfirmBanner);
        stack.Children.Add(_templatesPanel);
        stack.Children.Add(body);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var heading = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_freshness);
        actions.Children.Add(_editActions);
        actions.Children.Add(_normalActions);

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(heading, 0);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(heading);
        grid.Children.Add(actions);
        return grid;
    }

    private StackPanel BuildNormalActions()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(_refreshButton);
        row.Children.Add(_kioskButton);
        row.Children.Add(_customizeButton);
        row.Children.Add(_printButton);
        return row;
    }

    private StackPanel BuildEditActions()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center, Visibility = Visibility.Collapsed };
        row.Children.Add(_undoButton);
        row.Children.Add(_redoButton);
        row.Children.Add(_addWidgetButton);
        row.Children.Add(_autoArrangeButton);
        row.Children.Add(_templatesButton);
        row.Children.Add(_resetButton);
        row.Children.Add(_doneButton);
        return row;
    }

    private static StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel { Spacing = 16, Visibility = Visibility.Collapsed };
        panel.Children.Add(new TsStatGridSkeleton(4));
        panel.Children.Add(new TsTableSkeleton());
        return panel;
    }

    private StackPanel BuildTemplatesContent()
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(_newDashboardButton);
        return column;
    }

    private void BuildOnboarding()
    {
        var actionRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        actionRow.Children.Add(_onboardingAction);

        var column = new StackPanel { Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(_onboardingHeading);
        _onboardingDescription.MaxWidth = 520;
        column.Children.Add(_onboardingDescription);
        column.Children.Add(actionRow);
        column.Children.Add(_featureGrid);

        _onboardingPanel.Content = column;
        _successPanel.Children.Add(_onboardingPanel);
    }

    private Grid BuildFeatureGrid()
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16, Margin = new Thickness(0, 16, 0, 0) };
        for (var i = 0; i < 4; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            _featureIcons[i].FontSize = 24;
            _featureIcons[i].HorizontalAlignment = HorizontalAlignment.Center;
            _featureLabels[i].HorizontalAlignment = HorizontalAlignment.Center;

            var cardColumn = new StackPanel { Spacing = 8, Padding = new Thickness(12), HorizontalAlignment = HorizontalAlignment.Center };
            cardColumn.Children.Add(_featureIcons[i]);
            cardColumn.Children.Add(_featureLabels[i]);

            _featureCards[i].Content = cardColumn;
            Grid.SetColumn(_featureCards[i], i);
            grid.Children.Add(_featureCards[i]);
        }

        return grid;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRefreshClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnCustomizeClick(object? sender, object e) => _viewModel.SetEditMode(true);

    private void OnDoneClick(object sender, RoutedEventArgs e) => _viewModel.SetEditMode(false);

    private void OnResetClick(object sender, RoutedEventArgs e) => _resetConfirmBanner.IsOpen = true;

    private void OnResetConfirmed(object? sender, EventArgs e)
    {
        _resetConfirmBanner.IsOpen = false;
        RaiseCommand(DashboardCommandKind.Reset);
    }

    private void OnTemplatesClick(object sender, RoutedEventArgs e)
    {
        _templatesPanel.Visibility = _templatesPanel.Visibility == Visibility.Visible
            ? Visibility.Collapsed
            : Visibility.Visible;
        RaiseCommand(DashboardCommandKind.Templates);
    }

    private void OnOnboardingActionClick(object sender, RoutedEventArgs e)
    {
        if (_viewModel.Display.Authenticated)
        {
            InvokeAsync(() => _viewModel.SyncAsync());
        }
        else
        {
            RaiseNavigation("settings");
        }
    }

    private void RaiseCommand(DashboardCommandKind kind)
    {
        if (_suppressEvents)
        {
            return;
        }

        CommandRequested?.Invoke(this, kind);
    }

    private void RaiseNavigation(string route) => NavigationRequested?.Invoke(this, route);

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            Render();
        }
        else
        {
            _dispatcher.TryEnqueue(Render);
        }
    }

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        _suppressEvents = true;

        var d = _viewModel.Display;

        _title.Value = d.Title;
        _subtitle.Value = d.Subtitle;
        AutomationProperties.SetName(this, d.DocumentTitle);

        RenderToolbar(d);
        RenderBanners(d);
        RenderEditSurfaces(d);
        RenderOnboarding(d);
        RenderBody(d);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _suppressEvents = false;
    }

    private void RenderToolbar(DashboardDisplay d)
    {
        _undoButton.Text = d.UndoLabel;
        _redoButton.Text = d.RedoLabel;
        _addWidgetButton.Text = d.AddWidgetLabel;
        _autoArrangeButton.Text = d.AutoArrangeLabel;
        _templatesButton.Text = d.TemplatesLabel;
        _resetButton.Text = d.ResetLabel;
        _doneButton.Text = d.DoneLabel;
        _kioskButton.Text = d.KioskLabel;
        _customizeButton.Text = d.CustomizeLabel;
        _printButton.Text = d.PrintSnapshotLabel;

        _editActions.Visibility = d.EditMode ? Visibility.Visible : Visibility.Collapsed;
        _normalActions.Visibility = d.EditMode ? Visibility.Collapsed : Visibility.Visible;
    }

    private void RenderBanners(DashboardDisplay d)
    {
        _themeBanner.Title = d.ThemeFirstRunTitle;
        _themeBanner.Message = d.ThemeFirstRunBody;
        _themeBanner.ActionText = d.ThemeFirstRunOpen;
        _themeBanner.SecondaryActionText = d.ThemeFirstRunLater;
        _themeBanner.IsOpen = !_themeDismissed;

        _customizeHintBanner.Message = d.CustomizeHint;
        _customizeHintBanner.ActionText = d.CustomizeHintCta;
        _customizeHintBanner.IsOpen = !d.EditMode && !_customizeHintDismissed;

        _errorBanner.Message = d.ErrorText;
        _errorBanner.IsOpen = d.HasError;

        _authBanner.Title = d.AuthNotConnected;
        _authBanner.Message = $"{d.AuthConnectPrompt} {d.AuthSettings} {d.AuthToStart}";
        _authBanner.ActionText = d.AuthSettings;
        _authBanner.IsOpen = d.ShowAuthWarning;
    }

    private void RenderEditSurfaces(DashboardDisplay d)
    {
        _editHint.Value = d.EditHint;
        _editHintPanel.Visibility = d.EditMode ? Visibility.Visible : Visibility.Collapsed;

        _resetConfirmBanner.Title = d.ResetLabel;
        _resetConfirmBanner.Message = d.ResetMessage;
        _resetConfirmBanner.ActionText = d.ResetLabel;
        if (!d.EditMode)
        {
            _resetConfirmBanner.IsOpen = false;
            _templatesPanel.Visibility = Visibility.Collapsed;
        }

        _newDashboardButton.Text = d.NewDashboardLabel;
    }

    private void RenderOnboarding(DashboardDisplay d)
    {
        _onboardingHeading.Value = d.OnboardingHeading;
        _onboardingDescription.Value = d.OnboardingDescription;
        _onboardingAction.Text = d.OnboardingActionLabel;
        _onboardingAction.IconGlyph = d.Authenticated ? "\uE72C" : "\uE8A7";
        AutomationProperties.SetName(_onboardingPanel, d.OnboardingHeading);

        var cards = d.FeatureCards;
        for (var i = 0; i < _featureCards.Length && i < cards.Count; i++)
        {
            _featureIcons[i].Glyph = cards[i].Glyph;
            _featureLabels[i].Value = cards[i].Label;
            _featureCards[i].Glow = MapAccent(cards[i].Accent);
            AutomationProperties.SetName(_featureCards[i], cards[i].Label);
        }
    }

    private static GlassGlow MapAccent(DashboardCardAccent accent) => accent switch
    {
        DashboardCardAccent.Cyan => GlassGlow.Cyan,
        DashboardCardAccent.Green => GlassGlow.Green,
        DashboardCardAccent.Purple => GlassGlow.Purple,
        _ => GlassGlow.None,
    };

    private void RenderBody(DashboardDisplay d)
    {
        _loadingPanel.Visibility = d.State == DashboardState.Loading ? Visibility.Visible : Visibility.Collapsed;

        _errorState.Title = d.ErrorText;
        _errorState.Visibility = d.State == DashboardState.Error ? Visibility.Visible : Visibility.Collapsed;

        _successPanel.Visibility = d.State == DashboardState.Success ? Visibility.Visible : Visibility.Collapsed;
    }

    private void InvokeAsync(Func<Task> action)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            _ = action();
        }
        else
        {
            _dispatcher.TryEnqueue(() => _ = action());
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
    }
}
