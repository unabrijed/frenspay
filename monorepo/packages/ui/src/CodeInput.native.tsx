import {useRef,useState} from 'react';
import {TextInput,View,Text,Pressable} from 'react-native';
export function CodeInput({value,onChange,length=6,label='Verification code',numeric=true,disabled=false,invite=false}:{value:string;onChange:(value:string)=>void;length?:number;label?:string;numeric?:boolean;disabled?:boolean;invite?:boolean}) {
  const input=useRef<TextInput>(null);const [focused,setFocused]=useState(false);
  if(invite) return <TextInput accessibilityLabel={label} value={value} onChangeText={onChange}
    placeholder="FREN-XXXX-XXXX" editable={!disabled} autoComplete="off" autoCapitalize="characters" autoCorrect={false}
    style={{width:'100%',height:52,borderWidth:1,borderColor:'#555',borderRadius:10,paddingHorizontal:14,fontSize:18,color:'#171717'}}/>;
  const clean=(raw:string)=>{let s=raw.toUpperCase().replace(numeric?/[^0-9]/g:/[^A-Z0-9]/g,'');if(invite&&s.startsWith('FREN'))s=s.slice(4);return s.slice(0,length);};
  const text=clean(value);
  return <Pressable onPress={()=>input.current?.focus()} style={{width:'100%',minHeight:52}}>
    <View pointerEvents="none" style={{flexDirection:'row',gap:6}}>
      {Array.from({length},(_,i)=><View key={i} style={{flex:1,height:48,borderRadius:10,borderColor:'#555',borderWidth:focused&&Math.min(text.length,length-1)===i?2:1,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:20,color:'#171717'}}>{text[i]||' '}</Text></View>)}
    </View>
    <TextInput ref={input} accessibilityLabel={label} value={text} onChangeText={s=>onChange(clean(s))}
      editable={!disabled} keyboardType={numeric?'number-pad':'default'} autoComplete={numeric?'one-time-code':'off'}
      textContentType={numeric?'oneTimeCode':'none'} autoCapitalize="characters" autoCorrect={false}
      onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
      style={{position:'absolute',width:'100%',height:48,opacity:0,fontSize:16}}/>
  </Pressable>;
}
