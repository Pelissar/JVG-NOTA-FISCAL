import { notFound } from "next/navigation";
import { RestaurantConsole, type RestaurantArea } from "../console";

export const dynamic = "force-dynamic";

const routeAreas: Record<string, RestaurantArea> = {
  pedidos: "orders",
  salao: "tables",
  cozinha: "kitchen",
  cardapio: "menu",
  estoque: "stock",
  clientes: "customers",
  relatorios: "reports",
  configuracoes: "settings",
};

export default async function RestaurantSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!Object.hasOwn(routeAreas, section)) notFound();
  const area = routeAreas[section];
  if (!area) notFound();
  return <RestaurantConsole section={area} />;
}

