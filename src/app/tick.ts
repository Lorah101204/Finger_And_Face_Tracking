/** Nhịp đọc store ngoài React cho thanh debug và lớp hướng dẫn: 4 Hz (D-012), không re-render mỗi frame. */
export function subscribeTick(cb: () => void): () => void {
  const id = setInterval(cb, 250)
  return () => clearInterval(id)
}
