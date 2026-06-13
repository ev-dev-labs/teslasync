using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;
using TsText = TeslaSync.App.Components.UI.Text;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>FleetAPIPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/FleetAPIPage.tsx</c> (route <c>/fleet-api</c>, nav name <c>FleetAPI</c>). It composes
/// the shared <see cref="PageContainer"/> chrome (the heading-level-1 title + muted subtitle, and the loading spinner
/// the first read gates) wrapping a body that reproduces every region the web page owns: GlassPanel1 the Tesla API
/// Polling kill-switch with its status + toggle, GlassPanel2 the suspended-warning callout, GlassPanel3 the API
/// Endpoint Controls card (polling / on-demand / command endpoint toggles plus the telemetry-capture section with the
/// MongoDB badge, the raw-recording toggle, GlassPanel5 the retention selector and GlassPanel6 the captured-signal
/// chip), and GlassPanel7 the API Endpoints card with GlassPanel8 the per-endpoint URL rows or the no-data empty state.
/// The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="FleetApiDisplay"/> projection, and state changes are marshalled onto the UI thread. The suspend toggle and
/// the polling-config writes call into the view-model and surface the resulting toast through the top <see cref="InfoBar"/>.
/// </summary>
public sealed partial class FleetAPIPage : UserControl, IDisposable
{
    private const double ContentPadding = 24;
    private const double BodySpacing = 16;
    private const double PanelPadding = 24;
    private const double SectionSpacing = 16;
    private const double IconBoxSize = 40;
    private const double IconGlyphSize = 20;
    private const double PanelCornerRadius = 12;
    private const int EndpointColumns = 3;

    private readonly FleetAPIPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _rendering;

    private readonly PageContainer _container;

    private readonly InfoBar _notice = new()
    {
        IsOpen = false,
        IsClosable = true,
    };

    // GlassPanel1 — Tesla API Polling.
    private readonly TsGlassPanel _pollingPanel = new() { Glow = GlassGlow.None };
    private readonly Border _pollingIconBox;
    private readonly FontIcon _pollingIcon = new() { FontSize = IconGlyphSize };
    private readonly PanelTitle _pollingTitle = new();
    private readonly Caption _pollingStatus = new();
    private readonly TsToggle _pollingToggle = new();

    // GlassPanel2 — suspended warning callout.
    private readonly TsGlassPanel _suspendedNotePanel = new() { Glow = GlassGlow.None };
    private readonly ErrorText _suspendedNoteText = new();

    // GlassPanel3 — API Endpoint Controls.
    private readonly TsGlassPanel _controlsPanel = new() { Glow = GlassGlow.Cyan };
    private readonly PanelTitle _controlsTitle = new();
    private readonly Caption _controlsSubtitle = new();
    private readonly Caption _enabledSummary = new();
    private readonly StackPanel _controlsBody = new() { Spacing = SectionSpacing };

    private readonly Label _pollingSectionLabel = new();
    private readonly Label _onDemandSectionLabel = new();
    private readonly Label _commandsSectionLabel = new();
    private readonly Label _captureSectionLabel = new();

    private readonly Grid _pollingGrid;
    private readonly Grid _onDemandGrid;
    private readonly Grid _commandsGrid;

    private readonly StackPanel _captureSection = new() { Spacing = 8 };
    private readonly TsBadge _mongoBadge = new() { Dot = true };
    private readonly EndpointCard _rawCard;

    // GlassPanel5 — Retention Period.
    private readonly TsGlassPanel _retentionRow = new() { Glow = GlassGlow.None };
    private readonly TsText _retentionTitle = new();
    private readonly Caption _retentionDescription = new();
    private readonly TsSelect _retentionSelect = new() { MinWidth = 120 };
    private IReadOnlyList<FleetApiRetentionOption> _retentionOptions = System.Array.Empty<FleetApiRetentionOption>();

    // GlassPanel6 — captured-signal chip.
    private readonly TsGlassPanel _captureStatsChip = new() { Glow = GlassGlow.Cyan };
    private readonly Caption _captureStatsText = new();

