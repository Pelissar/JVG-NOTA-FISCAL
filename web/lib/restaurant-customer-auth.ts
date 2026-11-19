import { JvgBackendError } from "./jvg-backend";

export type VerifiedRestaurantCustomer = {
  userId: string;
  phone: string;
};

function normalizeCustomerPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
}

export async function requireVerifiedRestaurantCustomer(request: Request): Promise<VerifiedRestaurantCustomer> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!token || !url || !key) {
    throw new JvgBackendError("Confirme seu telefone para continuar. O acesso do cliente precisa do Supabase Auth configurado.", 401);
  }

  let response: Response;
  try {
    response = await fetch(url + "/auth/v1/user", {
      headers: { apikey: key, Authorization: "Bearer " + token },
      cache: "no-store",
    });
  } catch {
    throw new JvgBackendError("Não foi possível verificar sua sessão de cliente. Tente novamente.", 503);
  }
  if (!response.ok) throw new JvgBackendError("Sua sessão expirou. Confirme o telefone novamente.", 401);

  const user = await response.json() as { id?: unknown; phone?: unknown; phone_confirmed_at?: unknown };
  if (typeof user.id !== "string" || !/^[0-9a-f-]{36}$/i.test(user.id) ||
      typeof user.phone !== "string" || !user.phone_confirmed_at) {
    throw new JvgBackendError("Confirme um telefone válido para acessar pedidos e histórico.", 401);
  }
  const phone = normalizeCustomerPhone(user.phone);
  if (!/^\d{10,13}$/.test(phone)) throw new JvgBackendError("A conta não possui um telefone brasileiro válido confirmado.", 401);
  return { userId: user.id, phone };
}
