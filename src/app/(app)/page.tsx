import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/ui";

export default async function HomePage() {
  const user = await requireUser();
  return <PageHeader title="ホーム" sub={`${user.name} さん`} />;
}
