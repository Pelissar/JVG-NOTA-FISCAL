import { RestaurantQrMenu } from "../../qr-menu";

export const dynamic = "force-dynamic";

export default async function RestaurantQrPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RestaurantQrMenu key={token} token={token}/>;
}