    // GlassPanel7 — API Endpoints.
    private readonly TsGlassPanel _endpointsPanel = new() { Glow = GlassGlow.Purple };
    private readonly PanelTitle _endpointsTitle = new();
    private readonly Caption _versionSubtitle = new();
    private readonly Label _configuredLabel = new();
    private readonly StackPanel _configuredList = new() { Spacing = 8 };
    private readonly TsEmptyState _endpointsEmpty = new() { IconGlyph = FleetApiRegistration.ActivityGlyph };

    private readonly Dictionary<string, EndpointCard> _endpointCards = new(StringComparer.Ordinal);

    /// <summary>Creates the page over the default (empty) feed and the shell resource localizer.</summary>
    public FleetAPIPage()
        : this(EmptyFleetApiFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The Fleet API data port (web hooks).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public FleetAPIPage(IFleetApiFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new FleetAPIPageViewModel(feed, localizer);
        var initial = _viewModel.Display;

        _pollingIconBox = BuildIconBox(_pollingIcon);
        _pollingGrid = BuildCardGrid(initial.PollingEndpoints);
        _onDemandGrid = BuildCardGrid(initial.OnDemandEndpoints);
        _commandsGrid = BuildCardGrid(initial.CommandEndpoints);
        _rawCard = BuildEndpointCard("telemetry_capture");

        BuildPollingPanel();
        BuildSuspendedNote();
        BuildControlsPanel();
        BuildEndpointsPanel();

        _container = new PageContainer(localizer, initial.Title)
        {
            Subtitle = initial.Subtitle,
            PageContent = BuildBody(),
        };

        IsTabStop = false;
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

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

        _pollingToggle.Toggled += OnPollingToggled;
        _retentionSelect.SelectionChanged += OnRetentionChanged;
        _notice.CloseButtonClick += OnNoticeClosed;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>FleetAPIPage</c>).</summary>
    public static string Slug => FleetApiRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public FleetAPIPageViewModel ViewModel => _viewModel;

    private StackPanel BuildBody()
    {
        var stack = new StackPanel { Spacing = BodySpacing };
        stack.Children.Add(_notice);
        stack.Children.Add(Fade(_pollingPanel, 160));
        stack.Children.Add(Fade(_controlsPanel, 200));
        stack.Children.Add(Fade(_endpointsPanel, 240));
        return stack;
    }

    private void BuildPollingPanel()
    {
        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(_pollingTitle);
        text.Children.Add(_pollingStatus);

        var leading = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        leading.Children.Add(_pollingIconBox);
        leading.Children.Add(text);

        var headerRow = new Grid { ColumnSpacing = SectionSpacing, VerticalAlignment = VerticalAlignment.Center };
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(leading, 0);
        _pollingToggle.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_pollingToggle, 1);
        headerRow.Children.Add(leading);
        headerRow.Children.Add(_pollingToggle);

        var body = new StackPanel { Spacing = SectionSpacing };
        body.Children.Add(headerRow);
        body.Children.Add(_suspendedNotePanel);

        _pollingPanel.Padding = new Thickness(PanelPadding);
        _pollingPanel.Content = body;
    }

    private void BuildSuspendedNote()
    {
        var icon = new FontIcon { Glyph = FleetApiRegistration.PauseGlyph, FontSize = 16, VerticalAlignment = VerticalAlignment.Top };
        ApplyAccent(icon, "TsColorDangerBrush");
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(icon);
        _suspendedNoteText.MaxWidth = 720;
        row.Children.Add(_suspendedNoteText);

        _suspendedNotePanel.Padding = new Thickness(12);
        _suspendedNotePanel.Content = row;
    }

