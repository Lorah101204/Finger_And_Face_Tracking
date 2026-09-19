# Review notes after ROI-01 and items to track

| Item | Value |
|---|---|
| Review date | 2026-09-18 (Vietnam time, UTC+7) |
| Project milestone at review | ROI-01 done (D-035, D-036); next package is INT-01 |
| Scope | Documentation in `docs/`, code in `src/`, tests in `tests/`, scripts in `tools/`; nothing in the project was modified |
| Last update of this file | 2026-09-18 |

This file records the issues found during the review and tracks them until they are resolved. Design decisions are still recorded in [decisions.md](./decisions.md) (D-037 onward); this file only points to the decision IDs and does not repeat their content.

## 1. How to update

Each item has an ID `R-xx`. When working on one, edit three places:

1. The table in section 3: change the Status column (`Mở` (Open), `Đang làm` (In progress), `Xong` (Done), `Bỏ` (Dropped)), write the date in the Updated column as `YYYY-MM-DD`; when done, also fill in the Done column.
2. Section 4: tick `[x]` for each step done and write the date right after that step, for example `[x] ... (2026-09-20)`; fill measurements into the blanks.
3. Section 5: add one log row (date, ID, what was done, result, decision ID if any). Do not edit old log rows.

After editing, update the "Last update of this file" row in the table at the top of the file. For a new issue, add the next ID (R-07, R-08, …) with the date it was recorded.

## 2. Check results on 2026-09-18

Run on a copy of the source (with `node_modules` reinstalled for Linux), without touching the project directory.

| Item | Result | Notes |
|---|---|---|
| `vitest run` | Pass: 27 files, 157 tests | |
| `tsc -b` | Pass | |
| `eslint .` | Pass | |
| `lint:boundaries` | Pass | I1 for `src/face/**`, `src/classify/**` |
| `check:invariants` | Pass: 59 files, I1, I2, I3, I4, I9, I10 | |
| `vite build` | Pass | Output file hashes match the existing `dist/`, so `dist/` matches the current code |
| `test:e2e` | Could not be rerun | The review environment lacks Chromium and the models. `test-results/.last-run.json` records `passed` at 2026-09-18 01:12 (UTC+7), after the last code change at 01:03, but does not say whether it was the full suite or a subset |
| Solver simulation | Stable with default parameters | See below |

Solver simulation (temporary script, not kept in the repo): two hands held still for 30 seconds, hand results at 18 Hz, 64 × 36 grid on a 1280 × 720 stage (20 px cells), sweeping 100 positions around cell boundaries and n boundaries, calling `solveSquare` directly with default parameters.

| Noise per point (σ) | Hand tremor (amplitude) | Mean cell changes per 30 s | Worst | `too-small` closes |
|---|---|---|---|---|
| 1.5 px | 0 px | 0.0 | 1 | 0 |
| 1.5 px | 4 px | 0.2 | 2 | 0 |
| 3 px | 4 px | 1.0 | 6 | 0 |
| 3 px | 8 px | 20.9 | 36 | 0 |
| 5 px | 8 px | 29.4 | 49 | 0 |

The last two rows are real movement of nearly one cell (16 px peak to peak on 20 px cells), so the cell changes are correct. A 128 × 72 grid (10 px cells) will be twice as sensitive to the same tremor. Sides near `nMin` (3.0 to 3.9 cells) never closed with `too-small`.

Direction assessment: on track. The build order matches section 2.4 of [WORK-BREAKDOWN.md](./WORK-BREAKDOWN.md) (mask, face branch, then hands). Invariants I1 to I10 are held by three layers: lint boundaries, `check:invariants`, and e2e hard gates with a 1 px control. Solver, One Euro, hysteresis and edge clamping follow section 5.8 and D-035.

## 3. Tracking table

