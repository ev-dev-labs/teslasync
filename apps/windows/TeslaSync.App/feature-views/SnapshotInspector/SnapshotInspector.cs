using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using Windows.UI.Text;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Snapshot Inspector feature surface — a parity port of
/// web/src/features/system/components/state-machine/SnapshotInspector.tsx. It is the FSM debugger's
/// right-rail: assign a <see cref="Model"/> (built by the shared state-holder layer from the
/// <c>useTelemetry</c> snapshot query) and it renders one of the contract's states — a centred
/// <see cref="SnapshotInspectorState.Loading"/> chrome, the <see cref="SnapshotInspectorState.Empty"/>
/// "select a transition" prompt, the <see cref="SnapshotInspectorState.OutsideWindow"/> "jump to last
/// transition" affordance, a retriable <see cref="SnapshotInspectorState.Error"/> surface, or the populated
/// panel (<see cref="SnapshotInspectorState.NoSignals"/> / <see cref="SnapshotInspectorState.Populated"/> /
/// <see cref="SnapshotInspectorState.Stale"/> / <see cref="SnapshotInspectorState.Offline"/>): the transition
/// header (from / to state badges, trigger, duration) with a "Copy snapshot" button, and the signal list each
/// annotated with a source-layer badge. The "Diff vs previous" toggle dims unchanged signals and highlights
/// the deltas with the previous value struck through. The view never performs HTTP; all branch selection,
/// value coercion, diffing and the copy payload happen in the WinUI-free
/// <see cref="SnapshotInspectorProjection"/>. Every string resolves through the i18n facade, interactive
/// elements carry Narrator names, and the jump / retry affordances are surfaced to the host through
/// <see cref="JumpToLastRequested"/> / <see cref="RetryRequested"/> (the parent owns the timeline).
/// </summary>
public sealed partial class SnapshotInspector : ContentControl
{
    private const double PanelPadding = 16;       // web p-4
    private const double SectionSpacing = 16;     // web space-y-4
    private const double StateMinHeight = 160;    // web min-h-[160px]
    private const double RowListMaxHeight = 480;  // web max-h-[480px]
    private const double DimmedOpacity = 0.4;     // web opacity-40
    private const string MonoFontFamily = "Consolas";

    private readonly ILocalizer _localizer;
    private readonly SnapshotInspectorText _text;
    private readonly SnapshotInspectorDiagnostics _diagnostics;
    private readonly TsGlassPanel _panel = new() { Padding = new Thickness(PanelPadding) };

    private SnapshotInspectorModel _model;
    private Border? _rowsHost;
    private bool _diffMode;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SnapshotInspectorModel.EmptyState"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SnapshotInspector(
        ILocalizer localizer,
        SnapshotInspectorModel? model = null,
        SnapshotInspectorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _text = new SnapshotInspectorText(localizer);
        _diagnostics = diagnostics ?? new SnapshotInspectorDiagnostics();
        _model = model ?? SnapshotInspectorModel.EmptyState();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        Content = _panel;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the outside-window "Jump to last transition" affordance is invoked.</summary>
    public event EventHandler? JumpToLastRequested;

