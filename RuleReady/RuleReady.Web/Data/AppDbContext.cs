using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using RuleReady.Web.Models;

namespace RuleReady.Web.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<Organisation> Organisations => Set<Organisation>();
    public DbSet<UserOrganisation> UserOrganisations => Set<UserOrganisation>();
    public DbSet<Licence> Licences => Set<Licence>();
    public DbSet<QuizCampaign> QuizCampaigns => Set<QuizCampaign>();
    public DbSet<QuizAttempt> QuizAttempts => Set<QuizAttempt>();
    public DbSet<QuestionAttempt> QuestionAttempts => Set<QuestionAttempt>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<ApplicationUser>()
            .HasIndex(x => x.RuleReadyUserId)
            .IsUnique();

        builder.Entity<ApplicationUser>()
            .HasIndex(x => x.EnglandGolfMembershipNumber)
            .IsUnique();

        builder.Entity<Organisation>()
            .HasIndex(x => x.Slug)
            .IsUnique();

        builder.Entity<UserOrganisation>()
            .HasIndex(x => new { x.UserId, x.OrganisationId })
            .IsUnique();

        builder.Entity<UserOrganisation>()
            .HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<UserOrganisation>()
            .HasOne(x => x.Organisation)
            .WithMany()
            .HasForeignKey(x => x.OrganisationId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<Licence>()
            .HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.Entity<Licence>()
            .HasOne(x => x.Organisation)
            .WithMany()
            .HasForeignKey(x => x.OrganisationId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.Entity<QuizCampaign>()
            .HasIndex(x => x.AccessCode)
            .IsUnique();

        builder.Entity<QuizAttempt>()
            .HasIndex(x => x.AttemptId)
            .IsUnique();

        builder.Entity<QuizAttempt>()
            .HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<QuizAttempt>()
            .HasOne(x => x.Organisation)
            .WithMany()
            .HasForeignKey(x => x.OrganisationId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.Entity<QuizAttempt>()
            .HasOne(x => x.Campaign)
            .WithMany()
            .HasForeignKey(x => x.CampaignId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.Entity<QuestionAttempt>()
            .HasIndex(x => new { x.QuizAttemptId, x.QuestionId })
            .IsUnique();

        builder.Entity<QuestionAttempt>()
            .HasOne(x => x.QuizAttempt)
            .WithMany(x => x.Answers)
            .HasForeignKey(x => x.QuizAttemptId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
