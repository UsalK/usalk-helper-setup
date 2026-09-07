import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Modal kabuğu.
 *
 * İçerik doğrudan document.body'ye portal ile basılır. Uygulama içinde
 * kaydırılabilir bir <main> ve konumlandırılmış saran katmanlar olduğu için
 * modal ağaç içinde kaldığında "sayfanın ortasına" oturuyordu; body'ye
 * taşındığında position:fixed her zaman ekranın (viewport) ortasını referans
 * alır — kullanıcı sayfanın neresinde olursa olsun tam karşısında açılır.
 *
 * Ayrıca modal açıkken arkadaki sayfanın kaymasını engeller ve Esc ile kapanır.
 */
export default function Modal({ open, onClose, children, maxWidth = 'max-w-3xl' }) {
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        className={`relative w-full ${maxWidth} bg-[#0f172a] border border-[#1e293b] rounded-3xl shadow-2xl max-h-[88vh] flex flex-col overflow-hidden`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