| ID | Item | Priority | Needed before | Status | Recorded | Updated | Done |
|---|---|---|---|---|---|---|---|
| R-01 | First git commit and the `archive/backend` branch | High | Start of INT-01 | Done | 2026-09-18 | 2026-09-20 | Done at REL-01 (D-024): `main` and orphan `archive/backend` pushed to GitHub on 2026-09-20 |
| R-02 | Test session with a webcam and real hands | High | Writing more INT-01 code | Open | 2026-09-18 | 2026-09-20 | Still owed; now planned on the public site (REL-01 step 8, `docs/deploy.md` 5.2) |
| R-03 | The 150 ms point age threshold is close to the hand pipeline latency | High | INT-01 acceptance | Done | 2026-09-18 | 2026-09-20 | D-045 (QA-02): 150 ms with the GPU delegate, 250 ms with CPU, measured against interval p95 + infer p95 (`docs/benchmark.md` section 6) |
| R-04 | Start CLS-01 (dataset mode, data capture) in parallel | Medium | QA-01 | Done | 2026-09-18 | 2026-09-20 | CLS-01 done (D-043); real capture with participants and mannequins still pending |
| R-05 | One Euro filters in stage px, so it depends on window size and DPR | Low | QA-02 | Open | 2026-09-18 | 2026-09-20 | Not addressed in QA-02; the solver reset on layout change limits the effect. Revisit with real-webcam measurements |
| R-06 | Chores: `dist/`, README, comments, the rest of INT-01 | Low | REL-01 (item d alone: INT-01) | Done | 2026-09-18 | 2026-09-20 | a: REL-01 (D-050); b: README lists `solver`; c: comments and the duplicate line fixed 2026-09-20; d: `CloseGate` wired in INT-01 (D-037), real-hand run stays under R-02 |
| R-07 | The reveal region is the quadrilateral of four fingertips and the mask is a cell set (locking a square was a mistake) | High | QA-01 | Done | 2026-09-18 | 2026-09-18 | 2026-09-18 |

## 4. Item details

### R-01 First git commit and the `archive/backend` branch

Recorded: 2026-09-18. Priority: high. Related: D-024, SETUP-00.

Current state: `git log` reports that branch `main` has no commits; every file is untracked. 14 work packages (about 11 thousand lines of code and tests) exist only on drive E:, with no history, no way to roll back and no copy. D-024 planned for the first commit to put `archive/backend/` on a separate branch and keep `main` clean, but this has not been done.

To do:

- [x] Run the full set of check commands on the development machine and record the results in the log: `lint`, `lint:boundaries`, `check:invariants`, `test:unit`, `test:e2e` (full suite), `build`. Run date: 2026-09-20 (unit 267/267, e2e 65/65, deploy 12/12; see `docs/test-report-mask.md`)
- [x] Create the `archive/backend` branch holding `archive/backend/` per D-024, then remove this directory from `main`. Done 2026-09-20 (orphan branch; `/archive/` ignored on `main`).
- [x] First commit on `main`. Check that `git status` no longer lists `.task` models, wasm, `public/spike-assets/`, `dist/`, `test-results/` (already in `.gitignore`). Done 2026-09-20 (268 files, 2.6 MB).
- [x] Push to a remote or back up somewhere other than drive E:. Done 2026-09-20: https://github.com/Lorah101204/Finger_And_Face_Tracking.
- [x] From here on, one commit (or one branch) per work package, with the package ID in the commit message. In force since 2026-09-20 (English messages).

Close criteria: `git log` on `main` has a commit containing the full state after ROI-01; the `archive/backend` branch exists; a copy exists off the machine.

### R-02 Test session with a webcam and real hands

Recorded: 2026-09-18. Priority: high. Related: D-010, D-011, D-033, D-036, S4 phase 2, INT-01 step 4.

Current state: up to ROI-01 no check has run with a webcam and real hands; every measurement uses static images, the synthetic source or fake hands. Four manual checks are piling up, and the done criteria of HAND-01 and ROI-01 are by nature criteria with real hands.

To do (open `/#/app?debug=1`, window source "Tay" (Hands), record the readings from the debug bar):

- [ ] Background tab (S4 phase 2, D-011): start the camera, switch tabs for 10 seconds, come back. Record: does rVFC stop ____; does the region close with `tab-hidden` ____. Date: ____
- [ ] Handedness label (D-010): raise the right hand for 10 seconds, the label must be "Phải" (Right). Result: ____. If reversed: enable "Đảo trái/phải" (Swap left/right) and record a new decision. Date: ____
- [ ] Stable hand ids (HAND-01): both hands move normally for 30 seconds, ids do not change; crossed hands give `uncertain` instead of swapping ids. Result: ____. Date: ____
- [ ] Hand window (ROI-01): hold still for 30 seconds, count the cell changes ____; spread and pinch the hands, does n change smoothly ____; move close to the edge, the window stays square and shows `limited` ____. Date: ____
- [ ] Gestures: try the "picture frame" style (two L-shaped hands) and the open thumb and index finger style. Since side = min(bboxW, bboxH), record the largest n reached at a normal sitting distance: ____ cells. Is it wide enough to frame a whole face: ____
- [ ] Record the smallest and largest point age seen on the slot line (input for R-03): ____ to ____ ms; hand Hz: ____; CPU versus GPU delegate: ____

