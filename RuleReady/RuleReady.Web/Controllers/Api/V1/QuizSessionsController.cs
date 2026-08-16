using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using RuleReady.Web.Models;
using RuleReady.Web.Services;

namespace RuleReady.Web.Controllers.Api.V1;

[ApiController]
[Authorize]
[Route("api/v1/quiz-sessions")]
public sealed class QuizSessionsController(
    UserManager<ApplicationUser> userManager,
    QuizService quizService) : ControllerBase
{
    public sealed record StartRequest(
        QuizMode Mode,
        QuizDifficulty Difficulty,
        string Audience,
        string LearningLevel,
        int QuestionCount,
        int PassMark,
        int? TotalTimeSeconds,
        int? SecondsPerQuestion);

    public sealed record AnswerRequest(string QuestionId, IReadOnlyList<string> SelectedAnswerIds);

    [HttpPost]
    public async Task<IActionResult> Start(StartRequest request, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        var attempt = await quizService.StartAsync(
            new StartQuizCommand(
                user.Id,
                null,
                null,
                request.Mode,
                request.Difficulty,
                request.Audience,
                request.LearningLevel,
                Math.Clamp(request.QuestionCount, 1, 100),
                Math.Clamp(request.PassMark, 0, request.QuestionCount),
                request.TotalTimeSeconds,
                request.SecondsPerQuestion,
                null),
            cancellationToken);

        var next = await quizService.GetNextQuestionAsync(user.Id, attempt.AttemptId, cancellationToken);

        return Ok(new
        {
            sessionId = attempt.AttemptId,
            attempt.Mode,
            attempt.Difficulty,
            attempt.TotalQuestions,
            attempt.PassMark,
            attempt.ExpiresAtUtc,
            question = next
        });
    }

    [HttpGet("{sessionId}")]
    public async Task<IActionResult> Get(string sessionId, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        var attempt = await quizService.GetAttemptAsync(user.Id, sessionId, cancellationToken);
        if (attempt is null)
        {
            return NotFound();
        }

        var next = attempt.Status == QuizAttemptStatus.InProgress
            ? await quizService.GetNextQuestionAsync(user.Id, sessionId, cancellationToken)
            : null;

        return Ok(new
        {
            sessionId = attempt.AttemptId,
            status = attempt.Status.ToString(),
            attempt.CorrectCount,
            attempt.TotalQuestions,
            attempt.PassMark,
            attempt.ExpiresAtUtc,
            question = next
        });
    }

    [HttpPost("{sessionId}/answers")]
    public async Task<IActionResult> Answer(
        string sessionId,
        AnswerRequest request,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        var result = await quizService.AnswerAsync(
            user.Id,
            sessionId,
            request.QuestionId,
            request.SelectedAnswerIds,
            cancellationToken);

        return result is null ? NotFound() : Ok(result);
    }

    [HttpGet("{sessionId}/result")]
    public async Task<IActionResult> Result(string sessionId, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        var attempt = await quizService.GetAttemptAsync(user.Id, sessionId, cancellationToken);
        if (attempt is null)
        {
            return NotFound();
        }

        return Ok(new
        {
            sessionId = attempt.AttemptId,
            status = attempt.Status.ToString(),
            attempt.CorrectCount,
            attempt.TotalQuestions,
            attempt.PassMark,
            passed = attempt.Status == QuizAttemptStatus.Finished && attempt.CorrectCount >= attempt.PassMark,
            attempt.StartedAtUtc,
            attempt.FinishedAtUtc
        });
    }
}
