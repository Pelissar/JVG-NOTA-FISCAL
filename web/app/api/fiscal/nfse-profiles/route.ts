import { apiJson } from "../../../../lib/jvg-backend";

export const dynamic = "force-dynamic";

const closed = () => apiJson({ error: "A nota de serviço saiu do sistema. A emissão agora é feita somente no portal." }, 410);

export function GET() { return closed(); }
export function POST() { return closed(); }
export function PATCH() { return closed(); }
