#!/usr/bin/env python3
"""Rebuild the factory sound pack in public/sounds from its public-domain and CC0 sources.

Needs python3 with numpy, ffmpeg and network access to raw.githubusercontent.com.
Run from the repository root:  python3 scripts/build-sound-pack.py
Sources and licenses are listed in public/sounds/CREDITS.md.
"""
import os, re, subprocess, tempfile, urllib.parse, urllib.request
import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'sounds')
SONIC_PI = 'https://raw.githubusercontent.com/sonic-pi-net/sonic-pi/dev/etc/samples/'
PIANO = 'https://raw.githubusercontent.com/sfzinstruments/SplendidGrandPiano/master/'
CACHE = os.path.join(tempfile.gettempdir(), 'tactus-sound-sources')

def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        urllib.request.urlretrieve(url, path)
    return path

def load(f):
    raw=subprocess.run(['ffmpeg','-v','quiet','-i',f,'-ac','2','-ar',str(SR),'-f','f32le','-'],capture_output=True).stdout
    x=np.frombuffer(raw,dtype=np.float32).reshape(-1,2).copy()
    return x
def save(x,path,mono=False):
    os.makedirs(os.path.dirname(path),exist_ok=True)
    if mono or np.max(np.abs(x[:,0]-x[:,1]))<1e-4: x=x[:,:1]
    p=subprocess.run(['ffmpeg','-v','quiet','-y','-f','f32le','-ar',str(SR),'-ac',str(x.shape[1]),'-i','-','-sample_fmt','s16','-compression_level','12',path],input=x.astype(np.float32).tobytes())
    assert p.returncode==0
    return x
def trim(x,maxlen=None,fade=0.005,head_db=-50,tail_db=-60):
    a=np.max(np.abs(x),axis=1); pk=a.max()
    idx=np.where(a>pk*10**(head_db/20))[0]; s=max(0,idx[0]-16)
    idx2=np.where(a>pk*10**(tail_db/20))[0]; e=idx2[-1]+1
    x=x[s:e]
    if maxlen and len(x)>maxlen: x=x[:maxlen]
    n=min(len(x),int(fade*SR))
    if n>0: x[-n:]*=np.linspace(1,0,n)[:,None]**2
    return x/pk*10**(-1/20)
KITS={
 'studio':  dict(kick='drum_bass_hard',snare='drum_snare_hard',clap='perc_snap',hat='drum_cymbal_closed',openhat='drum_cymbal_open',tom='drum_tom_mid_hard',rim='drum_snare_soft',perc='drum_cowbell'),
 'house':   dict(kick='bd_haus',snare='sn_dolf',clap=None,hat='hat_snap',openhat='hat_gump',tom='drum_tom_lo_hard',rim='elec_tick',perc='elec_blip'),
 'boom-bap':dict(kick='bd_fat',snare='sn_dub',clap='perc_snap2',hat='hat_zild',openhat='hat_cats',tom='drum_tom_hi_hard',rim='elec_pop',perc='elec_triangle'),
 'electro': dict(kick='bd_tek',snare='elec_hi_snare',clap='elec_filt_snare',hat='hat_star',openhat='elec_cymbal',tom='elec_fuzz_tom',rim='elec_wood',perc='elec_bong'),
 'trap':    dict(kick='bd_boom',snare='sn_generic',clap=None,hat='hat_hier',openhat='hat_mess',tom='elec_bong',rim='elec_tick',perc='elec_triangle'),
}
for kit,pads in KITS.items():
    for pad,src in pads.items():
        if src is None: continue  # this pad uses a synthesized sample (see src/model/soundpack.ts)
        x=trim(load(fetch(SONIC_PI+src+'.flac', src+'.flac')),maxlen=int(2.5*SR),fade=0.01)
        x=save(x,f'{OUT}/drums/{kit}/{pad}.flac')
# piano: the mezzo-forte layer, one recording every three semitones (MIDI note numbers)
sfz = urllib.request.urlopen(PIANO + 'Data/MF.txt').read().decode()
zones = {int(k): n for k, n in re.findall(r'pitch_keycenter=0*(\d+).*sample=(.+)\.\$EXT', sfz)}
roots = []
for want in range(23, 109, 3):
    k = min(zones, key=lambda z: abs(z - want))
    if k not in roots: roots.append(k)
for k in roots:
    x = load(fetch(PIANO + 'Samples/' + urllib.parse.quote(zones[k]) + '.flac', f'piano-{k}.flac'))
    secs = 5.0 if k < 48 else 4.0 if k < 72 else 3.0 if k < 90 else 2.0
    x = trim(x, maxlen=int(secs * SR), fade=0.4 if k < 90 else 0.2, tail_db=-55)
    save(x, f'{OUT}/piano/{k}.flac')
print('piano roots (keep INSTRUMENTS.piano.roots in src/model/soundpack.ts in sync):', roots)
