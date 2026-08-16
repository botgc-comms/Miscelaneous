using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RuleReady.Web.Data;
using RuleReady.Web.Models;

namespace RuleReady.Web.Services;

public sealed class QuizSelectionEngine(IQuizQuestionProvider provider)
{
    public async Task<(string ContentVersion, IReadOnlyList<QuizQuestion> Questions)> SelectAsync(
        int count,
        QuizDifficulty difficulty,
        string audience,
        string learningLevel,
        IReadOnlySet<string>? excludedQuestionIds,
        CancellationToken cancellationToken)
    {
        var snapshot = await provider.GetSnapshotAsync(cancellationToken);
        var selected = new List<QuizQuestion>();
        var selectedIds = new HashSet<string>(StringComparer.Ordinal);
        var excluded = excludedQuestionIds ?? new HashSet<string>(StringComparer.Ordinal);

        foreach (var tier in DifficultyFallback(difficulty))
        {
            var pool = snapshot.Questions
                .Where(x => x.Difficulty == tier)
                .Where(x => !excluded.Contains(x.Id))
                .Where(x => !selectedIds.Contains(x.Id))
                .Select(x => ApplyVariant(x, audience, learningLevel))
                .ToList();

            Shuffle(pool);

            foreach (var question in pool)
            {
                if (selected.Count >= count)
                {
                    break;
                }

                if (selectedIds.Add(question.Id))
                {
                    selected.Add(question);
                }
            }

            if (selected.Count >= count)
            {
                break;
            }
        }

        return (FileQuizContentSource.GetContentVersion(snapshot), selected);
    }

    private static QuizQuestion ApplyVariant(QuizQuestion question, string audience, string learningLevel)
    {
        var variant =
            question.Variants.FirstOrDefault(x =>
                x.Audience.Equals(audience, StringComparison.OrdinalIgnoreCase) &&
                x.LearningLevel.Equals(learningLevel, StringComparison.OrdinalIgnoreCase))
            ?? question.Variants.FirstOrDefault(x =>
                x.Audience.Equals(audience, StringComparison.OrdinalIgnoreCase))
            ?? question.Variants.FirstOrDefault()
            ?? throw new InvalidOperationException($"Question {question.Id} has no variants.");

        return question with
        {
            Question = variant.Question,
            Type = variant.Type,
            Choices = variant.Choices,
            CorrectAnswers = variant.CorrectAnswers,
            Explanation = variant.Explanation,
            Vocabulary = variant.Vocabulary,
            TeachingTip = variant.TeachingTip,
            LikelyMisconceptions = variant.LikelyMisconceptions
        };
    }

    private static IEnumerable<QuizDifficulty> DifficultyFallback(QuizDifficulty difficulty) =>
        difficulty switch
        {
            QuizDifficulty.Hard => [QuizDifficulty.Hard, QuizDifficulty.Medium, QuizDifficulty.Easy],
            QuizDifficulty.Medium => [QuizDifficulty.Medium, QuizDifficulty.Easy],
            _ => [QuizDifficulty.Easy]
        };

    private static void Shuffle<T>(IList<T> values)
    {
        for (var i = values.Count - 1; i > 0; i--)
        {
            var j = RandomNumberGenerator.GetInt32(i + 1);
            (values[i], values[j]) = (values[j], values[i]);
        }
    }
}

public sealed record StartQuizCommand(
    string UserId,
    Guid? OrganisationId,
    Guid? CampaignId,
    QuizMode Mode,
    QuizDifficulty Difficulty,
    string Audience,
    string LearningLevel,
    int QuestionCount,
    int PassMark,
    int? TotalTimeSeconds,
    int? SecondsPerQuestion,
    IReadOnlySet<string>? ExcludedQuestionIds);

public sealed record QuizQuestionForUser(
    string Id,
    int Number,
    int Total,
    string Text,
    string Type,
    string? ImageUrl,
    string? ImageAlt,
    bool AllowMultipleAnswers,
    IReadOnlyList<QuizChoice> Choices,
    IReadOnlyList<VocabularyItem> Vocabulary,
    int? SecondsRemaining);

public sealed record AnswerQuizResult(
    bool IsCorrect,
    bool TimedOut,
    IReadOnlyList<string> CorrectAnswerIds,
    string Explanation,
    int CorrectCount,
    int TotalQuestions,
    bool IsFinished);

