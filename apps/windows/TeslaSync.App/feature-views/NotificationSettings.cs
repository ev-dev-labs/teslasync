using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 NotificationSettings surface — a parity port of
/// web/src/features/settings/components/NotificationSettings.tsx. It composes the web component's three glass
/// panels: the browser/OS-notification panel (its per-permission branch — unsupported message, enable button,
/// enabled badge, blocked hint, and the per-event toggles once granted), the browser-tab-signals panel (the two
/// tab toggles) and the notification-sounds panel (master toggle, autoplay hint, the seven channel rows each
/// with a Test cue, and the volume slider). The browser-tab settings flow through the cache-then-network
/// <see cref="NotificationSettingsViewModel"/>, so the surface renders every state the P2 contract requires —
/// section skeletons while loading, a retry surface on a hard failure, and a freshness chip (stale / offline)
/// otherwise — while the OS-permission and sound sections (local preferences) always render. The view never
/// performs HTTP; every string resolves through the i18n facade and every interactive element carries a
/// Narrator name.
/// </summary>
public sealed partial class NotificationSettings : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string PlayGlyph = "\uE768";    // Segoe Fluent — Play
    private const double PanelPadding = 24;       // web p-6
    private const uint ToneDurationMs = 150;

    private readonly NotificationSettingsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly NotificationSettingsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    // Freshness header.
    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly TsBadge _freshnessChip = new();
    private readonly TextBlock _freshnessChipText = new() { FontSize = 12 };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refreshButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _loading = new() { Spacing = 16 };
    private readonly TsQueryError _errorSurface = new();

    private readonly StackPanel _content = new() { Spacing = 16 };

    // Permission section.
    private readonly PanelTitle _permTitle = new();
    private readonly Caption _permSubtitle = new();
    private readonly Caption _unsupportedText = new();
    private readonly StackPanel _permActionRow = new() { Orientation = Orientation.Horizontal, Spacing = 12 };
    private readonly TsButton _enableButton = new() { Variant = ButtonVariant.Primary, IconGlyph = NotificationSettingsProjection.BellGlyph };
    private readonly TsBadge _enabledBadge = new() { Status = StatusKind.Success, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _enabledBadgeText = new() { FontSize = 12 };
    private readonly Caption _blockedText = new();
    private readonly StackPanel _eventsPanel = new() { Spacing = 12 };
    private readonly Label _eventsHeading = new();
    private readonly TsToggle _alertsToggle = new();
    private readonly TsToggle _exportToggle = new();
    private readonly Caption _eventsHint = new();

    // Tab-signals section.
    private readonly Label _tabHeading = new();
    private readonly TsToggle _badgeToggle = new();
    private readonly TsToggle _flashToggle = new();
    private readonly Caption _tabHint = new();

    // Sounds section.
    private readonly PanelTitle _soundsTitle = new();
    private readonly Caption _soundsSubtitle = new();
    private readonly TsToggle _masterToggle = new();
    private readonly Caption _autoplayHint = new();
    private readonly Label _channelsHeading = new();
    private readonly StackPanel _channelList = new() { Spacing = 8 };
    private readonly Border[] _channelRows;
    private readonly TsToggle[] _channelToggles;
    private readonly TsButton[] _channelTests;
    private readonly Label _volumeLabel = new();
    private readonly Caption _volumeValue = new();
    private readonly TsSlider _volumeSlider = new()
    {
        Minimum = 0,
        Maximum = 100,
        StepFrequency = 5,
        SmallChange = 5,
        LargeChange = 10,
    };

    private bool _started;
    private bool _renderQueued;
    private bool _updating;
    private bool _disposed;

    /// <summary>Creates the surface over the four shared seams, the i18n facade and optional diagnostics.</summary>
    /// <param name="tabSource">The browser-tab-signals cache-then-network source.</param>
    /// <param name="permission">The OS notification-permission gateway.</param>
    /// <param name="pushStore">The out-of-tab event-preference store.</param>
    /// <param name="soundStore">The sound-preference store.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public NotificationSettings(
        INotificationTabSignalsSource tabSource,
        INotificationPermissionGateway permission,
        IWebPushPreferenceStore pushStore,
        INotificationSoundPreferenceStore soundStore,
        ILocalizer localizer,
        NotificationSettingsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(tabSource);
        ArgumentNullException.ThrowIfNull(permission);
        ArgumentNullException.ThrowIfNull(pushStore);
        ArgumentNullException.ThrowIfNull(soundStore);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new NotificationSettingsDiagnostics();
        _viewModel = new NotificationSettingsViewModel(tabSource, permission, pushStore, soundStore, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        int channelCount = NotificationSettingsRegistration.SoundCategories.Count;
        _channelRows = new Border[channelCount];
        _channelToggles = new TsToggle[channelCount];
        _channelTests = new TsButton[channelCount];

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>NotificationSettings</c>).</summary>
    public static string Slug => NotificationSettingsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public NotificationSettingsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="NotificationTabSignalsSource"/> from the
    /// shared data layer plus the headless default local stores (the host may pass real OS-backed stores).
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The cache-then-network engine.</param>
    /// <param name="options">The API client options (JSON settings).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    /// <param name="permission">Optional OS permission gateway (defaults to the in-memory gateway).</param>
    /// <param name="pushStore">Optional event-preference store (defaults to the in-memory store).</param>
    /// <param name="soundStore">Optional sound-preference store (defaults to the in-memory store).</param>
    public static NotificationSettings Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        NotificationSettingsDiagnostics? diagnostics = null,
        INotificationPermissionGateway? permission = null,
        IWebPushPreferenceStore? pushStore = null,
        INotificationSoundPreferenceStore? soundStore = null)
    {
        var source = new NotificationTabSignalsSource(api, engine, options);
        return new NotificationSettings(
            source,
            permission ?? new InMemoryNotificationPermissionGateway(),
            pushStore ?? new InMemoryWebPushPreferenceStore(),
            soundStore ?? new InMemoryNotificationSoundPreferenceStore(),
            localizer,
            diagnostics);
    }

    private void BuildChrome()
    {
        _freshnessChip.Content = _freshnessChipText;
        _freshnessChip.VerticalAlignment = VerticalAlignment.Center;
        _refreshButton.Click += OnRefreshClick;
        _header.Children.Add(_freshnessChip);
        _header.Children.Add(_freshness);
        _header.Children.Add(_refreshButton);

        for (int i = 0; i < 3; i++)
        {
            _loading.Children.Add(BuildSkeletonPanel(i == 1 ? 220 : 150));
        }

        LiveRegion.Configure(_loading);
        _errorSurface.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();

        _content.Children.Add(BuildPermissionSection());
        _content.Children.Add(BuildTabSection());
        _content.Children.Add(BuildSoundsSection());

        _root.Children.Add(_header);
        _root.Children.Add(_loading);
        _root.Children.Add(_errorSurface);
        _root.Children.Add(_content);

        Content = new ScrollViewer
        {
            Content = _root,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(4),
        };
    }

    private TsGlassPanel BuildPermissionSection()
    {
        var content = new StackPanel { Spacing = 16 };
        content.Children.Add(BuildSectionHeader(NotificationSettingsProjection.BellGlyph, _permTitle, _permSubtitle));

        _unsupportedText.Visibility = Visibility.Collapsed;
        content.Children.Add(_unsupportedText);

        _enableButton.Click += (_, _) => _ = _viewModel.RequestPermissionAsync();
        _enabledBadge.Content = _enabledBadgeText;
        _permActionRow.Children.Add(_enableButton);
        _permActionRow.Children.Add(_enabledBadge);
        _permActionRow.Children.Add(_blockedText);
        content.Children.Add(_permActionRow);

        _alertsToggle.Toggled += (_, _) => OnToggle(() => _viewModel.SetAlerts(_alertsToggle.IsOn));
        _exportToggle.Toggled += (_, _) => OnToggle(() => _viewModel.SetExportStatus(_exportToggle.IsOn));
        _eventsPanel.Children.Add(_eventsHeading);
        _eventsPanel.Children.Add(_alertsToggle);
        _eventsPanel.Children.Add(_exportToggle);
        _eventsPanel.Children.Add(_eventsHint);
        content.Children.Add(_eventsPanel);

        return Panel(content);
    }

    private TsGlassPanel BuildTabSection()
    {
        var content = new StackPanel { Spacing = 12 };
        _badgeToggle.Toggled += (_, _) => OnToggle(() => _viewModel.SetTabBadge(_badgeToggle.IsOn));
        _flashToggle.Toggled += (_, _) => OnToggle(() => _viewModel.SetCriticalFlash(_flashToggle.IsOn));
        content.Children.Add(_tabHeading);
        content.Children.Add(_badgeToggle);
        content.Children.Add(_flashToggle);
        content.Children.Add(_tabHint);
        return Panel(content);
    }

    private TsGlassPanel BuildSoundsSection()
    {
        var content = new StackPanel { Spacing = 16 };
        content.Children.Add(BuildSectionHeader(NotificationSettingsProjection.VolumeGlyph, _soundsTitle, _soundsSubtitle));

        _masterToggle.Toggled += (_, _) => OnToggle(() => _viewModel.SetSoundMaster(_masterToggle.IsOn));
        content.Children.Add(_masterToggle);

        _autoplayHint.Visibility = Visibility.Collapsed;
        content.Children.Add(_autoplayHint);

        var channels = new StackPanel { Spacing = 8 };
        channels.Children.Add(_channelsHeading);

        var categories = NotificationSettingsRegistration.SoundCategories;
        for (int i = 0; i < categories.Count; i++)
        {
            var category = categories[i];
            var toggle = new TsToggle();
            var test = new TsButton { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = PlayGlyph };

            toggle.Toggled += (_, _) => OnToggle(() => _viewModel.SetSoundCategory(category, toggle.IsOn));
            test.Click += (_, _) => OnTestSound(category);

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Grid.SetColumn(toggle, 0);
            Grid.SetColumn(test, 1);
            grid.Children.Add(toggle);
            grid.Children.Add(test);

            var row = new Border
            {
                CornerRadius = new CornerRadius(8),
                BorderThickness = new Thickness(1),
                BorderBrush = DisplayTokens.Border,
                Background = DisplayTokens.Surface,
                Padding = new Thickness(12, 8, 12, 8),
                Child = grid,
            };

            _channelRows[i] = row;
            _channelToggles[i] = toggle;
            _channelTests[i] = test;
            channels.Children.Add(row);
        }

        content.Children.Add(channels);

        _volumeSlider.ValueChanged += OnVolumeChanged;
        var volumeHeader = new Grid();
        volumeHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        volumeHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_volumeLabel, 0);
        Grid.SetColumn(_volumeValue, 1);
        volumeHeader.Children.Add(_volumeLabel);
        volumeHeader.Children.Add(_volumeValue);

        var volume = new StackPanel { Spacing = 4 };
        volume.Children.Add(volumeHeader);
        volume.Children.Add(_volumeSlider);
        content.Children.Add(volume);

        return Panel(content);
    }

    private static StackPanel BuildSectionHeader(string glyph, PanelTitle title, Caption subtitle)
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        header.Children.Add(BuildIconBox(glyph));
        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(title);
        text.Children.Add(subtitle);
        header.Children.Add(text);
        return header;
    }

    private static Border BuildIconBox(string glyph)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        return new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(10),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Child = icon,
        };
    }

    private static TsGlassPanel BuildSkeletonPanel(double bodyHeight)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new TsSkeleton { BlockHeight = 24, BlockWidth = 180 });
        content.Children.Add(new TsSkeleton { BlockHeight = bodyHeight });
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
    }

    private static TsGlassPanel Panel(UIElement content) =>
        new() { Padding = new Thickness(PanelPadding), Content = content };

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

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnToggle(Action apply)
    {
        if (_updating)
        {
            return;
        }

        apply();
    }

    private void OnVolumeChanged(object sender, RangeBaseValueChangedEventArgs e)
    {
        if (_updating)
        {
            return;
        }

        _viewModel.SetVolumePercent((int)Math.Round(e.NewValue));
    }

    private void OnTestSound(NotificationSoundCategory category)
    {
        var result = _viewModel.TestSound(category);
        if (result.Played)
        {
            uint frequency = CategoryFrequency(category);
            _ = Task.Run(() => Beep(frequency, ToneDurationMs));
        }
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
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
        var display = _viewModel.Display;
        var state = _viewModel.State;

        AutomationProperties.SetName(this, display.AutomationName);

        bool loading = state == NotificationSettingsState.Loading;
        bool error = state == NotificationSettingsState.Error;
        bool hasContent = !loading && !error;

        _loading.Visibility = loading ? Visibility.Visible : Visibility.Collapsed;
        _errorSurface.Visibility = error ? Visibility.Visible : Visibility.Collapsed;
        _content.Visibility = hasContent ? Visibility.Visible : Visibility.Collapsed;
        _header.Visibility = hasContent ? Visibility.Visible : Visibility.Collapsed;

        if (error)
        {
            RenderError();
            return;
        }

        if (loading)
        {
            return;
        }

        RenderHeader(state);
        RenderContent(display);
    }

    private void RenderError()
    {
        _errorSurface.Title = _localizer.GetString("settings.error.title", "Couldn't load notification settings");
        _errorSurface.Message = _viewModel.ErrorMessage
            ?? _localizer.GetString("settings.error.load", "Couldn't load notification settings");
        _errorSurface.ActionText = _localizer.GetString("common.retry", "Retry");
        _errorSurface.AttemptCount = _viewModel.Attempts;
    }

    private void RenderHeader(NotificationSettingsState state)
    {
        bool stale = state == NotificationSettingsState.Stale;
        bool offline = state == NotificationSettingsState.Offline;

        if (stale || offline)
        {
            string text = offline
                ? _localizer.GetString("settings.offlineChip", "Offline")
                : _localizer.GetString("settings.staleChip", "Stale");
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = text;
            AutomationProperties.SetName(_freshnessChip, text);
            _freshnessChip.Visibility = Visibility.Visible;
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        AutomationProperties.SetName(_refreshButton, _localizer.GetString("settings.refresh", "Refresh notification settings"));
    }

    private void RenderContent(NotificationSettingsDisplay display)
    {
        _updating = true;
        try
        {
            RenderPermission(display.Permission);
            RenderTabSignals(display.TabSignals);
            RenderSounds(display.Sounds);
        }
        finally
        {
            _updating = false;
        }
    }

    private void RenderPermission(NotificationPermissionDisplay permission)
    {
        _permTitle.Value = permission.Title;
        _permSubtitle.Value = permission.Subtitle;

        _unsupportedText.Value = permission.UnsupportedMessage;
        _unsupportedText.Visibility = permission.IsSupported ? Visibility.Collapsed : Visibility.Visible;
        _permActionRow.Visibility = permission.IsSupported ? Visibility.Visible : Visibility.Collapsed;

        _enableButton.Text = permission.EnableButtonText;
        _enableButton.Visibility = permission.ShowEnableButton ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_enableButton, permission.EnableButtonText);

        _enabledBadgeText.Text = permission.EnabledBadgeText;
        _enabledBadge.Visibility = permission.ShowEnabledBadge ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_enabledBadge, permission.EnabledBadgeText);

        _blockedText.Value = permission.BlockedMessage;
        _blockedText.Visibility = permission.ShowBlocked ? Visibility.Visible : Visibility.Collapsed;

        _eventsPanel.Visibility = permission.ShowEvents ? Visibility.Visible : Visibility.Collapsed;
        _eventsHeading.Value = permission.EventsHeading;
        ApplyToggle(_alertsToggle, permission.Alerts);
        ApplyToggle(_exportToggle, permission.ExportStatus);
        _eventsHint.Value = permission.EventsHint;
    }

    private void RenderTabSignals(NotificationTabSignalsDisplay tab)
    {
        _tabHeading.Value = tab.Heading;
        ApplyToggle(_badgeToggle, tab.Badge);
        ApplyToggle(_flashToggle, tab.Flash);
        _tabHint.Value = tab.Hint;
    }

    private void RenderSounds(NotificationSoundsDisplay sounds)
    {
        _soundsTitle.Value = sounds.Title;
        _soundsSubtitle.Value = sounds.Subtitle;
        ApplyToggle(_masterToggle, sounds.Master);

        _autoplayHint.Value = sounds.AutoplayHint;
        _autoplayHint.Visibility = sounds.ShowAutoplayHint ? Visibility.Visible : Visibility.Collapsed;

        _channelsHeading.Value = sounds.CategoriesHeading;
        for (int i = 0; i < _channelRows.Length && i < sounds.Categories.Count; i++)
        {
            var row = sounds.Categories[i];
            ApplyToggle(_channelToggles[i], new NotificationToggleRow(row.Label, row.IsOn, row.ToggleAutomationName));
            _channelTests[i].Text = row.TestLabel;
            AutomationProperties.SetName(_channelTests[i], row.TestAutomationName);
            _channelRows[i].Opacity = row.Dimmed ? 0.6 : 1.0;
        }

        _volumeLabel.Value = sounds.VolumeLabel;
        _volumeValue.Value = sounds.VolumeValueText;
        _volumeSlider.Value = sounds.VolumePercent;
        _volumeSlider.IsEnabled = sounds.VolumeEnabled;
        AutomationProperties.SetName(_volumeSlider, sounds.VolumeAutomationName);
    }

    private static void ApplyToggle(TsToggle toggle, NotificationToggleRow row)
    {
        toggle.Header = row.Label;
        toggle.IsOn = row.IsOn;
        AutomationProperties.SetName(toggle, row.AutomationName);
    }

    // web TONE_PROFILES first-note frequency per channel — a short device cue stands in for the WebAudio synth.
    private static uint CategoryFrequency(NotificationSoundCategory category) => category switch
    {
        NotificationSoundCategory.CriticalAlert => 988,
        NotificationSoundCategory.WarningAlert => 880,
        NotificationSoundCategory.InfoAlert => 784,
        NotificationSoundCategory.ChargeComplete => 523,
        NotificationSoundCategory.DriveComplete => 659,
        NotificationSoundCategory.AutomationRun => 587,
        _ => 523,
    };

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool Beep(uint dwFreq, uint dwDuration);
}
