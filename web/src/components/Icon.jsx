// Bộ icon nét mảnh thống nhất (stroke 1.7, bo tròn), vẽ tay để không cần thư viện.
const P = {
  home: 'M3.5 11 12 4l8.5 7M5.5 9.8V20h13V9.8M10 20v-5.5h4V20',
  bag: 'M6 8h12l1 12H5L6 8ZM9 8V7a3 3 0 0 1 6 0v1',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6',
  tag: 'M3.5 12.5V4.5h8l9 9-8 8-9-9ZM8 8.5h.01',
  box: 'M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5v-9ZM3.5 7.5 12 12l8.5-4.5M12 12v9',
  truck: 'M2.5 6.5h11v10h-11zM13.5 10h4l3 3v3.5h-7M7 19.5a1.8 1.8 0 1 0 0-.01M17 19.5a1.8 1.8 0 1 0 0-.01',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.2a6.5 6.5 0 0 1 3.5 5.8',
  heart: 'M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.8 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z',
  wallet: 'M3.5 7.5a2 2 0 0 1 2-2h12v3M3.5 7.5v10a2 2 0 0 0 2 2h14v-11h-14a2 2 0 0 1-2-2ZM16 13.5h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M21 20H3',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7.5 7.5 0 0 1-1.7 1l-.3 2h-3.6l-.3-2a7.5 7.5 0 0 1-1.7-1l-1.9.7L5.9 14.7l1.6-1.2a7.6 7.6 0 0 1 0-3l-1.6-1.2 1.8-3.1 1.9.7a7.5 7.5 0 0 1 1.7-1l.3-2h3.6l.3 2c.6.2 1.2.6 1.7 1l1.9-.7 1.8 3.1-1.6 1.2c.1.5.1 1 0 1.5Z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  upload: 'M12 16V4M7 9l5-5 5 5M4.5 15v4.5h15V15',
  pin: 'M9 4.5l-4 4M15 4.5l4 4M7 7l10 10M12 12l-7 7',
  panel: 'M4.5 5h15v14h-15zM9.5 5v14',
  chevron: 'M6 9l6 6 6-6',
  out: 'M14 4h5.5v16H14M10 8l-4 4 4 4M6 12h10',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  print: 'M7 9V3.5h10V9M7 17H4.5v-7h15v7H17M7 14h10v6.5H7z',
};

export default function Icon({ name, size, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width={size} height={size} {...rest}>
      <path d={P[name]} />
    </svg>
  );
}

/** Hình minh hoạ cho trạng thái trống: cuốn sổ mở trắng */
export function OpenBook() {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
      <path d="M8 24c10-4 22-3 32 3v40C30 61 18 60 8 64V24Z" fill="#CDB58D" fillOpacity=".35" stroke="#865C49" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M72 24c-10-4-22-3-32 3v40c10-6 22-7 32-3V24Z" fill="#F6F0E4" stroke="#865C49" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M48 36c6-2 13-2 18 0M48 44c6-2 13-2 18 0M48 52c6-2 13-2 18 0" stroke="#CDB58D" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="58" cy="21" r="7" fill="#633D37" />
      <path d="M55 21h6M58 18v6" stroke="#EDE3D2" strokeWidth="1.4" strokeLinecap="round" transform="rotate(-8 58 21)" />
    </svg>
  );
}
