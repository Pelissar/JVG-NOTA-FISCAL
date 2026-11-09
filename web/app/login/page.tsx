"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import styles from "./login.module.css";

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
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const ready = Boolean(url && key);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("sigmafiscal-theme") === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = savedTheme;
    setTheme(savedTheme);
    const client = browserAuth();
    if (!client) return;
    void client.auth.getUser().then(({ data }) => {
      if (data.user) window.location.replace("/erp/index.html");
    });
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem("sigmafiscal-theme", next); } catch { /* Tema segue ativo nesta tela. */ }
  }

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
    <main className={styles.page}>
      <button type="button" className={styles.theme} onClick={toggleTheme} aria-label={theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"}>{theme === "light" ? "◐ Modo escuro" : "☀ Modo claro"}</button>
      <div className={styles.layout}>
        <section className={styles.intro}>
          <Link href="/" className={styles.brand}><Image src="/branding/sigmafiscal-icon.svg" alt="" width={62} height={62}/><span><strong>Sigma<span>Fiscal</span></strong><small>ERP EMPRESARIAL</small></span></Link>
          <span className={styles.kicker}>Seu espaço de trabalho</span>
          <h1>Bem-vindo ao <em>SigmaFiscal.</em></h1>
          <p>Organize clientes, produtos, estoque e operações comerciais em uma plataforma feita para o seu negócio.</p>
          <div className={styles.features}><span>✓ Gestão integrada</span><span>✓ Acesso seguro</span><span>✓ Interface responsiva</span></div>
          <p className={styles.disclaimer}>Ambiente em desenvolvimento. A emissão fiscal real ainda não está disponível.</p>
        </section>
        <section className={styles.card} aria-label="Acesso à plataforma">
          <Link href="/" className={styles.back}>← Voltar ao site</Link>
          <h2>{mode==="login"?"Acesse sua conta":"Crie sua conta"}</h2>
          <p className={styles.description}>{mode==="login"?"Entre para continuar a gestão da sua empresa.":"Preencha seus dados para iniciar seu cadastro."}</p>
          {!ready && <p role="alert" className={styles.warning}>Configuração de autenticação indisponível neste ambiente. Verifique as variáveis públicas do Supabase.</p>}
          <form onSubmit={submit} className={styles.form}>
            <label>E-mail<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="voce@empresa.com.br" /></label>
            <label>Senha<input type="password" autoComplete={mode==="login"?"current-password":"new-password"} required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" /></label>
            <button type="submit" disabled={pending||!ready} className={styles.submit}>{pending?"Aguarde...":mode==="login"?"Entrar no sistema →":"Criar minha conta →"}</button>
          </form>
          {message && <p role="status" className={styles.message}>{message}</p>}
          <button type="button" className={styles.switch} onClick={()=>{setMode(mode==="login"?"signup":"login");setMessage("");}}>{mode==="login"?"Primeiro acesso? Criar conta":"Já tenho conta. Fazer login"}</button>
          <p className={styles.fiscal}>Ambiente piloto · Sem emissão fiscal real</p>
        </section>
      </div>
    </main>
  );
}
