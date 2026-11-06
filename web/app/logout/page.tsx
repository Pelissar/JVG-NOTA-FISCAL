"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useEffect } from "react";

export default function Logout() {
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) { window.location.replace("/login"); return; }
    void createBrowserClient(url, key).auth.signOut().finally(() => window.location.replace("/login"));
  }, []);
  return <main style={{padding:40,fontFamily:"sans-serif"}}>Encerrando sessão com segurança...</main>;
}
