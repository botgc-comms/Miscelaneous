using System.Text.Json;

namespace BOTGC.EventPlaybook.Models;

public sealed class PlaybookTemplateDocument
{
    public long Revision { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; init; }

    public string Source { get; init; } = "bundled-core";

    public string BaseSchemaVersion { get; init; } = string.Empty;

    public JsonElement Template { get; init; }

    public IReadOnlyList<string> ProtectedQuestionIds { get; init; } = [];
}

public sealed class SavePlaybookTemplateRequest
{
    public long ExpectedRevision { get; init; }

    public JsonElement Template { get; init; }

    public string Source { get; init; } = "administrator";
}

public sealed class ResetPlaybookTemplateRequest
{
    public long ExpectedRevision { get; init; }
}

public sealed class PlaybookTemplateConflictException(PlaybookTemplateDocument current)
    : InvalidOperationException("The Playbook configuration changed while you were working. Review the latest version before applying these changes.")
{
    public PlaybookTemplateDocument Current { get; } = current;
}

public sealed class PlaybookAssistantConversationMessage
{
    public string Role { get; init; } = "user";

    public string Text { get; init; } = string.Empty;
}

public sealed class PlaybookAssistantProposalRequest
{
    public long BaseRevision { get; init; }

    public string Message { get; init; } = string.Empty;

    public IReadOnlyList<PlaybookAssistantConversationMessage> Conversation { get; init; } = [];
}

public sealed class PlaybookAssistantOption
{
    public string Value { get; init; } = string.Empty;

    public string Label { get; init; } = string.Empty;
}

public sealed class PlaybookAssistantChange
{
    public string Type { get; init; } = string.Empty;

    public string Description { get; init; } = string.Empty;

    public string TargetItemId { get; init; } = string.Empty;

    public string ModuleId { get; init; } = string.Empty;

    public string SectionId { get; init; } = string.Empty;

    public string NewItemId { get; init; } = string.Empty;

    public string Wording { get; init; } = string.Empty;

    public string Detail { get; init; } = string.Empty;

    public string Example { get; init; } = string.Empty;

    public string AnswerType { get; init; } = string.Empty;

    public IReadOnlyList<PlaybookAssistantOption> Options { get; init; } = [];

    public bool Required { get; init; }

    public string ConditionQuestionId { get; init; } = string.Empty;

    public string ConditionValue { get; init; } = string.Empty;

    public string DeadlineCode { get; init; } = string.Empty;

    public string OwnerRoleId { get; init; } = string.Empty;

    public bool Enabled { get; init; } = true;

    public string StaffBriefingPhase { get; init; } = string.Empty;

    public string StaffBriefingAudience { get; init; } = string.Empty;

    public string StaffBriefingInstruction { get; init; } = string.Empty;

    // Review context is populated from the live template by the server. It is
    // deliberately not supplied by the model, so the administrator can compare
    // the proposal with the values that are actually in use.
    public string CurrentWording { get; init; } = string.Empty;

    public string CurrentDetail { get; init; } = string.Empty;

    public string CurrentExample { get; init; } = string.Empty;

    public bool? CurrentEnabled { get; init; }
}

public sealed class PlaybookAssistantProposal
{
    public string ProposalId { get; init; } = Guid.NewGuid().ToString("N");

    public long BaseRevision { get; init; }

    public string Reply { get; init; } = string.Empty;

    public IReadOnlyList<PlaybookAssistantChange> Changes { get; init; } = [];

    public IReadOnlyList<string> Warnings { get; init; } = [];

    public JsonElement PreviewTemplate { get; init; }
}

public sealed class ApplyPlaybookAssistantProposalRequest
{
    public long BaseRevision { get; init; }

    public string ProposalId { get; init; } = string.Empty;

    public IReadOnlyList<PlaybookAssistantChange> Changes { get; init; } = [];
}

public sealed class PlaybookAssistantApplyResult
{
    public required PlaybookTemplateDocument Document { get; init; }

    public IReadOnlyList<string> AppliedChanges { get; init; } = [];
}
