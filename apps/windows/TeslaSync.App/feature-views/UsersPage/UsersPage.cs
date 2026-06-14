using System;
using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 admin <c>UsersPage</c> — a parity port of the web "Subjects" page
/// web/src/features/admin/pages/UsersPage.tsx (the impersonation target picker; web route is unrouted). The web page
/// wraps a single <c>GlassPanel</c> in a <c>PageContainer</c> carrying the title + subtitle; the panel body switches
/// between the open-mode notice (web <c>open</c>), the loading spinner (web <c>candidates.isLoading</c>), the failure
/// surface (web <c>ErrorDisplay</c> + retry), the empty surface (web <c>EmptyState</c>) and the subjects list, each row
/// pairing the opaque subject identifier with a <see cref="UserImpersonateButton"/> (web
/// <c>&lt;UserImpersonateButton subject disabled={active} /&gt;</c>). This view reproduces the whole tree natively: it
/// mounts the shared <see cref="PageContainer"/> whose page content is a Fluent <see cref="TsGlassPanel"/> (GlassPanel1)
/// whose body is the five-branch state host. The view is a thin renderer: all branch selection, formatting and i18n
/// happen in the view-model's <see cref="UsersDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class UsersPage : UserControl, IDisposable
{
    private const double SubjectColumnWidth = 1.0;

    private readonly UsersPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly Func<string, bool, UserImpersonateButton> _impersonateFactory;
    private readonly PageContainer _container;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly TsGlassPanel _panel = new() { Glow = GlassGlow.None };
    private readonly Grid _stateHost = new();

    private readonly StackPanel _loadingHost = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 16,
        Padding = new Thickness(24),
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly Spinner _spinner = new();
    private readonly Text _loadingText = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _openModeHost = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 12,
        Padding = new Thickness(24),
        Visibility = Visibility.Collapsed,
    };

    private readonly FontIcon _openModeIcon = new()
    {
        Glyph = UsersPageRegistration.WarningGlyph,
        FontSize = 20,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly HelperText _openModeText = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly TsErrorDisplay _errorState = new() { Visibility = Visibility.Collapsed };

    private readonly TsEmptyState _emptyState = new()
    {
        IconGlyph = UsersPageRegistration.SubjectsGlyph,
        Visibility = Visibility.Collapsed,
    };

    private readonly StackPanel _listRoot = new() { Visibility = Visibility.Collapsed };

    /// <summary>Creates the page over the default no-backend subjects feed and the shell resource localizer.</summary>
    public UsersPage()
        : this(EmptyImpersonationSubjectsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer and (optional) per-row impersonate-button factory.</summary>
    /// <param name="feed">The status + candidates data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="impersonateFactory">
    /// Builds the per-row impersonate affordance for a subject (with its disabled flag). When null, a
    /// <see cref="UserImpersonateButton"/> over the inert local-state source is used — the default empty feed yields no
    /// rows, so this is never invoked in the no-backend default.
    /// </param>
    public UsersPage(
        IImpersonationSubjectsFeed feed,
        ILocalizer localizer,
        Func<string, bool, UserImpersonateButton>? impersonateFactory = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _impersonateFactory = impersonateFactory ?? DefaultImpersonateFactory;
        _viewModel = new UsersPageViewModel(feed, localizer);

        BuildLoading();
        BuildOpenMode();
        BuildPanel();

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            PageContent = _panel,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);
        Content = _container;

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell page factory registers this surface under (<c>Users</c>).</summary>
    public static string RouteName => UsersPageRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>UsersPage</c>).</summary>
    public static string Slug => UsersPageRegistration.Slug;

    /// <summary>
    /// Convenience factory that wires the generated-client-backed feed and the repository-backed per-row impersonate
    /// button from the shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static UsersPage Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(localizer);

        var feed = new ImpersonationSubjectsClientFeed(api);

        UserImpersonateButton Factory(string subject, bool disabled)
        {
            var button = UserImpersonateButton.Create(api, engine, options, localizer);
            button.Subject = subject;
            button.Disabled = disabled;
            return button;
        }

        return new UsersPage(feed, localizer, Factory);
    }

    private UserImpersonateButton DefaultImpersonateFactory(string subject, bool disabled) =>
        new UserImpersonateButton(InertImpersonationSource.Instance, _localizer)
        {
            Subject = subject,
            Disabled = disabled,
        };

    private void BuildLoading()
    {
        _loadingHost.Children.Add(_spinner);
        _loadingHost.Children.Add(_loadingText);
    }

    private void BuildOpenMode()
    {
        _openModeIcon.Foreground = TokenBrush("TsColorWarningBrush");
        _openModeHost.Children.Add(_openModeIcon);
        _openModeHost.Children.Add(_openModeText);
    }

    private void BuildPanel()
    {
        _stateHost.Children.Add(_loadingHost);
        _stateHost.Children.Add(_openModeHost);
        _stateHost.Children.Add(_errorState);
        _stateHost.Children.Add(_emptyState);
        _stateHost.Children.Add(_listRoot);

        _panel.Content = _stateHost;
        AutomationProperties.SetName(_panel, Slug);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e)
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

    private void Render(UsersDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // The GlassPanel is always visible; its body switches between the five web render branches.
        _loadingHost.Visibility = Show(display.ShowLoading);
        _openModeHost.Visibility = Show(display.ShowOpenMode);
        _errorState.Visibility = Show(display.ShowError);
        _emptyState.Visibility = Show(display.ShowEmpty);
        _listRoot.Visibility = Show(display.ShowList);

        _loadingText.Value = display.LoadingText;

        _openModeText.Value = display.OpenModeText;
        AutomationProperties.SetName(_openModeHost, display.OpenModeText);

        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        RenderRows(display);
    }

    private void RenderRows(UsersDisplay display)
    {
        _listRoot.Children.Clear();
        foreach (var row in display.Rows)
        {
            _listRoot.Children.Add(BuildRow(row));
        }
    }

    private Border BuildRow(UsersSubjectRowDisplay row)
    {
        var grid = new Grid { Padding = new Thickness(16, 12, 16, 12), ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SubjectColumnWidth, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var subject = new Code
        {
            Value = row.Subject,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        Grid.SetColumn(subject, 0);

        var action = _impersonateFactory(row.Subject, row.ImpersonateDisabled);
        action.HorizontalAlignment = HorizontalAlignment.Right;
        action.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(action, 1);

        grid.Children.Add(subject);
        grid.Children.Add(action);

        var border = new Border
        {
            Child = grid,
            BorderThickness = new Thickness(0, 0, 0, 1),
            BorderBrush = TokenBrush("TsColorBorderBrush"),
        };
        return border;
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    /// <summary>Unsubscribe from and dispose the view-model and hosted surfaces (idempotent; CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    private static Brush? TokenBrush(string resourceKey) =>
        Application.Current.Resources.TryGetValue(resourceKey, out var value) && value is Brush brush ? brush : null;

    private static async void InvokeAsync(Func<System.Threading.Tasks.Task> action) =>
        await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new UsersPageAutomationPeer(this);

    private sealed class UsersPageAutomationPeer(UsersPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
