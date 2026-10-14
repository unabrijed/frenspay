'use client';
import {useRef,useState} from 'react';

/** One accessible input preserves paste, autofill and native text editing across visual boxes. */
export function CodeInput({value,onChange,length=6,label='Verification code',numeric=true,disabled=false,invite=false}:{
  value:string;onChange:(value:string)=>void;length?:number;label?:string;numeric?:boolean;disabled?:boolean;invite?:boolean;
}) {
  const input=useRef<HTMLInputElement>(null);
  const [focused,setFocused]=useState(false),[cursor,setCursor]=useState(0);
  // Invitations are editable text, including their prefix and separators. Keep the
  // browser's caret and selection visible instead of mapping them onto OTP boxes.
  if(invite) return <input aria-label={label} value={value} onChange={e=>onChange(e.target.value)}
    disabled={disabled} required placeholder="FREN-XXXX-XXXX" autoComplete="off"
    autoCapitalize="characters" spellCheck={false} inputMode="text"
    onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
    style={{display:'block',width:'100%',minWidth:0,maxWidth:440,height:52,boxSizing:'border-box',
      padding:'0 14px',border:'1px solid #b6b6b6',borderRadius:10,fontSize:18,
      fontFamily:'monospace',letterSpacing:'0.06em',textTransform:'uppercase',color:'inherit',
      background:'var(--surface, transparent)',opacity:disabled?.5:1,
      outline:focused?'2px solid currentColor':undefined,outlineOffset:2}} />;
  const clean=(raw:string)=>{
    let text=raw.toUpperCase().replace(numeric?/[^0-9]/g:/[^A-Z0-9]/g,'');
    return text.slice(0,length);
  };
  const text=clean(value);
  return <div style={{position:'relative',display:'flex',gap:6,width:'100%',maxWidth:440,opacity:disabled?.5:1}}>
    <input ref={input} aria-label={label} value={text} disabled={disabled} required minLength={length}
      autoComplete={numeric?'one-time-code':'off'} inputMode={numeric?'numeric':'text'} autoCapitalize="characters" spellCheck={false}
      onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
      onSelect={e=>setCursor(e.currentTarget.selectionStart??text.length)}
      onChange={e=>{const next=clean(e.target.value);onChange(next);setCursor(Math.min(e.target.selectionStart??next.length,next.length));}}
      style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:0,fontSize:16,zIndex:1,cursor:'text'}} />
    {Array.from({length},(_,index)=><span key={index} aria-hidden="true"
      onPointerDown={event=>{event.preventDefault();input.current?.focus();const at=Math.min(index,text.length);input.current?.setSelectionRange(at,Math.min(at+1,text.length));setCursor(at);}}
      style={{position:'relative',zIndex:2,pointerEvents:disabled?'none':'auto',cursor:'text',flex:'1 1 0',minWidth:0,height:48,display:'grid',placeItems:'center',
        border:focused&&Math.min(cursor,length-1)===index?'2px solid currentColor':'1px solid #b6b6b6',borderRadius:10,fontSize:20,fontWeight:600,
        background:'var(--surface, transparent)',boxSizing:'border-box'}}>{text[index]||'\u00a0'}</span>)}
  </div>;
}