Close criteria: every blank above has a result and a date; deviations from the assumptions (reversed handedness label, flickering window, maximum n too small) get a new R ID or a new D decision.

### R-03 The 150 ms point age threshold is close to the hand pipeline latency

Recorded: 2026-09-18. Priority: high. Related: `freshness.pointMaxAgeMs` in `src/core/config.ts`, `src/hands/slots.ts`, `src/reveal/handWindowSource.ts`, `src/core/revealState.ts`, D-034, D-036, S2.

Current state: point age = `now` (rAF) minus `lastSeenTs` (the `performance.now()` timestamp at the rVFC of the frame sent to the hand worker). S2 measured two-hand detection in the worker at 48.9 ms (p95 56.7) with CPU and 62.2 ms (p95 69.5) with GPU. Each returned result is already about one inference cycle plus the rAF wait old, and it stays in use until the next result arrives. The estimated (not measured) point age at render time varies around 70 to 140 ms at p50, so p95 exceeds 150 ms.

Consequence when exceeded: `stale-point` for a few render frames, the region closes then reopens. A hand-caused close does not bump the epoch, but closed → open always bumps the epoch, resets One Euro and calls `rejectAll` on face tasks (section 4.6). Visible result: the window flickers and the face disappears and reappears periodically.

Existing signs: `tests/e2e/hands.spec.ts` accepts intermittent `stale-point` and has to raise "Tuổi điểm" (Point age) to 1000 ms for the window to stay open; D-034 and D-036 attribute this to slow headless. On a real machine the numbers are also close to the threshold.

To do:

- [ ] Take real point age measurements from R-02. Point age p50 ____ ms, maximum ____ ms; number of `stale-point` closes in 60 seconds of holding the hands still: ____. Date: ____
- [ ] Choose how to set the threshold: a new constant (for example 250 ms) or derived from the measured hand result cycle (for example 2 times the cycle plus a margin, with a floor of 150 ms). The original plan allows tuning: "150 ms to start testing, then adjust by benchmark".
- [ ] Record the decision in `decisions.md` (D-____), update `config.ts` and the section 3 table of WORK-BREAKDOWN.
- [ ] Recheck the HAND-02 criterion with the new threshold: losing one finger makes the slot invalid within at most the threshold plus one render frame.
- [ ] Revisit `hands.spec.ts`: drop the 1000 ms setting if the new threshold is enough for the window to stay open in headless, or state the reason for keeping it.

Close criteria: holding the hands still for 60 seconds with a real webcam gives no `stale-point` close; the face in the reveal region does not flicker; the decision is recorded.

### R-04 Start CLS-01 in parallel

Recorded: 2026-09-18. Priority: medium. Related: CLS-01, CLS-02, D-012, the "missing mannequin data" risk in section 2.3.

Current state: WORK-BREAKDOWN says CLS-01 "starts as soon as MASK-02 is done, in parallel with the other packages". MASK-02 is done but `src/` has no line about dataset mode, `src/classify/` is still a placeholder, and there is no data capture consent form. Phase 5 is the longest critical path of the plan (2 to 4 weeks, depends on data), while phases 0 to 3 were done in two days.

To do:

- [ ] Lock the mannequin sources (plastic, fabric, silicone) and the participants; who captures, where. Date: ____
- [ ] Write the participant consent form (CLS-01 step 1).
- [ ] Build a minimal dataset mode (CLS-01 step 2): a toggle with an indicator, save the pre-letterbox crop from `RestrictedFrame` with JSON metadata, stored locally, no upload; take copies at a sparse rate (D-012).
- [ ] Capture the first batch per the matrix in CLS-01 step 3. Sample counts: person ____, mannequin ____. Date: ____

Close criteria: CLS-01 is marked in progress in the README, the first data batch and `docs/dataset.md` exist.

### R-05 One Euro filters in stage px

Recorded: 2026-09-18. Priority: low. Related: `src/reveal/squareSolver.ts`, `src/reveal/oneEuro.ts`, D-035, QA-02.