    private void BuildControlsPanel()
    {
        var iconBox = BuildIconBox(MakeGlyph(FleetApiRegistration.ShieldGlyph, "TsChartSpeedBrush"));

        var subtitleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        _controlsSubtitle.VerticalAlignment = VerticalAlignment.Center;
        _enabledSummary.VerticalAlignment = VerticalAlignment.Center;
        subtitleRow.Children.Add(_controlsSubtitle);
        subtitleRow.Children.Add(_enabledSummary);

        var titleStack = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titleStack.Children.Add(_controlsTitle);
        titleStack.Children.Add(subtitleRow);

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.Children.Add(iconBox);
        header.Children.Add(titleStack);

        _controlsBody.Children.Add(BuildSection(_pollingSectionLabel, _pollingGrid));
        _controlsBody.Children.Add(BuildSection(_onDemandSectionLabel, _onDemandGrid));
        _controlsBody.Children.Add(BuildSection(_commandsSectionLabel, _commandsGrid));
        _controlsBody.Children.Add(BuildCaptureSection());

        var body = new StackPanel { Spacing = 20 };
        body.Children.Add(header);
        body.Children.Add(_controlsBody);

        _controlsPanel.Padding = new Thickness(PanelPadding);
        _controlsPanel.Content = body;
    }

    private StackPanel BuildCaptureSection()
    {
        var badgeRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        _captureSectionLabel.VerticalAlignment = VerticalAlignment.Center;
        badgeRow.Children.Add(_captureSectionLabel);
        badgeRow.Children.Add(_mongoBadge);

        _captureStatsChip.Padding = new Thickness(10);
        _captureStatsChip.Content = _captureStatsText;

        _captureSection.Children.Add(badgeRow);
        _captureSection.Children.Add(_rawCard.Panel);
        _captureSection.Children.Add(BuildRetentionRow());
        _captureSection.Children.Add(_captureStatsChip);
        return _captureSection;
    }

    private TsGlassPanel BuildRetentionRow()
    {
        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(_retentionTitle);
        text.Children.Add(_retentionDescription);

        var row = new Grid { ColumnSpacing = SectionSpacing, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(text, 0);
        _retentionSelect.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_retentionSelect, 1);
        row.Children.Add(text);
        row.Children.Add(_retentionSelect);

        _retentionRow.Padding = new Thickness(12);
        _retentionRow.Content = row;
        return _retentionRow;
    }

    private void BuildEndpointsPanel()
    {
        var iconBox = BuildIconBox(MakeGlyph(FleetApiRegistration.GlobeGlyph, "TsChartPowerBrush"));

        var titleStack = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titleStack.Children.Add(_endpointsTitle);
        titleStack.Children.Add(_versionSubtitle);

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        header.Children.Add(iconBox);
        header.Children.Add(titleStack);

        var configuredHeader = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        var linkIcon = new FontIcon { Glyph = FleetApiRegistration.LinkGlyph, FontSize = 14 };
        ApplyAccent(linkIcon, "TsColorTextMutedBrush");
        AutomationProperties.SetAccessibilityView(linkIcon, AccessibilityView.Raw);
        configuredHeader.Children.Add(linkIcon);
        configuredHeader.Children.Add(_configuredLabel);

        var configuredBlock = new StackPanel { Spacing = 12 };
        configuredBlock.Children.Add(configuredHeader);
        configuredBlock.Children.Add(_configuredList);

        var body = new StackPanel { Spacing = SectionSpacing };
        body.Children.Add(header);
        body.Children.Add(configuredBlock);
        body.Children.Add(_endpointsEmpty);

        _endpointsPanel.Padding = new Thickness(PanelPadding);
        _endpointsPanel.Content = body;
    }

    private static StackPanel BuildSection(Label sectionLabel, Grid grid)
    {
        var section = new StackPanel { Spacing = 8 };
        section.Children.Add(sectionLabel);
        section.Children.Add(grid);
        return section;
    }

