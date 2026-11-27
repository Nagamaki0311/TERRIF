"""Regenerate original layered effects. Requires numpy; leaves the BGM untouched.
Damped resonators reuse the project's original /tmp/terrif-compose.py technique.
"""
import json
import wave
from pathlib import Path
import numpy as np

RATE = 22050
ROOT = Path(__file__).resolve().parents[1] / 'public' / 'audio'
rng = np.random.default_rng(270311)


def modal(duration, modes, noise=.025):
    t = np.arange(round(duration * RATE)) / RATE
    body = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / decay)
               for f, a, decay in modes)
    transient = rng.normal(0, 1, len(t))
    transient = np.convolve(transient, np.ones(4) / 4, 'same')
    body += transient * noise * np.exp(-t * 34)
    return body * (1 - np.exp(-t * 850)) * np.minimum(1, (duration - t) / .045)


def layer(duration, hits, room=.13):
    signal = np.zeros((round(duration * RATE), 2))
    for at, body, gain, pan in hits:
        start = round(at * RATE)
        count = min(len(body), len(signal) - start)
        signal[start:start + count] += body[:count, None] * gain * np.sqrt([(1-pan)/2, (1+pan)/2])
    # A short asymmetric room tail binds each layered strike into one body.
    dry = signal.copy()
    for delay, attenuation in [(.027, room), (.061, room*.7), (.109, room*.35)]:
        offset = round(delay * RATE)
        signal[offset:] += dry[:-offset, ::-1] * attenuation
    signal -= signal.mean(axis=0)
    signal *= np.minimum(1, np.arange(len(signal)) / (RATE*.002))[:, None]
    signal *= np.minimum(1, np.arange(len(signal), 0, -1) / (RATE*.05))[:, None]
    peak = np.max(np.abs(signal))
    signal *= .76 / max(peak, 1e-9)
    return signal


def impact(pitch=1, weight=1):
    return modal(.85, [(88*pitch,.32*weight,.2), (193*pitch,.3,.18),
                       (429*pitch,.17,.13), (917*pitch,.065,.075)], .075)


def bloom(root=220, duration=1.5):
    return modal(duration, [(root,.25,.42), (root*1.5,.2,.5),
                           (root*2,.11,.54), (root*3.01,.055,.3)], .015)


sounds = {
    'place.wav': layer(.32, [(0,modal(.3,[(182,.48,.045),(431,.25,.035),(789,.09,.022)]),.8,0)]),
    'reaction.wav': layer(.9, [(0,impact(),.9,-.12), (.035,modal(.5,[(143,.22,.12),(677,.1,.09)],.055),.6,.18)]),
    'chain-rise.wav': layer(1.1, [(0,impact(1.12),.9,-.1),(.055,bloom(293.66,.9),.4,.2),(.105,bloom(440,.8),.2,-.2)]),
    'chain-deep.wav': layer(1.4, [(0,impact(.85,1.3),.9,0),(.04,bloom(293.66,1.2),.45,-.2),(.095,bloom(440,1.1),.3,.25),(.15,bloom(587.33,1),.2,-.1)]),
    'burst.wav': layer(1.25, [(0,impact(.9),.75,0),(.045,impact(1.3,.5),.45,-.35),(.09,bloom(349.23,1),.45,.35)],.2),
    'cutin.wav': layer(.65, [(0,modal(.5,[(260,.3,.09),(619,.2,.12),(1240,.07,.08)],.065),.8,0),(.055,bloom(440,.5),.22,.18)]),
    'rare.wav': layer(1.9, [(0,impact(.72,1.3),.9,0),(.08,bloom(220,1.7),.65,-.25),(.16,bloom(329.63,1.5),.5,.25),(.24,bloom(440,1.4),.35,-.1)],.22),
    'finish.wav': layer(1.65, [(0,impact(.83),.8,0),(.045,bloom(146.83,1.5),.6,-.15),(.12,bloom(220,1.4),.5,.15),(.195,bloom(349.23,1.3),.35,0)],.18),
}
# Construct the original bank first so its event-noise sequence stays identical.
# The replacement door and UI layers have their own deterministic noise stream.
rng = np.random.default_rng(270312)


def air(duration, release=.19):
    t = np.arange(round(duration*RATE))/RATE
    noise = rng.normal(0, 1, len(t))
    # Broad, softened airflow with rumble removed; no pitched electronic oscillator.
    breath = np.convolve(noise, np.ones(5)/5, 'same')
    breath -= np.convolve(noise, np.ones(61)/61, 'same')
    envelope = (1-np.exp(-t/0.018)) * np.exp(-np.maximum(0,t-.055)/release)
    return breath * envelope * np.minimum(1, (duration-t)/.06)


sounds.update({
    'place.wav': layer(.58, [(0,air(.52),.8,-.08),
        (.035,air(.45,.14),.22,.24),
        (.38,modal(.17,[(138,.16,.035),(374,.09,.025)],.008),.5,0)],.065),
    'ui-select.wav': layer(.14, [(0,modal(.13,[(289,.32,.025),(731,.1,.016)],.02),.7,0)],.06),
    'ui-slide.wav': layer(.22, [(0,air(.2,.06),.35,-.2),
        (.075,modal(.13,[(215,.23,.033),(543,.1,.025)],.012),.55,.2)],.07),
    'ui-confirm.wav': layer(.32, [(0,modal(.22,[(174,.34,.045),(435,.13,.055)],.018),.7,0),
        (.065,modal(.22,[(348,.18,.06),(696,.07,.035)],.01),.45,.1)],.1),
    'ui-cancel.wav': layer(.2, [(0,modal(.15,[(330,.25,.03),(779,.08,.018)],.016),.55,.1),
        (.06,modal(.13,[(165,.3,.027),(391,.07,.025)],.012),.65,-.1)],.05),
    'ui-invalid.wav': layer(.28, [(0,modal(.2,[(97,.3,.04),(253,.12,.026)],.018),.7,-.1),
        (.09,modal(.17,[(92,.26,.035),(249,.1,.022)],.018),.6,.1)],.05),
    'ui-depart.wav': layer(.72, [(0,air(.56,.23),.55,-.16),
        (.3,modal(.36,[(104,.3,.075),(216,.13,.055),(571,.04,.04)],.018),.6,.16)],.11),
})
metrics = []
for name, signal in sounds.items():
    assert np.isfinite(signal).all() and np.max(np.abs(signal)) < .8
    with wave.open(str(ROOT/name), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(np.round(signal*32767).astype('<i2').tobytes())
    metrics.append({'file': name, 'seconds': round(len(signal)/RATE,3),
                    'peak': round(float(np.max(np.abs(signal))),4),
                    'rms': round(float(np.sqrt(np.mean(signal**2))),4)})
credits = json.loads((ROOT/'credits.json').read_text())
credits['effects'] = 'Original layered damped wood and metal resonators, body impacts, rising harmonic blooms, filtered pneumatic airflow, mechanical UI clicks, and short stereo room tails. No external samples.'
credits['files'] = ['night-express.ogg', *sounds.keys()]
credits['effectsGenerator'] = 'scripts/generate-effects.py; fixed seeds 270311 (events) and 270312 (air and UI); 22050 Hz / stereo / 16-bit PCM'
credits['effectsValidation'] = metrics
(ROOT/'credits.json').write_text(json.dumps(credits, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(metrics, indent=2))