public sealed class QuizService(
    AppDbContext db,
    QuizSelectionEngine selectionEngine)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<QuizAttempt> StartAsync(StartQuizCommand command, CancellationToken cancellationToken)
    {
        var (contentVersion, selected) = await selectionEngine.SelectAsync(
            command.QuestionCount,
            command.Difficulty,
            command.Audience,
            command.LearningLevel,
            command.ExcludedQuestionIds,
            cancellationToken);

        if (selected.Count == 0)
        {
            throw new InvalidOperationException("No quiz questions are available for the selected settings.");
        }

        var now = DateTimeOffset.UtcNow;
        var attempt = new QuizAttempt
        {
            AttemptId = CreateAttemptId(),
            UserId = command.UserId,
            OrganisationId = command.OrganisationId,
            CampaignId = command.CampaignId,
            Mode = command.Mode,
            Difficulty = command.Difficulty,
            Audience = command.Audience,
            LearningLevel = command.LearningLevel,
            StartedAtUtc = now,
            ExpiresAtUtc = command.Mode == QuizMode.TimedSitting && command.TotalTimeSeconds.HasValue
                ? now.AddSeconds(command.TotalTimeSeconds.Value)
                : null,
            SecondsPerQuestion = command.Mode == QuizMode.PerQuestionCountdown ? command.SecondsPerQuestion : null,
            CurrentQuestionStartedAtUtc = command.Mode == QuizMode.PerQuestionCountdown ? now : null,
            TotalQuestions = selected.Count,
            PassMark = Math.Min(command.PassMark, selected.Count),
            ContentVersion = contentVersion,
            QuestionIdsJson = JsonSerializer.Serialize(selected.Select(x => x.Id), JsonOptions),
            QuestionsSnapshotJson = JsonSerializer.Serialize(selected.Select(ToSnapshot), JsonOptions)
        };

        db.QuizAttempts.Add(attempt);
        await db.SaveChangesAsync(cancellationToken);
        return attempt;
    }

    public async Task<QuizAttempt?> GetAttemptAsync(string userId, string attemptId, CancellationToken cancellationToken)
    {
        var attempt = await db.QuizAttempts
            .Include(x => x.Answers)
            .FirstOrDefaultAsync(x => x.UserId == userId && x.AttemptId == attemptId, cancellationToken);

        if (attempt is null)
        {
            return null;
        }

        await ExpireIfNeededAsync(attempt, cancellationToken);
        return attempt;
    }

    public async Task<QuizQuestionForUser?> GetNextQuestionAsync(string userId, string attemptId, CancellationToken cancellationToken)
    {
        var attempt = await GetAttemptAsync(userId, attemptId, cancellationToken);

        if (attempt is null || attempt.Status != QuizAttemptStatus.InProgress)
        {
            return null;
        }

        var snapshots = ReadSnapshots(attempt);
        var answered = attempt.Answers.Select(x => x.QuestionId).ToHashSet(StringComparer.Ordinal);
        var next = snapshots.FirstOrDefault(x => !answered.Contains(x.Id));

        if (next is null)
        {
            await FinishAsync(attempt, cancellationToken);
            return null;
        }

        var number = snapshots.FindIndex(x => x.Id == next.Id) + 1;

        if (attempt.Mode == QuizMode.PerQuestionCountdown && attempt.CurrentQuestionStartedAtUtc is null)
        {
            attempt.CurrentQuestionStartedAtUtc = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
        }

        return new QuizQuestionForUser(
            next.Id,
            number,
            attempt.TotalQuestions,
            next.Question,
            next.Type,
            next.ImageUrl,
            next.ImageAlt,
            next.CorrectAnswers.Count > 1,
            next.Choices,
            next.Vocabulary,
            GetQuestionSecondsRemaining(attempt));
    }

    public async Task<AnswerQuizResult?> AnswerAsync(
        string userId,
        string attemptId,
        string questionId,
        IReadOnlyList<string> selectedAnswerIds,
        CancellationToken cancellationToken)
    {
        var attempt = await GetAttemptAsync(userId, attemptId, cancellationToken);

        if (attempt is null || attempt.Status != QuizAttemptStatus.InProgress)
        {
            return null;
        }

        var snapshots = ReadSnapshots(attempt);
        var question = snapshots.FirstOrDefault(x => x.Id == questionId);

        if (question is null)
        {
            return null;
        }

        var existing = attempt.Answers.FirstOrDefault(x => x.QuestionId == questionId);
        if (existing is not null)
        {
            return null;
        }

        var timedOut = attempt.Mode == QuizMode.PerQuestionCountdown &&
                       GetQuestionSecondsRemaining(attempt) is <= 0;

        var selected = timedOut
            ? []
            : selectedAnswerIds.Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.Ordinal)
                .Order(StringComparer.Ordinal)
                .ToArray();

        var correct = question.CorrectAnswers
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();

        var isCorrect = !timedOut && selected.SequenceEqual(correct);
        var index = snapshots.FindIndex(x => x.Id == questionId);

        attempt.Answers.Add(new QuestionAttempt
        {
            QuizAttemptId = attempt.Id,
            QuestionId = questionId,
            QuestionIndex = index,
            SelectedAnswerIdsJson = JsonSerializer.Serialize(selected, JsonOptions),
            IsCorrect = isCorrect,
            TimedOut = timedOut,
            AnsweredAtUtc = DateTimeOffset.UtcNow
        });

        if (isCorrect)
        {
            attempt.CorrectCount++;
        }

        var answeredCount = attempt.Answers.Count;
        var finished = answeredCount >= attempt.TotalQuestions;

        if (finished)
        {
            await FinishAsync(attempt, cancellationToken);
        }
        else
        {
            attempt.CurrentQuestionStartedAtUtc =
                attempt.Mode == QuizMode.PerQuestionCountdown ? DateTimeOffset.UtcNow : null;

            await db.SaveChangesAsync(cancellationToken);
        }

        return new AnswerQuizResult(
            isCorrect,
            timedOut,
            correct,
            question.Explanation,
            attempt.CorrectCount,
            attempt.TotalQuestions,
            attempt.Status == QuizAttemptStatus.Finished);
    }

    public async Task<IReadOnlyList<QuizAttempt>> ListForUserAsync(string userId, CancellationToken cancellationToken) =>
        await db.QuizAttempts
            .Where(x => x.UserId == userId)
            .OrderByDescending(x => x.StartedAtUtc)
            .Take(50)
            .ToListAsync(cancellationToken);

    public IReadOnlyList<QuizAttemptQuestionSnapshot> GetSnapshots(QuizAttempt attempt) => ReadSnapshots(attempt);

    public IReadOnlyList<string> GetSelectedAnswerIds(QuestionAttempt answer) =>
        JsonSerializer.Deserialize<string[]>(answer.SelectedAnswerIdsJson, JsonOptions) ?? [];

    private async Task ExpireIfNeededAsync(QuizAttempt attempt, CancellationToken cancellationToken)
    {
        if (attempt.Status != QuizAttemptStatus.InProgress)
        {
            return;
        }

        if (attempt.Mode == QuizMode.TimedSitting &&
            attempt.ExpiresAtUtc.HasValue &&
            DateTimeOffset.UtcNow >= attempt.ExpiresAtUtc.Value)
        {
            attempt.Status = QuizAttemptStatus.Expired;
            attempt.FinishedAtUtc = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task FinishAsync(QuizAttempt attempt, CancellationToken cancellationToken)
    {
        attempt.Status = QuizAttemptStatus.Finished;
        attempt.FinishedAtUtc = DateTimeOffset.UtcNow;
        attempt.CurrentQuestionStartedAtUtc = null;
        await db.SaveChangesAsync(cancellationToken);
    }

    private static int? GetQuestionSecondsRemaining(QuizAttempt attempt)
    {
        if (attempt.Mode != QuizMode.PerQuestionCountdown ||
            !attempt.SecondsPerQuestion.HasValue ||
            !attempt.CurrentQuestionStartedAtUtc.HasValue)
        {
            return null;
        }

        var elapsed = (int)Math.Floor((DateTimeOffset.UtcNow - attempt.CurrentQuestionStartedAtUtc.Value).TotalSeconds);
        return Math.Max(0, attempt.SecondsPerQuestion.Value - elapsed);
    }

    private static List<QuizAttemptQuestionSnapshot> ReadSnapshots(QuizAttempt attempt) =>
        JsonSerializer.Deserialize<List<QuizAttemptQuestionSnapshot>>(attempt.QuestionsSnapshotJson, JsonOptions) ?? [];

    private static QuizAttemptQuestionSnapshot ToSnapshot(QuizQuestion question) =>
        new(
            question.Id,
            question.RuleNumber,
            question.RuleName,
            question.Topic,
            question.Question,
            question.Type,
            question.Choices,
            question.CorrectAnswers,
            question.Explanation,
            question.ImageUrl,
            question.ImageAlt,
            question.Vocabulary,
            question.TeachingTip,
            question.LikelyMisconceptions);

    private static string CreateAttemptId()
    {
        Span<byte> bytes = stackalloc byte[16];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
