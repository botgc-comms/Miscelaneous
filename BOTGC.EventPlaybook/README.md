# BOTGC Event Playbook

> **Baseline solution:** this repository contains the Event Playbook web application and its private Intelligent Golf integration API.

## Solution structure

- `BOTGC.EventPlaybook.Web` — the public ASP.NET Core web/BFF application, browser assets, Playbook configuration, prototype file persistence, OpenAI poster generation and Yodeck publishing.
- `BOTGC.EventPlaybook.API` — the private .NET 9 Intelligent Golf integration service, including the shared authenticated session, member/report endpoints and API-key protection.

The browser talks only to the Web project. Intelligent Golf credentials are encrypted on the Web service's persistent disk and sent only server-to-server when the module is enabled; the private API validates them and owns the live IG cookie session. Neither credentials nor session tokens are exposed to the browser, and the API should not be exposed to the public internet.

This solution deliberately integrates the two successful prototypes without replacing either of them:

1. the original **Event Playbook** interaction model — master questions, conditional modules, deadline codes, generated tasks and task board;
2. a read-only **Briefing Summary** — an automatically refreshed management summary and printable staff notice generated from the live event plan;
3. the later **Communications Centre** — GPT-assisted creative direction, GPT Image 2 generation, progressive display of outputs, regeneration feedback and multiple campaign formats.

## Runtime

- Web: ASP.NET Core / .NET 8
- API: ASP.NET Core / .NET 9
- Static browser UI for the Playbook, preserving the original prototype interaction
- ASP.NET Core APIs for OpenAI briefings and poster generation, task completion links and notification integration seams
- JSON-driven Playbook and poster configuration

## Run

```powershell
dotnet restore BOTGC.EventPlaybook.sln
dotnet run --project BOTGC.EventPlaybook.Web/BOTGC.EventPlaybook.Web.csproj
```

The default development profile listens on:

```text
http://localhost:5098
```

Open the root URL for the Event Playbook. Use **Communications Centre** from the Playbook to open the campaign workflow for the selected event.

Run the private API separately when working on Intelligent Golf integration:

```powershell
dotnet run --project BOTGC.EventPlaybook.API/BOTGC.EventPlaybook.API.csproj
```

## Hosted development preview

The repository includes separate Docker images plus a Render Blueprint. The existing public Web service retains its persistent disk and optional shared-password screen. The Intelligent Golf API is deployed as a private service on Render's internal network. See [DEPLOYMENT.md](DEPLOYMENT.md) for setup, secrets and prototype-collaboration limits.

## OpenAI configuration

The application uses the existing environment-variable convention:

```text
OPENAI_API_KEY
OPENAI_IMAGE_MODEL
OPENAI_IMAGE_QUALITY
OPENAI_PROMPT_MODEL
```

Defaults when the optional model variables are absent:

```text
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=high
OPENAI_PROMPT_MODEL=gpt-5.6
```

`OPENAI_API_KEY` is never stored in browser code or application configuration.

## Briefing Summary

The selected event workspace includes a read-only **Briefing Summary**. It combines the event description, current event fields, every visible answered planning question and the active task plan into:

- a concise management-facing event briefing;
- key information and relevant operational sections;
- a separate staff briefing divided into preparation, event-day work and afterwards;
- a printable A4 notice containing key contacts and unresolved points.

The saved briefing includes a fingerprint of all its source information. Changing an event field, answer, task owner, task note, due date or completion state makes the previous briefing stale. Opening the Briefing Summary automatically generates a replacement; stale copy may be viewed while generation is running but cannot be printed as current.

## appsettings.json

Web `appsettings.json` files and environment-specific variants are ignored by Git. `BOTGC.EventPlaybook.Web/appsettings.example.json` is safe to commit. The API's committed base `appsettings.json` contains only non-secret defaults; its credentials must come from user-secrets or deployment environment variables.

## Preserved Event Playbook functionality

The integrated application retains all 98 item IDs from the original Playbook configuration, including:

- master event questions;
- Golf, Clubhouse, Catering, Communications, Presentation, Staffing, Safety and Close-down modules;
- conditional questions;
- automatic task generation;
- B4/B3/B2/B1/DT/A1/A2 deadline codes;
- event-specific calculated dates;
- task assignment, notes and completion;
- multiple simultaneous events;
- task filtering;
- JSON and CSV export;
- loading a Playbook JSON definition.

The integrated configuration extends that original set rather than replacing it.

## Operational task extensions

### Responsibility roles and default owners

