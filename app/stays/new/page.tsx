import { StayForm } from "@/components/StayForm";

export default function NewStayPage() {
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-5 text-xl font-semibold">Add a stay</h1>
      <StayForm />
    </div>
  );
}
