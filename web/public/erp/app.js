(function () {
  'use strict';
  var labels = {dashboard:'Visão geral',products:'Produtos',clients:'Clientes',services:'Serviços',fiscal:'Central fiscal',inventory:'Estoque',reports:'Relatórios',profile:'Meu perfil',settings:'Empresa e sistema'};
  // Nunca mostrar dados locais como se fossem cadastros reais da empresa.
  var state = emptyState();
  var view = 'dashboard', query = '', filter = 'all', partyFilter = 'all';
  var cloud = {status:'checking',displayName:'',company:null};
  var profileData = {displayName:'',email:''};
  var logoCompanyId = '';
  var content = document.getElementById('content');
  var modalRoot = document.getElementById('modalRoot');
  var toastRoot = document.getElementById('toastRoot');
  function emptyState(){return {products:[],clients:[],services:[],movements:[],companyName:'Minha empresa'};}
  function h(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function ico(name){return '<svg aria-hidden="true"><use href="#i-'+name+'"></use></svg>';}
  function money(n){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);}
  function num(n){return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(n)||0);}
  function dateStr(d){return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(d));}
  function badge(active){return '<span class="badge '+(active?'green':'gray')+'">'+(active?'Ativo':'Inativo')+'</span>';}
  function btn(text,action,primary){return '<button class="btn '+(primary?'primary':'')+'" data-action="'+h(action)+'">'+(primary?ico('plus'):'')+h(text)+'</button>';}
  function heading(title,subtitle,action,actionText){return '<div class="page-heading"><div><div class="eyebrow">JVG NOTA FISCAL / PAINEL DE GESTÃO</div><h1>'+h(title)+'</h1><p>'+h(subtitle)+'</p></div>'+(action?'<div class="heading-actions">'+btn(actionText,action,true)+'</div>':'')+'</div>';}
  function banner(){
    var ready=cloud.status==='ready',needs=cloud.status==='needs_company',pending=cloud.status==='waiting_secret',login=cloud.status==='login_required';
    var title=ready?'Supabase conectado · '+h(state.companyName):needs?'Cadastro da empresa piloto pendente':pending?'Integração segura preparada · chave privada pendente':login?'Login necessário no site publicado':cloud.status==='error'?'Servidor temporariamente indisponível':'Verificando integração do Supabase';
    var detail=ready?'Os cadastros desta empresa são salvos no servidor. A emissão de notas continua bloqueada até a homologação fiscal.':needs?'Sua conta já está identificada. Cadastre o nome da empresa para criar o ambiente isolado no banco.':pending?'Falta configurar a chave privada do banco no servidor. Não serão exibidos nem salvos cadastros enquanto a conexão estiver indisponível.':login?'Faça login no site publicado para acessar os cadastros da sua empresa.':cloud.status==='error'?'A conexão não pôde ser validada. Nenhum cadastro de exemplo será exibido; tente novamente.':'Aguarde a verificação. Os cadastros serão carregados diretamente do banco.';
    var action=needs?'<div class="heading-actions" style="margin-top:10px"><button class="btn primary" data-action="configure-company">'+ico('plus')+' Cadastrar empresa</button></div>':pending?'<div class="heading-actions" style="margin-top:10px"><button class="btn" data-view="settings">Ver configuração</button></div>':cloud.status==='error'?'<div class="heading-actions" style="margin-top:10px"><button class="btn" data-action="check-connection">Tentar novamente</button></div>':'';
    return '<div class="banner" style="border-color:'+(ready?'#76bb9c':'#d5deea')+'"><span class="banner-icon">'+ico('shield')+'</span><div class="banner-text"><strong>'+title+'</strong><p>'+detail+'</p>'+action+'</div></div>';
  }
  function stat(label,value,icon,color,foot){return '<article class="stat-card"><div class="stat-top"><span>'+h(label)+'</span><div class="stat-icon '+(color||'')+'">'+ico(icon)+'</div></div><div class="stat-value">'+h(value)+'</div><div class="stat-foot">'+h(foot)+'</div></article>';}
  function tableShell(searchPlaceholder,body,count,type){return '<section class="table-panel"><div class="table-toolbar"><label class="toolbar-search">'+ico('search')+'<input data-search-input placeholder="'+h(searchPlaceholder)+'" value="'+h(query)+'" aria-label="Filtrar registros"></label><div class="toolbar-controls"><select class="filter-select" data-filter aria-label="Filtrar situação"><option value="all" '+(filter==='all'?'selected':'')+'>Todos os status</option><option value="active" '+(filter==='active'?'selected':'')+'>Ativos</option><option value="inactive" '+(filter==='inactive'?'selected':'')+'>Inativos</option></select><button class="btn ghost" data-action="export-'+type+'">'+ico('download')+' Exportar CSV</button></div></div>'+body+'<div class="table-summary"><span>'+count+' registro(s) exibido(s)</span><span>'+(cloud.status==='ready'?'Dados reais · Empresa isolada':'Aguardando conexão · Sem dados de exemplo')+'</span></div></section>';}
  function empty(icon,title,detail,action,actionText){return '<div class="empty-state"><div class="empty-icon">'+ico(icon)+'</div><h3>'+h(title)+'</h3><p>'+h(detail)+'</p>'+(action?btn(actionText,action,true):'')+'</div>';}
  function rowActions(kind,recordId){return '<div class="table-actions"><button class="icon-btn" title="Editar" data-action="edit-'+kind+'" data-id="'+h(recordId)+'">'+ico('edit')+'</button><button class="icon-btn" title="Excluir" data-action="remove-'+kind+'" data-id="'+h(recordId)+'">'+ico('trash')+'</button></div>';}
  function matches(row,keys){var hay=keys.map(function(k){return String(row[k]||'');}).join(' ').toLowerCase();return hay.indexOf(query.toLowerCase())!==-1 &&(filter==='all'||(filter==='active'?row.active:!row.active));}
  function dashboard(){
    var totalStock=state.products.reduce(function(s,p){return s+Number(p.stock||0);},0);
    var low=state.products.filter(function(p){return p.active&&Number(p.stock)<=10;}).length;
    var valuation=state.products.reduce(function(s,p){return s+Number(p.stock||0)*Number(p.cost||0);},0);
    var recent=[].concat(state.movements.map(function(m){return {title:'Estoque '+(m.delta>0?'adicionado: ':'reduzido: ')+(state.products.find(function(p){return p.id===m.productId;})||{}).name,at:m.at,icon:'warehouse'};})).sort(function(a,b){return new Date(b.at)-new Date(a.at);}).slice(0,4);
    var quick=[['Novo orçamento','Preparar proposta comercial','receipt','/erp/quotes.html'],['Ver pedidos','Acompanhar pedidos','layers','/erp/orders.html'],['Registrar venda','Confirmar operação comercial','cash','/erp/sales.html'],['Abrir ordem de serviço','Receber equipamento para manutenção','layers','/erp/service-orders.html'],['Rascunhos NF-e','Preparação fiscal sem emissão','receipt','/erp/nfe-drafts.html']];
    return heading('Seu negócio, em um só lugar.','Acesse as operações mais importantes e acompanhe os dados da empresa.')+banner()+
      '<div class="stats-grid">'+stat('Produtos cadastrados',state.products.length,'box','','Itens no catálogo')+stat('Clientes cadastrados',state.clients.length,'users','blue','Pessoas e empresas')+stat('Unidades em estoque',num(totalStock),'warehouse','purple',low+' produto(s) com estoque baixo')+stat('Valor de custo em estoque',money(valuation),'cash','amber','Estimativa dos itens cadastrados')+'</div>'+
      '<div class="panel-grid"><section class="panel"><div class="panel-head"><div><h2>Comece por aqui</h2><p>Atalhos para as operações do dia a dia</p></div></div><div class="panel-body"><div class="quick-grid">'+quick.map(function(x){return '<a class="quick-card" href="'+x[3]+'"><span class="quick-icon">'+ico(x[2])+'</span><strong>'+x[0]+'</strong><small>'+x[1]+'</small></a>';}).join('')+'</div></div></section>'+
      '<section class="panel"><div class="panel-head"><div><h2>Atividades recentes</h2><p>Movimentações registradas no banco</p></div><button data-view="inventory">Ver estoque</button></div><div class="panel-body"><div class="timeline">'+(recent.length?recent.map(function(x){return '<div class="timeline-row"><span class="timeline-dot">'+ico(x.icon)+'</span><div class="timeline-info"><strong>'+h(x.title)+'</strong><small>'+dateStr(x.at)+'</small></div></div>';}).join(''):'<div class="empty-mini">Nenhuma movimentação registrada ainda. Cadastre ou ajuste itens para começar.</div>')+'</div></div></section></div>';
  }
  function products(){
    var rows=state.products.filter(function(p){return matches(p,['sku','name','category','ncm','gtin']);});
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Produto / Descrição</th><th>SKU</th><th>Categoria</th><th>NCM</th><th>CFOP sugerido</th><th>Estoque</th><th>Preço venda</th><th>Status</th><th class="text-right">Ações</th></tr></thead><tbody>'+rows.map(function(p){return '<tr><td><strong>'+h(p.name)+'</strong><div class="subcell">'+h(p.unit)+' · '+h(p.gtin||'SEM GTIN')+'</div></td><td class="mono">'+h(p.sku)+'</td><td>'+h(p.category||'—')+'</td><td class="mono">'+h(p.ncm||'—')+'</td><td class="mono">'+h(p.defaultCfop||'—')+'</td><td><strong>'+num(p.stock)+'</strong> '+(Number(p.stock)<=10?'<span class="badge amber">Baixo</span>':'')+'</td><td class="inline-price">'+money(p.price)+'</td><td>'+badge(p.active)+'</td><td>'+rowActions('product',p.id)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('box','Nenhum produto encontrado','Cadastre o primeiro produto da sua empresa.','new-product','Novo produto');
    return heading('Cadastro de produtos','Organize SKU, descrição, preços, estoque e informações fiscais.','new-product','Novo produto')+banner()+tableShell('Buscar por nome, SKU ou NCM...',body,rows.length,'products');
  }
  function clients(){
    var roleMatches=function(p){return partyFilter==='all'||(partyFilter==='customer'&&p.isCustomer)||(partyFilter==='supplier'&&p.isSupplier)||(partyFilter==='carrier'&&p.isCarrier);};
    var rows=state.clients.filter(function(p){return matches(p,['registrationNumber','name','legalName','document','email','city','stateRegistration','municipalRegistration'])&&roleMatches(p);});
    var roleLabels=function(p){return [p.isCustomer?'Cliente':'',p.isSupplier?'Fornecedor':'',p.isCarrier?'Transportadora':''].filter(Boolean);};
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Nº cadastro</th><th>Nome / Razão social</th><th>Tipo de relacionamento</th><th>CPF / CNPJ</th><th>IE / IM</th><th>Cidade / UF</th><th>Status</th><th class="text-right">Ações</th></tr></thead><tbody>'+rows.map(function(p){return '<tr><td class="mono"><strong>'+h(p.registrationNumber||'—')+'</strong></td><td><strong>'+h(p.name)+'</strong>'+(p.legalName&&p.legalName!==p.name?'<div class="subcell">'+h(p.legalName)+'</div>':'')+'</td><td>'+roleLabels(p).map(function(x){return '<span class="badge blue">'+h(x)+'</span> ';}).join('')+'</td><td class="mono">'+h(p.document||'Não informado')+'</td><td><div class="mono">IE: '+h(p.stateRegistration||'—')+'</div><div class="mono">IM: '+h(p.municipalRegistration||'—')+'</div></td><td>'+h(p.city||'—')+' / '+h(p.state||'—')+'</td><td>'+badge(p.active)+'</td><td>'+rowActions('client',p.id)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('users','Nenhum cadastro encontrado','Ajuste o filtro ou cadastre um cliente, fornecedor ou transportadora.','new-client','Novo cadastro');
    var total=state.clients.length,customers=state.clients.filter(function(p){return p.isCustomer;}).length,suppliers=state.clients.filter(function(p){return p.isSupplier;}).length,carriers=state.clients.filter(function(p){return p.isCarrier;}).length;
    var roleFilter='<div class="party-filter-row"><label>Tipo de cadastro <select class="filter-select" id="partyTypeFilter"><option value="all" '+(partyFilter==='all'?'selected':'')+'>Todos ('+total+')</option><option value="customer" '+(partyFilter==='customer'?'selected':'')+'>Clientes ('+customers+')</option><option value="supplier" '+(partyFilter==='supplier'?'selected':'')+'>Fornecedores ('+suppliers+')</option><option value="carrier" '+(partyFilter==='carrier'?'selected':'')+'>Transportadoras ('+carriers+')</option></select></label><span class="small-note">Exibindo '+rows.length+' de '+total+' cadastro(s)</span></div>';
    return heading('Cadastro de pessoas e empresas','Cadastre clientes, fornecedores e transportadoras em um único registro, com identificação fiscal completa.','new-client','Novo cadastro')+banner()+roleFilter+tableShell('Buscar por número, nome, documento, IE ou IM...',body,rows.length,'clients');
  }
  function services(){
    var rows=state.services.filter(function(p){return matches(p,['code','name','description','lc116','nbs']);});
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Serviço</th><th>Código</th><th>LC 116</th><th>NBS</th><th>Valor</th><th>Status</th><th class="text-right">Ações</th></tr></thead><tbody>'+rows.map(function(p){return '<tr><td><strong>'+h(p.name)+'</strong><div class="subcell">'+h((p.description||'').slice(0,65))+'</div></td><td class="mono">'+h(p.code)+'</td><td class="mono">'+h(p.lc116||'A configurar')+'</td><td class="mono">'+h(p.nbs||'—')+'</td><td class="inline-price">'+money(p.price)+'</td><td>'+badge(p.active)+'</td><td>'+rowActions('service',p.id)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('layers','Nenhum serviço encontrado','Crie seus serviços para preparar a futura NFS-e.','new-service','Novo serviço');
    return heading('Cadastro de serviços','Organize sua prestação e prepare os códigos fiscais da NFS-e.','new-service','Novo serviço')+banner()+tableShell('Buscar serviço, código ou NBS...',body,rows.length,'services');
  }
  function inventory(){
    var rows=state.products.filter(function(p){return matches(p,['sku','name','category']);});
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Produto</th><th>SKU</th><th>Saldo</th><th>Custo un.</th><th>Valor de custo</th><th>Situação</th><th class="text-right">Ação</th></tr></thead><tbody>'+rows.map(function(p){var low=Number(p.stock)<=10;return '<tr><td><strong>'+h(p.name)+'</strong></td><td class="mono">'+h(p.sku)+'</td><td><strong>'+num(p.stock)+'</strong> '+h(p.unit)+'</td><td>'+money(p.cost)+'</td><td class="inline-price">'+money(Number(p.stock)*Number(p.cost))+'</td><td><span class="badge '+(low?'amber':'green')+'">'+(low?'Estoque baixo':'Disponível')+'</span></td><td><div class="table-actions"><button class="btn sm" data-action="adjust-stock" data-id="'+h(p.id)+'">Ajustar saldo</button></div></td></tr>';}).join('')+'</tbody></table></div>':empty('warehouse','Sem produtos em estoque','Cadastre produtos para fazer ajustes locais.','new-product','Cadastrar produto');
    return heading('Controle de estoque','Visualize saldos e registre ajustes reais da sua empresa.','new-product','Cadastrar produto')+banner()+tableShell('Buscar SKU ou descrição...',body,rows.length,'products');
  }
  function fiscal(){
    var models=[['NF-e','Modelo 55','Venda de mercadorias e operações fiscais','receipt'],['NFC-e','Modelo 65','Venda ao consumidor e frente de caixa','cash'],['NFS-e','Padrão Nacional','Prestação de serviços / DPS','layers'],['CT-e','Modelo 57','Conhecimento de transporte eletrônico','truck'],['MDF-e','Modelo 58','Manifesto eletrônico de documentos','warehouse']];
    return heading('Central de notas fiscais','Os cinco modelos já estão previstos na navegação do JVG.')+banner()+
      '<section class="panel" style="margin-bottom:22px"><div class="panel-head"><div><h2>Entrada de NF-e · XML</h2><p>Receba documentos de fornecedores e confira produtos antes de movimentar estoque</p></div><a class="btn" href="/erp/inbound-nfe.html">Abrir notas de entrada →</a></div><div class="panel-body"><p class="small-note">Entrada e estoque não substituem escrituração fiscal; PDF/DANFE serve para conferência manual.</p></div></section><section class="panel" style="margin-bottom:22px"><div class="panel-head"><div><h2>NF-e · Rascunhos em homologação</h2><p>Primeira etapa do fluxo fiscal: preparar e salvar notas sem transmitir à SEFAZ</p></div><a class="btn primary" href="/erp/nfe-drafts.html">Abrir rascunhos NF-e →</a></div><div class="panel-body"><p class="small-note">Selecione destinatários e produtos cadastrados. Os campos fiscais e tributos precisam de revisão do contador antes da futura integração de emissão.</p></div></section>'+
      '<section class="panel" style="margin-bottom:22px"><div class="panel-head"><div><h2>Perfis tributários</h2><p>Cadastre e revise as regras fiscais da empresa para a futura NF-e</p></div><a class="btn primary" href="/erp/tax-profiles.html">Abrir perfis fiscais →</a></div></section>'+ 
      '<section class="panel" style="margin-bottom:22px"><div class="panel-head"><div><h2>Tabela nacional de CFOP</h2><p>619 códigos com títulos e descrições oficiais; personalize o nome usado pela empresa</p></div><a class="btn primary" href="/erp/cfop.html">Consultar CFOP →</a></div></section>'+
      '<div class="fiscal-grid">'+models.map(function(x){return '<article class="fiscal-card"><div class="fiscal-card-top"><div class="fiscal-icon">'+ico(x[3])+'</div><span class="badge amber">Em preparação</span></div><h3>'+x[0]+' <span class="muted" style="font-weight:400;font-size:10px">'+x[1]+'</span></h3><p>'+x[2]+'. A transmissão real será habilitada após validação fiscal e homologação do emissor.</p><div class="fiscal-bottom"><span>Credenciamento fiscal em andamento</span><span>'+ico('clock')+'</span></div></article>';}).join('')+'</div>'+
      '<div class="section-row"><h2 class="section-title">Próximas configurações fiscais</h2></div><div class="setup-steps"><article class="setup-step"><span class="step-count">01 / DADOS</span><strong>Empresa e regime</strong><p>CNPJ real, inscrições, endereço, regime tributário e responsável fiscal.</p></article><article class="setup-step"><span class="step-count">02 / CERTIFICADO</span><strong>Certificado A1 e integração fiscal</strong><p>Cadastro seguro do emitente, credenciais por ambiente e CSC quando aplicável.</p></article><article class="setup-step"><span class="step-count">03 / HOMOLOGAÇÃO</span><strong>Regras e testes</strong><p>Conferência com contador e autorização de casos reais em ambiente de homologação.</p></article></div>';
  }
  function simpleSoon(title,subtitle,icon,features){
    return heading(title,subtitle)+banner()+'<section class="panel wide-info"><div class="panel-body">'+empty(icon,'Módulo preparado para as próximas etapas','A navegação e a arquitetura deste módulo estão previstas. Ainda não há operação real nesta primeira versão.')+'<div class="info-list">'+features.map(function(x){return '<div class="info-row"><span>'+h(x[0])+'</span><strong>'+h(x[1])+'</strong></div>';}).join('')+'</div></div></section>';
  }
  function reports(){
    var stockValue=state.products.reduce(function(sum,p){return sum+Number(p.stock)*Number(p.cost);},0);
    var saleValue=state.products.reduce(function(sum,p){return sum+Number(p.stock)*Number(p.price);},0);
    return heading('Relatórios','Indicadores básicos dos seus cadastros locais.')+banner()+
      '<div class="stats-grid">'+stat('Itens de produto',state.products.length,'box','','Total cadastrado')+stat('Serviços cadastrados',state.services.length,'layers','blue','No catálogo')+stat('Custo do estoque',money(stockValue),'cash','amber','Valor estimado')+stat('Preço de estoque',money(saleValue),'chart','purple','Potencial de venda teórico')+'</div>'+
      '<section class="panel"><div class="panel-head"><div><h2>Exportar cadastros</h2><p>Planilhas CSV dos registros da empresa</p></div></div><div class="panel-body"><div class="heading-actions"><button class="btn" data-action="export-products">'+ico('download')+' Produtos</button><button class="btn" data-action="export-clients">'+ico('download')+' Clientes</button><button class="btn" data-action="export-services">'+ico('download')+' Serviços</button></div><p class="small-note" style="margin-top:18px">Relatórios financeiros, fiscais e contábeis ficam para as etapas integradas ao servidor.</p></div></section>';
  }
  function settings(){
    var ready=cloud.status==='ready';
    var missing=ready&&cloud.company&&Array.isArray(cloud.company.fiscal_missing)?cloud.company.fiscal_missing:[];
    var items=[['Usuário identificado',cloud.displayName||'Aguardando verificação'],['Empresa',state.companyName||'Aguardando empresa'],['Banco de dados',ready?'Supabase conectado':cloud.status==='needs_company'?'Aguardando cadastro da empresa':'Aguardando conexão'],['Dados dos cadastros',ready?'Persistidos no Supabase':'Nenhum dado local exibido'],['Regime da empresa piloto','Simples Nacional'],['Cadastro fiscal',ready?(missing.length?missing.length+' informação(ões) pendente(s)':'Dados preenchidos · revisão fiscal necessária'):'Aguardando empresa'],['Integração fiscal','Homologação em preparação'],['Certificado A1','Credenciamento fiscal a validar'],['Emissão oficial','Bloqueada até habilitação fiscal']];
    var action=ready?'<button class="btn primary" data-action="configure-company">'+ico('edit')+' Editar empresa</button>':cloud.status==='needs_company'?'<button class="btn primary" data-action="configure-company">'+ico('plus')+' Cadastrar empresa piloto</button>':'<button class="btn" data-action="check-connection">'+ico('check')+' Verificar conexão</button>';
    return heading('Configurações','Sua conta, empresa piloto e configurações fiscais seguras.')+banner()+
      '<div class="settings-grid"><section class="panel wide-info"><div class="panel-head"><div><h2>Cadastro fiscal do emitente</h2><p>Dados da empresa para preparar a NF-e em homologação</p></div></div><div class="panel-body"><div class="info-list">'+items.map(function(x){return '<div class="info-row"><span>'+h(x[0])+'</span><strong>'+h(x[1])+'</strong></div>';}).join('')+'</div>'+
      (ready&&missing.length?'<p class="small-note" style="margin-top:16px">Preencha: '+missing.map(h).join(', ')+'.</p>':ready?'<p class="small-note" style="margin-top:16px">Dados preenchidos. Ainda é obrigatória a conferência com o contador e a validação do credenciamento fiscal antes de emitir.</p>':'')+
      '<div class="heading-actions" style="margin-top:24px">'+action+'<button class="btn" data-action="logout">Sair da conta</button></div>'+
      '<p class="small-note" style="margin-top:16px">Credenciais de autorização fiscal e certificado A1 não são solicitados nesta página. Os segredos técnicos devem ser configurados apenas no servidor privado.</p></div></section></div>';
  }
  function profile(){
    return heading('Meu perfil','Atualize seus dados de acesso e a identidade visual da empresa.')+
      '<div class="profile-grid">'+
      '<section class="panel"><div class="panel-head"><div><h2>Dados da conta</h2><p>Seu nome e e-mail de acesso ao sistema.</p></div></div><div class="panel-body"><form id="profileForm" class="profile-form">'+
      field('displayName','Como devemos chamar você',profileData.displayName,'required maxlength="80" autocomplete="name"',true)+
      field('profileEmail','E-mail de acesso',profileData.email,'type="email" required maxlength="254" autocomplete="email"',true)+
      '<div class="profile-form-actions"><button class="btn primary" type="submit">Salvar dados da conta</button></div><p class="small-note">Para confirmar a troca, siga as mensagens de verificação enviadas pelo sistema aos endereços envolvidos.</p></form></div></section>'+
      '<section class="panel"><div class="panel-head"><div><h2>Segurança</h2><p>Defina uma nova senha para sua conta.</p></div></div><div class="panel-body"><form id="passwordForm" class="profile-form">'+
      field('currentPassword','Senha atual','', 'type="password" required minlength="1" maxlength="128" autocomplete="current-password"',true)+
      field('newPassword','Nova senha','', 'type="password" required minlength="12" maxlength="128" autocomplete="new-password"',true)+
      field('confirmPassword','Confirme a nova senha','', 'type="password" required minlength="12" maxlength="128" autocomplete="new-password"',true)+
      '<div class="profile-form-actions"><button class="btn primary" type="submit">Atualizar senha</button></div><p class="small-note">Use pelo menos 12 caracteres. Não reutilize uma senha de outro serviço.</p></form></div></section>'+
      '<section class="panel profile-logo-panel"><div class="panel-head"><div><h2>Logo da empresa</h2><p>Ela aparece junto à empresa ativa no painel.</p></div></div><div class="panel-body"><form id="logoForm" class="profile-logo-form"><div class="profile-logo-preview"><img id="profileLogoPreview" alt="Prévia da logo da empresa" hidden><span id="profileLogoFallback">SF</span></div><div class="profile-logo-fields"><label class="field"><span>Escolha uma imagem PNG, JPEG ou WebP</span><input id="companyLogoFile" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required></label><small>Até 2 MB. A imagem ficará pública para exibição da marca; os dados da empresa continuam privados.</small><button class="btn primary" type="submit">Enviar logo da empresa</button></div></form></div></section></div>';
  }
  async function loadProfile(){
    try{
      var data=await callApi('/api/profile');
      profileData={displayName:data.displayName||'',email:data.email||''};
      var name=document.getElementById('f-displayName'),email=document.getElementById('f-profileEmail');
      if(name)name.value=profileData.displayName;if(email)email.value=profileData.email;
      var preview=document.getElementById('profileLogoPreview'),fallback=document.getElementById('profileLogoFallback');
      if(preview){preview.onload=function(){preview.hidden=false;if(fallback)fallback.hidden=true;};preview.onerror=function(){preview.hidden=true;if(fallback)fallback.hidden=false;};preview.src='/api/company/logo?v='+Date.now();}
    }catch(error){toast(error.message,'error');}
  }
  async function saveProfile(form){
    var values=Object.fromEntries(new FormData(form).entries()),button=form.querySelector('button[type="submit"]');
    if(button)button.disabled=true;
    try{
      var result=await callApi('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:values.displayName,email:values.profileEmail})});
      profileData={displayName:result.displayName||values.displayName,email:result.email||values.profileEmail};
      cloud.displayName=profileData.displayName;
      if(result.emailChangePending)toast('Dados salvos. Confirme o novo e-mail pelo link enviado.');else toast('Dados da conta atualizados.');
      render();
    }catch(error){toast(error.message,'error');}
    finally{if(button)button.disabled=false;}
  }
  async function savePassword(form){
    var values=Object.fromEntries(new FormData(form).entries()),button=form.querySelector('button[type="submit"]');
    if(values.newPassword!==values.confirmPassword){toast('As senhas informadas não coincidem.','error');return;}
    if(button)button.disabled=true;
    try{await callApi('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:values.newPassword,currentPassword:values.currentPassword})});form.reset();toast('Senha atualizada com segurança.');}
    catch(error){toast(error.message,'error');}
    finally{if(button)button.disabled=false;}
  }
  async function uploadCompanyLogo(form){
    var button=form.querySelector('button[type="submit"]'),file=form.elements.namedItem('logo');
    if(!file||!file.files||!file.files[0]){toast('Escolha uma imagem para enviar.','error');return;}
    if(button){button.disabled=true;button.textContent='Enviando...';}
    try{
      var data=new FormData();data.append('logo',file.files[0]);
      await callApi('/api/company/logo',{method:'POST',body:data});
      var preview=document.getElementById('profileLogoPreview'),fallback=document.getElementById('profileLogoFallback');
      if(preview){preview.onload=function(){preview.hidden=false;if(fallback)fallback.hidden=true;};preview.src='/api/company/logo?v='+Date.now();}
      var avatar=document.getElementById('workspaceAvatar');if(avatar){avatar.classList.remove('has-logo');var logo=document.getElementById('workspaceLogo');if(logo){logo.onload=function(){avatar.classList.add('has-logo');};logo.src='/api/company/logo?v='+Date.now();}}
      form.reset();toast('Logo da empresa atualizada.');
    }catch(error){toast(error.message,'error');}
    finally{if(button){button.disabled=false;button.textContent='Enviar logo da empresa';}}
  }
  function render(){
    document.getElementById('breadcrumb').textContent=labels[view]||labels.dashboard;
    var companyTitle=document.getElementById('workspaceName');if(companyTitle)companyTitle.textContent=state.companyName;
    var initials=document.getElementById('workspaceInitials'),avatar=document.getElementById('workspaceAvatar'),logo=document.getElementById('workspaceLogo');
    if(initials){var parts=String(state.companyName||'Minha empresa').trim().split(/\s+/).filter(Boolean);initials.textContent=(parts.length>1?parts[0][0]+parts[1][0]:parts[0].slice(0,2)).toUpperCase();}
    var accountBadge=document.getElementById('profileShortcut');if(accountBadge){var displayName=String(cloud.displayName||'SF').trim(),userParts=displayName.split(/\s+/).filter(Boolean);accountBadge.textContent=(userParts.length>1?userParts[0][0]+userParts[1][0]:userParts[0].slice(0,2)).toUpperCase();accountBadge.setAttribute('aria-label','Abrir perfil de '+displayName);accountBadge.title='Meu perfil: '+displayName;}
    var companyId=cloud.company&&cloud.company.id?String(cloud.company.id):'';
    if(logo&&companyId!==logoCompanyId){logoCompanyId=companyId;if(avatar)avatar.classList.remove('has-logo');logo.onload=function(){if(avatar)avatar.classList.add('has-logo');};logo.onerror=function(){if(avatar)avatar.classList.remove('has-logo');};logo.src=companyId?'/api/company/logo?v='+encodeURIComponent(companyId):'';}
    document.querySelectorAll('.sidebar .nav-link').forEach(function(b){var active=b.dataset.view===view;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    var views={dashboard:dashboard,products:products,clients:clients,services:services,fiscal:fiscal,inventory:inventory,reports:reports,profile:profile,settings:settings};
    content.innerHTML=(views[view]||dashboard)();
    var search=document.getElementById('globalSearch');search.value=query;
    if(view==='profile')loadProfile();
  }
  function setView(next){if(!labels[next])return;view=next;query='';filter='all';if(window.location.hash!=='#'+next)history.pushState(null,'','#'+next);document.getElementById('sidebar').classList.remove('open');document.getElementById('mobileBackdrop').classList.remove('active');document.getElementById('menuBtn').setAttribute('aria-expanded','false');render();document.querySelector('.main-column').scrollTop=0;}
  function field(name,label,value,extra,full,help){return '<div class="field '+(full?'full':'')+'"><label for="f-'+h(name)+'">'+h(label)+'</label><input id="f-'+h(name)+'" name="'+h(name)+'" value="'+h(value==null?'':value)+'" '+(extra||'')+'>'+(help?'<small>'+h(help)+'</small>':'')+'</div>';}
  function lookupField(name,label,value,extra,kind,full){return '<div class="field '+(full?'full':'')+'"><label for="f-'+h(name)+'">'+h(label)+'</label><div class="input-action"><input id="f-'+h(name)+'" name="'+h(name)+'" value="'+h(value==null?'':value)+'" '+extra+'><button class="btn ghost lookup-btn" type="button" data-action="lookup-'+kind+'">Consultar</button></div></div>';}
  function select(name,label,options,value,required){return '<div class="field"><label for="f-'+h(name)+'">'+h(label)+(required?' *':'')+'</label><select id="f-'+h(name)+'" name="'+h(name)+'" '+(required?'required':'')+'>'+options.map(function(o){return '<option value="'+h(o[0])+'" '+(String(value)===String(o[0])?'selected':'')+'>'+h(o[1])+'</option>';}).join('')+'</select>'+(name==='origin'?'<small class="field-help">Necessária para NF-e. Informe a origem real do item com a contabilidade.</small>':'')+'</div>';}
  function productForm(p){return field('sku','Código interno (SKU) *',p.sku,'required maxlength="40"',false)+field('name','Descrição do produto *',p.name,'required maxlength="160"',false)+field('category','Categoria',p.category,'maxlength="80"',false)+select('unit','Unidade',[['UN','Unidade (UN)'],['KG','Quilograma (KG)'],['M','Metro (M)'],['L','Litro (L)'],['CX','Caixa (CX)'],['PAR','Par (PAR)'],['PCT','Pacote (PCT)']],p.unit||'UN',true)+field('ncm','NCM',p.ncm,'inputmode="numeric" maxlength="8" pattern="[0-9]{8}"',false,'8 dígitos; confira com seu contador.')+field('cest','CEST (quando aplicável)',p.cest,'maxlength="12"',false)+field('defaultCfop','CFOP sugerido (opcional)',p.defaultCfop,'maxlength="4" inputmode="numeric" pattern="[0-9]{4}" list="productCfopOptions"',false,'Sugestão para rascunhos: depende da operação, UF e regime. Consulte seu contador.')+select('taxProfileId','Perfil tributário (NF-e)',[['','Nenhum perfil selecionado']],p.taxProfileId||'')+field('gtin','EAN / GTIN',p.gtin||'SEM GTIN','maxlength="14"',false,'Informe SEM GTIN quando não houver código.')+select('origin','Origem da mercadoria',[['','Selecione para NF-e'],['0','0 · Nacional'],['1','1 · Estrangeira direta'],['2','2 · Estrangeira mercado interno'],['3','3 · Nacional > 40% importação'],['4','4 · Nacional processos básicos'],['5','5 · Nacional ≤ 40% importação'],['6','6 · Estrangeira sem similar'],['7','7 · Estrangeira mercado interno sem similar'],['8','8 · Nacional > 70% importação']],p.origin||'')+field('cost','Preço de custo (R$)',p.cost,'type="number" min="0" step="0.01"',false)+field('price','Preço de venda (R$) *',p.price,'required type="number" min="0" step="0.01"',false)+field('stock','Saldo inicial',p.stock,'type="number" min="0" step="0.001"',false)+select('active','Situação',[['true','Ativo'],['false','Inativo']],p.active!==false?'true':'false');}
  function clientForm(p){return '<div class="field full"><strong>Classificação do cadastro *</strong><small>Uma pessoa pode exercer mais de uma função.</small><div class="party-role-options">'+[['isCustomer','Cliente',p.isCustomer!==false],['isSupplier','Fornecedor',!!p.isSupplier],['isCarrier','Transportadora',!!p.isCarrier]].map(function(x){return '<label class="party-role-option"><input type="checkbox" name="'+x[0]+'" value="true" '+(x[2]?'checked':'')+'><span>'+x[1]+'</span></label>';}).join('')+'</div></div>'+
    field('name','Nome / nome fantasia *',p.name,'required maxlength="160"',true)+
    field('legalName','Razão social',p.legalName,'maxlength="180"',true)+
    select('type','Tipo de pessoa',[['PJ','Pessoa jurídica'],['PF','Pessoa física'],['EXT','Estrangeiro']],p.type||'PJ',true)+
    lookupField('document','CPF / CNPJ (consulta para PJ)',p.document,'maxlength="18"','cnpj',false)+
    field('stateRegistration','Inscrição Estadual (IE)',p.stateRegistration,'maxlength="40"',false)+
    field('municipalRegistration','Inscrição Municipal (IM)',p.municipalRegistration,'maxlength="40"',false)+
    field('email','E-mail',p.email,'type="email" maxlength="160"',false)+
    field('phone','Telefone / WhatsApp',p.phone,'maxlength="25"',false)+
    '<div class="field full"><strong>Endereço do cadastro</strong></div>'+
    lookupField('postalCode','CEP',p.postalCode,'inputmode="numeric" maxlength="9"','cep',false)+
    field('street','Logradouro',p.street,'maxlength="160"',true)+
    field('number','Número',p.number,'maxlength="20"',false)+
    field('complement','Complemento',p.complement,'maxlength="100"',false)+
    field('district','Bairro',p.district,'maxlength="100"',false)+
    field('city','Cidade',p.city,'maxlength="100"',false)+
    field('state','UF',p.state,'maxlength="2"',false)+
    field('cityCode','Código IBGE do município',p.cityCode,'inputmode="numeric" maxlength="7"',false)+
    select('active','Situação',[['true','Ativo'],['false','Inativo']],p.active!==false?'true':'false')+
    '<p class="lookup-note field full">Dados públicos sugeridos por ViaCEP/BrasilAPI. Confira antes de salvar. Nome e classificação são obrigatórios; CPF/CNPJ passa a ser obrigatório para fornecedor nacional. Complete endereço e código IBGE antes de usar o cadastro em documento fiscal.</p>';}
  function updatePartyRequirements(form){if(!form||form.dataset.kind!=='client')return;var supplier=form.querySelector('[name="isSupplier"]'),type=form.querySelector('[name="type"]'),doc=form.querySelector('[name="document"]'),label=form.querySelector('label[for="f-document"]');var required=!!(supplier&&supplier.checked&&type&&type.value!=='EXT');if(doc)doc.required=required;if(label)label.textContent='CPF / CNPJ'+(required?' *':'');}
  function serviceForm(p){return field('code','Código do serviço *',p.code,'required maxlength="40"',false)+field('name','Descrição do serviço *',p.name,'required maxlength="160"',false)+field('description','Detalhamento',p.description,'maxlength="255"',true)+field('lc116','Subitem da LC 116',p.lc116,'maxlength="12"',false)+field('nbs','Código NBS',p.nbs,'maxlength="12"',false)+field('price','Valor (R$) *',p.price,'required type="number" min="0" step="0.01"',false)+select('active','Situação',[['true','Ativo'],['false','Inativo']],p.active!==false?'true':'false');}
  async function callApi(endpoint,options){
    var controller=new AbortController(),timeout=setTimeout(function(){controller.abort();},20000);
    try{
      var response=await fetch(endpoint,Object.assign({credentials:'same-origin',cache:'no-store'},options||{},{signal:controller.signal}));
      var result=await response.json().catch(function(){return {error:'Resposta inválida do servidor.'};});
      if(!response.ok)throw new Error(result.error||'A operação não pôde ser concluída.');
      return result;
    }catch(error){
      if(error.name==='AbortError')throw new Error('O servidor demorou a responder. Confira sua conexão e tente novamente.');
      throw error;
    }finally{clearTimeout(timeout);}
  }
  function setFormField(form,name,value){
    var target=form.querySelector('[name="'+name+'"]');
    if(target&&value!==undefined&&value!==null&&String(value).trim())target.value=String(value);
  }
  function fillAddress(form,data){
    ['postalCode','street','number','complement','district','city','state','cityCode'].forEach(function(name){setFormField(form,name,data[name]);});
  }
  async function lookupRegistration(button,kind){
    var form=button.closest('form');if(!form)return;
    var field=form.querySelector('[name="'+(kind==='cep'?'postalCode':form.id==='companyForm'?'cnpj':'document')+'"]');
    if(!field)return;
    if(kind==='cnpj'&&form.id==='recordForm'){
      var person=form.querySelector('[name="type"]');
      if(!person||person.value!=='PJ'){toast('A consulta de CNPJ é exclusiva de pessoa jurídica.','error');return;}
    }
    var value=field.value.trim();
    if(kind==='cep'&&value.replace(/\D/g,'').length!==8){toast('Digite um CEP com 8 dígitos.','error');field.focus();return;}
    if(kind==='cnpj'&&value.toUpperCase().replace(/[^A-Z0-9]/g,'').length!==14){toast('Digite um CNPJ com 14 caracteres.','error');field.focus();return;}
    var label=button.textContent;button.disabled=true;button.textContent='Consultando...';
    try{
      var data=await callApi('/api/lookup?type='+kind+'&value='+encodeURIComponent(value));
      if(!form.isConnected)return;
      if(kind==='cep'){fillAddress(form,data);}
      else {
        setFormField(form,form.id==='companyForm'?'legalName':'name',data.legalName);
        if(form.id==='companyForm'){
          setFormField(form,'tradeName',data.tradeName);
          setFormField(form,'cnae',data.cnae);
          setFormField(form,'fiscalEmail',data.email);
          setFormField(form,'fiscalPhone',data.phone);
        } else {
          setFormField(form,'email',data.email);
          setFormField(form,'phone',data.phone);
        }
        fillAddress(form,data);
        if(data.postalCode&&/^\d{8}$/.test(data.postalCode)){
          try{
            var address=await callApi('/api/lookup?type=cep&value='+data.postalCode);
            if(form.isConnected)fillAddress(form,address);
          }catch(e){/* CNPJ valido mesmo que a consulta complementar do CEP falhe. */}
        }
      }
      if(form.isConnected)toast('Dados sugeridos por '+data.source+'. Confira antes de salvar.');
    }catch(error){if(form.isConnected)toast(error.message,'error');}
    finally{if(button.isConnected){button.disabled=false;button.textContent=label;}}
  }
  async function refreshCloud(){
    var data=await callApi('/api/records');
    state={products:data.products||[],clients:data.clients||[],services:data.services||[],movements:data.movements||[],companyName:data.companyName||'Minha empresa'};
    render();
  }
  var checkingConnection=false;
  async function checkConnection(){
    if(checkingConnection)return;
    checkingConnection=true;
    var controller=new AbortController(),timeout=setTimeout(function(){controller.abort();},12000);
    try{
      var response=await fetch('/api/session',{credentials:'same-origin',cache:'no-store',signal:controller.signal}),status=await response.json();
      if(response.status===401&&status.status==='sign_in_required'){window.location.replace('/login');return;}
      if(!response.ok)throw new Error(status.error||'Erro de conexão.');
      if(status.status==='admin_ready'){window.location.replace('/admin');return;}
      cloud={status:status.status,displayName:status.displayName||'',company:status.company||null};
      if(cloud.status==='ready')await refreshCloud();
      else {state=emptyState();render();}
    }catch(error){cloud.status='error';state=emptyState();render();toast(error.name==='AbortError'?'O Supabase não respondeu em 12 segundos. Use Tentar novamente.':'Não foi possível verificar a conexão: '+error.message,'error');}
    finally{clearTimeout(timeout);checkingConnection=false;}
  }
  function companyFiscalFields(company){
    var a=company.address||{};
    var regimes=[['mei','MEI'],['simples_nacional','Simples Nacional'],['lucro_presumido','Lucro Presumido'],['lucro_real','Lucro Real'],['outro','Outro']];
    var selectedRegime=company.tax_regime_confirmed===true?company.tax_regime:'';
    var confirmationAvailable=company.tax_regime_confirmation_available===true;
    var regimeOptions='<option value="">Selecione após consultar a contabilidade</option>'+regimes.map(function(item){return '<option value="'+item[0]+'" '+(selectedRegime===item[0]?'selected':'')+'>'+item[1]+'</option>';}).join('');
    var regimeBlock='<label class="field full"><span>Regime tributário informado</span><select name="taxRegime">'+regimeOptions+'</select><small>O regime só será usado em preparação fiscal quando estiver confirmado pela contabilidade.</small></label>'+
      '<label class="field full" style="display:flex;align-items:flex-start;gap:9px"><input type="checkbox" name="taxRegimeConfirmed" value="true" '+(company.tax_regime_confirmed===true?'checked ':'')+(!confirmationAvailable?'disabled ':'')+'style="width:auto;margin-top:3px"><span>Confirmo que este regime foi conferido com a contabilidade.</span></label>'+
      (!confirmationAvailable?'<p class="small-note field full">A confirmação será habilitada após aplicar a migration fiscal pendente no Supabase.</p>':'');
    return '<div class="field full"><strong>Identificação e contato fiscal</strong></div>'+
      '<div class="field full"><strong>Enquadramento tributário</strong></div>'+regimeBlock+
      field('tradeName','Nome fantasia',company.trade_name||'','maxlength="160"',false)+
      lookupField('cnpj','CNPJ (numérico ou alfanumérico)',company.cnpj||'','maxlength="18" placeholder="00.000.000/0000-00"','cnpj',false)+
      field('stateRegistration','Inscrição Estadual (IE)',company.state_registration||'','maxlength="40"',false)+
      field('municipalRegistration','Inscrição Municipal',company.municipal_registration||'','maxlength="40"',false,'Se informar, preencha também o CNAE fiscal.')+
      field('cnae','CNAE fiscal (7 dígitos)',company.cnae||'','inputmode="numeric" maxlength="10"',false,'A Focus exige o par CNAE e Inscrição Municipal quando esses dados forem enviados.')+
      field('fiscalEmail','E-mail fiscal',company.fiscal_email||'','type="email" maxlength="254"',false)+
      field('fiscalPhone','Telefone com DDD',company.fiscal_phone||'','inputmode="tel" maxlength="24"',false)+
      '<div class="field full"><strong>Endereço fiscal da empresa</strong></div>'+
      field('street','Logradouro',a.street||'','maxlength="160"',true)+
      field('number','Número',a.number||'','maxlength="20"',false)+
      field('complement','Complemento',a.complement||'','maxlength="100"',false)+
      field('district','Bairro',a.district||'','maxlength="100"',false)+
      field('city','Município',a.city||'','maxlength="100"',false)+
      field('state','UF',a.state||'','maxlength="2" placeholder="SP"',false)+
      lookupField('postalCode','CEP (8 dígitos)',a.postalCode||'','inputmode="numeric" maxlength="9"','cep',false)+
      field('cityCode','Código IBGE do município (7 dígitos)',a.cityCode||'','inputmode="numeric" maxlength="7"',false)+
      '<div class="field full"><strong>Numeração da NF-e de homologação</strong><small>A Focus pode atribuir série e número automaticamente; o JVG não enviará esses campos por padrão.</small></div>'+
      field('nfeSeries','Série de controle local',company.nfe_series_homologacao==null?1:company.nfe_series_homologacao,'type="number" min="1" max="999"',false)+
      field('nfeNextNumber','Próximo número de controle local',company.nfe_next_number_homologacao==null?1:company.nfe_next_number_homologacao,'type="number" min="1" max="999999999"',false);
  }
  function openCompanyEditor(){
    if(!['needs_company','ready'].includes(cloud.status)){toast('Aguarde a configuração segura do servidor.','error');return;}
    var company=cloud.company||{},existing=cloud.status==='ready';
    modalRoot.innerHTML='<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><h2 id="modalTitle">'+(existing?'Editar empresa piloto':'Cadastrar minha empresa piloto')+'</h2><p>Seus dados serão vinculados somente à sua conta.</p></div><button class="icon-btn" type="button" data-action="close-modal">'+ico('x')+'</button></div><form id="companyForm"><div class="modal-body"><div class="form-grid">'+
      field('legalName','Razão social ou nome da empresa *',company.legal_name||'','required maxlength="160"',true)+
      (existing?companyFiscalFields(company):'')+
      '</div><p class="small-note" style="margin-top:16px">O sistema não considera o regime padrão como confirmação fiscal. Perfis e rascunhos de NF-e exigem a confirmação da contabilidade. Salvar este cadastro não transmite nota.</p></div><div class="modal-footer"><small>* Obrigatório</small><div class="modal-footer-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Salvar empresa</button></div></div></form></div></div>';
    // O formulario permanece aberto ao clicar no fundo: somente os botoes
    // Fechar/Cancelar ou a conclusao do cadastro podem dispensa-lo.
    modalRoot.querySelector('[name]').focus();
  }
  async function saveCompany(form){
    var values=Object.fromEntries(new FormData(form).entries()),existing=cloud.status==='ready';
    var button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{
      values.taxRegimeConfirmed=!!form.querySelector('[name="taxRegimeConfirmed"]')?.checked;
      var result=await callApi('/api/company',{method:existing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
      cloud.status='ready';cloud.company=result.company;closeModal();await checkConnection();toast('Empresa piloto salva no Supabase.');
    }catch(error){toast(error.message,'error');if(button)button.disabled=false;}
  }
  function openEditor(kind,recordId){
    if(cloud.status!=='ready'&&cloud.status!=='needs_company'){toast('Conecte a empresa ao servidor para cadastrar.','error');return;}
    if(cloud.status==='needs_company'){openCompanyEditor();return;}
    var list=state[kind+'s'];if(!list)return;
    var current=recordId?list.find(function(x){return x.id===recordId;}):null;
    var p=current||{},titles={product:'produto',client:'cliente',service:'serviço'},body=kind==='product'?productForm(p):kind==='client'?clientForm(p):serviceForm(p);
    modalRoot.innerHTML='<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><h2 id="modalTitle">'+(current?'Editar ':'Cadastrar novo ')+titles[kind]+'</h2><p>Cadastro vinculado à sua empresa no Supabase.</p></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="Fechar">'+ico('x')+'</button></div><form id="recordForm" data-kind="'+kind+'" data-id="'+h(recordId||'')+'"><div class="modal-body"><div class="form-grid">'+body+'</div></div><div class="modal-footer"><small>* Campos obrigatórios</small><div class="modal-footer-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">'+ico('check')+' Salvar cadastro</button></div></div></form></div></div>';
    if(kind==='product'&&current&&cloud.status==='ready'){
      var stockField=modalRoot.querySelector('[name="stock"]');
      if(stockField){stockField.readOnly=true;stockField.title='Use Ajustar saldo no módulo Estoque';}
    }
    if(kind==='product'){loadProductCfopOptions();loadProductProfileOptions(p.taxProfileId||'');}if(kind==='client')updatePartyRequirements(document.getElementById('recordForm'));
    // Evita fechamento acidental ao arrastar o mouse para selecionar texto
    // ou escolher opcoes dos campos de cadastro.
    var first=modalRoot.querySelector('[name]');if(first)first.focus();
  }
  async function loadProductProfileOptions(selected){
    try{
      var response=await callApi('/api/fiscal/tax-profiles');
      var field=modalRoot.querySelector('#recordForm [name="taxProfileId"]');
      if(!field)return;
      (response.records||[]).forEach(function(profile){var opt=document.createElement('option');opt.value=profile.id;opt.textContent=profile.name+' · pendente de revisão';field.appendChild(opt);});
      field.value=selected||'';
    }catch(error){toast('Perfis tributários indisponíveis no momento.','error');}
  }
  var productCfopOptionsLoaded=false;
  async function loadProductCfopOptions(){
    if(productCfopOptionsLoaded)return;
    try{
      var response=await callApi('/api/fiscal/cfop');
      var datalist=document.getElementById('productCfopOptions');
      if(!datalist)return;
      datalist.replaceChildren();
      (response.records||[]).forEach(function(cfop){var item=document.createElement('option');item.value=cfop.code;item.label=cfop.customLabel||cfop.title;datalist.append(item);});
      productCfopOptionsLoaded=true;
    }catch(error){/* O código pode ser digitado; o servidor valida contra o catálogo. */}
  }
  function closeModal(){modalRoot.innerHTML='';}
  function toast(msg,kind){var el=document.createElement('div');el.className='toast '+(kind||'');el.innerHTML=ico(kind==='error'?'x':'check')+'<span>'+h(msg)+'</span>';toastRoot.appendChild(el);setTimeout(function(){el.remove();},3800);}
  async function saveRecord(form){
    if(cloud.status!=='ready'){toast('Cadastro indisponível sem conexão com o banco.','error');return;}
    var kind=form.dataset.kind,recordId=form.dataset.id,values=Object.fromEntries(new FormData(form).entries()),list=state[kind+'s'];
    if(!list)return;
    var code=kind==='product'?values.sku:kind==='service'?values.code:null;
    if(code&&list.some(function(x){return x.id!==recordId&&(kind==='product'?x.sku:x.code).trim().toUpperCase()===code.trim().toUpperCase();})){toast('Já existe um cadastro com este código.','error');return;}
    var record={id:recordId||null};
    if(kind==='product'){
      if(values.ncm&&!/^\d{8}$/.test(values.ncm)){toast('NCM deve conter 8 dígitos.','error');return;}
      if(values.gtin && values.gtin!=='SEM GTIN' && !/^\d{8}$|^\d{12,14}$/.test(values.gtin)){toast('GTIN deve conter 8, 12, 13 ou 14 dígitos ou SEM GTIN.','error');return;}
      record=Object.assign(record,{sku:values.sku.trim(),name:values.name.trim(),category:values.category.trim(),unit:values.unit,ncm:values.ncm,cest:values.cest,defaultCfop:values.defaultCfop.trim(),taxProfileId:values.taxProfileId||null,gtin:values.gtin||'SEM GTIN',origin:values.origin,cost:Number(values.cost||0),price:Number(values.price||0),stock:Number(values.stock||0),active:values.active==='true'});
      if(record.price<0||record.cost<0||record.stock<0){toast('Valores não podem ser negativos.','error');return;}
    }else if(kind==='client'){
      var doc=values.document.toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(values.isSupplier==='true'&&values.type!=='EXT'&&!doc){toast('CPF/CNPJ obrigatório para vincular fornecedor a NF-e de entrada.','error');return;}if(doc&&((values.type==='PF'&&!/^\d{11}$/.test(doc))||(values.type==='PJ'&&!/^[A-Z0-9]{12}\d{2}$/.test(doc)))){toast('CPF/CNPJ tem formato incompatível com o tipo de pessoa.','error');return;}
      var isCustomer=values.isCustomer==='true',isSupplier=values.isSupplier==='true',isCarrier=values.isCarrier==='true';
      if(!isCustomer&&!isSupplier&&!isCarrier){toast('Selecione pelo menos um tipo: cliente, fornecedor ou transportadora.','error');return;}
      record=Object.assign(record,{name:values.name.trim(),legalName:values.legalName.trim(),type:values.type,document:doc,stateRegistration:values.stateRegistration.trim(),municipalRegistration:values.municipalRegistration.trim(),isCustomer:isCustomer,isSupplier:isSupplier,isCarrier:isCarrier,email:values.email.trim(),phone:values.phone.trim(),street:values.street.trim(),number:values.number.trim(),complement:values.complement.trim(),district:values.district.trim(),postalCode:values.postalCode.replace(/\D/g,''),cityCode:values.cityCode.replace(/\D/g,''),city:values.city.trim(),state:values.state.trim().toUpperCase(),active:values.active==='true'});
    }else{
      record=Object.assign(record,{code:values.code.trim(),name:values.name.trim(),description:values.description.trim(),lc116:values.lc116.trim(),nbs:values.nbs.trim(),price:Number(values.price||0),active:values.active==='true'});
      if(record.price<0){toast('Valor inválido.','error');return;}
    }
    var submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
    try{
      var saved=await callApi('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:kind,id:recordId||null,record:record})});
      if(kind==='product'&&!recordId&&record.stock>0){
        try{await callApi('/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:saved.id,delta:record.stock,reason:'Saldo inicial do cadastro'})});}
        catch(stockError){toast('Produto salvo, mas ajuste inicial pendente: '+stockError.message,'error');}
      }
      closeModal();await refreshCloud();toast('Cadastro salvo no Supabase.');
    }catch(error){toast(error.message,'error');if(submit)submit.disabled=false;}
  }
  async function removeRecord(kind,recordId){
    if(cloud.status!=='ready'){toast('Operação indisponível sem conexão com o banco.','error');return;}
    var list=state[kind+'s'],p=list&&list.find(function(x){return x.id===recordId;});if(!p)return;
    var name=p.name||p.sku||p.code;
    if(!confirm('Inativar "'+name+'" no Supabase? O registro será preservado para auditoria.'))return;
    try{await callApi('/api/records',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:kind,id:recordId})});await refreshCloud();toast('Cadastro inativado no banco.');}
    catch(error){toast(error.message,'error');}
  }
  function adjustStock(recordId){
    var p=state.products.find(function(x){return x.id===recordId;});if(!p)return;
    modalRoot.innerHTML='<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><h2 id="modalTitle">Ajustar estoque</h2><p>'+h(p.name)+' · Saldo atual: '+num(p.stock)+' '+h(p.unit)+'</p></div><button class="icon-btn" type="button" data-action="close-modal">'+ico('x')+'</button></div><form id="stockForm" data-id="'+h(recordId)+'"><div class="modal-body"><div class="form-grid"><div class="field"><label for="stockDelta">Quantidade de ajuste *</label><input id="stockDelta" name="delta" type="number" step="0.001" required placeholder="Ex.: 10 ou -2"><small>Positivo = entrada. Negativo = saída.</small></div><div class="field"><label for="stockReason">Motivo *</label><input id="stockReason" name="reason" maxlength="120" required placeholder="Ex.: Inventário de teste"></div></div><p class="small-note">Ajuste de estoque registrado na sua empresa. Confira antes de confirmar.</p></div><div class="modal-footer"><small>O saldo não poderá ficar negativo.</small><div class="modal-footer-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Confirmar ajuste</button></div></div></form></div></div>';
    // A janela de ajuste nao fecha ao tocar fora dela.
    document.getElementById('stockDelta').focus();
  }
  async function saveStock(form){
    if(cloud.status!=='ready'){toast('Ajuste indisponível sem conexão com o banco.','error');return;}
    var p=state.products.find(function(x){return x.id===form.dataset.id;});if(!p)return;
    var data=Object.fromEntries(new FormData(form).entries()),delta=Number(data.delta);
    if(!Number.isFinite(delta)||delta===0){toast('Informe uma quantidade diferente de zero.','error');return;}
    if(Number(p.stock)+delta<0){toast('O saldo não pode ficar negativo.','error');return;}
    try{await callApi('/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:p.id,delta:delta,reason:data.reason})});closeModal();await refreshCloud();toast('Estoque atualizado no Supabase.');}
    catch(error){toast(error.message,'error');}
  }
  function exportCsv(kind){
    if(cloud.status!=='ready'){toast('Conecte ao banco antes de exportar.','error');return;}
    var data=state[kind],fields=kind==='products'?['sku','name','category','unit','ncm','cest','defaultCfop','gtin','origin','cost','price','stock','active']:kind==='clients'?['name','type','document','email','phone','postalCode','street','number','complement','district','city','state','cityCode','active']:['code','name','description','lc116','nbs','price','active'];
    if(!Array.isArray(data)||!data.length){toast('Não há dados para exportar.','error');return;}
    var lines=[fields.join(';')].concat(data.map(function(r){return fields.map(function(f){return '"'+String(r[f]??'').replace(/"/g,'""')+'"';}).join(';');}));
    var blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='JVG_'+kind+'_cadastros.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},300);toast('CSV exportado.');
  }
  document.addEventListener('click',function(e){
    var v=e.target.closest('[data-view]');if(v){document.querySelectorAll('.sidebar-scroll .nav-group[open]').forEach(function(group){group.open=false;});setView(v.dataset.view);return;}
    var b=e.target.closest('[data-action]');if(!b)return;var a=b.dataset.action,recordId=b.dataset.id;
    if(a==='close-modal'){closeModal();return;}
    if(a==='lookup-cep'||a==='lookup-cnpj'){lookupRegistration(b,a.substring(7));return;}
    if(a==='configure-company'){openCompanyEditor();return;}
    if(a==='check-connection'){checkConnection();return;}
    if(a==='logout'){window.location.assign('/logout');return;}
    if(a.indexOf('new-')===0){openEditor(a.substring(4));return;}
    if(a.indexOf('edit-')===0){openEditor(a.substring(5),recordId);return;}
    if(a.indexOf('remove-')===0){removeRecord(a.substring(7),recordId);return;}
    if(a.indexOf('export-')===0){exportCsv(a.substring(7));return;}
    if(a==='adjust-stock'){adjustStock(recordId);return;}
    if(a.indexOf('goto-')===0){setView(a.substring(5));return;}
  });
  document.addEventListener('change',function(e){if(e.target.matches('[name="isSupplier"], [name="type"]'))updatePartyRequirements(e.target.form);});
  document.addEventListener('submit',function(e){if(e.target.id==='recordForm'){e.preventDefault();saveRecord(e.target);}if(e.target.id==='stockForm'){e.preventDefault();saveStock(e.target);}if(e.target.id==='companyForm'){e.preventDefault();saveCompany(e.target);}if(e.target.id==='profileForm'){e.preventDefault();saveProfile(e.target);}if(e.target.id==='passwordForm'){e.preventDefault();savePassword(e.target);}if(e.target.id==='logoForm'){e.preventDefault();uploadCompanyLogo(e.target);}});
  document.addEventListener('input',function(e){
    if(e.target.id==='globalSearch'){var searchText=e.target.value;if(view==='dashboard'){setView('products');query=searchText;render();}else{query=searchText;render();}return;}
    if(e.target.hasAttribute('data-search-input')){query=e.target.value;var pos=e.target.selectionStart;render();var next=document.querySelector('[data-search-input]');if(next){next.focus();next.setSelectionRange(pos,pos);}}
  });
  document.addEventListener('change',function(e){if(e.target.hasAttribute('data-filter')){filter=e.target.value;render();}if(e.target.id==='partyTypeFilter'){partyFilter=e.target.value;render();}});
  function closeSidebar(restoreFocus){var sidebar=document.getElementById('sidebar');var wasOpen=sidebar.classList.contains('open');sidebar.classList.remove('open');document.getElementById('mobileBackdrop').classList.remove('active');document.getElementById('menuBtn').setAttribute('aria-expanded','false');if(restoreFocus&&wasOpen)document.getElementById('menuBtn').focus();}
  document.getElementById('menuBtn').setAttribute('aria-expanded','false');
  document.getElementById('menuBtn').addEventListener('click',function(){document.getElementById('sidebar').classList.add('open');document.getElementById('mobileBackdrop').classList.add('active');this.setAttribute('aria-expanded','true');document.getElementById('closeMenuBtn').focus();});
  document.getElementById('closeMenuBtn').addEventListener('click',function(){closeSidebar(true);});
  document.getElementById('mobileBackdrop').addEventListener('click',function(){closeSidebar(true);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeSidebar(true);if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();document.getElementById('globalSearch').focus();}});
  if('scrollRestoration' in history)history.scrollRestoration='manual';
  window.scrollTo(0,0);
  document.querySelector('.main-column').scrollTop=0;
  var initialHash=decodeURIComponent(window.location.hash.slice(1));
  if(labels[initialHash])view=initialHash;
  window.addEventListener('hashchange',function(){var next=decodeURIComponent(window.location.hash.slice(1))||'dashboard';if(labels[next]&&next!==view){view=next;query='';filter='all';closeSidebar();render();document.querySelector('.main-column').scrollTop=0;}});
  window.addEventListener('popstate',function(){var next=decodeURIComponent(window.location.hash.slice(1))||'dashboard';if(labels[next]&&next!==view){view=next;query='';filter='all';closeSidebar();render();document.querySelector('.main-column').scrollTop=0;}});
  render();
  checkConnection();
})();
