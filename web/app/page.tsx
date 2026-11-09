import Image from "next/image";
import Link from "next/link";
import styles from "./landing-redesign.module.css";

const modules = [
  { number: "01", title: "Clientes e fornecedores", description: "Cadastros empresariais organizados para o dia a dia." },
  { number: "02", title: "Produtos e serviços", description: "Informações de catálogo, valores e dados necessários à operação." },
  { number: "03", title: "Estoque", description: "Consulte saldos e registre movimentações dos produtos." },
  { number: "04", title: "Orçamentos", description: "Prepare propostas comerciais e acompanhe seus registros." },
  { number: "05", title: "Pedidos e vendas", description: "Organize o fluxo comercial em um único ambiente." },
  { number: "06", title: "Preparação fiscal", description: "CFOP, perfis tributários e rascunhos de NF-e, ainda sem emissão real." },
];

export default function Home() {
  return <main className={styles.site}>
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Navegação principal">
        <Link href="/" aria-label="SigmaFiscal — início">
          <Image className={styles.logo} src="/branding/sigmafiscal-logo.svg" width={740} height={180} alt="SigmaFiscal ERP Empresarial" priority />
        </Link>
        <div className={styles.navlinks}><a href="#sistema">O sistema</a><a href="#modulos">Módulos</a><a href="#acesso">Começar</a></div>
        <Link href="/login" className={styles.login}>Acessar plataforma ↗</Link>
      </nav>
    </header>

    <section className={styles.hero} id="sistema">
      <div className={styles.heroInner}>
        <div>
          <span className={styles.eyebrow}>SigmaFiscal · ERP Empresarial</span>
          <h1>Seu negócio.<br/><em>Mais controle.</em><br/>Menos complicação.</h1>
          <p>Cadastros, estoque, orçamentos, pedidos e vendas em uma experiência moderna. Uma plataforma de gestão feita para acompanhar sua operação.</p>
          <div className={styles.actions}>
            <Link href="/login" className={styles.primary}>Acessar meu sistema →</Link>
            <a href="#modulos" className={styles.secondary}>Conhecer os módulos</a>
          </div>
          <div className={styles.points}><span>✓ Interface responsiva</span><span>✓ Dados da sua empresa</span><span>✓ Ambiente em evolução</span></div>
        </div>
        <div className={styles.visual}>
          <div className={styles.visualTop}><strong>SigmaFiscal / Painel de gestão</strong><span className={styles.dots}>● ● ●</span></div>
          <div className={styles.live}>
            <iframe src="/erp/index.html" title="Prévia da interface real do SigmaFiscal" loading="lazy" tabIndex={-1} aria-hidden="true" />
          </div>
          <div className={styles.visualBottom}><span>Prévia do ERP real · acesso aos dados exige autenticação</span><Link href="/login">Abrir sistema ↗</Link></div>
        </div>
      </div>
    </section>

    <section className={styles.section+" "+styles.light} id="modulos">
      <div className={styles.inner}>
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Módulos do SigmaFiscal</span><h2>O que você precisa, em um só lugar.</h2></div><p>Uma interface unificada para organizar o trabalho, com funções disponíveis conforme a configuração e a implantação da empresa.</p></div>
        <div className={styles.cards}>{modules.map((item)=><article className={styles.card} key={item.number}><span className={styles.number}>{item.number} / MÓDULO</span><h3>{item.title}</h3><p>{item.description}</p></article>)}</div>
      </div>
    </section>

    <section className={styles.section} id="acesso">
      <div className={styles.inner}>
        <span className={styles.eyebrow}>Seu espaço de trabalho</span>
        <div className={styles.sectionHead}><div><h2>Pronto para organizar sua empresa?</h2><p>Entre no ambiente do SigmaFiscal para acessar os cadastros e ferramentas de gestão.</p></div><Link href="/login" className={styles.primary}>Entrar na plataforma →</Link></div>
        <p className={styles.notice}>A emissão de documentos fiscais ainda está em desenvolvimento e depende de integração e homologação. O ambiente não transmite NF-e à SEFAZ.</p>
      </div>
    </section>
    <footer className={styles.footer}><div className={styles.footerInner}><span>© SigmaFiscal · ERP Empresarial</span><span>Gestão empresarial em desenvolvimento · Sem emissão fiscal real</span><Link href="/login">Acessar plataforma</Link></div></footer>
  </main>;
}
