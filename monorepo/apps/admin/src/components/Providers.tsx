'use client';
import dynamic from 'next/dynamic';
export const Providers=dynamic(()=>import('./DynamicProviders').then(m=>m.Providers),{ssr:false,loading:()=> <div>Loading sign-in…</div>});
export const SignOut=dynamic(()=>import('./DynamicProviders').then(m=>m.SignOut),{ssr:false});
