import { Button, Modal } from "@arco-design/web-react";
import { ImagePlus } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import type { Snapshot } from "../core";
import { PageLoading } from "../ui";

const ImageStudio = lazy(() => import("../creation").then(module => ({ default: module.ImageStudio })));

export function FloatingImageGenerator({ data, reload }: { data: Snapshot; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return <>
    <Button
      className="floating-image-generator"
      type="primary"
      icon={<ImagePlus size={22} />}
      aria-label="打开生图模态框"
      title="生成图片"
      onClick={() => setOpen(true)}
    >生图</Button>
    <Modal
      className="image-generator-modal"
      title="生成图片"
      visible={open}
      style={{ width: "min(1100px, 94vw)" }}
      footer={null}
      unmountOnExit
      closable={!busy}
      maskClosable={!busy}
      escToExit={!busy}
      onCancel={() => { if (!busy) setOpen(false); }}
    >
      {open && <Suspense fallback={<PageLoading />}>
        <ImageStudio data={data} reload={reload} onBusyChange={setBusy} />
      </Suspense>}
    </Modal>
  </>;
}
