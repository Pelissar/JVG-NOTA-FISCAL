import { randomUUID } from "node:crypto";
import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError, str, type SiteAccount } from "../../../../lib/jvg-backend";
import { hasRtcValue, rtcCalendarDate, rtcCalculatorUrl, rtcDecimal, rtcOffsetDateTime, rtcRegularNominalRates, rtcSubmittedOrFallback } from "../../../../lib/fiscal/rtc-calculator";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(["owner", "admin", "manager", "accounting"]);

async function currentAccount(): Promise<{ userId: string; account: SiteAccount }> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  if (!ROLES.has(account.member_role || account.role || "viewer")) throw new JvgBackendError("Acesso fiscal não autorizado.", 403);
  return { userId: user.userId, account };
}
function scope(account: SiteAccount) { return `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`; }
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function missingSchema(error: unknown) { return error instanceof JvgBackendError && ["PGRST204", "PGRST205", "42703", "42P01"].includes(error.databaseCode || ""); }
function decimal(value: unknown, field: string, required = true, integerDigits = 13, fractionalDigits = 4): string | null {
  try { return rtcDecimal(value, field, { required, integerDigits, fractionalDigits }); }
  catch (error) { throw new JvgBackendError(error instanceof Error ? error.message : `${field}: decimal inválido.`, 400); }
}
function code(value: unknown, pattern: RegExp, field: string, required = true): string | null {
  if (value == null || value === "") {
    if (required) throw new JvgBackendError(`${field}: preencha este código para o item na configuração fiscal do produto ou informe a orientação da contabilidade.`, 400);
    return null;
  }
  const text = String(value).trim();
  if (!pattern.test(text)) throw new JvgBackendError(`${field}: código inválido.`, 400);
  return text;
}
function serviceUrl(baseValue: string, path: string): URL {
  try { return rtcCalculatorUrl(baseValue, path, process.env.NODE_ENV !== "production"); }
  catch { throw new JvgBackendError("A URL RTC deve apontar para a raiz do serviço, /api ou /api/calculadora; produção exige HTTPS.", 503); }
}
async function calculatorFetch(url: URL, method: "GET" | "POST", body?: Row) {
  const headers = new Headers({ Accept: "application/json" });
  if (body) headers.set("Content-Type", "application/json");
  const token = process.env.JVG_RTC_CALCULATOR_BEARER_TOKEN?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (process.env.NODE_ENV === "production" && !token)
    throw new JvgBackendError("Configure JVG_RTC_CALCULATOR_BEARER_TOKEN no servidor antes de habilitar chamadas RTC em produção.", 503);
  const response = await fetch(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const raw = await response.text();
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { /* response will be reported as non-JSON */ }
  if (!response.ok) {
    const detail = object(parsed);
    const message = str(detail.detail || detail.message || detail.mensagem || detail.title, 500);
    throw new JvgBackendError(message ? `A calculadora oficial recusou a solicitação: ${message}` : `A calculadora oficial respondeu HTTP ${response.status}.`, 502);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new JvgBackendError("A calculadora oficial retornou uma resposta que não é JSON de objeto.", 502);
  const data = parsed as Row;
  return {
    data,
    simulatedWarning: response.headers.get("x-warning-dados-simulados") === "true",
    appVersion: str(data.versaoApp || response.headers.get("x-calc-app-version"), 80),
    databaseVersion: str(data.versaoDb || response.headers.get("x-calc-db-version"), 80),
  };
}
function responseItems(response: Row): Row[] {
  const items = response.objetos ?? response.itens ?? response.resultados;
  return Array.isArray(items) ? items.map(object) : [];
}
function computedStatuses(items: Row[]): string[] {
  return items.map((item) => str(item.estadoItem ?? item.estado ?? item.status, 40).toUpperCase());
}

export async function GET(request: Request) {
  try {
    const { account } = await currentAccount();
    const draftId = new URL(request.url).searchParams.get("draftId") || "";
    if (!UUID.test(draftId)) throw new JvgBackendError("Identificador do rascunho inválido.", 400);
    const rows = await dbRequest<Row[]>(`/rest/v1/jvg_fiscal_rtc_calculations?${scope(account)}&fiscal_document_id=${filterEq(draftId)}&select=id,regime,calculator_endpoint,calculator_version,calculator_db_version,request_version,simulated_data_warning,input_snapshot,result_snapshot,created_at&order=created_at.desc&limit=20`);
    return apiJson({ records: rows, enabled: process.env.JVG_RTC_ENABLED === "true" });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    if (process.env.JVG_RTC_ENABLED !== "true") throw new JvgBackendError("A calculadora RTC está desativada. Ative-a somente após instalar e validar o serviço oficial em homologação.", 503);
    const { userId, account } = await currentAccount();
    const raw = await request.text();
    if (raw.length > 24_000) throw new JvgBackendError("Dados para o cálculo excedem o limite.", 413);
    let body: Row;
    try { body = JSON.parse(raw) as Row; } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    const draftId = str(body.draftId, 40);
    if (!UUID.test(draftId)) throw new JvgBackendError("Selecione um rascunho de NF-e salvo.", 400);
    const company = await getCompany(account);
    if (!company) throw new JvgBackendError("Empresa não encontrada.", 404);
    if (company.tax_regime_confirmed !== true) throw new JvgBackendError("Confirme o regime tributário da empresa antes de selecionar a calculadora.", 409);
    const regime = String(company.tax_regime || "");
    const isSimple = regime === "simples_nacional";
    const isRegular = regime === "lucro_presumido" || regime === "lucro_real";
    if (!isSimple && !isRegular) throw new JvgBackendError(regime === "mei"
      ? "A Receita não disponibiliza esta calculadora do Simples para CRT 4 (MEI). Não será usado o serviço de outro regime."
      : "O regime cadastrado não tem uma calculadora RTC compatível nesta integração.", 409);
    if (company.fiscal_rtc_columns_available !== true) throw new JvgBackendError("A migration 20261118_jvg_accountant_rtc.sql precisa ser aplicada para armazenar as configurações e o histórico dos cálculos.", 409);

    const documents = await dbRequest<Row[]>(`/rest/v1/jvg_fiscal_documents?${scope(account)}&id=${filterEq(draftId)}&document_type=eq.nfe&environment=eq.homologacao&status=eq.draft&select=id,status,fiscal_payload,updated_at&limit=1`);
    const document = documents[0];
    if (!document) throw new JvgBackendError("O rascunho não foi encontrado nesta empresa ou não está em estado de preparação.", 404);
    const fiscalPayload = object(document.fiscal_payload);
    const savedItems = Array.isArray(fiscalPayload.items) ? fiscalPayload.items.map(object) : [];
    if (!savedItems.length) throw new JvgBackendError("O rascunho não contém itens para calcular.", 400);
    const requestedItems = body.items;
    if (!Array.isArray(requestedItems) || requestedItems.length !== savedItems.length)
      throw new JvgBackendError("Informe uma configuração RTC para cada item do rascunho, na mesma ordem.", 400);
    const productIds = [...new Set(savedItems.map((item) => str(item.productId, 40)))];
    if (productIds.some((id) => !UUID.test(id))) throw new JvgBackendError("O rascunho contém um produto inválido.", 409);
    const products = await dbRequest<Row[]>(`/rest/v1/jvg_products?${scope(account)}&id=in.(${productIds.join(",")})&select=id,ncm,unit,rtc_cst,rtc_class_trib,rtc_simple_activity&limit=100`);
    const byId = new Map(products.map((product) => [String(product.id), product]));
    if (products.length !== productIds.length) throw new JvgBackendError("Um produto vinculado ao rascunho não está disponível nesta empresa.", 409);
    const inputItems: Row[] = [];
    for (let index = 0; index < savedItems.length; index += 1) {
      const saved = savedItems[index];
      const submitted = object(requestedItems[index]);
      const productId = str(saved.productId, 40);
      if (submitted.productId !== productId) throw new JvgBackendError(`Item ${index + 1}: os produtos ou a ordem não correspondem ao rascunho salvo.`, 400);
      const product = byId.get(productId)!;
      const cClassTribValue = rtcSubmittedOrFallback(submitted, "cClassTrib", product.rtc_class_trib);
      const cClassTrib = code(cClassTribValue, /^\d{6}$/, `Item ${index + 1}, cClassTrib`)!;
      if (isSimple) {
        const baseCalculoText = decimal(submitted.baseCalculo, `Item ${index + 1} (${str(saved.description, 120)}), base de cálculo`, true, 18, 8)!;
        const cAtivSNValue = rtcSubmittedOrFallback(submitted, "cAtivSN", product.rtc_simple_activity);
        const cAtivSN = code(cAtivSNValue, /^\d{2}$/, `Item ${index + 1}, cAtivSN`)!;
        const valorImpostoSeletivo = decimal(submitted.valorImpostoSeletivo, `Item ${index + 1}, valor do Imposto Seletivo`, true, 18, 8)!;
        const pIBSSN = decimal(submitted.pIBSSN, `Item ${index + 1}, alíquota efetiva IBS do Simples`, false, 18, 8);
        const pCBSSN = decimal(submitted.pCBSSN, `Item ${index + 1}, alíquota efetiva CBS do Simples`, false, 18, 8);
        inputItems.push({ numero: index + 1, cAtivSN, cClassTrib, baseCalculo: baseCalculoText, valorImpostoSeletivo,
          ...(pIBSSN !== null ? { pIBSSN } : {}), ...(pCBSSN !== null ? { pCBSSN } : {}) });
      } else {
        const cstValue = rtcSubmittedOrFallback(submitted, "cst", product.rtc_cst);
        const ncmValue = rtcSubmittedOrFallback(submitted, "ncm", saved.ncm || product.ncm);
        const cst = code(cstValue, /^\d{3}$/, `Item ${index + 1}, CST IBS/CBS`)!;
        const ncm = code(ncmValue, /^\d{8}$/, `Item ${index + 1}, NCM`, false);
        const nbs = code(submitted.nbs, /^\d{9}$/, `Item ${index + 1}, NBS`, false);
        const selective = object(submitted.impostoSeletivo);
        const selectiveKeys = ["cst", "cClassTrib", "baseCalculo", "quantidade", "unidade", "impostoInformado"];
        const hasSelective = selectiveKeys.some((key) => hasRtcValue(selective[key]));
        const baseCalculoText = decimal(submitted.baseCalculo, `Item ${index + 1} (${str(saved.description, 120)}), base de cálculo`, !hasSelective, 13, 2);
        const quantityText = decimal(rtcSubmittedOrFallback(submitted, "quantity", saved.quantity), `Item ${index + 1}, quantidade`, false, 11, 4);
        const quantity = quantityText === null ? null : Number(quantityText);
        const unit = str(rtcSubmittedOrFallback(submitted, "unit", saved.unit || product.unit), 6).trim();
        const item: Row = { numero: index + 1, ...(ncm ? { ncm } : {}), ...(nbs ? { nbs } : {}), cst, cClassTrib,
          ...(baseCalculoText === null ? {} : { baseCalculo: Number(baseCalculoText) }), ...(quantity === null ? {} : { quantidade: quantity }), ...(unit ? { unidade: unit } : {}) };
        if (hasSelective) {
          const selectiveBase = decimal(selective.baseCalculo, `Item ${index + 1}, base do Imposto Seletivo`, true, 13, 2)!;
          const selectiveQuantity = decimal(selective.quantidade, `Item ${index + 1}, quantidade do Imposto Seletivo`, false, 11, 4);
          const selectiveImposto = decimal(selective.impostoInformado, `Item ${index + 1}, valor do Imposto Seletivo`, false, 13, 2);
          item.impostoSeletivo = {
            cst: code(selective.cst, /^\d{3}$/, `Item ${index + 1}, CST do Imposto Seletivo`)!,
            cClassTrib: code(selective.cClassTrib, /^\d{6}$/, `Item ${index + 1}, cClassTrib do Imposto Seletivo`)!,
            baseCalculo: Number(selectiveBase),
            ...(selectiveQuantity !== null ? { quantidade: Number(selectiveQuantity) } : {}),
            ...(str(selective.unidade, 6).trim() ? { unidade: str(selective.unidade, 6).trim() } : {}),
            ...(selectiveImposto !== null ? { impostoInformado: Number(selectiveImposto) } : {}),
          };
        }
        inputItems.push(item);
      }
    }
    const requestVersion = str(isSimple ? process.env.JVG_RTC_SIMPLE_OPERATION_VERSION : process.env.JVG_RTC_REGULAR_OPERATION_VERSION, 40);
    if (!requestVersion) throw new JvgBackendError(`Configure no servidor ${isSimple ? "JVG_RTC_SIMPLE_OPERATION_VERSION" : "JVG_RTC_REGULAR_OPERATION_VERSION"} conforme a versão do contrato da calculadora instalada.`, 503);
    const address = object(company.address);
    const submittedGovernmentType = body.tpEnteGov === "" || body.tpEnteGov == null ? null : Number(body.tpEnteGov);
    if (submittedGovernmentType !== null && (!Number.isInteger(submittedGovernmentType) ||
      (isSimple ? ![1, 2, 3, 4].includes(submittedGovernmentType) : ![1, 2, 3, 4, 5, 6].includes(submittedGovernmentType)))) {
      throw new JvgBackendError("Tipo de ente governamental inválido para a operação RTC selecionada.", 400);
    }
    const apiBase = isSimple ? process.env.JVG_RTC_SIMPLE_CALCULATOR_API_BASE : process.env.JVG_RTC_REGULAR_CALCULATOR_API_BASE;
    if (!apiBase?.trim()) throw new JvgBackendError("A calculadora oficial deste regime ainda não está configurada no servidor.", 503);
    let calculatorVersion = "";
    let calculatorDatabaseVersion = "";
    let requestPayload: Row;
    if (isSimple) {
      const versionResult = await calculatorFetch(serviceUrl(apiBase, "versao"), "GET");
      calculatorVersion = versionResult.appVersion;
      calculatorDatabaseVersion = versionResult.databaseVersion;
      if (!calculatorVersion) throw new JvgBackendError("O serviço oficial do Simples não informou sua versão da aplicação.", 502);
      const crt = Number(company.crt || 0);
      if (![1, 2, 3].includes(crt)) throw new JvgBackendError("Informe o CRT confirmado pela contabilidade na configuração fiscal da empresa. CRT 4/MEI não é aceito pela calculadora do Simples.", 409);
      if (crt === 3 && company.tp_regime_ibs_cbs !== "2") throw new JvgBackendError("Para CRT 3, confirme o tpRegimeIBSCBS exigido pela API oficial; o sistema não vai inferi-lo.", 409);
      const issueAt = str(fiscalPayload.issueAt, 40);
      const date = rtcCalendarDate(issueAt.slice(0, 10));
      if (!date) throw new JvgBackendError("Informe uma data real e válida para o fato gerador no rascunho antes de calcular.", 400);
      requestPayload = { id: randomUUID().replace(/-/g, ""), versao: requestVersion, data: date, tpDoc: "55", CRT: String(crt),
        ...(crt === 3 ? { tpRegimeIBSCBS: "2" } : {}),
        ...(submittedGovernmentType !== null ? { tpEnteGov: String(submittedGovernmentType) } : {}), itens: inputItems };
    } else {
      const rawIssueAt = str(fiscalPayload.issueAt, 40);
      const issueAt = rtcOffsetDateTime(rawIssueAt);
      if (!issueAt) throw new JvgBackendError("Informe data e hora reais com fuso horário no rascunho (por exemplo, ISO 8601 com Z ou deslocamento UTC).", 400);
      const issueDate = rtcCalendarDate(issueAt.slice(0, 10));
      if (!issueDate) throw new JvgBackendError("Informe uma data/hora válida para o fato gerador no rascunho.", 400);
      const taxYear = Number(issueDate.slice(0, 4));
      const cityCode = String(address.cityCode || "").replace(/\D/g, "");
      if (!/^\d{7}$/.test(cityCode)) throw new JvgBackendError("Complete o código IBGE de 7 dígitos do município emitente no cadastro da empresa.", 400);
      const uf = String(address.state || "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(uf)) throw new JvgBackendError("Complete a UF do emitente no cadastro da empresa.", 400);
      const versionResult = await calculatorFetch(serviceUrl(apiBase, "calculadora/dados-abertos/versao"), "GET");
      calculatorVersion = versionResult.appVersion;
      calculatorDatabaseVersion = versionResult.databaseVersion;
      if (!calculatorVersion) throw new JvgBackendError("O serviço oficial do regime regular não informou sua versão da aplicação.", 502);
      const itemsWithRates = inputItems.map((item, index) => {
        const submitted = object(requestedItems[index]);
        try {
          const rates = rtcRegularNominalRates(object(submitted.aliquotasNominais), taxYear, index + 1);
          return rates ? { ...item, aliquotasNominais: rates } : item;
        } catch (error) {
          throw new JvgBackendError(error instanceof Error ? error.message : `Item ${index + 1}: alíquotas nominais inválidas.`, 400);
        }
      });
      requestPayload = { id: randomUUID().replace(/-/g, ""), versao: requestVersion, dhFatoGerador: issueAt,
        municipio: Number(cityCode), uf, tpDoc: 55,
        ...(submittedGovernmentType !== null ? { gCompraGov: { tpEnteGov: submittedGovernmentType } } : {}),
        itens: itemsWithRates };
    }
    const endpoint = isSimple ? "simples-nacional" : "regime-geral";
    const result = await calculatorFetch(serviceUrl(apiBase, `calculadora/observabilidade/${endpoint}`), "POST", requestPayload);
    const outputItems = responseItems(result.data);
    if (outputItems.length !== savedItems.length) throw new JvgBackendError("A resposta oficial não contém um resultado identificável para cada item. O cálculo não foi aprovado para uso.", 502);
    const states = computedStatuses(outputItems);
    const allCalculated = states.every((state) => state === "CALCULADO");
    const hasSimulatedItems = states.includes("CALCULO_SIMULADO");
    const simulatedWarning = result.simulatedWarning || hasSimulatedItems;
    const allRecorded = states.every((state) => state === "CALCULADO" || (state === "CALCULO_SIMULADO" && simulatedWarning));
    const resultSnapshot = { source: "Receita Federal", response: result.data, itemStates: states, allItemsCalculated: allCalculated,
      calculatorVersion, calculatorDatabaseVersion, operationContractVersion: requestVersion, endpoint,
      warning: simulatedWarning ? "Resultado com alíquotas/dados simulados pela calculadora; serve apenas para conferência e não deve ser usado na emissão." : null,
      focusTransmissionEnabled: false };
    const inserted = await dbRequest<Row[]>("/rest/v1/jvg_fiscal_rtc_calculations", { method: "POST", body: JSON.stringify({
      tenant_id: account.tenant_id, company_id: account.company_id, fiscal_document_id: draftId, regime,
      calculator_endpoint: endpoint, calculator_version: calculatorVersion,
      calculator_db_version: calculatorDatabaseVersion || null,
      request_version: str(requestPayload.versao, 80), input_snapshot: {
        fiscalDocumentUpdatedAt: String(document.updated_at || ""), regime, calculatorRequest: requestPayload,
      },
      result_snapshot: resultSnapshot, simulated_data_warning: simulatedWarning, created_by: userId,
    }) });
    if (!allRecorded) return apiJson({ ok: false, id: inserted[0]?.id, regime, endpoint, calculatorVersion, calculatorDatabaseVersion,
      itemStates: states, result: resultSnapshot, error: "A calculadora respondeu, mas ao menos um item não foi calculado. Corrija as pendências indicadas na resposta oficial. IBS/CBS não foi enviado à Focus." }, 422);
    return apiJson({ ok: true, id: inserted[0]?.id, regime, endpoint, calculatorVersion, calculatorDatabaseVersion, itemStates: states,
      simulated: simulatedWarning, warning: simulatedWarning, result: resultSnapshot,
      message: simulatedWarning ? "Simulação RTC registrada para este rascunho. Ela não altera outros tributos e não pode ser usada para emissão." : "Resultado da calculadora oficial registrado para este rascunho. Ele não altera outros tributos e não é enviado à Focus.", focusTransmissionEnabled: false }, 201);
  } catch (error) {
    if (missingSchema(error)) return apiJson({ error: "A migration 20261118_jvg_accountant_rtc.sql precisa ser aplicada antes de salvar ou consultar configurações/cálculos RTC." }, 409);
    return safeError(error);
  }
}
