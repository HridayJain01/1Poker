import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { IconClose } from './Icons';

export function Sheet({ open, onClose, title, children, actions, tall }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; actions?: ReactNode; tall?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="sheet"
            style={tall ? { height: '88dvh' } : undefined}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragListener={false}
            role="dialog"
            aria-modal="true"
          >
            <div className="sheet-grip" />
            {title !== undefined && (
              <div className="sheet-head">
                <h2>{title}</h2>
                <div className="spacer" />
                {actions}
                <button className="icon-btn" onClick={onClose} aria-label="Close">
                  <IconClose />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
