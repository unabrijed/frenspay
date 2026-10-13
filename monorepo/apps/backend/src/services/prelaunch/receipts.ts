import {runDynamicReceipts} from '../dynamicReceipt';
export {RECEIPT_TARGET} from '../dynamicReceipt';
export const runPrelaunchReceipts=(log:(message:string)=>void=console.log)=>runDynamicReceipts('prelaunch_spends',log);
export function startPrelaunchReceipts(log:(message:string)=>void){const timer=setInterval(()=>void runPrelaunchReceipts(log),15000);timer.unref();}
