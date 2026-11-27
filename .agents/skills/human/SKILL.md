---
name: human
description: Ask a human in Slack for clarification or plan confirmation before uncertain or substantial changes.
---

Ask a human in Slack for clarification or confirmation before implementing an issue, instead of guessing.

When to ask:
* The task is vague: you cannot name what "done" looks like, two readings of it lead to different changes, or it misses
  a decision only the user can make (a name, a behavior, a scope). Ask for clarification: one to three specific
  questions, each with the options you see and the one you would pick.
* The feature is relatively big: a new command, page or automation, a change to the spec of more than one case, a change
  across several modules, or a change hard to undo. Ask for confirmation of your plan: the steps, the files, what is out
  of scope.
* Otherwise, a small and clear task, do not ask: implement it.

Where: the Slack channel `ai-workshop-munich-2026-os`, with the bot token in the `SLACK_BOT_TOKEN` environment variable.
The bot needs the scopes `chat:write` and `channels:history`, and must be a member of the channel (`/invite` it there).
Install `jq` if missing. Never print the token or put it in a commit, a comment or a log.

How:
* Post the question to the channel by its name. Keep `.channel`, the channel's id, as `CHANNEL`, and `.ts`, the
  question's timestamp, as both `TS` (the thread) and `LAST_TS` (the bot's latest message): the replies come in its
  thread.
  ```bash
  jq -n --arg text "$TEXT" '{channel: "#ai-workshop-munich-2026-os", text: $text}' \
    | curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H "Content-Type: application/json; charset=utf-8" \
      --data @- https://slack.com/api/chat.postMessage | jq -r '.ok, .error, .channel, .ts'
  ```
  The message: the issue's link and title, the questions or the plan, and how to answer, e.g. "Reply in this thread:
  'yes' to go ahead, or what to change." Sign it with the automation's signature.
* Wait up to 10 minutes for a reply in the thread, checking every 30 seconds. A reply is a human's message newer than
  the bot's latest one; the bot's own messages and earlier rounds' replies are not:
  ```bash
  curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    "https://slack.com/api/conversations.replies?channel=$CHANNEL&ts=$TS&oldest=$LAST_TS" \
    | jq -r --arg last "$LAST_TS" '.messages[] | select((.ts | tonumber) > ($last | tonumber) and .bot_id == null) | .text'
  ```
* To ask again, post in the same thread, with `thread_ts`, and set `LAST_TS` to the new message's `.ts`:
  ```bash
  jq -n --arg channel "$CHANNEL" --arg ts "$TS" --arg text "$TEXT" '{channel: $channel, thread_ts: $ts, text: $text}' \
    | curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H "Content-Type: application/json; charset=utf-8" \
      --data @- https://slack.com/api/chat.postMessage | jq -r '.ok, .error, .ts'
  ```
* Every Slack API call answers `"ok": true` on success; on `"ok": false`, read `error` (`not_in_channel`,
  `channel_not_found`, `missing_scope`, `invalid_auth`, ...) and treat it as Slack being unavailable.

What next:
* A reply answers the questions or confirms the plan: implement it as answered, and note the answer and its link in the
  Pull Request description.
* A reply asks for changes to the plan: update the plan and ask again in the same thread, as above; at
  most 3 rounds.
* No reply within 10 minutes, no clear answer after 3 rounds, `SLACK_BOT_TOKEN` not set, or Slack unavailable: do not
  guess. Post the questions or the plan as a comment on the issue, request the attention of the AI operator, and stop.
