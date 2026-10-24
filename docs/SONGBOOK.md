# The Songbook: a practice room on the book-world engine

A world can have a practice room: a character who teaches songs line by line, keeps your score, and brings back what you keep forgetting. The first one is `worlds/songbook` with Rosie, a busker, two traditional songs, and a stage next door.

## How a lesson goes

1. Walk in, pick up the guitar or the piano (E), press L. The panel lists the songs on the shelf with your progress: lines learned, last session.
2. Pick a mode. **chords**: the trainer sings a line and you answer the next line's chords on the instrument you carry. **words**: the trainer sings a line and plays the next one; you type its words. **both**: each line is asked in the round it is weakest at.
3. Each round the trainer sings the previous line into the chat (with voices on, V, you hear it) and plays its chords for the room. Then the ask: the chords of the next line (the panel shows its words and how many chord changes it has) or its words.
4. Chords are judged as a progression: repeated strums of one chord count once, and "Gmaj" is "G". The round ends when you have played as many changes as the line has, or six seconds after your last chord; the panel shows what you have played so far. While the verdict is on screen the next line is on its way, and chords played then are not counted. Words pass from 80 per cent similarity (case, punctuation and apostrophes are ignored).
5. **Hint** gives the first chord or the first two words; the line is not promoted that round. **Skip** counts as a miss. After a miss the trainer shows the line: plays the chords that were asked for ("It goes C G7 C G7. Listen.") or sings the words. A missed line comes back two rounds later and once more at the end of the session.
6. Every line has a box per round (0 to 3). A hit moves it up, a miss drops it to 0. A line is learned when both its boxes are at the top; learned lines are left out of the next session, and a song with every line learned is ready for the stage.

The score goes into the chat as a narration line after every miss and every fifth round (`Lesson: Taras on "The Water Is Wide" (chords): round 7, 5 of 7 right, 2 of 12 lines learned, keeps missing line 2 "Neither have I wings"`), and when the session ends the trainer sums it up in character. Nothing in the drill calls a model; the trainer agent is asked only when you talk to it.

## Between visits: the list, the goal, and picking up where you stopped

The panel has a star on each song (your list) and a goal line in your own words ("play Clementine through on the stage by Christmas"). The room keeps them with your progress, per world and visitor, and remembers the last song and mode. When you come back into the practice room the trainer greets you with them instead of the room's standard welcome ("Welcome back, Taras. Last time, yesterday, we worked on "Oh My Darling, Clementine" (words); 3 of 8 lines are yours. Your goal: ... Pick up the guitar and press L; Continue takes us on from where we stopped."), and the panel opens with a Continue button for that song and mode. The goal also travels in the scoreboard attached to your questions and in the end-of-session note for the trainer's Memory. A reload is not a return: the greeting is for someone walking in.

## Talking to the trainer

Name the trainer in the chat during a lesson ("Rosie, how am I doing?") and the client attaches the scoreboard in brackets to your message, because an Ethora agent does not see the room's own narration (`docs/ETHORA-GAPS.md`, 22). The trainer's prompt (`lessonPrompt` in `shared/src/song.ts`, added by the provisioner to every character named in `lessons`) tells it to answer from that line and from its Memory, name exact lines, keep to a few sentences, and never recite a whole song.

Memory: when a session ends the world service writes a one-line note for the trainer's Memory (the agent's standing notes, formerly SOUL.MD), such as `- 2026-10-24: Taras practised "The Water Is Wide" (chords): 5 of 7 right, 2 of 12 lines learned, session 3. Keeps missing line 2 "Neither have I wings"`. The write goes through the hosted Ethora MCP (`ethora-agent-soul-append`) and needs `ETHORA_API_KEY` in `.env`; without it the note is only logged. The trainer also gets the song files as knowledge (the provisioner uploads them), so "Rosie, what are the chords of line 2?" is answered from the file.

## Adding songs

Song files live in `worlds/<slug>/songs/` as ChordPro:

```
{title: The Water Is Wide}
{artist: Traditional}
{key: G}
{license: public-domain}
{language: en}

{start_of_verse: Verse 1}
[G]The water is [C]wide, I [G]cannot get [D]o'er
[C]Neither have [G]I wings to [D]fly
{end_of_verse}
```

`pnpm song -- --world songbook --file song.pdf` (or `.txt`) converts a file into that form. It reads ChordPro, or the common layout with a line of chord names above each line of words and section names like `[Chorus]` or `Verse 2:` on their own line; PDFs go through `pdftotext -layout` (poppler). `--id`, `--title` and `--artist` override what the file says. Check the result by eye: the drill asks exactly what the file says.

Licence (rule 5 in `CLAUDE.md`): the hosted world carries traditional and public-domain songs only. For songs whose words are in copyright use `--private`: the file goes to `songs/private/`, which is gitignored, and is read by your own server only. A `license` line in the file is shown nowhere but kept for the record.

The world file names the practice room:

```json
"lessons": [ { "room": "practice-room", "trainer": "rosie", "instrument": "guitar" } ]
```

`instrument` is what the trainer plays the cues on; `songs` (optional) limits the shelf to some of the files. The service loads every song file at start; a file that does not parse is skipped with a warning in the log. Progress is kept per world and visitor in `DATA_DIR/progress/` (no names, no text).

## A real instrument

