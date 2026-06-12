using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>PageContainer</c> shared surface — a parity port of
/// web/src/components/layout/PageContainer.tsx. It is the page-tier chrome every feature page mounts inside: an
/// always-visible header (a heading-level-1 title, an optional muted subtitle and a right-aligned actions cluster)
/// above a body that resolves to exactly one of four mutually-exclusive states — a centred large loading
/// <see cref="Spinner"/>, a danger-tinted error card showing the failure message, a centred "no data" empty state,
/// or the page content wrapped in a page-level error boundary. The actions cluster reproduces the web header order
/// — the most-degraded data-freshness chip (folded from the page's queries via
/// <see cref="WorstOfDataFreshnessSource"/>), the "Copy link" affordance and the caller's own actions — and is
/// shown only when at least one of them is present (web <c>actions || copyLink || resolvedQuery</c>). On mount it
/// pushes the caller's per-route breadcrumb label overrides up to the navigation chrome through the
/// <see cref="IBreadcrumbOverrideSink"/> seam (web <c>useSetBreadcrumbOverrides</c>) and withdraws them on unmount.
/// All state flows through <see cref="PageContainerViewModel"/>; the view performs no I/O and reads no query itself.
/// It composes from platform tokens (P1/S9) rather than web Tailwind classes, announces the active body state
/// through a UI-Automation live region (assertive for the error card, polite for loading / empty), and emits the
/// <c>view.opened</c> diagnostic exactly once when shown.
/// </summary>
public sealed partial class PageContainer : ContentControl, IDisposable
{
    private const double RootSpacing = 24;        // web space-y-6
    private const double HeaderColumnGap = 12;    // web gap-3
    private const double TitleSubtitleGap = 4;    // web mt-1
    private const double ActionsSpacing = 8;      // web gap-2
    private const double TitleFontSize = 24;      // web text-2xl
    private const double SubtitleFontSize = 14;   // web text-sm
    private const double BodyTextFontSize = 14;   // web text-sm
    private const double LoadingPadding = 80;     // web py-20
    private const double EmptyPadding = 64;       // web py-16
    private const double ErrorCardRadius = 8;     // web rounded-lg
    private const double ErrorCardPad = 16;       // web p-4

