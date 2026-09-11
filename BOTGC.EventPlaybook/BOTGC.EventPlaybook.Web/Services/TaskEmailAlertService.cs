using System.Globalization;
using System.Net.Mail;
using System.Text.Encodings.Web;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using Microsoft.AspNetCore.WebUtilities;

namespace BOTGC.EventPlaybook.Services;

public interface ITaskAlertEmailSender
{
    Task SendAsync(TaskAlertEmailMessage message, CancellationToken cancellationToken);
}

public sealed class IntelligentGolfTaskAlertEmailSender(
    IIntelligentGolfMemberCommunicationsClient communications) : ITaskAlertEmailSender
{
    public async Task SendAsync(TaskAlertEmailMessage message, CancellationToken cancellationToken)
    {
        var result = await communications.SendToAddressesAsync(
            [message.RecipientEmail],
            message.Subject,
            message.BodyHtml,
            cancellationToken);
        if (result.Requested != 1 ||
            result.Sent != 1 ||
            result.Deliveries.Count != 1 ||
            result.Deliveries.Any(delivery => !delivery.Sent))
        {
            var error = result.Deliveries.FirstOrDefault()?.Error;
            throw new InvalidOperationException(
                string.IsNullOrWhiteSpace(error)
                    ? "The task alert email was not accepted for delivery."
                    : error);
        }
    }
}

public interface ITaskAlertDeliveryLedger
{
    Task<bool> WasSentAsync(
        DateOnly localDate,
        string normalisedRecipientEmail,
        CancellationToken cancellationToken);

    Task MarkSentAsync(
        DateOnly localDate,
        string normalisedRecipientEmail,
        int taskCount,
        CancellationToken cancellationToken);
}

