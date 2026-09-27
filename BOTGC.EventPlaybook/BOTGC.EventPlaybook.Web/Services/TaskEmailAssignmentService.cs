using System.Text.Json;
using System.Text.Json.Nodes;
using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface ITaskEmailAssignmentService
{
    Task<IReadOnlyList<TaskReassignmentSelection>> GetOptionsAsync(CancellationToken cancellationToken);
    Task<TaskReassignmentSelection?> ReassignAsync(
        string eventId,
        string taskId,
        string assignmentKind,
        string assignmentId,
        CancellationToken cancellationToken);
}

public sealed class TaskEmailAssignmentService(ISharedPlaybookStateStore stateStore) : ITaskEmailAssignmentService
{
    public async Task<IReadOnlyList<TaskReassignmentSelection>> GetOptionsAsync(CancellationToken cancellationToken)
    {
        var document = await stateStore.GetAsync(cancellationToken);
        var root = ParseState(document.State);
        if (root is null) return [];

        return ReadOptions(root)
            .Select(option => new TaskReassignmentSelection
            {
                Kind = option.Kind,
                Id = option.Id,
                Name = option.Name
            })
            .ToArray();
    }

    public async Task<TaskReassignmentSelection?> ReassignAsync(
        string eventId,
        string taskId,
        string assignmentKind,
        string assignmentId,
        CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var document = await stateStore.GetAsync(cancellationToken);
            var root = ParseState(document.State);
            if (root is null) return null;

            var eventNode = FindById(root["events"] as JsonArray, eventId);
            if (eventNode is null) return null;
            var selection = ResolveSelection(root, eventNode, assignmentKind, assignmentId);
            if (selection is null) return null;

            var taskStates = eventNode["taskState"] as JsonObject;
            if (taskStates is null)
            {
                taskStates = [];
                eventNode["taskState"] = taskStates;
            }
            var taskState = taskStates[taskId] as JsonObject;
            if (taskState is null)
            {
                taskState = [];
                taskStates[taskId] = taskState;
            }

            var changedAt = DateTimeOffset.UtcNow;
            taskState["assignmentKind"] = selection.Kind;
            taskState["assignmentId"] = selection.Id;
            taskState["assignee"] = selection.Name;
            taskState["assigneeEmail"] = selection.Email ?? string.Empty;
            taskState["assignedAt"] = changedAt;
            taskState["assignedBy"] = "email-access";

            if (root["taskAlertSchedule"]?["tasks"] is JsonArray scheduledTasks)
            {
                foreach (var scheduled in scheduledTasks.OfType<JsonObject>().Where(item =>
                             string.Equals(ReadString(item["eventId"]), eventId, StringComparison.OrdinalIgnoreCase) &&
                             string.Equals(ReadString(item["taskId"]), taskId, StringComparison.OrdinalIgnoreCase)))
                {
                    scheduled["assigneeName"] = selection.Name;
                    scheduled["assigneeEmail"] = selection.Email ?? string.Empty;
                }
            }

            var save = await stateStore.SaveAsync(
                new SaveSharedPlaybookStateRequest
                {
                    Revision = document.Revision,
                    State = JsonSerializer.SerializeToElement(root)
                },
                cancellationToken);
            if (!save.Conflict) return selection;
        }

