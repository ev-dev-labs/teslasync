namespace TeslaSync.App.Core.Auth;

/// <summary>
/// Persistence seam for the signed-in <see cref="TokenSet"/>. The token material is
/// sensitive, so the concrete Windows implementation binds to the Credential Locker
/// (<c>PasswordVault</c>, DPAPI-backed per-user). The shared core depends only on
/// this interface; tests use an in-memory fake. Implementations must never log token
/// material and should return <see langword="null"/> from <see cref="LoadAsync"/> for
/// absent or undecodable data rather than throwing.
/// </summary>
public interface ISecureTokenStore
{
    /// <summary>Returns the persisted token set, or <see langword="null"/> if none / unreadable.</summary>
    Task<TokenSet?> LoadAsync(CancellationToken cancellationToken = default);

    /// <summary>Persists <paramref name="tokens"/>, replacing any previously stored set.</summary>
    Task SaveAsync(TokenSet tokens, CancellationToken cancellationToken = default);

    /// <summary>Removes any persisted token set. Idempotent.</summary>
    Task ClearAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// An in-memory <see cref="ISecureTokenStore"/> used by unit tests as a fake vault.
/// It is intentionally <b>not</b> a secure store and must never be used in the app —
/// the real Windows store is the Credential-Locker-backed implementation.
/// </summary>
public sealed class InMemoryTokenStore : ISecureTokenStore
{
    private TokenSet? _tokens;

    /// <summary>Optional hook to simulate a persistence failure on the next save.</summary>
    public bool FailNextSave { get; set; }

    /// <summary>Number of times <see cref="SaveAsync"/> has been invoked.</summary>
    public int SaveCount { get; private set; }

    /// <summary>Number of times <see cref="ClearAsync"/> has been invoked.</summary>
    public int ClearCount { get; private set; }

    /// <inheritdoc />
    public Task<TokenSet?> LoadAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(_tokens);

    /// <inheritdoc />
    public Task SaveAsync(TokenSet tokens, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(tokens);
        SaveCount++;
        if (FailNextSave)
        {
            FailNextSave = false;
            throw new InvalidOperationException("Simulated secure-store write failure");
        }

        _tokens = tokens;
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        ClearCount++;
        _tokens = null;
        return Task.CompletedTask;
    }
}
