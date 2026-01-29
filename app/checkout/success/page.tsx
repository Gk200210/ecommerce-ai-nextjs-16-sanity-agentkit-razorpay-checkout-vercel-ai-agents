import { redirect } from "next/navigation";
import { SuccessClient } from "./SuccessClient";
import { getRazorpayOrder } from "@/lib/actions/checkout";

async function waitForOrder(paymentId: string, retries = 5) {
  for (let i = 0; i < retries; i++) {
    const result = await getRazorpayOrder(paymentId);
    if (result.success && result.order) return result.order;

    await new Promise((res) => setTimeout(res, 1000)); // wait 1s
  }
  return null;
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ payment_id?: string }>;
}) {
  const params = await searchParams;
  const paymentId = params.payment_id;

  if (!paymentId) redirect("/");

  const order = await waitForOrder(paymentId);

  if (!order) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-lg">Processing your order...</p>
      </div>
    );
  }

  return <SuccessClient order={order} />;
}