    // GlassPanel4 — the reusable endpoint-toggle card (web EndpointToggle).
    private Grid BuildCardGrid(IReadOnlyList<FleetApiEndpointItem> items)
    {
        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
        for (var c = 0; c < EndpointColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (items.Count + EndpointColumns - 1) / EndpointColumns;
        for (var r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (var i = 0; i < items.Count; i++)
        {
            var card = BuildEndpointCard(items[i].Key);
            card.Title.Value = items[i].Label;
            card.Description.Value = items[i].Description;
            Grid.SetRow(card.Panel, i / EndpointColumns);
            Grid.SetColumn(card.Panel, i % EndpointColumns);
            grid.Children.Add(card.Panel);
        }

        return grid;
    }

    private EndpointCard BuildEndpointCard(string key)
    {
        var title = new TsText();
        var description = new Caption();
        var toggle = new TsToggle();

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(title);
        text.Children.Add(description);

        var grid = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(text, 0);
        toggle.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(toggle, 1);
        grid.Children.Add(text);
        grid.Children.Add(toggle);

        var panel = new TsGlassPanel { Glow = GlassGlow.None, Padding = new Thickness(10) };
        panel.Content = grid;

        var card = new EndpointCard(key, panel, toggle, title, description);
        toggle.Toggled += (_, _) => OnEndpointToggled(card);
        _endpointCards[key] = card;
        return card;
    }

    private static Border BuildIconBox(IconElement glyph)
    {
        glyph.HorizontalAlignment = HorizontalAlignment.Center;
        glyph.VerticalAlignment = VerticalAlignment.Center;

        var box = new Border
        {
            Width = IconBoxSize,
            Height = IconBoxSize,
            CornerRadius = new CornerRadius(10),
            Child = glyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (TokenBrush("TsColorSurfaceGlassBrush") is { } surface)
        {
            box.Background = surface;
        }

        AutomationProperties.SetAccessibilityView(box, AccessibilityView.Raw);
        return box;
    }

    private static FontIcon MakeGlyph(string glyph, string brushKey)
    {
        var icon = new FontIcon { Glyph = glyph, FontSize = IconGlyphSize };
        ApplyAccent(icon, brushKey);
        return icon;
    }

    private static TsFadeIn Fade(UIElement child, int delayMs) => new() { DelayMs = delayMs, Content = child };

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
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

    private async void OnPollingToggled(object? sender, EventArgs e)
    {
        if (_rendering)
        {
            return;
        }

        // web: mutate(!api_suspended) — the new desired suspended state is the inverse of the toggle's on state.
        bool desiredSuspended = !_pollingToggle.IsOn;
        await _viewModel.ToggleSuspendAsync(desiredSuspended).ConfigureAwait(true);
    }

    private async void OnEndpointToggled(EndpointCard card)
    {
        if (_rendering)
        {
            return;
        }

        await _viewModel.ToggleEndpointAsync(card.Key).ConfigureAwait(true);
    }

    private async void OnRetentionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_rendering)
        {
            return;
        }

        int index = _retentionSelect.SelectedIndex;
        if (index < 0 || index >= _retentionOptions.Count)
        {
            return;
        }

        await _viewModel.SetRetentionAsync(_retentionOptions[index].Days).ConfigureAwait(true);
    }

    private void OnNoticeClosed(InfoBar sender, object args) => _viewModel.ClearNotice();

    private void Render(FleetApiDisplay display)
    {
        _rendering = true;
        try
        {
            _container.Title = display.Title;
            _container.Subtitle = display.Subtitle;
            _container.IsLoading = display.ShowLoading;
            AutomationProperties.SetName(this, display.AutomationName);

            RenderNotice(display.Notice);
            RenderPolling(display);
            RenderControls(display);
            RenderEndpoints(display);
        }
        finally
        {
            _rendering = false;
        }
    }

    private void RenderNotice(FleetApiNoticeDisplay notice)
    {
        _notice.IsOpen = notice.HasNotice;
        _notice.Visibility = notice.HasNotice ? Visibility.Visible : Visibility.Collapsed;
        _notice.Title = notice.Title;
        _notice.Message = notice.Message;
        _notice.Severity = notice.Kind switch
        {
            FleetApiNoticeKind.ApiResumed or FleetApiNoticeKind.PollingUpdated => InfoBarSeverity.Success,
            FleetApiNoticeKind.SuspendFailed or FleetApiNoticeKind.PollingFailed => InfoBarSeverity.Error,
            FleetApiNoticeKind.ApiSuspended => InfoBarSeverity.Informational,
            _ => InfoBarSeverity.Informational,
        };
    }

    private void RenderPolling(FleetApiDisplay display)
    {
        _pollingTitle.Value = display.PollingTitle;
        _pollingStatus.Value = display.PollingStatus;
        _pollingToggle.IsOn = !display.IsSuspended;
        AutomationProperties.SetName(_pollingToggle, display.PollingTitle);

        _pollingIcon.Glyph = display.IsSuspended ? FleetApiRegistration.PauseGlyph : FleetApiRegistration.PlayGlyph;
        ApplyAccent(_pollingIcon, display.IsSuspended ? "TsColorDangerBrush" : "TsColorSuccessBrush");

        _suspendedNoteText.Value = display.SuspendedNote;
        _suspendedNotePanel.Visibility = display.IsSuspended ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderControls(FleetApiDisplay display)
    {
        _controlsTitle.Value = display.ControlsTitle;
        _controlsSubtitle.Value = display.ControlsSubtitle;
        _enabledSummary.Value = display.EnabledSummary;
        _enabledSummary.Visibility = string.IsNullOrEmpty(display.EnabledSummary) ? Visibility.Collapsed : Visibility.Visible;

        _pollingSectionLabel.Value = display.PollingSectionLabel;
        _onDemandSectionLabel.Value = display.OnDemandSectionLabel;
        _commandsSectionLabel.Value = display.CommandsSectionLabel;
        _captureSectionLabel.Value = display.TelemetryCaptureLabel;

        // The whole endpoint-control body is gated by the polling-config read (web `{pollingConfig && ...}`).
        _controlsBody.Visibility = display.ShowControls ? Visibility.Visible : Visibility.Collapsed;

        ApplyEndpointStates(display.PollingEndpoints);
        ApplyEndpointStates(display.OnDemandEndpoints);
        ApplyEndpointStates(display.CommandEndpoints);

        // Telemetry capture.
        _captureSection.Opacity = display.ShowMongoBadge && !display.MongoEnabled ? 0.5 : 1.0;
        _mongoBadge.Content = display.MongoBadgeText;
        _mongoBadge.Status = display.MongoEnabled ? TeslaSync.App.Core.StatusKind.Success : TeslaSync.App.Core.StatusKind.Neutral;
        _mongoBadge.Visibility = display.ShowMongoBadge ? Visibility.Visible : Visibility.Collapsed;

        _rawCard.Title.Value = display.RawSignalRecordingLabel;
        _rawCard.Description.Value = display.RawSignalRecordingDescription;
        _rawCard.Toggle.IsOn = display.RawSignalRecordingEnabled;
        AutomationProperties.SetName(_rawCard.Toggle, display.RawSignalRecordingLabel);

        _retentionTitle.Value = display.RetentionTitle;
        _retentionDescription.Value = display.RetentionDescription;
        AutomationProperties.SetName(_retentionSelect, display.RetentionTitle);
        RenderRetentionOptions(display);
        _retentionRow.Visibility = display.ShowRetention ? Visibility.Visible : Visibility.Collapsed;

        _captureStatsText.Value = display.CaptureStatsText;
        _captureStatsChip.Visibility = display.ShowCaptureStats ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderRetentionOptions(FleetApiDisplay display)
    {
        _retentionOptions = display.RetentionOptions;
        if (_retentionSelect.Items.Count != display.RetentionOptions.Count)
        {
            _retentionSelect.Items.Clear();
            foreach (var option in display.RetentionOptions)
            {
                _retentionSelect.Items.Add(new ComboBoxItem { Content = option.Label });
            }
        }
        else
        {
            for (var i = 0; i < display.RetentionOptions.Count; i++)
            {
                if (_retentionSelect.Items[i] is ComboBoxItem item)
                {
                    item.Content = display.RetentionOptions[i].Label;
                }
            }
        }

        int selected = -1;
        for (var i = 0; i < display.RetentionOptions.Count; i++)
        {
            if (display.RetentionOptions[i].Days == display.RetentionDays)
            {
                selected = i;
                break;
            }
        }

        _retentionSelect.SelectedIndex = selected;
    }

    private void ApplyEndpointStates(IReadOnlyList<FleetApiEndpointItem> items)
    {
        foreach (var item in items)
        {
            if (_endpointCards.TryGetValue(item.Key, out var card))
            {
                card.Title.Value = item.Label;
                card.Description.Value = item.Description;
                card.Toggle.IsOn = item.Enabled;
                AutomationProperties.SetName(card.Toggle, item.Label);
            }
        }
    }

    private void RenderEndpoints(FleetApiDisplay display)
    {
        _endpointsTitle.Value = display.EndpointsTitle;
        _versionSubtitle.Value = display.VersionSubtitle;
        _versionSubtitle.Visibility = string.IsNullOrEmpty(display.VersionSubtitle) ? Visibility.Collapsed : Visibility.Visible;
        _configuredLabel.Value = display.ConfiguredEndpointsLabel;

        _configuredList.Children.Clear();
        foreach (var endpoint in display.ConfiguredEndpoints)
        {
            _configuredList.Children.Add(BuildConfiguredRow(endpoint));
        }

        // The configured-endpoints block shows when present; otherwise the empty state renders (web else branch).
        _configuredList.Visibility = display.ShowConfiguredEndpoints ? Visibility.Visible : Visibility.Collapsed;
        _configuredLabel.Visibility = display.ShowConfiguredEndpoints ? Visibility.Visible : Visibility.Collapsed;

        _endpointsEmpty.Message = display.NoDataMessage;
        _endpointsEmpty.Visibility = display.ShowEndpointsEmpty ? Visibility.Visible : Visibility.Collapsed;
    }

    // GlassPanel8 — one configured-endpoint URL row.
    private static TsGlassPanel BuildConfiguredRow(FleetApiConfiguredEndpoint endpoint)
    {
        var label = new Caption { Value = endpoint.Label, VerticalAlignment = VerticalAlignment.Center };
        var url = new Code { Value = endpoint.Url, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Right };

        var grid = new Grid { ColumnSpacing = SectionSpacing, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(label, 0);
        Grid.SetColumn(url, 1);
        grid.Children.Add(label);
        grid.Children.Add(url);

        var panel = new TsGlassPanel { Glow = GlassGlow.None, Padding = new Thickness(10) };
        panel.Content = grid;
        AutomationProperties.SetName(panel, $"{endpoint.Label} {endpoint.Url}");
        return panel;
    }

    /// <summary>Unsubscribe from and dispose the composed surfaces (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _pollingToggle.Toggled -= OnPollingToggled;
        _retentionSelect.SelectionChanged -= OnRetentionChanged;
        _notice.CloseButtonClick -= OnNoticeClosed;
        _viewModel.PropertyChanged -= OnViewModelChanged;

        _container.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private static void ApplyAccent(IconElement icon, string brushKey)
    {
        if (TokenBrush(brushKey) is { } brush)
        {
            icon.Foreground = brush;
        }
    }

    private static Brush? TokenBrush(string resourceKey) =>
        Application.Current.Resources.TryGetValue(resourceKey, out var value) && value is Brush brush ? brush : null;

    protected override AutomationPeer OnCreateAutomationPeer() => new FleetApiPageAutomationPeer(this);

    private sealed class FleetApiPageAutomationPeer(FleetAPIPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }

    // The composed parts of one endpoint-toggle card, so its label / state can be updated per render.
    private sealed record EndpointCard(string Key, TsGlassPanel Panel, TsToggle Toggle, TsText Title, Caption Description);
}
