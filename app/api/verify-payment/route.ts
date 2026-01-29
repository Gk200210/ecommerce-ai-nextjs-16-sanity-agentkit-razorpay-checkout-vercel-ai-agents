import { NextResponse } from "next/server";
import { verifyPayment } from "@/lib/actions/verify-payment";

export async function POST(req: Request) {
  try {
    const data = await req.json();
    const result = await verifyPayment(data);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Verify API error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
