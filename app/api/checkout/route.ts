import { NextResponse } from "next/server";
import { createCheckoutSession } from "@/lib/actions/checkout";

export async function POST(req: Request) {
  try {
    const { items } = await req.json();
    const result = await createCheckoutSession(items);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Checkout API error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
