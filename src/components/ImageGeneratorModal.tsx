import { Button, Modal } from "@arco-design/web-react";
import { ImagePlus } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { Media, Snapshot } from "../core";
import { PageLoading } from "../ui";

const ImageStudio = lazy(() => import("../creation").then(module => ({ default: module.ImageStudio })));

const openImageGeneratorEvent = "spielberg:open-image-generator";

export function openImageGenerator(source?: Media) {
  window.dispatchEvent(new CustomEvent(openImageGeneratorEvent, { detail: source }));
}

export function ImageGeneratorButton() {
  return <Button
    icon={<ImagePlus size={16} />}
    aria-label="打开生图模态框"
    aria-haspopup="dialog"
    title="生成图片"
    onClick={() => openImageGenerator()}
  >生图</Button>;
}

export function ImageGeneratorModal({ data, reload }: { data: Snapshot; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [source, setSource] = useState<Media | undefined>();
  useEffect(() => {
    const openImage = (event: Event) => {
      setSource((event as CustomEvent<Media | null>).detail ?? undefined);
      setOpen(true);
    };
    window.addEventListener(openImageGeneratorEvent, openImage);
    return () => window.removeEventListener(openImageGeneratorEvent, openImage);
  }, []);

  return <Modal
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
  </Modal>;
}
