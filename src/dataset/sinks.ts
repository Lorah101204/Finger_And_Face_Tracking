// CLS-01 bước 2: nơi lưu cục bộ. Thư mục qua File System Access API (Chromium: showDirectoryPicker, người thu chọn thư
// mục trên máy) hoặc tải zip qua thẻ <a download>. Không có đường mạng (I9). Mã hóa PNG bằng OffscreenCanvas từ ImageData
// của crop (không drawImage, không đụng video).
import type { DatasetSink, Sample, SessionMeta } from './recorder'

type WritableLike = { write(data: Blob | string): Promise<void>; close(): Promise<void> }
type FileHandleLike = { createWritable(): Promise<WritableLike> }
type DirHandleLike = {
  name: string
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandleLike>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>
}
type PickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<DirHandleLike>
}

export function directorySinkSupported(): boolean {
  return typeof (window as PickerWindow).showDirectoryPicker === 'function'
}

/** Hộp thoại chọn thư mục; null khi người dùng hủy. Mỗi phiên ghi vào thư mục con <sessionId>/. */
export async function pickDirectorySink(): Promise<DatasetSink | null> {
  const picker = (window as PickerWindow).showDirectoryPicker
  if (!picker) return null
  let root: DirHandleLike
  try {
    root = await picker.call(window, { mode: 'readwrite' })
  } catch {
    return null
  }
  return directorySink(root)
}

export function directorySink(root: DirHandleLike): DatasetSink {
  async function writeFile(dir: DirHandleLike, name: string, data: Blob | string): Promise<void> {
    const handle = await dir.getFileHandle(name, { create: true })
    const w = await handle.createWritable()
    await w.write(data)
    await w.close()
  }
  return {
    name: root.name,
    async writeSample(sample: Sample) {
      const dir = await root.getDirectoryHandle(sample.meta.sessionId, { create: true })
      await writeFile(dir, `${sample.meta.id}.png`, sample.png)
      await writeFile(dir, `${sample.meta.id}.json`, JSON.stringify(sample.meta, null, 2))
    },
    async writeSession(meta: SessionMeta) {
      const dir = await root.getDirectoryHandle(meta.sessionId, { create: true })
      await writeFile(dir, 'session.json', JSON.stringify(meta, null, 2))
    },
  }
}

/** ImageData của crop → PNG. */
export async function encodePng(img: ImageData): Promise<Blob> {
  const c = new OffscreenCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas không có context 2d')
  ctx.putImageData(img, 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}

/** Tải một mảng byte về máy dưới tên cho trước (Blob URL, thẻ <a download>). */
export function downloadBytes(bytes: Uint8Array, name: string, type = 'application/zip'): void {
  const blob = new Blob([bytes as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
