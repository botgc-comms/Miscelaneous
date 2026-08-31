using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace BOTGC.EventPlaybook.Services;

public interface IMemberEmailArtworkStore
{
    Task<string> SaveAsync(string eventId, byte[] content, CancellationToken cancellationToken);
    string? Resolve(string token);
}

public sealed class MemberEmailArtworkStore : IMemberEmailArtworkStore
{
    private readonly string _directory;

    public MemberEmailArtworkStore(IWebHostEnvironment environment)
    {
        _directory = Path.Combine(environment.ContentRootPath, "App_Data", "MemberEmailArtwork");
        Directory.CreateDirectory(_directory);
    }

    public async Task<string> SaveAsync(string eventId, byte[] content, CancellationToken cancellationToken)
    {
        var tokenBytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{eventId.Trim()}:{Convert.ToHexString(SHA256.HashData(content))}"));
        var token = Convert.ToHexString(tokenBytes).ToLowerInvariant()[..32];
        var path = Path.Combine(_directory, $"{token}.png");
        await File.WriteAllBytesAsync(path, content, cancellationToken);
        return token;
    }

    public string? Resolve(string token)
    {
        if (!Regex.IsMatch(token, "^[a-f0-9]{32}$", RegexOptions.IgnoreCase)) return null;
        var path = Path.Combine(_directory, $"{token.ToLowerInvariant()}.png");
        return File.Exists(path) ? path : null;
    }
}
