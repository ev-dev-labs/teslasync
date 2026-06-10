using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 backup-actions surface — a parity port of
/// web/src/features/system/components/status/BackupActionsCard.tsx. It reproduces the web card's composition: a
/// vertical stack of the backup-status rows followed by a divided action row holding the primary "Run quick
/// backup now" button (the busy "Starting…" while a backup is triggered, disabled so a double-click can't fire
/// two backups) and a low-emphasis "Manage backups &amp; restore" link to the Backup &amp; Restore page (web
/// <c>&lt;Link to="/backup"&gt;</c>). The mutation outcome surfaces as an inline, Narrator-announced success /
/// failure line — the success confirmation (web <c>toast.success('Quick backup started')</c>), the
/// permission-specific message on a 401/403, or the generic <c>Backup failed: …</c> message — and a success
/// refreshes the status read (web <c>invalidateQueries(['backup-runs'])</c>). Because a Windows surface must
/// never flash a blank box, the standalone surface fills its status region from a cache-then-network read of
/// <c>GET /backup/runs</c>, rendering every load state: a loading skeleton, a live/stale/offline freshness
/// chip, a friendly "no backups yet" empty surface, and an inline error with a retry affordance. All data flows
/// through the shared <see cref="BackupActionsCardViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and every interactive element carries a Narrator name. The surface adds no
/// bespoke motion, so reduced-motion preferences are honoured by construction.
/// </summary>
public sealed partial class BackupActionsCard : ContentControl, IDisposable
{
    private const string PlayGlyph = "\uE768";        // Segoe Fluent — Play
    private const string ManageGlyph = "\uE8A7";      // Segoe Fluent — OpenInNewWindow (external link)
    private const string HardDriveGlyph = "\uEDA2";   // Segoe Fluent — MapDrive (hard drive)
    private const string SuccessGlyph = "\uE73E";     // Segoe Fluent — CheckMark
    private const string ErrorGlyph = "\uEA39";       // Segoe Fluent — ErrorBadge

    private readonly BackupActionsCardViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly IBackupActionsNavigator _navigator;
    private readonly BackupActionsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, navigator and diagnostics.</summary>
    public BackupActionsCard(
        IBackupActionsSource source,
        ILocalizer localizer,
        IBackupActionsNavigator? navigator = null,
        BackupActionsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _navigator = navigator ?? NullBackupActionsNavigator.Instance;
        _diagnostics = diagnostics ?? new BackupActionsDiagnostics();
        _viewModel = new BackupActionsCardViewModel(source, localizer, _diagnostics, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetName(this, _viewModel.SurfaceLabel);

        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>backup-actions-card</c>).</summary>
    public static string SurfaceId => BackupActionsCardRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public BackupActionsCardViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BackupActionsSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static BackupActionsCard Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        IBackupActionsNavigator? navigator = null,
        BackupActionsDiagnostics? diagnostics = null)
    {
        var source = new BackupActionsSource(api, engine, options);
        return new BackupActionsCard(source, localizer, navigator, diagnostics);
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

    /// <summary>Detach from the view-model and cancel any in-flight work (idempotent).</summary>
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
        _root.Children.Add(BuildStatusRegion());
        _root.Children.Add(BuildActionFooter());

        var feedback = BuildFeedback();
        if (feedback is not null)
        {
            _root.Children.Add(feedback);
        }
    }

    // ── Backup-status content region (always visible, never blank) ─────────────────────────────────────

    private UIElement BuildStatusRegion() => _viewModel.State switch
    {
        BackupActionsState.Loading => BuildLoading(),
        BackupActionsState.Error => BuildError(),
        BackupActionsState.Empty => BuildEmpty(),
        _ => BuildStatus(),
    };

    private StackPanel BuildStatus()
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(BuildFreshnessRow());

        foreach (var row in _viewModel.Display.Rows)
        {
            column.Children.Add(BuildDefinitionRow(row));
        }

