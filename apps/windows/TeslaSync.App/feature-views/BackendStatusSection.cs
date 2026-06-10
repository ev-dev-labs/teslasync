using System.Collections.Generic;
using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 backend-status surface — a parity port of
/// web/src/features/system/components/status/BackendStatusSection.tsx. It composes the web's
/// <c>AccordionSection</c>: a disclosure header (a backend glyph, the "Backend Status" title + description and
/// an "{ok}/{total} healthy" count badge) above a body that reproduces the web's three sub-sections — a
/// Component Health table (status glyph + tone, component name, latency, failure count coloured red when
/// non-zero, and the formatted last-check time), a Database Connection Pool grid of five
/// <c>StatCard</c>s (Max Open / Open / In Use / Idle / Wait Count) and a System Runtime key/value list (Go
/// Version, Uptime, Goroutines, OS / Arch). Every state renders — a loading skeleton, the populated body,
/// a friendly empty surface, an explicit retry surface on hard failure, plus stale and offline freshness
/// chips — and each sub-section renders its own empty surface rather than collapsing. All data flows through
/// the shared <see cref="BackendStatusViewModel"/>; the view never performs HTTP. Every string resolves
/// through the i18n facade and every interactive / data element carries a Narrator name.
/// </summary>
public sealed partial class BackendStatusSection : ContentControl, IDisposable
{
    private const string HeaderGlyph = "\uEC4A";  // Segoe Fluent — Processor (backend/runtime)
    private const string DatabaseGlyph = "\uE9F5"; // StorageOptical
    private const string ActivityGlyph = "\uE9D9"; // Speed (activity)
    private const string ClockGlyph = "\uE823";    // Clock / Recent
    private const string GaugeGlyph = "\uF246";     // Speed gauge

    private const double StatusColumnWidth = 150;
    private const double LatencyColumnWidth = 116;
    private const double FailuresColumnWidth = 96;
    private const double LastCheckColumnWidth = 188;

