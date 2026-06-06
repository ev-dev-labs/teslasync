namespace TeslaSync.App.Core.Push;

/// <summary>Tuning for the <see cref="PushRegistrationService"/>.</summary>
public sealed class PushRegistrationOptions
{
    /// <summary>Renew the channel when it expires within this window of "now". Default: 3 days.</summary>
    public TimeSpan RenewBeforeExpiry { get; set; } = TimeSpan.FromDays(3);
}

/// <summary>
/// The default <see cref="IPushRegistrationService"/> (P2/W6-0002). It is headless and fully
/// testable: the WNS channel, backend client, local store, device facts and clock are all injected.
/// A single <see cref="SemaphoreSlim"/> serializes register / renew / unregister so an auth-driven
/// renewal can never race a concurrent sign-out cleanup (mirroring the W4 <c>AuthService</c> lock).
///
/// <para>Failures never crash the host: a missing channel (no package identity) or a rejected
/// registration parks the state in <see cref="PushRegistrationState.Failed"/> with a PII-free
/// reason, and an unregister always clears local state even if the backend revoke fails.</para>
/// </summary>
public sealed class PushRegistrationService : IPushRegistrationService, IDisposable
{
    private readonly IPushChannelProvider _provider;
    private readonly IDeviceRegistrationClient _client;
    private readonly IPushRegistrationStore _store;
    private readonly IPushEnvironment _environment;
    private readonly PushDiagnostics _diagnostics;
    private readonly PushRegistrationOptions _options;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SemaphoreSlim _mutex = new(1, 1);

    private PushRegistrationState _state = new PushRegistrationState.Unregistered();
    private bool _disposed;

    /// <summary>Creates the service over its channel/client/store/environment collaborators.</summary>
    public PushRegistrationService(
        IPushChannelProvider provider,
        IDeviceRegistrationClient client,
        IPushRegistrationStore store,
        IPushEnvironment environment,
        PushDiagnostics diagnostics,
        PushRegistrationOptions? options = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(provider);
        ArgumentNullException.ThrowIfNull(client);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(environment);
        ArgumentNullException.ThrowIfNull(diagnostics);

        _provider = provider;
        _client = client;
        _store = store;
        _environment = environment;
        _diagnostics = diagnostics;
        _options = options ?? new PushRegistrationOptions();
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <inheritdoc />
    public event EventHandler<PushRegistrationState>? StateChanged;

    /// <inheritdoc />
    public PushRegistrationState State => _state;

    /// <inheritdoc />
    public async Task<PushRegistrationState> RegisterAsync(CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await RegisterLockedAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _mutex.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PushRegistrationState> RenewAsync(CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await RenewLockedAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _mutex.Release();
        }
    }

    /// <inheritdoc />
    public async Task UnregisterAsync(CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await UnregisterLockedAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _mutex.Release();
        }
    }

    /// <inheritdoc />
    public async Task OnAuthChangedAsync(bool signedIn, CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (signedIn)
            {
                await RenewLockedAsync(cancellationToken).ConfigureAwait(false);
            }
            else
            {
                await UnregisterLockedAsync(cancellationToken).ConfigureAwait(false);
            }
        }
        finally
        {
            _mutex.Release();
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _mutex.Dispose();
    }

    private async Task<PushRegistrationState> RegisterLockedAsync(CancellationToken cancellationToken)
    {
        SetState(new PushRegistrationState.Registering());

        PushChannel channel;
        try
        {
            channel = await _provider.CreateChannelAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (PushChannelUnavailableException)
        {
            return Fail("channel_unavailable");
        }

        return await RegisterChannelAsync(channel, cancellationToken).ConfigureAwait(false);
    }

    private async Task<PushRegistrationState> RenewLockedAsync(CancellationToken cancellationToken)
    {
        var existing = await _store.LoadAsync(cancellationToken).ConfigureAwait(false);

        PushChannel channel;
        try
        {
            channel = await _provider.CreateChannelAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (PushChannelUnavailableException)
        {
            return Fail("channel_unavailable");
        }

        // Skip the backend round-trip only when the registration is still valid: same channel and
        // not yet inside the pre-expiry renewal window.
        if (existing is not null
            && string.Equals(existing.ChannelFingerprint, PushRedaction.Fingerprint(channel.ChannelUri), StringComparison.Ordinal)
            && !channel.IsExpiringWithin(_options.RenewBeforeExpiry, _clock()))
        {
            return SetState(new PushRegistrationState.Registered(existing.RegistrationId, existing.ChannelExpiresAt));
        }

        SetState(new PushRegistrationState.Registering());
        var state = await RegisterChannelAsync(channel, cancellationToken).ConfigureAwait(false);
        if (state is PushRegistrationState.Registered)
        {
            _diagnostics.RecordRenew();
        }

        return state;
    }

    private async Task<PushRegistrationState> RegisterChannelAsync(PushChannel channel, CancellationToken cancellationToken)
    {
        var request = new DeviceRegistrationRequest(
            _environment.Platform,
            _environment.PushProvider,
            channel.ChannelUri,
            _environment.AppVersion,
            _environment.Locale,
            _environment.StableDeviceId,
            _environment.Capabilities,
            channel.ExpiresAt);

        DeviceRegistrationResponse response;
        try
        {
            response = await _client.RegisterAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // A transient/rejected registration must not clear an existing valid registration.
            return Fail("register_rejected");
        }

        var record = new PushRegistrationRecord(
            response.RegistrationId,
            _environment.Platform,
            _environment.AppVersion,
            PushRedaction.Fingerprint(channel.ChannelUri),
            channel.ExpiresAt,
            _clock());
        await _store.SaveAsync(record, cancellationToken).ConfigureAwait(false);

        _diagnostics.RecordRegister();
        return SetState(new PushRegistrationState.Registered(response.RegistrationId, channel.ExpiresAt));
    }

    private async Task UnregisterLockedAsync(CancellationToken cancellationToken)
    {
        var existing = await _store.LoadAsync(cancellationToken).ConfigureAwait(false);
        if (existing is not null)
        {
            try
            {
                await _client.UnregisterAsync(existing.RegistrationId, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception)
            {
                // Revoke is best-effort: clear locally even when the backend revoke fails so a
                // signed-out device never keeps a live registration on this machine.
                _diagnostics.RecordFailure("unregister_revoke_failed");
            }
        }

        try
        {
            await _provider.CloseChannelAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // Closing the channel is best-effort.
        }

        await _store.ClearAsync(cancellationToken).ConfigureAwait(false);
        _diagnostics.RecordUnregister();
        SetState(new PushRegistrationState.Unregistered());
    }

    private PushRegistrationState Fail(string reason)
    {
        _diagnostics.RecordFailure(reason);
        return SetState(new PushRegistrationState.Failed(reason));
    }

    private PushRegistrationState SetState(PushRegistrationState state)
    {
        _state = state;
        StateChanged?.Invoke(this, state);
        return state;
    }
}