        throw new InvalidOperationException("The event plan changed while the task was being reassigned. Please try again.");
    }

    private static JsonObject? ParseState(JsonElement? state) =>
        state is { ValueKind: JsonValueKind.Object }
            ? JsonNode.Parse(state.Value.GetRawText()) as JsonObject
            : null;

    private static IReadOnlyList<TaskReassignmentSelection> ReadOptions(JsonObject root)
    {
        var options = new List<TaskReassignmentSelection>();
        if (root["roles"] is JsonArray roles)
        {
            options.AddRange(roles.OfType<JsonObject>()
                .Where(role => ReadBoolean(role["active"], true) && ReadBoolean(role["selectableForTasks"], true))
                .Select(role => new TaskReassignmentSelection
                {
                    Kind = "role",
                    Id = ReadString(role["id"]),
                    Name = ReadString(role["name"])
                })
                .Where(option => option.Id.Length > 0 && option.Name.Length > 0));
        }
        if (root["contacts"] is JsonArray contacts)
        {
            options.AddRange(contacts.OfType<JsonObject>()
                .Where(contact => ReadBoolean(contact["active"], true) && ReadBoolean(contact["canReceiveTasks"], true))
                .Select(contact => new TaskReassignmentSelection
                {
                    Kind = "person",
                    Id = ReadString(contact["id"]),
                    Name = ReadString(contact["name"]),
                    Email = ReadString(contact["email"])
                })
                .Where(option => option.Id.Length > 0 && option.Name.Length > 0));
        }
        return options
            .OrderBy(option => option.Kind, StringComparer.Ordinal)
            .ThenBy(option => option.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static TaskReassignmentSelection? ResolveSelection(
        JsonObject root,
        JsonObject eventNode,
        string assignmentKind,
        string assignmentId)
    {
        var option = ReadOptions(root).SingleOrDefault(candidate =>
            string.Equals(candidate.Kind, assignmentKind, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(candidate.Id, assignmentId, StringComparison.Ordinal));
        if (option is null) return null;
        if (option.Kind == "person") return option;

        var email = ResolveRoleEmail(root, eventNode, option.Id, []);
        return new TaskReassignmentSelection
        {
            Kind = option.Kind,
            Id = option.Id,
            Name = option.Name,
            Email = email
        };
    }

    private static string ResolveRoleEmail(
        JsonObject root,
        JsonObject eventNode,
        string roleId,
        HashSet<string> visited)
    {
        if (!visited.Add(roleId)) return string.Empty;
        var role = FindById(root["roles"] as JsonArray, roleId);
        if (role is null) return string.Empty;
        var contacts = root["contacts"] as JsonArray;

        if (roleId == "event-coordinator")
        {
            var organiserId = ReadString(eventNode["organiserRef"]?["id"]);
            var organiserName = ReadString(eventNode["organiser"]);
            var organiser = FindById(contacts, organiserId) ?? contacts?.OfType<JsonObject>().FirstOrDefault(contact =>
                string.Equals(ReadString(contact["name"]), organiserName, StringComparison.OrdinalIgnoreCase));
            var organiserEmail = ReadString(organiser?["email"]);
            if (organiserEmail.Length > 0) return organiserEmail;
        }

        var owner = FindById(contacts, ReadString(role["ownerContactId"]));
        var ownerEmail = ReadString(owner?["email"]);
        if (ownerEmail.Length > 0) return ownerEmail;

        var roleContact = contacts?.OfType<JsonObject>().FirstOrDefault(contact =>
            ReadBoolean(contact["active"], true) &&
            ReadBoolean(contact["canReceiveTasks"], true) &&
            contact["roleIds"] is JsonArray roleIds &&
            roleIds.Any(item => string.Equals(ReadString(item), roleId, StringComparison.Ordinal)));
        var roleContactEmail = ReadString(roleContact?["email"]);
        if (roleContactEmail.Length > 0) return roleContactEmail;

        var mailboxEmail = ReadString(role["mailboxEmail"]);
        if (mailboxEmail.Length > 0) return mailboxEmail;
        var fallbackRoleId = ReadString(role["fallbackRoleId"]);
        return fallbackRoleId.Length > 0
            ? ResolveRoleEmail(root, eventNode, fallbackRoleId, visited)
            : string.Empty;
    }

    private static JsonObject? FindById(JsonArray? array, string id) =>
        id.Length == 0
            ? null
            : array?.OfType<JsonObject>().FirstOrDefault(item =>
                string.Equals(ReadString(item["id"]), id, StringComparison.Ordinal));

    private static string ReadString(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var result)
            ? result.Trim()
            : string.Empty;

    private static bool ReadBoolean(JsonNode? node, bool defaultValue) =>
        node is JsonValue value && value.TryGetValue<bool>(out var result) ? result : defaultValue;
}
