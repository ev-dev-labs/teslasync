using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 Job Progress drawer — a parity port of
/// web/src/components/feedback/JobProgressDrawer.tsx. A floating, minimizable surface that surfaces
/// in-flight + recently-finished export jobs. It reproduces the web component's three chrome states —
/// hidden (nothing to surface), a minimized active-count chip, and the open panel (header with the title,
/// active pill, freshness chip, refresh/minimize/dismiss actions, wrapping an "In progress" and a "Recent"
/// section of job rows with per-row status icon, format, status/size line, error message and a download
/// affordance for finished jobs). The loading line shows before the first resolve; an empty resolve shows
/// the sections' friendly empty labels; stale/offline cached reads keep the rows visible and flag the
/// header chip; a failed load enables the refresh (retry) affordance. All data flows through the shared
/// <see cref="JobProgressDrawerViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name. The drawer chrome state is
/// persisted through an <see cref="IJobDrawerStateStore"/> (the app binds a LocalSettings-backed store).
/// </summary>
public sealed partial class JobProgressDrawer : ContentControl, IDisposable
{
    private const string HeaderGlyph = "\uE896";   // Segoe Fluent — Download (the export theme glyph)
    private const string DownloadGlyph = "\uE896"; // Download
    private const string RefreshGlyph = "\uE72C";  // Refresh
    private const string MinimizeGlyph = "\uE921"; // ChromeMinimize
    private const string DismissGlyph = "\uE711";  // Cancel
    private const string FailedGlyph = "\uE740";   // FullScreen (web Maximize2 on a failed row)

