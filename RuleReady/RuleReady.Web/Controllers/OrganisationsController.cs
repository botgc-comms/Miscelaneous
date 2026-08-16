using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RuleReady.Web.Data;
using RuleReady.Web.Models;
using RuleReady.Web.Services;
using RuleReady.Web.ViewModels;

namespace RuleReady.Web.Controllers;

[Authorize]
[Route("organisations")]
public sealed class OrganisationsController(
    UserManager<ApplicationUser> userManager,
    OrganisationService organisationService,
    CampaignService campaignService,
    AppDbContext db) : Controller
{
    [HttpGet("create")]
    public IActionResult Create([FromQuery] OrganisationType type = OrganisationType.Club) =>
        View(new CreateOrganisationViewModel { Type = type });

    [ValidateAntiForgeryToken]
    [HttpPost("create")]
    public async Task<IActionResult> Create(CreateOrganisationViewModel model, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(model.Name))
        {
            ModelState.AddModelError(nameof(model.Name), "Organisation name is required.");
            return View(model);
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Challenge();
        }

        var organisation = await organisationService.CreateAsync(user.Id, model.Name, model.Type, cancellationToken);
        return Redirect($"/organisations/{organisation.Id}");
    }

    [HttpGet("{organisationId:guid}")]
    public async Task<IActionResult> Details(Guid organisationId, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null || !await organisationService.CanAdministerAsync(user.Id, organisationId, cancellationToken))
        {
            return Forbid();
        }

        var organisation = await db.Organisations.FindAsync([organisationId], cancellationToken);
        if (organisation is null)
        {
            return NotFound();
        }

        ViewData["Campaigns"] = await campaignService.ListAsync(organisationId, cancellationToken);

        var attempts = await db.QuizAttempts
            .Where(x => x.OrganisationId == organisationId && x.Status == QuizAttemptStatus.Finished)
            .ToListAsync(cancellationToken);

        ViewData["AttemptCount"] = attempts.Count;
        ViewData["AverageScore"] = attempts.Count == 0
            ? 0d
            : attempts.Average(x => x.TotalQuestions == 0 ? 0d : (double)x.CorrectCount / x.TotalQuestions * 100d);

        return View(organisation);
    }

    [HttpGet("{organisationId:guid}/campaigns/new")]
    public async Task<IActionResult> NewCampaign(Guid organisationId, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null || !await organisationService.CanAdministerAsync(user.Id, organisationId, cancellationToken))
        {
            return Forbid();
        }

        return View(new CampaignCreateViewModel { OrganisationId = organisationId });
    }

    [ValidateAntiForgeryToken]
    [HttpPost("{organisationId:guid}/campaigns/new")]
    public async Task<IActionResult> NewCampaign(
        Guid organisationId,
        CampaignCreateViewModel model,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null || !await organisationService.CanAdministerAsync(user.Id, organisationId, cancellationToken))
        {
            return Forbid();
        }

        if (string.IsNullOrWhiteSpace(model.Name))
        {
            ModelState.AddModelError(nameof(model.Name), "Quiz name is required.");
            return View(model);
        }

        var campaign = new QuizCampaign
        {
            OrganisationId = organisationId,
            Name = model.Name.Trim(),
            AccessCode = string.Empty,
            Mode = model.Mode,
            Difficulty = model.Difficulty,
            Audience = model.Audience,
            LearningLevel = model.LearningLevel,
            QuestionCount = Math.Clamp(model.QuestionCount, 1, 100),
            PassMark = Math.Clamp(model.PassMark, 0, model.QuestionCount),
            TotalTimeSeconds = model.Mode == QuizMode.TimedSitting
                ? Math.Max(60, model.TotalTimeMinutes * 60)
                : null,
            SecondsPerQuestion = model.Mode == QuizMode.PerQuestionCountdown
                ? Math.Max(5, model.SecondsPerQuestion)
                : null,
            OpensAtUtc = model.OpensAtUtc,
            ClosesAtUtc = model.ClosesAtUtc,
            AllowMultipleAttempts = model.AllowMultipleAttempts,
            IsPublished = true
        };

        await campaignService.CreateAsync(campaign, cancellationToken);
        return Redirect($"/organisations/{organisationId}");
    }

    [ValidateAntiForgeryToken]
    [HttpPost("associate")]
    public async Task<IActionResult> Associate(string organisationSlug, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Challenge();
        }

        await organisationService.AssociateAsync(user.Id, organisationSlug.Trim(), cancellationToken);
        return Redirect("/dashboard");
    }
}
