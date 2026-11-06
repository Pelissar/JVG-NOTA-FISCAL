"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useState } from "react";
import Link from "next/link";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function browserAuth() {
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const ready = Boolean(url && key);

  useEffect(() => {
    const client = browserAuth();
    if (!client) return;
    void client.auth.getUser().then(({ data }) => {
      if (data.user) window.location.replace("/erp/index.html");
    });
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = browserAuth();
    if (!client) { setMessage("Configure as variáveis públicas do Supabase na Netlify."); return; }
    if (!email.includes("@") || password.length < 8) { setMessage("Informe e-mail válido e senha de pelo menos 8 caracteres."); return; }
    setPending(true); setMessage("");
    try {
      if (mode === "signup") {
        const result = await client.auth.signUp({
          email: email.trim(), password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (result.error) throw result.error;
        if (result.data.session) window.location.replace("/erp/index.html");
        else setMessage("Cadastro iniciado! Confira sua caixa de e-mail para confirmar a conta antes de entrar.");
      } else {
        const result = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw result.error;
        window.location.replace("/erp/index.html");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível autenticar.");
    } finally { setPending(false); }
  }

  return (
    <main style={{ minHeight:"100vh", background:"linear-gradient(145deg,#081827,#153a50)", color:"#e8f0f6",display:"grid",placeItems:"center",padding:20,fontFamily:"system-ui,sans-serif" }}>
      <section style={{ width:"100%",maxWidth:440,background:"#fff",color:"#172c3a",borderRadius:22,padding:"34px 30px",boxShadow:"0 22px 80px #020c1680" }}>
        <Link href="/" style={{display:"inline-flex",alignItems:"center",gap:7,color:"#387b73",fontSize:12,textDecoration:"none",marginBottom:23,fontWeight:700}}>← Voltar ao site</Link>
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:25}}>
          <div style={{background:"#0a7b70",color:"#fff",borderRadius:13,width:47,height:47,display:"grid",placeItems:"center",fontSize:24,fontWeight:800}}>J</div>
          <div><strong style={{fontSize:21}}>JVG Nota Fiscal</strong><div style={{fontSize:12,color:"#687e8c"}}>ERP multiempresa • ambiente piloto</div></div>
        </div>
        <h1 style={{fontSize:26,fontWeight:750,margin:"0 0 6px"}}>{mode==="login"?"Entrar no sistema":"Criar minha conta"}</h1>
        <p style={{color:"#617785",fontSize:14,margin:"0 0 24px"}}>Acesso protegido por Supabase Auth. Cadastre sua empresa após entrar.</p>
        {!ready && <p role="alert" style={{padding:13,background:"#fff3d9",borderRadius:9,color:"#855500",fontSize:13}}>Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY na Netlify e publique novamente.</p>}
        <form onSubmit={submit} style={{display:"grid",gap:13}}>
          <label style={{display:"grid",gap:6,fontSize:13,fontWeight:650}}>E-mail
            <input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="voce@empresa.com.br" style={{padding:"12px 13px",borderRadius:10,border:"1px solid #d0dbe2",fontSize:15,color:"#172c3a",background:"#fff"}} />
          </label>
          <label style={{display:"grid",gap:6,fontSize:13,fontWeight:650}}>Senha
            <input type="password" autoComplete={mode==="login"?"current-password":"new-password"} required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" style={{padding:"12px 13px",borderRadius:10,border:"1px solid #d0dbe2",fontSize:15,color:"#172c3a",background:"#fff"}} />
          </label>
          <button type="submit" disabled={pending||!ready} style={{padding:13,border:0,borderRadius:10,background:pending||!ready?"#8799a4":"#008b7e",color:"white",fontSize:15,fontWeight:700,cursor:pending||!ready?"not-allowed":"pointer",marginTop:8}}>{pending?"Aguarde...":mode==="login"?"Entrar":"Criar conta"}</button>
        </form>
        {message && <p role="status" style={{marginTop:15,fontSize:13,background:"#ecf5f5",padding:12,borderRadius:9}}>{message}</p>}
        <button type="button" onClick={()=>{setMode(mode==="login"?"signup":"login");setMessage("");}} style={{marginTop:20,padding:0,border:0,background:"transparent",color:"#007f72",fontWeight:650,cursor:"pointer"}}>{mode==="login"?"Primeiro acesso? Criar conta":"Já tenho conta. Fazer login"}</button>
        <p style={{fontSize:11,color:"#81929d",marginTop:25}}>Ambiente piloto. A emissão fiscal real ainda depende da integração e da homologação com a Focus NFe.</p>
      </section>
    </main>
  );
}
