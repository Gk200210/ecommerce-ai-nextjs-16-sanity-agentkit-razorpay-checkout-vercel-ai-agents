"use client";

import { useTransition, useState } from "react";
import { Loader2, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCartItems } from "@/lib/store/cart-store-provider";

declare global {
  interface Window {
    Razorpay: any;
  }
}

interface CheckoutButtonProps {
  disabled?: boolean;
}

export function CheckoutButton({ disabled }: CheckoutButtonProps) {
  const items = useCartItems();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = () => {
    setError(null);

    if (!window.Razorpay) {
      toast.error("Payment system not ready. Refresh page.");
      return;
    }

    startTransition(async () => {
      try {
        // ✅ CALL API ROUTE INSTEAD OF SERVER ACTION
        const res = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });

        const result = await res.json();

        if (!result.success || !result.order) {
          setError(result.error ?? "Checkout failed");
          toast.error(result.error ?? "Something went wrong");
          return;
        }

        const razorpayKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
        if (!razorpayKey) {
          toast.error("Razorpay key missing");
          return;
        }

        const options = {
          key: razorpayKey,
          order_id: result.order.id,
          name: "My Store",
          description: "Order Payment",

          handler: async function (response: any) {
            try {
              // ✅ VERIFY VIA API ROUTE
              const verifyRes = await fetch("/api/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              }).then(r => r.json());

              if (verifyRes.success) {
                window.location.href = `/checkout/success?payment_id=${response.razorpay_payment_id}`;
              } else {
                toast.error("Payment verification failed");
              }
            } catch (err) {
              console.error(err);
              toast.error("Verification error");
            }
          },

          modal: {
            ondismiss: () => toast.error("Payment cancelled"),
          },

          method: {
            upi: true,
            card: true,
            wallet: true,
            netbanking: true,
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.open();
      } catch (err) {
        console.error("Checkout error:", err);
        const message =
          err instanceof Error ? err.message : "Failed to process checkout";
        setError(message);
        toast.error(message);
      }
    });
  };

  return (
    <div className="space-y-2">
      <Button
        onClick={handleCheckout}
        disabled={disabled || isPending || items.length === 0}
        size="lg"
        className="w-full"
      >
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-5 w-5" />
            Pay with Razorpay / UPI
          </>
        )}
      </Button>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 text-center">
          {error}
        </p>
      )}
    </div>
  );
}