Tasks can define:

```json
{
  "responsibleArea": "Food & Beverage",
  "defaultOwnerRoleId": "food-beverage-manager"
}
```

The dedicated **People & Roles** page is the shared operational directory. It records people and shared mailboxes, email and telephone details, the roles each contact can perform, whether they may receive tasks, and their intended platform permissions. It also records assignable roles such as Communications and routes each role to a named contact, role mailbox or fallback role.

**Event Coordinator** is a per-event role rather than a standing mailbox. It always resolves to the organiser selected for that event. Other departmental roles, such as Communications or Food & Beverage, may use a linked person or an optional shared fallback mailbox.

Task owners, event organisers and ownership questions use one typeahead/dropdown control backed by that directory. For tasks, named people are offered only when their directory record says they can receive tasks and can perform the task's operational role; assignable role records remain available for role-based routing. Assignments retain the stable person or role ID rather than just copying a name. This means a task assigned to **Communications** continues to follow that role if its linked person or mailbox changes later.

Contacts do not need an existing platform identity. The directory supports employees, volunteers, suppliers or other event contributors. Login eligibility and intended Team member/Organiser/Admin permissions are stored now; actual invitations and enforcement remain an explicit production identity-integration boundary.

People and shared-mailbox records can be deleted when no current or historical event uses them, either directly or through a routed role. Event-linked records are protected and identify the events retaining them. Deleting an otherwise-unused contact also clears any directory role route that pointed to it.

### Assignment notifications

When a task receives an owner, an assignment notification is created automatically. Due-soon reminders and overdue notifications are also generated automatically.

The current ASP.NET Core notification endpoint writes messages to:

```text
App_Data/notification-outbox.jsonl
```

That is an intentional development provider. It gives the Club email and/or Monday integration a clean replacement point without pretending that an external delivery contract has already been agreed.

### Secure completion links

Assigned tasks receive a completion token registered server-side. A recipient can use:

```text
/complete.html?token=...
```

to view the task and explicitly mark it complete without requiring an IG account. Completion state is persisted under `App_Data` and synchronised back into the event task board when the organiser next opens the Playbook.

### Escalation

Tasks approaching their due date create reminders. Overdue tasks create an owner notification and a separate escalation addressed to the event organiser.

## Derived operational facts and advisories

The Playbook now distinguishes:

- **answers/facts** collected from questions;
- **derived facts** calculated from those answers;
- **visibility rules** controlling what appears;
- **task rules** creating work;
- **advisory rules** challenging potentially risky human decisions.

The first implemented derived-fact journey is the catering-hours scenario.

The Golf module now asks for:

- number of holes;
- first tee time;
- last tee time.

The Playbook derives the expected golfer return window. Normal catering hours are configured as **09:00–17:00**.

If the organiser says catering hours will **not** be extended while the expected last golf finish is after 17:00, the Catering module displays an advisory explaining the calculated return time and asks the organiser to reconsider. The organiser may continue with No, but must record the reason for overriding the advisory.

The same mechanism can later support sunset, room capacity, supplier access, staffing or other derived operational risks.

## Playbook administration

**Playbook Administration** and **Plugin Administration** appear under **Shared resources** in the main navigation. They use a separate administrator sign-in backed by the server-side `ADMIN_PASSWORD` environment variable; ordinary development testers cannot open either admin view or call the plugin-administration API.

The Playbook Administration view provides:

- a link to the dedicated People & Roles directory;
- adding questions to a module/section;
- adding tasks with deadline and default-owner role;
- simple conditional visibility against another answer;
- creation of derived-fact advisory rules;
- Draft → Validate → Publish behaviour.

Validation checks include:

- duplicate IDs;
- missing referenced questions;
- unknown deadline codes;
- unknown responsibility roles;
- advisory targets;
- circular question visibility dependencies.

Existing event records retain the Playbook version they were created against.

## Event catalogue, cloning and retrospectives

The Event Catalogue retains event plans and allows a previous event to be cloned. The clone starts with the previous answers but creates a fresh operational task state.

The Retrospective captures:

- actual attendance;
- revenue;
- direct costs;
- what worked;
- what did not work;
- what should change next time;
- whether the event should run again.

Those lessons are visible in the catalogue and travel naturally into the decision to clone/replay an event.

## Communications Centre

The Communications Centre incorporates the later working poster project rather than replacing it.

It retains:

