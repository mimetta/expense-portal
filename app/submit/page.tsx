"use client";

import { useRouter } from "next/navigation";
import RequestForm, { type RequestFormPayload } from "@/components/shared/RequestForm";

export default function SubmitPage() {
  const router = useRouter();

  const handleSubmit = async (payload: RequestFormPayload) => {
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? "Failed to submit request");
    }

    router.push("/my");
  };

  return <RequestForm onSubmit={handleSubmit} submitLabel="Submit Request" submittingLabel="Submitting..." />;
}
