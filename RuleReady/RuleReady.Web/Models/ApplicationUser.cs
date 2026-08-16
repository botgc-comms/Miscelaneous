using Microsoft.AspNetCore.Identity;

namespace RuleReady.Web.Models;

public sealed class ApplicationUser : IdentityUser
{
    public string RuleReadyUserId { get; set; } = $"rru_{Guid.NewGuid():N}";
    public string? DisplayName { get; set; }
    public string? EnglandGolfMembershipNumber { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}
