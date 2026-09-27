using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Services;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class TaskEmailAssignmentServiceTests
{
    [Fact]
    public async Task ReassignAsync_UpdatesTheTaskAndFutureAlertRecipient()
    {
        var store = new RecordingSharedStateStore(JsonSerializer.SerializeToElement(new
        {
            roles = new[]
            {
                new { id = "event-coordinator", name = "Event Coordinator", active = true, selectableForTasks = true }
            },
            contacts = new[]
            {
                new
                {
                    id = "person-alice",
                    name = "Alice Example",
                    email = "alice@example.com",
                    active = true,
                    canReceiveTasks = true
                }
            },
            events = new[]
            {
                new
                {
                    id = "event-1",
                    organiser = "Existing Organiser",
                    taskState = new Dictionary<string, object>
                    {
                        ["task-1"] = new { assignee = "Existing Organiser" }
                    }
                }
            },
            taskAlertSchedule = new
            {
                tasks = new[]
                {
                    new
                    {
                        eventId = "event-1",
                        taskId = "task-1",
                        assigneeName = "Existing Organiser",
                        assigneeEmail = "existing@example.com"
                    }
                }
            }
        }));
        var service = new TaskEmailAssignmentService(store);

        var options = await service.GetOptionsAsync(CancellationToken.None);
        var result = await service.ReassignAsync(
            "event-1",
            "task-1",
            "person",
            "person-alice",
            CancellationToken.None);

        Assert.Contains(options, option => option.Kind == "person" && option.Id == "person-alice");
        Assert.All(options, option => Assert.Null(option.Email));
        Assert.NotNull(result);
        Assert.Equal("Alice Example", result!.Name);
        Assert.Equal("alice@example.com", result.Email);
        Assert.Equal(1, store.SaveCount);

        var state = store.Document.State!.Value;
        var taskState = state.GetProperty("events")[0]
            .GetProperty("taskState")
            .GetProperty("task-1");
        Assert.Equal("person", taskState.GetProperty("assignmentKind").GetString());
        Assert.Equal("person-alice", taskState.GetProperty("assignmentId").GetString());
        Assert.Equal("Alice Example", taskState.GetProperty("assignee").GetString());
        Assert.Equal("alice@example.com", taskState.GetProperty("assigneeEmail").GetString());
        Assert.Equal("email-access", taskState.GetProperty("assignedBy").GetString());

        var scheduledTask = state.GetProperty("taskAlertSchedule").GetProperty("tasks")[0];
        Assert.Equal("Alice Example", scheduledTask.GetProperty("assigneeName").GetString());
        Assert.Equal("alice@example.com", scheduledTask.GetProperty("assigneeEmail").GetString());
    }

    private sealed class RecordingSharedStateStore(JsonElement state) : ISharedPlaybookStateStore
    {
        public SharedPlaybookStateDocument Document { get; private set; } = new()
        {
            Revision = 1,
            State = state
        };

        public int SaveCount { get; private set; }

        public Task<SharedPlaybookStateDocument> GetAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Document);

        public Task<(bool Conflict, SharedPlaybookStateDocument Document)> SaveAsync(
            SaveSharedPlaybookStateRequest request,
            CancellationToken cancellationToken)
        {
            SaveCount++;
            Document = new SharedPlaybookStateDocument
            {
                Revision = Document.Revision + 1,
                State = request.State.Clone()
            };
            return Task.FromResult((false, Document));
        }
    }
}
