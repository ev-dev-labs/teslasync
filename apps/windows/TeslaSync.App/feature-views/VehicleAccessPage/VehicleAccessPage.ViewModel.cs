using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>VehicleAccessPage</c> view — the native port of the web
/// page's two-query + mutation flow (web/src/features/vehicles/pages/VehicleAccessPage.tsx). It owns the drivers
/// list + invitations list, each with its four data states (loading / empty / error / success), the vehicle name
/// shown in the header (web <c>useVehicle</c>), and the transient mutation pending flags. It reads the two lists
/// through the injected <see cref="IVehicleAccessFeed"/> (web <c>useVehicleDrivers</c> / <c>useVehicleInvitations</c>),
/// writes the refresh / remove / create / revoke mutations back through the same port (web
/// <c>useRefreshVehicleDrivers</c> / <c>useRefreshVehicleInvitations</c> / <c>useRemoveVehicleDriver</c> /
/// <c>useCreateVehicleInvitation</c> / <c>useRevokeVehicleInvitation</c>), invalidating + reloading the affected
/// list on success exactly as the web onSuccess handlers do, and projects the result through
/// <see cref="VehicleAccessProjection"/> so the view is a thin renderer. Observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class VehicleAccessPageViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly CancellationToken CanceledToken = new(canceled: true);

    private readonly IVehicleAccessFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly VehicleAccessDiagnostics _diagnostics;
    private readonly bool _enabled;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<VehicleDriver> _drivers = Array.Empty<VehicleDriver>();
    private bool _driversLoading = true;
    private bool _driversError;
    private string? _driversErrorDetail;
    private bool _driversRefreshing;

    private IReadOnlyList<VehicleInvitation> _invitations = Array.Empty<VehicleInvitation>();
    private bool _invitationsLoading = true;
    private bool _invitationsError;
    private string? _invitationsErrorDetail;
    private bool _invitationsRefreshing;
    private bool _creating;

    private string? _vehicleName;
    private VehicleAccessDisplay _display;

    /// <summary>Creates the holder over its data feed, localizer, route vehicle id and (optional) diagnostics.</summary>
    /// <param name="feed">The drivers + invitations + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The route vehicle id (web <c>useParams id</c>); blank disables the queries (web <c>enabled: !!vehicleId</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleAccessPageViewModel(
        IVehicleAccessFeed feed,
        ILocalizer localizer,
        string? vehicleId,
        VehicleAccessDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new VehicleAccessDiagnostics();
        _enabled = !string.IsNullOrEmpty(vehicleId);

        // web enabled: !!vehicleId — without an id the queries never run, so the panels resolve straight to empty.
        if (!_enabled)
        {
            _driversLoading = false;
            _invitationsLoading = false;
        }

        _cts = new CancellationTokenSource();
        _display = VehicleAccessProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public VehicleAccessDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The vehicle display name shown in the header (web breadcrumb <c>vehicle?.display_name</c>); null when unresolved.</summary>
    public string? VehicleName
    {
        get => _vehicleName;
        private set => Set(ref _vehicleName, value);
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run the initial load — the vehicle name plus both list queries (web mount).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!_enabled || _disposed)
        {
            Reproject();
            return;
        }

        using var scope = LinkScope(cancellationToken);
        await LoadVehicleNameAsync(scope.Token).ConfigureAwait(false);
        await ReloadDriversAsync(scope.Token).ConfigureAwait(false);
        await ReloadInvitationsAsync(scope.Token).ConfigureAwait(false);
    }

    /// <summary>Reload the drivers query (web drivers error-surface retry / query refetch).</summary>
    public async Task RetryDriversAsync(CancellationToken cancellationToken = default)
    {
        if (!_enabled || _disposed)
        {
            return;
        }

        using var scope = LinkScope(cancellationToken);
        await ReloadDriversAsync(scope.Token, markLoading: true).ConfigureAwait(false);
    }

    /// <summary>Reload the invitations query (web invitations error-surface retry / query refetch).</summary>
    public async Task RetryInvitationsAsync(CancellationToken cancellationToken = default)
    {
        if (!_enabled || _disposed)
        {
            return;
        }

        using var scope = LinkScope(cancellationToken);
        await ReloadInvitationsAsync(scope.Token, markLoading: true).ConfigureAwait(false);
    }

    /// <summary>
    /// Re-sync drivers from Tesla then reload (web <c>refreshDrivers.mutate(vehicleId)</c> →
    /// <c>invalidateQueries(drivers)</c>). Surfaces the pending state on the refresh button.
    /// </summary>
    public async Task RefreshDriversAsync(CancellationToken cancellationToken = default)
    {
        if (!_enabled || _disposed)
        {
            return;
        }

        using var scope = LinkScope(cancellationToken);
        _driversRefreshing = true;
        Reproject();
        try
        {
            await _feed.RefreshDriversAsync(scope.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _driversError = true;
            _driversErrorDetail = ex.Message;
        }
        finally
        {
            _driversRefreshing = false;
        }

        await ReloadDriversAsync(scope.Token).ConfigureAwait(false);
    }

    /// <summary>
    /// Re-sync invitations from Tesla then reload (web <c>refreshInvitations.mutate(vehicleId)</c> →
    /// <c>invalidateQueries(invitations)</c>). Surfaces the pending state on the refresh button.
    /// </summary>
    public async Task RefreshInvitationsAsync(CancellationToken cancellationToken = default)
    {
        if (!_enabled || _disposed)
        {
            return;
        }

        using var scope = LinkScope(cancellationToken);
        _invitationsRefreshing = true;
        Reproject();
        try
        {
            await _feed.RefreshInvitationsAsync(scope.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _invitationsError = true;
            _invitationsErrorDetail = ex.Message;
        }
        finally
        {
            _invitationsRefreshing = false;
        }

        await ReloadInvitationsAsync(scope.Token).ConfigureAwait(false);
    }

    /// <summary>
    /// Create a new invitation then reload (web <c>createInvitation.mutate(vehicleId)</c> →
    /// <c>invalidateQueries(invitations)</c>). Surfaces the pending state on the invite button.
    /// </summary>
    public async Task CreateInvitationAsync(CancellationToken cancellationToken = default)
    {
        if (!_enabled || _disposed)
        {
            return;
        }

        using var scope = LinkScope(cancellationToken);
        _creating = true;
        Reproject();
        try
        {
            await _feed.CreateInvitationAsync(scope.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _invitationsError = true;
            _invitationsErrorDetail = ex.Message;
        }
        finally
        {
            _creating = false;
        }

        await ReloadInvitationsAsync(scope.Token).ConfigureAwait(false);
    }

    /// <summary>
    /// Remove a driver's access then reload (web <c>removeDriver.mutate({ vehicleId, shareUserId })</c> →
    /// <c>invalidateQueries(drivers)</c>).
    /// </summary>
    /// <param name="shareUserId">The Tesla share-user id of the driver to remove (web <c>removeTarget.share_user_id</c>).</param>
    public async Task RemoveDriverAsync(long shareUserId, CancellationToken cancellationToken = default)
    {
        if (!_enabled || _disposed)
        {
            return;
        }

        using var scope = LinkScope(cancellationToken);
        try
        {
            await _feed.RemoveDriverAsync(shareUserId, scope.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _driversError = true;
            _driversErrorDetail = ex.Message;
            Reproject();
            return;
        }

        await ReloadDriversAsync(scope.Token).ConfigureAwait(false);
    }

    /// <summary>
    /// Revoke a pending invitation then reload (web <c>revokeInvitation.mutate({ vehicleId, invitationId })</c> →
    /// <c>invalidateQueries(invitations)</c>).
    /// </summary>
    /// <param name="invitationId">The wire invitation id to revoke (web <c>revokeTarget.invitation_id</c>).</param>
    public async Task RevokeInvitationAsync(string invitationId, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(invitationId);

        if (!_enabled || _disposed)
        {
            return;
        }

        using var scope = LinkScope(cancellationToken);
        try
        {
            await _feed.RevokeInvitationAsync(invitationId, scope.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _invitationsError = true;
            _invitationsErrorDetail = ex.Message;
            Reproject();
            return;
        }

        await ReloadInvitationsAsync(scope.Token).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private async Task LoadVehicleNameAsync(CancellationToken cancellationToken)
    {
        try
        {
            VehicleName = await _feed.FetchVehicleNameAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — keep the previous name.
        }
        catch (Exception)
        {
            // The header name is best-effort chrome (web breadcrumb fallback); a failure never blocks the lists.
            VehicleName = null;
        }
    }

    private async Task ReloadDriversAsync(CancellationToken cancellationToken, bool markLoading = false)
    {
        if (markLoading && _drivers.Count == 0)
        {
            _driversLoading = true;
            Reproject();
        }

        try
        {
            var drivers = await _feed.FetchDriversAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _drivers = drivers ?? Array.Empty<VehicleDriver>();
            _driversError = false;
            _driversErrorDetail = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _driversError = true;
            _driversErrorDetail = ex.Message;
            _drivers = Array.Empty<VehicleDriver>();
        }
        finally
        {
            _driversLoading = false;
        }

        Reproject();
    }

    private async Task ReloadInvitationsAsync(CancellationToken cancellationToken, bool markLoading = false)
    {
        if (markLoading && _invitations.Count == 0)
        {
            _invitationsLoading = true;
            Reproject();
        }

        try
        {
            var invitations = await _feed.FetchInvitationsAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _invitations = invitations ?? Array.Empty<VehicleInvitation>();
            _invitationsError = false;
            _invitationsErrorDetail = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _invitationsError = true;
            _invitationsErrorDetail = ex.Message;
            _invitations = Array.Empty<VehicleInvitation>();
        }
        finally
        {
            _invitationsLoading = false;
        }

        Reproject();
    }

    private CancellationTokenSource LinkScope(CancellationToken external)
    {
        var lifetime = _cts?.Token ?? CanceledToken;
        return CancellationTokenSource.CreateLinkedTokenSource(lifetime, external);
    }

    private VehicleAccessModel BuildModel() => new(
        Drivers: _drivers,
        DriversLoading: _driversLoading,
        DriversError: _driversError,
        DriversErrorDetail: _driversErrorDetail,
        DriversRefreshing: _driversRefreshing,
        Invitations: _invitations,
        InvitationsLoading: _invitationsLoading,
        InvitationsError: _invitationsError,
        InvitationsErrorDetail: _invitationsErrorDetail,
        InvitationsRefreshing: _invitationsRefreshing,
        Creating: _creating);

    private void Reproject() => Display = VehicleAccessProjection.Project(BuildModel(), _localizer);

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
