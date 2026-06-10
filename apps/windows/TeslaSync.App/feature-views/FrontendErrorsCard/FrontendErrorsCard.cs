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
/// The native WinUI 3 frontend-errors surface — a parity port of
/// web/src/features/system/components/status/FrontendErrorsCard.tsx. It composes the web card inside a single
/// <c>GlassPanel</c>: a header (Bug glyph + title), the rolling-hour total with its descriptive caption, and a
/// "top error sources" section that renders one row per offender (a neutral name badge, the route and the
/// count) or the "No frontend errors reported in the last hour." copy when the list is empty. Every state
/// renders — loading skeleton, populated card, the friendly "Unable to load" empty surface, an explicit
/// retry surface on hard failure, plus stale and offline freshness branches surfaced through the data-freshness
/// chip and an offline badge. All data flows through the shared <see cref="FrontendErrorsViewModel"/>; the view
/// never performs HTTP. Every string resolves through the i18n facade, each region carries a Narrator name, and
/// state changes are announced through a polite live region. The surface adds no custom motion, so
/// reduced-motion is honoured by construction.
/// </summary>
public sealed partial class FrontendErrorsCard : ContentControl, IDisposable
{
    private readonly FrontendErrorsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly FrontendErrorsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly StackPanel _statusRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };
    private readonly ContentControl _bodyHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsQueryError _queryError = new();
    private readonly Caption _statusLine = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announced;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    /// <param name="source">The cache-then-network data port (P1/S8 state-holder seam).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FrontendErrorsCard(
        IFrontendErrorsSource source,
        ILocalizer localizer,
        FrontendErrorsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new FrontendErrorsDiagnostics();
        _viewModel = new FrontendErrorsViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.SurfaceTitle);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _queryError.ActionInvoked += OnRetryInvoked;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>FrontendErrorsCard</c>).</summary>
    public static string Slug => FrontendErrorsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public FrontendErrorsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="FrontendErrorsSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static FrontendErrorsCard Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        FrontendErrorsDiagnostics? diagnostics = null)
    {
        var source = new FrontendErrorsSource(api, engine, options);
        return new FrontendErrorsCard(source, localizer, diagnostics);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _queryError.ActionInvoked -= OnRetryInvoked;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void BuildChrome()
    {
        _statusLine.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_statusLine);

        _root.Children.Add(_statusRow);
        _root.Children.Add(_bodyHost);
        _root.Children.Add(_statusLine);
        Content = _root;
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

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

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
        BuildStatusRow();

        _bodyHost.Content = _viewModel.State switch
        {
            FrontendErrorsState.Loading => BuildLoadingScaffold(),
            FrontendErrorsState.Error => BuildErrorBody(),
            FrontendErrorsState.Empty => BuildEmptyBody(),
            _ => BuildContent(_viewModel.Display),
        };

        UpdateStatusLine();
        AutomationProperties.SetName(this, _viewModel.SurfaceTitle);
    }

    // ── Status row: offline chip + freshness ───────────────────────────────────────────────────────────
    private void BuildStatusRow()
    {
        _statusRow.Children.Clear();

        if (_viewModel.State == FrontendErrorsState.Offline)
        {
            _statusRow.Children.Add(BuildBadge(_viewModel.OfflineLabel, StatusKind.Danger));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _statusRow.Children.Add(_freshness);
    }

    private void UpdateStatusLine()
    {
        string? message = _viewModel.StatusAnnouncement;
        if (string.IsNullOrEmpty(message))
        {
            _statusLine.Visibility = Visibility.Collapsed;
            _announced = null;
            return;
        }

        _statusLine.Value = message;
        _statusLine.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_statusLine, message);

        if (!string.Equals(_announced, message, StringComparison.Ordinal))
        {
            _announced = message;
            LiveRegion.Announce(_statusLine);
        }
    }

    // ── Error (web `!data` → QueryError with retry) ──────────────────────────────────────────────────────
    private TsQueryError BuildErrorBody()
    {
        _queryError.Message = _viewModel.ErrorMessage ?? _viewModel.ErrorMessageDefault;
        _queryError.ActionText = _viewModel.RetryLabel;
        _queryError.AttemptCount = _viewModel.Attempts;
        return _queryError;
    }

    // ── Whole-surface empty (no usable summary envelope; web `!data`) ──────────────────────────────────
    private TsEmptyState BuildEmptyBody() => new()
    {
        IconGlyph = FrontendErrorsRegistration.TitleGlyph,
        Message = _viewModel.EmptyText,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Loading: skeleton chrome inside the panel (web two `Skeleton h-6` bars) ────────────────────────
    private static TsGlassPanel BuildLoadingScaffold()
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new TsSkeleton { BlockHeight = 16, Width = 160, HorizontalAlignment = HorizontalAlignment.Left });
        column.Children.Add(new TsSkeleton { BlockHeight = 28, Width = 96, HorizontalAlignment = HorizontalAlignment.Left });
        column.Children.Add(new TsSkeleton { BlockHeight = 24 });
        column.Children.Add(new TsSkeleton { BlockHeight = 24 });
        return new TsGlassPanel { Padding = new Thickness(20), Content = column };
    }

    // ── Loaded / Stale / Offline: the full card composition ────────────────────────────────────────────
    private TsGlassPanel BuildContent(FrontendErrorsDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(BuildTotalBlock(display));
        stack.Children.Add(BuildOffenders(display));

        var panel = new TsGlassPanel { Padding = new Thickness(20), Content = stack };
        AutomationProperties.SetName(panel, _viewModel.SurfaceTitle);
        return panel;
    }

    private StackPanel BuildHeader()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new FontIcon
        {
            Glyph = FrontendErrorsRegistration.TitleGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Danger)),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new SectionTitle { Value = _viewModel.SurfaceTitle, VerticalAlignment = VerticalAlignment.Center });
        AutomationProperties.SetName(row, _viewModel.SurfaceTitle);
        return row;
    }

    private StackPanel BuildTotalBlock(FrontendErrorsDisplay display)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(new MetricLabel { Value = _viewModel.TotalLabel });
        stack.Children.Add(new MetricValue { Value = display.TotalText });
        stack.Children.Add(new Caption
        {
            Value = _viewModel.Subtitle,
            MaxWidth = 560,
            HorizontalAlignment = HorizontalAlignment.Left,
        });

        AutomationProperties.SetName(
            stack,
            string.Format(System.Globalization.CultureInfo.CurrentCulture, "{0}: {1}", _viewModel.TotalLabel, display.TotalText));
        return stack;
    }

    private StackPanel BuildOffenders(FrontendErrorsDisplay display)
    {
        var section = new StackPanel { Spacing = 8 };
        section.Children.Add(new Label { Value = _viewModel.TopOffendersLabel });

        if (display.HasOffenders)
        {
            var list = new StackPanel { Spacing = 6 };
            foreach (var offender in display.Offenders)
            {
                list.Children.Add(BuildOffenderRow(offender));
            }

            AutomationProperties.SetName(list, _viewModel.TopOffendersLabel);
            section.Children.Add(list);
        }
        else
        {
            section.Children.Add(new Caption
            {
                Value = _viewModel.NoErrorsText,
                HorizontalAlignment = HorizontalAlignment.Left,
            });
        }

        return section;
    }

    private static Grid BuildOffenderRow(FrontendErrorOffenderDisplay offender)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var badge = BuildBadge(offender.Name, StatusKind.Neutral);
        badge.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(badge, 0);

        var route = new TextBlock
        {
            Text = offender.Route,
            FontSize = 12,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info)),
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(route, 1);

        var count = new TextBlock
        {
            Text = offender.CountText,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.NoWrap,
        };
        Grid.SetColumn(count, 2);

        grid.Children.Add(badge);
        grid.Children.Add(route);
        grid.Children.Add(count);

        AutomationProperties.SetName(grid, offender.AutomationName);
        return grid;
    }

    private static TsBadge BuildBadge(string text, StatusKind status)
    {
        var badge = new TsBadge { Status = status, Content = text };
        AutomationProperties.SetName(badge, text);
        return badge;
    }
}
