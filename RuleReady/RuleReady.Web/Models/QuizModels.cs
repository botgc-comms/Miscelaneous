namespace RuleReady.Web.Models;

public enum QuizDifficulty
{
    Easy = 1,
    Medium = 2,
    Hard = 3
}

public enum QuizMode
{
    OwnTime = 1,
    TimedSitting = 2,
    PerQuestionCountdown = 3
}

public enum QuizAttemptStatus
{
    InProgress = 1,
    Finished = 2,
    Expired = 3,
    Abandoned = 4
}

public sealed record QuizChoice(string Id, string Text);

public sealed record VocabularyItem(string Term, string SimpleMeaning);

public sealed record QuizQuestionVariant(
    string Audience,
    string LearningLevel,
    string Question,
    string Type,
    IReadOnlyList<QuizChoice> Choices,
    IReadOnlyList<string> CorrectAnswers,
    string Explanation,
    IReadOnlyList<VocabularyItem> Vocabulary,
    string TeachingTip,
    IReadOnlyList<string> LikelyMisconceptions);

public sealed record QuizQuestion(
    string Id,
    string RuleNumber,
    string RuleName,
    string Topic,
    QuizDifficulty Difficulty,
    string Question,
    string Type,
    IReadOnlyList<QuizChoice> Choices,
    IReadOnlyList<string> CorrectAnswers,
    string Explanation,
    string? ImageUrl,
    string? ImageAlt,
    IReadOnlyList<QuizQuestionVariant> Variants,
    IReadOnlyList<VocabularyItem> Vocabulary,
    string TeachingTip,
    IReadOnlyList<string> LikelyMisconceptions);

public sealed record QuizContentSnapshot(
    DateTimeOffset LoadedAtUtc,
    IReadOnlyList<QuizQuestion> Questions);

public sealed record QuizAttemptQuestionSnapshot(
    string Id,
    string RuleNumber,
    string RuleName,
    string Topic,
    string Question,
    string Type,
    IReadOnlyList<QuizChoice> Choices,
    IReadOnlyList<string> CorrectAnswers,
    string Explanation,
    string? ImageUrl,
    string? ImageAlt,
    IReadOnlyList<VocabularyItem> Vocabulary,
    string TeachingTip,
    IReadOnlyList<string> LikelyMisconceptions);

public sealed class QuizCampaign
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrganisationId { get; set; }
    public required string Name { get; set; }
    public required string AccessCode { get; set; }
    public QuizMode Mode { get; set; }
    public QuizDifficulty Difficulty { get; set; } = QuizDifficulty.Medium;
    public string Audience { get; set; } = "junior-friendly";
    public string LearningLevel { get; set; } = "foundation";
    public int QuestionCount { get; set; } = 10;
    public int PassMark { get; set; } = 7;
    public int? TotalTimeSeconds { get; set; }
    public int? SecondsPerQuestion { get; set; }
    public DateTimeOffset? OpensAtUtc { get; set; }
    public DateTimeOffset? ClosesAtUtc { get; set; }
    public bool AllowMultipleAttempts { get; set; } = true;
    public bool IsPublished { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    public Organisation? Organisation { get; set; }
}

public sealed class QuizAttempt
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string AttemptId { get; set; }
    public required string UserId { get; set; }
    public Guid? OrganisationId { get; set; }
    public Guid? CampaignId { get; set; }
    public QuizMode Mode { get; set; }
    public QuizDifficulty Difficulty { get; set; }
    public string Audience { get; set; } = "junior-friendly";
    public string LearningLevel { get; set; } = "foundation";
    public QuizAttemptStatus Status { get; set; } = QuizAttemptStatus.InProgress;
    public DateTimeOffset StartedAtUtc { get; set; }
    public DateTimeOffset? FinishedAtUtc { get; set; }
    public DateTimeOffset? ExpiresAtUtc { get; set; }
    public int? SecondsPerQuestion { get; set; }
    public DateTimeOffset? CurrentQuestionStartedAtUtc { get; set; }
    public int TotalQuestions { get; set; }
    public int CorrectCount { get; set; }
    public int PassMark { get; set; }
    public string ContentVersion { get; set; } = string.Empty;
    public string QuestionIdsJson { get; set; } = "[]";
    public string QuestionsSnapshotJson { get; set; } = "[]";

    public ApplicationUser? User { get; set; }
    public Organisation? Organisation { get; set; }
    public QuizCampaign? Campaign { get; set; }
    public ICollection<QuestionAttempt> Answers { get; set; } = new List<QuestionAttempt>();
}

public sealed class QuestionAttempt
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid QuizAttemptId { get; set; }
    public required string QuestionId { get; set; }
    public int QuestionIndex { get; set; }
    public string SelectedAnswerIdsJson { get; set; } = "[]";
    public bool IsCorrect { get; set; }
    public bool TimedOut { get; set; }
    public DateTimeOffset AnsweredAtUtc { get; set; }

    public QuizAttempt? QuizAttempt { get; set; }
}
