using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 IncidentsCard surface — a parity port of
/// web/src/features/system/components/status/IncidentsCard.tsx. It composes the web component's amber-ringed glass
/// card: the header (alert glyph, "Active incidents" title, the active-count badge and the "Log incident"
/// affordance) and the active-incident list, where every row carries the severity glyph, the title, the status
/// badge, the severity label, the optional affected-components line and the relative "Started …" meta line, and
/// activates the post-mortem timeline. The list flows through the cache-then-network
/// <see cref="IncidentsCardViewModel"/>, so the surface renders every state the P2 contract requires — a skeleton
/// while loading, a retry surface on a hard failure, a friendly empty surface when nothing is active (the web
/// collapses here), and a freshness chip (stale / offline) otherwise. The view never performs HTTP; every string
/// resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class IncidentsCard : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string AddGlyph = "\uE710";      // Segoe Fluent — Add (web Lucide Plus)
    private const string ChevronGlyph = "\uE76C";  // Segoe Fluent — ChevronRight
    private const double PanelPadding = 16;         // web p-3 + the row inset

    private readonly IncidentsCardViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly IncidentsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsGlassPanel _panel = new() { Padding = new Thickness(PanelPadding) };
    private readonly StackPanel _root = new() { Spacing = 12 };

    // Header.
    private readonly FontIcon _icon = new() { FontSize = 16, VerticalAlignment = VerticalAlignment.Center };
    private readonly PanelTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _countBadge = new() { Status = StatusKind.Warning, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _countBadgeText = new() { FontSize = 12 };
    private readonly StackPanel _headerActions = new() { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = 12 };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = RefreshGlyph, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _logButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = AddGlyph, VerticalAlignment = VerticalAlignment.Center };

    // Body.
    private readonly StackPanel _body = new() { Spacing = 8 };
    private readonly StackPanel _loading = new() { Spacing = 8 };
    private readonly TsQueryError _error = new();
    private readonly TsEmptyState _empty = new();
    private readonly StackPanel _list = new() { Spacing = 6 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over the shared incidents seam, the i18n facade and optional diagnostics.</summary>
    /// <param name="source">The active-incidents cache-then-network source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public IncidentsCard(IIncidentsSource source, ILocalizer localizer, IncidentsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new IncidentsDiagnostics();
        _viewModel = new IncidentsCardViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when an incident row is activated; carries the incident id to open the timeline.</summary>
    public event EventHandler<long>? IncidentActivated;

    /// <summary>Raised when the "Log incident" affordance is invoked so the host can open the incident form.</summary>
    public event EventHandler? LogIncidentRequested;

    /// <summary>The diagnostics surface slug this view registers under (<c>IncidentsCard</c>).</summary>
    public static string Slug => IncidentsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public IncidentsCardViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="IncidentsSource"/> from the shared data
    /// layer over the generated contract client and the cache-then-network engine.
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The cache-then-network engine.</param>
    /// <param name="options">The API client options (JSON settings).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public static IncidentsCard Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        IncidentsDiagnostics? diagnostics = null)
    {
        var source = new IncidentsSource(api, engine, options);
        return new IncidentsCard(source, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        _icon.Foreground = DisplayTokens.Brush("TsColorWarningBrush");

        var headerLeft = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        headerLeft.Children.Add(_icon);
        headerLeft.Children.Add(_title);
        _countBadge.Content = _countBadgeText;
        headerLeft.Children.Add(_countBadge);

        _refreshButton.Click += OnRefreshClick;
        _logButton.Click += OnLogClick;
        _freshnessChip.Content = _freshnessChipText;
        _headerActions.Children.Add(_freshnessChip);
        _headerActions.Children.Add(_freshness);
        _headerActions.Children.Add(_refreshButton);
        _headerActions.Children.Add(_logButton);

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(headerLeft, 0);
        Grid.SetColumn(_headerActions, 1);
        header.Children.Add(headerLeft);
        header.Children.Add(_headerActions);

        for (int i = 0; i < 2; i++)
        {
            _loading.Children.Add(new TsSkeleton { BlockHeight = 60 });
        }

        _error.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();

        _body.Children.Add(_loading);
        _body.Children.Add(_error);
        _body.Children.Add(_empty);
        _body.Children.Add(_list);
        LiveRegion.Configure(_body);

        _root.Children.Add(header);
        _root.Children.Add(_body);

        _panel.Content = _root;
        Content = _panel;
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

    private void OnLogClick(object sender, RoutedEventArgs e) => LogIncidentRequested?.Invoke(this, EventArgs.Empty);

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

        RenderHeader(display);
        RenderBody(display, state);
    }

    private void RenderHeader(IncidentsDisplay display)
    {
        _icon.Glyph = display.HeaderGlyph;
        _title.Value = display.Title;

        _countBadgeText.Text = display.Count.ToString(System.Globalization.CultureInfo.CurrentCulture);
        _countBadge.Visibility = display.ShowCount ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_countBadge, display.AutomationName);

        _logButton.Text = display.LogIncidentText;
        AutomationProperties.SetName(_logButton, display.LogIncidentText);
        AutomationProperties.SetName(
            _refreshButton,
            _localizer.GetString(IncidentsStrings.Refresh, "Refresh incidents"));
    }

    private void RenderBody(IncidentsDisplay display, IncidentsState state)
    {
        bool loading = state == IncidentsState.Loading;
        bool error = state == IncidentsState.Error;
        bool empty = state == IncidentsState.Empty;
        bool hasList = state is IncidentsState.Loaded or IncidentsState.Stale or IncidentsState.Offline;

        _loading.Visibility = loading ? Visibility.Visible : Visibility.Collapsed;
        _error.Visibility = error ? Visibility.Visible : Visibility.Collapsed;
        _empty.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;
        _list.Visibility = hasList ? Visibility.Visible : Visibility.Collapsed;
        _headerActions.Visibility = loading || error ? Visibility.Collapsed : Visibility.Visible;

        // The web card always carries an amber ring; tint the panel only while incidents are present.
        _panel.BorderBrush = hasList
            ? DisplayTokens.Brush("TsColorWarningBrush")
            : DisplayTokens.Border;

        if (error)
        {
            _error.Title = _localizer.GetString(IncidentsStrings.ErrorTitle, "Couldn't load incidents");
            _error.Message = _viewModel.ErrorMessage
                ?? _localizer.GetString(IncidentsStrings.ErrorLoad, "Couldn't load active incidents");
            _error.ActionText = _localizer.GetString(IncidentsStrings.Retry, "Retry");
            _error.AttemptCount = _viewModel.Attempts;
            return;
        }

        if (empty)
        {
            _empty.Title = display.EmptyTitle;
            _empty.Message = display.EmptyMessage;
            return;
        }

        RenderFreshness(state);

        if (hasList)
        {
            RenderRows(display.Incidents);
        }
    }

    private void RenderFreshness(IncidentsState state)
    {
        bool stale = state == IncidentsState.Stale;
        bool offline = state == IncidentsState.Offline;

        if (stale || offline)
        {
            string text = offline
                ? _localizer.GetString(IncidentsStrings.OfflineChip, "Offline")
                : _localizer.GetString(IncidentsStrings.StaleChip, "Stale");
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
    }

    private void RenderRows(IReadOnlyList<IncidentRow> rows)
    {
        _list.Children.Clear();
        foreach (var row in rows)
        {
            _list.Children.Add(BuildRow(row));
        }
    }

    private TsButton BuildRow(IncidentRow row)
    {
        var glyph = new FontIcon
        {
            Glyph = row.SeverityGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(row.SeverityStatus)),
            VerticalAlignment = VerticalAlignment.Top,
        };

        var titleText = new TextBlock
        {
            Text = row.Title,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var statusBadge = new TsBadge { Status = row.StatusStatus, VerticalAlignment = VerticalAlignment.Center };
        statusBadge.Content = new TextBlock { Text = row.StatusText, FontSize = 12 };

        var severityLabel = new TextBlock
        {
            Text = row.SeverityLabel,
            FontSize = 12,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(row.SeverityStatus)),
            VerticalAlignment = VerticalAlignment.Center,
        };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(titleText);
        titleRow.Children.Add(statusBadge);
        titleRow.Children.Add(severityLabel);

        var info = new StackPanel { Spacing = 2 };
        info.Children.Add(titleRow);
        if (row.HasAffects)
        {
            info.Children.Add(new Caption { Value = row.AffectsText });
        }

        info.Children.Add(new Caption { Value = row.MetaText });

        var chevron = new FontIcon
        {
            Glyph = ChevronGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(glyph, 0);
        Grid.SetColumn(info, 1);
        Grid.SetColumn(chevron, 2);
        grid.Children.Add(glyph);
        grid.Children.Add(info);
        grid.Children.Add(chevron);

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(8),
            Content = grid,
        };
        AutomationProperties.SetName(button, $"{row.AutomationName}. {row.OpenLabel}");
        ToolTipService.SetToolTip(button, row.OpenLabel);
        long id = row.Id;
        button.Click += (_, _) => IncidentActivated?.Invoke(this, id);
        return button;
    }
}
