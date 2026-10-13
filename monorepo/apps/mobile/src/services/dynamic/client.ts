import {createDynamicClient,initializeClient} from '@dynamic-labs-sdk/client';
import {addWaasSolanaExtension} from '@dynamic-labs-sdk/solana/waas';
import {DYNAMIC_ENVIRONMENT_ID,LANDING_URL} from '../envConfig';
export const dynamicClient=createDynamicClient({autoInitialize:false,environmentId:DYNAMIC_ENVIRONMENT_ID,
  metadata:{name:'Frenspay',nativeLink:'fpay://',universalLink:LANDING_URL}});
addWaasSolanaExtension(dynamicClient);
export const initializeDynamic=()=>initializeClient(dynamicClient);
