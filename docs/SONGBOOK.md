# The Songbook: a practice room on the book-world engine

A world can have a practice room: a character who teaches songs line by line, keeps your score, and brings back what you keep forgetting. The first one is `worlds/songbook` with Rosie, a busker, two traditional songs, and a stage next door.

## How a lesson goes

1. Walk in, pick up the guitar or the piano (E), press L. The panel lists the songs on the shelf with your progress: lines learned, last session.
2. Pick a mode. **chords**: the trainer sings a line and you answer the next line's chords on the instrument you carry. **words**: the trainer sings a line and plays the next one; you type its words. **both**: each line is asked in the round it is weakest at.
3. Each round the trainer sings the previous line into the chat (with voices on, V, you hear it) and plays its chords for the room. Then the ask: the chords of the next line (the panel shows its words and how many chord changes it has) or its words.
4. Chords are judged as a progression: repeated strums of one chord count once, and "Gmaj" is "G". The round ends when you have played as many changes as the line has, or six seconds after your last chord; the panel shows what you have played so far. While the verdict is on screen the next line is on its way, and chords played then are not counted. Words pass from 80 per cent similarity (case, punctuation and apostrophes are ignored).
5. **Hint** gives the first chord or the first two words; the line is not promoted that round. **Skip** counts as a miss. A missed line comes back two rounds later and once more at the end of the session.
6. Every line has a box per round (0 to 3). A hit moves it up, a miss drops it to 0. A line is learned when both its boxes are at the top; learned lines are left out of the next session, and a song with every line learned is ready for the stage.

The score goes into the chat as a narration line after every miss and every fifth round (`Lesson: Taras on "The Water Is Wide" (chords): round 7, 5 of 7 right, 2 of 12 lines learned, keeps missing line 2 "Neither have I wings"`), and when the session ends the trainer sums it up in character. Nothing in the drill calls a model; the trainer agent is asked only when you talk to it.

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

The chord bar has a "listen (mic)" switch when you carry a chord instrument. The browser asks for the microphone once; the client folds the spectrum into the twelve pitch classes fifty times a second and matches it against the chords the song uses (`shared/src/chroma.ts`). A chord that wins three frames in a row after a strum counts as played, exactly like a key press, except that nothing is synthesised: the room hears the real one through the chat line, not through the speakers. Nothing is recorded or sent anywhere. The matcher is tuned on synthetic spectra so far; with a real guitar expect to adjust the thresholds in `client/src/audio/listen.ts`.
