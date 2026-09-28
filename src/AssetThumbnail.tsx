import { fileUrl } from "./core";
import { File,Film,Image as ImageIcon } from "lucide-react";
import { useEffect,useRef,useState } from "react";
import { imageUrl,Media,post } from "./core";

// Queue visible thumbnails so opening a page cannot spawn dozens of decoders.
let running = 0;
const pending: Array<() => void> = [];
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {running++; void work().then(resolve, reject).finally(() => {running--; pending.shift()?.();});};
    if (running < 2) start(); else pending.push(start);
  });
}
export default function AssetThumbnail({media, projectId}: {media: Media; projectId: string}) {
  const holder = useRef<HTMLSpanElement>(null);
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    setSource(""); setFailed(false);
    if(media.kind==="file"){setFailed(true);return;}
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void enqueue(async () => {
        if (disposed) return;
        try {
          const result = await post<{path:string}>("/media/thumbnail", {project_id:projectId, id:media.id});
          if (!disposed) setSource(fileUrl(result.path));
        } catch {
          if (!disposed) {if (media.kind === "image") setSource(imageUrl(media)); else setFailed(true);}
        }
      });
    }, {rootMargin:"160px"});
    if (holder.current) observer.observe(holder.current);
    return () => {disposed = true; observer.disconnect();};
  }, [projectId, media.id, media.path]);
  return <span className="cached-thumbnail" ref={holder}>
    {source && !failed ? <img loading="lazy" decoding="async" src={source} alt={media.name} onError={() => setFailed(true)}/> : <span className="thumbnail-placeholder">{media.kind === "video" ? <Film size={32}/> : media.kind==="file" ? <File size={32}/> : <ImageIcon size={32}/>}<small>{media.kind==="file" ? "文件" : failed ? "点击预览原文件" : "加载预览"}</small></span>}
  </span>;
}
