using System.Collections.Generic;
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
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>SecretRotationPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/SecretRotationPage.tsx</c> (route <c>/admin/secret-rotation</c>, nav name
/// <c>SecretRotation</c>). It binds to a <see cref="SecretRotationPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle), the HTTP-503 subsystem-unavailable banner
/// (web <c>subsystemMissing</c>), the overdue-rotations critical banner (web <c>counts.critical &gt; 0</c>), the
/// loading shimmer, the generic failure surface (InfoBar-equivalent + Retry), the four tracked-secret
/// <see cref="TsStatCard"/>s (Tracked secrets / OK / Warn / Critical) and the rotation-status <see cref="TsGlassPanel"/>
/// (either the per-secret table — two-line kind / rotated / expiry cells + the severity <see cref="TsBadge"/> — or the
/// "no tracked secrets" <see cref="TsEmptyState"/>). The view is a thin renderer: all branch selection, formatting and
/// i18n happen in the view-model's <see cref="SecretRotationDisplay"/> projection. State changes are marshalled onto
/// the UI thread.
/// </summary>
public sealed partial class SecretRotationPage : UserControl, IDisposable
{
    private const double KindColumn = 1.8;
    private const double RotatedColumn = 1.5;
    private const double AgeColumn = 96;
    private const double ExpiryColumn = 1.5;
    private const double ThresholdsColumn = 132;
    private const double SeverityColumn = 128;

    private readonly SecretRotationPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsAlertBanner _subsystemBanner = new() { Variant = CalloutVariant.Warning, IsOpen = false, Dismissible = false };
    private readonly TsAlertBanner _criticalBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = 24 };
    private readonly TsQueryError _errorState = new();

    private readonly StackPanel _contentRoot = new() { Spacing = 24 };
    private readonly Grid _statCardsGrid;
    private readonly TsStatCard _totalCard = new();
    private readonly TsStatCard _okCard = new();
    private readonly TsStatCard _warnCard = new();
    private readonly TsStatCard _criticalCard = new();

    private readonly TsGlassPanel _tablePanel = new();
    private readonly PanelTitle _tableTitle = new();
    private readonly ContentControl _tableHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private readonly StackPanel _tableContainer = new() { Spacing = 0 };
    private readonly Grid _tableHeader;
    private readonly TextBlock _hdrKind = NewHeaderCell();
    private readonly TextBlock _hdrRotated = NewHeaderCell();
    private readonly TextBlock _hdrAge = NewHeaderCell(right: true);
    private readonly TextBlock _hdrExpiry = NewHeaderCell();
    private readonly TextBlock _hdrThresholds = NewHeaderCell(right: true);
    private readonly TextBlock _hdrSeverity = NewHeaderCell(right: true);
    private readonly StackPanel _rowsPanel = new() { Spacing = 0 };

    private readonly TsEmptyState _emptyState = new() { IconGlyph = SecretRotationRegistration.ShieldGlyph };

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public SecretRotationPage()
        : this(EmptySecretRotationFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The secret-rotation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SecretRotationPage(ISecretRotationFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SecretRotationPageViewModel(feed, localizer);

        _statCardsGrid = BuildEqualColumns(16, _totalCard, _okCard, _warnCard, _criticalCard);
        _tableHeader = BuildTableHeader();

        BuildLoadingSkeleton();
        BuildContent();

        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>SecretRotationPage</c>).</summary>
    public static string Slug => SecretRotationRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_subsystemBanner);
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_contentRoot);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private StackPanel BuildHeader()
    {
        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        return header;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(4));
        _loadingSkeleton.Children.Add(new TsTableSkeleton());
    }

    private void BuildContent()
    {
        // Overdue-rotations danger banner (web counts.critical > 0) renders first within the content stack.
        _contentRoot.Children.Add(_criticalBanner);
        _contentRoot.Children.Add(_statCardsGrid);

        _tableContainer.Children.Add(_tableHeader);
        _tableContainer.Children.Add(_rowsPanel);

        var body = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        body.Children.Add(_tableTitle);
        body.Children.Add(_tableHost);

        _tablePanel.Content = body;
        _contentRoot.Children.Add(_tablePanel);
    }

    // A grid of equal-width star columns hosting each child, matching the web responsive card grid.
    private static Grid BuildEqualColumns(double spacing, params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = spacing };
        for (var i = 0; i < children.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(children[i], i);
            grid.Children.Add(children[i]);
        }

        return grid;
    }

    private Grid BuildTableHeader()
    {
        var grid = NewRowGrid();
        grid.Padding = new Thickness(0, 0, 0, 8);
        grid.BorderThickness = new Thickness(0, 0, 0, 1);
        grid.BorderBrush = Brush("TsColorBorderBrush");
        AddCell(grid, 0, _hdrKind);
        AddCell(grid, 1, _hdrRotated);
        AddCell(grid, 2, _hdrAge);
        AddCell(grid, 3, _hdrExpiry);
        AddCell(grid, 4, _hdrThresholds);
        AddCell(grid, 5, _hdrSeverity);
        return grid;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

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

    private void Render(SecretRotationDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Subsystem-unavailable banner (web 503 subsystemMissing).
        _subsystemBanner.Title = display.SubsystemTitle;
        _subsystemBanner.Message = display.SubsystemMessage;
        _subsystemBanner.IsOpen = display.ShowSubsystemUnavailable;
        _subsystemBanner.Visibility = Show(display.ShowSubsystemUnavailable);

        // Loading shimmer.
        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        // Generic failure surface (InfoBar-equivalent + Retry).
        _errorState.Visibility = Show(display.ShowError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        // Content region (web critical banner + tracked-secret cards + rotation-status panel).
        _contentRoot.Visibility = Show(display.ShowContent);

        // Overdue-rotations danger banner (web counts.critical > 0).
        _criticalBanner.Title = display.CriticalTitle;
        _criticalBanner.Message = display.CriticalMessage;
        _criticalBanner.IsOpen = display.ShowCriticalBanner;
        _criticalBanner.Visibility = Show(display.ShowCriticalBanner);

        // Tracked-secret stat cards (web items.length > 0 gate).
        _statCardsGrid.Visibility = Show(display.ShowStatCards);
        _totalCard.Label = display.TotalLabel;
        _totalCard.Value = display.TotalValue;
        _totalCard.Glyph = display.TotalGlyph;

        _okCard.Label = display.OkLabel;
        _okCard.Value = display.OkValue;

        _warnCard.Label = display.WarnLabel;
        _warnCard.Value = display.WarnValue;

        _criticalCard.Label = display.CriticalLabel;
        _criticalCard.Value = display.CriticalValue;
        _criticalCard.Glyph = display.CriticalGlyph;

        // Rotation-status panel header + columns.
        _tableTitle.Value = display.TableTitle;
        _hdrKind.Text = display.Columns.Kind;
        _hdrRotated.Text = display.Columns.Rotated;
        _hdrAge.Text = display.Columns.Age;
        _hdrExpiry.Text = display.Columns.Expiry;
        _hdrThresholds.Text = display.Columns.Thresholds;
        _hdrSeverity.Text = display.Columns.Severity;

        RenderTable(display);
    }

    private void RenderTable(SecretRotationDisplay display)
    {
        if (display.ShowTable)
        {
            RebuildRows(display.Rows);
            AutomationProperties.SetName(_tableContainer, display.TableTitle);
            _tableHost.Content = _tableContainer;
        }
        else
        {
            _emptyState.Title = display.EmptyTitle;
            _emptyState.Message = display.EmptyMessage;
            AutomationProperties.SetName(_emptyState, display.EmptyTitle);
            _tableHost.Content = _emptyState;
        }
    }

    private void RebuildRows(IReadOnlyList<SecretRotationRowDisplay> rows)
    {
        _rowsPanel.Children.Clear();
        foreach (var row in rows)
        {
            _rowsPanel.Children.Add(BuildRow(row));
        }
    }

    private static Border BuildRow(SecretRotationRowDisplay row)
    {
        var grid = NewRowGrid();
        grid.Padding = new Thickness(0, 10, 0, 10);

        // Kind cell: friendly name + optional target id caption (web column "kind").
        var kind = new StackPanel { Spacing = 0 };
        kind.Children.Add(new TextBlock
        {
            Text = row.Kind,
            FontWeight = FontWeights.SemiBold,
            Foreground = Brush("TsColorTextPrimaryBrush"),
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        if (row.ShowTarget)
        {
            kind.Children.Add(new Caption { Value = row.TargetId });
        }

        AddCell(grid, 0, kind);

        // Last-rotated cell: absolute + relative caption (web column "rotated").
        var rotated = new StackPanel { Spacing = 0 };
        rotated.Children.Add(new TextBlock
        {
            Text = row.Rotated,
            Foreground = Brush("TsColorTextPrimaryBrush"),
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        rotated.Children.Add(new Caption { Value = row.RotatedRelative });
        AddCell(grid, 1, rotated);

        // Age (days), right-aligned (web column "age").
        AddCell(grid, 2, new TextBlock
        {
            Text = row.Age,
            Foreground = Brush("TsColorTextPrimaryBrush"),
            HorizontalAlignment = HorizontalAlignment.Right,
        });

        // Expiry cell: absolute + "Nd remaining" caption, or the em-dash (web column "expiry").
        var expiry = new StackPanel { Spacing = 0 };
        expiry.Children.Add(new TextBlock
        {
            Text = row.Expiry,
            Foreground = Brush("TsColorTextPrimaryBrush"),
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        if (row.ShowDaysToExpiry)
        {
            expiry.Children.Add(new Caption { Value = row.DaysToExpiry });
        }

        AddCell(grid, 3, expiry);

        // Warn / critical thresholds, right-aligned (web column "thresholds").
        AddCell(grid, 4, new TextBlock
        {
            Text = row.Thresholds,
            Foreground = Brush("TsColorTextPrimaryBrush"),
            HorizontalAlignment = HorizontalAlignment.Right,
        });

        // Severity chip, right-aligned (web column "severity").
        AddCell(grid, 5, new TsBadge
        {
            Status = row.SeverityVariant,
            Content = row.SeverityLabel,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(grid, $"{row.Kind} {row.SeverityLabel}");

        return new Border
        {
            Child = grid,
            BorderThickness = new Thickness(0, 0, 0, 1),
            BorderBrush = Brush("TsColorBorderSubtleBrush") ?? Brush("TsColorBorderBrush"),
        };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Grid NewRowGrid()
    {
        var grid = new Grid { ColumnSpacing = 16, HorizontalAlignment = HorizontalAlignment.Stretch };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(KindColumn, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(RotatedColumn, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(AgeColumn) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ExpiryColumn, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ThresholdsColumn) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SeverityColumn) });
        return grid;
    }

    private static void AddCell(Grid grid, int column, FrameworkElement element)
    {
        element.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private static TextBlock NewHeaderCell(bool right = false) => new()
    {
        FontSize = 12,
        FontWeight = FontWeights.SemiBold,
        Foreground = Brush("TsColorTextMutedBrush"),
        HorizontalAlignment = right ? HorizontalAlignment.Right : HorizontalAlignment.Left,
    };

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;

    protected override AutomationPeer OnCreateAutomationPeer() => new SecretRotationPageAutomationPeer(this);

    private sealed class SecretRotationPageAutomationPeer(SecretRotationPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
