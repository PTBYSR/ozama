import { NextRequest, NextResponse } from "next/server";
import { getAdminPassword, generateAdminToken, verifyAdminToken } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const password = body.password || "";

    const correctPassword = getAdminPassword();

    if (password !== correctPassword) {
      return NextResponse.json(
        { success: false, error: "Invalid admin password" },
        { status: 401 }
      );
    }

    const token = generateAdminToken(password);
    const response = NextResponse.json({ success: true, token });

    // Set secure HTTP-only cookie
    response.cookies.set("ozama_admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (err: any) {
    return NextResponse.json({ error: "Auth processing error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get("ozama_admin_token")?.value;
  const isValid = verifyAdminToken(token);
  return NextResponse.json({ authenticated: isValid });
}
