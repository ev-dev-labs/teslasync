using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 UserCell surface — a parity port of the web <c>UserCell</c> primitive
/// (web/src/components/data-display/UserCell.tsx). It is the drop-in cell for user-attributed table columns
/// (an audit-log "actor", a feedback-queue "reporter", a notification-log "delivered to", …): it composes the
/// shared <see cref="Avatar"/> surface alongside the resolved display name, with an optional muted email line
/// beneath it, and collapses to an em-dash when there is no user so empty rows stay scannable. The display
/// name follows the web priority chain (name → email local-part → id → the localized "Unknown user" label);
/// the avatar is seeded by the user id, named by the display name, sourced by the avatar url and tooltipped —
/// exactly the web <c>&lt;Avatar userId name src size showTooltip /&gt;</c>. All state flows through
/// <see cref="UserCellViewModel"/> / <see cref="UserCellProjection"/> and the view performs no I/O. The cell
/// carries a single Narrator name (the display name, plus the email when shown, or the em-dash when empty) so
/// a dense table reads one identity per row, and the text lines truncate with an ellipsis (web
/// <c>truncate</c>).
///
/// <para>
/// State coverage: the web source is a presentational cell driven entirely by props — its only data source is
/// <c>useTranslation</c> (the i18n facade) and it performs no network/query fetch, so it has no loading /
/// error / stale / offline chrome to reproduce. The states it actually has are reproduced in full: the
/// populated cell (with and without the email line, and the name → email → id → unknown-user display-name
/// fallbacks) and the em-dash empty cell (no user, or a user with no name, email or id) — never a blank box.
/// </para>
/// </summary>
public sealed partial class UserCell : ContentControl, IDisposable
{
    private readonly UserCellViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly UserCellDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private Avatar? _avatar;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe, empty cell (no user) over the passthrough localizer — the native analogue of
    /// mounting the web component with no <c>user</c> in an isolated host / designer. Production callers use
    /// the props constructor.
    /// </summary>
    public UserCell()
        : this(new UserCellProps(), PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its render props, the i18n facade and an optional diagnostics sink.</summary>
    /// <param name="props">The cell render inputs (web props).</param>
    /// <param name="localizer">The i18n facade the unknown-user fallback name resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public UserCell(UserCellProps props, ILocalizer localizer, UserCellDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(props);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new UserCellViewModel(props, localizer);
        _diagnostics = diagnostics ?? new UserCellDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Center;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface slug (<c>UserCell</c>).</summary>
    public static string Slug => UserCellRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public UserCellViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        DisposeAvatar();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new UserCellAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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
        UserCellProjection projection = _viewModel.Projection;

        DisposeAvatar();
        if (projection.ContentMode == UserCellContentMode.Empty)
        {
            Content = BuildEmpty();
        }
        else
        {
            Content = BuildPopulated(projection);
        }

        // web: the empty branch is a single <span data-testid="user-cell-empty">, the populated branch a single
        // <span data-testid="user-cell"> — so the root id switches with the branch.
        AutomationProperties.SetAutomationId(
            this,
            projection.ContentMode == UserCellContentMode.Empty
                ? UserCellRegistration.EmptyAutomationId
                : UserCellRegistration.RootAutomationId);

        // The whole cell announces one identity (display name, plus email when shown, or the em-dash when
        // empty); the avatar and text lines are kept out of the Narrator tree so a dense table does not read
        // each row two or three times.
        AutomationProperties.SetName(this, projection.AccessibleName);
    }

    private static TextBlock BuildEmpty()
    {
        // web: <span className="text-[var(--text-muted)]" data-testid="user-cell-empty">—</span>.
        var marker = new TextBlock
        {
            Text = UserCellRegistration.EmptyMarker,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAutomationId(marker, UserCellRegistration.EmptyAutomationId);
        AutomationProperties.SetAccessibilityView(marker, AccessibilityView.Raw);
        return marker;
    }

    private StackPanel BuildPopulated(UserCellProjection projection)
    {
        // web: <Avatar userId name={displayName} src size showTooltip /> — the shared avatar surface, whose
        // identity duplicates the cell's accessible name, so it is kept out of the Narrator tree.
        _avatar = new Avatar(projection.AvatarProps, _localizer);
        AutomationProperties.SetAccessibilityView(_avatar, AccessibilityView.Raw);

        // web: <span className="flex flex-col min-w-0"> — the name over the optional email, both truncating.
        var textColumn = new StackPanel
        {
            Orientation = Orientation.Vertical,
            VerticalAlignment = VerticalAlignment.Center,
        };
        textColumn.Children.Add(BuildNameLine(projection));
        if (projection.ShowEmailLine)
        {
            textColumn.Children.Add(BuildEmailLine(projection));
        }

        // web: <span className="inline-flex items-center gap-2 min-w-0"> — the avatar beside the text column.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = UserCellMetrics.RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(_avatar);
        row.Children.Add(textColumn);
        return row;
    }

    private static TextBlock BuildNameLine(UserCellProjection projection)
    {
        // web: <span className="text-sm text-[var(--text-primary)] truncate">{displayName}</span>.
        var name = new TextBlock
        {
            Text = projection.DisplayName,
            FontSize = UserCellMetrics.NameFontPx,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAutomationId(name, UserCellRegistration.NameAutomationId);
        AutomationProperties.SetAccessibilityView(name, AccessibilityView.Raw);
        return name;
    }

    private static TextBlock BuildEmailLine(UserCellProjection projection)
    {
        // web: <span className="text-xs text-[var(--text-muted)] truncate">{user.email}</span>.
        var email = new TextBlock
        {
            Text = projection.Email,
            FontSize = UserCellMetrics.EmailFontPx,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAutomationId(email, UserCellRegistration.EmailAutomationId);
        AutomationProperties.SetAccessibilityView(email, AccessibilityView.Raw);
        return email;
    }

    private void DisposeAvatar()
    {
        _avatar?.Dispose();
        _avatar = null;
    }

    private sealed class UserCellAutomationPeer : FrameworkElementAutomationPeer
    {
        public UserCellAutomationPeer(UserCell owner)
            : base(owner)
        {
        }

        // The cell groups an avatar and one or two text lines under a single labelled identity.
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((UserCell)Owner).ViewModel.AccessibleName
                : name;
        }
    }
}
