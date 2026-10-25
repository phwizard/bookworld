#!/usr/bin/env bash
# Runs ON THE BOX as root, from deploy/install.sh when .env turns the voices on (VOICE_BACKEND=command or VOICE_SING).
# Sets up what voice/piper-say.py, voice/kokoro-say.py and voice/sing.py need without apt (docs/DEPLOY.md: apt is
# broken on the box): uv in the service user's home, a Python 3.12 venv there with piper-tts, kokoro-onnx, numpy,
# soundfile, pyworld and a bundled ffmpeg, the Piper voices named in the world files, and the Kokoro model files when
# .env has VOICE_IDS=kokoro (340 MB, once). Idempotent; a second run takes a second.
# .env then points at the venv: see docs/VOICES.md, "On the droplet".
set -euo pipefail
APP=/var/www/bookworld
HOME_DIR=/var/www/bookworld-home
VENV=$HOME_DIR/voice-venv
MODELS=$HOME_DIR/piper-models
KOKORO=$HOME_DIR/kokoro-models
KOKORO_URL=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
run() { sudo -u bookworld -H env HOME="$HOME_DIR" PATH="$HOME_DIR/.local/bin:$PATH" UV_PYTHON_INSTALL_DIR="$HOME_DIR/.local/share/uv/python" UV_NO_CONFIG=1 "$@"; }
# uv looks for uv.toml and a project in the working directory and above; install.sh runs from /root, which the
# service user cannot read ("failed to open file /root/uv.toml: Permission denied"), so work from its home instead
mkdir -p "$HOME_DIR" && cd "$HOME_DIR"

if ! run test -x "$HOME_DIR/.local/bin/uv"; then
  echo "voice: installing uv into $HOME_DIR/.local/bin"
  run sh -c 'curl -LsSf https://astral.sh/uv/install.sh | sh -s -- --no-modify-path' >/dev/null
fi
if ! run test -x "$VENV/bin/python"; then
  echo "voice: creating $VENV (Python 3.12, downloaded by uv)"
  run uv venv --quiet --python 3.12 "$VENV"
fi
# setuptools<81 keeps pkg_resources, which pyworld imports at load
run uv pip install --quiet --python "$VENV/bin/python" piper-tts kokoro-onnx numpy soundfile pyworld imageio-ffmpeg "setuptools<81"
run mkdir -p "$MODELS"
# every Piper voice named in a world file, plus the English default, so the first line does not wait for a download
VOICES=$(cat "$APP"/worlds/*/world.json | grep -o '"piper": *"[^"]*"' | sed 's/.*: *"//; s/"//' | sort -u)
for v in en_GB-jenny_dioco-medium $VOICES; do
  [ -f "$MODELS/$v.onnx" ] || { echo "voice: downloading $v"; run nice -n 19 "$VENV/bin/python" -m piper.download_voices --download-dir "$MODELS" "$v" 2>&1 | grep -v INFO || true; }
done
# Kokoro (docs/VOICES.md): the model and the voice bank, only when .env selects it (it needs the bigger box)
if grep -qE '^VOICE_IDS=kokoro' "$APP/.env"; then
  run mkdir -p "$KOKORO"
  for f in kokoro-v1.0.onnx voices-v1.0.bin; do
    [ -s "$KOKORO/$f" ] || { echo "voice: downloading $f"; run curl -fsSL -o "$KOKORO/$f.part" "$KOKORO_URL/$f" && run mv "$KOKORO/$f.part" "$KOKORO/$f"; }
  done
  echo "voice: Kokoro model files in $KOKORO"
fi
if command -v ffmpeg >/dev/null 2>&1; then echo "voice: ffmpeg on the path"; else echo "voice: no ffmpeg on the box, the one in imageio-ffmpeg is used"; fi
echo "voice: ready ($(ls "$MODELS"/*.onnx 2>/dev/null | wc -l | tr -d ' ') Piper voices in $MODELS)"
