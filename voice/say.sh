#!/bin/sh
# A voice backend for development on a Mac: the system's own speech synthesis. Used as
#   VOICE_BACKEND=command
#   VOICE_COMMAND=voice/say.sh {voice} {out} {text}
# {voice} is the character's `voice.ids.say` (a name from `say -v '?'`, e.g. Moira, Daniel, Samantha); empty = the system default.
# Writes an mp3 to {out} (ffmpeg) or, without ffmpeg, a wav renamed to the mp3 path (browsers decode it anyway).
set -e
voice="$1"; out="$2"; text="$3"
tmp="${out%.mp3}.aiff"
if [ -n "$voice" ]; then say -v "$voice" -o "$tmp" "$text"; else say -o "$tmp" "$text"; fi
if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -loglevel error -y -i "$tmp" -codec:a libmp3lame -q:a 4 "$out"
else
  afconvert -f WAVE -d LEI16 "$tmp" "$out"
fi
rm -f "$tmp"
