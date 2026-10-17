# Ethora gaps and questions (back channel to Ethora R&D)

Record here anything Ethora should do that it does not do today. The owner takes these to the Ethora backend/frontend repos. Keep the workaround so this project is never blocked on them.

| # | Date | Gap | Why we need it | Workaround here | Status |
|---|---|---|---|---|---|
| 1 | 261017 | Chat component has no incoming-message event handler in its config (`eventHandlers` covers sent/edited/failed/history only) | Speech bubbles over avatars need every new message in the current room | `CustomScrollableArea` prop receives the room's `messages` and `renderMessage`; mirror them into the bubble store from there. Fallback: `useXmppClient().client` stanza events | workaround found |
| 2 | 261017 | No outbound webhooks / server-side event stream per App for chat events | World service wants to react to messages (commands, scripted cues) without a client in the loop | Client-side command parsing via `onMessageSent`; world service drives scripts on its own timer | open |
| 3 | 261017 | No custom metadata on a chat/room (wallpaper, exits, description) | Would let a world live entirely in Ethora | Keep it in `world.json` | open |
| 4 | 261017 | Agent `heartbeat` (scheduled behaviour) stored but no worker | Characters that move or speak on a schedule | World service moves agents via invite-to-chat / leave-chat and posts scripted lines itself | open |
| 5 | 261017 | No documented guest/anonymous login path for the chat component (the website widget does it server-side) | Enter a world from a link with just a display name | World service creates the guest with `@ethora/sdk-backend` `createUser` and hands the client a `createChatUserJwtToken` token for `jwtLogin` | workaround works (SDK) |
| 6 | 261017 | No defined "system message" envelope for joins/leaves | Clients render movement messages without string matching | Narration posted by the broadcast endpoint as "Narrator" with body prefix `* ` and `metadata.bookworld`; render via `CustomMessageComponent` | open |
| 7 | 261017 | `createUser` requires a last name of 2+ characters, so a guest with just a display name shows as "Alice (guest)" | Players join with one name | lastName "(guest)"; ask for single-name users or a display-name field | open |
| 8 | 261017 | The App Secret cannot be read over MCP (`ethora-app-credentials-reveal` is not on the hosted tool list) and the backend SDK needs it | Provisioning a world end-to-end from a script | Copy it from the dashboard API tab into `.env` once per world | open |
| 9 | 261017 | Agents ignore style rules about punctuation (the Hatter used long dashes despite the prompt) | House style (rule 6) in generated text | Post-process agent output in the client, or accept it | open |
