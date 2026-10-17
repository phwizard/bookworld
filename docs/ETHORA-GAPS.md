# Ethora gaps and questions (back channel to Ethora R&D)

Record here anything Ethora should do that it does not do today. The owner takes these to the Ethora backend/frontend repos. Keep the workaround so this project is never blocked on them.

| # | Date | Gap | Why we need it | Workaround here | Status |
|---|---|---|---|---|---|
| 1 | 261017 | Chat component has no incoming-message event handler in its config (`eventHandlers` covers sent/edited/failed/history only) | Speech bubbles over avatars need every new message in the current room | Check the component's store/hooks first; else poll `GET /v2/apps/:appId/chats/:chatId/messages` or subscribe via a thin XMPP client | open |
| 2 | 261017 | No outbound webhooks / server-side event stream per App for chat events | World service wants to react to messages (commands, scripted cues) without a client in the loop | Client-side command parsing via `onMessageSent`; world service drives scripts on its own timer | open |
| 3 | 261017 | No custom metadata on a chat/room (wallpaper, exits, description) | Would let a world live entirely in Ethora | Keep it in `world.json` | open |
| 4 | 261017 | Agent `heartbeat` (scheduled behaviour) stored but no worker | Characters that move or speak on a schedule | World service moves agents via invite-to-chat / leave-chat and posts scripted lines itself | open |
| 5 | 261017 | No documented guest/anonymous login path for the chat component (the website widget does it server-side) | Enter a world from a link with just a display name | `customLogin.loginFunction` backed by our world service creating users via the API | open |
| 6 | 261017 | No defined "system message" envelope for joins/leaves | Clients render movement messages without string matching | Our own JSON convention in message body/metadata, rendered via `customSystemMessage` | open |
