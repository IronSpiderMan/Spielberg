import { useRef, useState } from "react";
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function TrimTimeField({label,value,min,max,disabled,onCommit}:{label:string;value:number;min:number;max:number;disabled:boolean;onCommit:(value:number)=>void}) {
  const [entry,setEntry] = useState({value,text:value.toFixed(2)});
  if (entry.value !== value) setEntry({value,text:value.toFixed(2)});
  const text = entry.value === value ? entry.text : value.toFixed(2);
  const cancelled = useRef(false);
  return <input aria-label={label} type="number" min={min} max={max} step="0.01" value={text} disabled={disabled}
    onChange={event=>setEntry({value,text:event.target.value})}
    onBlur={()=>{
      if(cancelled.current){cancelled.current=false;return;}
      const parsed=Number(text);
      if(text.trim()&&Number.isFinite(parsed)&&text!==value.toFixed(2))onCommit(clamp(parsed,min,max));
      setEntry({value,text:value.toFixed(2)});
    }} onKeyDown={event=>{
      if(event.key==="Enter"){event.preventDefault();event.currentTarget.blur();}
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();cancelled.current=true;setEntry({value,text:value.toFixed(2)});event.currentTarget.blur();}
    }}/>;
}
