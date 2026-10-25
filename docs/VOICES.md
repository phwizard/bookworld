# Voices: characters that speak in their own voice, and sing

By default a character's line is read aloud by the browser's own speech synthesis (on by default since 25 Oct 2026, V switches it off), with a voice of the character's gender (`voice.gender` in the world file, "f" or "m"; the generator writes it, and without it the persona's pronouns decide) and a fixed pitch and pace per character so that the Hatter never sounds like the Queen. The browser does not say which of its voices are men's and women's, so the client keeps a list of the common Apple, Google and Microsoft voice names. This document is about the next step: the world service renders a character's lines as audio in a voice chosen for it, caches the files, and the clients play them from where the character stands. The same machinery sings.

## How it works

`VOICE_BACKEND` in `.env` picks a renderer; the service tells each client which characters it voices (in the enter response) and serves `GET /api/worlds/:slug/voice/:character?text=...`. A line is rendered once per world, character and text, kept in `DATA_DIR/voice/`, and served from the cache afterwards (a millisecond; the first render takes the backend's time). Clients fetch the file when a character line arrives in the chat and play it through a positional node at the character; when the fetch fails they fall back to the browser voice. Human messages are never voiced. `VOICE_DAILY_CHARS` caps the rendered text per world per day (default 200000 characters), for the paid backends.

Backends:

- `command`: `VOICE_COMMAND` is a program with placeholders, one argument each, no shell: `{text} {out} {voice} {sample} {description} {lang} {gender} {name}`. It writes an mp3 to `{out}`. `VOICE_IDS` names the key under the character's `voice.ids` that `{voice}` is read from (`piper`, `say`; default `command`), so one world file carries an id per renderer. Four come with the repo:
  - `voice/.venv-piper/bin/python voice/piper-say.py {voice} {out} {text} {lang}` with `VOICE_IDS=piper`: Piper, small neural voices that run on any CPU, offline, free (the voices are a 60 to 120 MB file each, downloaded on first use into `voice/models/` or `$PIPER_MODELS`; the list is at https://huggingface.co/rhasspy/piper-voices/blob/main/VOICES.md). English, Ukrainian, Russian and some forty other languages; the character's `voice.ids.piper` names the voice, an empty id takes the default for `voice.lang`. Rosie uses `en_GB-jenny_dioco-medium`, an Irish English voice. A line of four seconds renders in about a second on this Mac, with 190 MB of memory; expect two to three seconds on the droplet's single core. The voice is fixed per model, no cloning, no description; the sound is clear and a step below the paid services. This is the production default. Setup: `uv venv --python 3.12 voice/.venv-piper && uv pip install --python voice/.venv-piper/bin/python piper-tts imageio-ffmpeg` (Piper's onnxruntime has no wheel for Python 3.13 and newer yet).
  - `voice/.venv-piper/bin/python voice/kokoro-say.py {voice} {out} {text} {lang} {gender} {name}` with `VOICE_IDS=kokoro`: Kokoro (Apache 2.0), one 82M model with some fifty voices, women's and men's, American and British English plus Japanese, Chinese, Spanish, French, Hindi, Italian and Portuguese; no Ukrainian or Russian. Noticeably more natural than Piper, still no cloning. `voice.ids.kokoro` names the voice (bf_emma, bm_george, af_heart, am_michael, ...); empty picks a British voice of the character's gender, varied by its name. Measured here: a four-second line in 2.4 s with 850 MB of memory, so it does not fit the droplet's budget (650M for the whole service); it suits a Mac, a bigger box or a GPU. Model files (340 MB) from the kokoro-onnx releases into `voice/models/kokoro/` or `$KOKORO_MODELS`; `uv pip install --python voice/.venv-piper/bin/python kokoro-onnx soundfile`.
  - `voice/say.sh {voice} {out} {text}` with `VOICE_IDS=say`: the Mac's own voices (`say -v '?'` lists them), for development. Rosie uses Moira (Irish English).
  - `voice/render.py --sample {sample} --out {out} --lang {lang} --text {text}`: a cloned voice from the character's sample with Chatterbox (MIT). Needs a Python 3.10 to 3.12 environment with `chatterbox-tts`, PyTorch and `soundfile`, and a GPU to be quick (a CPU takes seconds per line). English with the base model; the multilingual model covers Russian, German, French and more, not Ukrainian (October 2026). Not run here yet: this machine's Python is too new for PyTorch.
- `openai`: `OPENAI_API_KEY`, model `VOICE_OPENAI_MODEL` (default gpt-4o-mini-tts), the character's `voice.ids.openai` or a voice picked from its name, and `voice.description` as the speaking instructions. Cheap (well under a cent per line).
- `elevenlabs`: `ELEVENLABS_API_KEY`, the character's `voice.ids.elevenlabs` (a designed or cloned voice in your ElevenLabs account), model `VOICE_ELEVENLABS_MODEL` (default eleven_multilingual_v2). The best designed voices; roughly ten cents per line on the Creator plan.

The character's side in the world file:

```json
"voice": {
  "gender": "f",
  "description": "A woman in her forties with a soft Galway accent, warm and unhurried, a little husky from years of singing in the street.",
  "sample": "voices/rosie.wav",
  "lang": "en",
  "ids": { "piper": "en_GB-jenny_dioco-medium", "say": "Moira", "openai": "sage", "elevenlabs": "..." }
}
```

`gender` picks a woman's or a man's voice wherever a renderer or the browser has both. `sample` is 10 to 30 seconds of clean speech in the voice, next to world.json, the reference for a cloning renderer. A sample made with a paid service can serve as the reference for a self-hosted one, so the service is paid once per voice rather than per line; check the service's terms on that use before relying on it.

Which to choose: the browser's voices cost nothing and now have the right gender; Piper runs on the droplet and gives each character a fixed, clear voice; Kokoro sounds better and needs a bigger box; OpenAI's speech API follows the `description` (an accent, an age, a mood) for a fraction of a cent per line; ElevenLabs gives a voice designed or cloned for the character, reusable for every new line through its id, so lines rendered in advance and lines rendered live for an agent's replies are the same voice. The renderer and the cache are the same for all of them: what a character says in the chat arrives as audio from the server, the first time after the backend's delay, then at once.

## On the droplet

The box has one core, 2 GB of memory and no working apt (`docs/DEPLOY.md`), and the service runs under systemd with a memory budget and a read-only filesystem outside its data and home directories. The voices fit that without a GPU:

- `deploy/install.sh` runs `deploy/install-voice.sh` when `.env` has `VOICE_BACKEND=command` or `VOICE_SING`: it installs `uv` into the service user's home, makes a Python 3.12 venv there (`/var/www/bookworld-home/voice-venv`) with piper-tts, numpy, soundfile, pyworld and a bundled ffmpeg (`imageio-ffmpeg`, used when the box has none), and downloads every Piper voice named in a world file into `/var/www/bookworld-home/piper-models`. Idempotent; the first run takes a few minutes for the downloads.
- `.env.production` then has:

```
VOICE_BACKEND=command
VOICE_IDS=piper
VOICE_COMMAND=/var/www/bookworld-home/voice-venv/bin/python /var/www/bookworld/voice/piper-say.py {voice} {out} {text} {lang}
VOICE_SING=/var/www/bookworld-home/voice-venv/bin/python /var/www/bookworld/voice/sing.py
PIPER_MODELS=/var/www/bookworld-home/piper-models
```

  `PIPER_MODELS` must point into the home directory: the checkout is read-only to the service, so a voice could not be downloaded next to the script.
- The renders run inside the service's cgroup, one at a time (the service dedupes requests for the same line and sings one line at a time), at low priority (`nice 10`), so the unit's `MemoryMax` is 650M while voices are on: the service itself, plus Piper at about 190 MB, plus the singing renderer at about 100 MB. A spoken line takes two to three seconds on the single core the first time and is cached; a sung line, which speaks every word separately, takes about half a minute there and is rendered in the background when a lesson starts, so only the first visitor of a song waits for the first cue.
- Cloning (`voice/render.py`) stays off the droplet: it needs PyTorch and a GPU to be quick, and 4 to 8 GB of memory. A GPU box or a rendering API is a separate decision.

## Singing

A song file can carry the tune: a `{melody: ...}` line before a lyric line, one group per word, each note as `name:beats` and the notes of a word joined with `+` (`C4:1 C4:0.5 C4:1+G3:1.5 ...`; `-:0.5` is a rest inside a word; see `docs/SONGBOOK.md`). With `VOICE_SING` set to the singing renderer (`voice/.venv-piper/bin/python voice/sing.py`: the Piper venv serves, with numpy, soundfile and pyworld added; `ffmpeg` on the path or the `imageio-ffmpeg` package) and a `command` backend, the service sings any line that has a melody: `GET /api/worlds/:slug/sung/:character/:song/:line`.

The renderer (`voice/sing.py`) does not use a model that sings. It speaks each word through the voice backend, analyses the word with the WORLD vocoder (pitch, spectral envelope, aperiodicity), stretches the voiced part to the length of the word's notes while the consonants keep theirs, sets the pitch to the notes with a 60 ms glide between them and a light vibrato after the first 150 ms, resynthesises, and places each word on its beat at the song's tempo. The result is the character's voice, in tune (measured within a few cents on the first Clementine line) and on time, with the stretched-vowel sound of a vocoder on long notes. A line takes a few seconds to render and is cached.

In a lesson the trainer's cue is sung when its line has a melody: the client plays the rendered line from the trainer and keeps the browser voice quiet for that chat line. When a lesson starts, the service renders every line of the song that has a melody in the background, so the cues are ready by the time they come round. The chords of the cue still play on their own clock next to it; putting them on the melody's beats is the next step, together with the band's bar.

What would make it better, in order: a cloned voice from a good sample instead of the stock Piper or Mac voices (the renderer is the same, only the speak command changes); a melody per song written by someone who knows the tune (the Clementine lines are a sketch); a singing voice conversion stage (Seed-VC) over a stock singer for long notes, which needs a GPU.
