# Third-party code

## Track effects (`js/engine/tfx.wasm`)

Spores' track effects run in `js/engine/tfx.wasm`, an unchanged copy of ...Thunder Plus' track-effects module
(`thunder-plus/waves/dsp/tfx.wasm`, built from `thunder-plus/dsp/tfx/`; copied by `tools/copy-fx.sh`). It is built from
the following MIT-licensed projects (the notices below are copied from Thunder Plus' THIRD_PARTY_NOTICES.md). Effects that
come from these projects have plain names in the app; each one's source is named in its description (`js/engine/fx.js`).

### Mutable Instruments: Rings, Clouds, Beads, Warps (and stmlib)

https://github.com/pichenettes/eurorack. Copyright Emilie Gillet.
"Mutable Instruments", "Rings", "Clouds", "Beads" and "Warps" are names of Mutable Instruments' products; Spores and
...Thunder are not affiliated with or endorsed by Mutable Instruments. In Spores Rings is the Resonator, Clouds the Grain
cloud, Beads the Grain texture and Warps the Cross-mod effect.

### Airwindows: Density, ToTape6, EQ, Pressure4, Galactic, TapeDelay2, DeRez2, PurestDrive, Air3, Verbity2, ToVinyl4, Dubly, Cabs and Tube2

https://github.com/airwindows/airwindows. Copyright (c) 2018 Chris Johnson.
In Spores Density is Saturation, ToTape6 Tape, Pressure4 Compressor, Galactic Galaxy reverb, TapeDelay2 Tape echo, DeRez2
Lo-fi, PurestDrive Clean drive, Air3 Air, Verbity2 Room, ToVinyl4 Vinyl, Dubly Dub tape, Cabs Speaker cab and Tube2 Tube.

### DaisySP: Chorus, Decimator, Flanger, Phaser, Tremolo, Overdrive, Wavefolder, Autowah, PitchShifter, LadderFilter

https://github.com/electro-smith/DaisySP. Copyright (c) 2020 Electrosmith, Corp. Only the MIT-licensed main library is
used (not the separate DaisySP-LGPL modules). In Spores Decimator is the Bitcrusher.

### Cloud Seed (CloudSeedCore)

https://github.com/GhostNoteAudio/CloudSeedCore. Copyright (c) 2024 Ghost Note Audio / Ghost Note Engineering Ltd.
Spores' Space reverb. Its delay buffers are shrunk at build time to fit phones (see Thunder Plus' `dsp/tfx/build.sh`).

---

The Comb resonator, Transient shaper, Trance gate, Multiband squash and Frequency shifter (Thunder Plus'
`dsp/tfx/fx_extra.cc`) are ...Thunder's own code.

All four projects above are released under the MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
