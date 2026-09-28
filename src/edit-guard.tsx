import React, {useEffect} from "react";
import {Modal} from "@arco-design/web-react";
export const EditGuardContext = React.createContext<(dirty: boolean) => void>(() => {});
export function useEditGuard(dirty: boolean) {
  const register = React.useContext(EditGuardContext);
  useEffect(() => { register(dirty); return () => register(false); }, [dirty, register]);
}
export function confirmDiscard(action: () => void) {
  Modal.confirm({title:"放弃未保存的修改？",content:"当前修改尚未保存，离开后将丢失。",okText:"放弃修改",cancelText:"继续编辑",onOk:action});
}
