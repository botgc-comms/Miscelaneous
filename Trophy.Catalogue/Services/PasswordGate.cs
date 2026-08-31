using System.Security.Cryptography;
using System.Text;

namespace Trophy.Catalogue.Services;

public sealed class PasswordGate(IWebHostEnvironment environment, IConfiguration configuration)
{
    public const string CookieName = "botgc_trophy_archive";
    private readonly string configuredPassword = configuration["APP_PASSWORD"] ?? string.Empty;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuredPassword);
    public bool RequiresSetup => environment.IsProduction() && !IsConfigured;
    public bool IsOpenForLocalDevelopment => environment.IsDevelopment() && !IsConfigured;

    public bool IsAuthenticated(HttpContext context)
    {
        if (IsOpenForLocalDevelopment) return true;
        if (!IsConfigured) return false;
        return context.Request.Cookies.TryGetValue(CookieName, out var cookie) &&
               CryptographicOperations.FixedTimeEquals(
                   Encoding.UTF8.GetBytes(cookie),
                   Encoding.UTF8.GetBytes(ExpectedCookieValue()));
    }

    public bool PasswordMatches(string providedPassword)
    {
        if (!IsConfigured) return false;
        return CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(providedPassword)),
            SHA256.HashData(Encoding.UTF8.GetBytes(configuredPassword)));
    }

    public void SignIn(HttpContext context)
    {
        context.Response.Cookies.Append(CookieName, ExpectedCookieValue(), new CookieOptions
        {
            HttpOnly = true,
            Secure = !environment.IsDevelopment(),
            SameSite = SameSiteMode.Strict,
            IsEssential = true,
            MaxAge = TimeSpan.FromDays(30),
            Path = "/"
        });
    }

    public static void SignOut(HttpContext context) => context.Response.Cookies.Delete(CookieName, new CookieOptions { Path = "/" });

    private string ExpectedCookieValue()
    {
        var digest = HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(configuredPassword),
            Encoding.UTF8.GetBytes("botgc-trophy-archive-session-v1"));
        return Convert.ToHexString(digest);
    }
}