The chord bar has a "listen (mic)" switch when you carry a chord instrument. The browser asks for the microphone once; the client folds the spectrum (a 16384-point analyser, so the low strings get bins finer than a semitone) into the twelve pitch classes fifty times a second and matches it against the chords the song uses (`shared/src/chroma.ts`). A chord that wins three frames in a row after a strum counts as played, exactly like a key press, except that nothing is synthesised: the room hears the real one through the chat line, not through the speakers. Nothing is recorded or sent anywhere. The matcher is tested on synthetic plucked strings in the usual open voicings (`server/test/chroma-guitar.test.ts`: every chord of each song wins among that song's chords); a seventh against its own triad (G7 against G) is the close call, which is why a song's chords are the only candidates. With a real guitar in hand the things to adjust are `RMS_FLOOR`, `STABLE_FRAMES` and the two thresholds in `client/src/audio/listen.ts` and `shared/src/chroma.ts`.

## Singing the words

In a words round (modes words and both) the panel has a "sing (mic)" switch. It uses the browser's own speech recognition (Chrome, Edge and Safari have it; Firefox does not) in the song's language, shows what it hears ("Heard: ..."), and the room judges: a hit the moment the words match the line (the cue sung before it is allowed in front), otherwise a miss a few seconds after the recogniser's last settled words, on everything heard. Typing still works alongside. Chords and singing can run together: the chord matcher reads the microphone's spectrum and the recogniser the words, so playing and singing a line in both mode answers whichever round is on. Expect the recogniser to do worse on sung words than on spoken ones, and worse again over a loud guitar; sing close to the microphone. Chrome and Edge send the audio to Google or Microsoft for recognition, Safari to Apple: that is the browser's arrangement, not this project's, and the switch is off by default.

Languages: a song file says `{language: uk}` (ChordPro) or `Language: Ukrainian` (over-the-words layout), and the recogniser listens in that language (uk-UA, ru-RU, de-DE and so on; `speechLang` in `shared/src/song.ts` has the table, anything else is passed through as a tag). Words are compared by letters of any alphabet, apostrophes dropped, ё and е, ґ and г counted the same. Chord sheets from Ukraine, Russia and Germany write B as H: `H7` is read as `B7`. Without a language line the song is taken as English.

## The debug log

`DEBUG_LOG=on` in `.env` makes the world service write every event with its text to `server/data/debug/<world>-<date>.jsonl` (`DEBUG_LOG=/path/to/file.jsonl` for one file): enters, joins, leaves, moves, pick-ups, chords, the lesson commands and every state the panel is sent (round, what was played or heard, the verdict), everything the service posts into the chat, the Memory notes, Ethora errors, and the room's chat as the clients see it (humans and characters alike). The service cannot read a room's history with its own token (`docs/ETHORA-GAPS.md`, 23), so while the log is on the clients mirror each message they see and the server writes each once. The usage log (`docs/API.md`, metrics) is separate and keeps no text. The debug log is for your own test server; leave it unset in production (`server/data/` is gitignored).

## Agents in the jam: what it would take

Where things stand. A character already "plays": the service posts a music line in its name and every client synthesises it from where the character stands, and the trainer's cues, the "It goes C G7 C G7. Listen." after a miss, and a character's own `♪ Rosie (guitar): ...` reply all go through that path. A character "sings" the same way: a character line in the chat, read aloud by the browser's speech synthesis when voices are on. Both are text in, sound out, with a few seconds of latency when a model is involved and none when the service scripts it.

Playing along in time (a bass line or a drum pattern under what you play) does not need a model at all. It needs a clock in the room (a tempo and a bar, which the world service can broadcast), a follower that reads the chords as they arrive (from the chord bar or the microphone matcher) and emits the bass note or the pattern on the next beat, and a client that plays character lines on the beat rather than as soon as they arrive. That is the next step on this engine and a reasonable weekend: tempo in the song file, a metronome in the panel, a `rhythm` role for a character.

A character that improvises a melody or a harmony, or demonstrates an alternative version, is where a model comes in, and the honest limits are latency and musical skill. A language model answering in text takes seconds, so it cannot react within a bar; it can plan a phrase for the next section while the current one plays, which is how a scripted "trainer plays the part you forgot" would work: the service asks for a line in the notation (chords, or a melody in a simple note notation with durations) a section ahead, and plays it on the beat. Models write plausible chord progressions and simple melodies in text; they do not play expressively, and nothing here synthesises a voice that sings in tune. Real-time musical improvisation with a model needs a music model with a streaming interface (Google's Lyria RealTime is the published example: prompt-steered audio in real time, but it generates a continuous texture, it does not listen to you), and it would arrive as an audio stream over WebRTC rather than as chord names in the chat.

Voice. Singing synthesis in a browser is not available off the shelf; speech synthesis is (what V uses), and a cloud text-to-speech voice reading the lyrics in rhythm is the realistic "sings along" for the next year. Real-time voice chat between people in a room (WebRTC, proximity voice) is a separate feature on the plan and the natural carrier for a human jam; an agent joining it would need a streaming speech model on the service side (speech in, speech out, in the hundreds of milliseconds), which exists for conversation and not for singing.

So: rhythm and bass accompaniment from the service, soon and deterministic; a model-planned phrase a section ahead, feasible; a character that listens and improvises in real time, or sings, is research rather than a feature, and the engine's notation (chords, later notes with durations) is the right interface to grow toward it.
