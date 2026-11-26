# ...Spores

A simple step sequencer and song arranger for learning electronic music: 8 tracks to start, drums, synths, MIDI and
CV, with colour-coded notes so melodies are easy to see and change. Sister app to
[...Seeds](https://github.com/matthettich/seeds): Spores sends MIDI notes and clock that Seeds can follow.

- Spec and build order: [docs/SPEC.md](docs/SPEC.md)
- Rules for coding agents: [AGENTS.md](AGENTS.md)
- Mockups: https://claude.ai/artifact/JqEYuQwWHL9eqVeWJ2tpdF

Run it locally: open a terminal in this folder and run `python3 -m http.server 8000`, then open
http://localhost:8000 in Chrome. (ES modules and Web MIDI need a server, not a double-clicked file.)
