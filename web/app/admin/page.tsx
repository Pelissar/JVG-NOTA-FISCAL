import { redirect } from "next/navigation";
import { getJvgUser } from "../jvg-auth";
import { getPlatformRole } from "../../lib/jvg-backend";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getJvgUser();
  if (!user) redirect("/login");

  // A verificacao usa banco e identidade confirmada. E-mail informado no navegador
  // ou metadados editaveis pelo usuario nunca concedem privilegios.
  const role = await getPlatformRole(user);
  if (role !== "platform_admin") redirect("/erp/index.html");

  return (
    <main style={{ minHeight: "100vh", background: "#f0f5f8", color: "#162a38", fontFamily: "system-ui,sans-serif", padding: "40px 18px" }}>
      <section style={{ maxWidth: 900, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div><p style={{ margin: 0, color: "#007c70", fontWeight: 700 }}>JVG NOTA FISCAL</p><h1 style={{ fontSize: 30, marginTop: 8 }}>Administração da plataforma</h1></div>
          <a href="/logout" style={{ color: "#006f68", fontWeight: 700 }}>Sair</a>
        </header>
        <section style={{ background: "white", borderRadius: 18, padding: 28, border: "1px solid #dce6eb", marginTop: 25 }}>
          <p style={{ marginTop: 0, color: "#267d69", fontWeight: 700 }}>Administrador verificado</p>
          <h2 style={{ fontSize: 21, marginBottom: 8 }}>Olá, {user.displayName}</h2>
          <p>Seu acesso de administrador geral foi confirmado pelo Supabase Auth e pelo cadastro de permissões do JVG.</p>
          <p style={{ background: "#edf5fa", borderRadius: 10, padding: 16, fontSize: 14 }}>
            O gerenciamento global de empresas, assinaturas e usuários será liberado nas próximas etapas. Nesta versão piloto, você tem acesso autenticado ao painel administrativo, mas ainda não pode consultar ou alterar dados fiscais das empresas clientes por esta tela.
          </p>
        </section>
      </section>
    </main>
  );
}
