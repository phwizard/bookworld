# Ethora facts verified on 17 Oct 2026

From the Ethora source as cloned that day (backend 2026-09-17, chat component clone 26.3.22 with npm latest 26.10.4) and the hosted MCP tool list. Re-verify against the public docs (`search` tool on the MCP, or https://ethora.com) before relying on exact shapes; the API may have moved on.

## Chat component (`@ethora/chat-component`, React)
Config (`IConfig`): `appId`, `baseUrl`, `customAppToken`, `xmppSettings`, `disableHeader`, `disableRooms`, `forceSetRoom`, `setRoomJidInPath`, `defaultRooms[]`, `customRooms { rooms, disableGetRooms, singleRoom }`, `backgroundChat { color, image }`, `colors { primary, secondary }`, `customLogin { enabled, loginFunction: () => Promise<User|null> }`, `userLogin`, `jwtLogin` (legacy), `refreshTokens`, `eventHandlers { onMessageSent, onMessageFailed, onMessageEdited, onMessageHistory?, onMessageError? }`, `messageTextFilter { enabled, filterFunction }`, `secondarySendButton`, `whitelistSystemMessage: string[]`, `customSystemMessage: ComponentType<MessageProps>`, `customTypingIndicator`, `disableChatInfo {...}`, `chatHeaderSettings { hide, disableCreate, disableMenu, hideSearch }`, `disableNewChatButton`, `disableUserCount`, `translates`, `inAppNotifications`, `pushNotifications`, `historyQoS`, `newArch`, `useStoreConsoleEnabled`.
Not found: an incoming-message event handler. Check the exported store/hooks (`roomStore`, `context`) at the installed version.

Corrections from the installed 26.10.4 (17 Oct, evening): `customRooms`, `singleRoom` and `forceSetRoom` do not exist in `IConfig` any more. Pin a room with the `roomJID` prop on `<Chat>` (full JID `${appId}_${chatId}@conference.<xmpp domain>`) plus `disableRooms`. Login as an injected user: `jwtLogin: { enabled, token }` where the token is the client JWT from `@ethora/sdk-backend` (`createChatUserJwtToken(userId)`, exchanged by the component through `loginViaJwt`), or `userLogin: { enabled, user }` with a full user object. Keep `initBeforeLoad: true` and the same memoised config on `XmppProvider` and `Chat`. Incoming messages: the `CustomScrollableArea` prop receives `messages: IMessage[]` and a `renderMessage` function, which is the supported way to observe the room's messages (bubbles). `useXmppClient()` exposes the raw xmpp.js client as a last resort. `CustomMessageComponent` gets `MessageProps { message, isUser, isReply }` for custom rendering of narration lines.

## Backend SDK (`@ethora/sdk-backend` 26.8.1)
Server side only. Env `ETHORA_CHAT_API_URL`, `ETHORA_CHAT_APP_ID`, `ETHORA_CHAT_APP_SECRET` (App Secret from the dashboard API tab; not obtainable over MCP). Signs a B2B server token (`x-custom-token`) per request. Methods used here: `createUser(userId, {firstName, lastName, email})` (batch endpoint; lastName must be 2+ chars), `grantUserAccessToChatRoom(chatId, userId)` / `removeUserAccessFromChatRoom` (`POST`/`DELETE /v2/chats/users-access` with `chatName = ${appId}_${chatId}`, members `${appId}_${userId}`), `broadcastToAppChats(appId, {text, chatNames, senderName, metadata})`, `createChatUserJwtToken(userId)`. Room ids created over MCP (Mongo ids) work directly as `chatId`.

## Backend REST (base `/v1`, routes in `routes/chat.js`)
- Rooms: `POST /v2/apps/:appId/chats`, `GET /v2/apps/:appId/chats`, `PATCH /v2/apps/:appId/chats/:chatId`, `DELETE /v2/apps/:appId/chats`.
- Membership: `POST /v2/apps/:appId/chats/users-access`, `DELETE /v2/apps/:appId/chats/users-access`, `PATCH /v2/apps/:appId/chats/users`, `GET /v2/chats/users`, `GET /v2/apps/:appId/users/:userId/chats`. Remove-user sets the XMPP room affiliation (`set_room_affiliation`) and updates `user2chats`.
- Messages: `GET /v2/apps/:appId/chats/:chatId/messages`, `.../messages/context`, `DELETE .../messages`; broadcast `POST /v2/apps/:appId/chats/broadcast` + job polling.
- Agents: `POST /v2/apps/:appId/agents/:idOrAddress/invite-to-chat`, `POST /v2/agents/:idOrAddress/bot-instances/:botInstanceId/leave-chat`.
- Calls: `chat.call.ts` (WebRTC room calls; enabled on Ethora Cloud prod Oct 2026).
- Room JID: `${appId}_${chatId}@<xmpp domain>`; user JID `${appId}_${userId}@...`.

## Agent model (`models/agent.js`)
`displayName`, `avatarUrl`, `bio`, `prompt`, `soulMd` (+ updatedBy operator|agent), `llmProvider`, `llmModel`, `embeddingModel`, `contextSize`, `responseMode: always|mentioned|smart|probability` (default smart), `responseProbability` 0-1, `cooldownSec`, `greetingMessage`, `isRAG`, `ragTags[]`, `heartbeat { enabled, schedule, prompt }` (config only, no worker), `flowsYaml` + compiled `flows[]`, `visibility`, `ownerAppId`.

## Hosted MCP (`https://mcp.chat.ethora.com/mcp`, OAuth; also `/mcp/k/<key>`)
Doc upload works in user auth mode on the hosted server (used for the Hatter). `ethora-message-send` with `waitForReplySec` returns the agent reply; useful as a smoke test. Not present on the hosted tool list: `ethora-app-credentials-reveal` (so the App Secret comes from the dashboard).

Tools: `ethora-status`, `ethora-help`, `ethora-app-{list,select,create,update,delete,export,import,rooms-list}`, `ethora-chat-{create,delete,history,unread-counts}`, `ethora-message-{send,search,context}`, `ethora-broadcast-{send,job-get,job-wait}`, `ethora-user-batch-{create,job-get,job-wait}`, `ethora-agent-{list,get,create,update,delete,clone,export,import,invite,activate,try,soul-set,soul-append,knowledge-get,knowledge-rebuild,model-list,visibility-set}`, `ethora-source-doc-{upload,list,delete,tags-update}`, `ethora-source-site-*` (crawl), `ethora-file-{upload,get,delete}`, `ethora-widget-*`, `ethora-feedback-submit`, `search`, `fetch`. Agent create/update accept `responseMode`, `cooldownSec`, `greetingMessage`, `flowsYaml`, `soulMd`.
Related: Claude Code skill `dappros/chat-ethora-skill` (adds the chat component to React/RN apps), example repo `dappros/ethora-ollama-example` (self-hosted model).

## Legacy, do not use
`models/room.js` with `ownerNavLinks`/`userNavLinks` (N/E/S/W), `/v1/rooms`, `RoomFactory` contract, `scripts/linkRooms.js` ("Agora (Start here)"). Web3-era prototype of the same idea; unused by current clients.
