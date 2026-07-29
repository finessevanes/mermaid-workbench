import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';

interface DialogProps {
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  children?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export function Dialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  children,
  onConfirm,
  onClose,
}: DialogProps) {
  const titleId = `dialog-title-${title.replace(/\W+/g, '-').toLowerCase()}`;
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onConfirm();
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form method="dialog" onSubmit={handleSubmit}>
        <div className="dialog__eyebrow">Mermaid Workbench</div>
        <h2 id={titleId}>{title}</h2>
        {description ? <p className="dialog__description">{description}</p> : null}
        {children ? <div className="dialog__content">{children}</div> : null}
        <div className="dialog__actions">
          <button type="button" className="button button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={destructive ? 'button button--danger' : 'button button--primary'}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
