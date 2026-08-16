namespace RuleReady.Web.Services;

public interface IAppEmailSender
{
    Task SendAsync(string recipient, string subject, string body, CancellationToken cancellationToken);
}

public sealed class FileEmailSender(
    IWebHostEnvironment environment,
    IConfiguration configuration) : IAppEmailSender
{
    public async Task SendAsync(string recipient, string subject, string body, CancellationToken cancellationToken)
    {
        var configured = configuration["Email:OutputDirectory"] ?? "App_Data/emails";
        var directory = Path.Combine(environment.ContentRootPath, configured);
        Directory.CreateDirectory(directory);

        var safeRecipient = string.Concat(recipient.Select(x => char.IsLetterOrDigit(x) ? x : '_'));
        var path = Path.Combine(directory, $"{DateTime.UtcNow:yyyyMMddHHmmssfff}-{safeRecipient}.txt");

        await File.WriteAllTextAsync(
            path,
            $"To: {recipient}{Environment.NewLine}Subject: {subject}{Environment.NewLine}{Environment.NewLine}{body}",
            cancellationToken);
    }
}
