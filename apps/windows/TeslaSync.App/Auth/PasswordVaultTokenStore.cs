using System.Text.Json;
using TeslaSync.App.Core.Auth;
using Windows.Security.Credentials;

namespace TeslaSync.App.Auth;

/// <summary>
/// <see cref="ISecureTokenStore"/> backed by the Windows Credential Locker
/// (<see cref="PasswordVault"/>), which persists credentials in the per-user,
/// DPAPI-protected vault (ADR-008 / authentik-native-clients runbook §4). The
/// <see cref="TokenSet"/> is serialized to JSON and stored as the credential password;
/// it is never written to logs, files, or app settings. Reads return
/// <see langword="null"/> for absent/undecodable data rather than throwing.
/// </summary>
public sealed class PasswordVaultTokenStore : ISecureTokenStore
{
    private const string UserName = "session";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly string _resource;

    /// <summary>Creates a store scoped to <paramref name="clientId"/> (one session per client id).</summary>
    public PasswordVaultTokenStore(string clientId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(clientId);
        _resource = "TeslaSync:" + clientId;
    }

    /// <inheritdoc />
    public Task<TokenSet?> LoadAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var vault = new PasswordVault();
            var credential = vault.Retrieve(_resource, UserName);
            credential.RetrievePassword();
            var tokens = JsonSerializer.Deserialize<TokenSet>(credential.Password, JsonOptions);
            return Task.FromResult(tokens);
        }
        catch (Exception)
        {
            // Absent or unreadable credential — treat as "no session" without leaking why.
            return Task.FromResult<TokenSet?>(null);
        }
    }

    /// <inheritdoc />
    public Task SaveAsync(TokenSet tokens, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(tokens);

        var vault = new PasswordVault();
        RemoveExisting(vault);
        var payload = JsonSerializer.Serialize(tokens, JsonOptions);
        vault.Add(new PasswordCredential(_resource, UserName, payload));
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            RemoveExisting(new PasswordVault());
        }
        catch (Exception)
        {
            // Idempotent: nothing stored is a successful clear.
        }

        return Task.CompletedTask;
    }

    private void RemoveExisting(PasswordVault vault)
    {
        try
        {
            foreach (var credential in vault.FindAllByResource(_resource))
            {
                vault.Remove(credential);
            }
        }
        catch (Exception)
        {
            // FindAllByResource throws when the resource has no entries — nothing to remove.
        }
    }
}
