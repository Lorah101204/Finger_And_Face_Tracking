// UX-03 (D-049): dấu hiệu nhỏ của app (bảng chia ô với một ô mở) vẽ bằng SVG inline, không ảnh ngoài (I9); dùng ở thanh
// trên của sân khấu và thẻ kiosk của màn hình bắt đầu. Trang trí: aria-hidden.
export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 18 18" width={size} height={size} aria-hidden="true" focusable="false">
      <rect
        x="1"
        y="1"
        width="16"
        height="16"
        rx="3"
        fill="#fff"
        stroke="#1967d2"
        strokeWidth="1.6"
      />
      <path d="M6.5 1v16M11.5 1v16M1 6.5h16M1 11.5h16" stroke="#dadce0" strokeWidth="1" />
      <rect x="6.5" y="6.5" width="5" height="5" fill="#1967d2" />
    </svg>
  )
}
