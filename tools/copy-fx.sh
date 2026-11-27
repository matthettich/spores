#!/bin/sh
# tools/copy-fx.sh: copy the track effects' sound code over from ...Thunder Plus (dev tool, not part of the app).
#
#   sh tools/copy-fx.sh /path/to/thunder-plus
#
# Writes js/engine/tfx.wasm, an unchanged copy of thunder-plus/waves/dsp/tfx.wasm (Thunder's track-effects host:
# Mutable Instruments, Airwindows, DaisySP, Cloud Seed and Thunder's own effects, all MIT; sources and build in
# thunder-plus/dsp/tfx/, build.sh). Never edit it by hand. Copied 2026-11-26 from Thunder Plus 706d70c,
# md5 99337ee2b25e459ea31bc80a33640afd.
# After copying: if Thunder added, removed or renumbered effects (tfx.cc's switch) or changed a setting (index.html,
# `const TFX = {`), update js/engine/fx.js by hand to match, then run tests/fx-check.mjs.
set -e
TP=${1:?usage: sh tools/copy-fx.sh /path/to/thunder-plus}
HERE=$(cd "$(dirname "$0")/.." && pwd)
cp "$TP/waves/dsp/tfx.wasm" "$HERE/js/engine/tfx.wasm"
echo "copied: $(md5sum "$HERE/js/engine/tfx.wasm" 2>/dev/null || md5 "$HERE/js/engine/tfx.wasm")"
