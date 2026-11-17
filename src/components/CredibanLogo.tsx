import React from 'react';

interface CredibanLogoProps {
  variant?: 'header' | 'login' | 'print';
}

export const CredibanLogo: React.FC<CredibanLogoProps> = ({ variant = 'header' }) => {
  const isLogin = variant === 'login';
  const isPrint = variant === 'print';

  return (
    <div className="flex items-center gap-3 shrink-0">
      <div
        className={`${
          isLogin ? 'w-12 h-12 rounded-xl p-1.5 shadow-md' : 'w-10 h-10 rounded-xl p-1.5 shadow-sm'
        } bg-white flex items-center justify-center shrink-0 border border-slate-200/80`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 180 240"
          className="w-full h-full"
          aria-hidden="true"
        >
          <g fill="#59B447">
            <rect x="90" y="8" width="24" height="13" rx="6.5" />
            <rect x="71" y="31" width="61" height="13" rx="6.5" />
            <rect x="50" y="55" width="74" height="13" rx="6.5" />
            <rect x="31" y="79" width="75" height="13" rx="6.5" />
            <rect x="24" y="103" width="63" height="13" rx="6.5" />
            <rect x="37" y="128" width="24" height="13" rx="6.5" />
            <path d="M143 55 C141 78 130 95 111 107 C96 117 81 122 72 134 C62 147 63 166 70 181 C76 195 87 208 97 216 C107 201 118 189 131 177 C144 166 157 156 164 141 C173 123 173 104 168 89 C164 74 156 62 143 55 Z" />
          </g>
        </svg>
      </div>
      <div className="flex flex-col leading-none">
        <span
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          className={`text-[#59B447] font-bold tracking-widest whitespace-nowrap ${
            isLogin ? 'text-2xl' : 'text-lg'
          }`}
        >
          CREDIBAN
        </span>
        <span
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
          className={`text-[10px] tracking-wider mt-0.5 whitespace-nowrap ${
            isPrint ? 'text-slate-600' : isLogin ? 'text-emerald-200' : 'text-emerald-300'
          }`}
        >
          empieza a construir tus sueños
        </span>
      </div>
    </div>
  );
};
