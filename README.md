# models

Published model files of [Web Camera Tracking](https://github.com/Lorah101204/Finger_And_Face_Tracking) (REL-02, D-068). The `main` branch does not commit trained models (D-061): `public/models/models.json` → `classifier.source` names one file of this branch by a `raw.githubusercontent.com` URL pinned to the commit that added it, and `npm run models:fetch` downloads it and checks its sha256, so CI builds the public site with that model.

- `classifier-<first 12 hex of the sha256>.onnx`: a trained person/mannequin classifier; `classifier-<…>.json`: the `models.json` entry it was published with (training summary, compression gates) and the commit of `main` checked out at the time.
- Publish with `npm run models:publish` on `main` (`tools/publish-classifier.mjs`), not by hand. Every commit keeps the files of its parent. Never force-push this branch: older revisions of `models.json` point at its commits, and rolling back means restoring an older `classifier` entry on `main`.
