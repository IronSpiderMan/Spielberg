import { Modal, Popconfirm } from "@arco-design/web-react";
import type { ButtonProps, ModalProps, PopconfirmProps } from "@arco-design/web-react";
import { CircleAlert, Info, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

type ConfirmIntent = "danger" | "warning" | "info";
const classes = (base: string, intent: ConfirmIntent, extra?: string | string[]) =>
  [base, `is-${intent}`, ...(Array.isArray(extra) ? extra : [extra])].filter(Boolean).join(" ");

function ConfirmIcon({ intent }: { intent: ConfirmIntent }) {
  const Icon = intent === "danger" ? Trash2 : intent === "info" ? Info : CircleAlert;
  return <span className={`studio-confirm-icon is-${intent}`} aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>;
}

/** Anchored confirmations share action semantics, safe focus and viewport gutters. */
export function ConfirmPopover({
  intent = "danger", className, style, okText, okButtonProps, cancelButtonProps, triggerProps,
  popupVisible, defaultPopupVisible = false, onVisibleChange, ...props
}: PopconfirmProps & { children: ReactNode; intent?: ConfirmIntent }) {
  const [visible, setVisible] = useState(defaultPopupVisible);
  const changeVisible = (next: boolean) => {
    setVisible(next);
    onVisibleChange?.(next);
  };
  // Arco listens for Escape on the trigger only. Once focus is in its portal,
  // handle it here so the parent editor's Modal/Drawer does not close instead.
  const buttonKeyDown = (handler?: ButtonProps["onKeyDown"]): ButtonProps["onKeyDown"] => event => {
    handler?.(event);
    if (event.key === "Escape" && props.escToClose !== false) {
      event.preventDefault();
      event.stopPropagation();
      changeVisible(false);
    }
  };
  return <Popconfirm
    position="bl"
    autoFocus
    focusLock
    escToClose
    cancelText="取消"
    icon={<ConfirmIcon intent={intent} />}
    getPopupContainer={() => document.body}
    {...props}
    popupVisible={popupVisible ?? visible}
    onVisibleChange={changeVisible}
    className={classes("studio-confirm-popover", intent, className)}
    style={{ width: 360, maxWidth: "calc(100vw - 32px)", ...style }}
    okText={okText ?? (intent === "danger" ? "删除" : "继续")}
    okButtonProps={{ size: "default", ...(intent === "danger" ? { status: "danger" } : {}), ...okButtonProps, onKeyDown: buttonKeyDown(okButtonProps?.onKeyDown) }}
    cancelButtonProps={{ size: "default", ...cancelButtonProps, onKeyDown: buttonKeyDown(cancelButtonProps?.onKeyDown) }}
    triggerProps={{ autoFitPosition: true, autoFixPosition: true, boundaryDistance: { left: 16, right: 16, top: 16, bottom: 16 }, updateOnScroll: true, ...triggerProps }}
  />;
}

/** Imperative confirmations use the same visual language as anchored ones. */
export function confirmAction({
  intent = "warning", className, title, okButtonProps, ...props
}: Parameters<typeof Modal.confirm>[0] & { intent?: ConfirmIntent }) {
  return Modal.confirm({
    autoFocus: true,
    focusLock: true,
    maskClosable: false,
    cancelText: "取消",
    ...props,
    className: classes("studio-confirm-modal", intent, className),
    icon: <ConfirmIcon intent={intent} />,
    title: <span className="studio-confirm-title">{title}</span>,
    okButtonProps: { ...(intent === "danger" ? { status: "danger" } : {}), ...okButtonProps },
  });
}

/** Controlled variant for confirmations with inline errors or an existing busy state. */
export function ConfirmDialog({ intent = "warning", className, title, okButtonProps, ...props }: ModalProps & { intent?: ConfirmIntent; children?: ReactNode }) {
  return <Modal simple autoFocus focusLock maskClosable={false} cancelText="取消" {...props}
    className={classes("studio-confirm-modal", intent, className)}
    title={<span><ConfirmIcon intent={intent} /><span className="studio-confirm-title">{title}</span></span>}
    okButtonProps={{ ...(intent === "danger" ? { status: "danger" } : {}), ...okButtonProps }}
  />;
}