    private readonly JobProgressDrawerViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly JobProgressDrawerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly TextBlock _titleText = new();
    private readonly TsBadge _pill = new() { Status = StatusKind.Info };
    private readonly TsDataFreshness _freshness = new();
    private readonly TsButton _refresh = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = RefreshGlyph };
    private readonly TsButton _minimize = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = MinimizeGlyph };
    private readonly TsButton _dismiss = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = DismissGlyph };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, persistence store and diagnostics.</summary>
    public JobProgressDrawer(
        IJobProgressDrawerSource source,
        ILocalizer localizer,
        IJobDrawerStateStore? stateStore = null,
        int maxRecent = JobProgressDrawerRegistration.DefaultMaxRecent,
        JobProgressDrawerDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new JobProgressDrawerDiagnostics();
        _viewModel = new JobProgressDrawerViewModel(source, localizer, stateStore, maxRecent, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Right;
        VerticalAlignment = VerticalAlignment.Bottom;
        HorizontalContentAlignment = HorizontalAlignment.Right;
        VerticalContentAlignment = VerticalAlignment.Bottom;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="JobProgressDrawerSource"/> from the
    /// shared data layer plus a durable LocalSettings-backed chrome-state store.
    /// </summary>
    public static JobProgressDrawer Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        int maxRecent = JobProgressDrawerRegistration.DefaultMaxRecent,
        JobProgressDrawerDiagnostics? diagnostics = null)
    {
        var source = new JobProgressDrawerSource(api, engine, options);
        return new JobProgressDrawer(source, localizer, new LocalSettingsJobDrawerStateStore(), maxRecent, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.FontSize = 12;
        _titleText.FontWeight = FontWeights.SemiBold;
        _titleText.Foreground = DisplayTokens.TextPrimary;
        _titleText.VerticalAlignment = VerticalAlignment.Center;
        _titleText.TextTrimming = TextTrimming.CharacterEllipsis;

        _pill.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetAccessibilityView(_pill, AccessibilityView.Raw);

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(icon);
        titleRow.Children.Add(_titleText);
        titleRow.Children.Add(_pill);

        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
        ToolTipService.SetToolTip(_refresh, _viewModel.RefreshLabel);
        _refresh.Click += OnRefreshClick;

        AutomationProperties.SetName(_minimize, _viewModel.MinimizeLabel);
        ToolTipService.SetToolTip(_minimize, _viewModel.MinimizeLabel);
        _minimize.Click += OnMinimizeClick;

        AutomationProperties.SetName(_dismiss, _viewModel.DismissLabel);
        ToolTipService.SetToolTip(_dismiss, _viewModel.DismissLabel);
        _dismiss.Click += OnDismissClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);
        actions.Children.Add(_minimize);
        actions.Children.Add(_dismiss);

        var header = new Grid { Padding = new Thickness(12, 8, 8, 8) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(titleRow);
        header.Children.Add(actions);
        header.BorderBrush = DisplayTokens.Border;
        header.BorderThickness = new Thickness(0, 0, 0, 1);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(8);
        _bodyHost.MaxHeight = 420;

        var panel = new Grid();
        panel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        panel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetRow(header, 0);
        Grid.SetRow(_bodyHost, 1);
        panel.Children.Add(header);
        panel.Children.Add(_bodyHost);

        _root.Width = 360;
        _root.Margin = new Thickness(16);
        _root.Background = DisplayTokens.Surface;
        _root.BorderBrush = DisplayTokens.Border;
        _root.BorderThickness = new Thickness(1);
        _root.CornerRadius = new CornerRadius(12);
        _root.Child = panel;
        _root.KeyDown += OnRootKeyDown;
        AutomationProperties.SetName(_root, _viewModel.RegionLabel);
        AutomationProperties.SetLandmarkType(_root, AutomationLandmarkType.Custom);
    }

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

    private void OnMinimizeClick(object sender, RoutedEventArgs e) => _viewModel.Minimize();

    private void OnDismissClick(object sender, RoutedEventArgs e) => _viewModel.Dismiss();

    private void OnExpandClick(object sender, RoutedEventArgs e) => _viewModel.Expand();

    private void OnRootKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Escape)
        {
            _viewModel.Minimize();
            e.Handled = true;
        }
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

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
        if (!_viewModel.IsVisible)
        {
            Visibility = Visibility.Collapsed;
            Content = null;
            return;
        }

        Visibility = Visibility.Visible;

        if (_viewModel.Presentation == JobDrawerPresentation.Minimized)
        {
            Content = BuildMinimizedChip();
            return;
        }

        UpdateHeader();
        _bodyHost.Content = BuildBody();
        Content = _root;
    }

    private void UpdateHeader()
    {
        _titleText.Text = _viewModel.Title;

        bool hasActive = _viewModel.Display.HasActive;
        _pill.Content = _viewModel.Display.ActivePillText;
        _pill.Visibility = hasActive ? Visibility.Visible : Visibility.Collapsed;

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private TsButton BuildMinimizedChip()
    {
        var display = _viewModel.Display;
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        if (display.MinimizedShowSpinner)
        {
            content.Children.Add(new ProgressRing { IsActive = true, Width = 14, Height = 14, VerticalAlignment = VerticalAlignment.Center });
        }
        else
        {
            content.Children.Add(new FontIcon { Glyph = HeaderGlyph, FontSize = 14, Foreground = DisplayTokens.Accent, VerticalAlignment = VerticalAlignment.Center });
        }

        content.Children.Add(new TextBlock { Text = display.MinimizedText, FontSize = 12, VerticalAlignment = VerticalAlignment.Center });

        var chip = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = content,
            Margin = new Thickness(16),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        chip.Click += OnExpandClick;
        AutomationProperties.SetName(chip, _viewModel.ExpandLabel);
        ToolTipService.SetToolTip(chip, _viewModel.ExpandLabel);
        return chip;
    }

    private StackPanel BuildBody()
    {
        if (_viewModel.State == JobProgressState.Loading)
        {
            return BuildLoading();
        }

        var display = _viewModel.Display;
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(BuildSection(display.ActiveSection));
        column.Children.Add(BuildSection(display.RecentSection));
        return column;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Padding = new Thickness(8, 16, 8, 16) };
        var text = new TextBlock
        {
            Text = _viewModel.LoadingText,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        column.Children.Add(text);
        AutomationProperties.SetName(column, _viewModel.LoadingText);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private StackPanel BuildSection(JobDrawerSection section)
    {
        var column = new StackPanel { Spacing = 2 };

        var heading = new TextBlock
        {
            Text = section.Heading.ToUpper(System.Globalization.CultureInfo.CurrentCulture),
            FontSize = 10,
            FontWeight = FontWeights.SemiBold,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
            Margin = new Thickness(4, 4, 4, 2),
        };
        AutomationProperties.SetAccessibilityView(heading, AccessibilityView.Raw);
        column.Children.Add(heading);

        if (section.IsEmpty)
        {
            var empty = new TextBlock
            {
                Text = section.EmptyLabel,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                Margin = new Thickness(4, 2, 4, 4),
            };
            AutomationProperties.SetName(empty, section.EmptyLabel);
            column.Children.Add(empty);
            return column;
        }

        foreach (var row in section.Rows)
        {
            column.Children.Add(BuildRow(row));
        }

        return column;
    }

    private Border BuildRow(JobRowDisplay row)
    {
        var grid = new Grid { ColumnSpacing = 8, MinHeight = 44, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var statusIcon = BuildStatusIcon(row);
        statusIcon.VerticalAlignment = VerticalAlignment.Top;
        statusIcon.Margin = new Thickness(0, 2, 0, 0);
        Grid.SetColumn(statusIcon, 0);
        grid.Children.Add(statusIcon);

        var details = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        titleRow.Children.Add(new TextBlock
        {
            Text = row.TypeLabel,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        });
        if (!string.IsNullOrEmpty(row.FormatText))
        {
            titleRow.Children.Add(new TextBlock
            {
                Text = row.FormatText,
                FontSize = 10,
                CharacterSpacing = 60,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        details.Children.Add(titleRow);
        details.Children.Add(new TextBlock
        {
            Text = row.DetailLine,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });

        if (row.HasError)
        {
            details.Children.Add(new TextBlock
            {
                Text = row.ErrorMessage,
                FontSize = 11,
                Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        Grid.SetColumn(details, 1);
        grid.Children.Add(details);

        var trailing = BuildTrailing(row);
        Grid.SetColumn(trailing, 2);
        grid.Children.Add(trailing);

        var container = new Border
        {
            Child = grid,
            Padding = new Thickness(6, 6, 6, 6),
            CornerRadius = new CornerRadius(6),
        };
        AutomationProperties.SetName(container, row.AutomationName);
        return container;
    }

    private static FrameworkElement BuildStatusIcon(JobRowDisplay row)
    {
        if (row.StatusGlyphSpins)
        {
            var ring = new ProgressRing { IsActive = true, Width = 14, Height = 14 };
            AutomationProperties.SetAccessibilityView(ring, AccessibilityView.Raw);
            return ring;
        }

        var icon = new FontIcon
        {
            Glyph = row.StatusGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(row.StatusBadge)),
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private FrameworkElement BuildTrailing(JobRowDisplay row)
    {
        if (row.ShowDownload && row.DownloadUri is { } uri)
        {
            var button = new HyperlinkButton
            {
                NavigateUri = uri,
                Content = new FontIcon { Glyph = DownloadGlyph, FontSize = 14 },
                MinWidth = 40,
                MinHeight = 40,
                Padding = new Thickness(8),
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(button, _viewModel.DownloadLabel);
            ToolTipService.SetToolTip(button, _viewModel.DownloadLabel);
            return button;
        }

        if (row.ShowFailedGlyph)
        {
            var icon = new FontIcon
            {
                Glyph = FailedGlyph,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            return icon;
        }

        var spacer = new Border { Width = 1, Height = 1 };
        AutomationProperties.SetAccessibilityView(spacer, AccessibilityView.Raw);
        return spacer;
    }

    /// <summary>
    /// A durable <see cref="IJobDrawerStateStore"/> backed by the packaged app's
    /// <c>ApplicationData.LocalSettings</c> (the native analogue of the web localStorage key). Best-effort:
    /// an unpackaged / identity-less context (or any read/write fault) falls back to the minimized default
    /// and silently no-ops, mirroring the web component's try/catch around localStorage.
    /// </summary>
    private sealed class LocalSettingsJobDrawerStateStore : IJobDrawerStateStore
    {
        public JobDrawerPresentation Load()
        {
            try
            {
                var values = Windows.Storage.ApplicationData.Current.LocalSettings.Values;
                if (values.TryGetValue(JobProgressDrawerRegistration.StorageKey, out object? raw) && raw is string s)
                {
                    return s switch
                    {
                        "open" => JobDrawerPresentation.Open,
                        "dismissed" => JobDrawerPresentation.Dismissed,
                        _ => JobDrawerPresentation.Minimized,
                    };
                }
            }
            catch (Exception ex) when (ex is InvalidOperationException or UnauthorizedAccessException)
            {
                // No packaged identity / settings unavailable — fall back to the default.
            }

            return JobDrawerPresentation.Minimized;
        }

        public void Save(JobDrawerPresentation presentation)
        {
            try
            {
                Windows.Storage.ApplicationData.Current.LocalSettings.Values[JobProgressDrawerRegistration.StorageKey] = presentation switch
                {
                    JobDrawerPresentation.Open => "open",
                    JobDrawerPresentation.Dismissed => "dismissed",
                    _ => "minimized",
                };
            }
            catch (Exception ex) when (ex is InvalidOperationException or UnauthorizedAccessException)
            {
                // Best-effort persistence — ignore when no packaged settings store is available.
            }
        }
    }
}
