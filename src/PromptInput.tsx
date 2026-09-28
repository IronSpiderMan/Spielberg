import {useId,useRef,useState} from "react";
import type {ReactNode} from "react";
import {findMentions,mentionPattern,promptMentions,savedPromptMentions} from "./prompt-mentions";
import type {SavedPrompt} from "./prompt-mentions";
import type {Role,Snapshot} from "./core";

export function PromptInput({value,onChange,roles,data,prompts=[],placeholder,disabled=false,onOptimize,optimizing=false}:{value:string;onChange:(value:string)=>void;roles:Role[];data?:Snapshot;prompts?:SavedPrompt[];placeholder?:string;disabled?:boolean;onOptimize?:()=>void;optimizing?:boolean}) {
  const input=useRef<HTMLTextAreaElement>(null), backdrop=useRef<HTMLDivElement>(null);
  const [caret,setCaret]=useState(value.length),[focused,setFocused]=useState(false),[active,setActive]=useState(0),[dismissed,setDismissed]=useState(false);
  const listId=useId();
  const items=[...promptMentions(roles,data),...savedPromptMentions(prompts)];
  const query=value.slice(0,caret).match(/@([^@\n]*)$/);
  const options=query ? items.filter(item=>item.name.toLowerCase().includes(query[1].toLowerCase())) : [];
  const show=focused&&!dismissed&&!!query&&options.length>0&&!disabled;
  const selected=Math.min(active,options.length-1);
  const parts:ReactNode[]=[];
  const pattern=mentionPattern(items);
  let offset=0;
  for(const match of pattern?value.matchAll(pattern):[]) {
    const start=match.index!;
    parts.push(value.slice(offset,start));
    const item=items.find(item=>item.name===match[1])!;
    parts.push(<mark key={start} className={`prompt-mention ${item.kind}${data&&item.kind!=="prompt"&&!item.media?" missing":""}`}>{match[0]}</mark>);
    offset=start+match[0].length;
  }
  parts.push(value.slice(offset),"\n");
  const choose=(index:number)=>{
    if(!query||!options[index])return;
    const start=caret-query[0].length, token=`@${options[index].name} `;
    onChange(value.slice(0,start)+token+value.slice(caret));
    setDismissed(true);
    requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(start+token.length,start+token.length);setCaret(start+token.length);});
  };
  return <div className="prompt-input">
    {onOptimize&&<div className="prompt-tools"><button type="button" disabled={disabled||optimizing||!value.trim()} onClick={onOptimize}>{optimizing?"正在优化…":"✨ 优化 Prompt"}</button></div>}
    <div className={`prompt-editor${disabled?" disabled":""}`}>
      <div ref={backdrop} className="prompt-backdrop" aria-hidden="true">{parts}</div>
      <textarea ref={input} value={value} disabled={disabled} rows={4} aria-label="画面描述" aria-autocomplete="list" aria-controls={show?listId:undefined} aria-activedescendant={show?`${listId}-${selected}`:undefined}
        placeholder={placeholder||(data?"描述画面，@ 引用角色或剧集.scene001.first / last / ref":"描述画面，输入 @ 引用角色")}
        onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
        onSelect={event=>setCaret(event.currentTarget.selectionStart)}
        onChange={event=>{onChange(event.target.value);setCaret(event.target.selectionStart);setActive(0);setDismissed(false);}}
        onScroll={event=>{if(backdrop.current){backdrop.current.scrollTop=event.currentTarget.scrollTop;backdrop.current.scrollLeft=event.currentTarget.scrollLeft;}}}
        onKeyDown={event=>{if(event.nativeEvent.isComposing||!show)return;if(event.key==="Escape"){setDismissed(true);event.preventDefault();}else if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();setActive((selected+(event.key==="ArrowDown"?1:-1)+options.length)%options.length);}else if(event.key==="Enter"||event.key==="Tab"){event.preventDefault();choose(selected);}}}/>
    </div>
    {show&&<div className="prompt-suggestions" role="listbox" id={listId}>{options.map((item,index)=><button type="button" role="option" aria-selected={index===selected} id={`${listId}-${index}`} key={item.id} className={index===selected?"active":""} ref={node=>{if(index===selected)node?.scrollIntoView({block:"nearest"});}} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(index)}><b>@{item.name}</b><small>{item.kind==="role"?"角色":item.description}{data&&item.kind!=="prompt"&&!item.media?" · 缺少图片":""}</small></button>)}</div>}
    {data&&findMentions(value,items).some(item=>item.kind!=="prompt"&&!item.media)&&<p className="prompt-missing">橙色引用缺少图片，请先为对应角色或场景添加图片。</p>}
  </div>;
}