public sealed class TaskAlertDeliveryLedger : ITaskAlertDeliveryLedger
{
    private const int RetentionDays = 400;
    private readonly string _path;
    private readonly TimeProvider _timeProvider;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public TaskAlertDeliveryLedger(IWebHostEnvironment environment, TimeProvider timeProvider)
    {
        var directory = Path.Combine(environment.ContentRootPath, "App_Data");
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "task-email-alert-deliveries.json");
        _timeProvider = timeProvider;
    }

    public async Task<bool> WasSentAsync(
        DateOnly localDate,
        string normalisedRecipientEmail,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            return document.Deliveries.Any(delivery =>
                delivery.LocalDate == localDate &&
                string.Equals(
                    delivery.RecipientEmail,
                    normalisedRecipientEmail,
                    StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task MarkSentAsync(
        DateOnly localDate,
        string normalisedRecipientEmail,
        int taskCount,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            if (!document.Deliveries.Any(delivery =>
                    delivery.LocalDate == localDate &&
                    string.Equals(
                        delivery.RecipientEmail,
                        normalisedRecipientEmail,
                        StringComparison.OrdinalIgnoreCase)))
            {
                document.Deliveries.Add(new TaskAlertDelivery
                {
                    LocalDate = localDate,
                    RecipientEmail = normalisedRecipientEmail,
                    TaskCount = Math.Max(0, taskCount),
                    SentAtUtc = _timeProvider.GetUtcNow()
                });
            }

            var oldestRetainedDate = localDate.AddDays(-RetentionDays);
            document.Deliveries.RemoveAll(delivery => delivery.LocalDate < oldestRetainedDate);
            await SaveAsync(document, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<TaskAlertDeliveryDocument> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return new TaskAlertDeliveryDocument();
        await using var stream = File.OpenRead(_path);
        return await JsonSerializer.DeserializeAsync<TaskAlertDeliveryDocument>(
                   stream,
                   _jsonOptions,
                   cancellationToken)
               ?? new TaskAlertDeliveryDocument();
    }

    private async Task SaveAsync(
        TaskAlertDeliveryDocument document,
        CancellationToken cancellationToken)
    {
        var temporaryPath = $"{_path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var stream = new FileStream(
                             temporaryPath,
                             FileMode.CreateNew,
                             FileAccess.Write,
                             FileShare.None,
                             65536,
                             FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, document, _jsonOptions, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }
            File.Move(temporaryPath, _path, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private sealed class TaskAlertDeliveryDocument
    {
        public int Version { get; init; } = 1;

        public List<TaskAlertDelivery> Deliveries { get; init; } = [];
    }

    private sealed class TaskAlertDelivery
    {
        public DateOnly LocalDate { get; init; }

        public required string RecipientEmail { get; init; }

        public DateTimeOffset SentAtUtc { get; init; }

        public int TaskCount { get; init; }
    }
}

public interface ITaskEmailAlertDispatcher
{
    Task<TaskEmailAlertDispatchResult> RunOnceAsync(CancellationToken cancellationToken);

    Task<TaskEmailAlertDispatchResult> RunOnceAsync(
        DateOnly londonDate,
        CancellationToken cancellationToken);
}

public sealed class TaskEmailAlertDispatcher(
    ISharedPlaybookStateStore stateStore,
    ITaskCompletionRegistry completionRegistry,
    ITaskAlertEmailSender emailSender,
    ITaskAlertDeliveryLedger deliveryLedger,
    IIntegrationActivityStore activityStore,
    TimeProvider timeProvider,
    ILogger<TaskEmailAlertDispatcher> logger) : ITaskEmailAlertDispatcher
{
    private readonly SemaphoreSlim _runGate = new(1, 1);

    public Task<TaskEmailAlertDispatchResult> RunOnceAsync(CancellationToken cancellationToken) =>
        RunOnceAsync(GetLondonDate(timeProvider), cancellationToken);

    public async Task<TaskEmailAlertDispatchResult> RunOnceAsync(
        DateOnly londonDate,
        CancellationToken cancellationToken)
    {
        await _runGate.WaitAsync(cancellationToken);
        try
        {
            var document = await stateStore.GetAsync(cancellationToken);
            var schedule = TaskAlertScheduleReader.Read(document.State);
            if (schedule is null)
            {
                return new TaskEmailAlertDispatchResult { LocalDate = londonDate };
            }

            var digests = new Dictionary<string, RecipientDigest>(StringComparer.OrdinalIgnoreCase);
            var candidateTaskCount = 0;
            foreach (var task in schedule.Tasks)
            {
                var daysUntilDue = task.DueDate.DayNumber - londonDate.DayNumber;
                if (daysUntilDue is not (2 or 0) && daysUntilDue >= 0) continue;

                var ownerEmail = NormaliseEmail(task.AssigneeEmail);
                var organiserEmail = daysUntilDue < 0
                    ? NormaliseEmail(task.OrganiserEmail)
                    : null;
                if (ownerEmail is null && organiserEmail is null) continue;

                TaskCompletionRecord completion;
                try
                {
                    completion = await completionRegistry.RegisterAsync(
                        new RegisterCompletionLinkRequest
                        {
                            Token = task.CompletionToken,
                            EventId = task.EventId,
                            EventName = task.EventName,
                            TaskId = task.TaskId,
                            TaskTitle = task.TaskTitle,
                            Assignee = task.AssigneeName,
                            AssigneeEmail = task.AssigneeEmail,
                            DueDate = task.DueDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                            PreserveLearningInsights = true,
                            CanCompleteFromLink = task.CanCompleteFromLink
                        },
                        cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    logger.LogError(
                        exception,
                        "Could not register the completion link for task {TaskId} in event {EventId}; its alert was skipped.",
                        task.TaskId,
                        task.EventId);
                    continue;
                }

                if (!string.Equals(completion.EventId, task.EventId, StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(completion.TaskId, task.TaskId, StringComparison.OrdinalIgnoreCase))
                {
                    logger.LogError(
                        "The completion link belongs to a different task; alert for {EventId}/{TaskId} was skipped.",
                        task.EventId,
                        task.TaskId);
                    continue;
                }
                if (completion.CompletedAtUtc is not null && task.CanCompleteFromLink) continue;

                candidateTaskCount++;
                if (ownerEmail is not null)
                {
                    GetDigest(digests, ownerEmail).Add(
                        task,
                        daysUntilDue,
                        isOwner: true,
                        isOrganiserEscalation: organiserEmail is not null &&
                                                 string.Equals(ownerEmail, organiserEmail, StringComparison.OrdinalIgnoreCase));
                }
                if (organiserEmail is not null &&
                    !string.Equals(ownerEmail, organiserEmail, StringComparison.OrdinalIgnoreCase))
                {
                    GetDigest(digests, organiserEmail).Add(
                        task,
                        daysUntilDue,
                        isOwner: false,
                        isOrganiserEscalation: true);
                }
            }

            var sent = 0;
            var alreadySent = 0;
            var failed = 0;
            foreach (var digest in digests.Values.OrderBy(value => value.RecipientEmail, StringComparer.Ordinal))
            {
                try
                {
                    if (await deliveryLedger.WasSentAsync(
                            londonDate,
                            digest.RecipientEmail,
                            cancellationToken))
                    {
                        alreadySent++;
                        continue;
                    }

                    var message = TaskAlertEmailComposer.Compose(
                        digest,
                        schedule.PublicBaseUrl,
                        londonDate);
                    await emailSender.SendAsync(message, cancellationToken);
                    await deliveryLedger.MarkSentAsync(
                        londonDate,
                        digest.RecipientEmail,
                        message.TaskCount,
                        cancellationToken);
                    sent++;
                    await RecordActivitySafelyAsync(
                        new IntegrationActivityWrite
                        {
                            Integration = "Task email alerts",
                            Operation = "Send task alert digest",
                            Outcome = "succeeded",
                            Stage = "task-email-digest",
                            Message = $"Sent one combined task alert containing {message.TaskCount} task{(message.TaskCount == 1 ? string.Empty : "s")}."
                        },
                        cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    failed++;
                    logger.LogError(
                        exception,
                        "Task alert digest delivery to {RecipientEmail} failed and remains eligible for retry.",
                        digest.RecipientEmail);
                    await RecordActivitySafelyAsync(
                        new IntegrationActivityWrite
                        {
                            Integration = "Task email alerts",
                            Operation = "Send task alert digest",
                            Outcome = "failed",
                            Stage = "task-email-digest",
                            Message = "A combined task alert could not be delivered and remains eligible for retry."
                        },
                        cancellationToken);
                }
            }

            return new TaskEmailAlertDispatchResult
            {
                LocalDate = londonDate,
                CandidateTaskCount = candidateTaskCount,
                RecipientCount = digests.Count,
                SentRecipientCount = sent,
                AlreadySentRecipientCount = alreadySent,
                FailedRecipientCount = failed
            };
        }
        finally
        {
            _runGate.Release();
        }
    }

    public static DateOnly GetLondonDate(TimeProvider clock)
    {
        var local = GetLondonTime(clock);
        return DateOnly.FromDateTime(local.DateTime);
    }

    public static bool IsAtOrAfterDailySendTime(TimeProvider clock) =>
        GetLondonTime(clock).TimeOfDay >= TimeSpan.FromHours(8);

    public static TimeSpan DelayUntilNextCheck(TimeProvider clock)
    {
        var local = GetLondonTime(clock);
        var untilEight = TimeSpan.FromHours(8) - local.TimeOfDay;
        return untilEight > TimeSpan.Zero && untilEight < TimeSpan.FromMinutes(30)
            ? untilEight
            : TimeSpan.FromMinutes(30);
    }

    private static DateTimeOffset GetLondonTime(TimeProvider clock) =>
        TimeZoneInfo.ConvertTime(clock.GetUtcNow(), FindLondonTimeZone());

    private static TimeZoneInfo FindLondonTimeZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Europe/London");
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("GMT Standard Time");
        }
    }

    private static string? NormaliseEmail(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || !MailAddress.TryCreate(value.Trim(), out var address))
            return null;
        return address.Address.Trim().ToLowerInvariant();
    }

    private static RecipientDigest GetDigest(
        IDictionary<string, RecipientDigest> digests,
        string recipientEmail)
    {
        if (digests.TryGetValue(recipientEmail, out var existing)) return existing;
        var created = new RecipientDigest(recipientEmail);
        digests.Add(recipientEmail, created);
        return created;
    }

    private async Task RecordActivitySafelyAsync(
        IntegrationActivityWrite activity,
        CancellationToken cancellationToken)
    {
        try
        {
            await activityStore.RecordAsync(activity, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Task alert delivery activity could not be recorded.");
        }
    }
}

public sealed class TaskEmailAlertBackgroundService(
    ITaskEmailAlertDispatcher dispatcher,
    TimeProvider timeProvider,
    ILogger<TaskEmailAlertBackgroundService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            if (TaskEmailAlertDispatcher.IsAtOrAfterDailySendTime(timeProvider))
            {
                try
                {
                    await dispatcher.RunOnceAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception exception)
                {
                    logger.LogError(exception, "The scheduled task email alert check failed.");
                }
            }

            try
            {
                var delay = TaskEmailAlertDispatcher.DelayUntilNextCheck(timeProvider);
                await Task.Delay(delay, timeProvider, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }
}

public static class TaskAlertScheduleReader
{
    private const int MaximumTasks = 10_000;
    private static readonly Uri ValidationBaseUri = new("https://event-playbook.invalid/");

    public static TaskAlertSchedule? Read(JsonElement? sharedState)
    {
        if (!sharedState.HasValue || sharedState.Value.ValueKind != JsonValueKind.Object ||
            !sharedState.Value.TryGetProperty("taskAlertSchedule", out var scheduleElement) ||
            scheduleElement.ValueKind != JsonValueKind.Object ||
            !TryReadPublicBaseUrl(scheduleElement, out var publicBaseUrl) ||
            !scheduleElement.TryGetProperty("tasks", out var tasksElement) ||
            tasksElement.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        DateTimeOffset? generatedAtUtc = null;
        if (scheduleElement.TryGetProperty("generatedAtUtc", out var generatedAtElement) &&
            generatedAtElement.ValueKind == JsonValueKind.String &&
            generatedAtElement.TryGetDateTimeOffset(out var generatedAt))
        {
            generatedAtUtc = generatedAt;
        }

        var tasks = new List<ScheduledTaskAlert>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in tasksElement.EnumerateArray().Take(MaximumTasks))
        {
            if (!TryReadTask(item, out var task)) continue;
            if (!seen.Add($"{task.EventId}\n{task.TaskId}")) continue;
            tasks.Add(task);
        }

        return new TaskAlertSchedule
        {
            GeneratedAtUtc = generatedAtUtc,
            PublicBaseUrl = publicBaseUrl,
            Tasks = tasks
        };
    }

    private static bool TryReadPublicBaseUrl(JsonElement schedule, out Uri publicBaseUrl)
    {
        publicBaseUrl = null!;
        var raw = ReadString(schedule, "publicBaseUrl");
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var candidate) ||
            (!string.Equals(candidate.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) &&
             !string.Equals(candidate.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)) ||
            string.IsNullOrWhiteSpace(candidate.Host) ||
            !string.IsNullOrEmpty(candidate.UserInfo))
        {
            return false;
        }

        publicBaseUrl = new Uri(candidate.GetLeftPart(UriPartial.Authority) + "/", UriKind.Absolute);
        return true;
    }

    private static bool TryReadTask(JsonElement element, out ScheduledTaskAlert task)
    {
        task = null!;
        if (element.ValueKind != JsonValueKind.Object) return false;

        var eventId = ReadString(element, "eventId", 200);
        var eventName = ReadString(element, "eventName", 500);
        var taskId = ReadString(element, "taskId", 200);
        var taskTitle = ReadString(element, "taskTitle", 1_000);
        var dueDateValue = ReadString(element, "dueDate", 20);
        var completionPath = ReadString(element, "completionPath", 500);
        if (eventId is null || eventName is null || taskId is null || taskTitle is null ||
            !DateOnly.TryParseExact(
                dueDateValue,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var dueDate) ||
            !TryReadCompletionPath(completionPath, out var safeCompletionPath, out var token))
        {
            return false;
        }

        task = new ScheduledTaskAlert
        {
            EventId = eventId,
            EventName = eventName,
            EventDate = ReadString(element, "eventDate", 20),
            TaskId = taskId,
            TaskTitle = taskTitle,
            DueDate = dueDate,
            AssigneeName = ReadString(element, "assigneeName", 300),
            AssigneeEmail = ReadString(element, "assigneeEmail", 500),
            OrganiserName = ReadString(element, "organiserName", 300),
            OrganiserEmail = ReadString(element, "organiserEmail", 500),
            CompletionPath = safeCompletionPath,
            CompletionToken = token,
            CanCompleteFromLink = ReadBoolean(element, "canCompleteFromLink", defaultValue: true)
        };
        return true;
    }

    private static bool TryReadCompletionPath(
        string? value,
        out string completionPath,
        out string token)
    {
        completionPath = string.Empty;
        token = string.Empty;
        if (string.IsNullOrWhiteSpace(value) ||
            !value.StartsWith("/", StringComparison.Ordinal) ||
            value.StartsWith("//", StringComparison.Ordinal) ||
            !Uri.TryCreate(ValidationBaseUri, value, out var candidate) ||
            !string.Equals(candidate.Host, ValidationBaseUri.Host, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(candidate.AbsolutePath, "/complete.html", StringComparison.OrdinalIgnoreCase) ||
            !string.IsNullOrEmpty(candidate.Fragment))
        {
            return false;
        }

        var query = QueryHelpers.ParseQuery(candidate.Query);
        var rawToken = query.TryGetValue("token", out var values) && values.Count == 1
            ? values[0]?.Trim()
            : null;
        if (string.IsNullOrWhiteSpace(rawToken) || !Guid.TryParse(rawToken, out var parsedToken))
            return false;

        token = parsedToken.ToString("D");
        completionPath = $"/complete.html?token={Uri.EscapeDataString(token)}";
        return true;
    }

    private static string? ReadString(
        JsonElement element,
        string propertyName,
        int maximumLength = 2_000)
    {
        if (!element.TryGetProperty(propertyName, out var value) ||
            value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var result = value.GetString()?.Trim();
        return string.IsNullOrWhiteSpace(result) || result.Length > maximumLength ? null : result;
    }

    private static bool ReadBoolean(JsonElement element, string propertyName, bool defaultValue)
    {
        if (!element.TryGetProperty(propertyName, out var value)) return defaultValue;
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => defaultValue
        };
    }
}

internal sealed class RecipientDigest(string recipientEmail)
{
    private readonly Dictionary<string, DigestTask> _tasks = new(StringComparer.OrdinalIgnoreCase);

    public string RecipientEmail { get; } = recipientEmail;

    public IReadOnlyCollection<DigestTask> Tasks => _tasks.Values;

    public void Add(
        ScheduledTaskAlert task,
        int daysUntilDue,
        bool isOwner,
        bool isOrganiserEscalation)
    {
        var key = $"{task.EventId}\n{task.TaskId}";
        if (_tasks.TryGetValue(key, out var existing))
        {
            existing.IsOwner |= isOwner;
            existing.IsOrganiserEscalation |= isOrganiserEscalation;
            return;
        }

        _tasks.Add(key, new DigestTask
        {
            Task = task,
            DaysUntilDue = daysUntilDue,
            IsOwner = isOwner,
            IsOrganiserEscalation = isOrganiserEscalation
        });
    }
}

internal sealed class DigestTask
{
    public required ScheduledTaskAlert Task { get; init; }

    public int DaysUntilDue { get; init; }

    public bool IsOwner { get; set; }

    public bool IsOrganiserEscalation { get; set; }
}

internal static class TaskAlertEmailComposer
{
    private static readonly CultureInfo BritishCulture = CultureInfo.GetCultureInfo("en-GB");

    public static TaskAlertEmailMessage Compose(
        RecipientDigest digest,
        Uri publicBaseUrl,
        DateOnly localDate)
    {
        var tasks = digest.Tasks
            .OrderBy(item => TimingOrder(item.DaysUntilDue))
            .ThenBy(item => item.Task.DueDate)
            .ThenBy(item => item.Task.EventName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Task.TaskTitle, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var encoder = HtmlEncoder.Default;
        var sections = new[]
        {
            (Title: "Overdue", Tasks: tasks.Where(item => item.DaysUntilDue < 0).ToArray()),
            (Title: "Due today", Tasks: tasks.Where(item => item.DaysUntilDue == 0).ToArray()),
            (Title: "Due in two days", Tasks: tasks.Where(item => item.DaysUntilDue == 2).ToArray())
        };

        var body = new System.Text.StringBuilder();
        body.Append("<div style=\"font-family:Arial,sans-serif;color:#17353f;line-height:1.45;max-width:720px\">")
            .Append("<h1 style=\"color:#0d3548\">Event Playbook tasks requiring attention</h1>")
            .Append("<p>This is your combined task alert for ")
            .Append(encoder.Encode(localDate.ToString("dddd d MMMM yyyy", BritishCulture)))
            .Append(".</p>");

        foreach (var section in sections.Where(section => section.Tasks.Length > 0))
        {
            body.Append("<h2 style=\"color:#0d3548;border-bottom:1px solid #d9e2df;padding-bottom:6px\">")
                .Append(encoder.Encode(section.Title))
                .Append("</h2><ul style=\"padding-left:22px\">");
            foreach (var item in section.Tasks)
            {
                var taskPath = item.Task.CanCompleteFromLink
                    ? item.Task.CompletionPath
                    : $"/?view=tasks&event={Uri.EscapeDataString(item.Task.EventId)}&task={Uri.EscapeDataString(item.Task.TaskId)}";
                var completionUrl = new Uri(publicBaseUrl, taskPath).AbsoluteUri;
                body.Append("<li style=\"margin:0 0 14px\"><a style=\"font-weight:700;color:#07546b\" href=\"")
                    .Append(encoder.Encode(completionUrl))
                    .Append("\">")
                    .Append(encoder.Encode(item.Task.TaskTitle))
                    .Append("</a><br><span>")
                    .Append(encoder.Encode(item.Task.EventName))
                    .Append(" &middot; due ")
                    .Append(encoder.Encode(item.Task.DueDate.ToString("ddd d MMM yyyy", BritishCulture)))
                    .Append("</span><br><small style=\"color:#52666b\">")
                    .Append(encoder.Encode(ResponsibilityLabel(item)))
                    .Append("</small></li>");
            }
            body.Append("</ul>");
        }

        body.Append("<p style=\"margin-top:24px;color:#52666b\">Each task title opens its individual task page. This combined alert replaces separate emails for each task.</p></div>");
        return new TaskAlertEmailMessage
        {
            RecipientEmail = digest.RecipientEmail,
            Subject = $"Event Playbook: {tasks.Length} task{(tasks.Length == 1 ? string.Empty : "s")} need attention",
            BodyHtml = body.ToString(),
            TaskCount = tasks.Length
        };
    }

    private static int TimingOrder(int daysUntilDue) => daysUntilDue switch
    {
        < 0 => 0,
        0 => 1,
        _ => 2
    };

    private static string ResponsibilityLabel(DigestTask item)
    {
        if (item.IsOwner && item.IsOrganiserEscalation)
            return "Your task; you are also the event organiser.";
        if (item.IsOwner) return "Assigned to you.";
        var assignee = string.IsNullOrWhiteSpace(item.Task.AssigneeName)
            ? "This task is currently unassigned."
            : $"Assigned to {item.Task.AssigneeName}.";
        return $"Event organiser alert. {assignee}";
    }
}
