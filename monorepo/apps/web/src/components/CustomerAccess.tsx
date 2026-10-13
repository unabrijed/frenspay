'use client';
import { createContext, useContext } from 'react';
import type { FlistResponse } from '@fpay/shared';
export const AccessContext = createContext<{ data: FlistResponse; refresh: () => Promise<void> } | null>(null);
export const useFlist = () => useContext(AccessContext);
