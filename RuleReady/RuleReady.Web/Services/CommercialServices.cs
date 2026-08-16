using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using RuleReady.Web.Data;
using RuleReady.Web.Models;

namespace RuleReady.Web.Services;

public sealed class EntitlementService(AppDbContext db)
{
    public async Task<bool> HasActiveIndividualAccessAsync(string userId, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;

        if (await db.Licences.AnyAsync(x =>
                x.UserId == userId &&
                x.Status == LicenceStatus.Active &&
                x.StartsAtUtc <= now &&
                (!x.EndsAtUtc.HasValue || x.EndsAtUtc > now), cancellationToken))
        {
            return true;
        }

        var organisations = db.UserOrganisations
            .Where(x => x.UserId == userId && x.Status != OrganisationMembershipStatus.Removed)
            .Select(x => x.OrganisationId);

        return await db.Licences.AnyAsync(x =>
            x.OrganisationId.HasValue &&
            organisations.Contains(x.OrganisationId.Value) &&
            x.Status == LicenceStatus.Active &&
            x.StartsAtUtc <= now &&
            (!x.EndsAtUtc.HasValue || x.EndsAtUtc > now), cancellationToken);
    }
}

public sealed class OrganisationService(AppDbContext db)
{
    public async Task<Organisation> CreateAsync(
        string ownerUserId,
        string name,
        OrganisationType type,
        CancellationToken cancellationToken)
    {
        var slug = await CreateUniqueSlugAsync(name, cancellationToken);

        var organisation = new Organisation
        {
            Name = name.Trim(),
            Slug = slug,
            Type = type
        };

        db.Organisations.Add(organisation);
        db.UserOrganisations.Add(new UserOrganisation
        {
            UserId = ownerUserId,
            OrganisationId = organisation.Id,
            Status = OrganisationMembershipStatus.Verified,
            Role = OrganisationMemberRole.Owner
        });

        db.Licences.Add(new Licence
        {
            Product = type is OrganisationType.Club or OrganisationType.Academy
                ? LicenceProduct.Club
                : LicenceProduct.Enterprise,
            Status = LicenceStatus.Pending,
            OrganisationId = organisation.Id,
            Source = "Signup"
        });

        await db.SaveChangesAsync(cancellationToken);
        return organisation;
    }

    public async Task<IReadOnlyList<Organisation>> ListForAdministratorAsync(
        string userId,
        CancellationToken cancellationToken) =>
        await db.UserOrganisations
            .Where(x => x.UserId == userId &&
                        x.Status != OrganisationMembershipStatus.Removed &&
                        (x.Role == OrganisationMemberRole.Administrator || x.Role == OrganisationMemberRole.Owner))
            .Select(x => x.Organisation!)
            .OrderBy(x => x.Name)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<UserOrganisation>> ListForUserAsync(
        string userId,
        CancellationToken cancellationToken) =>
        await db.UserOrganisations
            .Include(x => x.Organisation)
            .Where(x => x.UserId == userId && x.Status != OrganisationMembershipStatus.Removed)
            .OrderBy(x => x.Organisation!.Name)
            .ToListAsync(cancellationToken);

    public async Task<bool> CanAdministerAsync(string userId, Guid organisationId, CancellationToken cancellationToken) =>
        await db.UserOrganisations.AnyAsync(x =>
            x.UserId == userId &&
            x.OrganisationId == organisationId &&
            x.Status != OrganisationMembershipStatus.Removed &&
            (x.Role == OrganisationMemberRole.Administrator || x.Role == OrganisationMemberRole.Owner),
            cancellationToken);

    public async Task<UserOrganisation> AssociateAsync(
        string userId,
        string organisationSlug,
        CancellationToken cancellationToken)
    {
        var organisation = await db.Organisations
            .SingleAsync(x => x.Slug == organisationSlug, cancellationToken);

        var existing = await db.UserOrganisations
            .SingleOrDefaultAsync(x => x.UserId == userId && x.OrganisationId == organisation.Id, cancellationToken);

        if (existing is not null)
        {
            return existing;
        }

        var relationship = new UserOrganisation
        {
            UserId = userId,
            OrganisationId = organisation.Id,
            Status = OrganisationMembershipStatus.SelfDeclared,
            Role = OrganisationMemberRole.Learner
        };

        db.UserOrganisations.Add(relationship);
        await db.SaveChangesAsync(cancellationToken);
        return relationship;
    }

    private async Task<string> CreateUniqueSlugAsync(string name, CancellationToken cancellationToken)
    {
        var normalised = new string(name.ToLowerInvariant()
            .Select(x => char.IsLetterOrDigit(x) ? x : '-')
            .ToArray());

        var baseSlug = string.Join("-", normalised.Split('-', StringSplitOptions.RemoveEmptyEntries));

        var candidate = string.IsNullOrWhiteSpace(baseSlug) ? $"org-{Guid.NewGuid():N}" : baseSlug;
        var suffix = 2;

        while (await db.Organisations.AnyAsync(x => x.Slug == candidate, cancellationToken))
        {
            candidate = $"{baseSlug}-{suffix++}";
        }

        return candidate;
    }
}

public sealed class CampaignService(AppDbContext db)
{
    public async Task<QuizCampaign> CreateAsync(QuizCampaign campaign, CancellationToken cancellationToken)
    {
        campaign.AccessCode = await CreateUniqueCodeAsync(cancellationToken);
        db.QuizCampaigns.Add(campaign);
        await db.SaveChangesAsync(cancellationToken);
        return campaign;
    }

    public async Task<QuizCampaign?> GetByCodeAsync(string code, CancellationToken cancellationToken) =>
        await db.QuizCampaigns
            .Include(x => x.Organisation)
            .SingleOrDefaultAsync(x => x.AccessCode == code.ToUpperInvariant() && x.IsPublished, cancellationToken);

    public async Task<IReadOnlyList<QuizCampaign>> ListAsync(Guid organisationId, CancellationToken cancellationToken) =>
        await db.QuizCampaigns
            .Where(x => x.OrganisationId == organisationId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

    private async Task<string> CreateUniqueCodeAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            Span<char> chars = stackalloc char[8];

            for (var i = 0; i < chars.Length; i++)
            {
                chars[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
            }

            var code = new string(chars);

            if (!await db.QuizCampaigns.AnyAsync(x => x.AccessCode == code, cancellationToken))
            {
                return code;
            }
        }
    }
}
