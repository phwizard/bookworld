#!/usr/bin/env python3
"""
A voice backend on Kokoro (https://github.com/hexgrad/kokoro, Apache 2.0; the ONNX build by kokoro-onnx): one 82M
model with some fifty voices, women's and men's, American and British English and a few other languages (no Ukrainian
or Russian). Runs on a CPU. Used as
  VOICE_BACKEND=command
  VOICE_IDS=kokoro
  VOICE_COMMAND=voice/.venv-piper/bin/python voice/kokoro-say.py {voice} {out} {text} {lang} {gender} {name}
{voice} is the character's `voice.ids.kokoro` (af_heart, bf_emma, bm_george, am_michael, ...); empty picks a British
voice of the character's gender, varied by its name. Model files (kokoro-v1.0.onnx, voices-v1.0.bin, 340 MB) live in
$KOKORO_MODELS, default voice/models/kokoro next to this file; download them from the kokoro-onnx releases:
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
Writes an mp3 to {out} (ffmpeg on the PATH or the imageio-ffmpeg package), else a wav under the mp3 name.
"""
import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

MODELS = Path(os.environ.get('KOKORO_MODELS') or Path(__file__).resolve().parent / 'models' / 'kokoro')
# British voices first: the worlds so far are Shakespeare, Stoker, Carroll and an Irish busker
VOICES = {
    'f': ['bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily'],
    'm': ['bm_george', 'bm_lewis', 'bm_daniel', 'bm_fable'],
}
LANGS = {'en': 'en-gb', 'en-us': 'en-us', 'en-gb': 'en-gb', 'ja': 'ja', 'zh': 'cmn', 'es': 'es', 'fr': 'fr-fr', 'hi': 'hi', 'it': 'it', 'pt': 'pt-br'}


def ffmpeg_path():
    found = shutil.which('ffmpeg')
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def main() -> int:
    if len(sys.argv) < 4:
        print('usage: kokoro-say.py VOICE OUT TEXT [LANG] [GENDER] [NAME]', file=sys.stderr)
        return 2
    voice, out, text = sys.argv[1], sys.argv[2], sys.argv[3]
    lang = (sys.argv[4] if len(sys.argv) > 4 else 'en') or 'en'
    gender = (sys.argv[5] if len(sys.argv) > 5 else '') or ''
    name = (sys.argv[6] if len(sys.argv) > 6 else '') or ''
    code = LANGS.get(lang.lower())
    if not code:
        print(f'kokoro has no voice for language {lang}', file=sys.stderr)
        return 3
    if not voice:
        h = int(hashlib.sha1(name.encode()).hexdigest(), 16)
        pool = VOICES.get(gender) or VOICES['f' if h % 2 else 'm']
        voice = pool[h % len(pool)]
    try:
        os.nice(10)
    except OSError:
        pass
    import soundfile as sf
    from kokoro_onnx import Kokoro
    k = Kokoro(str(MODELS / 'kokoro-v1.0.onnx'), str(MODELS / 'voices-v1.0.bin'))
    samples, rate = k.create(text, voice=voice, speed=1.0, lang=code)
    wav_path = out[:-4] + '.wav' if out.endswith('.mp3') else out + '.wav'
    sf.write(wav_path, samples, rate)
    ff = ffmpeg_path()
    if ff and out.endswith('.mp3'):
        r = subprocess.run([ff, '-loglevel', 'error', '-y', '-i', wav_path, '-codec:a', 'libmp3lame', '-q:a', '4', out])
        if r.returncode == 0:
            os.remove(wav_path)
            return 0
    os.replace(wav_path, out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
