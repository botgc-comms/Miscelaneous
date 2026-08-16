namespace RuleReady.Web.Models;

public enum OrganisationType
{
    Club = 1,
    Academy = 2,
    County = 3,
    GoverningBody = 4,
    Sponsor = 5,
    SoftwarePartner = 6,
    Other = 7
}

public enum OrganisationMembershipStatus
{
    SelfDeclared = 1,
    Invited = 2,
    Verified = 3,
    Removed = 4
}

public enum OrganisationMemberRole
{
    Learner = 1,
    Administrator = 2,
    Owner = 3
}

public enum LicenceProduct
{
    Individual = 1,
    Club = 2,
    Enterprise = 3,
    Platform = 4
}

public enum LicenceStatus
{
    Pending = 1,
    Active = 2,
    Cancelled = 3,
    Expired = 4
}

public sealed class Organisation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Name { get; set; }
    public required string Slug { get; set; }
    public OrganisationType Type { get; set; }
    public string? LogoUrl { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class UserOrganisation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string UserId { get; set; }
    public Guid OrganisationId { get; set; }
    public OrganisationMembershipStatus Status { get; set; }
    public OrganisationMemberRole Role { get; set; }
    public string? ClubMembershipReference { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    public ApplicationUser? User { get; set; }
    public Organisation? Organisation { get; set; }
}

public sealed class Licence
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public LicenceProduct Product { get; set; }
    public LicenceStatus Status { get; set; } = LicenceStatus.Pending;
    public string? UserId { get; set; }
    public Guid? OrganisationId { get; set; }
    public DateTimeOffset StartsAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? EndsAtUtc { get; set; }
    public string Source { get; set; } = "RuleReady";
    public string? ExternalReference { get; set; }

    public ApplicationUser? User { get; set; }
    public Organisation? Organisation { get; set; }
}
