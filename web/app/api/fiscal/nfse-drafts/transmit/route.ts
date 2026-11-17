import { apiJson } from "../../../../../lib/jvg-backend";

export const dynamic = "force-dynamic";

export async function POST() {
  return apiJson({ error: "A NFS-e ainda não está habilitada para transmissão. Configure o município emissor, os dados da DPS e a homologação antes de liberar o envio." }, 503);
}
