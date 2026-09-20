// I18N-01: mọi chuỗi giao diện tiếng Việt (bản gốc). Kiểu `Strings` suy từ đối tượng này nên `en.ts` phải có đủ mọi
// khóa; chuỗi có tham số là hàm. Không có chuỗi giao diện nào nằm rải trong component nữa (trừ dòng debug kỹ thuật:
// describe* của debug/, loop/, hands/ và reveal/ là hợp đồng với e2e, giữ tiếng Việt).
import type { FingerTip, Handedness } from '../types'

export const vi = {
  meta: {
    title: 'Web Camera Tracking',
    description:
      'Màn pixel trắng chia ô: vùng mở là bao lồi các đầu ngón của hai bàn tay, nhận diện khuôn mặt chỉ chạy trên vùng mở, toàn bộ trong trình duyệt.',
  },
  lang: {
    label: 'Ngôn ngữ',
    names: { vi: 'Tiếng Việt', en: 'English' } as Record<'vi' | 'en', string>,
    switchTo: { vi: 'Tiếng Việt', en: 'English' } as Record<'vi' | 'en', string>,
  },
  landing: {
    eyebrow: 'Chạy hoàn toàn trong trình duyệt · không tải lên',
    title: 'Web Camera Tracking',
    lead: 'Màn hình trắng chia ô. Các đầu ngón tay của bạn mở một cửa sổ nhìn vào camera; nhận diện khuôn mặt chỉ chạy trên phần đang mở, phần còn lại luôn trắng.',
    leadKiosk:
      'Giơ hai tay trước camera để mở một cửa sổ trên màn trắng; khuôn mặt chỉ được nhận diện trong cửa sổ đó.',
    pledgesLabel: 'Cam kết riêng tư',
    pledges: [
      'Hình ảnh camera được xử lý ngay trong trình duyệt. Không có máy chủ nhận dữ liệu; không tải lên gì.',
      'Không lưu video. Trong trình duyệt của bạn chỉ có lựa chọn đồng ý này, bản cache của model để lần sau mở nhanh, và nhật ký hay dữ liệu thu nếu bạn tự bật trong Cài đặt.',
      'Camera chỉ bật khi bạn bấm nút ở màn hình kế tiếp.',
    ],
    pledgesCompact: [
      'Xử lý trong trình duyệt',
      'Không tải lên, không lưu video',
      'Camera chỉ bật khi bạn bấm',
    ],
    consent: (version: string) => `Tôi đã đọc và đồng ý (văn bản đồng ý phiên bản ${version}).`,
    scopeTab:
      'Đồng ý chỉ có hiệu lực trong tab này: đóng tab là hết, người dùng kế tiếp phải đồng ý lại.',
    start: 'Bắt đầu',
    consentedBefore: 'Bạn đã đồng ý trước đó.',
    goStraight: 'Vào thẳng màn hình',
    stepsLabel: 'Ba bước',
    steps: {
      1: 'Bật camera',
      2: 'Giơ hai tay để mở cửa sổ',
      3: 'Khuôn mặt trong cửa sổ',
    } as Record<1 | 2 | 3, string>,
    kioskCorner: 'Ngoài cửa sổ luôn trắng',
    figcaption:
      'Các đầu ngón tay đóng khung cửa sổ (bao lồi). Chỉ các ô trong cửa sổ hiện camera và được nhận diện; minh họa động, không dùng camera.',
  },
  bar: {
    brandTitle: 'Về trang chào',
    camera: 'Camera',
    selectCamera: 'Chọn camera',
    defaultCamera: 'Mặc định',
    start: 'Bật camera',
    stop: 'Dừng camera',
    switch: 'Đổi camera',
    logOn: (count: number) => `nhật ký bật · ${count}`,
    logTitle:
      'Nhật ký cục bộ (LOG-02): chỉ sự kiện metadata trong trình duyệt này; tắt thì không hiện để thanh không xuống dòng',
    settings: 'Cài đặt',
    debug: 'Debug',
    present: 'Trình diễn',
    presentTitle: 'Mọi điều khiển thành lớp nổi tự ẩn; canvas chiếm cả màn',
    fullscreen: 'Toàn màn hình',
    exitFullscreen: 'Thoát toàn màn hình',
    fullscreenTitle: 'Phím F',
    revoke: 'Thu hồi đồng ý',
    canvasLabel: 'Màn pixel trắng',
    recording: (count: number) => `Đang thu dữ liệu · ${count} mẫu`,
    synthetic: (w: number, h: number) =>
      `Nguồn tổng hợp (debug) ${w}×${h}: không dùng camera thật.`,
  },
  camera: {
    idle: 'Camera chưa bật.',
    requesting: 'Đang xin quyền camera…',
    hidden: 'Tab đang ẩn: vùng mở sẽ đóng cho tới khi quay lại.',
    stalled: (ms: number) => `Camera không cấp frame (quá ${ms} ms không có frame mới).`,
    running: (w: number, h: number, fps: number | null) =>
      `Camera đang chạy ${w}×${h}${fps ? ` @ ${fps} fps` : ''}.`,
    endedRemoved: 'Camera đã bị rút. Bấm Bật camera để chạy lại.',
    endedTrack: 'Camera đã dừng (track kết thúc). Bấm Bật camera để chạy lại.',
    notAllowed: 'Bạn đã từ chối quyền camera. Cho phép camera trong trình duyệt rồi bấm lại.',
    notFound: 'Không tìm thấy camera nào.',
    overconstrained: 'Camera không đáp ứng cấu hình yêu cầu. Chọn camera khác.',
    notReadable: 'Không đọc được camera (đang bị ứng dụng khác dùng?).',
    gate: (message: string) => `Không bật được camera: ${message}`,
    other: (message: string) => `Lỗi camera: ${message}`,
  },
  guide: {
    stepsLabel: 'Các bước',
    steps: { 1: 'Camera', 2: 'Cửa sổ', 3: 'Khuôn mặt' } as Record<1 | 2 | 3, string>,
    mouseKeys: 'Bấm hoặc kéo trên bảng để mở · lăn chuột đổi cỡ · Esc đóng · Space mở lại',
    limited: ' Cửa sổ chạm mép bảng.',
    tabHidden: {
      title: 'Tab đang ẩn',
      detail: 'Cửa sổ đã đóng và màn về trắng. Quay lại tab này để mở lại.',
    },
    noCameraWait: {
      title: 'Đang chờ frame đầu từ camera…',
      detail: 'Cửa sổ chỉ mở khi camera đã cấp hình.',
    },
    camOff: {
      title: 'Bật camera để bắt đầu',
      detail: 'Chọn camera rồi bấm Bật camera. Màn vẫn trắng cho tới khi bạn mở cửa sổ.',
    },
    camRequesting: {
      title: 'Đang xin quyền camera…',
      detail: 'Cho phép camera trong hộp thoại của trình duyệt.',
    },
    camSwitching: {
      title: 'Đang đổi camera…',
      detail: 'Cửa sổ đã đóng; mở lại sau khi camera mới chạy.',
    },
    camStalled: {
      title: 'Camera không cấp hình',
      detail: 'Cửa sổ đã đóng. Kiểm tra camera có bị ứng dụng khác dùng; đổi camera nếu cần.',
    },
    camEnded: { title: 'Camera đã dừng', detail: 'Bấm Bật camera để chạy lại.' },
    camError: { title: 'Không bật được camera', detail: 'Kiểm tra quyền camera rồi bấm lại.' },
    handsLoading: {
      title: 'Đang nạp bộ nhận diện tay…',
      detail: 'Chỉ mất vài giây lần đầu. Chuẩn bị hai bàn tay trước camera.',
    },
    handsError: {
      title: 'Bộ nhận diện tay không chạy được',
      detail: 'Tải lại trang; nếu vẫn lỗi, chọn nguồn cửa sổ Chuột trong Cài đặt.',
    },
    handsNone: {
      title: 'Đưa hai bàn tay vào trước camera',
      detail: (fingers: string, minPoints: number, minHands: number) =>
        `Giơ hai tay cách nhau một khoảng, lòng bàn tay hướng về camera. Cửa sổ là vùng bao các đầu ngón (${fingers}); cần ít nhất ${minPoints} đầu ngón của ${minHands} tay.`,
    },
    handsMissing: {
      title: 'Còn thiếu đầu ngón',
      detail: 'Giơ thêm đầu ngón hoặc đưa tay còn lại vào khung hình để mở cửa sổ.',
    },
    stalePoint: {
      title: 'Mất dấu đầu ngón',
      detail:
        'Giữ các đầu ngón trong khung hình và di chuyển chậm hơn; điểm cũ bị bỏ khỏi vùng, thiếu điểm thì cửa sổ đóng.',
    },
    outOfBoard: {
      title: 'Đầu ngón ra ngoài bảng',
      detail: 'Đưa các đầu ngón vào trong vùng lưới.',
    },
    tooSmallHands: {
      title: 'Các đầu ngón quá gần nhau',
      detail: (nMin: number) =>
        `Xòe ngón hoặc tách hai tay xa nhau hơn để cửa sổ đủ cỡ (tối thiểu ${nMin} ô mỗi cạnh).`,
    },
    ambiguous: {
      title: 'Hai tay chéo nhau',
      detail: 'Đặt tay trái bên trái, tay phải bên phải và không để hai tay chồng lên nhau.',
    },
    configChangedHands: {
      title: 'Cài đặt vừa đổi, cửa sổ đã đóng',
      detail: 'Đưa các đầu ngón vào lại để mở cửa sổ mới.',
    },
    mouseOpen: {
      title: 'Mở cửa sổ bằng chuột',
      detail:
        'Bấm hoặc kéo trên bảng để mở một cửa sổ vuông. Chọn nguồn cửa sổ Tay trong Cài đặt để mở theo các đầu ngón.',
    },
    mouseTooSmall: { title: 'Cửa sổ quá nhỏ', detail: 'Lăn chuột để phóng to cửa sổ.' },
    configChangedMouse: {
      title: 'Cài đặt vừa đổi, cửa sổ đã đóng',
      detail: 'Bấm trên bảng hoặc nhấn Space để mở lại.',
    },
    faceLoading: {
      title: 'Đang nạp bộ nhận diện mặt…',
      detail: 'Cửa sổ đã mở; khuôn mặt sẽ được tìm ngay khi nạp xong.',
    },
    faceError: {
      title: 'Bộ nhận diện mặt không chạy được',
      detail: 'Cửa sổ vẫn mở nhưng không tìm được khuôn mặt. Tải lại trang.',
    },
    searching: {
      title: 'Đang tìm khuôn mặt trong cửa sổ',
      detail: 'Đưa khuôn mặt vào vùng đang mở. Chỉ phần này của camera được xử lý.',
    },
    tooSmallFace: {
      title: 'Cửa sổ quá nhỏ cho khuôn mặt',
      hands: 'Xòe ngón hoặc tách hai tay xa hơn để cửa sổ rộng hơn.',
      mouse: 'Lăn chuột để phóng to cửa sổ.',
    },
    faceCandidate: {
      title: 'Khuôn mặt trong cửa sổ',
      titleWith: (label: string) => `Khuôn mặt trong cửa sổ: ${label}`,
      detail:
        'Nhận diện chỉ chạy trên vùng mở. Dời hoặc thu nhỏ cửa sổ để thấy vùng ngoài đóng lại.',
      demo: ' Nhãn người/hình nộm đến từ model demo theo màu, chưa phải model huấn luyện.',
    },
    partialFace: {
      title: 'Khuôn mặt bị cắt',
      hands: 'Mở rộng hoặc dời cửa sổ để khuôn mặt nằm trọn trong vùng mở.',
      mouse: 'Kéo cửa sổ hoặc lăn chuột để phóng to.',
    },
    covered: { title: 'Đang mở cửa sổ…', detail: 'Vùng mở sẽ hiện ở frame kế.' },
  },
  fingers: {
    names: { 4: 'cái', 8: 'trỏ', 12: 'giữa', 16: 'áp út', 20: 'út' } as Record<FingerTip, string>,
    hands: { left: 'Trái', right: 'Phải' } as Record<Handedness, string>,
    /** Hướng dẫn thiếu điểm (fingertipsGuidance). */
    none: (minPoints: number, twoHands: boolean) =>
      `Đưa ${twoHands ? 'hai bàn tay' : 'bàn tay'} vào khung hình: cửa sổ mở theo các đầu ngón (cần ít nhất ${minPoints} đầu ngón).`,
    ambiguous: 'hai tay chéo nhau, chưa phân biệt được',
    missingHand: (hand: Handedness) => `chưa thấy tay ${hand === 'left' ? 'trái' : 'phải'}`,
    outOfBoard: (n: number) => `${n} đầu ngón ngoài bảng`,
    stale: (n: number) => `${n} đầu ngón cũ`,
    lowScore: (n: number) => `${n} đầu ngón chưa rõ tay`,
    more: 'giơ thêm ngón',
    summary: (valid: number, minPoints: number, minHands: number, parts: string) =>
      `Đang thấy ${valid} đầu ngón hợp lệ, cần ít nhất ${minPoints} của ${minHands} tay: ${parts}.`,
  },
  subject: {
    person: 'Người',
    mannequin: 'Hình nộm',
    unknown: 'Khuôn mặt chưa phân loại',
    demo: ' · demo',
  },
  settings: {
    title: 'Cài đặt',
    grid: {
      title: 'Lưới',
      hint: (cols: number, rows: number, c: number) => `${cols} × ${rows} · ô ${c} px`,
      preset: 'Preset',
      presetAria: 'Lưới',
      custom: 'Tùy chỉnh',
      cols: 'Cột',
      colsAria: 'Số cột',
      rows: 'Hàng',
      rowsAria: 'Số hàng',
      lines: 'Vạch lưới',
      mirror: 'Mirror',
    },
    window: {
      title: 'Cửa sổ',
      source: 'Nguồn',
      sourceAria: 'Nguồn cửa sổ',
      mouse: 'Chuột',
      hands: 'Tay',
      hintHands:
        'Cửa sổ là vùng bao các đầu ngón của hai tay; đổi nguồn thì cửa sổ đang mở đóng lại.',
      hintMouse: 'Bấm hoặc kéo trên bảng để mở; lăn chuột đổi cỡ; Esc đóng; Space mở lại.',
      swap: 'Đảo trái/phải',
      swapTitle: 'D-010: bật nếu webcam thật gán nhãn tay ngược',
      swapHint: 'khi webcam gán nhãn tay ngược',
    },
    fingers: {
      title: 'Đầu ngón dùng',
      both: 'cả hai tay',
      aria: (name: string) => `Ngón ${name}`,
      hint: (minPoints: number, minHands: number) =>
        `Cửa sổ là vùng bao các đầu ngón; cần ít nhất ${minPoints} đầu ngón của ${minHands} tay.`,
    },
    sensitivity: {
      title: 'Độ nhạy',
      reset: 'Đặt lại độ nhạy',
      fields: {
        minCutoff: { label: 'Lọc (Hz)', aria: 'Lọc minCutoff' },
        beta: { label: 'Beta', aria: 'Lọc beta' },
        hysteresisCells: { label: 'Hysteresis (ô)', aria: 'Hysteresis' },
        nMin: { label: 'N min (ô)', aria: 'N min' },
        pointMaxAgeMs: { label: 'Tuổi điểm (ms)', aria: 'Tuổi điểm' },
      },
    },
    dataset: {
      title: 'Thu dữ liệu',
      toggle: 'Thu dữ liệu',
      offHint: 'chỉ crop vùng mở, lưu tại máy',
      consentTitle: 'Bước 1 của CLS-01: không có văn bản đồng ý thì không thu',
      consentAria: 'Người tham gia đã ký đồng ý',
      consent: 'Người tham gia đã ký đồng ý bằng văn bản',
      subjectId: 'Mã người tham gia',
      label: 'Nhãn tạm',
      lighting: 'Ánh sáng',
      mannequin: 'Hình nộm',
      mannequinAria: 'Loại hình nộm',
      note: 'Ghi chú',
      rate: 'Nhịp (Hz)',
      rateAria: 'Nhịp thu',
      stop: 'Dừng thu',
      start: 'Bắt đầu thu',
      folder: (name: string) => `Thư mục: ${name}`,
      pickFolder: 'Chọn thư mục…',
      downloadZip: (n: number) => `Tải zip (${n} mẫu)`,
      clear: 'Xóa mẫu trong bộ nhớ',
      labels: {
        person: 'Người',
        mannequin: 'Hình nộm',
        unknown: 'Chưa rõ',
        background: 'Chỉ nền hoặc chỉ tay',
      },
      lightings: { normal: 'Bình thường', bright: 'Mạnh', dim: 'Yếu', backlit: 'Ngược sáng' },
      mannequins: { none: 'Không', plastic: 'Nhựa', fabric: 'Vải', silicone: 'Silicone' },
      status: {
        off: 'dataset mode tắt',
        folder: (name: string) => `thư mục ${name}`,
        memory: (n: number, kb: number) => `bộ nhớ (${n} mẫu, ${kb} KB)`,
        recording: (n: number) => `đang thu ${n} mẫu`,
        stopped: (n: number) => `đã dừng, ${n} mẫu`,
        idle: 'chưa thu',
        error: (message: string) => ` · lỗi: ${message}`,
      },
    },
    log: {
      title: 'Nhật ký cục bộ',
      count: (n: number) => `${n} bản ghi`,
      pending: (n: number) => ` (đang ghi ${n})`,
      toggle: 'Ghi nhật ký cục bộ',
      show: 'Xem nhật ký',
      hide: 'Ẩn nhật ký',
      exportCsv: 'Xuất CSV',
      clear: 'Xóa nhật ký',
      error: (message: string) => `nhật ký lỗi: ${message}`,
      typeFilter: 'Loại',
      typeFilterAria: 'Lọc loại',
      all: 'tất cả',
      dayFilter: 'Ngày',
      dayFilterAria: 'Lọc ngày',
      colTime: 'Thời điểm',
      colType: 'Loại',
      colDetail: 'Chi tiết',
      empty: 'không có bản ghi',
      events: {
        consent: 'đồng ý',
        'camera-start': 'camera bật',
        'camera-stop': 'camera dừng',
        'camera-error': 'camera lỗi',
        'reveal-open': 'vùng mở',
        'reveal-close': 'vùng đóng',
        'config-change': 'đổi cấu hình',
      },
    },
    ui: {
      title: 'Giao diện',
      language: 'Ngôn ngữ',
      guide: 'Hướng dẫn trên màn',
      guideAria: 'Hướng dẫn trên màn',
      guideAuto: 'Tự thu gọn',
      guideFull: 'Luôn đầy đủ',
      guideHidden: 'Ẩn',
      guideHint:
        'Tự thu gọn: thông điệp hiện đầy đủ khi đổi rồi còn một dòng; lỗi camera luôn hiện đầy đủ.',
    },
  },
  debug: {
    label: 'Debug',
    epoch: 'epoch',
    frame: 'frame',
    close: 'đóng',
    none: 'không',
    region: 'vùng',
    board: 'bảng',
    at: 'tại',
    stage: 'stage',
    camera: 'camera',
    scale: 'scale',
    thumb: 'Buffer vừa gửi cho worker mặt',
    noClassifier: 'phân loại: không có',
  },
}
