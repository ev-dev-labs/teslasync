using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>TeslaAccountPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/TeslaAccountPage.tsx</c> (route <c>/tesla-account</c>, nav name
/// <c>TeslaAccount</c>). The web page renders a <see cref="PageContainer"/> header (web <c>teslaAccount.title</c>
/// / <c>teslaAccount.subtitle</c>) with its <c>loading</c> / <c>error</c> states around a sync bar (the relative
/// "Last synced" / "Never synced" caption + the "Refresh from Tesla" action, web <c>useRefreshTeslaProfile</c>)
/// and a profile <see cref="TsGlassPanel"/> that shows the avatar + Name / Email / Fetched At details when a
/// profile is known (web <c>profile</c>) and the friendly empty surface otherwise (web <c>teslaAccount.noProfile</c>).
/// This port reproduces that shell over the native shared surfaces: all four web data states (loading / empty /
/// error / success) flow from the <see cref="TeslaAccountPageViewModel"/> bound to the generated C# client; the
/// view is a thin renderer that performs no HTTP. Every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class TeslaAccountPage : UserControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";   // Segoe Fluent — Refresh (web RefreshCw icon)
    private const string UserGlyph = "\uE77B";       // Segoe Fluent — Contact (web User icon, empty surface)
    private const string ImageOffGlyph = "\uE91B";   // Segoe Fluent — Photo (web ImageOff fallback, no avatar)
    private const string SuccessGlyph = "\uE73E";    // Segoe Fluent — CheckMark (refresh success notice)
    private const string ErrorGlyph = "\uEA39";      // Segoe Fluent — ErrorBadge (refresh failure notice)

    private const double ContentPadding = 24;        // outer page padding
    private const double PanelPadding = 24;          // web p-6
    private const double SectionSpacing = 24;        // web mb-6 between the sync bar and the card
    private const double RootSpacing = 12;           // web space within the card header
    private const double ProfileGap = 24;            // web gap-6 between avatar and details
    private const double RowSpacing = 8;             // web KVList row spacing
    private const double AvatarSize = 80;            // web h-20 w-20

    private readonly TeslaAccountPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TeslaAccountDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _body = new() { Spacing = SectionSpacing };
    private readonly PageContainer _container;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the page over the default local-state profile source and the shell resource localizer.</summary>
    public TeslaAccountPage()
        : this(EmptyTeslaAccountSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit profile source and localizer (used by tests / dependency injection).</summary>
    /// <param name="source">The profile data port the page binds to (web <c>useTeslaUserProfile</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink; null uses a fresh collector.</param>
    public TeslaAccountPage(
        ITeslaAccountSource source,
        ILocalizer localizer,
        TeslaAccountDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TeslaAccountDiagnostics();
        _viewModel = new TeslaAccountPageViewModel(source, localizer, _diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            PageContent = _body,
        };

        IsTabStop = false;
        Content = new ScrollViewer
        {
            Content = _container,
            Padding = new Thickness(ContentPadding),
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };

        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The deep-link route name this page registers under (web <c>/tesla-account</c>).</summary>
    public static string RouteName => TeslaAccountRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TeslaAccountPageViewModel ViewModel => _viewModel;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        // The page header owns the loading + error chrome (web PageContainer loading / error); the sync bar and
        // profile card render in the content states. Neither ever leaves a region blank.
        _container.IsLoading = _viewModel.IsLoading;
        _container.ErrorMessage = _viewModel.HasError ? _viewModel.ErrorMessage : null;

        _body.Children.Clear();
        _body.Children.Add(BuildSyncBar());
        _body.Children.Add(BuildProfileCard());
    }

    // ── Sync bar (web: relative "Last synced" caption + Refresh action) ───────────────────────────────

    private TsFadeIn BuildSyncBar()
    {
        var bar = new StackPanel { Spacing = RowSpacing };
        bar.Children.Add(BuildSyncRow());

        var notice = BuildNotice();
        if (notice is not null)
        {
            bar.Children.Add(notice);
        }

        return new TsFadeIn { DelayMs = 0, Content = bar };
    }

    private Grid BuildSyncRow()
    {
        var row = new Grid { ColumnSpacing = RootSpacing, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var caption = new Text
        {
            Value = _viewModel.SyncCaption,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(caption, 0);
        row.Children.Add(caption);

        var refresh = BuildRefreshButton();
        Grid.SetColumn(refresh, 1);
        row.Children.Add(refresh);

        return row;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Medium,
            Text = _viewModel.RefreshLabel,
            IconGlyph = RefreshGlyph,
            IsLoading = _viewModel.IsRefreshing,
            IsEnabled = _viewModel.IsRefreshEnabled,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _viewModel.RefreshLabel);
        AutomationProperties.SetAutomationId(button, "tesla-account-refresh");
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RefreshAsync();

    // The assertive live-region line is the desktop-idiomatic equivalent of the web refresh toast.
    private StackPanel? BuildNotice()
    {
        if (_viewModel.RefreshNotice is not { } notice)
        {
            return null;
        }

        bool success = notice.Kind == TeslaProfileRefreshNoticeKind.Success;
        var brush = DisplayTokens.Brush(success ? "TsColorSuccessBrush" : "TsColorDangerBrush");

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new FontIcon
        {
            Glyph = success ? SuccessGlyph : ErrorGlyph,
            FontSize = 14,
            Foreground = brush,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new Text
        {
            Value = notice.Message,
            Foreground = brush,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, notice.Message);
        LiveRegion.Configure(row, assertive: true);
        LiveRegion.Announce(row);
        return row;
    }

    // ── Profile card (the single web GlassPanel) ───────────────────────────────────────────────────────

    private TsFadeIn BuildProfileCard()
    {
        var content = new StackPanel { Spacing = SectionSpacing };
        content.Children.Add(new PanelTitle { Value = _viewModel.ProfileTitle });
        content.Children.Add(_viewModel.HasProfile ? BuildProfile() : BuildEmpty());

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = content,
        };
        AutomationProperties.SetName(panel, _viewModel.ProfileTitle);
        return new TsFadeIn { DelayMs = 50, Content = panel };
    }

    private Grid BuildProfile()
    {
        var grid = new Grid { ColumnSpacing = ProfileGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var avatar = BuildAvatar();
        Grid.SetColumn(avatar, 0);
        grid.Children.Add(avatar);

        var details = BuildDetails();
        Grid.SetColumn(details, 1);
        grid.Children.Add(details);

        return grid;
    }

    private FrameworkElement BuildAvatar()
    {
        FrameworkElement avatar;
        if (_viewModel.HasAvatar && Uri.TryCreate(_viewModel.AvatarUrl, UriKind.Absolute, out var uri))
        {
            avatar = new PersonPicture
            {
                Width = AvatarSize,
                Height = AvatarSize,
                ProfilePicture = new BitmapImage(uri),
                VerticalAlignment = VerticalAlignment.Top,
            };
        }
        else
        {
            avatar = new Border
            {
                Width = AvatarSize,
                Height = AvatarSize,
                CornerRadius = new CornerRadius(AvatarSize / 2),
                BorderThickness = new Thickness(2),
                BorderBrush = DisplayTokens.Border,
                Background = DisplayTokens.Surface,
                VerticalAlignment = VerticalAlignment.Top,
                Child = new FontIcon
                {
                    Glyph = ImageOffGlyph,
                    FontSize = 32,
                    Foreground = DisplayTokens.TextMuted,
                },
            };
        }

        AutomationProperties.SetName(avatar, _viewModel.AvatarLabel);
        return avatar;
    }

    private StackPanel BuildDetails()
    {
        var details = new StackPanel { Spacing = RowSpacing, VerticalAlignment = VerticalAlignment.Top };
        details.Children.Add(BuildRow(_viewModel.NameLabel, _viewModel.NameValue));
        details.Children.Add(BuildRow(_viewModel.EmailLabel, _viewModel.EmailValue));
        details.Children.Add(BuildRow(_viewModel.FetchedAtLabel, _viewModel.FetchedAtValue));
        return details;
    }

    private static Grid BuildRow(string label, string value)
    {
        var row = new Grid { ColumnSpacing = 16 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(140) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var labelCell = new Label { Value = label, VerticalAlignment = VerticalAlignment.Top };
        Grid.SetColumn(labelCell, 0);
        row.Children.Add(labelCell);

        var valueCell = new Text
        {
            Value = value,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Top,
        };
        Grid.SetColumn(valueCell, 1);
        row.Children.Add(valueCell);

        AutomationProperties.SetName(row, $"{label}: {value}");
        return row;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = UserGlyph,
        Message = _viewModel.NoProfileMessage,
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TeslaAccountPageAutomationPeer(this);

    private sealed class TeslaAccountPageAutomationPeer(TeslaAccountPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
