/**
 * shoes-admin 品牌图标：体现"代理转发"语义
 * 客户端(左) → 代理节点(中) → 服务端(右)，中间节点内带转发箭头
 */
export function BrandIcon({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="shoes-admin"
    >
      <defs>
        <linearGradient id="brand-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      {/* 背景 */}
      <rect width="48" height="48" rx="12" fill="url(#brand-grad)" />
      {/* 客户端节点 */}
      <circle cx="11" cy="24" r="4.5" fill="#ffffff" opacity="0.85" />
      {/* 代理转发节点 */}
      <rect x="18" y="15" width="12" height="18" rx="3.5" fill="#ffffff" />
      <path
        d="M21.8 20.2 L26 24 L21.8 27.8"
        fill="none"
        stroke="#4f46e5"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 服务端节点 */}
      <circle cx="37" cy="24" r="4.5" fill="#ffffff" opacity="0.85" />
      {/* 链路短线 */}
      <path
        d="M15.5 22.5 L17 22.5 M15.5 25.5 L17 25.5"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M30.5 22.5 L32 22.5 M30.5 25.5 L32 25.5"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}
