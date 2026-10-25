# Voices: characters that speak in their own voice, and sing

By default a character's line is read aloud by the browser's own speech synthesis (V, off by default), with a fixed voice, pitch and pace per character so that the Hatter never sounds like the Queen. This document is about the next step: the world service renders a character's lines as audio in a voice chosen for it, caches the files, and the clients play them from where the character stands. The same machinery sings.

## How it works

`VOICE_BACKEND` in `.env` picks a renderer; the service tells each client which characters it voices (in the enter response) and serves `GET /api/worlds/:slug/voice/:character?text=...`. A line is rendered once per world, character and text, kept in `DATA_DIR/voice/`, and served from the cache afterwards (a millisecond; the first render takes the backend's time). Clients fetch the file when a character line arrives in the chat and play it through a positional node at the character; when the fetch fails they fall back to the browser voice. Human messages are never voiced. `VOICE_DAILY_CHARS` caps the rendered text per world per day (default 200000 characters), for the paid backends.

Backends:

- `command`: `VOICE_COMMAND` is a program with placeholders, one argument each, no shell: `{text} {out} {voice} {sample} {description} {lang}`. It writes an mp3 to `{out}`. Two come with the repo:
  - `voice/say.sh {voice} {out} {text}`: the Mac's own voices (`say -v '?'` lists them), for development. Rosie uses Moira (Irish English).
  - `voice/render.py --sample {sample} --out {out} --lang {lang} --text {text}`: a cloned voice from the character's sample with Chatterbox (MIT). Needs a Python 3.10 to 3.12 environment with `chatterbox-tts`, PyTorch and `soundfile`, and a GPU to be quick (a CPU takes seconds per line). English with the base model; the multilingual model covers Russian, German, French and more, not Ukrainian (October 2026). Not run here yet: this machine's Python is too new for PyTorch.
- `openai`: `OPENAI_API_KEY`, model `VOICE_OPENAI_MODEL` (default gpt-4o-mini-tts), the character's `voice.ids.openai` or a voice picked from its name, and `voice.description` as the speaking instructions. Cheap (well under a cent per line).
- `elevenlabs`: `ELEVENLABS_API_KEY`, the character's `voice.ids.elevenlabs` (a designed or cloned voice in your ElevenLabs account), model `VOICE_ELEVENLABS_MODEL` (default eleven_multilingual_v2). The best designed voices; roughly ten cents per line on the Creator plan.

The character's side in the world file:

```json
"voice": {
  "description": "A woman in her forties with a soft Galway accent, warm and unhurried, a little husky from years of singing in the street.",
  "sample": "voices/rosie.wav",
  "lang": "en",
  "ids": { "say": "Moira", "openai": "sage", "elevenlabs": "..." }
}
```

`sample` is 10 to 30 seconds of clean speech in the voice, next to world.json, the reference for a cloning renderer. A sample made with a paid service can serve as the reference for a self-hosted one, so the service is paid once per voice rather than per line; check the service's terms on that use before relying on it.

## Singing

A song file can carry the tune: a `{melody: ...}` line before a lyric line, one group per word, each note as `name:beats` and the notes of a word joined with `+` (`C4:1 C4:0.5 C4:1+G3:1.5 ...`; `-:0.5` is a rest inside a word; see `docs/SONGBOOK.md`). With `VOICE_SING` set to the singing renderer (`voice/.venv/bin/python voice/sing.py`, a venv with numpy, soundfile and pyworld; `ffmpeg` on the path) and a `command` backend, the service sings any line that has a melody: `GET /api/worlds/:slug/sung/:character/:song/:line`.

The renderer (`voice/sing.py`) does not use a model that sings. It speaks each word through the voice backend, analyses the word with the WORLD vocoder (pitch, spectral envelope, aperiodicity), stretches the voiced part to the length of the word's notes while the consonants keep theirs, sets the pitch to the notes with a 60 ms glide between them and a light vibrato after the first 150 ms, resynthesises, and places each word on its beat at the song's tempo. The result is the character's voice, in tune (measured within a few cents on the first Clementine line) and on time, with the stretched-vowel sound of a vocoder on long notes. A line takes a few seconds to render and is cached.

In a lesson the trainer's cue is sung when its line has a melody: the client plays the rendered line from the trainer and keeps the browser voice quiet for that chat line. When a lesson starts, the service renders every line of the song that has a melody in the background, so the cues are ready by the time they come round. The chords of the cue still play on their own clock next to it; putting them on the melody's beats is the next step, together with the band's bar.

What would make it better, in order: a cloned voice from a good sample instead of the Mac's voices (the renderer is the same, only the speak command changes); a melody per song written by someone who knows the tune (the Clementine lines are a sketch); a singing voice conversion stage (Seed-VC) over a stock singer for long notes, which needs a GPU.
