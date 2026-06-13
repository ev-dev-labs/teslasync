using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>MyActivityPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/MyActivityPage.tsx</c> (route <c>/me/activity</c>, nav name <c>MyActivity</c>).
/// Faithful to the thin web page, it composes the shared <see cref="PageContainer"/> chrome (title + subtitle +
/// copy-link + a <see cref="RangePicker"/> in the actions slot, with the container's <c>loading</c> spinner driven
/// by <c>isLoading</c>) around a single Mica/glass <see cref="TsGlassPanel"/> (the web <c>GlassPanel1</c>). The
/// panel body switches between the five web branches its <see cref="MyActivityPageViewModel"/> resolves: the 503
/// "feature disabled" notice, the 401 "identity required" notice, the retriable error notice, the feed's empty
/// notice, and (the success branch) the <see cref="TsTimeline"/> of activity rows. The view is a thin renderer:
/// all branch selection, action-label resolution and i18n happen in the view-model's <see cref="MyActivityDisplay"/>
/// projection. State changes are marshalled onto the UI thread. Every region renders (ADR-011); the surface, panel
/// and notice carry Narrator names (ADR-015).
/// </summary>
public sealed partial class MyActivityPage : UserControl, IDisposable
{
    private const double PanelPadding = 16; // web GlassPanel "p-4".

    private readonly MyActivityPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;

    private readonly PageContainer _container;
    private readonly RangePicker _rangePicker;
    private readonly TsGlassPanel _panel;
    private readonly Grid _body = new();
    private readonly TsEmptyState _notice = new();
    private readonly TsTimeline _timeline = new();

    /// <summary>Creates the page over the default empty source and the shell resource localizer.</summary>
    public MyActivityPage()
        : this(EmptyMyActivitySource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit data source and localizer (used by tests / DI hosts).</summary>
    /// <param name="source">The activity data port (web <c>useMyRecentActivity</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public MyActivityPage(IMyActivitySource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new MyActivityPageViewModel(source, localizer);

        _rangePicker = new RangePicker(
            new DelegateRangePickerSink(OnRangeCommitted),
            localizer,
            _viewModel.Range);

        _container = new PageContainer(localizer, MyActivityRegistration.Title(localizer));

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = BuildBody() };

        Content = BuildLayout();

        _notice.ActionInvoked += OnRetry;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>MyActivityPage</c>).</summary>
    public static string Slug => MyActivityRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public MyActivityPageViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the generated-client-backed <see cref="MyActivitySource"/> from the shared
    /// data layer (the native analogue of the web page's <c>useMyRecentActivity</c> hook).
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The fully wired page.</returns>
    public static MyActivityPage Create(IApiClient api, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(localizer);
        return new MyActivityPage(new MyActivitySource(api), localizer);
    }

    private Grid BuildBody()
    {
        _timeline.HorizontalAlignment = HorizontalAlignment.Stretch;
        _body.Children.Add(_notice);
        _body.Children.Add(_timeline);
        return _body;
    }

    private PageContainer BuildLayout()
    {
        // Title / subtitle / copy-link target / loading are (re)applied on every Render from the localized projection.
        _container.CopyLink = true;
        _container.Actions = _rangePicker;
        _container.PageContent = new TsFadeIn { Content = _panel };
        return _container;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_started)
        {
            _started = true;
            _viewModel.NotifyOpened();
        }

        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

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

    private void Render(MyActivityDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        _container.CopyLink = true;
        _container.CopyLinkText = display.CopyLinkText;
        _container.IsLoading = display.IsLoading;

        if (display.ShowTimeline)
        {
            _timeline.Items = display.Rows
                .Select(static row => new TsActivityEntry(row.Title, row.Subtitle, row.Timestamp, row.Severity))
                .ToList();
            _timeline.Visibility = Visibility.Visible;
            _notice.Visibility = Visibility.Collapsed;
        }
        else
        {
            _notice.IconGlyph = display.NoticeGlyph;
            _notice.Title = display.NoticeTitle;
            _notice.Message = display.NoticeMessage;
            _notice.ActionText = display.NoticeActionText;
            _notice.Visibility = Visibility.Visible;
            _timeline.Visibility = Visibility.Collapsed;
        }

        AutomationProperties.SetName(this, display.AutomationName);
        AutomationProperties.SetName(_panel, display.AutomationName);
    }

    private void OnRetry(object? sender, EventArgs e) =>
        InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnRangeCommitted(DateRange range, string? presetId)
    {
        // The web RangePicker is fully controlled: echo the committed range back and reload the window.
        _rangePicker.Value = range;
        InvokeAsync(() => _viewModel.SetRangeAsync(range));
    }

    private static async void InvokeAsync(Func<Task> action) =>
        await action().ConfigureAwait(true);

    /// <summary>Unsubscribe from and dispose the view-model + hosted surfaces (CA1001; mirrors sibling pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _notice.ActionInvoked -= OnRetry;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _rangePicker.Dispose();
        _container.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new MyActivityPageAutomationPeer(this);

    private sealed class MyActivityPageAutomationPeer(MyActivityPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
