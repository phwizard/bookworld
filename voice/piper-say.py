#!/usr/bin/env python3
"""
A voice backend that runs anywhere on a CPU: Piper (https://github.com/OHF-Voice/piper1-gpl), small ONNX voices
for English, Ukrainian, Russian and some forty other languages. No GPU, no network once the voice file is here.
Used as
  VOICE_BACKEND=command
  VOICE_IDS=piper
  VOICE_COMMAND=voice/.venv-piper/bin/python voice/piper-say.py {voice} {out} {text} {lang} {gender} {name}
{voice} is the character's `voice.ids.piper`, a Piper voice name such as en_GB-jenny_dioco-medium (the list:
https://huggingface.co/rhasspy/piper-voices/blob/main/VOICES.md); empty picks a default for {lang} of the character's {gender} (a woman's or a man's, by {name} when unknown). A voice that is not
in the models directory ($PIPER_MODELS, default voice/models next to this file) is downloaded once (60 to 120 MB).
Writes an mp3 to {out} with ffmpeg (the one on the PATH, or the one in the imageio-ffmpeg package); without either,
a wav under the mp3 name, which browsers decode anyway. Needs the venv: piper-tts (and imageio-ffmpeg if there is no ffmpeg).
"""
import hashlib
import os
import shutil
import subprocess
import sys
import wave
from pathlib import Path

# default voices per language, a woman's and a man's where Piper has both
DEFAULTS = {
    'en': {'f': 'en_GB-jenny_dioco-medium', 'm': 'en_GB-alan-medium'},
    'uk': {'f': 'uk_UA-ukrainian_tts-medium', 'm': 'uk_UA-ukrainian_tts-medium'},
    'ru': {'f': 'ru_RU-irina-medium', 'm': 'ru_RU-dmitri-medium'},
    'de': {'f': 'de_DE-eva_k-x_low', 'm': 'de_DE-thorsten-medium'},
    'fr': {'f': 'fr_FR-siwis-medium', 'm': 'fr_FR-tom-medium'},
    'es': {'f': 'es_ES-mls_9972-low', 'm': 'es_ES-davefx-medium'},
    'it': {'f': 'it_IT-paola-medium', 'm': 'it_IT-riccardo-x_low'},
    'pl': {'f': 'pl_PL-gosia-medium', 'm': 'pl_PL-darkman-medium'},
    'pt': {'f': 'pt_BR-edresson-low', 'm': 'pt_BR-faber-medium'},
}
MODELS = Path(os.environ.get('PIPER_MODELS') or Path(__file__).resolve().parent / 'models')


def ffmpeg_path() -> str | None:
    found = shutil.which('ffmpeg')
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def model_for(voice: str, lang: str, gender: str, who: str) -> Path:
    pair = DEFAULTS.get(lang.lower()[:2], DEFAULTS['en'])
    g = gender if gender in pair else ('f' if int(hashlib.sha1(who.encode()).hexdigest(), 16) % 2 else 'm')
    name = voice.strip() or pair[g]
    path = MODELS / f'{name}.onnx'
    if not path.exists() or not Path(str(path) + '.json').exists():
        from piper.download_voices import download_voice
        MODELS.mkdir(parents=True, exist_ok=True)
        download_voice(name, MODELS)
    return path


def main() -> int:
    if len(sys.argv) < 4:
        print('usage: piper-say.py VOICE OUT TEXT [LANG] [GENDER] [NAME]', file=sys.stderr)
        return 2
    voice, out, text = sys.argv[1], sys.argv[2], sys.argv[3]
    lang = (sys.argv[4] if len(sys.argv) > 4 else 'en') or 'en'
    gender = (sys.argv[5] if len(sys.argv) > 5 else '') or ''
    who = (sys.argv[6] if len(sys.argv) > 6 else '') or ''
    # a voice render is a side job next to the world service: give the service the CPU first
    try:
        os.nice(10)
    except OSError:
        pass
    from piper import PiperVoice
    model = model_for(voice, lang, gender, who)
    pv = PiperVoice.load(model)
    # voices phonemised from the text itself (no espeak) know only the letters they were trained on, usually lowercase
    if getattr(pv.config, 'phoneme_type', None) is not None and 'text' in str(pv.config.phoneme_type).lower():
        text = text.lower()
    wav_path = out[:-4] + '.wav' if out.endswith('.mp3') else out + '.wav'
    with wave.open(wav_path, 'wb') as w:
        pv.synthesize_wav(text, w)
    ff = ffmpeg_path()
    if ff and out.endswith('.mp3'):
        r = subprocess.run([ff, '-loglevel', 'error', '-y', '-i', wav_path, '-codec:a', 'libmp3lame', '-q:a', '4', out])
        if r.returncode == 0:
            os.remove(wav_path)
            return 0
        print('ffmpeg failed, keeping the wav', file=sys.stderr)
    os.replace(wav_path, out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
