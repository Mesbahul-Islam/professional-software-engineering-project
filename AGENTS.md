# General Project Rules

## General Rules
* The `/docs` folder in the repository is the knowledge base for this project. It holds all the information needed for the work. When in doubt, `/docs` is the source of truth.
* Always check that the task we are doing makes sense with respect to the instructions in `/docs`.
* We need to generate the system we will work on. There is no "initial system" to download from any repository.
* If new folders appear in the repository, ask for their purpose before working with them.
* Make sure to use synthetic data for everything.

## Conversation Recording
* Every time a new conversation with the LLM starts, ask whether the conversation should be recorded. Do this with no exceptions.
* If the answer is yes:
  * Ask which sprint of the project we are in.
  * Record every interaction in `/conversations/Sprint<number>/<CurrentDate>`.
  * Record each interaction in this format:

    ## User prompt:
    <Report_User_Prompt>

    ## AI Reply
    <Report_AI_Reply>

## Coding Standards
* Keep the code as simple as possible. Do not rely on complex patterns. The product needs to be functional, but it does not need to be a "real product."
* Use synthetic data for everything. 

## Project Structure
* `/docs` – knowledge base (instructions, persona cards, user stories).
* `/mockups` – dashboard mockup (plain HTML/CSS/JS, synthetic data). The team voted for **Version B "Three Lanes"** (`version-b-three-lanes.html`): one column per role, aligned rows, dropdowns for detail, shared trade-off dropdown underneath. Versions A and C were removed.
  * Sprint 2: the dashboard is data-driven. `mockups/pqc-data.json` is the single source of truth for all numbers, reports and text. The HTML only holds layout and rendering code. Each stat/report has a `default` value plus optional per-situation overrides; the situation is chosen in the dropdown or with `?situation=`. Serve the folder with a local server (e.g. `python3 -m http.server`) because the browser cannot fetch JSON from `file://`.
  * Do not hardcode dashboard numbers or sentences in the HTML. Change them in the JSON.
  * UI rules: label stakeholders by role (CIO, Project Manager, Security Officer), never by persona name. The first screen shows only the overall status and one big headline per role; more detail is revealed progressively through cards, tabs and dropdowns.
* `/dashboard` – **dashboard v2.0 (Sprint 2), the current working increment.** Plain HTML/CSS/JS, no build step, synthetic data.
  * `pqc-data.json` – the single source of truth. It holds raw records (services with monthly readiness, fallback devices and connections, downgrade alerts, exceptions, planned steps, risks, notifications, the Kestrel Water contract and its proposed change, and the rules). Every number on screen is **calculated** in `app.js` from these records; nothing is precomputed or hardcoded.
  * `app.js` – calculations (`compute(scope, proposed)`) and rendering. `index.html` – layout only. `styles.css` – styling.
  * Views: **Team view** (three role lanes, status banner, fallback trade-off) and **Customer view** (what the CIO can show the largest customer, scoped to the agreement, no internal device details, printable).
  * Scope: customer agreement (default, Sprint 2 priority) or whole organisation; optional "include proposed contract change". URL: `?view=team|customer&scope=customer|org&proposed=1&expand=1`.
  * Status rule: GREEN only if forecast ≥ target, no sensitive long-lived data on fallback (exceptions still count) and no open high alert; RED if forecast is more than 3 points below target or a high alert is open; otherwise AMBER. The customer view uses the same rule, so it cannot be green while HNDL exposure remains.
  * Run: `cd dashboard && python3 -m http.server 8000`, open `http://localhost:8000/` (browsers block `fetch` from `file://`).
  * The `/mockups` data-driven Version B from early Sprint 2 is kept for history; new work goes into `/dashboard`.
* `/conversations/Sprint<n>/<date>.md` – recorded LLM conversations.

## Best Practice
* Remind me to pull from the main branch before pushing.
* Update the AGENTS.md, CLAUDE.md file for important changes made to the project.
