import { getCurrentUser } from "@/lib/auth";
import { listReviewForUser } from "@/lib/review";
import { ReviewList } from "@/components/ReviewList";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await getCurrentUser();
  const items = listReviewForUser(user.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Needs review</h1>
        <p className="mt-1 text-sm text-muted">
          Confirmations the parser detected but couldn&apos;t fully extract. Fill
          in what&apos;s missing and add, or dismiss.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          Nothing to review. 🎉
        </p>
      ) : (
        <ReviewList items={items} />
      )}
    </div>
  );
}
