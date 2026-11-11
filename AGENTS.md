<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## State machines

A flow with more than two states is written as an explicit machine, not as loose flags.

- `src/lib/machines/<flow>.ts` exports a `State` union keyed on `status`, an `Event`
  union, `initial` and a pure `transition(state, event)`. An event that does not fit
  the current state returns the state unchanged. No React, browser or Supabase imports
  (`import type` is fine).
- The Zustand store keeps one field per machine (`timer`, `prompts`). Store actions call
  `transition`; they do not set the parts by hand.
- A machine's visible root carries `data-state` (the timer) or `data-prompt` (the dialog
  that has the screen), so a test or an agent can read the state from the page.
- `machines/timer.ts`: the focus timer. Time left is derived from `endsAt`, never counted
  down. `TimerClock`, mounted once in `app/layout.tsx`, is the only clock and the only
  chime; timer widgets just display.
- `machines/prompts.ts`: dialogs that open on their own take turns in a fixed order. A
  dialog calls `usePrompt(id, wants)` and renders only while it returns true. To add
  one, add its id to `PROMPT_ORDER` first.
- `src/lib/task-lifecycle.ts`: finishing a task and the Daily Action limit, shared by the
  store and the REST API. `updateTask` with `status: "Done"` and `completeTask` both
  stamp a recurring task's period, so no Done button can skip it.
- Tests: `npm run test:machines` (`node --test`, no extra dependency). Test files import
  with an explicit `.ts` extension and are excluded from `tsc`.