        AutomationProperties.SetName(column, _viewModel.Display.AccessibilitySummary);
        return column;
    }

    private Grid BuildFreshnessRow()
    {
        var hint = _viewModel.StatusHint;
        var freshness = new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        if (!string.IsNullOrEmpty(hint))
        {
            var hintCaption = new Caption
            {
                Value = hint,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(hintCaption, hint);
            Grid.SetColumn(hintCaption, 0);
            row.Children.Add(hintCaption);
        }

        Grid.SetColumn(freshness, 1);
        row.Children.Add(freshness);
        return row;
    }

    private static Grid BuildDefinitionRow(BackupActionsRow row)
    {
        var grid = new Grid { ColumnSpacing = 12, MinHeight = 28 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new Text
        {
            Value = row.Label,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var value = new Text
        {
            Value = row.Value,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Right,
            HorizontalContentAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        Grid.SetColumn(label, 0);
        Grid.SetColumn(value, 1);
        grid.Children.Add(label);
        grid.Children.Add(value);

        AutomationProperties.SetName(grid, $"{row.Label}: {row.Value}");
        return grid;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 10 };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = HardDriveGlyph,
        Message = _viewModel.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ReadErrorMessage ?? BackupActionsCardRegistration.ErrorLabel(_localizer),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Action footer (always visible, divided from the status region) ─────────────────────────────────

    private Border BuildActionFooter()
    {
        var runButton = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Small,
            Text = _viewModel.RunButtonLabel,
            IconGlyph = PlayGlyph,
            IsLoading = _viewModel.IsRunning,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(runButton, _viewModel.RunButtonLabel);
        AutomationProperties.SetAutomationId(runButton, "backup-actions-run");
        runButton.Click += OnRunClick;

        var manageButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.ManageLabel,
            IconGlyph = ManageGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(manageButton, _viewModel.ManageLabel);
        AutomationProperties.SetAutomationId(manageButton, "backup-actions-manage");
        manageButton.Click += OnManageClick;

        // Mirrors the web flex-wrap action row (`flex flex-wrap items-center gap-2`).
        var row = new ActionWrapPanel
        {
            HorizontalSpacing = 8,
            VerticalSpacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(runButton);
        row.Children.Add(manageButton);

        // Mirrors the web `pt-2 border-t border-white/[0.06]` divider above the actions.
        return new Border
        {
            BorderThickness = new Thickness(0, 1, 0, 0),
            BorderBrush = DisplayTokens.Border,
            Padding = new Thickness(0, 12, 0, 0),
            Child = row,
        };
    }

    private void OnRunClick(object sender, RoutedEventArgs e) => _ = _viewModel.RunQuickBackupAsync();

    private void OnManageClick(object sender, RoutedEventArgs e) => _navigator.NavigateToBackups();

    // ── Inline action feedback (web toast → announced live region) ─────────────────────────────────────

    private StackPanel? BuildFeedback()
    {
        var message = _viewModel.FeedbackMessage;
        if (string.IsNullOrEmpty(message) || _viewModel.FeedbackTone == BackupActionFeedbackTone.None)
        {
            return null;
        }

        bool isError = _viewModel.FeedbackTone == BackupActionFeedbackTone.Error;
        var statusKind = isError ? StatusKind.Danger : StatusKind.Success;

        var icon = new FontIcon
        {
            Glyph = isError ? ErrorGlyph : SuccessGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(statusKind)),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var text = new Text
        {
            Value = message,
            Foreground = isError ? DisplayTokens.TextSecondary : DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(icon);
        row.Children.Add(text);

        AutomationProperties.SetName(row, message);
        LiveRegion.Configure(row, assertive: isError);
        LiveRegion.Announce(row);
        return row;
    }

    /// <summary>
    /// A minimal left-to-right wrap panel for the action row — the native analogue of the web
    /// <c>flex flex-wrap items-center gap-2</c>. Mirrors the established <c>ChipWrapPanel</c> / <c>CardWrapPanel</c>
    /// pattern so the quick-backup button and the manage link flow onto a new run rather than clipping when the
    /// card is narrow.
    /// </summary>
    private sealed partial class ActionWrapPanel : Panel
    {
        /// <summary>Horizontal gap between items on a run.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped runs.</summary>
        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (var child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                var desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(measuredWidth, totalHeight);
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0;
            double y = 0;
            double rowHeight = 0;

            foreach (var child in Children)
            {
                var desired = child.DesiredSize;
                if (x > 0 && x + HorizontalSpacing + desired.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                if (x > 0)
                {
                    x += HorizontalSpacing;
                }

                child.Arrange(new Rect(x, y, desired.Width, desired.Height));
                x += desired.Width;
                rowHeight = Math.Max(rowHeight, desired.Height);
            }

            return finalSize;
        }
    }
}
