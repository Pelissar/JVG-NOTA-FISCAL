import { apiJson } from "../../../../../lib/jvg-backend";

export const dynamic = "force-dynamic";

export async function POST() {
  return apiJson({ error: "A nota de serviço saiu do sistema. A emissão agora é feita somente no portal." }, 410);
}
