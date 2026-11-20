import { notFound } from "next/navigation";
import { RestaurantPublicMenu } from "../../restaurant/restaurant-public-menu";

export const dynamic = "force-dynamic";

export default async function PublicRestaurantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 60) notFound();
  return <RestaurantPublicMenu slug={slug} />;
}
