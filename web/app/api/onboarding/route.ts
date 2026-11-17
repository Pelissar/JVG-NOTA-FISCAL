import { randomUUID } from "node:crypto";
import { apiJson, dbRequest, isSameOrigin, JvgBackendError, safeError, str } from "../../../lib/jvg-backend";
import { BUSINESS_TYPES } from "../../../lib/business-types";
import { validCnpj } from "../../../lib/fiscal-company";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
    const body = await request.json() as Record<string, unknown>;
    // A hidden field is a lightweight bot trap; it is not a substitute for a captcha.
    if (str(body.website, 180)) return apiJson({ accepted: true });
    const companyName = str(body.companyName, 160);
    const contactName = str(body.contactName, 120);
    const email = str(body.email, 254).toLowerCase();
    const cnpj = str(body.cnpj, 24).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const phone = str(body.phone, 24).replace(/\D/g, "");
    const businessType = str(body.businessType, 40);
    const message = str(body.message, 2000);
    if (companyName.length < 2) throw new JvgBackendError("Informe a razão social ou nome da empresa.", 400);
    if (contactName.length < 2) throw new JvgBackendError("Informe o nome da pessoa responsável.", 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new JvgBackendError("Informe um e-mail válido.", 400);
    if (!validCnpj(cnpj)) throw new JvgBackendError("Informe um CNPJ válido com 14 caracteres.", 400);
    if (phone.length < 10 || phone.length > 13) throw new JvgBackendError("Informe um telefone com DDD.", 400);
    if (!BUSINESS_TYPES.some((item) => item.code === businessType)) throw new JvgBackendError("Selecione o segmento da empresa.", 400);
    if (body.consent !== true) throw new JvgBackendError("Confirme que podemos entrar em contato sobre o cadastro.", 400);

    const id = randomUUID();
    const caseCode = `SF-${new Date().getFullYear()}-${id.slice(0, 6).toUpperCase()}`;
    await dbRequest("/rest/v1/jvg_onboarding_requests", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id, case_code: caseCode, company_name: companyName, contact_name: contactName,
        email, cnpj, phone, business_type: businessType, message, status: "new",
      }),
    });
    const digits = (process.env.JVG_SALES_WHATSAPP || "").replace(/\D/g, "");
    const whatsapp = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(`Olá, enviei o cadastro ${caseCode} para conhecer o SigmaFiscal.`)}` : null;
    return apiJson({ accepted: true, caseCode, whatsapp }, 201);
  } catch (error) { return safeError(error); }
}
