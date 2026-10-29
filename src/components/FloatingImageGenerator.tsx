import { Button, Modal } from "@arco-design/web-react";
import { ImagePlus } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { Media, Snapshot } from "../core";
import { PageLoading } from "../ui";

const ImageStudio = lazy(() => import("../creation").then(module => ({ default: module.ImageStudio })));

export function FloatingImageGenerator({ data, reload, showButton = true }: { data: Snapshot; reload: () => void; showButton?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [source, setSource] = useState<Media | undefined>();
  useEffect(() => {
    const openImage = (event: Event) => {
      setSource((event as CustomEvent<Media>).detail);
      setOpen(true);
    };
    window.addEventListener("spielberg:image-to-image", openImage);
    return () => window.removeEventListener("spielberg:image-to-image", openImage);
  }, []);

  return <>
    {showButton && <Button
      className="floating-image-generator"
      type="primary"
      icon={<ImagePlus size={22} />}
      aria-label="打开生图模态框"
      title="生成图片"
      onClick={() => { setSource(undefined); setOpen(true); }}
    >生图</Button>}
    <Modal
      className="image-generator-modal"
      title={null}
      aria-label="生成图片"
      visible={open}
      style={{ width: "min(1200px, 94vw)" }}
      footer={null}
      unmountOnExit
      closable={!busy}
      maskClosable={!busy}
      escToExit={!busy}
      onCancel={() => { if (!busy) setOpen(false); }}
    >
      {open && <Suspense fallback={<PageLoading />}>
        <ImageStudio key={source?.id || "new"} source={source} compact data={data} reload={reload} onBusyChange={setBusy} />
      </Suspense>}
    </Modal>
  </>;
}
