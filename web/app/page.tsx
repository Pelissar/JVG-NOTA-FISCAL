import Link from "next/link";
import Image from "next/image";
import styles from "./landing.module.css";

const features = [
  { icon: "▦", step: "01", title: "Tudo organizado", text: "Produtos, clientes, serviços e informações fiscais em cadastros conectados." },
  { icon: "◫", step: "02", title: "Estoque sob controle", text: "Movimentações, saldos e custos para acompanhar a operação do negócio." },
  { icon: "◇", step: "03", title: "Preparado para notas", text: "Estrutura fiscal em preparação e testes de homologação antes da emissão real." },
  { icon: "⌘", step: "04", title: "Feito para crescer", text: "Plataforma web multiempresa, planejada para evoluir também para desktop." },
];

const models = [
  { name: "NF-e", number: "55", description: "Produtos e mercadorias" },
  { name: "NFC-e", number: "65", description: "Venda ao consumidor" },
  { name: "NFS-e", number: "Nacional", description: "Prestação de serviços" },
  { name: "CT-e", number: "57", description: "Transporte de cargas" },
  { name: "MDF-e", number: "58", description: "Manifesto eletrônico" },
];

export default function Home() {
  return <main className={styles.site}>
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Navegação principal">
        <Link href="/" className={styles.brand}><Image src="/branding/sigmafiscal-logo.svg" alt="SigmaFiscal ERP Empresarial" width={196} height={48} style={{width:"clamp(145px,16vw,196px)",height:"auto"}} /></Link>
        <div className={styles.navLinks}><a href="#solucao">A solução</a><a href="#modulos">Módulos</a><a href="#jornada">Como funciona</a></div>
        <Link href="/login" className={styles.loginLink}>Acessar plataforma <span>↗</span></Link>
      </nav>
    </header>

    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}><i /> UM NOVO JEITO DE GERIR SEU NEGÓCIO</span>
        <h1>Seu negócio no controle. <em>Do cadastro à nota fiscal.</em></h1>
        <p>O SigmaFiscal reúne gestão empresarial, estoque e documentos fiscais em uma experiência simples, moderna e preparada para acompanhar o crescimento da sua empresa.</p>
        <div className={styles.actions}><Link href="/login" className={styles.primaryButton}>Entrar no sistema <span>→</span></Link><a href="#solucao" className={styles.secondaryButton}>Conhecer a solução ↘</a></div>
        <div className={styles.assurance}><span>✓ Plataforma web responsiva</span><span>✓ Ambiente piloto em evolução</span></div>
      </div>
      <div className={styles.previewArea}>
        <div className={styles.preview} style={{overflow:"hidden",padding:0,aspectRatio:"16 / 10",minHeight:300,background:"#091a2b"}} aria-label="Visualização do painel real do SigmaFiscal">
          <iframe src="/erp/index.html" title="Visualização do sistema SigmaFiscal em funcionamento" loading="lazy" tabIndex={-1} style={{display:"block",width:"100%",height:"100%",border:0,pointerEvents:"none"}} />
          <span style={{position:"absolute",bottom:12,left:12,background:"#081b2ce8",color:"#dcefff",padding:"7px 12px",borderRadius:10,fontSize:12}}>Interface real do ERP · ambiente de testes</span>
        </div>
        <div className={styles.floatBadge}><span>✓</span><div><strong>Gestão integrada</strong><small>Acesso e dados organizados</small></div></div>
      </div>
    </section>

    <div className={styles.band}><span>UMA PLATAFORMA PARA EVOLUIR</span><strong>GESTÃO &nbsp; • &nbsp; ESTOQUE &nbsp; • &nbsp; FISCAL &nbsp; • &nbsp; MULTIEMPRESA</strong></div>

    <section className={styles.lightSection} id="solucao"><div className={styles.container}>
      <div className={styles.sectionIntro}><small className={styles.kicker}>A SOLUÇÃO</small><h2>Mais organização hoje.<br/><em>Mais possibilidades amanhã.</em></h2><p>Um ERP pensado para conectar dados operacionais e processos fiscais, sem complicar a rotina de quem utiliza.</p></div>
      <div className={styles.featureGrid}>{features.map(f=><article className={styles.feature} key={f.step}><div className={styles.featureHead}><span>{f.icon}</span><small>{f.step}</small></div><h3>{f.title}</h3><p>{f.text}</p></article>)}</div>
    </div></section>

    <section className={styles.darkSection} id="modulos"><div className={styles.container}>
      <div className={styles.modelsIntro}><div><small className={styles.kicker}>CENTRAL FISCAL</small><h2>Cinco modelos.<br/><em>Uma visão de futuro.</em></h2></div><p>A plataforma foi planejada para os principais documentos fiscais brasileiros. A emissão ainda depende da conclusão da integração e da homologação.</p></div>
      <div className={styles.models}>{models.map(m=><article key={m.name} className={styles.model}><div className={styles.modelTop}><span>↗</span><small>{m.number}</small></div><h3>{m.name}</h3><p>{m.description}</p><div>Integração planejada <span>○</span></div></article>)}</div>
    </div></section>

    <section className={styles.journey} id="jornada"><div className={styles.container}><div className={styles.journeyGrid}>
      <div><small className={styles.kicker}>COMO FUNCIONA</small><h2>Comece simples.<br/><em>Cresça com confiança.</em></h2><p>Nosso ambiente piloto permite organizar cadastros e preparar a configuração fiscal. Os demais recursos serão liberados após testes e validações.</p><Link href="/login" className={styles.primaryButton}>Acessar minha conta →</Link></div>
      <div className={styles.steps}><div><b>01</b><span><strong>Acesse sua conta</strong><small>Área de gestão protegida por autenticação.</small></span></div><div><b>02</b><span><strong>Configure sua empresa</strong><small>Cadastre produtos, clientes, serviços e dados fiscais.</small></span></div><div><b>03</b><span><strong>Prepare a operação fiscal</strong><small>Validação em homologação antes da emissão real.</small></span></div></div>
    </div></div></section>

    <footer className={styles.footer}><div className={styles.container}><div className={styles.footerMain}><div><strong>JVG<span>.</span> NOTA FISCAL</strong><p>Gestão inteligente para negócios reais.</p></div><div><Link href="/login">Entrar</Link><a href="#solucao">Solução</a><a href="#modulos">Módulos</a></div></div><small>© 2026 JVG Nota Fiscal · Plataforma em fase piloto. A emissão fiscal real ainda não está habilitada.</small></div></footer>
  </main>;
}
