using System.Security.Cryptography;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using Microsoft.AspNetCore.WebUtilities;

namespace BOTGC.EventPlaybook.Services;

public interface IFeedbackStore
{
    Task<FeedbackCampaign> UpsertCampaignAsync(string eventId, UpsertFeedbackCampaignRequest request, CancellationToken cancellationToken);
    Task<FeedbackEventData> GetForEventAsync(string eventId, CancellationToken cancellationToken);
    Task<FeedbackCampaign?> GetPublicCampaignAsync(string token, CancellationToken cancellationToken);
    Task<bool> SubmitAsync(string token, SubmitFeedbackRequest request, CancellationToken cancellationToken);
}

public sealed class FeedbackStore : IFeedbackStore
{
    private const int MaximumAnswerLength = 4_000;
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public FeedbackStore(IWebHostEnvironment environment)
    {
        var directory = Path.Combine(environment.ContentRootPath, "App_Data");
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "event-feedback.json");
    }

    public async Task<FeedbackCampaign> UpsertCampaignAsync(string eventId, UpsertFeedbackCampaignRequest request, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            var campaign = document.Campaigns.SingleOrDefault(candidate =>
                string.Equals(candidate.EventId, eventId, StringComparison.OrdinalIgnoreCase));
            var now = DateTimeOffset.UtcNow;
            var questions = CreateDefaultQuestions(request.CustomQuestion);

            if (campaign is null)
            {
                campaign = new FeedbackCampaign
                {
                    Id = Guid.NewGuid().ToString("N"),
                    EventId = eventId,
                    EventName = request.EventName.Trim(),
                    PublicToken = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(24)),
                    EventDate = NormaliseDate(request.EventDate),
                    IsOpen = request.IsOpen,
                    OpensOn = NormaliseDate(request.OpensOn),
                    ClosesOn = NormaliseDate(request.ClosesOn),
                    Questions = questions,
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now
                };
                document.Campaigns.Add(campaign);
            }
            else
            {
                campaign.EventName = request.EventName.Trim();
                campaign.EventDate = NormaliseDate(request.EventDate);
                campaign.IsOpen = request.IsOpen;
                campaign.OpensOn = NormaliseDate(request.OpensOn);
                campaign.ClosesOn = NormaliseDate(request.ClosesOn);
                campaign.Questions = questions;
                campaign.UpdatedAtUtc = now;
            }

            await SaveAsync(document, cancellationToken);
            return campaign;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<FeedbackEventData> GetForEventAsync(string eventId, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            var campaign = document.Campaigns.SingleOrDefault(candidate =>
                string.Equals(candidate.EventId, eventId, StringComparison.OrdinalIgnoreCase));
            if (campaign is null)
            {
                return new FeedbackEventData();
            }

            return new FeedbackEventData
            {
                Campaign = campaign,
                Responses = document.Responses
                    .Where(response => string.Equals(response.CampaignId, campaign.Id, StringComparison.Ordinal))
                    .OrderByDescending(response => response.SubmittedAtUtc)
                    .ToList()
            };
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<FeedbackCampaign?> GetPublicCampaignAsync(string token, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            return document.Campaigns.SingleOrDefault(candidate =>
                string.Equals(candidate.PublicToken, token, StringComparison.Ordinal));
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> SubmitAsync(string token, SubmitFeedbackRequest request, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            var campaign = document.Campaigns.SingleOrDefault(candidate =>
                string.Equals(candidate.PublicToken, token, StringComparison.Ordinal));
            if (campaign is null || !IsAcceptingResponses(campaign))
            {
                return false;
            }

            // This honeypot field is hidden from people. Pretend success for bots without storing their response.
            if (!string.IsNullOrWhiteSpace(request.Website))
            {
                return true;
            }

            var knownQuestions = campaign.Questions.ToDictionary(question => question.Id, StringComparer.Ordinal);
            var answers = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            foreach (var (questionId, answer) in request.Answers)
            {
                if (!knownQuestions.TryGetValue(questionId, out var question))
                {
                    continue;
                }

                ValidateAnswer(question, answer);
                answers[questionId] = answer.Clone();
            }

            foreach (var question in campaign.Questions.Where(question => question.Required))
            {
                if (!answers.TryGetValue(question.Id, out var answer) || IsEmpty(answer))
                {
                    throw new InvalidOperationException($"Please answer ‘{question.Label}’.");
                }
            }

            document.Responses.Add(new FeedbackResponse
            {
                Id = Guid.NewGuid().ToString("N"),
                CampaignId = campaign.Id,
                SubmittedAtUtc = DateTimeOffset.UtcNow,
                Answers = answers
            });
            await SaveAsync(document, cancellationToken);
            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    public static bool IsAcceptingResponses(FeedbackCampaign campaign)
    {
        if (!campaign.IsOpen)
        {
            return false;
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (DateOnly.TryParse(campaign.OpensOn, out var opensOn) && today < opensOn)
        {
            return false;
        }

        return !DateOnly.TryParse(campaign.ClosesOn, out var closesOn) || today <= closesOn;
    }

    private static void ValidateAnswer(FeedbackQuestion question, JsonElement answer)
    {
        if (answer.ValueKind != JsonValueKind.String)
        {
            throw new InvalidOperationException($"The answer to ‘{question.Label}’ is invalid.");
        }

        var value = answer.GetString()?.Trim() ?? string.Empty;
        if (value.Length > MaximumAnswerLength)
        {
            throw new InvalidOperationException($"The answer to ‘{question.Label}’ is too long.");
        }

        if (question.Type == "rating" && value.Length > 0 && value is not ("1" or "2" or "3" or "4" or "5"))
        {
            throw new InvalidOperationException($"The answer to ‘{question.Label}’ is invalid.");
        }

        if (question.Type == "choice" && value.Length > 0 && !question.Options.Contains(value, StringComparer.Ordinal))
        {
            throw new InvalidOperationException($"The answer to ‘{question.Label}’ is invalid.");
        }
    }

    private static bool IsEmpty(JsonElement answer) =>
        answer.ValueKind == JsonValueKind.Null ||
        (answer.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(answer.GetString()));

    private static List<FeedbackQuestion> CreateDefaultQuestions(string? customQuestion)
    {
        var questions = new List<FeedbackQuestion>
        {
            new() { Id = "overall-rating", Label = "Overall, how would you rate this event?", Type = "rating", Required = true },
            new() { Id = "organisation-rating", Label = "How well organised did the event feel?", Type = "rating", TargetModuleId = "start", TargetSectionId = "event-basics" },
            new() { Id = "communications-rating", Label = "How clear and timely were the event communications?", Type = "rating", TargetModuleId = "communications", TargetSectionId = "communications-plan" },
            new() { Id = "food-drink-rating", Label = "How would you rate the food and drink arrangements?", Type = "choice", Options = ["Excellent", "Good", "Okay", "Poor", "Not applicable"], TargetModuleId = "catering", TargetSectionId = "menu", TargetItemIds = ["agree-menu-task"] },
            new() { Id = "dietary-choice-comment", Label = "Were there food, dietary or non-spicy options you would have liked?", Type = "text", TargetModuleId = "catering", TargetSectionId = "menu", TargetItemIds = ["different-menu", "agree-menu-task"] },
            new() { Id = "worked-well", Label = "What worked particularly well?", Type = "text" },
            new() { Id = "improve-next-time", Label = "What should we change if we run this event again?", Type = "text" }
        };

        if (!string.IsNullOrWhiteSpace(customQuestion))
        {
            questions.Add(new FeedbackQuestion
            {
                Id = "custom-question",
                Label = customQuestion.Trim(),
                Type = "text"
            });
        }

        return questions;
    }

    private async Task<FeedbackDataDocument> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path))
        {
            return new FeedbackDataDocument();
        }

        await using var stream = File.OpenRead(_path);
        return await JsonSerializer.DeserializeAsync<FeedbackDataDocument>(stream, _jsonOptions, cancellationToken)
            ?? new FeedbackDataDocument();
    }

    private async Task SaveAsync(FeedbackDataDocument document, CancellationToken cancellationToken)
    {
        var temporaryPath = _path + ".tmp";
        await using (var stream = File.Create(temporaryPath))
        {
            await JsonSerializer.SerializeAsync(stream, document, _jsonOptions, cancellationToken);
        }

        File.Move(temporaryPath, _path, true);
    }

    private static string? NormaliseDate(string? value) =>
        DateOnly.TryParse(value, out var date) ? date.ToString("yyyy-MM-dd") : null;
}