    private readonly ILocalizer _localizer;
    private readonly PageContainerViewModel _viewModel;
    private readonly PageContainerDiagnostics _diagnostics;
    private readonly IDataFreshnessSource? _freshnessSource;
    private readonly bool _ownsFreshnessSource;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Orientation = Orientation.Vertical,
        Spacing = RootSpacing,
    };

    private readonly Grid _header = new()
    {
        ColumnSpacing = HeaderColumnGap,
        ColumnDefinitions =
        {
            new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) },
            new ColumnDefinition { Width = GridLength.Auto },
        },
    };

    private readonly StackPanel _titleColumn = new()
    {
        Orientation = Orientation.Vertical,
        Spacing = TitleSubtitleGap,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        FontWeight = FontWeights.Bold,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _subtitle = new()
    {
        FontSize = SubtitleFontSize,
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
    };

    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = ActionsSpacing,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly ContentPresenter _actionsPresenter = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly TsCopyLinkButton _copyLink = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly Grid _bodyHost = new();

    private readonly Grid _loadingHost = new()
    {
        Padding = new Thickness(0, LoadingPadding, 0, LoadingPadding),
        HorizontalAlignment = HorizontalAlignment.Stretch,
        Visibility = Visibility.Collapsed,
    };

    private readonly Spinner _spinner;

    private readonly Border _errorCard = new()
    {
        CornerRadius = new CornerRadius(ErrorCardRadius),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(ErrorCardPad),
        HorizontalAlignment = HorizontalAlignment.Stretch,
        Visibility = Visibility.Collapsed,
    };

    private readonly TextBlock _errorText = new()
    {
        FontSize = BodyTextFontSize,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly Grid _emptyHost = new()
    {
        Padding = new Thickness(0, EmptyPadding, 0, EmptyPadding),
        HorizontalAlignment = HorizontalAlignment.Stretch,
        Visibility = Visibility.Collapsed,
    };

    private readonly TextBlock _emptyText = new()
    {
        FontSize = BodyTextFontSize,
        TextWrapping = TextWrapping.Wrap,
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsPageErrorBoundary _contentBoundary = new()
    {
        Visibility = Visibility.Collapsed,
    };

    private readonly DataFreshness? _freshnessChip;

    private object? _pageContent;
    private UIElement? _actionsContent;
    private string? _emptyMessage;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates an empty content page over the i18n passthrough and the inert breadcrumb seam (the designer /
    /// parameterless host entry point). Supply an explicit <see cref="ILocalizer"/> and seams via the other
    /// constructor to drive i18n, freshness and breadcrumbs from the composition root.
    /// </summary>
    public PageContainer()
        : this(PassthroughLocalizer.Instance, string.Empty)
    {
    }

    /// <summary>Creates the page over the i18n facade, title and seams (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="title">The page title (web <c>title</c>).</param>
    /// <param name="breadcrumbSink">The breadcrumb-override seam (P1/S8); null uses the inert sink.</param>
    /// <param name="freshnessSources">The page's freshness seams folded into one chip (web <c>query</c>); null/empty shows no chip.</param>
    /// <param name="breadcrumbOverrides">The per-route label overrides to publish on mount (web <c>breadcrumbLabels</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PageContainer(
        ILocalizer localizer,
        string title,
        IBreadcrumbOverrideSink? breadcrumbSink = null,
        IReadOnlyList<IDataFreshnessSource>? freshnessSources = null,
        IReadOnlyDictionary<string, string>? breadcrumbOverrides = null,
        PageContainerDiagnostics? diagnostics = null)
        : this(
            localizer,
            new PageContainerViewModel(
                localizer,
                title,
                breadcrumbSink,
                hasFreshness: freshnessSources is { Count: > 0 },
                breadcrumbOverrides: breadcrumbOverrides),
            freshnessSources is { Count: > 0 } ? new WorstOfDataFreshnessSource(freshnessSources) : null,
            ownsFreshnessSource: true,
            diagnostics)
    {
    }

    /// <summary>Creates the page over an explicit state holder (tests / headless hosts) and an optional freshness seam.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="localizer">The i18n facade the embedded surfaces resolve through; null uses the passthrough.</param>
    /// <param name="freshnessSource">The freshness seam the chip binds (caller-owned); null shows no chip.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PageContainer(
        PageContainerViewModel viewModel,
        ILocalizer? localizer = null,
        IDataFreshnessSource? freshnessSource = null,
        PageContainerDiagnostics? diagnostics = null)
        : this(localizer ?? PassthroughLocalizer.Instance, viewModel, freshnessSource, ownsFreshnessSource: false, diagnostics)
    {
    }

    private PageContainer(
        ILocalizer localizer,
        PageContainerViewModel viewModel,
        IDataFreshnessSource? freshnessSource,
        bool ownsFreshnessSource,
        PageContainerDiagnostics? diagnostics)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(viewModel);

        _localizer = localizer;
        _viewModel = viewModel;
        _freshnessSource = freshnessSource;
        _ownsFreshnessSource = ownsFreshnessSource;
        _diagnostics = diagnostics ?? new PageContainerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _spinner = new Spinner(SpinnerSize.Large, label: null, localizer: _localizer);
        if (_freshnessSource is not null)
        {
            _freshnessChip = new DataFreshness(_localizer, _freshnessSource, compact: false);
        }

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();

        AutomationProperties.SetAutomationId(this, PageContainerRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _copyLink.Copied += OnCopyLinkCopied;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>Raised after the user copies the page link (forwarded from the copy-link affordance).</summary>
    public event EventHandler? LinkCopied;

    /// <summary>The canonical surface slug (<c>PageContainer</c>).</summary>
    public static string Slug => PageContainerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public PageContainerViewModel ViewModel => _viewModel;

    /// <summary>The page title (web <c>title</c>).</summary>
    public string Title
    {
        get => _viewModel.Projection.Title;
        set => _viewModel.SetTitle(value);
    }

    /// <summary>The optional sub-heading (web <c>subtitle</c>); null/blank hides it.</summary>
    public string? Subtitle
    {
        get => _viewModel.Projection.HasSubtitle ? _viewModel.Projection.Subtitle : null;
        set => _viewModel.SetSubtitle(value);
    }

    /// <summary>Whether the loading spinner replaces the body (web <c>loading</c>).</summary>
    public bool IsLoading
    {
        get => _viewModel.Projection.State == PageContainerState.Loading;
        set => _viewModel.SetLoading(value);
    }

    /// <summary>The user-facing error message (web <c>error.message</c>); null clears the error.</summary>
    public string? ErrorMessage
    {
        get => _viewModel.Projection.State == PageContainerState.Error ? _viewModel.Projection.ErrorMessage : null;
        set => _viewModel.SetError(value);
    }

    /// <summary>Whether the empty state replaces the body (web <c>empty</c>).</summary>
    public bool IsEmpty
    {
        get => _viewModel.Projection.State == PageContainerState.Empty;
        set => _viewModel.SetEmpty(value);
    }

    /// <summary>The empty-state message override (web <c>emptyMessage</c>); null falls back to the default sentence.</summary>
    public string? EmptyMessage
    {
        get => _emptyMessage;
        set
        {
            _emptyMessage = value;
            _viewModel.SetEmptyMessage(value);
        }
    }

    /// <summary>Whether the "Copy link" affordance is shown in the header (web <c>copyLink</c>).</summary>
    public bool CopyLink
    {
        get => _viewModel.Projection.ShowCopyLink;
        set => _viewModel.SetCopyLink(value);
    }

    /// <summary>The link the copy-link affordance writes to the clipboard (web <c>window.location.href</c>).</summary>
    public string CopyLinkText
    {
        get => _copyLink.LinkText;
        set => _copyLink.LinkText = value ?? string.Empty;
    }

    /// <summary>The caller's header actions node (web <c>actions</c>); null hides the actions slot.</summary>
    public UIElement? Actions
    {
        get => _actionsContent;
        set
        {
            _actionsContent = value;
            _actionsPresenter.Content = value;
            _viewModel.SetHasActions(value is not null);
        }
    }

    /// <summary>The page body content guarded by the page-level error boundary (web <c>children</c>).</summary>
    public object? PageContent
    {
        get => _pageContent;
        set
        {
            _pageContent = value;
            _contentBoundary.ProtectedContent = value;
        }
    }

    /// <summary>Replace the published per-route breadcrumb label overrides (web <c>breadcrumbLabels</c>).</summary>
    /// <param name="overrides">The new overrides, or null/empty to withdraw.</param>
    public void SetBreadcrumbOverrides(IReadOnlyDictionary<string, string>? overrides) =>
        _viewModel.SetBreadcrumbOverrides(overrides);

    /// <summary>The composed accessible name the automation peer reports (the page title).</summary>
    internal string AccessibleName => _viewModel.Projection.Title;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _copyLink.Copied -= OnCopyLinkCopied;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        _spinner.Dispose();
        _freshnessChip?.Dispose();
        _viewModel.Dispose();
        if (_ownsFreshnessSource && _freshnessSource is IDisposable disposableSource)
        {
            disposableSource.Dispose();
        }

        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PageContainerAutomationPeer(this);

    private void BuildChrome()
    {
        _titleColumn.Children.Add(_title);
        _titleColumn.Children.Add(_subtitle);

        // web header cluster order: freshness chip, then copy-link, then the caller's actions.
        if (_freshnessChip is not null)
        {
            _actions.Children.Add(_freshnessChip);
        }

        _actions.Children.Add(_copyLink);
        _actions.Children.Add(_actionsPresenter);

        Grid.SetColumn(_titleColumn, 0);
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_titleColumn);
        _header.Children.Add(_actions);

        _loadingHost.Children.Add(_spinner);
        _spinner.HorizontalAlignment = HorizontalAlignment.Center;
        _spinner.VerticalAlignment = VerticalAlignment.Center;

        _errorCard.Child = _errorText;

        _emptyHost.Children.Add(_emptyText);

        _bodyHost.Children.Add(_loadingHost);
        _bodyHost.Children.Add(_errorCard);
        _bodyHost.Children.Add(_emptyHost);
        _bodyHost.Children.Add(_contentBoundary);

        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        // The title is the page's heading-level-1 landmark (web h1); the subtitle is decorative copy read through
        // the heading. The body regions carry their own live-region names.
        AutomationProperties.SetHeadingLevel(_title, AutomationHeadingLevel.Level1);
        AutomationProperties.SetAutomationId(_title, PageContainerRegistration.TitleAutomationId);
        AutomationProperties.SetAutomationId(_actions, PageContainerRegistration.ActionsAutomationId);
        AutomationProperties.SetAutomationId(_loadingHost, PageContainerRegistration.LoadingAutomationId);
        AutomationProperties.SetAutomationId(_errorCard, PageContainerRegistration.ErrorAutomationId);
        AutomationProperties.SetAutomationId(_emptyHost, PageContainerRegistration.EmptyAutomationId);
        AutomationProperties.SetAutomationId(_contentBoundary, PageContainerRegistration.BodyAutomationId);
        AutomationProperties.SetAutomationId(_copyLink, PageContainerRegistration.CopyLinkAutomationId);
        AutomationProperties.SetAccessibilityView(_subtitle, AccessibilityView.Raw);

        LiveRegion.Configure(_errorCard, assertive: true);
        LiveRegion.Configure(_emptyHost);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        AnnounceBody();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(PageContainerViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void OnCopyLinkCopied(object? sender, EventArgs e) => LinkCopied?.Invoke(this, EventArgs.Empty);

    private void Render()
    {
        var projection = _viewModel.Projection;

        _title.Foreground = DisplayTokens.TextPrimary;
        _title.Text = projection.Title;
        AutomationProperties.SetName(this, projection.Title);

        _subtitle.Foreground = DisplayTokens.Brush(PageContainerRegistration.SubtitleBrushKey);
        _subtitle.Text = projection.Subtitle;
        _subtitle.Visibility = projection.HasSubtitle ? Visibility.Visible : Visibility.Collapsed;

        _actions.Visibility = projection.ShowHeaderActions ? Visibility.Visible : Visibility.Collapsed;
        if (_freshnessChip is not null)
        {
            _freshnessChip.Visibility = projection.ShowFreshness ? Visibility.Visible : Visibility.Collapsed;
        }

        _copyLink.Visibility = projection.ShowCopyLink ? Visibility.Visible : Visibility.Collapsed;
        if (projection.ShowCopyLink)
        {
            _copyLink.Label = PageContainerRegistration.ResolveCopyLinkLabel(_localizer);
            _copyLink.CopiedLabel = PageContainerRegistration.ResolveCopiedLabel(_localizer);
        }

        _actionsPresenter.Visibility = projection.HasActions ? Visibility.Visible : Visibility.Collapsed;

        RenderBody(projection);
        AnnounceBody();
    }

    private void RenderBody(PageContainerProjection projection)
    {
        _loadingHost.Visibility = projection.State == PageContainerState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _errorCard.Visibility = projection.State == PageContainerState.Error ? Visibility.Visible : Visibility.Collapsed;
        _emptyHost.Visibility = projection.State == PageContainerState.Empty ? Visibility.Visible : Visibility.Collapsed;
        _contentBoundary.Visibility = projection.State == PageContainerState.Content ? Visibility.Visible : Visibility.Collapsed;

        if (projection.State == PageContainerState.Error)
        {
            var danger = DisplayTokens.Brush(PageContainerRegistration.DangerBrushKey);
            _errorCard.Background = TintBrush(PageContainerRegistration.ErrorCardBackgroundOpacity);
            _errorCard.BorderBrush = TintBrush(PageContainerRegistration.ErrorCardBorderOpacity);
            _errorText.Foreground = danger;
            _errorText.Text = projection.ErrorMessage;
            AutomationProperties.SetName(_errorCard, projection.BodyAccessibleName);
        }

        if (projection.State == PageContainerState.Empty)
        {
            _emptyText.Foreground = DisplayTokens.Brush(PageContainerRegistration.EmptyTextBrushKey);
            _emptyText.Text = projection.EmptyMessage;
            AutomationProperties.SetName(_emptyHost, projection.BodyAccessibleName);
        }
    }

    private void AnnounceBody()
    {
        if (!IsLoaded)
        {
            return;
        }

        var state = _viewModel.Projection.State;
        if (state == PageContainerState.Error)
        {
            LiveRegion.Announce(_errorCard);
        }
        else if (state == PageContainerState.Empty)
        {
            LiveRegion.Announce(_emptyHost);
        }
    }

    private static SolidColorBrush TintBrush(double opacity) => new(ResolveDangerColor()) { Opacity = opacity };

    private static Windows.UI.Color ResolveDangerColor()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(PageContainerRegistration.DangerColorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the danger brush's colour so the card still tints when the colour token is absent.
        return DisplayTokens.Brush(PageContainerRegistration.DangerBrushKey) is SolidColorBrush brush
            ? brush.Color
            : Microsoft.UI.Colors.Red;
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

    private sealed class PageContainerAutomationPeer : FrameworkElementAutomationPeer
    {
        public PageContainerAutomationPeer(PageContainer owner)
            : base(owner)
        {
        }

        private PageContainer Surface => (PageContainer)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