- event description as a major creative input;
- style presets;
- GPT-based creative-director prompt generation;
- `gpt-image-2` image generation/editing;
- exact event title/date/price supplied to the image model;
- complete AI-designed poster typography rather than a browser text overlay;
- primary 2160 × 3840 clubhouse artwork;
- 1080 × 1080 email/social version;
- 2480 × 3508 A4 version;
- primary artwork generated first;
- derivative formats generated from the primary campaign;
- each image appearing as soon as it becomes available;
- regeneration using organiser feedback;
- real Yodeck media-library upload, event-specific tagging, availability dates and idempotent Clubhouse-playlist publishing that updates the same media item on repeat sends;
- a future membership-email publishing seam.

The Communications Centre also accepts the event name, date and description from the active Event Playbook event. A generic custom-event definition allows newly created Playbook events to create campaign artwork before they have their own permanent event-catalogue scene recipe.

## External integration boundaries

The following external integrations are deliberately represented as explicit seams rather than invented APIs:

- Club email delivery for task assignments/reminders/escalations;
- Monday.com task creation/synchronisation;
- membership campaign email delivery;
- IG identity linking.

The internal task, notification, completion and poster workflows are already shaped so these providers can be connected without redesigning the Playbook UI.

## Catalogue-first workflow (21 August 2026)

The application now opens on the Event Catalogue. The catalogue is the starting point for the Event Playbook and groups events by the year in which they take place.

Each event tile shows the event date, status, description and task/retrospective counts. When a square Communications Centre output has been generated, a compressed square campaign thumbnail is retained with the event and displayed on its catalogue tile.

Selecting **View event summary** shows the event description, every task generated by the Playbook and its completion state, and all recorded retrospective results.

Open events can be closed from the catalogue or summary using **Close & create new**. Closed events remain in the catalogue as history and can be used as the basis for a future event.

Creating an event now captures the event name, organiser, provisional event date, a detailed description and the planning milestones. Milestones default from the event date to:

- B4 Initial planning: 60 days before;
- B3 Detailed planning: 20 days before;
- B2 Final arrangements: 7 days before;
- CD Commitment decision: 7 days before;
- B1 Final checks: 1 day before;
- GO Final go/no-go: 1 day before;
- DT Event day: event date;
- A1 Immediate follow-up: 1 day after;
- A2 Post-event review: 7 days after.

The organiser can change any of those dates during event creation or later in the planning timeline. Generated task deadlines use the actual milestone dates for that event.

## Event viability and cancellation control (27 August 2026)

Every event now has a shared lifecycle status: **Provisional**, **Confirmed**, **At risk**, **Postponed**, **Cancelled** or **Completed**. The status is visible throughout the selected-event workspace and is changed through a guided decision record containing the decision owner, communications owner, reason and authoritative member update.

The always-available **Event control** planning module asks about viability triggers, affected teams, minimum attendance and operational commitments. Its Commitment Decision and Final Go/No-Go tasks explicitly gate F&B cover, purchasing, suppliers and outward communications.

Changing an event to Cancelled or Postponed activates the dynamic CX Change Response milestone. One immediate coordination task is owned by the event organiser and identifies the people and teams that the current plan says must be checked. More specific Food & Beverage, Clubhouse, Golf Operations and Communications tasks appear only where completed tasks, task notes, sent briefings or an explicit recorded arrangement show that work may need to be unwound. This avoids creating a blanket checklist for departments that never acted on the event. The event remains open while those tasks are completed; catalogue closure is a separate archival action.

The new-event screen explicitly explains that a detailed event description gives the AI better context for both artwork generation and future planning assistance.

## Poster continuity and planner hierarchy (21 August 2026)

Poster generation is now session-aware per Event Playbook event. If an organiser starts generating artwork, navigates to another part of the application and then returns to the Communications Centre, the same in-memory generation session is remounted: live progress, completed outputs, refinement state and generated canvases are restored instead of starting again. Generation continues while another Event Playbook view is open. Separate events maintain separate artwork sessions.

The planner question/task presentation has also been redesigned to restore the hierarchy of the original playbook concept. Questions use a dedicated decision rail with answered state. Generated tasks use a visually distinct action treatment with the planning milestone shown as a prominent B4/B3/B2/B1/DT/A1/A2 marker, milestone name and actual due date. The Task Board uses the same milestone language so deadlines are recognisable consistently across the planner and operational views.


## Current merged build

This build preserves the refined Golf and Presentation/Prizes planning flow, Image Library and automatic studio references, supporting image uploads, text-safe poster fitting, and the polished event-summary dialog.
