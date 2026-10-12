import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({
  title,
  onClose,
  children,
  locked = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const prior = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button aria-label="Close dialog" disabled={locked} onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
