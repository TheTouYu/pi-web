"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { AuthRole } from "@/lib/auth";

const ROLE_STORAGE_KEY = "pi-web-role";

function readStoredRole(): AuthRole {
  try {
    return window.localStorage.getItem(ROLE_STORAGE_KEY) === "readonly" ? "readonly" : "admin";
  } catch {
    return "admin";
  }
}

const RoleContext = createContext<AuthRole>("admin");

/** 登录角色（体验层，只用于隐藏控件；真正的拦截在服务端 proxy）。 */
export function RoleProvider({ children }: { children: ReactNode }) {
  const [role] = useState<AuthRole>(readStoredRole);
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): AuthRole {
  return useContext(RoleContext);
}
