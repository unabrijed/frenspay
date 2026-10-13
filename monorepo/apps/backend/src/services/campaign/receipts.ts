import {runDynamicReceipts} from '../dynamicReceipt';
export {RECEIPT_TARGET} from '../dynamicReceipt';
export const runCampaignReceipts=(log:(message:string)=>void=console.log)=>runDynamicReceipts('campaign_spends',log);
export function startCampaignReceipts(log:(message:string)=>void){const timer=setInterval(()=>void runCampaignReceipts(log),15000);timer.unref();}