    /// <summary>Raised when the error surface's retry affordance is invoked (the host reloads the snapshot).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical surface id (<c>snapshot-inspector</c>).</summary>
    public static string SurfaceId => SnapshotInspectorRegistration.Id;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SnapshotInspector</c>).</summary>
    public static string Slug => SnapshotInspectorRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public SnapshotInspectorModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            _diffMode = false; // a new selection resets the diff toggle (web useState default)
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        _rowsHost = null;
        _panel.Content = _model.State switch
        {
            SnapshotInspectorState.Loading => BuildLoading(),
            SnapshotInspectorState.Empty => BuildCentredMessage(_text.Empty, "snapshot-inspector-empty"),
            SnapshotInspectorState.OutsideWindow => BuildOutsideWindow(),
            SnapshotInspectorState.Error => BuildError(),
            _ => BuildSnapshot(),
        };

        AutomationProperties.SetName(_panel, _text.Title);
    }

    // ── No-transition states ─────────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoading()
    {
        var column = new StackPanel
        {
            Spacing = 10,
            VerticalAlignment = VerticalAlignment.Center,
            MinHeight = StateMinHeight,
        };
        column.Children.Add(new TsSkeleton { BlockHeight = 14, BlockWidth = 160 });
        column.Children.Add(new TsSkeleton { BlockHeight = 14 });
        column.Children.Add(new TsSkeleton { BlockHeight = 14 });

        var caption = new Caption
        {
            Value = _text.Loading,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        column.Children.Add(caption);

        AutomationProperties.SetName(column, _text.Loading);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private static TextBlock BuildCentredMessage(string message, string automationId)
    {
        var block = new TextBlock
        {
            Text = message,
            FontSize = 13,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MinHeight = StateMinHeight,
        };
        AutomationProperties.SetName(block, message);
        AutomationProperties.SetAutomationId(block, automationId);
        LiveRegion.Configure(block);
        LiveRegion.Announce(block);
        return block;
    }

    private StackPanel BuildOutsideWindow()
    {
        var message = new TextBlock
        {
            Text = _text.OutsideWindow(_model.LastTransitionRelative),
            FontSize = 13,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var jump = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Small,
            Text = _text.JumpToLast,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(jump, _text.JumpToLast);
        AutomationProperties.SetAutomationId(jump, "snapshot-inspector-jump");
        jump.Click += (_, _) => JumpToLastRequested?.Invoke(this, EventArgs.Empty);

        var column = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MinHeight = StateMinHeight,
        };
        column.Children.Add(message);
        column.Children.Add(jump);

        AutomationProperties.SetName(column, _text.OutsideWindow(_model.LastTransitionRelative));
        AutomationProperties.SetAutomationId(column, "snapshot-inspector-outside-window");
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = string.IsNullOrEmpty(_model.ErrorMessage) ? _text.Error : _model.ErrorMessage!,
            ActionText = _text.Retry,
            AttemptCount = _model.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
            MinHeight = StateMinHeight,
        };
        error.ActionInvoked += (_, _) => RetryRequested?.Invoke(this, EventArgs.Empty);
        return error;
    }

    // ── Transition snapshot (NoSignals / Populated / Stale / Offline) ──────────────────────────────────

    private StackPanel BuildSnapshot()
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(BuildMetaGrid());
        stack.Children.Add(BuildSignalsHeader());

        if (_model.Rows.Count == 0)
        {
            stack.Children.Add(BuildNoSignals());
        }
        else
        {
            _rowsHost = new Border { Child = BuildRowsList() };
            stack.Children.Add(_rowsHost);
        }

        return stack;
    }

    private Grid BuildHeader()
    {
        var title = new PanelTitle { Value = _text.Title, VerticalAlignment = VerticalAlignment.Center };

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        if (_model.State is SnapshotInspectorState.Stale or SnapshotInspectorState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip());
        }

        if (!string.IsNullOrEmpty(_model.CopyPayload))
        {
            var copy = new TsCopyButton
            {
                ValueToCopy = _model.CopyPayload,
                CopyLabel = _text.Copy,
                CopiedLabel = _text.Copied,
                Size = ControlSize.Small,
            };
            AutomationProperties.SetName(copy, _text.Copy);
            AutomationProperties.SetAutomationId(copy, "snapshot-inspector-copy");
            actions.Children.Add(copy);
        }

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(title, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(title);
        header.Children.Add(actions);
        return header;
    }

    private Border BuildFreshnessChip()
    {
        bool offline = _model.State == SnapshotInspectorState.Offline;
        string label = offline ? _text.Offline : _text.Stale;
        var accent = DisplayTokens.Brush(offline ? "TsColorTextMutedBrush" : "TsColorWarningBrush");

        var dot = new Microsoft.UI.Xaml.Shapes.Ellipse
        {
            Width = 8,
            Height = 8,
            Fill = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var text = new TextBlock
        {
            Text = label,
            FontSize = 12,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(dot);
        row.Children.Add(text);

        var pill = new Border
        {
            Child = row,
            CornerRadius = new CornerRadius(999),
            BorderBrush = accent,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(8, 2, 8, 2),
            VerticalAlignment = VerticalAlignment.Center,
        };

        string age = _model.UpdatedAt is { } ts
            ? DateTimeFormatting.Format(ts, DateTimeVariant.Relative, DateTimeOffset.Now)
            : string.Empty;
        string announce = string.IsNullOrEmpty(age) ? label : $"{label}, {age}";
        AutomationProperties.SetName(pill, announce);
        return pill;
    }

    private Grid BuildMetaGrid()
    {
        var transition = _model.Transition;
        string fromState = transition?.FromState ?? string.Empty;
        string toState = transition?.ToState ?? string.Empty;
        string trigger = string.IsNullOrEmpty(transition?.Trigger) ? SnapshotInspectorProjection.EmDash : transition!.Trigger;
        string duration = SnapshotInspectorProjection.FormatDuration(transition?.DurationInStateMs);

        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        AddMetaCell(grid, 0, 0, _text.From, BuildStateBadge(fromState));
        AddMetaCell(grid, 0, 1, _text.To, BuildStateBadge(toState));
        AddMetaCell(grid, 1, 0, _text.Trigger, BuildPrimaryText(trigger, wrap: true));
        AddMetaCell(grid, 1, 1, _text.Duration, BuildPrimaryText(duration, wrap: false));
        return grid;
    }

    private static void AddMetaCell(Grid grid, int row, int column, string caption, FrameworkElement value)
    {
        var cell = new StackPanel { Spacing = 4 };
        cell.Children.Add(new Caption { Value = caption });
        cell.Children.Add(value);
        Grid.SetRow(cell, row);
        Grid.SetColumn(cell, column);
        grid.Children.Add(cell);
    }

    private static FrameworkElement BuildStateBadge(string state)
    {
        if (string.IsNullOrEmpty(state))
        {
            return BuildPrimaryText(SnapshotInspectorProjection.EmDash, wrap: false);
        }

        var severity = SnapshotInspectorProjection.StateSeverity(state);
        var badge = new TsStatusBadge
        {
            Status = state,
            AccentBrushKey = SeverityLevels.Tokens(severity).AccentBrushKey,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        return badge;
    }

    private static TextBlock BuildPrimaryText(string value, bool wrap)
    {
        return new TextBlock
        {
            Text = value,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap,
            TextTrimming = wrap ? TextTrimming.None : TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    private Border BuildSignalsHeader()
    {
        var title = new PanelTitle { Value = _text.SignalsTitle, VerticalAlignment = VerticalAlignment.Center };

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(title, 0);
        grid.Children.Add(title);

        // Web parity: the "Diff vs previous" toggle is part of the section header whenever a transition is
        // selected (it is a no-op until there are signals to compare, exactly as in the web component).
        var toggle = new TsToggle
        {
            IsOn = _diffMode,
            Header = _text.DiffMode,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetName(toggle, _text.DiffMode);
        AutomationProperties.SetAutomationId(toggle, "snapshot-inspector-diff");
        toggle.Toggled += OnDiffToggled;
        Grid.SetColumn(toggle, 1);
        grid.Children.Add(toggle);

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(0, 12, 0, 0),
        };
    }

    private void OnDiffToggled(object? sender, EventArgs e)
    {
        if (sender is not TsToggle toggle)
        {
            return;
        }

        _diffMode = toggle.IsOn;
        if (_rowsHost is { } host)
        {
            host.Child = BuildRowsList();
        }
    }

    private Border BuildNoSignals()
    {
        var block = new TextBlock
        {
            Text = _text.NoSignals,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetName(block, _text.NoSignals);
        AutomationProperties.SetAutomationId(block, "snapshot-inspector-no-signals");

        var card = new Border
        {
            Child = block,
            CornerRadius = new CornerRadius(8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(12, 24, 12, 24),
        };
        LiveRegion.Configure(card);
        LiveRegion.Announce(card);
        return card;
    }

    private ScrollViewer BuildRowsList()
    {
        var body = new StackPanel { Spacing = 4 };
        foreach (var row in _model.Rows)
        {
            body.Children.Add(BuildSignalRow(row));
        }

        return new ScrollViewer
        {
            Content = body,
            MaxHeight = RowListMaxHeight,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(0, 0, 4, 0),
        };
    }

    private Border BuildSignalRow(SnapshotInspectorRow row)
    {
        bool highlight = _diffMode && row.Changed;
        bool dim = _diffMode && !row.Changed;

        var name = new TextBlock
        {
            Text = row.Name,
            FontSize = 11,
            FontFamily = new FontFamily(MonoFontFamily),
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var value = new TextBlock
        {
            Text = row.ValueDisplay,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 2, 0, 0),
        };

        var left = new StackPanel { Spacing = 0 };
        left.Children.Add(name);
        left.Children.Add(value);

        if (highlight && row.PreviousDisplay is { } previous)
        {
            left.Children.Add(new TextBlock
            {
                Text = previous,
                FontSize = 10,
                Foreground = DisplayTokens.TextMuted,
                TextDecorations = TextDecorations.Strikethrough,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 2, 0, 0),
            });
        }

        var badge = new TsSourceLayerBadge
        {
            Source = row.Source ?? string.Empty,
            AgeMs = row.AgeMs ?? double.NaN,
            VerticalAlignment = VerticalAlignment.Top,
        };

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(badge, 1);
        grid.Children.Add(left);
        grid.Children.Add(badge);

        var border = new Border
        {
            Child = grid,
            CornerRadius = new CornerRadius(6),
            BorderBrush = highlight ? DisplayTokens.Brush("TsColorWarningBrush") : DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(8, 6, 8, 6),
            Opacity = dim ? DimmedOpacity : 1.0,
        };
        AutomationProperties.SetName(border, RowAutomationName(row));
        return border;
    }

    private string RowAutomationName(SnapshotInspectorRow row)
    {
        string baseName = $"{row.Name}: {row.ValueDisplay}";
        if (_diffMode && row.Changed)
        {
            string previous = row.PreviousDisplay ?? SnapshotInspectorProjection.EmDash;
            return $"{baseName}. {_text.DiffMode}: {previous}";
        }

        return baseName;
    }

    /// <summary>Announce the surface as a group so Narrator reads its labelled name in every state.</summary>
    protected override AutomationPeer OnCreateAutomationPeer() => new SnapshotInspectorAutomationPeer(this);

    private sealed class SnapshotInspectorAutomationPeer(SnapshotInspector owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetClassNameCore() => nameof(SnapshotInspector);
    }
}
