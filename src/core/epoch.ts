// Bộ đếm epoch (mục 4.6, A7): tăng khi đổi camera, mirror, lưới, layout và mỗi lần closed → open;
// không tăng khi cửa sổ chỉ dịch. Mọi kết quả worker mang epoch cũ bị loại (bất biến I5).
// CAM-01 dùng qua CameraSource (D-025); GRID-01 và FACE-02 dùng chung một bộ đếm trong store.
export type EpochCounter = {
  readonly current: number
  /** Tăng một đơn vị và trả giá trị mới. */
  bump(): number
}

export function createEpochCounter(start = 0): EpochCounter {
  let value = start
  return {
    get current() {
      return value
    },
    bump() {
      value += 1
      return value
    },
  }
}
