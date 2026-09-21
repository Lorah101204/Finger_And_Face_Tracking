// I18N-01: English strings. Must match the shape of `vi` (type `Strings`), checked by tsc and by the unit test that walks
// both dictionaries. Backlog codes (CLS-01, LOG-02, D-010) and unit names stay as they are.
import type { Strings } from './index'

export const en: Strings = {
  meta: {
    title: 'Web Camera Tracking',
    description:
      'A white pixel screen split into cells: the reveal region is the convex hull of the fingertips of both hands, face detection runs only inside that region, everything in the browser.',
  },
  lang: {
    label: 'Language',
    names: { vi: 'Tiếng Việt', en: 'English' },
    switchTo: { vi: 'Tiếng Việt', en: 'English' },
  },
  landing: {
    eyebrow: 'Runs entirely in your browser · nothing is uploaded',
    title: 'Web Camera Tracking',
    lead: 'A white screen split into cells. Your fingertips open a window onto the camera; face detection runs only on the part that is open, everything else stays white.',
    leadKiosk:
      'Hold both hands in front of the camera to open a window on the white screen; faces are detected only inside that window.',
    pledgesLabel: 'Privacy pledges',
    pledges: [
      'Camera images are processed right in the browser. No server receives data; nothing is uploaded.',
      'No video is stored. Your browser only keeps this consent choice, a cache of the models so the next start is fast, and the log or captured data if you turn them on yourself in Settings.',
      'The camera turns on only when you press the button on the next screen.',
    ],
    pledgesCompact: [
      'Processed in the browser',
      'No upload, no stored video',
      'Camera on only when you press',
    ],
    consent: (version: string) => `I have read and agree (consent text version ${version}).`,
    scopeTab:
      'Consent applies to this tab only: closing the tab ends it, and the next user has to agree again.',
    start: 'Start',
    consentedBefore: 'You agreed earlier.',
    goStraight: 'Go straight to the screen',
    stepsLabel: 'Three steps',
    steps: {
      1: 'Turn on the camera',
      2: 'Raise both hands',
      3: 'Face in the window',
    },
    kioskCorner: 'Outside the window is always white',
    figcaption:
      'The fingertips frame the window (convex hull). Only the cells inside the window show the camera and are detected; animated illustration, no camera used.',
  },
  bar: {
    brandTitle: 'Back to the landing page',
    camera: 'Camera',
    selectCamera: 'Choose camera',
    defaultCamera: 'Default',
    start: 'Start camera',
    stop: 'Stop camera',
    switch: 'Switch camera',
    logOn: (count: number) => `log on · ${count}`,
    logTitle:
      'Local log (LOG-02): metadata events only, in this browser; hidden when off so the bar does not wrap',
    settings: 'Settings',
    debug: 'Debug',
    present: 'Present',
    presentTitle:
      'Every control becomes a floating layer that hides itself; the canvas fills the screen',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    fullscreenTitle: 'Key F',
    revoke: 'Revoke consent',
    canvasLabel: 'White pixel screen',
    recording: (count: number) => `Capturing data · ${count} samples`,
    synthetic: (w: number, h: number) => `Synthetic source (debug) ${w}×${h}: no real camera.`,
  },
  camera: {
    idle: 'Camera is off.',
    requesting: 'Requesting camera permission…',
    hidden: 'Tab is hidden: the reveal region stays closed until you come back.',
    stalled: (ms: number) => `The camera delivers no frames (none for over ${ms} ms).`,
    running: (w: number, h: number, fps: number | null) =>
      `Camera running ${w}×${h}${fps ? ` @ ${fps} fps` : ''}.`,
    endedRemoved: 'The camera was unplugged. Press Start camera to run again.',
    endedTrack: 'The camera stopped (track ended). Press Start camera to run again.',
    notAllowed: 'You denied camera permission. Allow the camera in the browser, then press again.',
    notFound: 'No camera found.',
    overconstrained:
      'The camera does not support the requested configuration. Choose another camera.',
    notReadable: 'Cannot read the camera (is another application using it?).',
    gate: (message: string) => `Cannot start the camera: ${message}`,
    other: (message: string) => `Camera error: ${message}`,
  },
  guide: {
    stepsLabel: 'Steps',
    steps: { 1: 'Camera', 2: 'Window', 3: 'Face' },
    mouseKeys: 'Click or drag on the board to open · scroll to resize · Esc closes · Space reopens',
    limited: ' The window touches the board edge.',
    tabHidden: {
      title: 'Tab is hidden',
      detail: 'The window closed and the screen went white. Come back to this tab to reopen it.',
    },
    noCameraWait: {
      title: 'Waiting for the first camera frame…',
      detail: 'The window opens only once the camera delivers images.',
    },
    camOff: {
      title: 'Turn on the camera to begin',
      detail:
        'Choose a camera, then press Start camera. The screen stays white until you open a window.',
    },
    camRequesting: {
      title: 'Requesting camera permission…',
      detail: 'Allow the camera in the browser dialog.',
    },
    camSwitching: {
      title: 'Switching camera…',
      detail: 'The window closed; reopen it once the new camera is running.',
    },
    camStalled: {
      title: 'The camera delivers no images',
      detail:
        'The window closed. Check whether another application is using the camera; switch cameras if needed.',
    },
    camEnded: { title: 'The camera stopped', detail: 'Press Start camera to run again.' },
    camError: {
      title: 'Cannot start the camera',
      detail: 'Check camera permission, then press again.',
    },
    handsLoading: {
      title: 'Loading the hand detector…',
      detail:
        'Only takes a few seconds the first time. Get both hands ready in front of the camera.',
    },
    handsError: {
      title: 'The hand detector cannot run',
      detail: 'Reload the page; if it still fails, choose the Mouse window source in Settings.',
    },
    handsNone: {
      title: 'Bring both hands in front of the camera',
      detail: (fingers: string, minPoints: number, minHands: number) =>
        `Hold both hands apart, palms facing the camera. The window is the region enclosing the fingertips (${fingers}); at least ${minPoints} fingertips from ${minHands} hands are needed.`,
    },
    handsMissing: {
      title: 'Not enough fingertips yet',
      detail: 'Raise more fingertips or bring the other hand into the frame to open the window.',
    },
    stalePoint: {
      title: 'Lost track of a fingertip',
      detail:
        'Keep the fingertips in the frame and move more slowly; old points are dropped from the region, and the window closes when too few remain.',
    },
    outOfBoard: {
      title: 'A fingertip is outside the board',
      detail: 'Bring the fingertips inside the grid area.',
    },
    tooSmallHands: {
      title: 'The fingertips are too close together',
      detail: (nMin: number) =>
        `Spread your fingers or move the hands further apart so the window is big enough (at least ${nMin} cells per side).`,
    },
    ambiguous: {
      title: 'The hands are crossed',
      detail:
        'Keep the left hand on the left, the right hand on the right, and do not overlap them.',
    },
    configChangedHands: {
      title: 'Settings changed, the window closed',
      detail: 'Bring the fingertips back in to open a new window.',
    },
    mouseOpen: {
      title: 'Open a window with the mouse',
      detail:
        'Click or drag on the board to open a square window. Choose the Hands window source in Settings to open it with your fingertips.',
    },
    mouseTooSmall: { title: 'The window is too small', detail: 'Scroll to enlarge the window.' },
    configChangedMouse: {
      title: 'Settings changed, the window closed',
      detail: 'Click on the board or press Space to reopen.',
    },
    faceLoading: {
      title: 'Loading the face detector…',
      detail: 'The window is open; faces will be searched for as soon as loading finishes.',
    },
    faceError: {
      title: 'The face detector cannot run',
      detail: 'The window stays open but no face can be found. Reload the page.',
    },
    searching: {
      title: 'Looking for a face inside the window',
      detail: 'Bring a face into the open region. Only this part of the camera is processed.',
    },
    tooSmallFace: {
      title: 'The window is too small for a face',
      hands: 'Spread your fingers or move the hands further apart to widen the window.',
      mouse: 'Scroll to enlarge the window.',
    },
    faceCandidate: {
      title: 'Face inside the window',
      titleWith: (label: string) => `Face inside the window: ${label}`,
      detail:
        'Detection runs only on the open region. Move or shrink the window to see the outside close again.',
      demo: ' The person/mannequin label comes from a color-based demo model, not a trained one.',
    },
    partialFace: {
      title: 'The face is cut off',
      hands: 'Widen or move the window so the whole face lies inside the open region.',
      mouse: 'Drag the window or scroll to enlarge it.',
    },
    covered: { title: 'Opening the window…', detail: 'The open region appears on the next frame.' },
  },
  fingers: {
    names: { 4: 'thumb', 8: 'index', 12: 'middle', 16: 'ring', 20: 'little' },
    hands: { left: 'Left', right: 'Right' },
    none: (minPoints: number, twoHands: boolean) =>
      `Bring ${twoHands ? 'both hands' : 'a hand'} into the frame: the window follows the fingertips (at least ${minPoints} fingertips needed).`,
    ambiguous: 'the hands are crossed, cannot tell them apart',
    missingHand: (hand) => `${hand === 'left' ? 'left' : 'right'} hand not seen`,
    outOfBoard: (n: number) => `${n} fingertip${n === 1 ? '' : 's'} outside the board`,
    stale: (n: number) => `${n} stale fingertip${n === 1 ? '' : 's'}`,
    lowScore: (n: number) => `${n} fingertip${n === 1 ? '' : 's'} with uncertain hand`,
    more: 'raise more fingers',
    folded: (n: number) => `${n} folded fingertip${n === 1 ? '' : 's'}`,
    allFolded: (minPoints: number, minHands: number) =>
      `Every fingertip is folded: spread the fingers you want to use (at least ${minPoints} fingertips from ${minHands} hands are needed).`,
    summary: (valid: number, minPoints: number, minHands: number, parts: string) =>
      `Seeing ${valid} valid fingertip${valid === 1 ? '' : 's'}, need at least ${minPoints} from ${minHands} hands: ${parts}.`,
  },
  subject: {
    person: 'Person',
    mannequin: 'Mannequin',
    unknown: 'Unclassified face',
    demo: ' · demo',
  },
  settings: {
    title: 'Settings',
    grid: {
      title: 'Grid',
      hint: (cols: number, rows: number, c: number) => `${cols} × ${rows} · cell ${c} px`,
      preset: 'Preset',
      presetAria: 'Grid',
      custom: 'Custom',
      cols: 'Columns',
      colsAria: 'Column count',
      rows: 'Rows',
      rowsAria: 'Row count',
      lines: 'Grid lines',
      mirror: 'Mirror',
    },
    window: {
      title: 'Window',
      source: 'Source',
      sourceAria: 'Window source',
      mouse: 'Mouse',
      hands: 'Hands',
      hintHands:
        'The window is the region enclosing the fingertips of both hands; changing the source closes an open window.',
      hintMouse: 'Click or drag on the board to open; scroll to resize; Esc closes; Space reopens.',
      swap: 'Swap left/right',
      swapTitle: 'D-010: turn on if the real webcam labels the hands the wrong way round',
      swapHint: 'when the webcam labels the hands the wrong way round',
      raisedOnly: 'Raised fingers only',
      raisedOnlyTitle:
        'ROI-04 (D-055): raised or folded is decided from landmark geometry; off means every selected fingertip takes part',
      raisedOnlyHint: 'folded or hidden fingers do not take part in the region',
    },
    fingers: {
      title: 'Fingertips used',
      both: 'both hands',
      aria: (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)} finger`,
      hint: (minPoints: number, minHands: number) =>
        `The window is the region enclosing the fingertips; at least ${minPoints} fingertips from ${minHands} hands are needed.`,
    },
    sensitivity: {
      title: 'Sensitivity',
      reset: 'Reset sensitivity',
      fields: {
        minCutoff: { label: 'Filter (Hz)', aria: 'Filter minCutoff' },
        beta: { label: 'Beta', aria: 'Filter beta' },
        hysteresisCells: { label: 'Hysteresis (cells)', aria: 'Hysteresis' },
        nMin: { label: 'N min (cells)', aria: 'N min' },
        pointMaxAgeMs: { label: 'Point age (ms)', aria: 'Point age' },
      },
    },
    dataset: {
      title: 'Data capture',
      toggle: 'Capture data',
      offHint: 'only the reveal-region crop, saved on this machine',
      consentTitle: 'Step 1 of CLS-01: no capture without a signed consent form',
      consentAria: 'Participant signed consent',
      consent: 'The participant signed a written consent form',
      subjectId: 'Participant ID',
      label: 'Provisional label',
      lighting: 'Lighting',
      mannequin: 'Mannequin',
      mannequinAria: 'Mannequin type',
      note: 'Note',
      rate: 'Rate (Hz)',
      rateAria: 'Capture rate',
      stop: 'Stop capture',
      start: 'Start capture',
      folder: (name: string) => `Folder: ${name}`,
      pickFolder: 'Choose folder…',
      downloadZip: (n: number) => `Download zip (${n} samples)`,
      clear: 'Clear samples in memory',
      labels: {
        person: 'Person',
        mannequin: 'Mannequin',
        unknown: 'Unknown',
        background: 'Background or hands only',
      },
      lightings: { normal: 'Normal', bright: 'Bright', dim: 'Dim', backlit: 'Backlit' },
      mannequins: { none: 'None', plastic: 'Plastic', fabric: 'Fabric', silicone: 'Silicone' },
      status: {
        off: 'dataset mode off',
        folder: (name: string) => `folder ${name}`,
        memory: (n: number, kb: number) => `memory (${n} samples, ${kb} KB)`,
        recording: (n: number) => `capturing, ${n} samples`,
        stopped: (n: number) => `stopped, ${n} samples`,
        idle: 'not capturing',
        error: (message: string) => ` · error: ${message}`,
      },
    },
    log: {
      title: 'Local log',
      count: (n: number) => `${n} record${n === 1 ? '' : 's'}`,
      pending: (n: number) => ` (writing ${n})`,
      toggle: 'Write local log',
      show: 'Show log',
      hide: 'Hide log',
      exportCsv: 'Export CSV',
      clear: 'Clear log',
      error: (message: string) => `log error: ${message}`,
      typeFilter: 'Type',
      typeFilterAria: 'Filter by type',
      all: 'all',
      dayFilter: 'Day',
      dayFilterAria: 'Filter by day',
      colTime: 'Time',
      colType: 'Type',
      colDetail: 'Details',
      empty: 'no records',
      events: {
        consent: 'consent',
        'camera-start': 'camera on',
        'camera-stop': 'camera off',
        'camera-error': 'camera error',
        'reveal-open': 'region open',
        'reveal-close': 'region closed',
        'config-change': 'config change',
      },
    },
    ui: {
      title: 'Interface',
      language: 'Language',
      guide: 'On-screen guidance',
      guideAria: 'On-screen guidance',
      guideAuto: 'Auto-collapse',
      guideFull: 'Always full',
      guideHidden: 'Hidden',
      logo: 'Logo on the cover',
      logoAria: 'Logo on the cover',
      logoHint: 'The campaign logo in the corner of the cover; open cells show the camera instead.',
      guideHint:
        'Auto-collapse: the message shows in full when it changes, then shrinks to one line; camera errors always show in full.',
    },
  },
  debug: {
    label: 'Debug',
    epoch: 'epoch',
    frame: 'frame',
    close: 'close',
    none: 'none',
    region: 'region',
    board: 'board',
    at: 'at',
    stage: 'stage',
    camera: 'camera',
    scale: 'scale',
    thumb: 'Buffer just sent to the face worker',
    noClassifier: 'classifier: none',
  },
}
