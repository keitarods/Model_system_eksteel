"use client";
import { createContext, useContext } from 'react';
type Config = { url: string; key: string } | null;
const Context = createContext<Config>(null);
let browserConfig: Config = null;
export function getBrowserConfig() { return browserConfig; }
export function useInstallation() { return useContext(Context); }
export function InstallationProvider({ config, children }: { config: Config; children: React.ReactNode }) {
  if (typeof window !== 'undefined') browserConfig = config;
  return <Context.Provider value={config}>{children}</Context.Provider>;
}
