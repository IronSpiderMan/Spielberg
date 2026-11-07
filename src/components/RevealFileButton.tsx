import { Button, Message } from "@arco-design/web-react";
import { FolderOpen } from "lucide-react";
import { useRef, useState } from "react";
import { canRevealFile, revealFile, revealFileLabel } from "../platform";

export function RevealFileButton({ path, size, className, disabled = false }: {
  path?: string;
  size?: "mini" | "small";
  className?: string;
  disabled?: boolean;
}) {
  const [opening, setOpening] = useState(false);
  const pending = useRef(false);
  if (!canRevealFile) return null;
  return <Button className={className} size={size} disabled={disabled || !path?.trim()} loading={opening}
    icon={<FolderOpen size={size === "mini" ? 13 : 16} />} aria-label={revealFileLabel} title={`${revealFileLabel}：${path || "文件路径不可用"}`} onClick={async () => {
      if (!path || pending.current) return;
      pending.current = true;
      setOpening(true);
      try { await revealFile(path); }
      catch (error) { Message.error(`打开文件位置失败：${String(error)}`); }
      finally { pending.current = false; setOpening(false); }
    }}>{size === "mini" ? "打开文件位置" : revealFileLabel}</Button>;
}
