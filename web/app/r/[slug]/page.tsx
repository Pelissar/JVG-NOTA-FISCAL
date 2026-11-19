import { RestaurantQrMenu } from "../../restaurant/qr-menu";

export const dynamic = "force-dynamic";

export default async function PublicRestaurantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <RestaurantQrMenu key={slug} slug={slug} />;
}
