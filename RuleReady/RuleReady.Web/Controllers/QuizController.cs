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
[Route("quiz")]
public sealed class QuizController(
    UserManager<ApplicationUser> userManager,
    QuizService quizService,
    CampaignService campaignService,
    AppDbContext db) : Controller
{
    [HttpGet("new")]
    public IActionResult New() => View(new StartPersonalQuizViewModel());

    [ValidateAntiForgeryToken]
    [HttpPost("new")]
    public async Task<IActionResult> New(StartPersonalQuizViewModel model, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Challenge();
        }

        var attempt = await quizService.StartAsync(
            new StartQuizCommand(
                user.Id,
                null,
                null,
                model.Mode,
                model.Difficulty,
                model.Audience,
                model.LearningLevel,
                Math.Clamp(model.QuestionCount, 1, 100),
                Math.Clamp(model.PassMark, 0, model.QuestionCount),
                model.Mode == QuizMode.TimedSitting ? Math.Max(60, model.TotalTimeMinutes * 60) : null,
                model.Mode == QuizMode.PerQuestionCountdown ? Math.Max(5, model.SecondsPerQuestion) : null,
                null),
            cancellationToken);

        return Redirect($"/quiz/{attempt.AttemptId}");
    }

    [HttpGet("join")]
    public IActionResult Join() => View();

    [ValidateAntiForgeryToken]
    [HttpPost("join")]
    public async Task<IActionResult> Join(string accessCode, CancellationToken cancellationToken)
    {
        var campaign = await campaignService.GetByCodeAsync(accessCode.Trim(), cancellationToken);

        if (campaign is null)
        {
            ModelState.AddModelError(string.Empty, "That quiz code was not recognised.");
            return View();
        }

        var now = DateTimeOffset.UtcNow;
        if (campaign.OpensAtUtc.HasValue && campaign.OpensAtUtc > now ||
            campaign.ClosesAtUtc.HasValue && campaign.ClosesAtUtc <= now)
        {
            ModelState.AddModelError(string.Empty, "That quiz is not currently available.");
            return View();
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Challenge();
        }

        if (!campaign.AllowMultipleAttempts)
        {
            var alreadyAttempted = await db.QuizAttempts.AnyAsync(
                x => x.UserId == user.Id && x.CampaignId == campaign.Id,
                cancellationToken);

            if (alreadyAttempted)
            {
                ModelState.AddModelError(string.Empty, "You have already attempted this quiz.");
                return View();
            }
        }

        var attempt = await quizService.StartAsync(
            new StartQuizCommand(
                user.Id,
                campaign.OrganisationId,
                campaign.Id,
                campaign.Mode,
                campaign.Difficulty,
                campaign.Audience,
                campaign.LearningLevel,
                campaign.QuestionCount,
                campaign.PassMark,
                campaign.TotalTimeSeconds,
                campaign.SecondsPerQuestion,
                null),
            cancellationToken);

        return Redirect($"/quiz/{attempt.AttemptId}");
    }

    [HttpGet("{attemptId}")]
    public async Task<IActionResult> Attempt(string attemptId, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Challenge();
        }

        var attempt = await quizService.GetAttemptAsync(user.Id, attemptId, cancellationToken);

        if (attempt is null)
        {
            return NotFound();
        }

        if (attempt.Status != QuizAttemptStatus.InProgress)
        {
            return Redirect($"/quiz/{attemptId}/result");
        }

        var question = await quizService.GetNextQuestionAsync(user.Id, attemptId, cancellationToken);

        if (question is null)
        {
            return Redirect($"/quiz/{attemptId}/result");
        }

        ViewData["Attempt"] = attempt;
        return View("Question", question);
    }

    [ValidateAntiForgeryToken]
    [HttpPost("{attemptId}/answer")]
    public async Task<IActionResult> Answer(
        string attemptId,
        AnswerQuestionViewModel model,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Challenge();
        }

        var result = await quizService.AnswerAsync(
            user.Id,
            attemptId,
            model.QuestionId,
            model.SelectedAnswerIds,
            cancellationToken);

        if (result is null)
        {
            return Redirect($"/quiz/{attemptId}");
        }

        TempData["AnswerFeedback"] = result.IsCorrect
            ? "Correct"
            : result.TimedOut ? "Time expired" : "Not quite";

        TempData["AnswerExplanation"] = result.Explanation;

        return result.IsFinished
            ? Redirect($"/quiz/{attemptId}/result")
            : Redirect($"/quiz/{attemptId}");
    }

    [HttpGet("{attemptId}/result")]
    public async Task<IActionResult> Result(string attemptId, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Challenge();
        }

        var attempt = await quizService.GetAttemptAsync(user.Id, attemptId, cancellationToken);

        if (attempt is null)
        {
            return NotFound();
        }

        ViewData["Snapshots"] = quizService.GetSnapshots(attempt);
        return View(attempt);
    }
}