Current state: the filter runs on the center and side measured in stage px (device px). Cutoff frequency = `minCutoff + beta × |speed|` with speed (`tốc độ`) in stage px per second, so the same hand movement gives a different cutoff when the browser window is large or small, or when the DPR differs. The section 2 simulation with a 2.5 times larger stage (3200 × 1800), 3 px noise and 4 px tremor: 2.6 cell changes per 30 seconds on average versus 1.0 on the 1280 × 720 stage. Hysteresis is computed in cells so it is not affected.

To do:

- [ ] In QA-02, try filtering in a unit independent of the display size (camera px, or divided by the camera width) and only then convert to stage. A layout change already resets the solver, so no state needs to survive the change.
- [ ] If the unit changes: retune the default `beta` and the limits in `SENSITIVITY_LIMITS`, record decision D-____.

Close criteria: the number of cell changes while holding the hands still does not depend on the browser window size (under 20% difference between two sizes), or a decision explicitly accepts the current state.

### R-06 Chores

Recorded: 2026-09-18. Priority: low.

- [x] a. `dist/` contains `spike-assets/` (person sample images, `mobilenetv2-12.onnx`, WebM) because they live in `public/`. Before REL-01: move the spike assets out of `public/` or exclude them from the build. Done: 2026-09-20 (REL-01, D-050: the `wctBuild` plugin deletes `dist/spike-assets` in `closeBundle`, CI checks `test ! -e dist/spike-assets`)
- [x] b. README, Structure section: the e2e list is missing `solver`. Done: 2026-09-19 (list updated in ROI-03)
- [x] c. The header comment of `src/loop/frameLoop.ts` still says "no HandWindowSource yet, so the window stays closed until ROI-01" (outdated after ROI-01). The "How to read" part of WORK-BREAKDOWN repeats the "Section 6" line. Done: 2026-09-20 (both fixed in the audit after REL-01; `store.ts` comment about four slots fixed too)
- [x] d. The rest of INT-01: `HandWindowSource` is already wired into the loop and the UI can already switch the window source, both done in ROI-01. `cameraCloseReason()` wired into `frameLoop` as `CloseGate` (no-camera, tab-hidden) in INT-01 (D-037). The run of the section 7 scenarios with real hands stays open under R-02. Done: 2026-09-20 (code part)

### R-07 The reveal region is the quadrilateral of four fingertips and the mask is a cell set

Recorded: 2026-09-18 (user request). Priority: high. Related: D-038, ROI-02.

State when recorded: the plan of 14/09 and D-035 locked the reveal region as an N × N cell square derived from four points (center is the mean, side is the min of the bounding box); the whole mask, compositor, inference buffer and face validation assume a rect. The correct requirement: the four fingertips are the four vertices of an arbitrary quadrilateral; white cells inside or crossed by an edge are all open.

Done:

- [x] Updated the original plan, WORK-BREAKDOWN (sections 2.1, 3, 4.3, 4.4, 5.6, 5.8, package ROI-02, table 7.17), README; recorded D-038 (2026-09-18)
- [x] `core/cells.ts` (quadrilateral → cell set with per-cell hysteresis), `reveal/quadSolver.ts` replaces `squareSolver.ts`, the mask carries `box`, `cells`, `holesCam`; the compositor clips per cell, the buffer pads holes, face validation is per cell (2026-09-18)
- [x] Unit 170 cases, e2e 40 cases (twice), lint, boundaries, invariants, tsc, build pass (2026-09-18)

Close criteria: a skewed trapezoid opens exactly the cells crossed by its edges, holes are white on the output and gray in the buffer (e2e hard gate); met.

## 5. Update log

Add new rows at the end; do not edit old rows.

| Date | ID | Content | Result, decision |
|---|---|---|---|
| 2026-09-18 | R-01 to R-06 | Review after ROI-01, created this file | 6 items open; unit, tsc, lint, invariants, build pass; e2e not rerun |
| 2026-09-18 | R-07 | Switched the reveal region to the four-fingertip quadrilateral and the cell-set mask, updated plan and code, added tests | Done; D-038 |
| 2026-09-20 | R-01, R-03, R-04, R-06 | Audit after REL-01: first commit and public repo done, point age locked by D-045, CLS-01 done, chores a to d done; R-02 and R-05 stay open | R-01, R-03, R-04, R-06 Done; R-02, R-05 Open |

Row template to copy:

```
| YYYY-MM-DD | R-0x | What was done, what was measured | New status; D-0xx if any |
```