    private readonly BackendStatusViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BackendStatusDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    public BackendStatusSection(
        IBackendStatusSource source,
        ILocalizer localizer,
        BackendStatusDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BackendStatusDiagnostics();
        _viewModel = new BackendStatusViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, BackendStatusRegistration.Title(localizer));

        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>backend-status-section</c>).</summary>
    public static string SurfaceId => BackendStatusRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public BackendStatusViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BackendStatusSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static BackendStatusSection Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        BackendStatusDiagnostics? diagnostics = null)
    {
        var source = new BackendStatusSource(api, engine, options);
        return new BackendStatusSection(source, localizer, diagnostics);
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
        _root.Children.Clear();

        var accordion = new TsAccordion
        {
            Header = BuildHeader(),
            Content = BuildBody(),
            IsExpanded = true, // web: defaultOpen
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(accordion, _viewModel.Title);
        _root.Children.Add(accordion);
    }

    // ── Header ───────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildHeader()
    {
        var iconChip = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            Width = 40,
            Height = 40,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = HeaderGlyph,
                FontSize = 18,
                Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info)),
            },
        };
        AutomationProperties.SetAccessibilityView(iconChip, AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = _viewModel.Title,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        var description = new TextBlock
        {
            Text = _viewModel.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        var texts = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        texts.Children.Add(title);
        texts.Children.Add(description);

        var trailing = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        if (_viewModel.Display.HasBadge)
        {
            var badge = new TsBadge
            {
                Status = _viewModel.Display.BadgeStatus,
                Content = new TextBlock { Text = _viewModel.Display.BadgeText, FontSize = 12 },
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(badge, _viewModel.Display.BadgeText);
            trailing.Children.Add(badge);
        }

        trailing.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var header = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(iconChip, 0);
        Grid.SetColumn(texts, 1);
        Grid.SetColumn(trailing, 2);
        header.Children.Add(iconChip);
        header.Children.Add(texts);
        header.Children.Add(trailing);
        return header;
    }

    // ── Body ─────────────────────────────────────────────────────────────────────────────────────────

    private UIElement BuildBody() => _viewModel.State switch
    {
        BackendStatusSectionState.Loading => BuildLoading(),
        BackendStatusSectionState.Error => BuildError(),
        BackendStatusSectionState.Empty => BuildEmpty(),
        _ => BuildContent(),
    };

    private StackPanel BuildContent()
    {
        var column = new StackPanel { Spacing = 24, Padding = new Thickness(0, 8, 0, 0) };
        column.Children.Add(BuildComponentSection());
        column.Children.Add(BuildPoolSection());
        column.Children.Add(BuildRuntimeSection());
        return column;
    }

    private StackPanel BuildComponentSection()
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(new SectionTitle { Value = _viewModel.ComponentHealthTitle });
        section.Children.Add(_viewModel.Display.HasComponents
            ? BuildComponentsTable()
            : BuildInlineEmpty(_viewModel.NoComponentsMessage));
        return section;
    }

    private StackPanel BuildComponentsTable()
    {
        var columns = new[]
        {
            new ColumnSpec(_viewModel.StatusHeader, new GridLength(StatusColumnWidth)),
            new ColumnSpec(_viewModel.ComponentHeader, new GridLength(1, GridUnitType.Star)),
            new ColumnSpec(_viewModel.LatencyHeader, new GridLength(LatencyColumnWidth)),
            new ColumnSpec(_viewModel.FailuresHeader, new GridLength(FailuresColumnWidth)),
            new ColumnSpec(_viewModel.LastCheckHeader, new GridLength(LastCheckColumnWidth)),
        };

        var table = NewTable(columns);
        foreach (var row in _viewModel.Display.ComponentRows)
        {
            var statusBrush = DisplayTokens.Brush(StatusResources.AccentBrushKey(row.StatusKind));

            var statusCell = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                VerticalAlignment = VerticalAlignment.Center,
            };
            statusCell.Children.Add(new FontIcon { Glyph = row.StatusGlyph, FontSize = 14, Foreground = statusBrush });
            statusCell.Children.Add(new TextBlock
            {
                Text = row.StatusText,
                FontSize = 12,
                Foreground = statusBrush,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });

            var name = new TextBlock
            {
                Text = row.Name,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = DisplayTokens.TextPrimary,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };

            var latency = TextCell(row.LatencyText, DisplayTokens.TextSecondary);
            var failures = TextCell(
                row.FailuresText,
                row.HasFailures ? DisplayTokens.Brush("TsColorDangerBrush") : DisplayTokens.TextSecondary);
            var lastCheck = TextCell(row.LastCheckText, DisplayTokens.TextSecondary);

            table.Children.Add(BuildRow(
                columns,
                new UIElement[] { statusCell, name, latency, failures, lastCheck },
                row.AutomationName));
        }

        return table;
    }

    private StackPanel BuildPoolSection()
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(new SectionTitle { Value = _viewModel.DatabasePoolTitle });
        section.Children.Add(_viewModel.Display.Pool.Present
            ? BuildPoolCards(_viewModel.Display.Pool)
            : BuildInlineEmpty(_viewModel.NoPoolMessage));
        return section;
    }

    private Grid BuildPoolCards(ConnectionPoolDisplay pool)
    {
        var cards = new[]
        {
            BuildStatCard(_viewModel.MaxOpenLabel, pool.MaxOpenText, DatabaseGlyph),
            BuildStatCard(_viewModel.OpenLabel, pool.OpenText, DatabaseGlyph),
            BuildStatCard(_viewModel.InUseLabel, pool.InUseText, ActivityGlyph),
            BuildStatCard(_viewModel.IdleLabel, pool.IdleText, ClockGlyph),
            BuildStatCard(_viewModel.WaitCountLabel, pool.WaitCountText, GaugeGlyph),
        };

        var grid = new Grid { ColumnSpacing = 12 };
        for (int i = 0; i < cards.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(cards[i], i);
            grid.Children.Add(cards[i]);
        }

        return grid;
    }

    private StackPanel BuildRuntimeSection()
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(new SectionTitle { Value = _viewModel.SystemRuntimeTitle });

        if (_viewModel.Display.Runtime.Present)
        {
            section.Children.Add(new TsKVList
            {
                Items = _viewModel.Display.Runtime.Items
                    .Select(item => new TsKeyValue(item.Label, item.Value))
                    .ToList(),
            });
        }
        else
        {
            section.Children.Add(BuildInlineEmpty(_viewModel.NoRuntimeMessage));
        }

        return section;
    }

    // ── State surfaces ───────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 10, Padding = new Thickness(0, 8, 0, 8) };
        column.Children.Add(new TsSkeleton { BlockHeight = 28 });
        for (int i = 0; i < 5; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 20 });
        }

        column.Children.Add(new TsSkeleton { BlockHeight = 72 });
        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorMessageDefault,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Border BuildInlineEmpty(string message)
    {
        var text = new TextBlock
        {
            Text = message,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };

        var border = new Border
        {
            Child = text,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(16),
            MinHeight = 64,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(border, message);
        return border;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Stat card ────────────────────────────────────────────────────────────────────────────────────

    private static TsStatCard BuildStatCard(string label, string value, string glyph) => new()
    {
        Label = label,
        Value = value,
        Glyph = glyph,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    // ── Table primitives ─────────────────────────────────────────────────────────────────────────────

    private static StackPanel NewTable(IReadOnlyList<ColumnSpec> columns)
    {
        var table = new StackPanel { Spacing = 0 };

        var headerGrid = NewColumnGrid(columns);
        headerGrid.Padding = new Thickness(8, 4, 8, 6);
        for (int i = 0; i < columns.Count; i++)
        {
            var caption = new TextBlock
            {
                Text = columns[i].Header,
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = DisplayTokens.TextMuted,
                CharacterSpacing = 40,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };
            Grid.SetColumn(caption, i);
            headerGrid.Children.Add(caption);
        }

        var headerBorder = new Border
        {
            Child = headerGrid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        table.Children.Add(headerBorder);
        return table;
    }

    private static Border BuildRow(IReadOnlyList<ColumnSpec> columns, UIElement[] cells, string automationName)
    {
        var grid = NewColumnGrid(columns);
        grid.Padding = new Thickness(8, 6, 8, 6);
        grid.MinHeight = 40;
        for (int i = 0; i < cells.Length && i < columns.Count; i++)
        {
            var cell = cells[i];
            Grid.SetColumn((FrameworkElement)cell, i);
            grid.Children.Add(cell);
        }

        var border = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(border, automationName);
        return border;
    }

    private static Grid NewColumnGrid(IReadOnlyList<ColumnSpec> columns)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        foreach (var column in columns)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = column.Width });
        }

        return grid;
    }

    private static TextBlock TextCell(string text, Brush foreground) => new()
    {
        Text = text,
        FontSize = 12,
        Foreground = foreground,
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly record struct ColumnSpec(string Header, GridLength Width);
}
