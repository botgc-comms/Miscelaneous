using System.Net;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.API.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public sealed partial class IntelligentGolfLoginService(
    IHttpClientFactory httpClientFactory,
    IOptions<IntelligentGolfOptions> options,
    ILogger<IntelligentGolfLoginService> logger)
{
    public async Task<bool> LoginAsync(CancellationToken cancellationToken = default)
    {
        var settings = options.Value;

        if (string.IsNullOrWhiteSpace(settings.MemberId) ||
            string.IsNullOrWhiteSpace(settings.MemberPassword) ||
            string.IsNullOrWhiteSpace(settings.AdminPassword))
        {
            logger.LogError("Intelligent Golf credentials are not configured.");
            return false;
        }

        var client = httpClientFactory.CreateClient(IntelligentGolfServiceCollectionExtensions.HttpClientName);

        try
        {
            var loginPage = await GetPageAsync(client, "login.php", cancellationToken);
            if (!loginPage.Success)
            {
                logger.LogError(
                    "Failed to load the Intelligent Golf login page. Status: {StatusCode}; URI: {FinalUri}",
                    loginPage.StatusCode,
                    loginPage.FinalUri);
                return false;
            }

            if (RequiresMemberLogin(loginPage.Html))
            {
                var csrfToken = ExtractInputValue(loginPage.Html, "_csrf_token");
                if (string.IsNullOrWhiteSpace(csrfToken))
                {
                    logger.LogError("The Intelligent Golf login page did not contain a CSRF token.");
                    return false;
                }

                var memberLogin = await PostFormAsync(
                    client,
                    "login.php",
                    new Dictionary<string, string>
                    {
                        ["task"] = "login",
                        ["topmenu"] = "1",
                        ["memberid"] = settings.MemberId,
                        ["pin"] = settings.MemberPassword,
                        ["cachemid"] = "1",
                        ["_csrf_token"] = csrfToken,
                        ["Submit"] = "Login"
                    },
                    "login.php",
                    cancellationToken);

                if (!memberLogin.Success ||
                    ContainsCsrfFailure(memberLogin.Html) ||
                    RequiresMemberLogin(memberLogin.Html))
                {
                    logger.LogError("Intelligent Golf member authentication was rejected.");
                    return false;
                }
            }
            else if (!LooksAuthenticated(loginPage.Html))
            {
                logger.LogError("The Intelligent Golf login response was not recognised.");
                return false;
            }

            var adminPage = await GetPageAsync(client, "membership2.php", cancellationToken);
            if (!adminPage.Success || RequiresMemberLogin(adminPage.Html))
            {
                logger.LogError("The Intelligent Golf administration page is unavailable to the member session.");
                return false;
            }

            if (!RequiresAdminPassword(adminPage.Html))
            {
                return LooksAuthenticated(adminPage.Html);
            }

            var adminForm = new Dictionary<string, string>
            {
                ["leveltwopassword"] = settings.AdminPassword
            };

            var adminCsrf = ExtractInputValue(adminPage.Html, "_csrf_token");
            if (!string.IsNullOrWhiteSpace(adminCsrf))
            {
                adminForm["_csrf_token"] = adminCsrf;
            }

            var adminLogin = await PostFormAsync(
                client,
                "membership2.php",
                adminForm,
                "membership2.php",
                cancellationToken);

            var succeeded = adminLogin.Success &&
                            !ContainsCsrfFailure(adminLogin.Html) &&
                            !RequiresMemberLogin(adminLogin.Html) &&
                            !RequiresAdminPassword(adminLogin.Html);

            if (!succeeded)
            {
                logger.LogError("Intelligent Golf administrator authentication was rejected.");
            }

            return succeeded;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Intelligent Golf authentication failed.");
            return false;
        }
    }

    private static async Task<PageResult> GetPageAsync(
        HttpClient client,
        string path,
        CancellationToken cancellationToken)
    {
        using var response = await client.GetAsync(path, cancellationToken);
        var html = await response.Content.ReadAsStringAsync(cancellationToken);
        return new PageResult(
            response.IsSuccessStatusCode,
            response.StatusCode,
            response.RequestMessage?.RequestUri?.ToString() ?? path,
            html);
    }

    private static async Task<PageResult> PostFormAsync(
        HttpClient client,
        string path,
        IReadOnlyDictionary<string, string> fields,
        string referrerPath,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new FormUrlEncodedContent(fields)
        };
        request.Headers.Referrer = new Uri(client.BaseAddress!, referrerPath);

        using var response = await client.SendAsync(request, cancellationToken);
        var html = await response.Content.ReadAsStringAsync(cancellationToken);
        return new PageResult(
            response.IsSuccessStatusCode,
            response.StatusCode,
            response.RequestMessage?.RequestUri?.ToString() ?? path,
            html);
    }

    internal static bool RequiresMemberLogin(string html) =>
        !string.IsNullOrWhiteSpace(html) &&
        ContainsInput(html, "memberid") &&
        ContainsInput(html, "pin") &&
        html.Contains("login", StringComparison.OrdinalIgnoreCase);

    private static bool RequiresAdminPassword(string html) =>
        ContainsInput(html, "leveltwopassword");

    private static bool LooksAuthenticated(string html) =>
        !string.IsNullOrWhiteSpace(html) &&
        (html.Contains("id=\"logoutbtn\"", StringComparison.OrdinalIgnoreCase) ||
         html.Contains("?action=logout", StringComparison.OrdinalIgnoreCase) ||
         html.Contains("body-class-members", StringComparison.OrdinalIgnoreCase) ||
         html.Contains("\"auth\": \"Logged In\"", StringComparison.OrdinalIgnoreCase) ||
         html.Contains("user_level", StringComparison.OrdinalIgnoreCase) ||
         html.Contains("membertype", StringComparison.OrdinalIgnoreCase));

    private static bool ContainsCsrfFailure(string html) =>
        html.Contains("CSRF token validation failed", StringComparison.OrdinalIgnoreCase);

    private static bool ContainsInput(string html, string name) =>
        InputNameRegex(name).IsMatch(html);

    private static string? ExtractInputValue(string html, string name)
    {
        var match = InputValueRegex(name).Match(html);
        return match.Success ? WebUtility.HtmlDecode(match.Groups["value"].Value) : null;
    }

    private static Regex InputNameRegex(string name) =>
        new($"<input\\b[^>]*\\bname\\s*=\\s*[\"']{Regex.Escape(name)}[\"']", RegexOptions.IgnoreCase | RegexOptions.Singleline);

    private static Regex InputValueRegex(string name) =>
        new($"<input\\b(?=[^>]*\\bname\\s*=\\s*[\"']{Regex.Escape(name)}[\"'])(?=[^>]*\\bvalue\\s*=\\s*[\"'](?<value>[^\"']*)[\"'])[^>]*>", RegexOptions.IgnoreCase | RegexOptions.Singleline);

    private sealed record PageResult(
        bool Success,
        HttpStatusCode StatusCode,
        string FinalUri,
        string Html);
}
